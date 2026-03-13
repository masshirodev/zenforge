import type { FlowProject, FlowGraph, FlowNode, FlowEdge, SubNode } from '$lib/types/flow';
import { createFlowNode, createFlowEdge } from '$lib/types/flow';

/** Tag placed on auto-created sub-nodes. Value is the moduleId string. */
const AUTO_TAG = '__auto_module';

/** Prefix for chunkRef on auto-created submenu nodes. */
const AUTO_NODE_PREFIX = '__auto_module:';

/** Legacy tag from the old single-node approach. */
const LEGACY_TAG = '__auto_module_toggle';

/**
 * Synchronises per-module settings menus between gameplay and menu flows.
 *
 * For every module node in the gameplay flow:
 *   - Ensures a "Module Settings" parent menu page exists in the menu flow
 *     with a menu-item sub-node for each module (navigation).
 *   - Ensures a dedicated submenu node exists per module, containing
 *     toggle-item / value-item sub-nodes for the module's options.
 *   - Ensures edges connect the parent menu-items to the submenu nodes.
 *
 * When a module is removed from gameplay, its submenu node, edge, and
 * parent menu-item are cleaned up automatically.
 *
 * This function is idempotent — safe to call repeatedly.
 */
export function syncModuleMenus(project: FlowProject): boolean {
	const gameplayFlow = project.flows.find((f) => f.flowType === 'gameplay');
	const menuFlow = project.flows.find((f) => f.flowType === 'menu');
	if (!gameplayFlow || !menuFlow) return false;

	const allModuleNodes = gameplayFlow.nodes.filter((n) => n.type === 'module' && n.moduleData);
	// Only modules with options get menu items — data-only modules (e.g. weapondata) are skipped
	// For alwaysActive modules, only include if they have non-Status options (the Speed value, etc.)
	const moduleNodes = allModuleNodes.filter((n) => {
		const md = n.moduleData!;
		if (md.alwaysActive) return md.options.length > 0;
		return md.options.length > 0;
	});
	const moduleMap = new Map(moduleNodes.map((n) => [n.moduleData!.moduleId, n]));
	const activeModuleIds = new Set(moduleMap.keys());

	let changed = false;

	const suppressedMenus = new Set(menuFlow.suppressedModuleMenus ?? []);
	const confirmButton = menuFlow.settings.buttonMapping.confirm;
	const cancelButton = menuFlow.settings.buttonMapping.cancel;

	// --- Find or create parent "Module Settings" node ---
	let parentNode = menuFlow.nodes.find(
		(n) =>
			n.label === 'Module Settings' &&
			(n.subNodes.some((s) => s.config[AUTO_TAG]) ||
				n.subNodes.some((s) => s.config[LEGACY_TAG]))
	);

	if (!parentNode && moduleNodes.length > 0) {
		parentNode = createParentSettingsNode(menuFlow);
		menuFlow.nodes.push(parentNode);
		changed = true;
	}

	if (!parentNode) return changed;

	// --- Migrate legacy toggle sub-nodes (old __auto_module_toggle format) ---
	const legacyToggles = parentNode.subNodes.filter((s) => s.config[LEGACY_TAG]);
	if (legacyToggles.length > 0) {
		const legacyIds = new Set(legacyToggles.map((s) => s.id));
		parentNode.subNodes = parentNode.subNodes.filter((s) => !legacyIds.has(s.id));
		const legacyVars = new Set(
			legacyToggles.map((s) => s.boundVariable).filter(Boolean)
		);
		parentNode.variables = parentNode.variables.filter((v) => !legacyVars.has(v.name));
		changed = true;
	}

	// --- Reconcile parent's menu-item sub-nodes ---
	const existingMenuItems = parentNode.subNodes.filter((s) => s.config[AUTO_TAG]);
	const existingMenuItemModules = new Map(
		existingMenuItems.map((s) => [s.config[AUTO_TAG] as string, s])
	);

	// Add missing menu-items (skip user-suppressed modules)
	for (const [moduleId, modNode] of moduleMap) {
		if (suppressedMenus.has(moduleId)) continue;
		if (!existingMenuItemModules.has(moduleId)) {
			const menuItem = createMenuItemSubNode(
				modNode.label,
				moduleId,
				parentNode.subNodes.length
			);
			parentNode.subNodes.push(menuItem);
			changed = true;
		}
	}

	// Remove stale menu-items
	const staleItems = existingMenuItems.filter(
		(s) => !activeModuleIds.has(s.config[AUTO_TAG] as string)
	);
	if (staleItems.length > 0) {
		const staleIds = new Set(staleItems.map((s) => s.id));
		parentNode.subNodes = parentNode.subNodes.filter((s) => !staleIds.has(s.id));
		parentNode.subNodes.forEach((s, i) => (s.order = i));
		changed = true;
	}

	// --- Reconcile per-module submenu nodes ---
	const existingSubmenuNodes = new Map(
		menuFlow.nodes
			.filter((n) => n.chunkRef?.startsWith(AUTO_NODE_PREFIX))
			.map((n) => [n.chunkRef!.slice(AUTO_NODE_PREFIX.length), n])
	);

	const parentX = parentNode.position.x;
	const parentY = parentNode.position.y;
	let submenuIndex = 0;

	for (const [moduleId, modNode] of moduleMap) {
		if (suppressedMenus.has(moduleId)) continue;
		const moduleData = modNode.moduleData!;
		let submenuNode = existingSubmenuNodes.get(moduleId);

		if (!submenuNode) {
			const pos = {
				x: parentX + 350,
				y: parentY + submenuIndex * 200,
			};
			submenuNode = createModuleSubmenuNode(modNode.label, moduleId, pos, cancelButton);
			menuFlow.nodes.push(submenuNode);
			changed = true;
		}

		// --- Reconcile submenu sub-nodes ---
		const autoSubNodes = submenuNode.subNodes.filter((s) => s.config[AUTO_TAG]);
		const existingVarMap = new Map(
			autoSubNodes.filter((s) => s.boundVariable).map((s) => [s.boundVariable!, s])
		);

		// Build desired sub-nodes directly from the module's own options
		// (the first option is typically the Status toggle — no need to add a separate one)
		const desiredOptions = moduleData.options.map((opt) => ({
			variable: opt.variable,
			label: opt.name,
			type: opt.type,
			min: opt.min,
			max: opt.max,
			defaultValue: opt.defaultValue,
			arrayName: opt.arrayName,
			arraySize: opt.arraySize,
			onChangeCode: opt.onChangeCode,
		}));

		const desiredVarSet = new Set(desiredOptions.map((o) => o.variable));
		const suppressedVars = new Set(submenuNode.autoSuppressed ?? []);

		// Remove stale sub-nodes (but not user-suppressed ones — they're already gone)
		const staleSubNodes = autoSubNodes.filter(
			(s) => s.boundVariable && !desiredVarSet.has(s.boundVariable)
		);
		if (staleSubNodes.length > 0) {
			const staleSubIds = new Set(staleSubNodes.map((s) => s.id));
			submenuNode.subNodes = submenuNode.subNodes.filter((s) => !staleSubIds.has(s.id));
			changed = true;
		}

		// Add missing sub-nodes (skip user-suppressed variables)
		for (const opt of desiredOptions) {
			if (suppressedVars.has(opt.variable)) continue;
			if (!existingVarMap.has(opt.variable)) {
				const order = submenuNode.subNodes.length;
				let subNode: SubNode;
				if (opt.type === 'toggle') {
					subNode = createToggleSubNode(opt.label, opt.variable, moduleId, order);
				} else if (opt.type === 'array') {
					subNode = createArraySubNode(
						opt.label,
						opt.variable,
						moduleId,
						order,
						opt.arrayName ?? 'ArrayData',
						opt.arraySize ?? 10,
						opt.onChangeCode
					);
				} else {
					subNode = createValueSubNode(
						opt.label,
						opt.variable,
						moduleId,
						order,
						opt.min ?? 0,
						opt.max ?? 100,
						opt.onChangeCode
					);
				}
				submenuNode.subNodes.push(subNode);
				changed = true;
			}
		}

		// --- Reconcile submenu variables (add missing, sync existing) ---
		for (const opt of desiredOptions) {
			const isToggle = opt.type === 'toggle';
			const varMin = isToggle ? 0 : opt.min;
			const varMax = isToggle ? 1 : opt.max;
			const existing = submenuNode.variables.find((v) => v.name === opt.variable);
			if (!existing) {
				submenuNode.variables.push({
					name: opt.variable,
					type: 'int',
					defaultValue: opt.defaultValue,
					persist: true,
					min: varMin,
					max: varMax,
				});
				changed = true;
			} else {
				if (existing.defaultValue !== opt.defaultValue) { existing.defaultValue = opt.defaultValue; changed = true; }
				if (existing.min !== varMin) { existing.min = varMin; changed = true; }
				if (existing.max !== varMax) { existing.max = varMax; changed = true; }
			}
		}

		// --- Reconcile edge from parent menu-item to submenu ---
		const menuItemSub = parentNode!.subNodes.find(
			(s) => s.config[AUTO_TAG] === moduleId
		);
		if (menuItemSub) {
			const edgeExists = menuFlow.edges.some(
				(e) =>
					e.sourceNodeId === parentNode!.id &&
					e.targetNodeId === submenuNode!.id &&
					e.sourceSubNodeId === menuItemSub.id
			);
			if (!edgeExists) {
				const edge = createAutoEdge(
					parentNode!.id,
					submenuNode.id,
					menuItemSub.id,
					confirmButton
				);
				menuFlow.edges.push(edge);
				changed = true;
			}
		}

		submenuIndex++;
	}

	// --- Remove submenu nodes for deleted modules ---
	for (const [moduleId, submenuNode] of existingSubmenuNodes) {
		if (!activeModuleIds.has(moduleId)) {
			menuFlow.edges = menuFlow.edges.filter(
				(e) => e.sourceNodeId !== submenuNode.id && e.targetNodeId !== submenuNode.id
			);
			menuFlow.nodes = menuFlow.nodes.filter((n) => n.id !== submenuNode.id);
			changed = true;
		}
	}

	// --- Clean stale suppressions (module removed from gameplay) ---
	if (menuFlow.suppressedModuleMenus?.length) {
		const cleaned = menuFlow.suppressedModuleMenus.filter((id) => activeModuleIds.has(id));
		if (cleaned.length !== menuFlow.suppressedModuleMenus.length) {
			menuFlow.suppressedModuleMenus = cleaned.length > 0 ? cleaned : undefined;
			changed = true;
		}
	}

	// --- Remove edges whose source sub-node no longer exists ---
	const allSubNodeIds = new Set(menuFlow.nodes.flatMap((n) => n.subNodes.map((s) => s.id)));
	const prevEdgeLen = menuFlow.edges.length;
	menuFlow.edges = menuFlow.edges.filter((e) => {
		if (!e.sourceSubNodeId) return true;
		return allSubNodeIds.has(e.sourceSubNodeId);
	});
	if (menuFlow.edges.length !== prevEdgeLen) changed = true;

	// --- Remove parent node if empty ---
	const autoMenuItems = parentNode.subNodes.filter((s) => s.config[AUTO_TAG]);
	if (autoMenuItems.length === 0) {
		menuFlow.edges = menuFlow.edges.filter(
			(e) => e.sourceNodeId !== parentNode!.id && e.targetNodeId !== parentNode!.id
		);
		menuFlow.nodes = menuFlow.nodes.filter((n) => n !== parentNode);
		changed = true;
	}

	// --- Sync gameplay node variables from their options ---
	for (const modNode of allModuleNodes) {
		const md = modNode.moduleData!;
		for (const opt of md.options) {
			const isToggle = opt.type === 'toggle';
			const optMin = isToggle ? 0 : opt.min;
			const optMax = isToggle ? 1 : opt.max;
			const nodeVar = modNode.variables.find((v) => v.name === opt.variable);
			if (nodeVar) {
				if (nodeVar.defaultValue !== opt.defaultValue) { nodeVar.defaultValue = opt.defaultValue; changed = true; }
				if (nodeVar.min !== optMin) { nodeVar.min = optMin; changed = true; }
				if (nodeVar.max !== optMax) { nodeVar.max = optMax; changed = true; }
			}
		}
	}

	// --- Sync shared variables (all modules, including data-only) ---
	const allSharedVarNames = new Set<string>();
	for (const modNode of allModuleNodes) {
		const md = modNode.moduleData!;
		if (!md.alwaysActive) allSharedVarNames.add(md.enableVariable);
		for (const opt of md.options) {
			allSharedVarNames.add(opt.variable);
		}
	}

	for (const modNode of allModuleNodes) {
		const md = modNode.moduleData!;
		// alwaysActive modules don't need an enable variable
		if (md.alwaysActive) continue;
		if (!project.sharedVariables.some((v) => v.name === md.enableVariable)) {
			const enableOpt = md.options.find((o) => o.variable === md.enableVariable);
			project.sharedVariables.push({
				name: md.enableVariable,
				type: 'int',
				defaultValue: enableOpt?.defaultValue ?? 0,
				persist: true,
			});
			changed = true;
		}
		for (const opt of md.options) {
			if (opt.variable === md.enableVariable) continue;
			const existing = project.sharedVariables.find((v) => v.name === opt.variable);
			if (!existing) {
				project.sharedVariables.push({
					name: opt.variable,
					type: 'int',
					defaultValue: opt.defaultValue,
					persist: true,
					min: opt.min,
					max: opt.max,
				});
				changed = true;
			} else {
				if (existing.defaultValue !== opt.defaultValue) { existing.defaultValue = opt.defaultValue; changed = true; }
				if (existing.min !== opt.min) { existing.min = opt.min; changed = true; }
				if (existing.max !== opt.max) { existing.max = opt.max; changed = true; }
			}
		}
	}

	// Remove shared variables for deleted modules (conservative: only _Enabled pattern)
	const prevSharedLen = project.sharedVariables.length;
	project.sharedVariables = project.sharedVariables.filter((v) => {
		if (allSharedVarNames.has(v.name)) return true;
		if (v.name.endsWith('_Enabled')) return false;
		return true;
	});
	if (project.sharedVariables.length !== prevSharedLen) changed = true;

	return changed;
}

