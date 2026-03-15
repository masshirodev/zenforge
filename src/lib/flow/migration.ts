import type { FlowGraph, FlowProject, FlowVariable, SubNode } from '$lib/types/flow';
import { createEmptyFlowGraph } from '$lib/types/flow';
import { parseKeyboardMappings } from '$lib/utils/keyboard-parser';

/**
 * Maps v1 widget IDs to v2 sub-node types and style configs.
 */
const WIDGET_ID_MAP: Record<string, { type: 'bar' | 'indicator'; style: string }> = {
	'bar-recessed': { type: 'bar', style: 'recessed' },
	'bar-gradient': { type: 'bar', style: 'gradient' },
	'bar-chunky': { type: 'bar', style: 'chunky' },
	'bar-notched': { type: 'bar', style: 'notched' },
	'bar-equalizer': { type: 'bar', style: 'equalizer' },
	'indicator-cell-signal': { type: 'indicator', style: 'cell-signal' },
	'indicator-led-strip': { type: 'indicator', style: 'led-strip' },
	'diagnostic-bar': { type: 'bar', style: 'recessed' },
	'diagnostic-bidir': { type: 'bar', style: 'recessed' },
};

/**
 * Wraps a legacy single FlowGraph into a FlowProject container.
 * Tags the existing graph as a menu flow and creates an empty gameplay flow.
 */
export function migrateFlowJsonToProject(graph: FlowGraph): FlowProject {
	const migrated = migrateFlowGraphV1toV2(graph);
	if (!migrated.flowType) {
		(migrated as FlowGraph).flowType = 'menu';
	}
	return {
		version: 1,
		flows: [migrated, createEmptyFlowGraph('Gameplay Flow', 'gameplay'), createEmptyFlowGraph('Data', 'data')],
		sharedVariables: [],
		sharedCode: '',
		updatedAt: Date.now(),
	};
}

/**
 * Ensures a FlowProject has both menu and gameplay flows.
 * Adds missing flows if needed (e.g. after loading a migrated project).
 */
export function ensureFlowProjectFlows(project: FlowProject): FlowProject {
	const hasMenu = project.flows.some((f) => f.flowType === 'menu');
	const hasGameplay = project.flows.some((f) => f.flowType === 'gameplay');
	const hasData = project.flows.some((f) => f.flowType === 'data');

	if (hasMenu && hasGameplay && hasData) return project;

	const result = structuredClone(project);
	if (!hasMenu) {
		result.flows.unshift(createEmptyFlowGraph('Menu Flow', 'menu'));
	}
	if (!hasGameplay) {
		result.flows.push(createEmptyFlowGraph('Gameplay Flow', 'gameplay'));
	}
	if (!hasData) {
		result.flows.push(createEmptyFlowGraph('Data', 'data'));
	}
	return result;
}

/**
 * Migrates a v1 FlowGraph to v2 format.
 * - Converts oledScene to a pixel-art sub-node
 * - Converts oledWidgets to bar/indicator sub-nodes
 * - Adds default values for new v2 fields
 *
 * v2+ graphs pass through unchanged.
 */
export function migrateFlowGraphV1toV2(graph: FlowGraph): FlowGraph {
	if (graph.version >= 2) return graph;

	const migrated = structuredClone(graph);
	migrated.version = 2;

	for (const node of migrated.nodes) {
		// Ensure v2 fields exist
		if (!node.subNodes) node.subNodes = [];
		if (node.stackOffsetX == null) node.stackOffsetX = 0;
		if (node.stackOffsetY == null) node.stackOffsetY = 0;
		if ((node as unknown as Record<string, unknown>).initCode == null) node.initCode = '';

		let order = 0;

		// Convert oledScene to a pixel-art sub-node
		if (node.oledScene) {
			const pixelArtSubNode: SubNode = {
				id: crypto.randomUUID(),
				type: 'pixel-art',
				label: 'OLED Scene',
				position: 'absolute',
				x: 0,
				y: 0,
				order: order++,
				interactive: false,
				config: {
					scene: node.oledScene,
					width: 128,
					height: 64,
				},
			};
			node.subNodes.push(pixelArtSubNode);
		}

		// Convert each oledWidget to a bar/indicator sub-node
		if (node.oledWidgets) {
			for (const wp of node.oledWidgets) {
				const mapping = WIDGET_ID_MAP[wp.widgetId];
				if (mapping) {
					const subNode: SubNode = {
						id: crypto.randomUUID(),
						type: mapping.type,
						label: wp.widgetId,
						position: 'absolute',
						x: wp.x,
						y: wp.y,
						order: order++,
						interactive: false,
						config: {
							...wp.config,
							style: mapping.style,
						},
						boundVariable: wp.boundVariable,
					};
					node.subNodes.push(subNode);
				}
			}
		}
	}

	// Ensure v2 edge fields exist
	for (const edge of migrated.edges) {
		if (edge.sourceSubNodeId === undefined) edge.sourceSubNodeId = null;
		if (edge.targetSubNodeId === undefined) edge.targetSubNodeId = null;
	}

	return migrated;
}

/**
 * Migrates toggle variables from 'int' to 'bool' type.
 * Detects toggles by:
 *   1. min=0, max=1 with defaultValue 0 or 1
 *   2. Name ends with 'Status' (module enable vars)
 *   3. Variable matches a module option with type 'toggle'
 */
export function migrateBoolVariables(graph: FlowGraph): FlowGraph {
	// Collect toggle variable names from module node options
	const moduleToggleVars = new Set<string>();
	for (const node of graph.nodes) {
		if (node.moduleData) {
			// The enable variable is always a toggle
			if (node.moduleData.enableVariable) {
				moduleToggleVars.add(node.moduleData.enableVariable);
			}
			// Check each option's type
			for (const opt of node.moduleData.options ?? []) {
				if (opt.type === 'toggle') {
					moduleToggleVars.add(opt.variable);
				}
			}
		}
	}

	function upgrade(v: FlowVariable) {
		if (v.type === 'bool') return;
		const isBoolRange = v.min === 0 && v.max === 1 && (v.defaultValue === 0 || v.defaultValue === 1);
		const isModuleToggle = moduleToggleVars.has(v.name);
		const isStatusVar = v.name.endsWith('Status') && (v.defaultValue === 0 || v.defaultValue === 1);
		if (isBoolRange || isModuleToggle || isStatusVar) {
			v.type = 'bool';
			v.min = 0;
			v.max = 1;
		}
	}
	for (const v of graph.globalVariables) upgrade(v);
	for (const node of graph.nodes) {
		for (const v of node.variables) upgrade(v);
	}
	return graph;
}

/**
 * Migrates keyboard module nodes from comboCode-based mappings to structured keyboardMappings.
 * Parses the ApplyKeyboard() function from comboCode and stores the result as keyboardMappings[].
 * Clears comboCode after migration so code is generated from data at build time.
 */
export function migrateKeyboardMappings(graph: FlowGraph): FlowGraph {
	for (const node of graph.nodes) {
		const md = node.moduleData;
		if (!md || md.moduleId !== 'keyboard') continue;
		if (md.keyboardMappings !== undefined) continue; // already migrated

		const mappings = parseKeyboardMappings(md.comboCode);
		md.keyboardMappings = mappings;
		md.comboCode = '';
	}
	return graph;
}
