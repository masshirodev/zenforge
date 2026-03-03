import type { SerializedScene } from '../../routes/tools/oled/types';

// ==================== Flow Types ====================

export type FlowType = 'menu' | 'gameplay';

// ==================== Flow Node Types ====================

export type FlowNodeType =
	| 'intro'
	| 'home'
	| 'menu'
	| 'submenu'
	| 'custom'
	| 'screensaver'
	| 'module';

export type FlowVariableType = 'int' | 'int8' | 'int16' | 'int32' | 'string';

// ==================== Sub-Node Types (v2) ====================

export type SubNodeType =
	| 'header'
	| 'menu-item'
	| 'toggle-item'
	| 'value-item'
	| 'array-item'
	| 'scroll-bar'
	| 'text-line'
	| 'bar'
	| 'indicator'
	| 'pixel-art'
	| 'separator'
	| 'blank'
	| 'custom';

export interface SubNode {
	id: string;
	type: SubNodeType;
	label: string;
	position: 'stack' | 'absolute';
	x?: number;
	y?: number;
	order: number;
	interactive: boolean;
	config: Record<string, unknown>;
	renderCode?: string;
	interactCode?: string;
	boundVariable?: string;
}

export interface SubNodeParam {
	key: string;
	label: string;
	type: 'number' | 'boolean' | 'select' | 'string' | 'code';
	default: unknown;
	min?: number;
	max?: number;
	options?: { value: unknown; label: string }[];
	description?: string;
}

export interface SubNodeRenderContext {
	pixels: Uint8Array;
	x: number;
	y: number;
	width: number;
	height: number;
	isSelected: boolean;
	cursorStyle: string;
	boundValue?: number | string;
}

export interface SubNodeCodegenContext {
	varPrefix: string;
	cursorVar: string;
	cursorIndex: number;
	x: number;
	y: number;
	boundVariable?: string;
	buttons: {
		confirm: string;
		cancel: string;
		up: string;
		down: string;
		left: string;
		right: string;
	};
	/** Name of the const string array for this node (e.g. "FlowText_Home") */
	stringArrayName: string;
	/** Shared mutable array — sub-nodes push their text strings here */
	strings: string[];
}

/** Register a string in the codegen context, returning its index. Deduplicates. */
export function addString(ctx: SubNodeCodegenContext, text: string): number {
	const existing = ctx.strings.indexOf(text);
	if (existing >= 0) return existing;
	ctx.strings.push(text);
	return ctx.strings.length - 1;
}

export interface SubNodeDef {
	id: string;
	name: string;
	category: string;
	description: string;
	interactive: boolean;
	defaultConfig: Record<string, unknown>;
	params: SubNodeParam[];
	width?: number;
	height?: number;
	stackHeight?: number;
	render: (config: Record<string, unknown>, ctx: SubNodeRenderContext) => void;
	generateGpc: (config: Record<string, unknown>, ctx: SubNodeCodegenContext) => string;
}

// ==================== Module Node Data (Gameplay Flow) ====================

export interface ModuleNodeOption {
	name: string;
	variable: string;
	type: 'toggle' | 'value';
	defaultValue: number;
	min?: number;
	max?: number;
}

export interface ModuleNodeData {
	moduleId: string;
	moduleName: string;
	triggerCondition: string;
	enableVariable: string;
	// Code sections
	initCode: string;
	mainCode: string;
	functionsCode: string;
	comboCode: string;
	/** @deprecated Use mainCode instead. Kept for migration. */
	triggerCode?: string;
	options: ModuleNodeOption[];
	extraVars: Record<string, string>;
	conflicts: string[];
	needsWeapondata: boolean;
	/** Weapon names for weapondata modules — generates Weapons[] array and WEAPON_COUNT */
	weaponNames?: string[];
}

export interface FlowVariable {
	name: string;
	type: FlowVariableType;
	defaultValue: number | string;
	persist: boolean;
	/** If true, this variable has independent values per profile */
	perProfile?: boolean;
	min?: number;
	max?: number;
	arraySize?: number;
}

export interface WidgetPlacement {
	widgetId: string;
	x: number;
	y: number;
	config: Record<string, unknown>;
	boundVariable?: string;
}

