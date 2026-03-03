import type { FlowGraph, FlowNode, FlowEdge, FlowVariable, SubNode, SubNodeCodegenContext } from '$lib/types/flow';
import { getSubNodeDef } from '$lib/flow/subnodes/registry';
import { computeSubNodePixelY, getSortedSubNodes } from '$lib/flow/layout';

// ==================== Persistence Types & Helpers ====================

/** A variable ready for bitpack-based SPVAR persistence */
export interface PersistVar {
	name: string;
	min: number;
	max: number;
	defaultValue: number;
	perProfile?: boolean;
	profileCount?: number;
	/** For array persistence using a loop */
	arrayLoop?: {
		countExpr: string;
		indexVar: string;
	};
}

/** Convert FlowVariables (persist=true) to PersistVars with resolved min/max ranges */
export function flowVarsToPersistVars(vars: FlowVariable[], profileCount: number): PersistVar[] {
	const result: PersistVar[] = [];
	for (const v of vars) {
		if (v.type === 'string') continue;

		let min = v.min;
		let max = v.max;

		if (min === undefined || max === undefined) {
			// Infer range from type when not explicitly set
			switch (v.type) {
				case 'int8':
					min = min ?? -128;
					max = max ?? 127;
					break;
				case 'int16':
					min = min ?? -32768;
					max = max ?? 32767;
					break;
				default:
					min = min ?? -32768;
					max = max ?? 32767;
					break;
			}
		}

		result.push({
			name: v.name,
			min,
			max,
			defaultValue: typeof v.defaultValue === 'number' ? v.defaultValue : 0,
			perProfile: v.perProfile,
			profileCount: v.perProfile ? profileCount : undefined,
		});
	}
	return result;
}

/**
 * Generate bitpack-based Flow_Save / Flow_Load functions.
 * Uses SPVAR_5+ for auto-generated data, leaving SPVAR_1-4 for user use.
 * SPVAR_0 is the data-exists marker.
 */
export function generateBitpackPersistence(vars: PersistVar[]): string {
	if (vars.length === 0) return '';

	const hasArrayLoop = vars.some((v) => v.arrayLoop);
	const lines: string[] = [];

	lines.push(`define SPVAR_BITPACK_START = SPVAR_5;`);
	if (hasArrayLoop) {
		lines.push(`int _bp_loop_i;`);
	}
	lines.push(``);

	// Flow_Save
	lines.push(`function Flow_Save() {`);
	lines.push(`    spvar_current_slot = SPVAR_BITPACK_START;`);
	lines.push(`    spvar_current_bit = 0;`);
	lines.push(`    spvar_current_value = 0;`);
	lines.push(`    spvar_total_bits = 0;`);
	for (const v of vars) {
		if (v.arrayLoop) {
			lines.push(`    for(_bp_loop_i = 0; _bp_loop_i < ${v.arrayLoop.countExpr}; _bp_loop_i++) {`);
			lines.push(`        save_spvar(${v.name}[_bp_loop_i], ${v.min}, ${v.max});`);
			lines.push(`    }`);
		} else if (v.perProfile && v.profileCount && v.profileCount > 1) {
			for (let p = 0; p < v.profileCount; p++) {
				lines.push(`    save_spvar(${v.name}[${p}], ${v.min}, ${v.max});`);
			}
		} else {
			lines.push(`    save_spvar(${v.name}, ${v.min}, ${v.max});`);
		}
	}
	lines.push(`    flush_spvar();`);
	lines.push(`    set_pvar(SPVAR_0, 1);`);
	lines.push(`}`);
	lines.push(``);

	// Flow_Load
	lines.push(`function Flow_Load() {`);
	lines.push(`    if(get_pvar(SPVAR_0) != 1) return;`);
	lines.push(`    spvar_current_slot = SPVAR_BITPACK_START;`);
	lines.push(`    spvar_current_bit = 0;`);
	lines.push(`    spvar_current_value = 0;`);
	lines.push(`    spvar_total_bits = 0;`);
	for (const v of vars) {
		if (v.arrayLoop) {
			lines.push(`    for(_bp_loop_i = 0; _bp_loop_i < ${v.arrayLoop.countExpr}; _bp_loop_i++) {`);
			lines.push(`        ${v.name}[_bp_loop_i] = read_spvar(${v.min}, ${v.max}, ${v.defaultValue});`);
			lines.push(`    }`);
		} else if (v.perProfile && v.profileCount && v.profileCount > 1) {
			for (let p = 0; p < v.profileCount; p++) {
				lines.push(`    ${v.name}[${p}] = read_spvar(${v.min}, ${v.max}, ${v.defaultValue});`);
			}
		} else {
			lines.push(`    ${v.name} = read_spvar(${v.min}, ${v.max}, ${v.defaultValue});`);
		}
	}
	lines.push(`}`);

	return lines.join('\n');
}

