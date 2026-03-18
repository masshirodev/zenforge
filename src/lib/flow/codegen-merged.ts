declare const __ZENFORGE_VERSION__: string;
import type { FlowProject, FlowGraph, FlowProfile, FlowVariable, ProfileSwitchConfig } from '$lib/types/flow';
import {
	generateFlowGpc,
	collectPersistVars,
	flowVarsToPersistVars,
	generateBitpackPersistence,
	type PersistVar,
} from './codegen';
import { generateGameplayGpc, generateGameplayGpcStandalone, generateWeaponDefaultsCode } from './codegen-gameplay';

/**
 * Generate a single merged GPC script from an entire FlowProject.
 *
 * Combines the menu flow (state machine) and gameplay flow (parallel modules)
 * into one cohesive script. Shared variables are declared once and used by both.
 *
 * Persistence is coordinated across both flows:
 *   - SPVAR_1 = data-exists marker
 *   - SPVAR_2-5 = reserved for user manual use
 *   - SPVAR_6+ = auto-generated bitpacked data
 */
export interface MergedFlowResult {
	code: string;
	extraFiles: Record<string, string>;
}

export interface MergedFlowOptions {
	/** Game version from game.json metadata (shown in header comment) */
	gameVersion?: number;
	/** Game name from game.json metadata */
	gameName?: string;
	/** Output filename */
	filename?: string;
	/** Game type (fps, tps, etc.) */
	gameType?: string;
	/** Console type (ps4, ps5, etc.) */
	consoleType?: string;
	/** Author username */
	username?: string;
	/** User-defined header comments (template variables are substituted) */
	headerComments?: string;
}

