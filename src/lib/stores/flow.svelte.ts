import type {
	FlowGraph,
	FlowNode,
	FlowEdge,
	FlowCondition,
	FlowVariable,
	FlowNodeType,
	FlowType,
	FlowProject,
	FlowProfile,
	ProfileSwitchConfig,
	WeaponDefaultsConfig,
	SubNode,
	SubNodeType,
} from '$lib/types/flow';
import {
	createEmptyFlowGraph,
	createEmptyFlowProject,
	createFlowNode,
	createFlowEdge,
	createSubNode,
} from '$lib/types/flow';
import { migrateFlowGraphV1toV2, ensureFlowProjectFlows, migrateKeyboardMappings } from '$lib/flow/migration';
import { syncModuleMenus } from '$lib/flow/auto-link';
import { getSubNodeDef } from '$lib/flow/subnodes/registry';

// ==================== Canvas State ====================

interface CanvasState {
	panX: number;
	panY: number;
	zoom: number;
}

// ==================== Editor State ====================

interface FlowEditorState {
	project: FlowProject | null;
	activeFlowType: FlowType;
	graph: FlowGraph | null; // working copy of the active flow
	gamePath: string | null;
	selectedNodeId: string | null;
	selectedNodeIds: string[]; // all selected nodes (multi-select)
	selectedEdgeId: string | null;
	selectedSubNodeId: string | null;
	canvas: CanvasState;
	dirty: boolean;
	connecting: ConnectingState | null;
}

interface ConnectingState {
	sourceNodeId: string;
	sourcePort: string;
	sourceSubNodeId?: string | null;
	mouseX: number;
	mouseY: number;
}

// ==================== Undo/Redo ====================

interface UndoEntry {
	graph: string; // JSON serialized FlowGraph
	description: string;
}

let undoStacks = $state<Record<FlowType, UndoEntry[]>>({ menu: [], gameplay: [], data: [] });
let redoStacks = $state<Record<FlowType, UndoEntry[]>>({ menu: [], gameplay: [], data: [] });
let canvasStates = $state<Record<FlowType, CanvasState>>({
	menu: { panX: 0, panY: 0, zoom: 1 },
	gameplay: { panX: 0, panY: 0, zoom: 1 },
	data: { panX: 0, panY: 0, zoom: 1 },
});

const MAX_UNDO = 50;

function pushUndo(description: string) {
	if (!state.graph) return;
	const ft = state.activeFlowType;
	undoStacks[ft] = [
		...undoStacks[ft].slice(-(MAX_UNDO - 1)),
		{ graph: JSON.stringify(state.graph), description },
	];
	redoStacks[ft] = [];
}

// ==================== State ====================

let state = $state<FlowEditorState>({
	project: null,
	activeFlowType: 'menu',
	graph: null,
	gamePath: null,
	selectedNodeId: null,
	selectedNodeIds: [],
	selectedEdgeId: null,
	selectedSubNodeId: null,
	canvas: { panX: 0, panY: 0, zoom: 1 },
	dirty: false,
	connecting: null,
});

// Track which nodes are expanded (showing all sub-nodes beyond max cap)
let expandedNodes = $state<Set<string>>(new Set());

// ==================== Getters ====================

export function getFlowStore() {
	return state;
}

export function getSelectedNode(): FlowNode | null {
	if (!state.graph || !state.selectedNodeId) return null;
	return state.graph.nodes.find((n) => n.id === state.selectedNodeId) ?? null;
}

export function getSelectedEdge(): FlowEdge | null {
	if (!state.graph || !state.selectedEdgeId) return null;
	return state.graph.edges.find((e) => e.id === state.selectedEdgeId) ?? null;
}

export function canUndo(): boolean {
	return undoStacks[state.activeFlowType].length > 0;
}

export function canRedo(): boolean {
	return redoStacks[state.activeFlowType].length > 0;
}

// ==================== Internal Helpers ====================

/** Sync current working graph back into the project's flows array */
function syncGraphToProject() {
	if (!state.project || !state.graph) return;
	state.project.flows = state.project.flows.map((f) =>
		f.flowType === state.activeFlowType ? state.graph! : f
	);
	state.project.updatedAt = Date.now();
}

