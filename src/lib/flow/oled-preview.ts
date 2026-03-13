import type { FlowNode, SubNodeRenderContext } from '$lib/types/flow';
import { getSubNodeDef } from '$lib/flow/subnodes/registry';
import { computeSubNodePixelY, getSortedSubNodes } from '$lib/flow/layout';

/**
 * Render a flow node's sub-nodes into a 128x64 monochrome pixel buffer.
 * This is a lightweight version of the emulator's render() that doesn't
 * require emulator state.
 */
export function renderNodePreview(node: FlowNode): Uint8Array {
	const pixels = new Uint8Array(1024); // 128x64 / 8

	if (node.subNodes.length === 0) return pixels;

	const sortedSubs = getSortedSubNodes(node);

	for (const sub of sortedSubs) {
		if (sub.hidden) continue;
		const def = getSubNodeDef(sub.type);
		if (!def) continue;

		const pixelY = computeSubNodePixelY(node, sub);
		const pixelX = sub.position === 'absolute' ? (sub.x ?? 0) : node.stackOffsetX;

		const ctx: SubNodeRenderContext = {
			pixels,
			x: pixelX,
			y: pixelY,
			width: 128 - pixelX,
			height: def.stackHeight ?? 8,
			isSelected: false,
			cursorStyle: (sub.config.cursorStyle as string) || 'prefix',
			boundValue: undefined
		};

		const configWithLabel = { ...sub.config, label: sub.displayText ?? '' };
		def.render(configWithLabel, ctx);
	}

	return pixels;
}

/**
 * Convert a 128x64 monochrome pixel buffer to a data URL for use in <image> tags.
 * Uses a tiny BMP format for maximum compatibility and minimal overhead.
 */
export function pixelsToDataUrl(
	pixels: Uint8Array,
	fgColor: [number, number, number] = [0, 255, 128],
	bgColor: [number, number, number] = [16, 16, 16]
): string {
	const width = 128;
	const height = 64;

	// Create canvas-like pixel data as raw RGBA
	const rgba = new Uint8Array(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const byteIndex = y * 16 + Math.floor(x / 8);
			const bitIndex = 7 - (x % 8);
			const isSet = (pixels[byteIndex] >> bitIndex) & 1;

			const rgbaIndex = (y * width + x) * 4;
			if (isSet) {
				rgba[rgbaIndex] = fgColor[0];
				rgba[rgbaIndex + 1] = fgColor[1];
				rgba[rgbaIndex + 2] = fgColor[2];
			} else {
				rgba[rgbaIndex] = bgColor[0];
				rgba[rgbaIndex + 1] = bgColor[1];
				rgba[rgbaIndex + 2] = bgColor[2];
			}
			rgba[rgbaIndex + 3] = 255; // alpha
		}
	}

	// Use an offscreen canvas to convert to PNG data URL
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext('2d');
		if (ctx) {
			const imageData = new ImageData(new Uint8ClampedArray(rgba.buffer), width, height);
			ctx.putImageData(imageData, 0, 0);
			// OffscreenCanvas.convertToBlob is async — use synchronous data URL via regular canvas
		}
	}

	// Fallback: use regular canvas
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) return '';

	const imageData = new ImageData(new Uint8ClampedArray(rgba.buffer), width, height);
	ctx.putImageData(imageData, 0, 0);
	return canvas.toDataURL('image/png');
}
