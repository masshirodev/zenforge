import type { ModuleDefinition } from '$lib/types/module';
import type { FlowNode, ModuleNodeData, ModuleNodeOption } from '$lib/types/flow';
import { createFlowNode } from '$lib/types/flow';

/**
 * Convert a TOML module definition into a FlowNode with type 'module'.
 *
 * Parses the TOML `combo` field into separate sections:
 *   - combo blocks → comboCode
 *   - function definitions → functionsCode
 *   - define/const declarations → functionsCode (prepended)
 *   - everything else → functionsCode
 *
 * The `trigger` field goes to `mainCode` by default.
 */
export function createModuleNode(
	moduleDef: ModuleDefinition,
	position: { x: number; y: number }
): FlowNode {
	const options: ModuleNodeOption[] = moduleDef.options.map((opt) => ({
		name: opt.name,
		variable: opt.var,
		type: opt.type === 'toggle' ? 'toggle' : 'value',
		defaultValue: typeof opt.default === 'number' ? opt.default : 0,
		min: opt.min,
		max: opt.max,
	}));

	// Use the module's first Status toggle variable as the enable variable
	// so the menu flow toggle directly controls the gameplay guard.
	// Fall back to auto-generated name if no Status toggle exists.
	const statusOption = options.find((o) => o.type === 'toggle' && o.name === 'Status');
	const safeName = moduleDef.id
		.replace(/[^a-zA-Z0-9_]/g, '_')
		.replace(/^[0-9]/, '_$&');
	const enableVar = statusOption?.variable ?? `${capitalize(safeName)}_Enabled`;

	// Parse the combo field into separate code sections
	const parsed = parseComboField(moduleDef.combo ?? '');

	// Strip config_menu rendering functions — the flow editor generates menus instead
	const menuFunctions = collectConfigMenuFunctions(moduleDef);
	const functionsCode =
		menuFunctions.length > 0
			? stripFunctions(parsed.functionsCode, menuFunctions)
			: parsed.functionsCode;

	// Build params map from module definition (button/key params with defaults)
	const params: Record<string, string> = {};
	for (const p of moduleDef.params) {
		if (p.type === 'button' || p.type === 'key') {
			params[p.key] = p.default ?? '';
		}
	}

	const moduleData: ModuleNodeData = {
		moduleId: moduleDef.id,
		moduleName: moduleDef.display_name,
		triggerCondition: '',
		enableVariable: enableVar,
		initCode: '',
		mainCode: moduleDef.trigger ?? '',
		functionsCode,
		comboCode: parsed.comboCode,
		options,
		extraVars: { ...moduleDef.extra_vars },
		params: Object.keys(params).length > 0 ? params : undefined,
		keyboardMappings: moduleDef.id === 'keyboard' ? [] : undefined,
		quickToggle:
			moduleDef.quick_toggle && moduleDef.quick_toggle.length > 0
				? [...moduleDef.quick_toggle]
				: undefined,
		conflicts: moduleDef.conflicts ?? [],
		needsWeapondata: moduleDef.needs_weapondata ?? false,
		flowTarget: moduleDef.flow_target,
	};

	const node = createFlowNode('module', moduleDef.display_name, position);
	node.moduleData = moduleData;

	// Data modules: mark as alwaysActive since they define data, not gameplay logic.
	// No enable variable guard or Status toggle needed.
	const isDataModule = moduleDef.flow_target === 'data';
	if (isDataModule) {
		moduleData.alwaysActive = true;
	}

	// Create node variables — enable variable + option variables (deduplicated)
	const vars: FlowNode['variables'] = [];
	const seenVars = new Set<string>();

	// Enable variable first (auto-persist toggles as 0/1) — skip for data modules
	if (!isDataModule) {
		vars.push({
			name: enableVar,
			type: 'int',
			defaultValue: statusOption ? statusOption.defaultValue : 0,
			persist: true,
			min: 0,
			max: 1,
		});
		seenVars.add(enableVar);
	}

	// Add option variables (skip if already added as enable var)
	// Module options are auto-persisted so user settings survive reboot
	for (const opt of options) {
		if (!seenVars.has(opt.variable)) {
			const isToggle = opt.type === 'toggle';
			vars.push({
				name: opt.variable,
				type: 'int' as const,
				defaultValue: opt.defaultValue,
				persist: true,
				min: isToggle ? 0 : opt.min,
				max: isToggle ? 1 : opt.max,
			});
			seenVars.add(opt.variable);
		}
	}

	// Weapondata: add CurrentWeapon as a node variable so it's
	// available for binding to array-item sub-nodes
	if (moduleDef.id === 'weapondata' && !seenVars.has('CurrentWeapon')) {
		vars.push({
			name: 'CurrentWeapon',
			type: 'int',
			defaultValue: 0,
			persist: true,
			perProfile: true,
			min: 0,
			max: 255,
		});
		seenVars.add('CurrentWeapon');
	}

	node.variables = vars;

	return node;
}