export interface FlowNode {
	id: string;
	type: FlowNodeType;
	label: string;
	position: { x: number; y: number };
	gpcCode: string;
	/** @deprecated Use subNodes with type='pixel-art' instead. Kept for migration. */
	oledScene: SerializedScene | null;
	/** @deprecated Use subNodes instead. Kept for migration. */
	oledWidgets: WidgetPlacement[];
	comboCode: string;
	isInitialState: boolean;
	variables: FlowVariable[];
	onEnter: string;
	onExit: string;
	chunkRef: string | null;
	// v2: sub-node system
	subNodes: SubNode[];
	stackOffsetX: number;
	stackOffsetY: number;
	visibleCount?: number;
	scrollMode?: 'window' | 'wrap';
	/** Button that navigates back to the previous state (e.g. 'PS5_CIRCLE') */
	backButton?: string;
	/** Module data for gameplay flow module nodes */
	moduleData?: ModuleNodeData;
}

// ==================== Flow Edge Types ====================

export type FlowConditionType =
	| 'button_press'
	| 'button_hold'
	| 'timeout'
	| 'variable'
	| 'custom';

export interface FlowCondition {
	type: FlowConditionType;
	button?: string;
	/** Modifier buttons that must be held (checked with get_val()) */
	modifiers?: string[];
	timeoutMs?: number;
	variable?: string;
	comparison?: '==' | '!=' | '>' | '<' | '>=' | '<=';
	value?: number;
	customCode?: string;
}

export interface FlowEdge {
	id: string;
	sourceNodeId: string;
	targetNodeId: string;
	sourcePort: string;
	targetPort: string;
	label: string;
	condition: FlowCondition;
	// v2: sub-node level edges
	sourceSubNodeId?: string | null;
	targetSubNodeId?: string | null;
}

// ==================== Flow Graph ====================

export interface FlowSettings {
	screenTimeoutMs: number;
	defaultFont: string;
	includeCommonUtils: boolean;
	persistenceEnabled: boolean;
	buttonMapping: {
		confirm: string;
		cancel: string;
		up: string;
		down: string;
		left: string;
		right: string;
	};
}

export interface FlowGraph {
	id: string;
	name: string;
	version: number;
	flowType: FlowType;
	nodes: FlowNode[];
	edges: FlowEdge[];
	globalVariables: FlowVariable[];
	globalCode: string;
	settings: FlowSettings;
	createdAt: number;
	updatedAt: number;
}

// ==================== Flow Profiles ====================

export interface FlowProfile {
	id: string;
	name: string;
	/** Per-profile variable overrides: varName -> value for this profile */
	variableOverrides: Record<string, number>;
}

export interface ProfileSwitchConfig {
	/** Button to switch to next profile */
	next: string;
	/** Button to switch to previous profile */
	prev: string;
	/** Optional modifier button that must be held */
	modifier?: string;
}

// ==================== Flow Project (Multi-Flow Container) ====================

export interface FlowProject {
	version: number;
	flows: FlowGraph[];
	sharedVariables: FlowVariable[];
	sharedCode: string;
	/** Profile definitions. Empty array = single implicit profile (no profile switching). */
	profiles?: FlowProfile[];
	/** Profile switch button configuration */
	profileSwitch?: ProfileSwitchConfig;
	updatedAt: number;
}

// ==================== Chunks ====================

export interface ChunkEdgeTemplate {
	label: string;
	condition: FlowCondition;
	direction: 'outgoing' | 'incoming';
	sourceSubNodeId?: string;
}

export interface ChunkParameter {
	key: string;
	label: string;
	type: 'string' | 'number' | 'boolean' | 'button' | 'code';
	defaultValue: string;
	description: string;
}

export interface FlowChunk {
	id: string;
	name: string;
	description: string;
	category: string;
	tags: string[];
	creator?: string;
	/** Which flow type this chunk belongs to. Defaults to 'menu' if unset. */
	flowType?: FlowType;
	nodeTemplate: Partial<FlowNode>;
	edgeTemplates: ChunkEdgeTemplate[];
	parameters: ChunkParameter[];
	createdAt: number;
	updatedAt: number;
}

// ==================== OLED Widget Types ====================