/**
 * Generate a complete GPC script from a FlowGraph.
 * Produces a self-contained state machine with OLED rendering.
 *
 * @param profileCount - When > 1, per-profile variables are declared as arrays
 *                       and indexed with `[Flow_CurrentProfile]`.
 * @param options.skipPersistence - When true, omit persistence functions and
 *        Flow_Load() call (used by merged codegen which generates combined persistence).
 */
export function generateFlowGpc(
	graph: FlowGraph,
	profileCount: number = 0,
	options?: { skipPersistence?: boolean }
): string {
	const lines: string[] = [];
	const nodes = graph.nodes;
	const edges = graph.edges;

	if (nodes.length === 0) {
		return '// Empty flow graph — add nodes to generate code\n';
	}

	// Sort: initial state first, then by position
	const sorted = [...nodes].sort((a, b) => {
		if (a.isInitialState) return -1;
		if (b.isInitialState) return 1;
		return a.position.y - b.position.y || a.position.x - b.position.x;
	});

	const stateIds = new Map<string, number>();
	sorted.forEach((node, i) => stateIds.set(node.id, i));

	// Header
	lines.push(`// ====================================================`);
	lines.push(`// Flow: ${graph.name}`);
	lines.push(`// Generated by Zen Forge Flow Editor`);
	lines.push(`// States: ${nodes.length} | Transitions: ${edges.length}`);
	lines.push(`// ====================================================`);
	lines.push(``);

	// Imports for common helpers
	lines.push(`import common/helper;`);
	lines.push(`import common/oled;`);
	const hasPersistence =
		graph.settings.persistenceEnabled && !options?.skipPersistence && collectPersistVars(graph).length > 0;
	if (hasPersistence) {
		lines.push(`import common/bitpack;`);
	}
	lines.push(``);

	// State defines
	lines.push(`// ===== STATE DEFINITIONS =====`);
	for (const node of sorted) {
		const id = stateIds.get(node.id)!;
		const safeName = sanitizeName(node.label);
		lines.push(`define FLOW_STATE_${safeName} = ${id};`);
	}
	lines.push(``);

	const bm = graph.settings.buttonMapping;

	const hasBackButton = nodes.some((n) => n.backButton);

	// Variables
	lines.push(`// ===== VARIABLES =====`);
	lines.push(`int FlowCurrentState;`);
	lines.push(`int FlowPrevState = -1;`);
	lines.push(`int FlowStateTimer;`);
	if (hasBackButton) {
		lines.push(`int FlowStateStack[8];`);
		lines.push(`int FlowStackTop = 0;`);
	}
	lines.push(``);

	// Collect per-profile variable names for indexing
	const perProfileVars = new Set<string>();
	if (profileCount > 1) {
		for (const v of graph.globalVariables) {
			if (v.perProfile) perProfileVars.add(v.name);
		}
		for (const node of nodes) {
			for (const v of node.variables) {
				if (v.perProfile) perProfileVars.add(v.name);
			}
		}
	}

	/** Apply profile indexing to a variable name if needed */
	const profileVar = (name: string) =>
		perProfileVars.has(name) ? `${name}[Flow_CurrentProfile]` : name;

	// Global variables
	if (graph.globalVariables.length > 0) {
		lines.push(`// Global flow variables`);
		for (const v of graph.globalVariables) {
			lines.push(generateVarDeclaration(v, profileCount));
		}
		lines.push(``);
	}

	// Per-node variables + auto cursor/scroll vars
	const declaredVars = new Set<string>(['FlowCurrentState', 'FlowPrevState', 'FlowStateTimer']);
	for (const node of sorted) {
		const safeName = sanitizeName(node.label);
		const interactiveSubs = getInteractiveSubNodes(node);

		if (node.variables.length > 0 || interactiveSubs.length > 0) {
			lines.push(`// Variables for ${node.label}`);
		}

		for (const v of node.variables) {
			if (!declaredVars.has(v.name)) {
				lines.push(generateVarDeclaration(v, profileCount));
				declaredVars.add(v.name);
			}
		}

		// Auto-declare cursor variable for nodes with interactive sub-nodes
		if (interactiveSubs.length > 0) {
			const cursorVar = `Flow_${safeName}_cursor`;
			if (!declaredVars.has(cursorVar)) {
				lines.push(`int ${cursorVar};`);
				declaredVars.add(cursorVar);
			}
		}

		if (node.variables.length > 0 || interactiveSubs.length > 0) {
			lines.push(``);
		}
	}

	// Global code
	if (graph.globalCode.trim()) {
		lines.push(`// ===== GLOBAL CODE =====`);
		lines.push(graph.globalCode.trim());
		lines.push(``);
	}

	// Pre-generate sub-node code to collect strings for const string[] declarations
	const nodeSubNodeCode = new Map<string, string[]>();
	const nodeStrings = new Map<string, string[]>();

	for (const node of sorted) {
		if (node.subNodes.length === 0) continue;
		const safeName = sanitizeName(node.label);
		const sortedSubs = getSortedSubNodes(node);
		const strings: string[] = [];
		const stringArrayName = `FlowText_${safeName}`;
		const codeLines: string[] = [];
		let cursorIndex = 0;

		for (const sub of sortedSubs) {
			const def = getSubNodeDef(sub.type);
			if (!def) continue;

			const pixelY = computeSubNodePixelY(node, sub);
			const pixelX = sub.position === 'absolute' ? (sub.x ?? 0) : node.stackOffsetX;

			const ctx: SubNodeCodegenContext = {
				varPrefix: `Flow_${safeName}`,
				cursorVar: `Flow_${safeName}_cursor`,
				cursorIndex: sub.interactive ? cursorIndex : -1,
				x: pixelX,
				y: pixelY,
				boundVariable: sub.boundVariable ? profileVar(sub.boundVariable) : undefined,
				buttons: bm,
				stringArrayName,
				strings,
			};

			const configWithLabel = { ...sub.config, label: sub.label };
			const code = def.generateGpc(configWithLabel, ctx);
			if (code.trim()) {
				codeLines.push(code);
			}

			if (sub.interactive) cursorIndex++;
		}

		nodeSubNodeCode.set(node.id, codeLines);
		nodeStrings.set(node.id, strings);
	}

	// Emit const string[] declarations for each node that has text
	let hasStringDecls = false;
	for (const node of sorted) {
		const strings = nodeStrings.get(node.id);
		if (strings && strings.length > 0) {
			if (!hasStringDecls) {
				lines.push(`// ===== STRING TABLES =====`);
				hasStringDecls = true;
			}
			const safeName = sanitizeName(node.label);
			const escaped = strings.map((s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
			lines.push(`const string FlowText_${safeName}[] = { ${escaped.join(', ')} };`);
		}
	}
	if (hasStringDecls) lines.push(``);

	// OLED draw functions (legacy: nodes with oledScene but no sub-nodes)
	for (const node of sorted) {
		if (node.oledScene && node.subNodes.length === 0) {
			lines.push(`// ===== DRAW: ${node.label} =====`);
			lines.push(generateOledDrawFunction(node));
			lines.push(``);
		}
	}

	// State logic functions
	for (const node of sorted) {
		const safeName = sanitizeName(node.label);
		const outEdges = edges.filter((e) => e.sourceNodeId === node.id);
		const interactiveSubs = getInteractiveSubNodes(node);
		const hasSubNodes = node.subNodes.length > 0;

		lines.push(`// ===== STATE: ${node.label} =====`);
		lines.push(`function FlowState_${safeName}() {`);

		// onEnter logic (runs once when entering state)
		if (node.onEnter.trim()) {
			lines.push(`    // On enter`);
			lines.push(`    if(FlowPrevState != FLOW_STATE_${safeName}) {`);
			for (const line of node.onEnter.trim().split('\n')) {
				lines.push(`        ${line.trim()}`);
			}
			lines.push(`    }`);
		}

		if (hasSubNodes) {
			// === V2: Sub-node based rendering ===
			lines.push(`    cls_oled(OLED_BLACK);`);

			// Cursor navigation logic
			if (interactiveSubs.length > 0) {
				const cursorVar = `Flow_${safeName}_cursor`;
				const maxCursor = interactiveSubs.length - 1;
				lines.push(``);
				lines.push(`    // Cursor navigation`);
				if (node.scrollMode === 'wrap') {
					lines.push(`    if(event_press(${bm.up})) { if(${cursorVar} > 0) ${cursorVar} = ${cursorVar} - 1; else ${cursorVar} = ${maxCursor}; }`);
					lines.push(`    if(event_press(${bm.down})) { if(${cursorVar} < ${maxCursor}) ${cursorVar} = ${cursorVar} + 1; else ${cursorVar} = 0; }`);
				} else {
					lines.push(`    if(event_press(${bm.up}) && ${cursorVar} > 0) ${cursorVar} = ${cursorVar} - 1;`);
					lines.push(`    if(event_press(${bm.down}) && ${cursorVar} < ${maxCursor}) ${cursorVar} = ${cursorVar} + 1;`);
				}

				// Toggle interaction (confirm toggles the bound variable)
				for (let i = 0; i < interactiveSubs.length; i++) {
					const sub = interactiveSubs[i];
					if (sub.type === 'toggle-item' && sub.boundVariable) {
						const bv = profileVar(sub.boundVariable);
						lines.push(`    if(${cursorVar} == ${i} && event_press(${bm.confirm})) ${bv} = !${bv};`);
					}
				}
			}

			lines.push(``);
			lines.push(`    // Sub-node rendering`);

			// Use pre-generated sub-node code (collected during string pass)
			const subCode = nodeSubNodeCode.get(node.id);
			if (subCode) {
				for (const code of subCode) {
					lines.push(code);
				}
			}
		} else {
			// === Legacy: raw code + OLED scene ===
			if (node.oledScene) {
				lines.push(`    Draw_Flow_${safeName}();`);
			}

			if (node.gpcCode.trim()) {
				lines.push(`    // Logic`);
				for (const line of node.gpcCode.trim().split('\n')) {
					lines.push(`    ${line}`);
				}
			}
		}

		// User's custom GPC code (even nodes with sub-nodes can have extra code)
		if (hasSubNodes && node.gpcCode.trim()) {
			lines.push(``);
			lines.push(`    // Custom code`);
			for (const line of node.gpcCode.trim().split('\n')) {
				lines.push(`    ${line}`);
			}
		}

		// Back button: pop state stack to return to caller
		if (node.backButton) {
			lines.push(``);
			lines.push(`    // Back button`);
			lines.push(`    if(event_press(${node.backButton}) && FlowStackTop > 0) {`);
			if (node.onExit.trim()) {
				for (const line of node.onExit.trim().split('\n')) {
					lines.push(`        ${line.trim()}`);
				}
			}
			lines.push(`        FlowStackTop = FlowStackTop - 1;`);
			lines.push(`        FlowCurrentState = FlowStateStack[FlowStackTop];`);
			lines.push(`    }`);
		}

		// Transitions
		if (outEdges.length > 0) {
			lines.push(``);
			lines.push(`    // Transitions`);
			for (const edge of outEdges) {
				const targetNode = nodes.find((n) => n.id === edge.targetNodeId);
				if (!targetNode) continue;
				const targetName = sanitizeName(targetNode.label);
				const condition = generateConditionCode(edge);

				if (condition) {
					// Sub-node level edge: wrap with cursor index check
					let fullCondition = condition;
					if (edge.sourceSubNodeId && interactiveSubs.length > 0) {
						const subIdx = interactiveSubs.findIndex((s) => s.id === edge.sourceSubNodeId);
						if (subIdx >= 0) {
							fullCondition = `Flow_${safeName}_cursor == ${subIdx} && ${condition}`;
						}
					}

					lines.push(`    if(${fullCondition}) {`);
					if (node.onExit.trim()) {
						for (const line of node.onExit.trim().split('\n')) {
							lines.push(`        ${line.trim()}`);
						}
					}
					if (hasBackButton) {
						lines.push(`        if(FlowStackTop < 8) { FlowStateStack[FlowStackTop] = FlowCurrentState; FlowStackTop = FlowStackTop + 1; }`);
					}
					lines.push(`        FlowCurrentState = FLOW_STATE_${targetName};`);
					lines.push(`    }`);
				}
			}
		}

		lines.push(`}`);
		lines.push(``);
	}

	// Combo code (collected from all nodes)
	const allCombos = sorted.filter((n) => n.comboCode.trim()).map((n) => n.comboCode.trim());
	if (allCombos.length > 0) {
		lines.push(`// ===== COMBOS =====`);
		for (const combo of allCombos) {
			lines.push(combo);
			lines.push(``);
		}
	}

	// Persistence functions (bitpack-based, SPVAR_5+)
	if (hasPersistence) {
		const persistVars = collectPersistVars(graph);
		const pvars = flowVarsToPersistVars(persistVars, profileCount);
		if (pvars.length > 0) {
			lines.push(`// ===== PERSISTENCE =====`);
			lines.push(generateBitpackPersistence(pvars));
			lines.push(``);
		}
	}

	// Init block
	const initialState = sorted[0];
	const initialName = sanitizeName(initialState.label);
	lines.push(`// ===== INIT =====`);
	lines.push(`init {`);
	lines.push(`    FlowCurrentState = FLOW_STATE_${initialName};`);
	if (hasPersistence) {
		lines.push(`    Flow_Load();`);
	}
	lines.push(`}`);
	lines.push(``);

	// Main loop
	lines.push(`// ===== MAIN LOOP =====`);
	lines.push(`main {`);
	lines.push(`    // State dispatch`);
	for (const node of sorted) {
		const id = stateIds.get(node.id)!;
		const safeName = sanitizeName(node.label);
		const keyword = id === 0 ? 'if' : 'else if';
		lines.push(`    ${keyword}(FlowCurrentState == FLOW_STATE_${safeName}) { FlowState_${safeName}(); }`);
	}
	lines.push(``);
	lines.push(`    // State timer`);
	lines.push(`    if(FlowCurrentState != FlowPrevState) {`);
	lines.push(`        FlowStateTimer = 0;`);
	lines.push(`        FlowPrevState = FlowCurrentState;`);
	lines.push(`    }`);
	lines.push(`    FlowStateTimer = FlowStateTimer + get_rtime();`);
	lines.push(`}`);

	return lines.join('\n');
}

// ==================== Helpers ====================

function getInteractiveSubNodes(node: FlowNode): SubNode[] {
	return getSortedSubNodes(node).filter((sn) => sn.interactive);
}

function generateVarDeclaration(v: FlowVariable, profileCount: number = 0): string {
	// Per-profile variables become arrays when multiple profiles exist
	if (v.perProfile && profileCount > 1 && v.type !== 'string') {
		const defaults = Array(profileCount).fill(v.defaultValue).join(', ');
		return `${v.type} ${v.name}[${profileCount}] = { ${defaults} };`;
	}
	if (v.type === 'string') {
		const size = v.arraySize ?? 32;
		const defaultStr = typeof v.defaultValue === 'string' ? v.defaultValue : '';
		if (defaultStr) {
			const chars = Array.from(defaultStr).map((c) => c.charCodeAt(0));
			chars.push(0);
			while (chars.length < size) chars.push(0);
			return `int8 ${v.name}[${size}] = { ${chars.slice(0, size).join(', ')} };`;
		}
		return `int8 ${v.name}[${size}];`;
	}
	return `${v.type} ${v.name} = ${v.defaultValue};`;
}

function sanitizeName(name: string): string {
	return name
		.replace(/[^a-zA-Z0-9_]/g, '_')
		.replace(/^[0-9]/, '_$&')
		.replace(/_+/g, '_');
}

function generateConditionCode(edge: FlowEdge): string | null {
	const c = edge.condition;
	const modChecks = (c.modifiers ?? [])
		.filter(Boolean)
		.map((btn) => `get_val(${btn})`);

	let result: string | null = null;
	switch (c.type) {
		case 'button_press':
			result = c.button ? `event_press(${c.button})` : null;
			break;
		case 'button_hold':
			result = c.button && c.timeoutMs
				? `get_val(${c.button}) && FlowStateTimer > ${c.timeoutMs}`
				: c.button
					? `get_val(${c.button})`
					: null;
			break;
		case 'timeout':
			result = c.timeoutMs ? `FlowStateTimer > ${c.timeoutMs}` : null;
			break;
		case 'variable':
			result = c.variable && c.comparison
				? `${c.variable} ${c.comparison} ${c.value ?? 0}`
				: null;
			break;
		case 'custom':
			result = c.customCode?.trim() || null;
			break;
		default:
			return null;
	}

	if (result && modChecks.length > 0) {
		return [...modChecks, result].join(' && ');
	}
	return result;
}

function generateOledDrawFunction(node: FlowNode): string {
	const safeName = sanitizeName(node.label);
	const lines: string[] = [];

	lines.push(`function Draw_Flow_${safeName}() {`);
	lines.push(`    cls_oled(OLED_BLACK);`);

	if (node.oledScene) {
		try {
			const binaryStr = atob(node.oledScene.pixels);
			const bytes = new Uint8Array(binaryStr.length);
			for (let i = 0; i < binaryStr.length; i++) {
				bytes[i] = binaryStr.charCodeAt(i);
			}

			for (let y = 0; y < 64; y++) {
				for (let x = 0; x < 128; x++) {
					const byteIdx = y * 16 + Math.floor(x / 8);
					const bitIdx = 7 - (x % 8);
					if (byteIdx < bytes.length && (bytes[byteIdx] & (1 << bitIdx)) !== 0) {
						lines.push(`    pixel_oled(${x}, ${y}, 1);`);
					}
				}
			}
		} catch {
			lines.push(`    // Error decoding OLED scene data`);
		}
	}

	lines.push(`}`);
	return lines.join('\n');
}

export function collectPersistVars(graph: FlowGraph): FlowVariable[] {
	const vars: FlowVariable[] = [];
	const seen = new Set<string>();

	for (const v of graph.globalVariables) {
		if (v.persist && !seen.has(v.name)) {
			vars.push(v);
			seen.add(v.name);
		}
	}
	for (const node of graph.nodes) {
		for (const v of node.variables) {
			if (v.persist && !seen.has(v.name)) {
				vars.push(v);
				seen.add(v.name);
			}
		}
	}

	return vars;
}

