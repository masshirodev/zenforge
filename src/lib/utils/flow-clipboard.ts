import type { FlowNode, SubNode, FlowVariable } from '$lib/types/flow';

// Clipboard format prefixes (version 1)
const NODE_PREFIX = 'ZFN1:';
const SUBNODE_PREFIX = 'ZFS1:';

/** Portable node payload — no IDs, no position. */
interface NodePayload {
	type: FlowNode['type'];
	label: string;
	gpcCode: string;
	comboCode: string;
	variables: FlowVariable[];
	onEnter: string;
	onExit: string;
	initCode: string;
	subNodes: Omit<SubNode, 'id'>[];
	stackOffsetX: number;
	stackOffsetY: number;
	lineMargin?: number;
	visibleCount?: number;
	scrollMode?: 'window' | 'wrap';
	backButton?: string;
	backKey?: string;
	blockInputs?: boolean;
	onChangeVariable?: string;
	onChangeCode?: string;
	moduleData?: FlowNode['moduleData'];
	autoSuppressed?: string[];
}

/** Portable subnode payload — no ID. */
type SubNodePayload = Omit<SubNode, 'id'>;

/** Encode a flow node for clipboard sharing. */
export function encodeNode(node: FlowNode): string {
	const payload: NodePayload = {
		type: node.type,
		label: node.label,
		gpcCode: node.gpcCode,
		comboCode: node.comboCode,
		variables: node.variables,
		onEnter: node.onEnter,
		onExit: node.onExit,
		initCode: node.initCode,
		subNodes: node.subNodes.map(({ id: _, ...rest }) => rest),
		stackOffsetX: node.stackOffsetX,
		stackOffsetY: node.stackOffsetY,
		lineMargin: node.lineMargin,
		visibleCount: node.visibleCount,
		scrollMode: node.scrollMode,
		backButton: node.backButton,
		backKey: node.backKey,
		blockInputs: node.blockInputs,
		onChangeVariable: node.onChangeVariable,
		onChangeCode: node.onChangeCode,
		moduleData: node.moduleData,
		autoSuppressed: node.autoSuppressed,
	};
	return NODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

/** Encode a subnode for clipboard sharing. */
export function encodeSubNode(subNode: SubNode): string {
	const { id: _, ...payload } = subNode;
	return SUBNODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

export type DecodeResult =
	| { kind: 'node'; payload: NodePayload }
	| { kind: 'subnode'; payload: SubNodePayload }
	| null;

/** Decode a clipboard string. Returns null if not a valid flow clipboard payload. */
export function decode(text: string): DecodeResult {
	try {
		if (text.startsWith(NODE_PREFIX)) {
			const json = decodeURIComponent(escape(atob(text.slice(NODE_PREFIX.length))));
			return { kind: 'node', payload: JSON.parse(json) as NodePayload };
		}
		if (text.startsWith(SUBNODE_PREFIX)) {
			const json = decodeURIComponent(escape(atob(text.slice(SUBNODE_PREFIX.length))));
			return { kind: 'subnode', payload: JSON.parse(json) as SubNodePayload };
		}
	} catch {
		// Invalid base64 or JSON
	}
	return null;
}