/** Load the active flow from the project into state.graph */
function loadActiveFlow() {
	if (!state.project) {
		state.graph = null;
		return;
	}
	const flow = state.project.flows.find((f) => f.flowType === state.activeFlowType);
	state.graph = flow ?? null;
	state.canvas = canvasStates[state.activeFlowType];
}

function resetAllStacks() {
	undoStacks = { menu: [], gameplay: [], data: [] };
	redoStacks = { menu: [], gameplay: [], data: [] };
	canvasStates = {
		menu: { panX: 0, panY: 0, zoom: 1 },
		gameplay: { panX: 0, panY: 0, zoom: 1 },
		data: { panX: 0, panY: 0, zoom: 1 },
	};
}

// ==================== Graph Lifecycle ====================

export function newGraph(name: string, gamePath?: string) {
	const project = createEmptyFlowProject();
	state.project = project;
	state.activeFlowType = 'menu';
	state.gamePath = gamePath ?? null;
	state.selectedNodeId = null;
	state.selectedNodeIds = [];
	state.selectedEdgeId = null;
	state.selectedSubNodeId = null;
	state.dirty = true;
	resetAllStacks();
	loadActiveFlow();
	expandedNodes = new Set();
}

export function loadGraph(graph: FlowGraph, gamePath: string) {
	// Legacy: single graph load — wrap in project
	const migrated = migrateFlowGraphV1toV2(graph);
	if (!migrated.flowType) (migrated as FlowGraph).flowType = 'menu';
	const project: FlowProject = ensureFlowProjectFlows({
		version: 1,
		flows: [migrated],
		sharedVariables: [],
		sharedCode: '',
		updatedAt: Date.now(),
	});
	loadProject(project, gamePath);
}

export function loadProject(project: FlowProject, gamePath: string) {
	const ensured = ensureFlowProjectFlows(project);
	// Migrate each flow graph to v2, then migrate keyboard module data
	ensured.flows = ensured.flows.map((f) => migrateKeyboardMappings(migrateFlowGraphV1toV2(f)));
	state.project = ensured;
	state.activeFlowType = 'menu';
	state.gamePath = gamePath;
	state.selectedNodeId = null;
	state.selectedNodeIds = [];
	state.selectedEdgeId = null;
	state.selectedSubNodeId = null;
	state.dirty = false;
	resetAllStacks();
	loadActiveFlow();
	expandedNodes = new Set();
}

export function closeGraph() {
	state.project = null;
	state.graph = null;
	state.gamePath = null;
	state.selectedNodeId = null;
	state.selectedNodeIds = [];
	state.selectedEdgeId = null;
	state.selectedSubNodeId = null;
	state.dirty = false;
	resetAllStacks();
	expandedNodes = new Set();
}

export function markClean() {
	state.dirty = false;
}

// ==================== Flow Switching ====================

export function switchFlow(flowType: FlowType) {
	if (flowType === state.activeFlowType) return;
	// Save current graph and canvas state back to project
	syncGraphToProject();
	canvasStates[state.activeFlowType] = { ...state.canvas };
	// Switch
	state.activeFlowType = flowType;
	state.selectedNodeId = null;
	state.selectedNodeIds = [];
	state.selectedEdgeId = null;
	state.selectedSubNodeId = null;
	state.connecting = null;
	loadActiveFlow();
	expandedNodes = new Set();
}

/** Get the project with the current working graph synced in */
export function getSyncedProject(): FlowProject | null {
	if (!state.project) return null;
	syncGraphToProject();
	syncModuleMenus(state.project);
	// Reload active flow in case auto-link modified it
	loadActiveFlow();
	return state.project;
}

// ==================== Node Operations ====================

export function addNode(type: FlowNodeType, position: { x: number; y: number }): FlowNode | null {
	if (!state.graph) return null;
	pushUndo('Add node');
	const node = createFlowNode(type, type.charAt(0).toUpperCase() + type.slice(1), position);
	if (state.graph.nodes.length === 0) {
		node.isInitialState = true;
	}
	state.graph.nodes = [...state.graph.nodes, node];
	state.graph.updatedAt = Date.now();
	state.dirty = true;
	return node;
}

