import type { FlowGraph, FlowNode, FlowVariable, WeaponADTProfile, WeaponDefaultsConfig } from '$lib/types/flow';
import type { KeyMapping } from '$lib/utils/keyboard-parser';
import {
	collectPersistVars,
	flowVarsToPersistVars,
	generateBitpackPersistence,
	type PersistVar,
} from './codegen';

/**
 * Result of gameplay code generation — kept separate for merging.
 */
export interface GameplayCodegenResult {
	defines: string[];
	variables: string[];
	combos: string[];
	initCode: string[];
	mainLoopCode: string[];
	functions: string[];
	/** Separate file contents that should be written alongside main.gpc */
	extraFiles: Record<string, string>;
}

/**
 * Helper to read mainCode from a module node, falling back to triggerCode for migration.
 */
function getMainCode(md: { mainCode?: string; triggerCode?: string }): string {
	return md.mainCode || md.triggerCode || '';
}

/**
 * Generate GPC code fragments from a gameplay flow graph.
 *
 * Each module node produces code in up to 4 sections:
 *   - initCode → runs once in init {}
 *   - mainCode → runs every frame in main {}, guarded by enable variable
 *   - functionsCode → function definitions, constants, defines
 *   - comboCode → combo blocks
 */
export function generateGameplayGpc(graph: FlowGraph, allFlowModuleNodes?: FlowNode[]): GameplayCodegenResult {
	const result: GameplayCodegenResult = {
		defines: [],
		variables: [],
		combos: [],
		initCode: [],
		mainLoopCode: [],
		functions: [],
		extraFiles: {},
	};

	const moduleNodes = graph.nodes.filter((n) => n.type === 'module' && n.moduleData);
	if (moduleNodes.length === 0 && graph.nodes.filter((n) => n.type === 'custom').length === 0)
		return result;

	const declaredVars = new Set<string>();

	for (const node of moduleNodes) {
		const md = node.moduleData!;
		const safeName = sanitizeName(md.moduleId);

		// Weapon data defines + array (weapondata module only)
		if (md.moduleId === 'weapondata') {
			const names = md.weaponNames ?? [];
			const count = names.length;
			result.defines.push(`define WEAPON_COUNT = ${count};`);
			result.defines.push(`define WEAPON_MAX_INDEX = ${Math.max(count - 1, 0)};`);
			if (count > 0) {
				const quoted = names.map((w) => `"${w}"`).join(', ');
				result.functions.push(`// Weapon names`);
				result.functions.push(`const string Weapons[] = { ${quoted} };`);
				result.functions.push('');

				// Generate recoiltable.gpc as a separate file if any module needs it
				// Check across all flows (not just the current one) for antirecoil_timeline
				const searchNodes = allFlowModuleNodes ?? moduleNodes;
				const needsRecoilTable = searchNodes.some(
					(n) => n.moduleData?.moduleId === 'antirecoil_timeline'
				);
				if (needsRecoilTable) {
					result.functions.push(`// Weapon recoil table — loaded from recoiltable.gpc`);
					result.functions.push(`#include "recoiltable.gpc"`);
					result.functions.push('');

					// Generate separate recoiltable.gpc file content
					const rtLines: string[] = [];
					rtLines.push(`// Weapon recoil table (10 phases x 2 axes per weapon)`);
					rtLines.push(`// Edit values in the Flow Editor Weapon Data panel`);
					const rv = md.weaponRecoilValues ?? [];
					const rows = names.map((w, i) => {
						// Use stored V/H as base for phase 0, zeros for rest
						const v = rv[i * 2] ?? 0;
						const h = rv[i * 2 + 1] ?? 0;
						const vals = [` ${v}`, ` ${h}`, ...Array(18).fill(' 0')].join(',');
						return `    {${vals}} ${i < count - 1 ? ',' : ' '} /* ${String(i).padStart(4)} ${w} */`;
					});
					rtLines.push(`const int8 WeaponRecoilTable[][] = {`);
					rtLines.push(`//  V0  H0  V1  H1  V2  H2  V3  H3  V4  H4  V5  H5  V6  H6  V7  H7  V8  H8  V9  H9`);
					rtLines.push(...rows);
					rtLines.push(`};`);
					result.extraFiles['recoiltable.gpc'] = rtLines.join('\n');
				}
			}
		}

		// Variables: enable + options + extras
		for (const v of node.variables) {
			if (!declaredVars.has(v.name)) {
				result.variables.push(generateVarDecl(v));
				declaredVars.add(v.name);
			}
		}

		// Extra vars from module definition
		for (const [name, type] of Object.entries(md.extraVars)) {
			if (!declaredVars.has(name)) {
				result.variables.push(formatExtraVar(name, type));
				declaredVars.add(name);
			}
		}

		// Button param defines
		if (md.params) {
			for (const [key, value] of Object.entries(md.params)) {
				const defineName = `${md.moduleId.toUpperCase()}_${key.toUpperCase()}`;
				result.defines.push(`define ${defineName} = ${value};`);
			}
		}

		// Init code
		const initCode = (md.initCode ?? '').trim();
		if (initCode) {
			result.initCode.push(`    // Init: ${md.moduleName}`);
			for (const line of initCode.split('\n')) {
				result.initCode.push(`    ${line}`);
			}
		}

		// Functions code (includes function defs, const arrays, defines)
		const functionsCode = (md.functionsCode ?? '').trim();
		if (functionsCode) {
			result.functions.push(`// Functions: ${md.moduleName}`);
			result.functions.push(functionsCode);
			result.functions.push('');
		}

		// Combo code — for keyboard modules, generate from structured mappings;
		// for ADP modules, generate ADP_Values table and inject adt_cmp checks
		let generatedCombo: string;
		if (Array.isArray(md.keyboardMappings)) {
			generatedCombo = generateApplyKeyboard(md.keyboardMappings);
		} else if (md.moduleId === 'adp' && md.adpProfiles?.length) {
			const weaponNames = moduleNodes
				.find((n) => n.moduleData?.moduleId === 'weapondata')
				?.moduleData?.weaponNames ?? [];
			result.functions.push(generateAdpValuesTable(md.adpProfiles, weaponNames));
			result.functions.push('');
			generatedCombo = injectAdpChecks(md.comboCode.trim(), md.adpProfiles, weaponNames);
		} else {
			generatedCombo = md.comboCode.trim();
		}
		if (generatedCombo) {
			result.combos.push(`// Combo: ${md.moduleName}`);
			result.combos.push(generatedCombo);
			result.combos.push('');
		}

		// Quick toggle: button combo or keyboard key to toggle enable variable
		// (skipped for alwaysActive modules — they have no enable toggle)
		const qt = md.quickToggle ?? [];
		if (!md.alwaysActive && qt.length > 0 && md.enableVariable) {
			const isKb = qt[0].startsWith('KEY_');
			result.mainLoopCode.push(`    // Quick Toggle: ${md.moduleName}`);
			if (isKb) {
				const delayVar = `_qt_delay_${safeName}`;
				if (!declaredVars.has(delayVar)) {
					result.variables.push(`int ${delayVar};`);
					declaredVars.add(delayVar);
				}
				result.mainLoopCode.push(`    if(GetKeyboardKey(${qt[0]}) && ${delayVar} <= 0) { ${md.enableVariable} = !${md.enableVariable}; ${delayVar} = 30; FlowRedraw = TRUE; }`);
				result.mainLoopCode.push(`    if(${delayVar} > 0) { ${delayVar}--; }`);
			} else {
				const toggleExpr =
					qt.length === 1
						? `event_press(${qt[0]})`
						: `get_val(${qt[0]}) && event_press(${qt[1]})`;
				result.mainLoopCode.push(`    if(${toggleExpr}) { ${md.enableVariable} = !${md.enableVariable}; FlowRedraw = TRUE; }`);
			}
		}

		// Main loop: trigger code guarded by enable variable
		const enableVar = md.enableVariable;
		const mainCode = getMainCode(md).trim();

		result.mainLoopCode.push(`    // ${md.moduleName}`);
		if (mainCode) {
			const dedented = dedentBlock(mainCode);
			if (md.alwaysActive) {
				// Always-active modules run unguarded
				for (const line of dedented.split('\n')) {
					result.mainLoopCode.push(`    ${line}`);
				}
			} else {
				// Full code block — guarded by enable variable
				result.mainLoopCode.push(`    if(${enableVar}) {`);
				for (const line of dedented.split('\n')) {
					result.mainLoopCode.push(`        ${line}`);
				}
				result.mainLoopCode.push(`    }`);
			}
		} else if (!md.alwaysActive) {
			// No main code — just guard combo with enable var
			const comboName = extractComboName(md.comboCode);
			if (comboName) {
				result.mainLoopCode.push(`    if(${enableVar}) combo_run(${comboName});`);
			}
		}
	}

	// Also include custom nodes' code
	const customNodes = graph.nodes.filter((n) => n.type === 'custom');
	for (const node of customNodes) {
		for (const v of node.variables) {
			if (!declaredVars.has(v.name)) {
				result.variables.push(generateVarDecl(v));
				declaredVars.add(v.name);
			}
		}
		if (node.gpcCode.trim()) {
			result.mainLoopCode.push(`    // Custom: ${node.label}`);
			for (const line of node.gpcCode.trim().split('\n')) {
				result.mainLoopCode.push(`    ${line}`);
			}
		}
		if (node.comboCode.trim()) {
			result.combos.push(`// Custom combo: ${node.label}`);
			result.combos.push(node.comboCode.trim());
			result.combos.push('');
		}
	}

	return result;
}

