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
	const moduleNodes = allModuleNodes.filter((n) => n.moduleData!.options.length > 0);
	const moduleMap = new Map(moduleNodes.map((n) => [n.moduleData!.moduleId, n]));
	const activeModuleIds = new Set(moduleMap.keys());

	let changed = false;

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

	// Add missing menu-items
	for (const [moduleId, modNode] of moduleMap) {
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
		}));

		const desiredVarSet = new Set(desiredOptions.map((o) => o.variable));

		// Remove stale sub-nodes
		const staleSubNodes = autoSubNodes.filter(
			(s) => s.boundVariable && !desiredVarSet.has(s.boundVariable)
		);
		if (staleSubNodes.length > 0) {
			const staleSubIds = new Set(staleSubNodes.map((s) => s.id));
			submenuNode.subNodes = submenuNode.subNodes.filter((s) => !staleSubIds.has(s.id));
			changed = true;
		}

		// Add missing sub-nodes
		for (const opt of desiredOptions) {
			if (!existingVarMap.has(opt.variable)) {
				const order = submenuNode.subNodes.length;
				const subNode =
					opt.type === 'toggle'
						? createToggleSubNode(opt.label, opt.variable, moduleId, order)
						: createValueSubNode(
								opt.label,
								opt.variable,
								moduleId,
								order,
								opt.min ?? 0,
								opt.max ?? 100
							);
				submenuNode.subNodes.push(subNode);
				changed = true;
			}
		}

		// --- Reconcile submenu variables (add missing, never remove) ---
		const existingNodeVars = new Set(submenuNode.variables.map((v) => v.name));
		for (const opt of desiredOptions) {
			if (!existingNodeVars.has(opt.variable)) {
				submenuNode.variables.push({
					name: opt.variable,
					type: 'int',
					defaultValue: opt.defaultValue,
					persist: true,
					min: opt.min,
					max: opt.max,
				});
				changed = true;
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

	// --- Sync shared variables (all modules, including data-only) ---
	const allSharedVarNames = new Set<string>();
	for (const modNode of allModuleNodes) {
		const md = modNode.moduleData!;
		allSharedVarNames.add(md.enableVariable);
		for (const opt of md.options) {
			allSharedVarNames.add(opt.variable);
		}
	}

	for (const modNode of allModuleNodes) {
		const md = modNode.moduleData!;
		if (!project.sharedVariables.some((v) => v.name === md.enableVariable)) {
			project.sharedVariables.push({
				name: md.enableVariable,
				type: 'int',
				defaultValue: 0,
				persist: true,
			});
			changed = true;
		}
		for (const opt of md.options) {
			if (opt.variable === md.enableVariable) continue;
			if (!project.sharedVariables.some((v) => v.name === opt.variable)) {
				project.sharedVariables.push({
					name: opt.variable,
					type: 'int',
					defaultValue: opt.defaultValue,
					persist: true,
					min: opt.min,
					max: opt.max,
				});
				changed = true;
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
	max: number
): SubNode {
	return {
		id: crypto.randomUUID(),
		type: 'value-item',
		label,
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
