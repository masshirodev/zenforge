export const OLED_WIDTH = 128;
export const OLED_HEIGHT = 64;
export const OLED_BYTES = (OLED_WIDTH * OLED_HEIGHT) / 8; // 1024

export interface OledScene {
	id: string;
	name: string;
	pixels: Uint8Array; // 1024 bytes = 128x64 bits, row-major, MSB first
}

export type DrawTool = 'pen' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'text' | 'move' | 'select';

export type FontSize = '3x5' | '5x7' | '8x8';

export type TextAlign = 'left' | 'center' | 'right';

export interface TextState {
	text: string;
	fontSize: FontSize;
	align: TextAlign;
	originX: number; // -1 = not placed
	originY: number;
}

export interface BrushShape {
	type: 'square' | 'circle';
	width: number; // 1-128
	height: number; // 1-64
}

export interface ToolState {
	tool: DrawTool;
	brush: BrushShape;
}

export interface AnimationConfig {
	frameDelayMs: number;
	loop: boolean;
}

export interface SelectionState {
	/** Selection rectangle bounds (-1 = no selection) */
	x: number;
	y: number;
	w: number;
	h: number;
	/** Floating pixels that have been "picked up" for moving */
	floating: Uint8Array | null;
	/** Offset of floating selection from its original position */
	floatingX: number;
	floatingY: number;
	/** Whether we're currently dragging the selection to move it */
	isDragging: boolean;
}

export interface Guide {
	position: number; // pixel position (0-127 for vertical, 0-63 for horizontal)
	axis: 'h' | 'v'; // h = horizontal line, v = vertical line
}

export interface OledLayer {
	id: string; // matches the subNodeId from the flow editor
	label: string;
	pixels: Uint8Array;
	visible: boolean;
	condition?: {
		variable?: string;
		operator?: string;
		value?: string;
	} | null;
}

export type ExportFormat = 'pixel_calls' | 'array_8bit' | 'array_16bit';

export interface OledProject {
	version: 1;
	scenes: SerializedScene[];
	activeSceneId: string;
	animation: AnimationConfig;
}

export interface SerializedScene {
	id: string;
	name: string;
	pixels: string; // Base64-encoded Uint8Array
}
