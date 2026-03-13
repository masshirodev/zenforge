import type { SerializedScene } from '../../routes/tools/oled/types';

export interface FlowOledLayer {
	subNodeId: string;
	label: string;
	pixels: string; // base64
	visible: boolean;
	condition?: {
		variable?: string;
		operator?: string;
		value?: string;
	} | null;
}

export interface FlowOledTransfer {
	nodeId: string;
	subNodeId?: string;
	scene: SerializedScene;
	returnTo: string | null; // game path
	returnPath?: string; // route to navigate back to (e.g. '/' for flow tab, '/tools/flow' for standalone)
	/** Base64-encoded pixel buffers from other pixel-art subnodes in the same node (for overlay preview) */
	overlayPixels?: string[];
	/** Layer mode: all pixel-art subnodes as editable layers */
	layers?: FlowOledLayer[];
	/** Animation mode: scenes + config from an animation subnode */
	animation?: {
		subNodeId: string;
		scenes: SerializedScene[];
		frameDelayMs: number;
		loop: boolean;
	};
}

let transfer = $state<FlowOledTransfer | null>(null);

export function getFlowOledTransfer(): FlowOledTransfer | null {
	return transfer;
}

export function setFlowOledTransfer(data: FlowOledTransfer): void {
	transfer = data;
}

export function clearFlowOledTransfer(): void {
	transfer = null;
}
