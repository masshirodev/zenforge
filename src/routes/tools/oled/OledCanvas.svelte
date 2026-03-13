<script lang="ts">
	import { onMount } from 'svelte';
	import { OLED_WIDTH, OLED_HEIGHT, type DrawTool, type BrushShape, type TextState, type SelectionState, type Guide } from './types';
	import { getPixel, setPixel, clonePixels, extractRegion, clearRegion, stampRegion } from './pixels';
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
		selection: SelectionState;
		guides: Guide[];
		stampData?: StampData | null;
		/** Other pixel-art subnodes from the same node, shown as a dim overlay */
		overlayPixels?: Uint8Array[];
		onBeforeDraw: () => void;
		onDraw: (pixels: Uint8Array) => void;
		onTextOriginSet: (x: number, y: number) => void;
		onStampPlaced?: () => void;
		onSelectionChange: (sel: SelectionState) => void;
		onGuidesChange: (guides: Guide[]) => void;
	}

	let { pixels, tool, brush, filled, version, textState, selection, guides, stampData = null, overlayPixels = [], onBeforeDraw, onDraw, onTextOriginSet, onStampPlaced, onSelectionChange, onGuidesChange }: Props = $props();

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

	// Guide dragging state
	const RULER_SIZE = 20; // px for ruler area
	let draggingGuide = $state<{ axis: 'h' | 'v'; index: number } | null>(null);
	let draggingNewGuide = $state<{ axis: 'h' | 'v'; position: number } | null>(null);

	// Selection drag offset (when moving a floating selection or dragging to move)
	let selectDragOffX = $state(0);
	let selectDragOffY = $state(0);

	// Marching ants animation
	let antOffset = $state(0);
	let antInterval: ReturnType<typeof setInterval> | null = null;

	function resize() {
		if (!container || !canvas) return;
		const rect = container.getBoundingClientRect();
		canvas.width = rect.width;
		canvas.height = rect.height;

		// Calculate cell size to fit 128x64 with some padding, accounting for rulers
		const pad = 20;
		const availW = rect.width - pad - RULER_SIZE;
		const availH = rect.height - pad - RULER_SIZE;
		cellSize = Math.floor(
			Math.min(availW / OLED_WIDTH, availH / OLED_HEIGHT)
		);
		offsetX = Math.floor((rect.width - cellSize * OLED_WIDTH + RULER_SIZE) / 2);
		offsetY = Math.floor((rect.height - cellSize * OLED_HEIGHT + RULER_SIZE) / 2);

		// Ensure the canvas doesn't overlap the rulers
		if (offsetX < RULER_SIZE + 2) offsetX = RULER_SIZE + 2;
		if (offsetY < RULER_SIZE + 2) offsetY = RULER_SIZE + 2;

		draw();
	}

	function draw() {
		if (!ctx || !canvas) return;
		const w = canvas.width;
		const h = canvas.height;

		ctx.fillStyle = '#09090b';
		ctx.fillRect(0, 0, w, h);

		if (cellSize <= 0) return;

		const canvasRight = offsetX + OLED_WIDTH * cellSize;
		const canvasBottom = offsetY + OLED_HEIGHT * cellSize;
		const displayPixels = previewPixels || pixels;

		// Draw overlay pixels from sibling pixel-art subnodes (dim)
		if (overlayPixels.length > 0) {
			ctx.fillStyle = 'rgba(0, 180, 120, 0.2)';
			for (const ovl of overlayPixels) {
				for (let y = 0; y < OLED_HEIGHT; y++) {
					for (let x = 0; x < OLED_WIDTH; x++) {
						if (getPixel(ovl, x, y)) {
							ctx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize);
						}
					}
				}
			}
		}

		// Draw pixels
		for (let y = 0; y < OLED_HEIGHT; y++) {
			for (let x = 0; x < OLED_WIDTH; x++) {
				if (getPixel(displayPixels, x, y)) {
					ctx.fillStyle = '#e4e4e7';
					ctx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize);
				}
			}
		}

		// Draw floating selection pixels
		if (selection.floating) {
			const fx = selection.floatingX;
			const fy = selection.floatingY;
			ctx.fillStyle = 'rgba(228, 228, 231, 0.85)';
			for (let y = 0; y < selection.h; y++) {
				for (let x = 0; x < selection.w; x++) {
					if (selection.floating[y * selection.w + x]) {
						const sx = fx + x;
						const sy = fy + y;
						if (sx >= 0 && sx < OLED_WIDTH && sy >= 0 && sy < OLED_HEIGHT) {
							ctx.fillRect(offsetX + sx * cellSize, offsetY + sy * cellSize, cellSize, cellSize);
						}
					}
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
				ctx.lineTo(offsetX + x * cellSize + 0.5, canvasBottom);
			}
			for (let y = 0; y <= OLED_HEIGHT; y++) {
				ctx.moveTo(offsetX, offsetY + y * cellSize + 0.5);
				ctx.lineTo(canvasRight, offsetY + y * cellSize + 0.5);
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

		// Draw guides
		for (const guide of guides) {
			ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 4]);
			ctx.beginPath();
			if (guide.axis === 'h') {
				const gy = offsetY + guide.position * cellSize;
				ctx.moveTo(offsetX, gy + 0.5);
				ctx.lineTo(canvasRight, gy + 0.5);
			} else {
				const gx = offsetX + guide.position * cellSize;
				ctx.moveTo(gx + 0.5, offsetY);
				ctx.lineTo(gx + 0.5, canvasBottom);
			}
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// Draw guide being dragged from ruler
		if (draggingNewGuide) {
			ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 4]);
			ctx.beginPath();
			if (draggingNewGuide.axis === 'h') {
				const gy = offsetY + draggingNewGuide.position * cellSize;
				ctx.moveTo(offsetX, gy + 0.5);
				ctx.lineTo(canvasRight, gy + 0.5);
			} else {
				const gx = offsetX + draggingNewGuide.position * cellSize;
				ctx.moveTo(gx + 0.5, offsetY);
				ctx.lineTo(gx + 0.5, canvasBottom);
			}
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// Draw selection rectangle (marching ants)
		if (selection.x >= 0) {
			const sx = selection.floating ? selection.floatingX : selection.x;
			const sy = selection.floating ? selection.floatingY : selection.y;
			const rx = offsetX + sx * cellSize;
			const ry = offsetY + sy * cellSize;
			const rw = selection.w * cellSize;
			const rh = selection.h * cellSize;

			ctx.strokeStyle = '#ffffff';
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 4]);
			ctx.lineDashOffset = -antOffset;
			ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
			ctx.strokeStyle = '#000000';
			ctx.lineDashOffset = -(antOffset + 4);
			ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
			ctx.setLineDash([]);
			ctx.lineDashOffset = 0;
		}

		// Draw text preview
		if (tool === 'text' && textState.originX >= 0 && textState.text) {
			const font = getFont(textState.fontSize);
			const previewBuf = clonePixels(displayPixels);
			drawText(previewBuf, textState.text, textState.originX, textState.originY, font, true, textState.align);
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
		if (!stampData && hoverX >= 0 && hoverY >= 0 && !isDrawing && tool !== 'text' && tool !== 'move' && tool !== 'select') {
			drawBrushPreview(hoverX, hoverY);
		}

		// Draw rulers
		drawRulers();

		// Draw coordinates
		if (hoverX >= 0 && hoverY >= 0) {
			ctx.fillStyle = '#a1a1aa';
			ctx.font = '11px monospace';
			ctx.textAlign = 'left';
			ctx.fillText(`${hoverX}, ${hoverY}`, offsetX, offsetY - 6);
		}
	}

	function drawRulers() {
		if (!ctx || cellSize <= 0) return;
		const canvasRight = offsetX + OLED_WIDTH * cellSize;
		const canvasBottom = offsetY + OLED_HEIGHT * cellSize;

		// Top ruler background
		ctx.fillStyle = '#18181b';
		ctx.fillRect(offsetX, 0, OLED_WIDTH * cellSize, RULER_SIZE);
		// Left ruler background
		ctx.fillRect(0, offsetY, RULER_SIZE, OLED_HEIGHT * cellSize);
		// Corner
		ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);

		// Top ruler ticks
		ctx.fillStyle = '#71717a';
		ctx.font = '9px monospace';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		for (let x = 0; x <= OLED_WIDTH; x += 8) {
			const px = offsetX + x * cellSize;
			const isMajor = x % 32 === 0;
			ctx.strokeStyle = '#52525b';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(px + 0.5, RULER_SIZE);
			ctx.lineTo(px + 0.5, RULER_SIZE - (isMajor ? 10 : 5));
			ctx.stroke();
			if (isMajor && x < OLED_WIDTH) {
				ctx.fillText(`${x}`, px, 2);
			}
		}

		// Left ruler ticks
		ctx.textAlign = 'right';
		ctx.textBaseline = 'middle';
		for (let y = 0; y <= OLED_HEIGHT; y += 8) {
			const py = offsetY + y * cellSize;
			const isMajor = y % 16 === 0;
			ctx.strokeStyle = '#52525b';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(RULER_SIZE, py + 0.5);
			ctx.lineTo(RULER_SIZE - (isMajor ? 10 : 5), py + 0.5);
			ctx.stroke();
			if (isMajor && y < OLED_HEIGHT) {
				ctx.fillText(`${y}`, RULER_SIZE - 12, py);
			}
		}

		// Ruler borders
		ctx.strokeStyle = '#3f3f46';
		ctx.lineWidth = 1;
		ctx.beginPath();
		// Bottom edge of top ruler
		ctx.moveTo(RULER_SIZE, RULER_SIZE + 0.5);
		ctx.lineTo(canvasRight, RULER_SIZE + 0.5);
		// Right edge of left ruler
		ctx.moveTo(RULER_SIZE + 0.5, RULER_SIZE);
		ctx.lineTo(RULER_SIZE + 0.5, canvasBottom);
		ctx.stroke();

		// Draw guide markers on rulers
		for (const guide of guides) {
			ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
			if (guide.axis === 'v') {
				const gx = offsetX + guide.position * cellSize;
				// Small triangle on top ruler
				ctx.beginPath();
				ctx.moveTo(gx - 3, RULER_SIZE);
				ctx.lineTo(gx + 3, RULER_SIZE);
				ctx.lineTo(gx, RULER_SIZE - 6);
				ctx.closePath();
				ctx.fill();
			} else {
				const gy = offsetY + guide.position * cellSize;
				// Small triangle on left ruler
				ctx.beginPath();
				ctx.moveTo(RULER_SIZE, gy - 3);
				ctx.lineTo(RULER_SIZE, gy + 3);
				ctx.lineTo(RULER_SIZE - 6, gy);
				ctx.closePath();
				ctx.fill();
			}
		}

		// Cursor position indicators on rulers
		if (hoverX >= 0 && hoverY >= 0) {
			ctx.fillStyle = 'rgba(16, 185, 129, 0.5)';
			// Vertical line on top ruler
			const cx = offsetX + hoverX * cellSize;
			ctx.fillRect(cx, 0, cellSize, RULER_SIZE);
			// Horizontal line on left ruler
			const cy = offsetY + hoverY * cellSize;
			ctx.fillRect(0, cy, RULER_SIZE, cellSize);
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
		onStampPlaced?.();
	}

	function canvasToPixel(e: MouseEvent): [number, number] {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left - offsetX;
		const my = e.clientY - rect.top - offsetY;
		const px = Math.floor(mx / cellSize);
		const py = Math.floor(my / cellSize);
		return [px, py];
	}

	function canvasToRaw(e: MouseEvent): [number, number] {
		const rect = canvas.getBoundingClientRect();
		return [e.clientX - rect.left, e.clientY - rect.top];
	}

	function isInRulerTop(rawX: number, rawY: number): boolean {
		return rawY < RULER_SIZE && rawX >= offsetX && rawX < offsetX + OLED_WIDTH * cellSize;
	}

	function isInRulerLeft(rawX: number, rawY: number): boolean {
		return rawX < RULER_SIZE && rawY >= offsetY && rawY < offsetY + OLED_HEIGHT * cellSize;
	}

	function snapGuidePosition(pos: number, axis: 'h' | 'v', shiftHeld: boolean): number {
		if (shiftHeld) return Math.max(0, Math.min(pos, axis === 'v' ? OLED_WIDTH : OLED_HEIGHT));
		const center = axis === 'v' ? OLED_WIDTH / 2 : OLED_HEIGHT / 2;
		const snapThreshold = 2; // pixels
		if (Math.abs(pos - center) <= snapThreshold) return center;
		return Math.max(0, Math.min(pos, axis === 'v' ? OLED_WIDTH : OLED_HEIGHT));
	}

	function isInsideSelection(px: number, py: number): boolean {
		if (selection.x < 0) return false;
		const sx = selection.floating ? selection.floatingX : selection.x;
		const sy = selection.floating ? selection.floatingY : selection.y;
		return px >= sx && px < sx + selection.w && py >= sy && py < sy + selection.h;
	}

	function isInBounds(x: number, y: number): boolean {
		return x >= 0 && x < OLED_WIDTH && y >= 0 && y < OLED_HEIGHT;
	}

	function isShapeTool(t: DrawTool): boolean {
		return t === 'line' || t === 'rect' || t === 'ellipse';
	}

	/** Commit any floating selection back to the pixel buffer */
	function commitFloatingSelection() {
		if (!selection.floating) return;
		onBeforeDraw();
		const updated = clonePixels(pixels);
		stampRegion(updated, selection.floating, selection.w, selection.h, selection.floatingX, selection.floatingY);
		onDraw(updated);
		onSelectionChange({ x: -1, y: -1, w: 0, h: 0, floating: null, floatingX: 0, floatingY: 0, isDragging: false });
	}

	/** Lift the selection into a floating state (cut from canvas) */
	function liftSelection() {
		if (selection.x < 0 || selection.floating) return;
		onBeforeDraw();
		const buf = extractRegion(pixels, selection.x, selection.y, selection.w, selection.h);
		const updated = clonePixels(pixels);
		clearRegion(updated, selection.x, selection.y, selection.w, selection.h);
		onDraw(updated);
		onSelectionChange({
			...selection,
			floating: buf,
			floatingX: selection.x,
			floatingY: selection.y
		});
	}

	function handleMouseDown(e: MouseEvent) {
		if (e.button !== 0 && e.button !== 2) return;
		const [rawX, rawY] = canvasToRaw(e);

		// Check if clicking on ruler to create a guide
		if (e.button === 0) {
			if (isInRulerTop(rawX, rawY)) {
				const px = Math.round((rawX - offsetX) / cellSize);
				draggingNewGuide = { axis: 'v', position: snapGuidePosition(px, 'v', e.shiftKey) };
				draw();
				return;
			}
			if (isInRulerLeft(rawX, rawY)) {
				const py = Math.round((rawY - offsetY) / cellSize);
				draggingNewGuide = { axis: 'h', position: snapGuidePosition(py, 'h', e.shiftKey) };
				draw();
				return;
			}

			// Check if clicking on an existing guide to drag it
			for (let i = 0; i < guides.length; i++) {
				const g = guides[i];
				if (g.axis === 'v') {
					const gx = offsetX + g.position * cellSize;
					if (Math.abs(rawX - gx) < 5 && rawY >= offsetY && rawY < offsetY + OLED_HEIGHT * cellSize) {
						draggingGuide = { axis: 'v', index: i };
						return;
					}
				} else {
					const gy = offsetY + g.position * cellSize;
					if (Math.abs(rawY - gy) < 5 && rawX >= offsetX && rawX < offsetX + OLED_WIDTH * cellSize) {
						draggingGuide = { axis: 'h', index: i };
						return;
					}
				}
			}
		}

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

		// Select tool handling
		if (tool === 'select' && e.button === 0) {
			if (selection.floating && isInsideSelection(px, py)) {
				// Start dragging a floating selection
				onSelectionChange({ ...selection, isDragging: true });
				selectDragOffX = px - selection.floatingX;
				selectDragOffY = py - selection.floatingY;
				lastPixelX = px;
				lastPixelY = py;
				isDrawing = true;
				return;
			}

			if (!selection.floating && isInsideSelection(px, py)) {
				// Lift the selection and start dragging
				liftSelection();
				selectDragOffX = px - selection.x;
				selectDragOffY = py - selection.y;
				lastPixelX = px;
				lastPixelY = py;
				isDrawing = true;
				// After lift, the selection state updates — mark as dragging
				// We need a tick for the state to propagate, so use setTimeout
				setTimeout(() => {
					onSelectionChange({ ...selection, isDragging: true });
				}, 0);
				return;
			}

			// Commit any existing floating selection before starting a new one
			if (selection.floating) {
				commitFloatingSelection();
			}

			// Start a new selection rectangle
			isDrawing = true;
			dragStartX = px;
			dragStartY = py;
			onSelectionChange({ x: px, y: py, w: 1, h: 1, floating: null, floatingX: 0, floatingY: 0, isDragging: false });
			return;
		}

		drawValue = e.button === 0; // left = white, right = black
		isDrawing = true;
		dragStartX = px;
		dragStartY = py;
		lastPixelX = px;
		lastPixelY = py;

		// Commit any floating selection if switching to a drawing tool
		if (selection.floating) {
			commitFloatingSelection();
		}

		onBeforeDraw();

		if (tool === 'move') {
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

		// Handle guide dragging from ruler
		if (draggingNewGuide) {
			const [rawX, rawY] = canvasToRaw(e);
			if (draggingNewGuide.axis === 'v') {
				const pos = Math.round((rawX - offsetX) / cellSize);
				draggingNewGuide = { ...draggingNewGuide, position: snapGuidePosition(pos, 'v', e.shiftKey) };
			} else {
				const pos = Math.round((rawY - offsetY) / cellSize);
				draggingNewGuide = { ...draggingNewGuide, position: snapGuidePosition(pos, 'h', e.shiftKey) };
			}
			draw();
			return;
		}

		// Handle existing guide dragging
		if (draggingGuide) {
			const [rawX, rawY] = canvasToRaw(e);
			const updated = [...guides];
			const g = updated[draggingGuide.index];
			if (g.axis === 'v') {
				const pos = Math.round((rawX - offsetX) / cellSize);
				// If dragged back to left ruler area, remove it
				if (rawX < RULER_SIZE) {
					updated.splice(draggingGuide.index, 1);
					onGuidesChange(updated);
					draggingGuide = null;
					draw();
					return;
				}
				updated[draggingGuide.index] = { ...g, position: snapGuidePosition(pos, 'v', e.shiftKey) };
			} else {
				const pos = Math.round((rawY - offsetY) / cellSize);
				// If dragged back to top ruler area, remove it
				if (rawY < RULER_SIZE) {
					updated.splice(draggingGuide.index, 1);
					onGuidesChange(updated);
					draggingGuide = null;
					draw();
					return;
				}
				updated[draggingGuide.index] = { ...g, position: snapGuidePosition(pos, 'h', e.shiftKey) };
			}
			onGuidesChange(updated);
			draw();
			return;
		}

		if (!isDrawing) {
			draw();
			return;
		}

		// Selection tool — dragging to resize selection or move floating
		if (tool === 'select') {
			if (selection.isDragging && selection.floating) {
				// Move floating selection
				const newX = px - selectDragOffX;
				const newY = py - selectDragOffY;
				if (newX !== selection.floatingX || newY !== selection.floatingY) {
					onSelectionChange({ ...selection, floatingX: newX, floatingY: newY });
				}
				draw();
				return;
			}
			// Resize selection rectangle
			if (!selection.floating) {
				const x0 = Math.min(dragStartX, px);
				const y0 = Math.min(dragStartY, py);
				const x1 = Math.max(dragStartX, px);
				const y1 = Math.max(dragStartY, py);
				onSelectionChange({
					x: Math.max(0, x0),
					y: Math.max(0, y0),
					w: Math.min(OLED_WIDTH, x1 + 1) - Math.max(0, x0),
					h: Math.min(OLED_HEIGHT, y1 + 1) - Math.max(0, y0),
					floating: null,
					floatingX: 0,
					floatingY: 0,
					isDragging: false
				});
				draw();
			}
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
			const preview = clonePixels(pixels);
			applyShapeTool(preview, dragStartX, dragStartY, px, py, drawValue);
			previewPixels = preview;
			draw();
		}
	}

	function handleMouseUp(e: MouseEvent) {
		// Finish guide drag from ruler
		if (draggingNewGuide) {
			const [rawX, rawY] = canvasToRaw(e);
			const axis = draggingNewGuide.axis;
			// Only add if dropped within the canvas area, not back on ruler
			const inCanvas = axis === 'v'
				? (rawX >= offsetX && rawX < offsetX + OLED_WIDTH * cellSize)
				: (rawY >= offsetY && rawY < offsetY + OLED_HEIGHT * cellSize);
			if (inCanvas) {
				onGuidesChange([...guides, { axis, position: draggingNewGuide.position }]);
			}
			draggingNewGuide = null;
			draw();
			return;
		}

		// Finish existing guide drag
		if (draggingGuide) {
			draggingGuide = null;
			draw();
			return;
		}

		if (!isDrawing) return;
		const [px, py] = canvasToPixel(e);

		// Finish selection drag/resize
		if (tool === 'select') {
			if (selection.isDragging) {
				onSelectionChange({ ...selection, isDragging: false });
			}
			isDrawing = false;
			draw();
			return;
		}

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
		// Don't cancel guide drags on mouse leave — user might re-enter
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

		// Marching ants animation
		antInterval = setInterval(() => {
			if (selection.x >= 0) {
				antOffset = (antOffset + 1) % 8;
				draw();
			}
		}, 100);

		return () => {
			observer.disconnect();
			if (antInterval) clearInterval(antInterval);
		};
	});

	$effect(() => {
		void version;
		void pixels;
		void previewPixels;
		void textState;
		void stampData;
		void selection;
		void guides;
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
		style:cursor={stampData ? 'crosshair' : tool === 'move' ? (isDrawing ? 'grabbing' : 'grab') : tool === 'select' ? (selection.isDragging ? 'grabbing' : isInsideSelection(hoverX, hoverY) ? 'grab' : 'crosshair') : tool === 'fill' || tool === 'text' ? 'crosshair' : draggingGuide || draggingNewGuide ? (draggingGuide?.axis === 'h' || draggingNewGuide?.axis === 'h' ? 'row-resize' : 'col-resize') : 'default'}
		onmousedown={handleMouseDown}
		onmousemove={handleMouseMove}
		onmouseup={handleMouseUp}
		onmouseleave={handleMouseLeave}
		oncontextmenu={handleContextMenu}
	></canvas>
</div>