/**
 * Generate a standalone GPC script from gameplay flow only.
 * Includes bitpack persistence for module options with persist: true.
 */
export function generateGameplayGpcStandalone(graph: FlowGraph): string {
	const result = generateGameplayGpc(graph);
	const lines: string[] = [];

	// Collect persist vars from gameplay modules
	const persistVars = collectGameplayPersistVars(graph);

	lines.push(`// ====================================================`);
	lines.push(`// Gameplay Flow: ${graph.name}`);
	lines.push(`// Generated by ZenForge Flow Editor`);
	lines.push(`// ====================================================`);
	lines.push('');

	// Imports for common helpers
	lines.push(`import common/helper;`);
	lines.push(`import common/oled;`);
	if (persistVars.length > 0) {
		lines.push(`import common/bitpack;`);
	}
	lines.push('');

	if (result.defines.length > 0) {
		lines.push(`// ===== DEFINES =====`);
		lines.push(...result.defines);
		lines.push('');
	}

	if (result.variables.length > 0) {
		lines.push(`// ===== VARIABLES =====`);
		lines.push(...result.variables);
		lines.push('');
	}

	if (result.functions.length > 0) {
		lines.push(`// ===== FUNCTIONS =====`);
		lines.push(...result.functions);
		lines.push('');
	}

	if (result.combos.length > 0) {
		lines.push(`// ===== COMBOS =====`);
		lines.push(...result.combos);
	}

	// Persistence (bitpack-based, SPVAR_5+)
	if (persistVars.length > 0) {
		lines.push(`// ===== PERSISTENCE =====`);
		lines.push(generateBitpackPersistence(persistVars));
		lines.push('');
	}

	lines.push(`// ===== INIT =====`);
	lines.push(`init {`);
	if (result.initCode.length > 0) {
		lines.push(...result.initCode);
	}
	if (persistVars.length > 0) {
		lines.push(`    Flow_Load();`);
	}
	lines.push(`}`);
	lines.push('');

	lines.push(`// ===== MAIN =====`);
	lines.push(`main {`);
	if (result.mainLoopCode.length > 0) {
		lines.push(...result.mainLoopCode);
	}
	lines.push(`}`);

	return lines.join('\n');
}

