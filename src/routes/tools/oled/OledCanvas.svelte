<script lang="ts">
	import { onMount } from 'svelte';
	import { OLED_WIDTH, OLED_HEIGHT, type DrawTool, type BrushShape, type TextState } from './types';
	import { getPixel, setPixel, clonePixels } from './pixels';
	import { applyBrush, drawBresenhamLine, drawRect, drawEllipse, floodFill, drawText, shiftPixels } from './drawing';
	import { getFont } from './fonts';
	import { getPixel as getSpritePixel, bytesPerRow } from '$lib/utils/sprite-pixels';

	interface StampData {
		pixels: Uint8Array;
		width: number;
		height: number;
		scale: number;
	}

	interface Props {
		pixels: Uint8Array;
		tool: DrawTool;
		brush: BrushShape;
		filled: boolean;
		version: number;
		textState: TextState;
		stampData?: StampData | null;
		onBeforeDraw: () => void;
		onDraw: (pixels: Uint8Array) => void;
		onTextOriginSet: (x: number, y: number) => void;
	}

	let { pixels, tool, brush, filled, version, textState, stampData = null, onBeforeDraw, onDraw, onTextOriginSet }: Props = $props();

	let canvas: HTMLCanvasElement;
	let container: HTMLDivElement;
	let ctx: CanvasRenderingContext2D | null = null;

	let cellSize = $state(0);
	let offsetX = $state(0);
	let offsetY = $state(0);

	// Drawing state
	let isDrawing = $state(false);
	let drawValue = $state(true); // true = white, false = black
	let lastPixelX = $state(-1);
	let lastPixelY = $state(-1);
	let dragStartX = $state(-1);
	let dragStartY = $state(-1);
	let hoverX = $state(-1);
	let hoverY = $state(-1);

	// Preview pixels for shape tools during drag
	let previewPixels: Uint8Array | null = $state(null);

	function resize() {
		if (!container || !canvas) return;
		const rect = container.getBoundingClientRect();
		canvas.width = rect.width;
		canvas.height = rect.height;

		// Calculate cell size to fit 128x64 with some padding
		const pad = 20;
		cellSize = Math.floor(
			Math.min((rect.width - pad) / OLED_WIDTH, (rect.height - pad) / OLED_HEIGHT)
		);
		offsetX = Math.floor((rect.width - cellSize * OLED_WIDTH) / 2);
		offsetY = Math.floor((rect.height - cellSize * OLED_HEIGHT) / 2);

		draw();
	}

	function draw() {
		if (!ctx || !canvas) return;
		const w = canvas.width;
		const h = canvas.height;

		ctx.fillStyle = '#09090b';
		ctx.fillRect(0, 0, w, h);

		if (cellSize <= 0) return;

		const displayPixels = previewPixels || pixels;

		// Draw pixels
		for (let y = 0; y < OLED_HEIGHT; y++) {
			for (let x = 0; x < OLED_WIDTH; x++) {
				if (getPixel(displayPixels, x, y)) {
					ctx.fillStyle = '#e4e4e7';
					ctx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize);
				}
			}
		}

		// Draw grid lines when zoomed in enough
		if (cellSize >= 4) {
			ctx.strokeStyle = '#27272a';
			ctx.lineWidth = 0.5;
			ctx.beginPath();
			for (let x = 0; x <= OLED_WIDTH; x++) {
				ctx.moveTo(offsetX + x * cellSize + 0.5, offsetY);
				ctx.lineTo(offsetX + x * cellSize + 0.5, offsetY + OLED_HEIGHT * cellSize);
			}
			for (let y = 0; y <= OLED_HEIGHT; y++) {
				ctx.moveTo(offsetX, offsetY + y * cellSize + 0.5);
				ctx.lineTo(offsetX + OLED_WIDTH * cellSize, offsetY + y * cellSize + 0.5);
			}
			ctx.stroke();
		}

		// Draw OLED border
		ctx.strokeStyle = '#3f3f46';
		ctx.lineWidth = 1;
		ctx.strokeRect(
			offsetX - 0.5,
			offsetY - 0.5,
			OLED_WIDTH * cellSize + 1,
			OLED_HEIGHT * cellSize + 1
		);

		// Draw text preview
		if (tool === 'text' && textState.originX >= 0 && textState.text) {
			const font = getFont(textState.fontSize);
			const previewBuf = clonePixels(displayPixels);
			drawText(previewBuf, textState.text, textState.originX, textState.originY, font, true, textState.align);
			// Re-render with text overlay in preview color
			for (let y = 0; y < OLED_HEIGHT; y++) {
				for (let x = 0; x < OLED_WIDTH; x++) {
					if (getPixel(previewBuf, x, y) && !getPixel(displayPixels, x, y)) {
						ctx.fillStyle = 'rgba(16, 185, 129, 0.6)';
						ctx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize);
					}
				}
			}
		}

		// Draw text origin marker
		if (tool === 'text' && textState.originX >= 0) {
			const mx = offsetX + textState.originX * cellSize;
			const my = offsetY + textState.originY * cellSize;
			ctx.strokeStyle = '#10b981';
			ctx.lineWidth = 1;
			// Crosshair
			ctx.beginPath();
			ctx.moveTo(mx - 4, my);
			ctx.lineTo(mx + 4, my);
			ctx.moveTo(mx, my - 4);
			ctx.lineTo(mx, my + 4);
			ctx.stroke();
		}

		// Draw stamp preview on hover
		if (stampData && hoverX >= 0 && hoverY >= 0) {
			drawStampPreview(hoverX, hoverY);
		}

		// Draw brush preview on hover
		if (!stampData && hoverX >= 0 && hoverY >= 0 && !isDrawing && tool !== 'text' && tool !== 'move') {
			drawBrushPreview(hoverX, hoverY);
		}

		// Draw coordinates
		if (hoverX >= 0 && hoverY >= 0) {
			ctx.fillStyle = '#a1a1aa';
			ctx.font = '11px monospace';
			ctx.textAlign = 'left';
			ctx.fillText(`${hoverX}, ${hoverY}`, offsetX, offsetY - 6);
		}
	}

	function drawBrushPreview(px: number, py: number) {
		if (!ctx) return;
		const hw = Math.floor(brush.width / 2);
		const hh = Math.floor(brush.height / 2);

		ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';

		for (let dy = -hh; dy <= hh; dy++) {
			for (let dx = -hw; dx <= hw; dx++) {
				const x = px + dx;
				const y = py + dy;
				if (x < 0 || x >= OLED_WIDTH || y < 0 || y >= OLED_HEIGHT) continue;

				if (brush.type === 'circle' && hw > 0 && hh > 0) {
					const nx = dx / hw;
					const ny = dy / hh;
					if (nx * nx + ny * ny > 1) continue;
				}

				ctx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize);
			}
		}
	}

	function drawStampPreview(px: number, py: number) {
		if (!ctx || !stampData) return;
		const { pixels: spritePixels, width: sw, height: sh, scale } = stampData;
		const scaledW = sw * scale;
		const scaledH = sh * scale;

		ctx.fillStyle = 'rgba(16, 185, 129, 0.4)';
		for (let sy = 0; sy < sh; sy++) {
			for (let sx = 0; sx < sw; sx++) {
				if (getSpritePixel(spritePixels, sx, sy, sw, sh)) {
					for (let dy = 0; dy < scale; dy++) {
						for (let dx = 0; dx < scale; dx++) {
							const ox = px + sx * scale + dx;
							const oy = py + sy * scale + dy;
							if (ox >= 0 && ox < OLED_WIDTH && oy >= 0 && oy < OLED_HEIGHT) {
								ctx.fillRect(
									offsetX + ox * cellSize,
									offsetY + oy * cellSize,
									cellSize,
									cellSize
								);
							}
						}
					}
				}
			}
		}

		// Draw bounding box
		ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
		ctx.lineWidth = 1;
		ctx.setLineDash([3, 3]);
		ctx.strokeRect(
			offsetX + px * cellSize,
			offsetY + py * cellSize,
			scaledW * cellSize,
			scaledH * cellSize
		);
		ctx.setLineDash([]);
	}

	function stampOntoCanvas(px: number, py: number) {
		if (!stampData) return;
		const { pixels: spritePixels, width: sw, height: sh, scale } = stampData;
		const updated = clonePixels(pixels);

		for (let sy = 0; sy < sh; sy++) {
			for (let sx = 0; sx < sw; sx++) {
				if (getSpritePixel(spritePixels, sx, sy, sw, sh)) {
					for (let dy = 0; dy < scale; dy++) {
						for (let dx = 0; dx < scale; dx++) {
							const ox = px + sx * scale + dx;
							const oy = py + sy * scale + dy;
							if (ox >= 0 && ox < OLED_WIDTH && oy >= 0 && oy < OLED_HEIGHT) {
								setPixel(updated, ox, oy, true);
							}
						}
					}
				}
			}
		}

		onBeforeDraw();
		onDraw(updated);
	}

	function canvasToPixel(e: MouseEvent): [number, number] {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left - offsetX;
		const my = e.clientY - rect.top - offsetY;
		const px = Math.floor(mx / cellSize);
		const py = Math.floor(my / cellSize);
		return [px, py];
	}

	function isInBounds(x: number, y: number): boolean {
		return x >= 0 && x < OLED_WIDTH && y >= 0 && y < OLED_HEIGHT;
	}

	function isShapeTool(t: DrawTool): boolean {
		return t === 'line' || t === 'rect' || t === 'ellipse';
	}

	function handleMouseDown(e: MouseEvent) {
		if (e.button !== 0 && e.button !== 2) return;
		const [px, py] = canvasToPixel(e);
		if (!isInBounds(px, py)) return;

		if (stampData && e.button === 0) {
			stampOntoCanvas(px, py);
			return;
		}

		if (tool === 'text') {
			onTextOriginSet(px, py);
			draw();
			return;
		}

		drawValue = e.button === 0; // left = white, right = black
		isDrawing = true;
		dragStartX = px;
		dragStartY = py;
		lastPixelX = px;
		lastPixelY = py;

		onBeforeDraw();

		if (tool === 'move') {
			// Move tool: just start tracking, actual shift happens on mouse move
			return;
		} else if (tool === 'pen' || tool === 'eraser') {
			const value = tool === 'eraser' ? false : drawValue;
			const updated = clonePixels(pixels);
			applyBrush(updated, px, py, brush, value);
			onDraw(updated);
		} else if (tool === 'fill') {
			const updated = clonePixels(pixels);
			floodFill(updated, px, py, drawValue);
			onDraw(updated);
			isDrawing = false;
		}
	}

	function handleMouseMove(e: MouseEvent) {
		const [px, py] = canvasToPixel(e);
		hoverX = isInBounds(px, py) ? px : -1;
		hoverY = isInBounds(px, py) ? py : -1;

		if (!isDrawing) {
			draw();
			return;
		}

		if (tool === 'move') {
			const dx = px - lastPixelX;
			const dy = py - lastPixelY;
			if (dx === 0 && dy === 0) return;
			const shifted = shiftPixels(pixels, dx, dy);
			lastPixelX = px;
			lastPixelY = py;
			onDraw(shifted);
		} else if (tool === 'pen' || tool === 'eraser') {
			if (px === lastPixelX && py === lastPixelY) return;
			const value = tool === 'eraser' ? false : drawValue;
			const updated = clonePixels(pixels);
			drawBresenhamLine(updated, lastPixelX, lastPixelY, px, py, value, brush);
			lastPixelX = px;
			lastPixelY = py;
			onDraw(updated);
		} else if (isShapeTool(tool)) {
			// Show preview
			const preview = clonePixels(pixels);
			applyShapeTool(preview, dragStartX, dragStartY, px, py, drawValue);
			previewPixels = preview;
			draw();
		}
	}

	function handleMouseUp(e: MouseEvent) {
		if (!isDrawing) return;
		const [px, py] = canvasToPixel(e);

		if (isShapeTool(tool) && isInBounds(px, py)) {
			const updated = clonePixels(pixels);
			applyShapeTool(updated, dragStartX, dragStartY, px, py, drawValue);
			onDraw(updated);
		}

		isDrawing = false;
		previewPixels = null;
		draw();
	}

	function applyShapeTool(
		target: Uint8Array,
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		value: boolean
	) {
		if (tool === 'line') {
			drawBresenhamLine(target, x0, y0, x1, y1, value, brush);
		} else if (tool === 'rect') {
			drawRect(target, x0, y0, x1, y1, filled, value);
		} else if (tool === 'ellipse') {
			const cx = Math.round((x0 + x1) / 2);
			const cy = Math.round((y0 + y1) / 2);
			const rx = Math.abs(Math.round((x1 - x0) / 2));
			const ry = Math.abs(Math.round((y1 - y0) / 2));
			drawEllipse(target, cx, cy, rx, ry, filled, value);
		}
	}

	function handleMouseLeave() {
		hoverX = -1;
		hoverY = -1;
		if (isDrawing && (tool === 'pen' || tool === 'eraser' || tool === 'move')) {
			isDrawing = false;
			previewPixels = null;
		}
		draw();
	}

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
	}

	onMount(() => {
		ctx = canvas.getContext('2d');
		resize();
		const observer = new ResizeObserver(() => resize());
		observer.observe(container);
		return () => observer.disconnect();
	});

	$effect(() => {
		void version;
		void pixels;
		void previewPixels;
		void textState;
		void stampData;
		draw();
	});
</script>

<div
	bind:this={container}
	class="flex h-full w-full items-center justify-center overflow-hidden"
>
	<canvas
		bind:this={canvas}
		class="block"
		style:cursor={stampData ? 'crosshair' : tool === 'move' ? (isDrawing ? 'grabbing' : 'grab') : tool === 'fill' || tool === 'text' ? 'crosshair' : 'default'}
		onmousedown={handleMouseDown}
		onmousemove={handleMouseMove}
		onmouseup={handleMouseUp}
		onmouseleave={handleMouseLeave}
		oncontextmenu={handleContextMenu}
	></canvas>
</div>