/**
 * Parse a TOML module's `combo` field into separate code sections.
 *
 * The combo field in TOML modules is a catch-all that can contain:
 *   - `combo Name { ... }` blocks
 *   - `function Name(...) { ... }` definitions
 *   - `define NAME = value;` declarations
 *   - `const type Name[] = { ... };` declarations
 *   - Other top-level code
 *
 * This function splits them into comboCode (combo blocks) and
 * functionsCode (everything else: functions, defines, consts).
 */
export function parseComboField(raw: string): { comboCode: string; functionsCode: string } {
	if (!raw.trim()) return { comboCode: '', functionsCode: '' };

	const lines = raw.split('\n');
	const comboLines: string[] = [];
	const functionLines: string[] = [];

	let i = 0;
	while (i < lines.length) {
		const trimmed = lines[i].trimStart();

		// combo block: "combo Name {"
		if (/^combo\s+[a-zA-Z_]\w*\s*\{/.test(trimmed)) {
			const blockStart = i;
			const blockEnd = findBlockEndFromLines(lines, i);
			comboLines.push(...lines.slice(blockStart, blockEnd + 1));
			comboLines.push('');
			i = blockEnd + 1;
			continue;
		}

		// function block: "function Name(...) {"
		if (/^function\s+[a-zA-Z_]\w*\s*\(/.test(trimmed)) {
			const blockStart = i;
			const blockEnd = findBlockEndFromLines(lines, i);
			functionLines.push(...lines.slice(blockStart, blockEnd + 1));
			functionLines.push('');
			i = blockEnd + 1;
			continue;
		}

		// define/const: single-line or multi-line array
		if (/^(define\s+|const\s+)/.test(trimmed)) {
			// Could be multi-line (e.g. const int8 arr[] = { ... };)
			if (trimmed.includes('{') && !trimmed.includes('}')) {
				// Multi-line const array
				const blockStart = i;
				while (i < lines.length && !lines[i].includes('};')) {
					i++;
				}
				functionLines.push(...lines.slice(blockStart, i + 1));
				functionLines.push('');
				i++;
			} else {
				functionLines.push(lines[i]);
				i++;
			}
			continue;
		}

		// Empty lines or comments — skip
		if (!trimmed || trimmed.startsWith('//')) {
			i++;
			continue;
		}

		// Everything else → functionsCode
		functionLines.push(lines[i]);
		i++;
	}

	return {
		comboCode: comboLines.join('\n').trim(),
		functionsCode: functionLines.join('\n').trim(),
	};
}

/**
 * Find the closing brace index for a block starting at the given line.
 */
function findBlockEndFromLines(lines: string[], startIdx: number): number {
	let depth = 0;
	for (let i = startIdx; i < lines.length; i++) {
		for (const ch of lines[i]) {
			if (ch === '{') depth++;
			if (ch === '}') depth--;
			if (depth === 0 && i > startIdx) return i;
		}
		// Handle opening brace on same line
		if (depth === 0 && i === startIdx) {
			// Single line block like "combo X { ... }"
			if (lines[i].includes('{') && lines[i].includes('}')) return i;
		}
	}
	return lines.length - 1;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Collect function names referenced by a module's config_menu.
 * These are legacy menu rendering functions that the flow editor replaces.
 */
function collectConfigMenuFunctions(moduleDef: ModuleDefinition): string[] {
	const cm = moduleDef.config_menu;
	if (!cm) return [];
	const names: string[] = [];
	if (cm.render_function) names.push(cm.render_function);
	if (cm.display_function) names.push(cm.display_function);
	if (cm.edit_function) names.push(cm.edit_function);
	return names;
}

/**
 * Remove named function definitions from a code string.
 * Matches `function Name(...) { ... }` blocks (with balanced braces).
 */
function stripFunctions(code: string, functionNames: string[]): string {
	if (!code.trim() || functionNames.length === 0) return code;

	const namePattern = functionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
	const lines = code.split('\n');
	const result: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const trimmed = lines[i].trimStart();
		const fnMatch = new RegExp(`^function\\s+(${namePattern})\\s*\\(`).exec(trimmed);
		if (fnMatch) {
			// Skip this entire function block
			const blockEnd = findBlockEndFromLines(lines, i);
			i = blockEnd + 1;
			// Skip trailing blank lines
			while (i < lines.length && !lines[i].trim()) i++;
			continue;
		}
		result.push(lines[i]);
		i++;
	}

	return result.join('\n').trim();
}