// ==================== Helper Functions ====================

function createParentSettingsNode(menuFlow: FlowGraph): FlowNode {
	const maxX = menuFlow.nodes.reduce((max, n) => Math.max(max, n.position.x), 0);
	return {
		id: crypto.randomUUID(),
		type: 'menu',
		label: 'Module Settings',
		position: { x: maxX + 300, y: 100 },
		gpcCode: '',
		comboCode: '',
		onEnter: '',
		onExit: '',
		initCode: '',
		variables: [],
		isInitialState: false,
		subNodes: [],
		oledScene: null,
		oledWidgets: [],
		stackOffsetX: 0,
		stackOffsetY: 0,
		chunkRef: null,
	};
}

function createModuleSubmenuNode(
	moduleName: string,
	moduleId: string,
	position: { x: number; y: number },
	cancelButton: string
): FlowNode {
	const node = createFlowNode('submenu', moduleName, position);
	node.chunkRef = AUTO_NODE_PREFIX + moduleId;
	node.backButton = cancelButton;
	return node;
}

function createMenuItemSubNode(moduleName: string, moduleId: string, order: number): SubNode {
	return {
		id: crypto.randomUUID(),
		type: 'menu-item',
		label: moduleName,
		displayText: moduleName,
		position: 'stack',
		order,
		interactive: true,
		config: {
			label: moduleName,
			cursorStyle: 'prefix',
			prefixChar: '>',
			prefixSpacing: 1,
			font: 'default',
			[AUTO_TAG]: moduleId,
		},
	};
}

