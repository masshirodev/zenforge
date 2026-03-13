import { OLED_WIDTH, OLED_HEIGHT, OLED_BYTES } from './types';

export function createEmptyPixels(): Uint8Array {
	return new Uint8Array(OLED_BYTES);
}

export function getPixel(pixels: Uint8Array, x: number, y: number): boolean {
	if (x < 0 || x >= OLED_WIDTH || y < 0 || y >= OLED_HEIGHT) return false;
	const bitIndex = y * OLED_WIDTH + x;
	const byteIndex = bitIndex >> 3;
	const bitOffset = 7 - (bitIndex & 7); // MSB first
	return (pixels[byteIndex] & (1 << bitOffset)) !== 0;
}

export function setPixel(
	pixels: Uint8Array,
	x: number,
	y: number,
	value: boolean
): void {
	if (x < 0 || x >= OLED_WIDTH || y < 0 || y >= OLED_HEIGHT) return;
	const bitIndex = y * OLED_WIDTH + x;
	const byteIndex = bitIndex >> 3;
	const bitOffset = 7 - (bitIndex & 7);
	if (value) {
		pixels[byteIndex] |= 1 << bitOffset;
	} else {
		pixels[byteIndex] &= ~(1 << bitOffset);
	}
}

export function clonePixels(pixels: Uint8Array): Uint8Array {
	return new Uint8Array(pixels);
}

export function invertPixels(pixels: Uint8Array): Uint8Array {
	const result = new Uint8Array(pixels.length);
	for (let i = 0; i < pixels.length; i++) {
		result[i] = ~pixels[i] & 0xff;
	}
	return result;
}

export function clearPixels(): Uint8Array {
	return new Uint8Array(OLED_BYTES);
}

export function pixelsToBase64(pixels: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < pixels.length; i++) {
		binary += String.fromCharCode(pixels[i]);
	}
	return btoa(binary);
}

export function base64ToPixels(base64: string): Uint8Array {
	const binary = atob(base64);
	const pixels = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		pixels[i] = binary.charCodeAt(i);
	}
	return pixels;
}

/** Extract a rectangular region of pixels into a small buffer.
 *  The buffer uses 1 byte per pixel for simplicity (not packed bits). */
export function extractRegion(
	pixels: Uint8Array,
	rx: number,
	ry: number,
	rw: number,
	rh: number
): Uint8Array {
	const buf = new Uint8Array(rw * rh);
	for (let y = 0; y < rh; y++) {
		for (let x = 0; x < rw; x++) {
			const sx = rx + x;
			const sy = ry + y;
			if (sx >= 0 && sx < OLED_WIDTH && sy >= 0 && sy < OLED_HEIGHT) {
				buf[y * rw + x] = getPixel(pixels, sx, sy) ? 1 : 0;
			}
		}
	}
	return buf;
}

/** Clear a rectangular region to black */
export function clearRegion(
	pixels: Uint8Array,
	rx: number,
	ry: number,
	rw: number,
	rh: number
): void {
	for (let y = 0; y < rh; y++) {
		for (let x = 0; x < rw; x++) {
			const sx = rx + x;
			const sy = ry + y;
			if (sx >= 0 && sx < OLED_WIDTH && sy >= 0 && sy < OLED_HEIGHT) {
				setPixel(pixels, sx, sy, false);
			}
		}
	}
}

/** Stamp a region buffer onto the canvas at the given position */
export function stampRegion(
	pixels: Uint8Array,
	buf: Uint8Array,
	rw: number,
	rh: number,
	dx: number,
	dy: number
): void {
	for (let y = 0; y < rh; y++) {
		for (let x = 0; x < rw; x++) {
			if (buf[y * rw + x]) {
				const sx = dx + x;
				const sy = dy + y;
				if (sx >= 0 && sx < OLED_WIDTH && sy >= 0 && sy < OLED_HEIGHT) {
					setPixel(pixels, sx, sy, true);
				}
			}
		}
	}
}