export function generateMergedFlowGpc(project: FlowProject, options?: MergedFlowOptions): MergedFlowResult {
	const menuFlow = project.flows.find((f) => f.flowType === 'menu');
	const gameplayFlow = project.flows.find((f) => f.flowType === 'gameplay');
	const dataFlow = project.flows.find((f) => f.flowType === 'data');

	const hasMenu = menuFlow && menuFlow.nodes.length > 0;
	const hasGameplay = gameplayFlow && gameplayFlow.nodes.some((n) => n.type === 'module' || n.type === 'custom');
	const hasData = dataFlow && dataFlow.nodes.some((n) => n.type === 'module' || n.type === 'custom');

	const profiles = project.profiles ?? [];
	const weaponDefaultsActive =
		project.weaponDefaults &&
		project.weaponDefaults.enabledVars.length > 0 &&
		[...(gameplayFlow?.nodes ?? []), ...(dataFlow?.nodes ?? [])].some(
			(n) => n.moduleData?.moduleId === 'weapondata'
		);
	// Profiles and weapon defaults can coexist — profiles set which weapon is
	// active, weapon defaults apply per-weapon values on weapon change.
	const profileCount = profiles.length;
	// Variables in weaponDefaults.enabledVars must not be perProfile (exclusive)
	const weaponEnabledVars = weaponDefaultsActive
		? new Set(project.weaponDefaults!.enabledVars)
		: new Set<string>();

	// If only one flow has content, just generate that one
	if (hasMenu && !hasGameplay && !hasData) {
		return { code: generateFlowGpc(menuFlow, profileCount), extraFiles: {} };
	}
	if (!hasMenu && hasGameplay && !hasData) {
		const gameplayResult = generateGameplayGpc(gameplayFlow!);
		return {
			code: generateGameplayGpcStandalone(gameplayFlow!),
			extraFiles: gameplayResult.extraFiles,
		};
	}
	if (!hasMenu && !hasGameplay && !hasData) {
		return { code: '// Empty flow project — add nodes to generate code\n', extraFiles: {} };
	}

	// Collect all module nodes across all flows for cross-flow checks (e.g. recoiltable)
	const allFlowModuleNodes = [
		...(gameplayFlow?.nodes ?? []),
		...(dataFlow?.nodes ?? []),
	].filter((n) => n.type === 'module' && n.moduleData);

	// Both flows have content — merge them
	// Skip persistence in menu codegen — we generate combined persistence below
	const dataResult = hasData ? generateGameplayGpc(dataFlow!, allFlowModuleNodes) : null;
	const gameplayResult = generateGameplayGpc(gameplayFlow!, allFlowModuleNodes);
	// Collect perProfile var names from all flows so menu codegen applies [Flow_CurrentProfile] indexing
	const extraPerProfileVars = new Set<string>();
	if (profileCount > 1) {
		for (const v of project.sharedVariables) {
			if (v.perProfile && !weaponEnabledVars.has(v.name)) extraPerProfileVars.add(v.name);
		}
		const otherFlowNodes = [...(gameplayFlow?.nodes ?? []), ...(dataFlow?.nodes ?? [])];
		for (const node of otherFlowNodes) {
			for (const v of node.variables) {
				if (v.perProfile && !weaponEnabledVars.has(v.name)) extraPerProfileVars.add(v.name);
			}
		}
	}

	const menuCode = generateFlowGpc(menuFlow!, profileCount, { skipPersistence: true, weaponEnabledVars, extraPerProfileVars });

	// Generate weapon defaults code (if active)
	let weaponDefaultsResult: ReturnType<typeof generateWeaponDefaultsCode> = null;
	if (weaponDefaultsActive && project.weaponDefaults) {
		// Collect all variables from all flows to resolve enabled vars
		const allVars: FlowVariable[] = [
			...project.sharedVariables,
			...(menuFlow?.globalVariables ?? []),
			...(menuFlow?.nodes.flatMap((n) => n.variables) ?? []),
			...(gameplayFlow?.nodes.flatMap((n) => n.variables) ?? []),
			...(dataFlow?.nodes.flatMap((n) => n.variables) ?? []),
		];
		// Deduplicate by name
		const seen = new Set<string>();
		const uniqueVars = allVars.filter((v) => {
			if (seen.has(v.name)) return false;
			seen.add(v.name);
			return true;
		});

		const weaponNames =
			allFlowModuleNodes.find((n) => n.moduleData?.moduleId === 'weapondata')
				?.moduleData?.weaponNames ?? [];

		// When profiles are active, CurrentWeapon is a per-profile array
		const currentWeaponExpr = profileCount > 1 ? 'CurrentWeapon[Flow_CurrentProfile]' : 'CurrentWeapon';
		weaponDefaultsResult = generateWeaponDefaultsCode(
			project.weaponDefaults,
			weaponNames.length,
			uniqueVars,
			weaponNames,
			currentWeaponExpr
		);
	}

	// Collect combined persist vars from all sources (includes weapon defaults backup arrays)
	const combinedPersistVars = collectCombinedPersistVars(project, menuFlow!, gameplayFlow!, profileCount, dataFlow, weaponEnabledVars);

	const lines: string[] = [];

	lines.push(`// ====================================================`);
	lines.push(`// This script was generated by ZenForge v${__ZENFORGE_VERSION__}.`);
	lines.push(`// If you want to make scripts easily `);
	lines.push(`// consider downloading ZenForge for free at`);
	lines.push(`// https://github.com/masshirodev/zenforge`);
	lines.push(`// ====================================================`);
	if (options?.gameVersion != null) lines.push(`// Version: ${options.gameVersion}`);
	if (options?.gameType) lines.push(`// Game type: ${options.gameType}`);
	if (options?.consoleType) lines.push(`// Console: ${options.consoleType}`);
	lines.push(`// Generated at: ${new Date(project.updatedAt).toLocaleString()}`);

	if (profileCount > 1) {
		lines.push(`// Profiles: ${profiles.map((p) => p.name).join(', ')}`);
	}

	lines.push(`// ====================================================`);
	lines.push('');

	// Parse menu code to separate const declarations from functions
	// GPC requires const declarations before any function definitions
	const menuLines = menuCode.split('\n');
	const mainStartIdx = menuLines.findIndex((l) => l.trim().startsWith('main {'));
	const initStartIdx = menuLines.findIndex((l) => l.trim().startsWith('init {'));

	const sharedVarNames = new Set(project.sharedVariables.map((v) => v.name));

	// Collect gameplay + data variable names to avoid re-declaration in menu code
	const gameplayVarNames = new Set<string>();
	for (const decl of gameplayResult.variables) {
		const match = decl.match(/(?:int|int8|int16|int32)\s+(\w+)/);
		if (match) gameplayVarNames.add(match[1]);
	}
	if (dataResult) {
		for (const decl of dataResult.variables) {
			const match = decl.match(/(?:int|int8|int16|int32)\s+(\w+)/);
			if (match) gameplayVarNames.add(match[1]);
		}
	}

	// Everything before init is declarations/functions
	// Strip imports (already at top) and shared/gameplay variable re-declarations
	const preInit = menuLines
		.slice(0, initStartIdx >= 0 ? initStartIdx : mainStartIdx >= 0 ? mainStartIdx : menuLines.length)
		.filter((l) => {
			const trimmed = l.trim();
			if (trimmed.startsWith('import ')) return false;
			const varMatch = trimmed.match(/^(?:int|int8|int16|int32)\s+(\w+)/);
			if (varMatch && (sharedVarNames.has(varMatch[1]) || gameplayVarNames.has(varMatch[1]))) return false;
			return true;
		});

	// Split preInit into const declarations (string/image) and the rest (vars/functions)
	// Const declarations must appear before imports (which contain function defs)
	const constLines: string[] = [];
	const nonConstLines: string[] = [];
	let inConstBlock = false;
	for (const line of preInit) {
		const trimmed = line.trim();
		if (trimmed.startsWith('const string ') || trimmed.startsWith('const image ') || trimmed.startsWith('// ===== STRING TABLES') || trimmed.startsWith('// ===== IMAGE DATA')) {
			inConstBlock = true;
		}
		if (inConstBlock) {
			constLines.push(line);
			// End of a const block: closing brace of multi-line const or single-line const
			if (trimmed.startsWith('};') || (trimmed.startsWith('const ') && trimmed.endsWith(';'))) {
				inConstBlock = false;
			}
			// Empty line after const block
			if (trimmed === '' && constLines.length > 0) {
				inConstBlock = false;
			}
		} else {
			nonConstLines.push(line);
		}
	}

	// Profile variables (when multiple profiles are configured)
	if (profileCount > 1) {
		lines.push(`// ===== PROFILE SYSTEM =====`);
		lines.push(`define FLOW_PROFILE_COUNT = ${profileCount};`);
		lines.push(`int Flow_CurrentProfile = 0;`);
		if (project.profileSwitch?.keyboardKey) {
			lines.push(`int _kb_profile_delay;`);
		}

		// ProfileData module: emit labels array if the module exists in data/gameplay flow
		const hasProfileData = [...(dataFlow?.nodes ?? []), ...gameplayFlow!.nodes].some(
			(n) => n.moduleData?.moduleId === 'profiledata'
		);
		if (hasProfileData && profiles.length > 0) {
			const quoted = profiles.map((p) => `"${p.name}"`).join(', ');
			lines.push(`define PROFILE_COUNT = ${profileCount};`);
			lines.push(`const string ProfileLabels[] = { ${quoted} };`);
		}

		lines.push('');
	}

	// Array Builder: emit custom arrays from arraybuilder module nodes
	const arrayBuilderNodes = [...(dataFlow?.nodes ?? []), ...gameplayFlow!.nodes].filter(
		(n) => n.moduleData?.moduleId === 'arraybuilder' && n.moduleData.customArrays?.length
	);
	if (arrayBuilderNodes.length > 0) {
		lines.push(`// ===== CUSTOM ARRAYS =====`);
		for (const node of arrayBuilderNodes) {
			for (const arr of node.moduleData!.customArrays!) {
				if (arr.dimension === '2d') {
					const rows = arr.values2d ?? [];
					if (rows.length === 0) continue;
					// Flatten 2D into 1D with offset/count tables
					const flat: string[] = [];
					const offsets: number[] = [];
					const rowCounts: number[] = [];
					for (const row of rows) {
						offsets.push(flat.length);
						rowCounts.push(row.length);
						flat.push(...row);
					}
					lines.push(`define ${arr.countDefine} = ${rows.length};`);
					lines.push(`const int8 ${arr.name}_Offsets[] = { ${offsets.join(', ')} };`);
					lines.push(`const int8 ${arr.name}_RowCounts[] = { ${rowCounts.join(', ')} };`);
					const quoted = flat.map((v) => `"${v}"`).join(', ');
					lines.push(`const string ${arr.name}[] = { ${quoted} };`);
				} else {
					if (arr.values.length === 0) continue;
					lines.push(`define ${arr.countDefine} = ${arr.values.length};`);
					const quoted = arr.values.map((v) => `"${v}"`).join(', ');
					lines.push(`const string ${arr.name}[] = { ${quoted} };`);
				}
			}
		}
		lines.push('');
	}

	// Collect profile init lines (GPC can't assign arrays at top level)
	const profileInitLines: string[] = [];

	// Shared variables
	if (project.sharedVariables.length > 0) {
		lines.push(`// ===== SHARED VARIABLES =====`);
		for (const v of project.sharedVariables) {
			const { decl, init } = generateVarDecl(v, profileCount, profiles, weaponEnabledVars);
			lines.push(...decl);
			profileInitLines.push(...init);
		}
		lines.push('');
	}

	// Shared code
	if (project.sharedCode.trim()) {
		lines.push(`// ===== SHARED CODE =====`);
		lines.push(project.sharedCode.trim());
		lines.push('');
	}

	// Collect perProfile variable names from data/gameplay flows so we can
	// redeclare them with explicit profile arrays instead of [profile] syntax
	const perProfileFlowVars = new Map<string, FlowVariable>();
	if (profileCount > 1) {
		const flowNodes = [...(gameplayFlow?.nodes ?? []), ...(dataFlow?.nodes ?? [])];
		for (const node of flowNodes) {
			for (const v of node.variables) {
				if (v.perProfile && !weaponEnabledVars.has(v.name) && !sharedVarNames.has(v.name)) {
					perProfileFlowVars.set(v.name, v);
				}
			}
		}
	}

	// Filter helper: exclude shared vars and perProfile vars (we redeclare those)
	const filterVarDecl = (decl: string): boolean => {
		const match = decl.match(/(?:int|int8|int16|int32)\s+(\w+)/);
		if (!match) return true;
		if (sharedVarNames.has(match[1])) return false;
		if (perProfileFlowVars.has(match[1])) return false;
		return true;
	};

	// Gameplay variables (exclude shared and perProfile vars we'll redeclare)
	const gameplayVars = gameplayResult.variables.filter(filterVarDecl);

	// Data defines and variables (emitted first — gameplay may reference them)
	if (dataResult) {
		const dataDefines = dataResult.defines;
		const dataVars = dataResult.variables.filter(filterVarDecl);
		if (dataDefines.length > 0) {
			lines.push(`// ===== DATA DEFINES =====`);
			lines.push(...dataDefines);
			lines.push('');
		}
		if (dataVars.length > 0) {
			lines.push(`// ===== DATA VARIABLES =====`);
			lines.push(...dataVars);
			lines.push('');
		}
	}

	// Gameplay defines (button params, weapon counts, etc.)
	if (gameplayResult.defines.length > 0) {
		lines.push(`// ===== GAMEPLAY DEFINES =====`);
		lines.push(...gameplayResult.defines);
		lines.push('');
	}

	if (gameplayVars.length > 0) {
		lines.push(`// ===== GAMEPLAY VARIABLES =====`);
		lines.push(...gameplayVars);
		lines.push('');
	}

	// Per-profile gameplay/data vars redeclared with explicit profile arrays
	if (perProfileFlowVars.size > 0) {
		lines.push(`// ===== PER-PROFILE VARIABLES =====`);
		for (const v of perProfileFlowVars.values()) {
			const { decl, init } = generateVarDecl(v, profileCount, profiles, weaponEnabledVars);
			lines.push(...decl);
			profileInitLines.push(...init);
		}
		lines.push('');
	}

	// Weapon defaults variables (backup arrays in "remember" mode)
	if (weaponDefaultsResult) {
		lines.push(`// ===== WEAPON DEFAULTS =====`);
		lines.push(...weaponDefaultsResult.varDecls);
		lines.push('');
	}

	// Emit const declarations (string tables, image data) before imports
	if (constLines.length > 0) {
		lines.push(...constLines);
		if (constLines[constLines.length - 1]?.trim() !== '') lines.push('');
	}

	// Imports for common helpers (after const declarations, since they contain functions)
	lines.push(`import common/helper;`);
	lines.push(`import common/oled;`);
	if (combinedPersistVars.length > 0) {
		lines.push(`import common/bitpack;`);
	}
	lines.push('');

	// Menu flow declarations and functions (non-const parts)
	lines.push(`// ===== MENU FLOW =====`);
	lines.push(...nonConstLines);

	// Data combos and functions (before gameplay — gameplay may reference them)
	if (dataResult) {
		if (dataResult.combos.length > 0) {
			lines.push(`// ===== DATA COMBOS =====`);
			lines.push(...dataResult.combos);
		}
		if (dataResult.functions.length > 0) {
			lines.push(`// ===== DATA FUNCTIONS =====`);
			// When profiles are active, GetActiveWeapon() must index CurrentWeapon by profile
			const dataFuncs = profileCount > 1
				? dataResult.functions.map((l) => l.replace('return CurrentWeapon;', `return CurrentWeapon[Flow_CurrentProfile];`))
				: dataResult.functions;
			lines.push(...dataFuncs);
			lines.push('');
		}
	}

	// Gameplay combos
	if (gameplayResult.combos.length > 0) {
		lines.push(`// ===== GAMEPLAY COMBOS =====`);
		lines.push(...gameplayResult.combos);
	}

	// Gameplay functions
	if (gameplayResult.functions.length > 0) {
		lines.push(`// ===== GAMEPLAY FUNCTIONS =====`);
		// When profiles are active, GetActiveWeapon() must index CurrentWeapon by profile
		const funcs = profileCount > 1
			? gameplayResult.functions.map((l) => l.replace('return CurrentWeapon;', `return CurrentWeapon[Flow_CurrentProfile];`))
			: gameplayResult.functions;
		lines.push(...funcs);
		lines.push('');
	}

	// Weapon defaults function (ApplyWeaponDefaults)
	if (weaponDefaultsResult && weaponDefaultsResult.functions.length > 0) {
		lines.push(`// ===== WEAPON DEFAULTS FUNCTION =====`);
		lines.push(...weaponDefaultsResult.functions);
	}

	// Combined persistence (bitpack-based, covers both flows)
	if (combinedPersistVars.length > 0) {
		lines.push(`// ===== PERSISTENCE =====`);
		lines.push(generateBitpackPersistence(combinedPersistVars));
		lines.push('');
	}

	// Merged init block
	const hasDataInit = dataResult && dataResult.initCode.length > 0;
	const hasGameplayInit = gameplayResult.initCode.length > 0;
	const hasWeaponDefaultsInit = weaponDefaultsResult && weaponDefaultsResult.initLines.length > 0;
	const hasProfileInit = profileInitLines.length > 0;
	const needsInit = initStartIdx >= 0 || hasDataInit || hasGameplayInit || combinedPersistVars.length > 0 || hasWeaponDefaultsInit || hasProfileInit;

	if (needsInit) {
		lines.push(`// ===== INIT =====`);
		lines.push(`init {`);

		// Per-profile array initializations (must be inside a block in GPC)
		if (hasProfileInit) {
			lines.push(`    // --- Profile Defaults ---`);
			lines.push(...profileInitLines);
		}

		if (initStartIdx >= 0) {
			const initEndIdx = findBlockEnd(menuLines, initStartIdx);
			const menuInitBody = menuLines.slice(initStartIdx + 1, initEndIdx);
			if (hasGameplayInit) {
				lines.push(`    // --- Menu Init ---`);
			}
			lines.push(...menuInitBody);
		}

		if (hasDataInit) {
			if (initStartIdx >= 0) lines.push('');
			lines.push(`    // --- Data Init ---`);
			lines.push(...dataResult!.initCode);
		}

		if (hasGameplayInit) {
			if (initStartIdx >= 0 || hasDataInit) lines.push('');
			lines.push(`    // --- Gameplay Init ---`);
			lines.push(...gameplayResult.initCode);
		}

		// Init weapon default arrays before Flow_Load so persistence can overwrite them
		if (weaponDefaultsResult && weaponDefaultsResult.hasInitFunction) {
			lines.push(`    InitWeaponDefaults();`);
		}

		if (combinedPersistVars.length > 0) {
			lines.push(`    Flow_Load();`);
		}

		// Weapon defaults init (after Flow_Load so backup arrays are restored)
		if (hasWeaponDefaultsInit) {
			lines.push(`    // --- Weapon Defaults Init ---`);
			lines.push(...weaponDefaultsResult!.initLines);
		}

		lines.push(`}`);
		lines.push('');
	}

	// Merged main block
	lines.push(`// ===== MAIN LOOP =====`);
	lines.push(`main {`);

	// Profile switching (before menu/gameplay code)
	if (profileCount > 1 && project.profileSwitch) {
		lines.push('');
		lines.push(`    // --- Profile Switching ---`);
		lines.push(...generateProfileSwitchCode(project.profileSwitch, profileCount));
	}

	// Weapon defaults: detect weapon change and apply defaults
	if (weaponDefaultsResult && weaponDefaultsResult.mainLoopLines.length > 0) {
		lines.push('');
		lines.push(...weaponDefaultsResult.mainLoopLines);
	}

	// Menu state dispatch (extract main body)
	if (mainStartIdx >= 0) {
		const mainEndIdx = findBlockEnd(menuLines, mainStartIdx);
		const menuMainBody = menuLines.slice(mainStartIdx + 1, mainEndIdx);
		lines.push(`    // --- Menu Flow ---`);
		lines.push(...menuMainBody);
	}

	// Data flow main loop (if any)
	if (dataResult && dataResult.mainLoopCode.length > 0) {
		lines.push('');
		lines.push(`    // --- Data Flow ---`);
		lines.push(...dataResult.mainLoopCode);
	}

	// Gameplay triggers
	if (gameplayResult.mainLoopCode.length > 0) {
		lines.push('');
		lines.push(`    // --- Gameplay Flow ---`);
		lines.push(...gameplayResult.mainLoopCode);
	}

	lines.push(`}`);

	const extraFiles = { ...gameplayResult.extraFiles, ...(dataResult?.extraFiles ?? {}) };
	return { code: lines.join('\n'), extraFiles };
}