/**
 * Collect persist vars from a gameplay flow graph.
 * Includes module options + Weapons_RecoilValues when applicable.
 */
function collectGameplayPersistVars(graph: FlowGraph): PersistVar[] {
	const persistFlowVars = collectPersistVars(graph);
	const result = flowVarsToPersistVars(persistFlowVars, 0);
	const seen = new Set(result.map((v) => v.name));

	// Weapons_RecoilValues persistence: basic/decay use full array, timeline uses sparse
	const hasWeapondata = graph.nodes.some((n) => n.moduleData?.moduleId === 'weapondata');
	const hasBasicDecayRecoil = graph.nodes.some(
		(n) =>
			n.moduleData?.needsWeapondata &&
			n.moduleData.moduleId !== 'weapondata' &&
			n.moduleData.moduleId !== 'antirecoil_timeline'
	);
	const hasTimeline = graph.nodes.some((n) => n.moduleData?.moduleId === 'antirecoil_timeline');

	if (hasWeapondata && (hasBasicDecayRecoil || hasTimeline) && !seen.has('Weapons_RecoilValues')) {
		if (hasBasicDecayRecoil) {
			// Full persistence — every weapon V/H value is user-set
			result.push({
				name: 'Weapons_RecoilValues',
				min: -100,
				max: 100,
				defaultValue: 0,
				arrayLoop: {
					countExpr: 'WEAPON_COUNT * 2',
					indexVar: '_bp_loop_i',
				},
			});
		} else {
			// Sparse persistence — timeline V/H are offsets, most stay at 0
			result.push({
				name: 'Weapons_RecoilValues',
				min: -100,
				max: 100,
				defaultValue: 0,
				sparseArray: {
					countExpr: 'WEAPON_COUNT',
					maxCount: 'WEAPON_COUNT',
					indexVar: '_bp_loop_i',
					countVar: '_bp_sparse_count',
					stride: 2,
				},
			});
		}
	}

	return result;
}

