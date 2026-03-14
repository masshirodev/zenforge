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
	/** Sparse array: only persist non-default entries as (index, values...).
	 *  Saves count + per-entry (index + stride values). */
	sparseArray?: {
		countExpr: string;       // e.g. 'WEAPON_COUNT'
		maxCount: string;        // e.g. 'WEAPON_COUNT' — max value for count field
		indexVar: string;        // loop var e.g. '_bp_loop_i'
		countVar: string;        // temp count var e.g. '_bp_sparse_count'
		stride: number;          // values per entry (e.g. 2 for V+H)
	};
}

/** Convert FlowVariables (persist=true) to PersistVars with resolved min/max ranges */
export function flowVarsToPersistVars(vars: FlowVariable[], profileCount: number): PersistVar[] {
	const result: PersistVar[] = [];
	for (const v of vars) {
		if (v.type === 'string') continue;

		let min = v.min;
		let max = v.max;

		if (min == null || max == null) {
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
 * Uses SPVAR_6+ for auto-generated data, leaving SPVAR_2-5 for user use.
 * SPVAR_1 is the data-exists marker.
 */
export function generateBitpackPersistence(vars: PersistVar[]): string {
	if (vars.length === 0) return '';

	const hasArrayLoop = vars.some((v) => v.arrayLoop);
	const hasSparse = vars.some((v) => v.sparseArray);
	const lines: string[] = [];

	lines.push(`define SPVAR_BITPACK_START = SPVAR_6;`);
	if (hasArrayLoop || hasSparse) {
		lines.push(`int _bp_loop_i;`);
	}
	if (hasSparse) {
		lines.push(`int _bp_sparse_count;`);
		lines.push(`int _bp_loop_j;`);
	}
	lines.push(``);

	// Flow_Save
	lines.push(`function Flow_Save() {`);
	lines.push(`    spvar_current_slot = SPVAR_BITPACK_START;`);
	lines.push(`    spvar_current_bit = 0;`);
	lines.push(`    spvar_current_value = 0;`);
	lines.push(`    spvar_total_bits = 0;`);
	for (const v of vars) {
		if (v.sparseArray) {
			const s = v.sparseArray;
			// Pass 1: count non-default entries
			lines.push(`    _bp_sparse_count = 0;`);
			lines.push(`    for(${s.indexVar} = 0; ${s.indexVar} < ${s.countExpr}; ${s.indexVar}++) {`);
			const checks = Array.from({ length: s.stride }, (_, i) =>
				`${v.name}[${s.indexVar} * ${s.stride} + ${i}] != ${v.defaultValue}`
			).join(' || ');
			lines.push(`        if(${checks}) _bp_sparse_count++;`);
			lines.push(`    }`);
			// Save count
			lines.push(`    save_spvar(_bp_sparse_count, 0, ${s.maxCount});`);
			// Pass 2: save non-default entries as (index, values...)
			lines.push(`    for(${s.indexVar} = 0; ${s.indexVar} < ${s.countExpr}; ${s.indexVar}++) {`);
			lines.push(`        if(${checks}) {`);
			lines.push(`            save_spvar(${s.indexVar}, 0, ${s.maxCount});`);
			for (let i = 0; i < s.stride; i++) {
				lines.push(`            save_spvar(${v.name}[${s.indexVar} * ${s.stride} + ${i}], ${v.min}, ${v.max});`);
			}
			lines.push(`        }`);
			lines.push(`    }`);
		} else if (v.arrayLoop) {
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
	lines.push(`    set_pvar(SPVAR_1, 1);`);
	lines.push(`}`);
	lines.push(``);

	// Flow_Load
	lines.push(`function Flow_Load() {`);
	lines.push(`    if(get_pvar(SPVAR_1, 0x80000000, 0x7FFFFFFF, 0) != 1) return;`);
	lines.push(`    spvar_current_slot = SPVAR_BITPACK_START;`);
	lines.push(`    spvar_current_bit = 0;`);
	lines.push(`    spvar_current_value = 0;`);
	lines.push(`    spvar_total_bits = 0;`);
	for (const v of vars) {
		if (v.sparseArray) {
			const s = v.sparseArray;
			// Read count, then read that many (index, values...) entries
			lines.push(`    _bp_sparse_count = read_spvar(0, ${s.maxCount}, 0);`);
			lines.push(`    for(_bp_loop_j = 0; _bp_loop_j < _bp_sparse_count; _bp_loop_j++) {`);
			lines.push(`        ${s.indexVar} = read_spvar(0, ${s.maxCount}, 0);`);
			for (let i = 0; i < s.stride; i++) {
				lines.push(`        ${v.name}[${s.indexVar} * ${s.stride} + ${i}] = read_spvar(${v.min}, ${v.max}, ${v.defaultValue});`);
			}
			lines.push(`    }`);
		} else if (v.arrayLoop) {
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

/** Composite multiple pixel-art sub-nodes into a single image buffer */
function compositePixelArts(
	arts: { sub: SubNode; x: number; y: number }[]
): { x: number; y: number; w: number; h: number; hexRows: string[] } | null {
	// Decode each pixel-art and find bounding box
	const decoded: { pixels: Uint8Array; cropW: number; cropH: number; x: number; y: number }[] =
		[];

	for (const { sub, x, y } of arts) {
		const scene = sub.config.scene as { pixels?: string } | null;
		if (!scene?.pixels) continue;
		try {
			const raw = atob(scene.pixels);
			const bytes = new Uint8Array(raw.length);
			for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
			const cropW = (sub.config.width as number) || 128;
			const cropH = (sub.config.height as number) || 64;
			decoded.push({ pixels: bytes, cropW, cropH, x, y });
		} catch {
			// skip invalid
		}
	}

	if (decoded.length === 0) return null;

	// Compute bounding box
	let minX = 128,
		minY = 64,
		maxX = 0,
		maxY = 0;
	for (const d of decoded) {
		minX = Math.min(minX, d.x);
		minY = Math.min(minY, d.y);
		maxX = Math.max(maxX, d.x + d.cropW);
		maxY = Math.max(maxY, d.y + d.cropH);
	}
	// Clamp to OLED bounds
	minX = Math.max(0, minX);
	minY = Math.max(0, minY);
	maxX = Math.min(128, maxX);
	maxY = Math.min(64, maxY);

	const w = maxX - minX;
	const h = maxY - minY;
	if (w <= 0 || h <= 0) return null;

	// Composite onto a single buffer (1 bit per pixel, row-major MSB-first)
	const rowBytes = Math.ceil(w / 8);
	const buffer = new Uint8Array(rowBytes * h);

	for (const d of decoded) {
		for (let py = 0; py < d.cropH && d.y + py < maxY; py++) {
			for (let px = 0; px < d.cropW && d.x + px < maxX; px++) {
				// Read source pixel
				const srcByte = py * 16 + Math.floor(px / 8);
				const srcBit = 7 - (px % 8);
				if (srcByte >= d.pixels.length || !(d.pixels[srcByte] & (1 << srcBit))) continue;

				// Write to composite buffer
				const dx = d.x + px - minX;
				const dy = d.y + py - minY;
				const dstByte = dy * rowBytes + Math.floor(dx / 8);
				const dstBit = 7 - (dx % 8);
				buffer[dstByte] |= 1 << dstBit;
			}
		}
	}

	// Tight-crop to actual pixel content to minimize image size and draw time
	let contentMinX = w, contentMinY = h, contentMaxX = 0, contentMaxY = 0;
	for (let py = 0; py < h; py++) {
		for (let px = 0; px < w; px++) {
			const byteIdx = py * rowBytes + Math.floor(px / 8);
			const bitIdx = 7 - (px % 8);
			if (buffer[byteIdx] & (1 << bitIdx)) {
				contentMinX = Math.min(contentMinX, px);
				contentMinY = Math.min(contentMinY, py);
				contentMaxX = Math.max(contentMaxX, px + 1);
				contentMaxY = Math.max(contentMaxY, py + 1);
			}
		}
	}

	if (contentMaxX <= contentMinX || contentMaxY <= contentMinY) return null;

	const cropX = minX + contentMinX;
	const cropY = minY + contentMinY;
	const cropW = contentMaxX - contentMinX;
	const cropH = contentMaxY - contentMinY;

	// Pack cropped region into GPC const image format (row-major MSB-first, width-aligned)
	const packed: number[] = [];
	let currentByte = 0;
	let bit = 0;
	for (let py = contentMinY; py < contentMaxY; py++) {
		for (let px = contentMinX; px < contentMaxX; px++) {
			currentByte <<= 1;
			const byteIdx = py * rowBytes + Math.floor(px / 8);
			const bitIdx = 7 - (px % 8);
			if (buffer[byteIdx] & (1 << bitIdx)) {
				currentByte |= 1;
			}
			bit++;
			if (bit === 8) {
				packed.push(currentByte);
				currentByte = 0;
				bit = 0;
			}
		}
	}
	if (bit > 0) {
		packed.push(currentByte << (8 - bit));
	}

	// Format hex rows
	const hexRows: string[] = [];
	for (let i = 0; i < packed.length; i += 16) {
		const row = packed
			.slice(i, Math.min(i + 16, packed.length))
			.map((b) => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`)
			.join(', ');
		hexRows.push(`    ${row}`);
	}

	return { x: cropX, y: cropY, w: cropW, h: cropH, hexRows };
}

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

	const hasWindowMode = sorted.some((n) => n.scrollMode === 'window');

	// Header
	lines.push(`// ====================================================`);
	lines.push(`// Flow: ${graph.name}`);
	lines.push(`// Generated by ZenForge Flow Editor`);
	lines.push(`// States: ${nodes.length} | Transitions: ${edges.length}`);
	lines.push(`// ====================================================`);
	lines.push(``);

	const wantsPersistence =
		graph.settings.persistenceEnabled && collectPersistVars(graph).length > 0;
	const hasPersistence = wantsPersistence && !options?.skipPersistence;

	// State defines
	lines.push(`// ===== STATE DEFINITIONS =====`);
	for (const node of sorted) {
		const id = stateIds.get(node.id)!;
		const safeName = sanitizeName(node.label);
		lines.push(`define FLOW_STATE_${safeName} = ${id};`);
	}
	lines.push(``);

	// Window mode scroll defines (for scroll-bar sub-node auto-source)
	if (hasWindowMode) {
		for (const node of sorted) {
			if (node.scrollMode !== 'window') continue;
			const safeName = sanitizeName(node.label);
			const interactiveSubs = getInteractiveSubNodes(node);
			lines.push(`define Flow_${safeName}_total_items = ${interactiveSubs.length};`);
			lines.push(`define Flow_${safeName}_visible = ${node.visibleCount ?? interactiveSubs.length};`);
		}
		lines.push(``);
	}

	const bm = graph.settings.buttonMapping;

	const hasBackButton = nodes.some((n) => n.backButton);
	const hasAnyBack = nodes.some((n) => n.backButton === '_ANY_BUTTON');

	// Variables
	lines.push(`// ===== VARIABLES =====`);
	lines.push(`int FlowCurrentState;`);
	lines.push(`int FlowPrevState = -1;`);
	lines.push(`int FlowStateTimer;`);
	lines.push(`int FlowRedraw = TRUE;`);
	lines.push(`int FlowEntered;`);
	if (hasBackButton) {
		lines.push(`int FlowStateStack[8];`);
		lines.push(`int FlowStackTop = 0;`);
	}
	if (hasAnyBack) {
		lines.push(`int FlowAnyPressed;`);
		lines.push(`int FlowAnyIdx;`);
	}
	if (hasWindowMode) {
		lines.push(`int _oled_y_off;`);
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
			lines.push(...generateVarDeclaration(v, profileCount));
		}
		lines.push(``);
	}

	// Per-node variables + auto cursor/scroll vars
	const declaredVars = new Set<string>([
		'FlowCurrentState',
		'FlowPrevState',
		'FlowStateTimer',
		...graph.globalVariables.map((v) => v.name)
	]);
	for (const node of sorted) {
		const safeName = sanitizeName(node.label);
		const interactiveSubs = getInteractiveSubNodes(node);

		if (node.variables.length > 0 || interactiveSubs.length > 0) {
			lines.push(`// Variables for ${node.label}`);
		}

		for (const v of node.variables) {
			if (!declaredVars.has(v.name)) {
				lines.push(...generateVarDeclaration(v, profileCount));
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
			// Auto-declare scroll variable for window mode
			if (node.scrollMode === 'window') {
				const scrollVar = `Flow_${safeName}_scroll`;
				if (!declaredVars.has(scrollVar)) {
					lines.push(`int ${scrollVar};`);
					declaredVars.add(scrollVar);
				}
			}
		}

		if (node.variables.length > 0 || interactiveSubs.length > 0) {
			lines.push(``);
		}

		// Auto-declare animation variables for animation sub-nodes
		const animSubs = node.subNodes.filter((s) => s.type === 'animation' && !s.hidden);
		if (animSubs.length > 0) {
			lines.push(`// Animation variables for ${node.label}`);
			for (const sub of animSubs) {
				const scenes = sub.config.scenes as unknown[];
				const frameCount = Array.isArray(scenes) ? scenes.length : 0;
				if (frameCount <= 1) continue;
				const timerVar = `Flow_${safeName}_animTimer`;
				const frameVar = `Flow_${safeName}_animFrame`;
				const prevFrameVar = `Flow_${safeName}_animPrevFrame`;
				const doneVar = `Flow_${safeName}_animDone`;
				if (!declaredVars.has(timerVar)) {
					lines.push(`int ${timerVar};`);
					declaredVars.add(timerVar);
				}
				if (!declaredVars.has(frameVar)) {
					lines.push(`int ${frameVar};`);
					declaredVars.add(frameVar);
				}
				if (!declaredVars.has(prevFrameVar)) {
					lines.push(`int ${prevFrameVar} = -1;`);
					declaredVars.add(prevFrameVar);
				}
				if (!declaredVars.has(doneVar)) {
					lines.push(`int ${doneVar};`);
					declaredVars.add(doneVar);
				}
				const delayTimerVar = `Flow_${safeName}_animDelay`;
				if (!declaredVars.has(delayTimerVar)) {
					lines.push(`int ${delayTimerVar};`);
					declaredVars.add(delayTimerVar);
				}
			}
			lines.push(``);
		}
	}

	// Global code
	if (graph.globalCode.trim()) {
		lines.push(`// ===== GLOBAL CODE =====`);
		lines.push(graph.globalCode.trim());
		lines.push(``);
	}

	// Pre-generate sub-node code to collect strings and images for top-level declarations
	const nodeSubNodeCode = new Map<string, string[]>();
	const nodeSubNodeInputCode = new Map<string, string[]>();
	const nodeStrings = new Map<string, string[]>();
	const nodeImages = new Map<string, string[]>();
	const nodesWithConditionalSubs = new Map<string, string[]>();

	for (const node of sorted) {
		if (node.subNodes.length === 0) continue;
		const safeName = sanitizeName(node.label);
		const sortedSubs = getSortedSubNodes(node).filter((s) => !s.hidden);
		const strings: string[] = [];
		const images: string[] = [];
		const stringArrayName = `FlowText_${safeName}`;
		const codeLines: string[] = [];
		const inputLines: string[] = [];
		let cursorIndex = 0;

		// Window mode info
		const isWindowMode = node.scrollMode === 'window';
		const windowScrollVar = isWindowMode ? `Flow_${safeName}_scroll` : '';
		const windowVisCount = isWindowMode ? (node.visibleCount ?? getInteractiveSubNodes(node).length) : 0;

		// Collect pixel-art sub-nodes to merge into a single const image
		// Conditional pixel-arts need separate images since they can't be statically composited
		const unconditionalPixelArts: { sub: SubNode; x: number; y: number }[] = [];
		const conditionalPixelArts: { sub: SubNode; x: number; y: number }[] = [];
		for (const sub of sortedSubs) {
			if (sub.type === 'pixel-art') {
				const pixelY = computeSubNodePixelY(node, sub);
				const pixelX = sub.position === 'absolute' ? (sub.x ?? 0) : node.stackOffsetX;
				if (sub.condition?.variable) {
					conditionalPixelArts.push({ sub, x: pixelX, y: pixelY });
				} else {
					unconditionalPixelArts.push({ sub, x: pixelX, y: pixelY });
				}
			}
		}

		// Merge unconditional pixel-art sub-nodes into one composite image
		if (unconditionalPixelArts.length > 0) {
			const composited = compositePixelArts(unconditionalPixelArts);
			if (composited) {
				const imageName = `Flow_${safeName}_img${images.length}`;
				images.push(
					`const image ${imageName} = {${composited.w}, ${composited.h},\n${composited.hexRows.join(',\n')}\n};`
				);
				codeLines.push(
					`    // Pixel Art (merged)\n    image_oled(${composited.x}, ${composited.y}, TRUE, TRUE, ${imageName}[0]);`
				);
			}
		}

		// Emit conditional pixel-art sub-nodes as separate images with if() guards
		for (const { sub, x, y } of conditionalPixelArts) {
			const composited = compositePixelArts([{ sub, x, y }]);
			if (composited) {
				const imageName = `Flow_${safeName}_img${images.length}`;
				images.push(
					`const image ${imageName} = {${composited.w}, ${composited.h},\n${composited.hexRows.join(',\n')}\n};`
				);
				const cond = sub.condition!;
				const condVar = profileVar(cond.variable);
				codeLines.push(
					`    // Pixel Art: ${sub.label} (conditional)\n    if(${condVar} ${cond.comparison} ${cond.value}) { image_oled(${composited.x}, ${composited.y}, TRUE, TRUE, ${imageName}[0]); }`
				);
			}
		}

		const pixelArtIds = new Set([...unconditionalPixelArts, ...conditionalPixelArts].map((p) => p.sub.id));

		for (const sub of sortedSubs) {
			if (pixelArtIds.has(sub.id)) continue; // already handled above

			const def = getSubNodeDef(sub.type);
			if (!def) continue;

			const pixelY = computeSubNodePixelY(node, sub);
			const pixelX = sub.position === 'absolute' ? (sub.x ?? 0) : node.stackOffsetX;

			// In window mode, interactive items get a runtime Y expression
			const effectiveY: number | string =
				isWindowMode && sub.interactive && sub.position !== 'absolute'
					? `(${pixelY} - _oled_y_off)`
					: pixelY;

			const ctx: SubNodeCodegenContext = {
				varPrefix: `Flow_${safeName}`,
				cursorVar: `Flow_${safeName}_cursor`,
				cursorIndex: sub.interactive ? cursorIndex : -1,
				x: pixelX,
				y: effectiveY,
				boundVariable: sub.boundVariable ? profileVar(sub.boundVariable) : undefined,
				buttons: bm,
				stringArrayName,
				strings,
				images,
			};

			const configWithLabel = { ...sub.config, label: sub.displayText ?? '' };
			const code = def.generateGpc(configWithLabel, ctx);
			if (code.trim()) {
				// Build code with optional condition guard
				const wrappedLines: string[] = [];
				if (sub.condition?.variable) {
					const cond = sub.condition;
					const condVar = profileVar(cond.variable);
					wrappedLines.push(`    if(${condVar} ${cond.comparison} ${cond.value}) {`);
					wrappedLines.push(code.replace(/^/gm, '    '));
					wrappedLines.push(`    }`);
				} else {
					wrappedLines.push(code);
				}

				// Wrap in window bounds check for interactive items in window mode
				if (isWindowMode && sub.interactive) {
					codeLines.push(`    if(${cursorIndex} >= ${windowScrollVar} && ${cursorIndex} < ${windowScrollVar} + ${windowVisCount}) {`);
					for (const line of wrappedLines) {
						codeLines.push(line.replace(/^/gm, '    '));
					}
					codeLines.push(`    }`);
				} else {
					codeLines.push(...wrappedLines);
				}
			}

			// Collect input-handling code (runs every cycle, separate from rendering)
			if (def.generateGpcInput) {
				const inputCode = def.generateGpcInput(configWithLabel, ctx);
				if (inputCode.trim()) {
					if (sub.condition?.variable) {
						const cond = sub.condition;
						const condVar = profileVar(cond.variable);
						inputLines.push(`    if(${condVar} ${cond.comparison} ${cond.value}) {`);
						inputLines.push(inputCode.replace(/^/gm, '    '));
						inputLines.push(`    }`);
					} else {
						inputLines.push(inputCode);
					}
				}
			}

			if (sub.interactive) cursorIndex++;
		}

		nodeSubNodeCode.set(node.id, codeLines);
		nodeSubNodeInputCode.set(node.id, inputLines);
		nodeStrings.set(node.id, strings);
		nodeImages.set(node.id, images);
		const condVars = new Set<string>();
		for (const s of sortedSubs) {
			if (s.condition?.variable) condVars.add(profileVar(s.condition.variable));
		}
		if (condVars.size > 0) {
			nodesWithConditionalSubs.set(node.id, [...condVars]);
		}
	}

	// Emit shadow variables for conditional sub-node change detection
	const allCondVarNames = new Set<string>();
	for (const vars of nodesWithConditionalSubs.values()) {
		for (const cv of vars) allCondVarNames.add(cv);
	}
	if (allCondVarNames.size > 0) {
		lines.push(`// Conditional sub-node tracking`);
		for (const cv of allCondVarNames) {
			const prevVar = `_prev_${cv.replace(/\[.*\]/, '')}`;
			lines.push(`int ${prevVar};`);
		}
		lines.push(``);
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

	// Emit const image declarations for pixel-art sub-nodes
	let hasImageDecls = false;
	for (const node of sorted) {
		const images = nodeImages.get(node.id);
		if (images && images.length > 0) {
			if (!hasImageDecls) {
				lines.push(`// ===== IMAGE DATA =====`);
				hasImageDecls = true;
			}
			for (const decl of images) {
				lines.push(decl);
			}
		}
	}
	if (hasImageDecls) lines.push(``);

	// OLED draw functions (legacy: nodes with oledScene but no sub-nodes)
	// Emit legacy scene image declarations before any function defs
	for (const node of sorted) {
		if (node.oledScene && node.subNodes.length === 0) {
			const { declaration, fn: _fn } = generateOledDrawFunction(node);
			if (declaration) {
				lines.push(declaration);
				lines.push(``);
			}
		}
	}

	// Imports for common helpers (after all const declarations, since imports contain functions)
	lines.push(`import common/helper;`);
	lines.push(`import common/oled;`);
	if (hasPersistence) {
		lines.push(`import common/bitpack;`);
	}
	lines.push(``);

	// OLED draw function bodies
	for (const node of sorted) {
		if (node.oledScene && node.subNodes.length === 0) {
			const { fn } = generateOledDrawFunction(node);
			lines.push(`// ===== DRAW: ${node.label} =====`);
			lines.push(fn);
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

		// Block all inputs (prevent button presses from reaching the console)
		if (node.blockInputs) {
			lines.push(`    block_all_inputs();`);
		}

		// Collect animation sub-nodes for this node
		const animSubs = node.subNodes.filter((s) => s.type === 'animation' && !s.hidden);
		const hasMultiFrameAnim = animSubs.some((s) => {
			const scenes = s.config.scenes as unknown[];
			return Array.isArray(scenes) && scenes.length > 1;
		});

		// onEnter logic (runs once when entering state)
		if (node.onEnter.trim() || hasMultiFrameAnim) {
			lines.push(`    // On enter`);
			lines.push(`    if(FlowEntered) {`);
			lines.push(`        FlowEntered = FALSE;`);
			if (node.onEnter.trim()) {
				for (const line of node.onEnter.trim().split('\n')) {
					lines.push(`        ${line.trim()}`);
				}
			}
			// Reset animation timers
			if (hasMultiFrameAnim) {
				lines.push(`        // Reset animation`);
				lines.push(`        Flow_${safeName}_animTimer = 0;`);
				lines.push(`        Flow_${safeName}_animFrame = 0;`);
				lines.push(`        Flow_${safeName}_animPrevFrame = -1;`);
				lines.push(`        Flow_${safeName}_animDone = FALSE;`);
				lines.push(`        Flow_${safeName}_animDelay = 0;`);
			}
			lines.push(`    }`);
		}

		// Animation timer advancement (runs every cycle, outside FlowRedraw)
		if (hasMultiFrameAnim) {
			const animSub = animSubs.find((s) => {
				const scenes = s.config.scenes as unknown[];
				return Array.isArray(scenes) && scenes.length > 1;
			})!;
			const frameDelayMs = (animSub.config.frameDelayMs as number) || 100;
			const loop = animSub.config.loop !== false;
			const scenes = animSub.config.scenes as unknown[];
			const frameCount = scenes.length;
			const timerVar = `Flow_${safeName}_animTimer`;
			const frameVar = `Flow_${safeName}_animFrame`;
			const prevFrameVar = `Flow_${safeName}_animPrevFrame`;
			const doneVar = `Flow_${safeName}_animDone`;

			lines.push(``);
			lines.push(`    // Animation timing`);
			if (loop) {
				lines.push(`    ${frameVar} = (${timerVar} / ${frameDelayMs}) % ${frameCount};`);
			} else {
				lines.push(`    ${frameVar} = ${timerVar} / ${frameDelayMs};`);
				lines.push(`    if(${frameVar} >= ${frameCount}) { ${frameVar} = ${frameCount - 1}; ${doneVar} = TRUE; }`);
			}
			lines.push(`    if(${frameVar} != ${prevFrameVar}) { ${prevFrameVar} = ${frameVar}; FlowRedraw = TRUE; }`);
			if (!loop) {
				lines.push(`    if(!${doneVar}) { ${timerVar} = ${timerVar} + get_rtime(); }`);
				// After done, advance delay timer for transition delay
				const delayTimerVar = `Flow_${safeName}_animDelay`;
				lines.push(`    if(${doneVar}) { ${delayTimerVar} = ${delayTimerVar} + get_rtime(); }`);
			} else {
				lines.push(`    ${timerVar} = ${timerVar} + get_rtime();`);
			}
		}

		if (hasSubNodes) {
			// === V2: Sub-node based rendering ===

			// Cursor navigation logic (runs every cycle, sets FlowRedraw)
			if (interactiveSubs.length > 0) {
				const cursorVar = `Flow_${safeName}_cursor`;
				const maxCursor = interactiveSubs.length - 1;
				lines.push(``);
				lines.push(`    // Cursor navigation`);
				if (node.scrollMode === 'wrap') {
					lines.push(`    if(event_press(${bm.up})) { if(${cursorVar} > 0) ${cursorVar} = ${cursorVar} - 1; else ${cursorVar} = ${maxCursor}; FlowRedraw = TRUE; }`);
					lines.push(`    if(event_press(${bm.down})) { if(${cursorVar} < ${maxCursor}) ${cursorVar} = ${cursorVar} + 1; else ${cursorVar} = 0; FlowRedraw = TRUE; }`);
				} else if (node.scrollMode === 'window') {
					const visCount = node.visibleCount ?? interactiveSubs.length;
					const scrollVar = `Flow_${safeName}_scroll`;
					lines.push(`    if(event_press(${bm.up}) && ${cursorVar} > 0) { ${cursorVar} = ${cursorVar} - 1; FlowRedraw = TRUE; }`);
					lines.push(`    if(event_press(${bm.down}) && ${cursorVar} < ${maxCursor}) { ${cursorVar} = ${cursorVar} + 1; FlowRedraw = TRUE; }`);
					lines.push(`    // Window scrolling`);
					lines.push(`    if(${cursorVar} < ${scrollVar}) ${scrollVar} = ${cursorVar};`);
					lines.push(`    if(${cursorVar} >= ${scrollVar} + ${visCount}) ${scrollVar} = ${cursorVar} - ${visCount} + 1;`);
				} else {
					lines.push(`    if(event_press(${bm.up}) && ${cursorVar} > 0) { ${cursorVar} = ${cursorVar} - 1; FlowRedraw = TRUE; }`);
					lines.push(`    if(event_press(${bm.down}) && ${cursorVar} < ${maxCursor}) { ${cursorVar} = ${cursorVar} + 1; FlowRedraw = TRUE; }`);
				}

				// Toggle interaction (confirm toggles the bound variable)
				for (let i = 0; i < interactiveSubs.length; i++) {
					const sub = interactiveSubs[i];
					if (sub.type === 'toggle-item' && sub.boundVariable) {
						const bv = profileVar(sub.boundVariable);
						lines.push(`    if(${cursorVar} == ${i} && event_press(${bm.confirm})) { ${bv} = !${bv}; FlowRedraw = TRUE; }`);
					}
				}
			}

			// Sub-node input handling (value adjust, array cycling — runs every cycle)
			const inputCode = nodeSubNodeInputCode.get(node.id);
			if (inputCode && inputCode.length > 0) {
				lines.push(``);
				for (const code of inputCode) {
					lines.push(code);
				}
			}

			// Detect condition variable changes → set FlowRedraw
			const condVars = nodesWithConditionalSubs.get(node.id);
			if (condVars && condVars.length > 0) {
				lines.push(``);
				lines.push(`    // Check if conditional variables changed`);
				for (const cv of condVars) {
					const prevVar = `_prev_${cv.replace(/\[.*\]/, '')}`;
					lines.push(`    if(${cv} != ${prevVar}) { ${prevVar} = ${cv}; FlowRedraw = TRUE; }`);
				}
			}

			// Rendering (only when dirty)
			lines.push(``);
			lines.push(`    // Render`);
			lines.push(`    if(FlowRedraw) {`);
			lines.push(`        FlowRedraw = FALSE;`);
			lines.push(`        cls_oled(OLED_BLACK);`);

			// Compute scroll Y offset for window mode
			if (node.scrollMode === 'window') {
				const margin = node.lineMargin ?? 0;
				const itemStep = 8 + margin;
				lines.push(`        _oled_y_off = Flow_${safeName}_scroll * ${itemStep};`);
			}

			const subCode = nodeSubNodeCode.get(node.id);
			if (subCode) {
				for (const code of subCode) {
					// Indent sub-node code by one extra level inside the if block
					lines.push(code.replace(/^    /gm, '        '));
				}
			}

			lines.push(`    }`);
		} else {
			// === Legacy: raw code + OLED scene ===
			if (node.oledScene) {
				lines.push(`    if(FlowRedraw) {`);
				lines.push(`        FlowRedraw = FALSE;`);
				lines.push(`        Draw_Flow_${safeName}();`);
				lines.push(`    }`);
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
			if (node.backButton === '_ANY_BUTTON') {
				// Any button press triggers back navigation
				lines.push(`    // Back (any button)`);
				lines.push(`    FlowAnyPressed = FALSE;`);
				lines.push(`    for(FlowAnyIdx = 0; FlowAnyIdx <= 24; FlowAnyIdx++) {`);
				lines.push(`        if(event_press(FlowAnyIdx)) { FlowAnyPressed = TRUE; }`);
				lines.push(`    }`);
				lines.push(`    if(FlowAnyPressed && FlowStackTop > 0) {`);
			} else {
				lines.push(`    // Back button`);
				lines.push(`    if(event_press(${node.backButton}) && FlowStackTop > 0) {`);
			}
			if (node.onExit.trim()) {
				for (const line of node.onExit.trim().split('\n')) {
					lines.push(`        ${line.trim()}`);
				}
			}
			if (wantsPersistence) {
				lines.push(`        Flow_Save();`);
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
				const condition = generateConditionCode(edge, node);

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
	// Per-node init code (e.g. VM speed setup that must run at startup)
	for (const node of sorted) {
		const code = (node.initCode ?? '').trim();
		if (code) {
			lines.push(`    // Init: ${node.label}`);
			for (const line of code.split('\n')) {
				lines.push(`    ${line}`);
			}
		}
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
	lines.push(`    // State change detection`);
	lines.push(`    if(FlowCurrentState != FlowPrevState) {`);
	lines.push(`        FlowStateTimer = 0;`);
	lines.push(`        FlowPrevState = FlowCurrentState;`);
	lines.push(`        FlowRedraw = TRUE;`);
	lines.push(`        FlowEntered = TRUE;`);
	lines.push(`    }`);
	lines.push(`    FlowStateTimer = FlowStateTimer + get_rtime();`);
	lines.push(`}`);

	return lines.join('\n');
}

// ==================== Helpers ====================

function getInteractiveSubNodes(node: FlowNode): SubNode[] {
	return getSortedSubNodes(node).filter((sn) => sn.interactive && !sn.hidden);
}

function generateVarDeclaration(v: FlowVariable, profileCount: number = 0): string[] {
	// Per-profile variables become arrays when multiple profiles exist
	if (v.perProfile && profileCount > 1 && v.type !== 'string') {
		const lines = [`${v.type} ${v.name}[${profileCount}];`];
		for (let i = 0; i < profileCount; i++) {
			lines.push(`${v.name}[${i}] = ${v.defaultValue};`);
		}
		return lines;
	}
	if (v.type === 'string') {
		const size = v.arraySize ?? 32;
		const defaultStr = typeof v.defaultValue === 'string' ? v.defaultValue : '';
		if (defaultStr) {
			const chars = Array.from(defaultStr).map((c) => c.charCodeAt(0));
			chars.push(0);
			while (chars.length < size) chars.push(0);
			const lines = [`int8 ${v.name}[${size}];`];
			for (let i = 0; i < size; i++) {
				lines.push(`${v.name}[${i}] = ${chars[i]};`);
			}
			return lines;
		}
		return [`int8 ${v.name}[${size}];`];
	}
	return [`${v.type} ${v.name} = ${v.defaultValue};`];
}

function sanitizeName(name: string): string {
	return name
		.replace(/[^a-zA-Z0-9_]/g, '_')
		.replace(/^[0-9]/, '_$&')
		.replace(/_+/g, '_');
}

function generateConditionCode(edge: FlowEdge, sourceNode?: FlowNode): string | null {
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
		case 'animation_end': {
			if (!sourceNode) return null;
			const safeSrcName = sanitizeName(sourceNode.label);
			const doneVar = `Flow_${safeSrcName}_animDone`;
			const delayMs = c.delayMs ?? 0;
			if (delayMs > 0) {
				const delayTimerVar = `Flow_${safeSrcName}_animDelay`;
				result = `${doneVar} && ${delayTimerVar} > ${delayMs}`;
			} else {
				result = doneVar;
			}
			break;
		}
		default:
			return null;
	}

	if (result && modChecks.length > 0) {
		return [...modChecks, result].join(' && ');
	}
	return result;
}

function generateOledDrawFunction(node: FlowNode): { declaration: string; fn: string } {
	const safeName = sanitizeName(node.label);
	const fnLines: string[] = [];
	let declaration = '';

	fnLines.push(`function Draw_Flow_${safeName}() {`);
	fnLines.push(`    cls_oled(OLED_BLACK);`);

	if (node.oledScene) {
		try {
			const binaryStr = atob(node.oledScene.pixels);
			const bytes = new Uint8Array(binaryStr.length);
			for (let i = 0; i < binaryStr.length; i++) {
				bytes[i] = binaryStr.charCodeAt(i);
			}

			// Pack into const image format (row-major, MSB-first)
			const packed: number[] = [];
			let currentByte = 0;
			let bit = 0;
			for (let y = 0; y < 64; y++) {
				for (let x = 0; x < 128; x++) {
					currentByte <<= 1;
					const byteIdx = y * 16 + Math.floor(x / 8);
					const bitIdx = 7 - (x % 8);
					if (byteIdx < bytes.length && (bytes[byteIdx] & (1 << bitIdx)) !== 0) {
						currentByte |= 1;
					}
					bit++;
					if (bit === 8) {
						packed.push(currentByte);
						currentByte = 0;
						bit = 0;
					}
				}
			}
			if (bit > 0) {
				packed.push(currentByte << (8 - bit));
			}

			const imageName = `Flow_Scene_${safeName}`;
			const hexRows: string[] = [];
			for (let i = 0; i < packed.length; i += 16) {
				const row = packed
					.slice(i, Math.min(i + 16, packed.length))
					.map((b) => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`)
					.join(', ');
				hexRows.push(`    ${row}`);
			}
			declaration = `const image ${imageName} = {128, 64,\n${hexRows.join(',\n')}\n};`;
			fnLines.push(`    image_oled(0, 0, TRUE, TRUE, ${imageName}[0]);`);
		} catch {
			fnLines.push(`    // Error decoding OLED scene data`);
		}
	}

	fnLines.push(`}`);
	return { declaration, fn: fnLines.join('\n') };
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