export function removeNode(nodeId: string) {
	if (!state.graph) return;
	pushUndo('Remove node');

	// Track removal of auto-generated module submenu nodes so syncModuleMenus won't recreate them
	const node = state.graph.nodes.find((n) => n.id === nodeId);
	if (node?.chunkRef?.startsWith('__auto_module:')) {
		const moduleId = node.chunkRef.slice('__auto_module:'.length);
		const menuFlow = state.project?.flows.find((f) => f.flowType === 'menu');
		if (menuFlow) {
			menuFlow.suppressedModuleMenus = [
				...(menuFlow.suppressedModuleMenus ?? []),
				moduleId,
			];
		}
	}

	state.graph.edges = state.graph.edges.filter(
		(e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId
	);
	const wasInitial = node?.isInitialState;
	state.graph.nodes = state.graph.nodes.filter((n) => n.id !== nodeId);
	if (wasInitial && state.graph.nodes.length > 0) {
		state.graph.nodes[0].isInitialState = true;
	}
	if (state.selectedNodeId === nodeId) state.selectedNodeId = null;
	state.selectedNodeIds = state.selectedNodeIds.filter((id) => id !== nodeId);
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

/** Remove multiple nodes at once (bulk delete). */
export function removeNodes(nodeIds: string[]) {
	if (!state.graph || nodeIds.length === 0) return;
	pushUndo('Remove nodes');
	const idSet = new Set(nodeIds);

	// Track removal of auto-generated module submenu nodes
	const menuFlow = state.project?.flows.find((f) => f.flowType === 'menu');
	if (menuFlow) {
		const suppressedIds: string[] = [];
		for (const n of state.graph.nodes) {
			if (idSet.has(n.id) && n.chunkRef?.startsWith('__auto_module:')) {
				suppressedIds.push(n.chunkRef.slice('__auto_module:'.length));
			}
		}
		if (suppressedIds.length > 0) {
			menuFlow.suppressedModuleMenus = [
				...(menuFlow.suppressedModuleMenus ?? []),
				...suppressedIds,
			];
		}
	}

	state.graph.edges = state.graph.edges.filter(
		(e) => !idSet.has(e.sourceNodeId) && !idSet.has(e.targetNodeId)
	);
	const wasInitial = state.graph.nodes.some((n) => idSet.has(n.id) && n.isInitialState);
	state.graph.nodes = state.graph.nodes.filter((n) => !idSet.has(n.id));
	if (wasInitial && state.graph.nodes.length > 0) {
		state.graph.nodes[0].isInitialState = true;
	}
	state.selectedNodeId = null;
	state.selectedNodeIds = [];
	state.selectedSubNodeId = null;
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

export function updateNode(nodeId: string, updates: Partial<FlowNode>) {
	if (!state.graph) return;
	pushUndo('Update node');
	state.graph.nodes = state.graph.nodes.map((n) =>
		n.id === nodeId ? { ...n, ...updates } : n
	);
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

export function moveNode(nodeId: string, position: { x: number; y: number }) {
	if (!state.graph) return;
	// No undo for drag moves — too many intermediate states
	state.graph.nodes = state.graph.nodes.map((n) =>
		n.id === nodeId ? { ...n, position } : n
	);
	state.dirty = true;
}

/** Move multiple nodes by a delta (for multi-select drag). */
export function moveNodes(deltas: { nodeId: string; position: { x: number; y: number } }[]) {
	if (!state.graph) return;
	const deltaMap = new Map(deltas.map((d) => [d.nodeId, d.position]));
	state.graph.nodes = state.graph.nodes.map((n) => {
		const pos = deltaMap.get(n.id);
		return pos ? { ...n, position: pos } : n;
	});
	state.dirty = true;
}

export function moveNodeDone(_nodeId?: string) {
	// Push undo after drag is complete
	pushUndo('Move node');
}

/** Auto-layout nodes in a left-to-right BFS grid based on edge connections. */
export function formatLayout() {
	if (!state.graph) return;
	pushUndo('Format layout');

	const nodes = state.graph.nodes;
	const edges = state.graph.edges;
	if (nodes.length === 0) return;

	const NODE_W = 260;
	const NODE_H = 160;
	const START_X = 100;
	const START_Y = 100;

	// Gameplay/Data flows: use grid layout (5 columns) since modules are independent
	if (state.activeFlowType !== 'menu') {
		const GRID_COLS = 5;
		state.graph.nodes = nodes.map((n, i) => ({
			...n,
			position: {
				x: START_X + (i % GRID_COLS) * NODE_W,
				y: START_Y + Math.floor(i / GRID_COLS) * NODE_H,
			},
		}));
		state.dirty = true;
		return;
	}

	// Menu flow: BFS-based layout following edges

	// Build adjacency map
	const outgoing = new Map<string, string[]>();
	for (const edge of edges) {
		if (!outgoing.has(edge.sourceNodeId)) outgoing.set(edge.sourceNodeId, []);
		outgoing.get(edge.sourceNodeId)!.push(edge.targetNodeId);
	}

	// BFS to assign columns
	const initialNode = nodes.find((n) => n.isInitialState) || nodes[0];
	const visited = new Set<string>();
	const columns = new Map<string, number>();
	const queue: { id: string; col: number }[] = [{ id: initialNode.id, col: 0 }];
	visited.add(initialNode.id);
	columns.set(initialNode.id, 0);

	while (queue.length > 0) {
		const { id, col } = queue.shift()!;
		const targets = outgoing.get(id) ?? [];
		for (const targetId of targets) {
			if (!visited.has(targetId)) {
				visited.add(targetId);
				columns.set(targetId, col + 1);
				queue.push({ id: targetId, col: col + 1 });
			}
		}
	}

	// Assign any unvisited nodes to the next column
	let maxCol = 0;
	for (const col of columns.values()) maxCol = Math.max(maxCol, col);
	for (const node of nodes) {
		if (!columns.has(node.id)) {
			maxCol++;
			columns.set(node.id, maxCol);
		}
	}

	// Group by column, then assign row positions
	const colNodes = new Map<number, string[]>();
	for (const [id, col] of columns) {
		if (!colNodes.has(col)) colNodes.set(col, []);
		colNodes.get(col)!.push(id);
	}

	state.graph.nodes = nodes.map((n) => {
		const col = columns.get(n.id) ?? 0;
		const nodesInCol = colNodes.get(col) ?? [n.id];
		const row = nodesInCol.indexOf(n.id);
		return {
			...n,
			position: {
				x: START_X + col * NODE_W,
				y: START_Y + row * NODE_H,
			},
		};
	});
	state.dirty = true;
}

export function setInitialState(nodeId: string) {
	if (!state.graph) return;
	pushUndo('Set initial state');
	state.graph.nodes = state.graph.nodes.map((n) => ({
		...n,
		isInitialState: n.id === nodeId,
	}));
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

export function duplicateNode(nodeId: string): FlowNode | null {
	if (!state.graph) return null;
	const source = state.graph.nodes.find((n) => n.id === nodeId);
	if (!source) return null;
	pushUndo('Duplicate node');
	const node: FlowNode = {
		...structuredClone(source),
		id: crypto.randomUUID(),
		label: `${source.label} Copy`,
		position: { x: source.position.x + 40, y: source.position.y + 40 },
		isInitialState: false,
	};
	// Regenerate sub-node IDs in the clone
	node.subNodes = node.subNodes.map((sn) => ({ ...sn, id: crypto.randomUUID() }));
	state.graph.nodes = [...state.graph.nodes, node];
	state.graph.updatedAt = Date.now();
	state.dirty = true;
	return node;
}

// ==================== Edge Operations ====================

export function addEdge(
	sourceNodeId: string,
	targetNodeId: string,
	label: string,
	condition: FlowCondition,
	sourceSubNodeId?: string | null
): FlowEdge | null {
	if (!state.graph) return null;
	// Allow same source/target only when sourceSubNodeId is set (sub-node → parent)
	if (sourceNodeId === targetNodeId && !sourceSubNodeId) return null;
	// Don't allow duplicate edges (same source node + sub-node + target)
	const exists = state.graph.edges.some(
		(e) =>
			e.sourceNodeId === sourceNodeId &&
			e.targetNodeId === targetNodeId &&
			(e.sourceSubNodeId ?? null) === (sourceSubNodeId ?? null)
	);
	if (exists) return null;
	pushUndo('Add edge');
	const edge = createFlowEdge(sourceNodeId, targetNodeId, label, condition);
	edge.sourceSubNodeId = sourceSubNodeId ?? null;
	state.graph.edges = [...state.graph.edges, edge];
	state.graph.updatedAt = Date.now();
	state.dirty = true;
	return edge;
}

export function removeEdge(edgeId: string) {
	if (!state.graph) return;
	pushUndo('Remove edge');
	state.graph.edges = state.graph.edges.filter((e) => e.id !== edgeId);
	if (state.selectedEdgeId === edgeId) state.selectedEdgeId = null;
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

export function updateEdge(edgeId: string, updates: Partial<FlowEdge>) {
	if (!state.graph) return;
	pushUndo('Update edge');
	state.graph.edges = state.graph.edges.map((e) =>
		e.id === edgeId ? { ...e, ...updates } : e
	);
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

// ==================== Selection ====================

export function selectNode(nodeId: string | null) {
	state.selectedNodeId = nodeId;
	state.selectedNodeIds = nodeId ? [nodeId] : [];
	state.selectedEdgeId = null;
	state.selectedSubNodeId = null;
}

/** Toggle a node in the multi-selection (Ctrl+Click). */
export function selectNodeMulti(nodeId: string) {
	const idx = state.selectedNodeIds.indexOf(nodeId);
	if (idx >= 0) {
		// Remove from selection
		state.selectedNodeIds = state.selectedNodeIds.filter((id) => id !== nodeId);
		state.selectedNodeId = state.selectedNodeIds[state.selectedNodeIds.length - 1] ?? null;
	} else {
		// Add to selection
		state.selectedNodeIds = [...state.selectedNodeIds, nodeId];
		state.selectedNodeId = nodeId;
	}
	state.selectedEdgeId = null;
	state.selectedSubNodeId = null;
}

/** Replace selection with a set of node IDs (rubber-band). */
export function selectNodesBatch(nodeIds: string[]) {
	state.selectedNodeIds = nodeIds;
	state.selectedNodeId = nodeIds[nodeIds.length - 1] ?? null;
	state.selectedEdgeId = null;
	state.selectedSubNodeId = null;
}

export function selectEdge(edgeId: string | null) {
	state.selectedEdgeId = edgeId;
	state.selectedNodeId = null;
	state.selectedNodeIds = [];
	state.selectedSubNodeId = null;
}

export function clearSelection() {
	state.selectedNodeId = null;
	state.selectedNodeIds = [];
	state.selectedEdgeId = null;
	state.selectedSubNodeId = null;
}

// ==================== Canvas ====================

export function setPan(x: number, y: number) {
	state.canvas.panX = x;
	state.canvas.panY = y;
}

export function setZoom(zoom: number) {
	state.canvas.zoom = Math.max(0.1, Math.min(3, zoom));
}

export function zoomToFit() {
	if (!state.graph || state.graph.nodes.length === 0) return;
	const nodes = state.graph.nodes;
	const padding = 100;
	const minX = Math.min(...nodes.map((n) => n.position.x)) - padding;
	const minY = Math.min(...nodes.map((n) => n.position.y)) - padding;
	const maxX = Math.max(...nodes.map((n) => n.position.x + 220)) + padding;
	const maxY = Math.max(...nodes.map((n) => n.position.y + 120)) + padding;
	const width = maxX - minX;
	const height = maxY - minY;
	// Zoom and pan are set by the canvas component based on its dimensions
	state.canvas.panX = -minX;
	state.canvas.panY = -minY;
	state.canvas.zoom = 1;
}

// ==================== Connecting ====================

export function startConnecting(
	sourceNodeId: string,
	sourcePort: string,
	mx: number,
	my: number,
	sourceSubNodeId?: string | null
) {
	state.connecting = { sourceNodeId, sourcePort, sourceSubNodeId, mouseX: mx, mouseY: my };
}

export function updateConnecting(mx: number, my: number) {
	if (state.connecting) {
		state.connecting = { ...state.connecting, mouseX: mx, mouseY: my };
	}
}

export function finishConnecting(targetNodeId: string | null) {
	if (state.connecting && targetNodeId) {
		addEdge(
			state.connecting.sourceNodeId,
			targetNodeId,
			'',
			{ type: 'button_press', button: 'PS5_CROSS' },
			state.connecting.sourceSubNodeId
		);
	}
	state.connecting = null;
}

export function cancelConnecting() {
	state.connecting = null;
}

// ==================== Undo/Redo ====================

export function undo() {
	const ft = state.activeFlowType;
	if (undoStacks[ft].length === 0 || !state.graph) return;
	const entry = undoStacks[ft][undoStacks[ft].length - 1];
	undoStacks[ft] = undoStacks[ft].slice(0, -1);
	redoStacks[ft] = [...redoStacks[ft], { graph: JSON.stringify(state.graph), description: entry.description }];
	state.graph = JSON.parse(entry.graph);
	state.dirty = true;
}

export function redo() {
	const ft = state.activeFlowType;
	if (redoStacks[ft].length === 0 || !state.graph) return;
	const entry = redoStacks[ft][redoStacks[ft].length - 1];
	redoStacks[ft] = redoStacks[ft].slice(0, -1);
	undoStacks[ft] = [...undoStacks[ft], { graph: JSON.stringify(state.graph), description: entry.description }];
	state.graph = JSON.parse(entry.graph);
	state.dirty = true;
}

// ==================== Global Variables ====================

export function addGlobalVariable(variable: FlowVariable) {
	if (!state.graph) return;
	pushUndo('Add global variable');
	state.graph.globalVariables = [...state.graph.globalVariables, variable];
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

export function removeGlobalVariable(name: string) {
	if (!state.graph) return;
	pushUndo('Remove global variable');
	state.graph.globalVariables = state.graph.globalVariables.filter((v) => v.name !== name);
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

export function updateGlobalCode(code: string) {
	if (!state.graph) return;
	pushUndo('Update global code');
	state.graph.globalCode = code;
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

// ==================== Sub-Node Selection ====================

export function selectSubNode(nodeId: string, subNodeId: string | null) {
	state.selectedNodeId = nodeId;
	state.selectedNodeIds = [nodeId];
	state.selectedSubNodeId = subNodeId;
	state.selectedEdgeId = null;
}

export function getSelectedSubNode(): SubNode | null {
	if (!state.graph || !state.selectedNodeId || !state.selectedSubNodeId) return null;
	const node = state.graph.nodes.find((n) => n.id === state.selectedNodeId);
	return node?.subNodes.find((s) => s.id === state.selectedSubNodeId) ?? null;
}

// ==================== Sub-Node CRUD ====================

export function addSubNode(nodeId: string, type: SubNodeType, label: string): SubNode | null {
	if (!state.graph) return null;
	const node = state.graph.nodes.find((n) => n.id === nodeId);
	if (!node) return null;

	const def = getSubNodeDef(type);
	const interactive = def?.interactive ?? false;
	const order = node.subNodes.length;

	pushUndo('Add sub-node');
	const sn = createSubNode(type, label, order, interactive);
	sn.config = def?.defaultConfig ? { ...def.defaultConfig, label } : { label };

	// Auto-create variable for toggle/value items
	if ((type === 'toggle-item' || type === 'value-item') && node) {
		const sanitize = (s: string) =>
			s.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
		const baseVarName = `${sanitize(node.label)}_${sanitize(label)}`;

		// Check ALL nodes' variables + global variables for uniqueness
		const allVarNames = new Set<string>();
		for (const n of state.graph!.nodes) {
			for (const v of n.variables) allVarNames.add(v.name);
		}
		for (const v of state.graph!.globalVariables) allVarNames.add(v.name);

		let varName = baseVarName;
		let suffix = 2;
		while (allVarNames.has(varName)) {
			varName = `${baseVarName}_${suffix++}`;
		}

		node.variables = [
			...node.variables,
			{
				name: varName,
				type: 'int' as const,
				defaultValue: 0,
				persist: false,
				min: type === 'value-item' ? 0 : undefined,
				max: type === 'value-item' ? 100 : undefined,
			},
		];
		sn.boundVariable = varName;
	}

	node.subNodes = [...node.subNodes, sn];
	state.graph.nodes = state.graph.nodes.map((n) => (n.id === nodeId ? { ...node } : n));
	state.graph.updatedAt = Date.now();
	state.dirty = true;
	return sn;
}

export function removeSubNode(nodeId: string, subNodeId: string) {
	if (!state.graph) return;
	const node = state.graph.nodes.find((n) => n.id === nodeId);
	if (!node) return;

	pushUndo('Remove sub-node');

	// Track removal of auto-generated sub-nodes so syncModuleMenus won't re-create them
	const removedSub = node.subNodes.find((sn) => sn.id === subNodeId);
	if (removedSub?.config?.['__auto_module'] && removedSub.boundVariable) {
		node.autoSuppressed = [...(node.autoSuppressed ?? []), removedSub.boundVariable];
	}

	// Remove edges that reference this sub-node
	state.graph.edges = state.graph.edges.filter(
		(e) => e.sourceSubNodeId !== subNodeId && e.targetSubNodeId !== subNodeId
	);

	// Remove the sub-node and reorder remaining
	const filtered = node.subNodes.filter((sn) => sn.id !== subNodeId);
	node.subNodes = filtered.map((sn, i) => ({ ...sn, order: i }));

	state.graph.nodes = state.graph.nodes.map((n) => (n.id === nodeId ? { ...node } : n));

	if (state.selectedSubNodeId === subNodeId) state.selectedSubNodeId = null;
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

export function updateSubNode(nodeId: string, subNodeId: string, updates: Partial<SubNode>) {
	if (!state.graph) return;
	pushUndo('Update sub-node');
	state.graph.nodes = state.graph.nodes.map((n) => {
		if (n.id !== nodeId) return n;
		return {
			...n,
			subNodes: n.subNodes.map((sn) => (sn.id === subNodeId ? { ...sn, ...updates } : sn)),
		};
	});
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

export function reorderSubNodes(nodeId: string, fromIndex: number, toIndex: number) {
	if (!state.graph) return;
	const node = state.graph.nodes.find((n) => n.id === nodeId);
	if (!node) return;

	pushUndo('Reorder sub-nodes');
	const sorted = [...node.subNodes].sort((a, b) => a.order - b.order);
	const [moved] = sorted.splice(fromIndex, 1);
	sorted.splice(toIndex, 0, moved);
	const reordered = sorted.map((sn, i) => ({ ...sn, order: i }));

	state.graph.nodes = state.graph.nodes.map((n) =>
		n.id === nodeId ? { ...n, subNodes: reordered } : n
	);
	state.graph.updatedAt = Date.now();
	state.dirty = true;
}

// ==================== Node Expand/Collapse ====================

export function toggleNodeExpanded(nodeId: string) {
	const next = new Set(expandedNodes);
	if (next.has(nodeId)) next.delete(nodeId);
	else next.add(nodeId);
	expandedNodes = next;
}

export function isNodeExpanded(nodeId: string): boolean {
	return expandedNodes.has(nodeId);
}

export function getExpandedNodes(): Set<string> {
	return expandedNodes;
}

// ==================== Profile Management ====================

export function getProfiles(): FlowProfile[] {
	return state.project?.profiles ?? [];
}

export function getProfileSwitch(): ProfileSwitchConfig | undefined {
	return state.project?.profileSwitch;
}

export function addProfile(name: string) {
	if (!state.project) return;
	pushUndo('Add profile');
	const profiles = [...(state.project.profiles ?? [])];
	profiles.push({
		id: crypto.randomUUID(),
		name,
		variableOverrides: {},
	});
	state.project = { ...state.project, profiles, updatedAt: Date.now() };
	state.dirty = true;
}

export function removeProfile(profileId: string) {
	if (!state.project) return;
	pushUndo('Remove profile');
	const profiles = (state.project.profiles ?? []).filter((p) => p.id !== profileId);
	state.project = { ...state.project, profiles, updatedAt: Date.now() };
	state.dirty = true;
}

export function updateProfile(profileId: string, updates: Partial<FlowProfile>) {
	if (!state.project) return;
	pushUndo('Update profile');
	const profiles = (state.project.profiles ?? []).map((p) =>
		p.id === profileId ? { ...p, ...updates } : p
	);
	state.project = { ...state.project, profiles, updatedAt: Date.now() };
	state.dirty = true;
}

export function setProfileSwitch(config: ProfileSwitchConfig | undefined) {
	if (!state.project) return;
	pushUndo('Update profile switch');
	state.project = { ...state.project, profileSwitch: config, updatedAt: Date.now() };
	state.dirty = true;
}

// ==================== Weapon Defaults ====================

export function getWeaponDefaults(): WeaponDefaultsConfig | undefined {
	return state.project?.weaponDefaults;
}

export function setWeaponDefaults(config: WeaponDefaultsConfig | undefined) {
	if (!state.project) return;
	pushUndo('Update weapon defaults');
	state.project = { ...state.project, weaponDefaults: config, updatedAt: Date.now() };
	state.dirty = true;
}

export function toggleWeaponDefaultVar(varName: string, enabled: boolean) {
	if (!state.project) return;
	pushUndo('Toggle weapon default variable');
	const current = state.project.weaponDefaults ?? {
		enabledVars: [],
		overrides: {},
		rememberTweaks: false,
	};
	const enabledVars = enabled
		? [...current.enabledVars.filter((v) => v !== varName), varName]
		: current.enabledVars.filter((v) => v !== varName);

	// When removing a variable, also clean it from all overrides
	let overrides = current.overrides;
	if (!enabled) {
		overrides = { ...overrides };
		for (const key of Object.keys(overrides)) {
			const weaponOverrides = { ...overrides[Number(key)] };
			delete weaponOverrides[varName];
			if (Object.keys(weaponOverrides).length === 0) {
				delete overrides[Number(key)];
			} else {
				overrides[Number(key)] = weaponOverrides;
			}
		}
	}

	state.project = {
		...state.project,
		weaponDefaults: { ...current, enabledVars, overrides },
		updatedAt: Date.now(),
	};
	state.dirty = true;
}

export function updateWeaponOverride(
	weaponIndex: number,
	varName: string,
	value: number | undefined
) {
	if (!state.project) return;
	pushUndo('Update weapon override');
	const current = state.project.weaponDefaults ?? {
		enabledVars: [],
		overrides: {},
		rememberTweaks: false,
	};
	const overrides = { ...current.overrides };
	if (value !== undefined) {
		overrides[weaponIndex] = { ...(overrides[weaponIndex] ?? {}), [varName]: value };
	} else {
		if (overrides[weaponIndex]) {
			const weaponOverrides = { ...overrides[weaponIndex] };
			delete weaponOverrides[varName];
			if (Object.keys(weaponOverrides).length === 0) {
				delete overrides[weaponIndex];
			} else {
				overrides[weaponIndex] = weaponOverrides;
			}
		}
	}
	state.project = {
		...state.project,
		weaponDefaults: { ...current, overrides },
		updatedAt: Date.now(),
	};
	state.dirty = true;
}

export function setRememberTweaks(value: boolean) {
	if (!state.project) return;
	pushUndo('Toggle remember tweaks');
	const current = state.project.weaponDefaults ?? {
		enabledVars: [],
		overrides: {},
		rememberTweaks: false,
	};
	state.project = {
		...state.project,
		weaponDefaults: { ...current, rememberTweaks: value },
		updatedAt: Date.now(),
	};
	state.dirty = true;
}

// ==================== Variable Defaults ====================

/** Update the base default value of a variable across all locations it appears */
export function updateVariableDefault(varName: string, newDefault: number) {
	if (!state.project) return;
	pushUndo('Update variable default');

	const updateInList = (vars: FlowVariable[]) =>
		vars.map((v) => (v.name === varName ? { ...v, defaultValue: newDefault } : v));

	state.project = {
		...state.project,
		sharedVariables: updateInList(state.project.sharedVariables),
		flows: state.project.flows.map((f) => ({
			...f,
			globalVariables: updateInList(f.globalVariables),
			nodes: f.nodes.map((n) => ({
				...n,
				variables: updateInList(n.variables),
			})),
		})),
		updatedAt: Date.now(),
	};
	// Keep working graph in sync
	if (state.graph) {
		state.graph = {
			...state.graph,
			globalVariables: updateInList(state.graph.globalVariables),
			nodes: state.graph.nodes.map((n) => ({
				...n,
				variables: updateInList(n.variables),
			})),
		};
	}
	state.dirty = true;
}

/** Collect all non-string variables from the project, deduplicated by name */
export function getAllProjectVariables(): FlowVariable[] {
	if (!state.project) return [];
	const vars: FlowVariable[] = [];
	const seen = new Set<string>();
	const add = (v: FlowVariable) => {
		if (v.type !== 'string' && !seen.has(v.name)) {
			vars.push(v);
			seen.add(v.name);
		}
	};
	for (const v of state.project.sharedVariables) add(v);
	for (const flow of state.project.flows) {
		for (const v of flow.globalVariables) add(v);
		for (const node of flow.nodes) {
			for (const v of node.variables) add(v);
		}
	}
	return vars;
}