// ==================== Helpers ====================

/** Remove common leading whitespace from a multi-line code block, preserving relative indentation */
function dedentBlock(code: string): string {
	const lines = code.split('\n');
	const nonEmpty = lines.filter((l) => l.trim().length > 0);
	if (nonEmpty.length === 0) return code;
	const minIndent = Math.min(
		...nonEmpty.map((l) => {
			const match = l.match(/^(\s*)/);
			return match ? match[1].length : 0;
		})
	);
	if (minIndent === 0) return code;
	return lines.map((l) => l.slice(minIndent)).join('\n');
}

function sanitizeName(name: string): string {
	return name
		.replace(/[^a-zA-Z0-9_]/g, '_')
		.replace(/^[0-9]/, '_$&')
		.replace(/_+/g, '_');
}

function generateVarDecl(v: FlowVariable): string {
	if (v.type === 'string') {
		const size = v.arraySize ?? 32;
		return `int8 ${v.name}[${size}];`;
	}
	const gpcType = v.type === 'bool' ? 'int' : v.type;
	const profile = v.perProfile ? ' [profile]' : '';
	return `${gpcType} ${v.name}${profile} = ${v.defaultValue};`;
}

/**
 * Extract the combo name from a combo code block.
 * Looks for `combo <name> {` pattern.
 */
/**
 * Format an extra_vars entry into a valid GPC declaration.
 * Handles: "int", "int [profile]", "int [216]", "int = -1"
 * Produces: "int Name;", "int Name [profile];", "int Name[216];", "int Name = -1;"
 */
function formatExtraVar(name: string, type: string): string {
	const arrayMatch = type.match(/^(\w+)\s*\[(.+)\]$/);
	if (arrayMatch) {
		const baseType = arrayMatch[1];
		const size = arrayMatch[2].trim();
		if (size === 'profile') {
			return `${baseType} ${name} [profile];`;
		}
		return `${baseType} ${name}[${size}];`;
	}
	const defaultMatch = type.match(/^(\w+)\s*=\s*(.+)$/);
	if (defaultMatch) {
		return `${defaultMatch[1]} ${name} = ${defaultMatch[2].trim()};`;
	}
	return `${type} ${name};`;
}