// ==================== Persistence Collection ====================

/**
 * Collect all persist variables from a merged project, deduplicating by name.
 * Includes shared vars, menu flow vars, gameplay flow vars, and special
 * array persistence for Weapons_RecoilValues when applicable.
 */
export function collectCombinedPersistVars(
	project: FlowProject,
	menuFlow: FlowGraph,
	gameplayFlow: FlowGraph,
	profileCount: number,
	dataFlow?: FlowGraph,
	weaponEnabledVars?: Set<string>
): PersistVar[] {
	const result: PersistVar[] = [];
	const seen = new Set<string>();

	function addVars(vars: FlowVariable[]) {
		// Weapon-enabled vars must not be treated as perProfile (exclusive)
		const adjusted = weaponEnabledVars?.size
			? vars.map((v) => (weaponEnabledVars.has(v.name) ? { ...v, perProfile: false } : v))
			: vars;
		const pvars = flowVarsToPersistVars(adjusted, profileCount);
		for (const pv of pvars) {
			if (!seen.has(pv.name)) {
				result.push(pv);
				seen.add(pv.name);
			}
		}
	}

	// Shared variables
	const sharedPersist = project.sharedVariables.filter((v) => v.persist);
	addVars(sharedPersist);

	// Data flow persist vars
	if (dataFlow) {
		addVars(collectPersistVars(dataFlow));
	}

	// Menu flow persist vars
	if (menuFlow.settings.persistenceEnabled) {
		addVars(collectPersistVars(menuFlow));
	}

	// Gameplay flow persist vars (module options with persist: true)
	addVars(collectPersistVars(gameplayFlow));

	// Weapons_RecoilValues persistence: basic/decay use full array, timeline uses sparse
	const allModuleNodes = [...gameplayFlow.nodes, ...(dataFlow?.nodes ?? [])];
	const hasWeapondata = allModuleNodes.some((n) => n.moduleData?.moduleId === 'weapondata');
	const hasBasicDecayRecoil = allModuleNodes.some(
		(n) =>
			n.moduleData?.needsWeapondata &&
			n.moduleData.moduleId !== 'weapondata' &&
			n.moduleData.moduleId !== 'antirecoil_timeline'
	);
	const hasTimeline = allModuleNodes.some((n) => n.moduleData?.moduleId === 'antirecoil_timeline');

	if (hasWeapondata && (hasBasicDecayRecoil || hasTimeline) && !seen.has('Weapons_RecoilValues')) {
		if (hasBasicDecayRecoil) {
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
		seen.add('Weapons_RecoilValues');
	}

	// Weapon defaults backup arrays (only in "remember" mode)
	if (
		project.weaponDefaults?.rememberTweaks &&
		project.weaponDefaults.enabledVars.length > 0 &&
		hasWeapondata
	) {
		// Collect all variables from all flows to resolve enabled vars
		const allFlowVars: FlowVariable[] = [
			...project.sharedVariables,
			...menuFlow.globalVariables,
			...menuFlow.nodes.flatMap((n) => n.variables),
			...gameplayFlow.nodes.flatMap((n) => n.variables),
			...(dataFlow?.nodes.flatMap((n) => n.variables) ?? []),
		];
		const varMap = new Map<string, FlowVariable>();
		for (const v of allFlowVars) {
			if (!varMap.has(v.name)) varMap.set(v.name, v);
		}

		for (const varName of project.weaponDefaults.enabledVars) {
			const arrName = `_wd_${varName}`;
			if (seen.has(arrName)) continue;

			const v = varMap.get(varName);
			const min = v?.min ?? 0;
			const max = v?.max ?? (min === 0 && ((v?.defaultValue as number) ?? 0) <= 1 ? 1 : 100);

			result.push({
				name: arrName,
				min,
				max,
				defaultValue: (v?.defaultValue as number) ?? 0,
				sparseArray: {
					countExpr: 'WEAPON_COUNT',
					maxCount: 'WEAPON_COUNT',
					indexVar: '_bp_loop_i',
					countVar: '_bp_sparse_count',
					stride: 1,
				},
			});
			seen.add(arrName);
		}
	}

	return result;
}

// ==================== Header Variable Substitution ====================

/**
 * Substitute template variables in header comments.
 * Supports: {name}, {filename}, {version}, {game_type}, {console}, {username}, {gameabbr}
 */
function substituteHeaderVars(template: string, opts: MergedFlowOptions): string {
	const gameabbr = (opts.gameName ?? '')
		.replace(/[^a-zA-Z0-9_-]/g, '')
		.replace(/-+/g, '-');
	return template
		.replace(/\{name\}/g, opts.gameName ?? '')
		.replace(/\{filename\}/g, opts.filename ?? '')
		.replace(/\{version\}/g, String(opts.gameVersion ?? ''))
		.replace(/\{game_type\}/g, opts.gameType ?? '')
		.replace(/\{console\}/g, opts.consoleType ?? '')
		.replace(/\{username\}/g, opts.username ?? '')
		.replace(/\{gameabbr\}/g, gameabbr);
}

// ==================== Helpers ====================

/** Result of generating a variable declaration — decl goes at top level, init goes in init {} */
interface VarDeclResult {
	decl: string[];
	init: string[];
}

function generateVarDecl(
	v: FlowVariable,
	profileCount: number = 0,
	profiles?: FlowProfile[],
	weaponEnabledVars?: Set<string>
): VarDeclResult {
	const gpcType = v.type === 'bool' ? 'int' : v.type;
	// Weapon-enabled vars are never per-profile (exclusive systems)
	const isPerProfile = v.perProfile && !weaponEnabledVars?.has(v.name);
	if (isPerProfile && profileCount > 1 && v.type !== 'string') {
		const decl = [`${gpcType} ${v.name}[${profileCount}];`];
		const init: string[] = [];
		for (let i = 0; i < profileCount; i++) {
			const override = profiles?.[i]?.variableOverrides[v.name];
			const value = override ?? v.defaultValue;
			init.push(`    ${v.name}[${i}] = ${value};`);
		}
		return { decl, init };
	}
	if (v.type === 'string') {
		const size = v.arraySize ?? 32;
		return { decl: [`int8 ${v.name}[${size}];`], init: [] };
	}
	return { decl: [`${gpcType} ${v.name} = ${v.defaultValue};`], init: [] };
}

/**
 * Generate profile switch code for the main loop.
 */
function generateProfileSwitchCode(config: ProfileSwitchConfig, profileCount: number): string[] {
	const lines: string[] = [];
	const mod = config.modifier ? `get_val(${config.modifier}) && ` : '';
	// Support legacy next/prev fields — fall back to button
	const btn = config.button || config.next || '';
	const kb = config.keyboardKey;

	// Build the cycle body
	const cycleBody = [
		`        Flow_CurrentProfile = Flow_CurrentProfile + 1;`,
		`        if(Flow_CurrentProfile >= ${profileCount}) Flow_CurrentProfile = 0;`,
		`        FlowRedraw = TRUE;`,
	];

	// Controller button
	if (btn) {
		lines.push(`    if(${mod}event_press(${btn})) {`);
		lines.push(...cycleBody);
		lines.push(`    }`);
	}

	// Keyboard key (with debounce delay)
	if (kb) {
		lines.push(`    if(GetKeyboardKey(${kb}) && _kb_profile_delay <= 0) {`);
		lines.push(...cycleBody);
		lines.push(`        _kb_profile_delay = 30;`);
		lines.push(`    }`);
		lines.push(`    if(_kb_profile_delay > 0) _kb_profile_delay--;`);
	}

	return lines;
}

/**
 * Find the closing brace index for a block starting at `startIdx`.
 */
function findBlockEnd(lines: string[], startIdx: number): number {
	let depth = 0;
	for (let i = startIdx; i < lines.length; i++) {
		for (const ch of lines[i]) {
			if (ch === '{') depth++;
			if (ch === '}') depth--;
			if (depth === 0 && i > startIdx) return i;
		}
	}
	return lines.length - 1;
}
