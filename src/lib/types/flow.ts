import type { SerializedScene } from '../../routes/tools/oled/types';

// ==================== Flow Types ====================

export type FlowType = 'menu' | 'gameplay' | 'data';

// ==================== Flow Node Types ====================

export type FlowNodeType =
	| 'intro'
	| 'home'
	| 'menu'
	| 'submenu'
	| 'custom'
	| 'screensaver'
	| 'module'
	| 'debug';

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

export interface SubNodeCondition {
	variable: string;
	comparison: '==' | '!=' | '>' | '<' | '>=' | '<=';
	value: number;
}

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
	/** When set, this sub-node only renders when the condition is met */
	condition?: SubNodeCondition;
	/** Text rendered on the OLED. When empty, falls back to label. */
	displayText?: string;
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
	/** Show this param only when another config key matches one of the given values */
	visibleWhen?: { key: string; values: unknown[] };
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
	y: number | string;
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
	/** Shared mutable array — sub-nodes push const image declarations here */
	images: string[];
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
	/** Generate input-handling GPC code (runs every cycle, separate from rendering). */
	generateGpcInput?: (config: Record<string, unknown>, ctx: SubNodeCodegenContext) => string;
}

// ==================== Module Node Data (Gameplay Flow) ====================

export interface ModuleNodeOption {
	name: string;
	variable: string;
	type: 'toggle' | 'value' | 'array';
	defaultValue: number;
	min?: number;
	max?: number;
	/** For 'array' type: name of the const string[] array in GPC code */
	arrayName?: string;
	/** For 'array' type: number of entries in the array */
	arraySize?: number;
	/** GPC code to run when the value changes in the menu (e.g. 'ApplyVMSpeed();') */
	onChangeCode?: string;
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
	/** Button/key params from module definition — key: param key, value: selected button constant */
	params?: Record<string, string>;
	/** Quick toggle: 1-2 controller buttons (e.g. ["PS5_L2","PS5_UP"]) or a single keyboard key (e.g. ["KEY_F1"]) */
	quickToggle?: string[];
	conflicts: string[];
	needsWeapondata: boolean;
	/** Weapon names for weapondata modules — generates Weapons[] array and WEAPON_COUNT */
	weaponNames?: string[];
	/** Per-weapon recoil values — flat array [V0, H0, V1, H1, ...] indexed by weapon order */
	weaponRecoilValues?: number[];
	/** Per-weapon ADT profiles for ADP (Weapon Detection) module */
	adpProfiles?: WeaponADTProfile[];
	/** When true, mainCode runs without enable variable guard and no Status toggle is created */
	alwaysActive?: boolean;
	/** Structured keyboard mappings for keyboard module — converted to GPC code at build time */
	keyboardMappings?: import('$lib/utils/keyboard-parser').KeyMapping[];
	/** Which flow tab this module belongs to: "gameplay" (default) or "data" */
	flowTarget?: string;
	/** Custom string arrays for arraybuilder module — each entry is a named array with string values */
	customArrays?: CustomArrayDef[];
}

/** A user-defined const string array for the Array Builder module */
export interface CustomArrayDef {
	name: string;
	countDefine: string;
	/** '1d' (default) or '2d' for array[][] */
	dimension?: '1d' | '2d';
	/** 1D values — used when dimension is '1d' or undefined */
	values: string[];
	/** 2D values — each row is a string[]; used when dimension is '2d' */
	values2d?: string[][];
}

/** ADT signature for a single weapon used by the ADP weapon detection module.
 *  Maps to ADP_Values[][] row: Mode, Start, F1, F2, StrLow, StrMid, StrHigh, 0, 0, Freq, 0 */
export interface WeaponADTProfile {
	/** Index into the Weapons[] array (1-based, 0 = auto/none) */
	weaponIndex: number;
	/** PS5_ADT_MODE value */
	mode: number;
	/** PS5_ADT_START value */
	start: number;
	/** PS5_ADT_FORCE1 value */
	force1: number;
	/** PS5_ADT_FORCE2 value */
	force2: number;
	/** PS5_ADT_STR_LOW value */
	strLow: number;
	/** PS5_ADT_STR_MID value */
	strMid: number;
	/** PS5_ADT_STR_HIGH value */
	strHigh: number;
	/** PS5_ADT_FREQ value */
	freq: number;
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
	/** Code injected into the init {} block (runs once at script startup, after Flow_Load) */
	initCode: string;
	chunkRef: string | null;
	// v2: sub-node system
	subNodes: SubNode[];
	stackOffsetX: number;
	stackOffsetY: number;
	lineMargin?: number;
	visibleCount?: number;
	scrollMode?: 'window' | 'wrap';
	/** Button that navigates back to the previous state (e.g. 'PS5_CIRCLE') */
	backButton?: string;
	/** When true, calls block_all_inputs() so menu navigation doesn't send inputs to the console */
	blockInputs?: boolean;
	/** Module data for gameplay flow module nodes */
	moduleData?: ModuleNodeData;
	/** Variable names of auto-generated sub-nodes the user intentionally removed */
	autoSuppressed?: string[];
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
			createEmptyFlowGraph('Data', 'data'),
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
	const node: FlowNode = {
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
		initCode: '',
		chunkRef: null,
		subNodes: [],
		stackOffsetX: 0,
		stackOffsetY: 0,
	};
	// Menu-like nodes default to PS5_CIRCLE as back button
	if (type === 'menu' || type === 'submenu' || type === 'home' || type === 'intro' || type === 'debug') {
		node.backButton = 'PS5_CIRCLE';
	}
	return node;
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
	debug: '#f59e0b',
};

export const NODE_LABELS: Record<FlowNodeType, string> = {
	intro: 'Intro',
	home: 'Home',
	menu: 'Menu',
	submenu: 'Submenu',
	custom: 'Custom',
	screensaver: 'Screensaver',
	module: 'Module',
	debug: 'Debug',
};