function extractComboName(comboCode: string): string | null {
	const match = comboCode.match(/combo\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
	return match ? match[1] : null;
}

/**
 * Generate an ApplyKeyboard() function from structured KeyMapping[] data.
 * Called at build time — the keyboard module stores mappings as data, not code.
 */
function generateApplyKeyboard(mappings: KeyMapping[]): string {
	const lines: string[] = ['function ApplyKeyboard() {'];
	const enabled = mappings.filter((m) => m.enabled);

	if (enabled.length === 0) {
		lines.push('    // No mappings configured');
	} else {
		const kb = enabled.filter((m) => m.type === 'keyboard');
		const singleCtrl = enabled.filter((m) => m.type === 'controller' && !m.sourceCombo);
		const comboCtrl = enabled.filter((m) => m.type === 'controller' && m.sourceCombo);
		const comboMappings = enabled.filter((m) => m.type === 'combo');

		if (kb.length > 0) {
			for (const m of kb) {
				lines.push(`    if (GetKeyboardKey(${m.source})) { set_val(${m.target}, ${m.value}); }`);
			}
		}
		if (singleCtrl.length > 0) {
			for (const m of singleCtrl) {
				if (m.value === 0) {
					lines.push(`    set_val(${m.target}, get_val(${m.source}));`);
				} else {
					lines.push(`    if (get_val(${m.source})) { set_val(${m.target}, ${m.value}); }`);
				}
			}
		}
		if (comboCtrl.length > 0) {
			for (const m of comboCtrl) {
				lines.push(`    if (get_val(${m.sourceCombo}) && event_press(${m.source})) { set_val(${m.target}, ${m.value}); }`);
			}
		}
		if (comboMappings.length > 0) {
			for (const m of comboMappings) {
				if (m.comboMode === 'hold') {
					lines.push(`    if (GetKeyboardKey(${m.source})) { combo_run(${m.target}); } else { combo_stop(${m.target}); }`);
				} else {
					lines.push(`    if (GetKeyboardKey(${m.source})) { combo_run(${m.target}); }`);
				}
			}
		}
	}

	lines.push('}');
	return lines.join('\n');
}

/** Format a number as 0x hex string */
function toHex(v: number): string {
	return '0x' + ((v & 0xff).toString(16).toUpperCase().padStart(2, '0'));
}

/**
 * Generate the ADP_Values[][] const table from stored ADT profiles.
 * Format: Mode, Start, F1, F2, StrLow, StrMid, StrHigh, 0, 0, Freq, 0
 */
function generateAdpValuesTable(profiles: WeaponADTProfile[], weaponNames: string[]): string {
	const lines: string[] = [];
	lines.push('// Adaptive trigger signatures per weapon');
	lines.push('// Format: Mode, Start, F1, F2, StrLow, StrMid, StrHigh, 0, 0, Freq, 0');
	lines.push('const uint8 ADP_Values[][] = {');
	lines.push('//   Mode  Start  F1    F2   StrL  StrM  StrH   0  0  Freq  0');

	// Row 0: Automatic (no match)
	lines.push('    { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0, 0, 0x00, 0 },  // 0: Automatic');

	const totalWeapons = weaponNames.length;
	for (let i = 0; i < totalWeapons; i++) {
		const idx = i + 1;
		const p = profiles.find((pr) => pr.weaponIndex === idx);
		const m = p?.mode ?? 0;
		const s = p?.start ?? 0;
		const f1 = p?.force1 ?? 0;
		const f2 = p?.force2 ?? 0;
		const sl = p?.strLow ?? 0;
		const sm = p?.strMid ?? 0;
		const sh = p?.strHigh ?? 0;
		const fr = p?.freq ?? 0;
		const comma = i < totalWeapons - 1 ? ',' : ' ';
		const name = weaponNames[i] ?? `Weapon ${idx}`;
		lines.push(`    { ${toHex(m)}, ${toHex(s)}, ${toHex(f1)}, ${toHex(f2)}, ${toHex(sl)}, ${toHex(sm)}, ${toHex(sh)}, 0, 0, ${toHex(fr)}, 0 }${comma}  // ${idx}: ${name}`);
	}

	lines.push('};');
	return lines.join('\n');
}

/**
 * Replace the // INJECT_ADP_CHECKS_HERE marker in the ADP combo code
 * with adt_cmp() checks referencing the ADP_Values table.
 */
function injectAdpChecks(comboCode: string, profiles: WeaponADTProfile[], weaponNames: string[]): string {
	const checks: string[] = [];

	for (const p of profiles) {
		const isEmpty = p.mode === 0 && p.start === 0 && p.force1 === 0 && p.force2 === 0
			&& (p.strLow ?? 0) === 0 && (p.strMid ?? 0) === 0 && (p.strHigh ?? 0) === 0 && p.freq === 0;
		if (isEmpty) continue;

		const name = weaponNames[p.weaponIndex - 1] ?? `Weapon ${p.weaponIndex}`;
		const keyword = checks.length === 0 ? 'if' : 'else if';
		checks.push(`    ${keyword} (adt_cmp(PS5_R2, addr(ADP_Values[${p.weaponIndex}][0]))) { detected = ${p.weaponIndex}; }  // ${name}`);
	}

	if (checks.length === 0) return comboCode;
	return comboCode.replace('// INJECT_ADP_CHECKS_HERE', checks.join('\n'));
}

// ==================== Weapon Defaults ====================

export interface WeaponDefaultsCodeResult {
	varDecls: string[];
	functions: string[];
	mainLoopLines: string[];
	initLines: string[];
	persistVars: PersistVar[];
	hasInitFunction: boolean;
}

/**
 * Generate GPC code for per-weapon variable defaults.
 *
 * When a weapon switch is detected (CurrentWeapon changes), the generated
 * ApplyWeaponDefaults() function either resets variables to design-time
 * defaults ("reset" mode) or swaps values in/out of per-weapon backup
 * arrays ("remember" mode).
 */
export function generateWeaponDefaultsCode(
	config: WeaponDefaultsConfig,
	weaponCount: number,
	allVars: FlowVariable[],
	weaponNames: string[]
): WeaponDefaultsCodeResult | null {
	if (config.enabledVars.length === 0 || weaponCount === 0) return null;

	// Resolve enabled variables against all known variables
	const enabledSet = new Set(config.enabledVars);
	const vars = allVars.filter((v) => enabledSet.has(v.name));
	if (vars.length === 0) return null;

	const varDecls: string[] = [];
	const functions: string[] = [];
	const mainLoopLines: string[] = [];
	const initLines: string[] = [];
	const persistVars: PersistVar[] = [];

	// Tracking variable for weapon change detection
	varDecls.push('int _prev_CurrentWeapon = -1;');

	if (config.rememberTweaks) {
		// "Remember" mode: backup arrays hold per-weapon values
		const wdInitLines: string[] = [];
		for (const v of vars) {
			const arrName = `_wd_${v.name}`;
			const defaults: number[] = [];
			for (let i = 0; i < weaponCount; i++) {
				defaults.push(config.overrides[i]?.[v.name] ?? (v.defaultValue as number));
			}
			varDecls.push(`int ${arrName}[WEAPON_COUNT];`);
			// Check if all defaults are the same value (common case)
			const allSame = defaults.every((d) => d === defaults[0]);
			if (allSame) {
				wdInitLines.push(`    for(_i = 0; _i < WEAPON_COUNT; _i++) {`);
				wdInitLines.push(`        ${arrName}[_i] = ${defaults[0]};`);
				wdInitLines.push(`    }`);
			} else {
				for (let i = 0; i < defaults.length; i++) {
					wdInitLines.push(`    ${arrName}[${i}] = ${defaults[i]};`);
				}
			}

			// Sparse persistence for backup array
			const min = v.min ?? 0;
			const max = v.max ?? (min === 0 && (v.defaultValue as number) <= 1 ? 1 : 100);
			persistVars.push({
				name: arrName,
				min,
				max,
				defaultValue: v.defaultValue as number,
				sparseArray: {
					countExpr: 'WEAPON_COUNT',
					maxCount: 'WEAPON_COUNT',
					indexVar: '_bp_loop_i',
					countVar: '_bp_sparse_count',
					stride: 1,
				},
			});
		}

		// Check if any for-loop was used; if so, declare the loop variable
		const needsLoopVar = wdInitLines.some((l) => l.includes('for(_i'));
		if (needsLoopVar) {
			varDecls.push('int _i;');
		}

		// InitWeaponDefaults: populate backup arrays with design-time values
		functions.push('function InitWeaponDefaults() {');
		functions.push(...wdInitLines);
		functions.push('}');
		functions.push('');

		// ApplyWeaponDefaults: save outgoing, load incoming
		functions.push('function ApplyWeaponDefaults() {');
		functions.push('    // Save outgoing weapon values');
		functions.push('    if(_prev_CurrentWeapon >= 0) {');
		for (const v of vars) {
			functions.push(`        _wd_${v.name}[_prev_CurrentWeapon] = ${v.name};`);
		}
		functions.push('    }');
		functions.push('    // Load incoming weapon values');
		for (const v of vars) {
			functions.push(`    ${v.name} = _wd_${v.name}[CurrentWeapon];`);
		}
		functions.push('}');
		functions.push('');
	} else {
		// "Reset" mode: always reset to design-time defaults
		functions.push('function ApplyWeaponDefaults() {');

		// Set all vars to their base defaults first
		for (const v of vars) {
			functions.push(`    ${v.name} = ${v.defaultValue};`);
		}

		// Sparse overrides for weapons with non-default values
		const weaponIndices = Object.keys(config.overrides)
			.map(Number)
			.filter((i) => i < weaponCount)
			.sort((a, b) => a - b);

		for (const wi of weaponIndices) {
			const overrides = config.overrides[wi];
			// Only include overrides for enabled vars
			const entries = Object.entries(overrides).filter(([name]) => enabledSet.has(name));
			if (entries.length === 0) continue;

			const label = weaponNames[wi] ?? `Weapon ${wi}`;
			const assignments = entries.map(([name, val]) => `${name} = ${val};`).join(' ');
			functions.push(`    if(CurrentWeapon == ${wi}) { ${assignments} }  // ${label}`);
		}

		functions.push('}');
		functions.push('');
	}

	// Main loop: weapon change detection
	mainLoopLines.push('    // --- Weapon Defaults ---');
	mainLoopLines.push('    if(CurrentWeapon != _prev_CurrentWeapon) {');
	mainLoopLines.push('        ApplyWeaponDefaults();');
	mainLoopLines.push('        _prev_CurrentWeapon = CurrentWeapon;');
	mainLoopLines.push('        FlowRedraw = TRUE;');
	mainLoopLines.push('    }');

	// Init: load current weapon values
	if (config.rememberTweaks) {
		// In remember mode after Flow_Load(), just load from backup arrays
		for (const v of vars) {
			initLines.push(`    ${v.name} = _wd_${v.name}[CurrentWeapon];`);
		}
		initLines.push('    _prev_CurrentWeapon = CurrentWeapon;');
	} else {
		// In reset mode, apply defaults and set tracking var
		initLines.push('    ApplyWeaponDefaults();');
		initLines.push('    _prev_CurrentWeapon = CurrentWeapon;');
	}

	return { varDecls, functions, mainLoopLines, initLines, persistVars, hasInitFunction: config.rememberTweaks };
}