function createToggleSubNode(
	label: string,
	variable: string,
	moduleId: string,
	order: number
): SubNode {
	return {
		id: crypto.randomUUID(),
		type: 'toggle-item',
		label,
		displayText: label,
		position: 'stack',
		order,
		interactive: true,
		config: {
			label,
			cursorStyle: 'prefix',
			prefixChar: '>',
			prefixSpacing: 1,
			onText: 'ON',
			offText: 'OFF',
			valueAlign: 'right',
			font: 'default',
			[AUTO_TAG]: moduleId,
		},
		boundVariable: variable,
	};
}

function createValueSubNode(
	label: string,
	variable: string,
	moduleId: string,
	order: number,
	min: number,
	max: number,
	onChangeCode?: string
): SubNode {
	return {
		id: crypto.randomUUID(),
		type: 'value-item',
		label,
		displayText: label,
		position: 'stack',
		order,
		interactive: true,
		config: {
			label,
			cursorStyle: 'prefix',
			prefixChar: '>',
			prefixSpacing: 1,
			min,
			max,
			step: 1,
			valueAlign: 'right',
			format: '{value}',
			font: 'default',
			[AUTO_TAG]: moduleId,
			...(onChangeCode ? { onChangeCode } : {}),
		},
		boundVariable: variable,
	};
}

function createArraySubNode(
	label: string,
	variable: string,
	moduleId: string,
	order: number,
	arrayName: string,
	arraySize: number,
	onChangeCode?: string
): SubNode {
	return {
		id: crypto.randomUUID(),
		type: 'array-item',
		label,
		displayText: label,
		position: 'stack',
		order,
		interactive: true,
		config: {
			label,
			cursorStyle: 'invert',
			prefixChar: '>',
			prefixSpacing: 1,
			arrayName,
			arraySize,
			useCountVar: false,
			countVar: '',
			font: 'default',
			[AUTO_TAG]: moduleId,
			...(onChangeCode ? { onChangeCode } : {}),
		},
		boundVariable: variable,
	};
}

function createAutoEdge(
	parentNodeId: string,
	submenuNodeId: string,
	menuItemSubNodeId: string,
	confirmButton: string
): FlowEdge {
	const edge = createFlowEdge(parentNodeId, submenuNodeId, 'Open', {
		type: 'button_press',
		button: confirmButton,
	});
	edge.sourceSubNodeId = menuItemSubNodeId;
	return edge;
}