export interface WidgetParam {
	key: string;
	label: string;
	type: 'number' | 'boolean' | 'select';
	default: unknown;
	min?: number;
	max?: number;
	options?: { value: unknown; label: string }[];
}

export interface OledWidgetDef {
	id: string;
	name: string;
	category: 'bar' | 'indicator' | 'diagnostic' | 'decorative';
	description: string;
	width: number;
	height: number;
	params: WidgetParam[];
	render: (config: Record<string, unknown>, value: number, pixels: Uint8Array, x: number, y: number) => void;
	generateGpc: (config: Record<string, unknown>, varName: string, x: number, y: number) => string;
}

// ==================== Template Types ====================

export interface TemplateParam {
	key: string;
	label: string;
	type: 'string' | 'number' | 'boolean' | 'select';
	default: unknown;
	options?: { value: unknown; label: string }[];
	description: string;
}

export interface ScriptTemplate {
	id: string;
	name: string;
	description: string;
	category: 'state-machine' | 'oled-menu' | 'persistence' | 'screensaver' | 'utility';
	tags: string[];
	generatesCode: boolean;
	generatesFlowGraph: boolean;
	params: TemplateParam[];
	generateCode?: (params: Record<string, unknown>) => string;
	generateFlowGraph?: (params: Record<string, unknown>) => FlowGraph;
}

// ==================== Defaults / Helpers ====================

export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
	screenTimeoutMs: 5000,
	defaultFont: 'OLED_FONT_SMALL',
	includeCommonUtils: true,
	persistenceEnabled: true,
	buttonMapping: {
		confirm: 'PS5_CROSS',
		cancel: 'PS5_CIRCLE',
		up: 'PS5_UP',
		down: 'PS5_DOWN',
		left: 'PS5_LEFT',
		right: 'PS5_RIGHT',
	},
};

export function createEmptyFlowGraph(name: string, flowType: FlowType = 'menu'): FlowGraph {
	return {
		id: crypto.randomUUID(),
		name,
		version: 2,
		flowType,
		nodes: [],
		edges: [],
		globalVariables: [],
		globalCode: '',
		settings: { ...DEFAULT_FLOW_SETTINGS },
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}

export function createEmptyFlowProject(): FlowProject {
	return {
		version: 1,
		flows: [
			createEmptyFlowGraph('Menu Flow', 'menu'),
			createEmptyFlowGraph('Gameplay Flow', 'gameplay'),
		],
		sharedVariables: [],
		sharedCode: '',
		updatedAt: Date.now(),
	};
}

export function createFlowNode(
	type: FlowNodeType,
	label: string,
	position: { x: number; y: number }
): FlowNode {
	return {
		id: crypto.randomUUID(),
		type,
		label,
		position,
		gpcCode: '',
		oledScene: null,
		oledWidgets: [],
		comboCode: '',
		isInitialState: false,
		variables: [],
		onEnter: '',
		onExit: '',
		chunkRef: null,
		subNodes: [],
		stackOffsetX: 0,
		stackOffsetY: 0,
	};
}

export function createFlowEdge(
	sourceNodeId: string,
	targetNodeId: string,
	label: string,
	condition: FlowCondition
): FlowEdge {
	return {
		id: crypto.randomUUID(),
		sourceNodeId,
		targetNodeId,
		sourcePort: 'right',
		targetPort: 'left',
		label,
		condition,
		sourceSubNodeId: null,
		targetSubNodeId: null,
	};
}

export function createSubNode(
	type: SubNodeType,
	label: string,
	order: number,
	interactive: boolean = false
): SubNode {
	return {
		id: crypto.randomUUID(),
		type,
		label,
		position: 'stack',
		order,
		interactive,
		config: {},
	};
}

export const NODE_COLORS: Record<FlowNodeType, string> = {
	intro: '#3b82f6',
	home: '#22c55e',
	menu: '#a855f7',
	submenu: '#f97316',
	custom: '#6b7280',
	screensaver: '#06b6d4',
	module: '#ef4444',
};

export const NODE_LABELS: Record<FlowNodeType, string> = {
	intro: 'Intro',
	home: 'Home',
	menu: 'Menu',
	submenu: 'Submenu',
	custom: 'Custom',
	screensaver: 'Screensaver',
	module: 'Module',
};
