import { OLED_WIDTH, OLED_HEIGHT, type BrushShape } from './types';
import { getPixel, setPixel } from './pixels';
import type { BitmapFont } from './fonts';

export function applyBrush(
	pixels: Uint8Array,
	cx: number,
	cy: number,
	brush: BrushShape,
	value: boolean
): void {
	const hw = Math.floor(brush.width / 2);
	const hh = Math.floor(brush.height / 2);

	for (let dy = -hh; dy <= hh; dy++) {
		for (let dx = -hw; dx <= hw; dx++) {
			const x = cx + dx;
			const y = cy + dy;
			if (x < 0 || x >= OLED_WIDTH || y < 0 || y >= OLED_HEIGHT) continue;

			if (brush.type === 'circle') {
				const nx = hw > 0 ? dx / hw : 0;
				const ny = hh > 0 ? dy / hh : 0;
				if (nx * nx + ny * ny > 1) continue;
			}

			setPixel(pixels, x, y, value);
		}
	}
}

export function drawBresenhamLine(
	pixels: Uint8Array,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	value: boolean,
	brush: BrushShape
): void {
	let dx = Math.abs(x1 - x0);
	let dy = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;

	let cx = x0;
	let cy = y0;

	while (true) {
		applyBrush(pixels, cx, cy, brush, value);
		if (cx === x1 && cy === y1) break;
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			cx += sx;
		}
		if (e2 <= dx) {
			err += dx;
			cy += sy;
		}
	}
}

export function drawRect(
	pixels: Uint8Array,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	filled: boolean,
	value: boolean
): void {
	const minX = Math.max(0, Math.min(x0, x1));
	const maxX = Math.min(OLED_WIDTH - 1, Math.max(x0, x1));
	const minY = Math.max(0, Math.min(y0, y1));
	const maxY = Math.min(OLED_HEIGHT - 1, Math.max(y0, y1));

	for (let y = minY; y <= maxY; y++) {
		for (let x = minX; x <= maxX; x++) {
			if (filled || x === minX || x === maxX || y === minY || y === maxY) {
				setPixel(pixels, x, y, value);
			}
		}
	}
}

export function drawEllipse(
	pixels: Uint8Array,
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	filled: boolean,
	value: boolean
): void {
	if (rx === 0 && ry === 0) {
		setPixel(pixels, cx, cy, value);
		return;
	}

	// Midpoint ellipse algorithm
	const rx2 = rx * rx;
	const ry2 = ry * ry;

	if (filled) {
		for (let y = -ry; y <= ry; y++) {
			for (let x = -rx; x <= rx; x++) {
				if (rx2 > 0 && ry2 > 0) {
					if ((x * x * ry2 + y * y * rx2) <= rx2 * ry2) {
						setPixel(pixels, cx + x, cy + y, value);
					}
				} else if (rx === 0) {
					setPixel(pixels, cx, cy + y, value);
				} else {
					setPixel(pixels, cx + x, cy, value);
				}
			}
		}
	} else {
		// Outline only using midpoint algorithm
		let x = 0;
		let y = ry;
		let d1 = ry2 - rx2 * ry + 0.25 * rx2;

		const plotSymmetric = (px: number, py: number) => {
			setPixel(pixels, cx + px, cy + py, value);
			setPixel(pixels, cx - px, cy + py, value);
			setPixel(pixels, cx + px, cy - py, value);
			setPixel(pixels, cx - px, cy - py, value);
		};

		// Region 1
		while (ry2 * x < rx2 * y) {
			plotSymmetric(x, y);
			if (d1 < 0) {
				d1 += ry2 * (2 * x + 3);
			} else {
				d1 += ry2 * (2 * x + 3) + rx2 * (-2 * y + 2);
				y--;
			}
			x++;
		}

		// Region 2
		let d2 = ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2;
		while (y >= 0) {
			plotSymmetric(x, y);
			if (d2 > 0) {
				d2 += rx2 * (-2 * y + 3);
			} else {
				d2 += ry2 * (2 * x + 2) + rx2 * (-2 * y + 3);
				x++;
			}
			y--;
		}
	}
}

export function floodFill(
	pixels: Uint8Array,
	startX: number,
	startY: number,
	value: boolean
): void {
	if (startX < 0 || startX >= OLED_WIDTH || startY < 0 || startY >= OLED_HEIGHT) return;

	const targetValue = getPixel(pixels, startX, startY);
	if (targetValue === value) return;

	const queue: [number, number][] = [[startX, startY]];
	const visited = new Set<number>();
	visited.add(startY * OLED_WIDTH + startX);

	while (queue.length > 0) {
		const [x, y] = queue.shift()!;
		setPixel(pixels, x, y, value);

		const neighbors: [number, number][] = [
			[x - 1, y],
			[x + 1, y],
			[x, y - 1],
			[x, y + 1]
		];

		for (const [nx, ny] of neighbors) {
			if (nx < 0 || nx >= OLED_WIDTH || ny < 0 || ny >= OLED_HEIGHT) continue;
			const key = ny * OLED_WIDTH + nx;
			if (visited.has(key)) continue;
			if (getPixel(pixels, nx, ny) !== targetValue) continue;
			visited.add(key);
			queue.push([nx, ny]);
		}
	}
}

export function shiftPixels(
	pixels: Uint8Array,
	dx: number,
	dy: number
): Uint8Array {
	const result = new Uint8Array(pixels.length);
	for (let y = 0; y < OLED_HEIGHT; y++) {
		for (let x = 0; x < OLED_WIDTH; x++) {
			const sx = x - dx;
			const sy = y - dy;
			if (sx >= 0 && sx < OLED_WIDTH && sy >= 0 && sy < OLED_HEIGHT) {
				if (getPixel(pixels, sx, sy)) {
					setPixel(result, x, y, true);
				}
			}
		}
	}
	return result;
}

export function measureTextWidth(text: string, font: BitmapFont): number {
	if (text.length === 0) return 0;
	const charPitch = font.width + font.spacing;
	return text.length * charPitch - font.spacing;
}

export function drawText(
	pixels: Uint8Array,
	text: string,
	originX: number,
	originY: number,
	font: BitmapFont,
	value: boolean,
	align: 'left' | 'center' | 'right' = 'left'
): void {
	const charPitch = font.width + font.spacing;
	const textWidth = measureTextWidth(text, font);
	let startX = originX;
	if (align === 'center') {
		startX = originX - Math.floor(textWidth / 2);
	} else if (align === 'right') {
		startX = originX - textWidth;
	}
	for (let i = 0; i < text.length; i++) {
		const charX = startX + i * charPitch;
		// Skip characters entirely off-screen to the right
		if (charX >= OLED_WIDTH) break;
		// Skip characters entirely off-screen to the left
		if (charX + font.width < 0) continue;

		const code = text.charCodeAt(i);
		const glyph = font.data.get(code);
		if (!glyph) continue;

		for (let row = 0; row < font.height; row++) {
			const py = originY + row;
			if (py < 0 || py >= OLED_HEIGHT) continue;
			const rowBits = glyph[row];
			for (let col = 0; col < font.width; col++) {
				const px = charX + col;
				if (px < 0 || px >= OLED_WIDTH) continue;
				// MSB = leftmost pixel
				if (rowBits & (1 << (font.width - 1 - col))) {
					setPixel(pixels, px, py, value);
				}
			}
		}
	}
}
