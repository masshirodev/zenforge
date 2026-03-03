import type { FlowNode, SubNode } from '$lib/types/flow';
import { getSubNodeDef } from '$lib/flow/subnodes/registry';

// Shared layout constants used by FlowNode, FlowCanvas, and FlowEdge
export const NODE_WIDTH = 220;
export const HEADER_HEIGHT = 28;
export const SUBNODE_ROW_HEIGHT = 24;
export const FOOTER_HEIGHT = 28;
export const MAX_VISIBLE_SUBNODES = 8;
export const MIN_BODY_HEIGHT = 40;
export const PORT_RADIUS = 6;

/**
 * Compute the rendered height of a node on the canvas.
 * Grows dynamically based on sub-node count, capped at ~250px unless expanded.
 */
export function getNodeHeight(node: FlowNode, expanded: boolean = false): number {
	if (node.subNodes.length === 0) {
		// Legacy / empty node: header + minimum body + footer
		return HEADER_HEIGHT + MIN_BODY_HEIGHT + FOOTER_HEIGHT;
	}

	const bodyHeight = node.subNodes.length * SUBNODE_ROW_HEIGHT;

	if (expanded) {
		return HEADER_HEIGHT + bodyHeight + FOOTER_HEIGHT;
	}

	const maxBody = MAX_VISIBLE_SUBNODES * SUBNODE_ROW_HEIGHT;
	return HEADER_HEIGHT + Math.min(bodyHeight, maxBody) + FOOTER_HEIGHT;
}

/**
 * Get the number of sub-nodes visible in the node body (before the "+N more" indicator).
 */
export function getVisibleSubNodeCount(node: FlowNode, expanded: boolean = false): number {
	if (expanded) return node.subNodes.length;
	return Math.min(node.subNodes.length, MAX_VISIBLE_SUBNODES);
}

/**
 * Get the sorted sub-nodes in display order.
 */
export function getSortedSubNodes(node: FlowNode): SubNode[] {
	return [...node.subNodes].sort((a, b) => a.order - b.order);
}

/**
 * Get the visual index of a sub-node within the node body.
 * Returns -1 if the sub-node is hidden (collapsed).
 */
export function getVisibleSubNodeIndex(
	node: FlowNode,
	subNodeId: string,
	expanded: boolean = false
): number {
	const sorted = getSortedSubNodes(node);
	const maxVisible = expanded ? sorted.length : MAX_VISIBLE_SUBNODES;
	const index = sorted.findIndex((sn) => sn.id === subNodeId);
	if (index < 0 || index >= maxVisible) return -1;
	return index;
}

/**
 * Get the position of a port (input or output) on a node.
 *
 * - Input port: left side, vertically centered in the footer area
 * - Output port (node-level): right side, vertically centered in the footer area
 * - Output port (sub-node): right side, vertically centered on the sub-node row
 */
export function getPortPosition(
	node: FlowNode,
	portType: 'input' | 'output',
	subNodeId?: string | null,
	expanded?: boolean
): { x: number; y: number } {
	const height = getNodeHeight(node, expanded);

	if (portType === 'input') {
		return {
			x: node.position.x,
			y: node.position.y + HEADER_HEIGHT / 2,
		};
	}

	// Output port
	if (!subNodeId) {
		// Node-level output port (in footer)
		return {
			x: node.position.x + NODE_WIDTH,
			y: node.position.y + height - FOOTER_HEIGHT / 2,
		};
	}

	// Sub-node output port
	const visIndex = getVisibleSubNodeIndex(node, subNodeId, expanded);
	if (visIndex >= 0) {
		return {
			x: node.position.x + NODE_WIDTH,
			y: node.position.y + HEADER_HEIGHT + visIndex * SUBNODE_ROW_HEIGHT + SUBNODE_ROW_HEIGHT / 2,
		};
	}

	// Hidden (collapsed) — fall back to footer area
	return {
		x: node.position.x + NODE_WIDTH,
		y: node.position.y + height - FOOTER_HEIGHT / 2,
	};
}

/**
 * Compute the Y position of a sub-node for OLED rendering (pixel coordinates).
 * Used by codegen and the emulator.
 */
export function computeSubNodePixelY(node: FlowNode, subNode: SubNode): number {
	if (subNode.position === 'absolute') return subNode.y ?? 0;

	// Pixel-art sub-nodes are full-screen overlays — always render at their own Y offset
	if (subNode.type === 'pixel-art') return subNode.y ?? 0;

	const stacked = getSortedSubNodes(node).filter((sn) => sn.position === 'stack');
	let y = node.stackOffsetY;
	for (const sn of stacked) {
		if (sn.id === subNode.id) return y;
		const def = getSubNodeDef(sn.type);
		// Skip pixel-art height in stack accumulation since they overlay
		if (sn.type === 'pixel-art') continue;
		y += def?.stackHeight ?? 8;
	}
	return y;
}
