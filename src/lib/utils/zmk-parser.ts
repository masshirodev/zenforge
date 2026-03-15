import {
	InputDevice,
	PROFILE_NAMES,
	type AimSettings,
	type ActivationConfig,
	type ControllerAxes,
	type CurvePoint,
	type DeadzoneShape,
	type InputMapping,
	type MovementConfig,
	type ProfileName,
	type TranslatorSettings,
	type ZmkFile,
	type ZmkProfile
} from '$lib/types/zmk';

// ==================== Constants ====================

const MAGIC = 'MKZEN';
const MAGIC_SIZE = 8;
const VERSION_SIZE = 8;
const NAME_SIZE = 48;
const RESERVED_SIZE = 4;
const APP_VERSION_SIZE = 28;
const HEADER_SIZE = MAGIC_SIZE + VERSION_SIZE + NAME_SIZE + RESERVED_SIZE + APP_VERSION_SIZE; // 96
const GLOBAL_SIZE = 16;
const BLOCK_SIZE = 191;
const BLOCK_COUNT = 6;
const PROFILES_START = HEADER_SIZE + GLOBAL_SIZE; // 0x70
const CURVE_POINTS = 21;
const CURVE_X_STEP = 5;
const MAPPING_SLOTS = 18;
const ANCHOR_BIT = 0x80;
const ANCHOR_MASK = 0x7f;

// ==================== Parser ====================

/** Parse a .zmk binary buffer into a ZmkFile object */
export function parseZmk(buffer: ArrayBuffer): ZmkFile {
	const origData = new Uint8Array(buffer);

	// Detect format variant: legacy uses 0x20 (space) for padding
	const legacyFormat = origData[5] === 0x20;

	// For legacy format, convert space-padding (0x20) to null (0x00) in a copy.
	// This is lossy: USB HID code 0x20 (key '3') becomes indistinguishable from
	// padding. Legacy files are best-effort import only.
	let data: Uint8Array;
	let normalizedBuffer: ArrayBuffer;
	if (legacyFormat) {
		normalizedBuffer = buffer.slice(0);
		data = new Uint8Array(normalizedBuffer);
		// Replace 0x20 with 0x00 in binary data regions only (skip header text + notes)
		const dataStart = HEADER_SIZE;
		const notesStart = PROFILES_START + BLOCK_COUNT * BLOCK_SIZE;
		for (let i = dataStart; i < notesStart && i < data.length; i++) {
			if (data[i] === 0x20) data[i] = 0x00;
		}
	} else {
		normalizedBuffer = buffer;
		data = origData;
	}
	const view = new DataView(normalizedBuffer);
	const pad = legacyFormat ? 0x20 : 0x00;

	// Header
	const magic = readString(data, 0, MAGIC_SIZE, pad);
	if (!magic.startsWith(MAGIC)) {
		throw new Error(`Invalid .zmk file: expected magic "${MAGIC}", got "${magic}"`);
	}

	const formatVersion = readString(data, MAGIC_SIZE, VERSION_SIZE, pad);
	const profileName = readString(data, MAGIC_SIZE + VERSION_SIZE, NAME_SIZE, pad);
	const appVersion = readString(
		data,
		MAGIC_SIZE + VERSION_SIZE + NAME_SIZE + RESERVED_SIZE,
		APP_VERSION_SIZE,
		pad
	);

	// Global settings
	const globalSettings = data.slice(HEADER_SIZE, HEADER_SIZE + GLOBAL_SIZE);

	// Profile blocks
	const profiles: ZmkProfile[] = [];
	for (let i = 0; i < BLOCK_COUNT; i++) {
		const blockStart = PROFILES_START + i * BLOCK_SIZE;
		profiles.push(parseProfile(data, view, blockStart, PROFILE_NAMES[i]));
	}

	// Notes section
	const notesStart = PROFILES_START + BLOCK_COUNT * BLOCK_SIZE;
	const notesRaw = data.slice(notesStart);
	let notes = '';
	// Strip leading nulls/spaces
	let textStart = 0;
	while (textStart < notesRaw.length && (notesRaw[textStart] === 0x00 || notesRaw[textStart] === 0x20)) {
		textStart++;
	}
	if (textStart < notesRaw.length) {
		notes = new TextDecoder().decode(notesRaw.slice(textStart));
	}

	return {
		magic,
		formatVersion,
		profileName,
		appVersion,
		globalSettings,
		profiles,
		notes,
		legacyFormat
	};
}

function parseProfile(
	data: Uint8Array,
	view: DataView,
	offset: number,
	name: ProfileName
): ZmkProfile {
	const flags = data[offset];

	// Reserved regions for round-trip fidelity
	const _reserved = {
		block01_08: data.slice(offset + 0x01, offset + 0x09),
		block0A: data.slice(offset + 0x0a, offset + 0x0b),
		block14_1A: data.slice(offset + 0x14, offset + 0x1b),
		block1E_23: data.slice(offset + 0x1e, offset + 0x24),
		block26_29: data.slice(offset + 0x26, offset + 0x2a),
		block41_4B: data.slice(offset + 0x41, offset + 0x4c),
		block54_61: data.slice(offset + 0x54, offset + 0x62)
	};

	// Translator
	const translator: TranslatorSettings = {
		deadzoneX: view.getUint16(offset + 0x0c, true),
		deadzoneY: view.getUint16(offset + 0x0e, true),
		analogStickize: view.getUint16(offset + 0x10, true),
		// second copy at 0x12 is ignored on read, written on serialize
		deadzoneShape: data[offset + 0x0b] as DeadzoneShape
	};

	// Aim
	const aim: AimSettings = {
		sensitivity: view.getUint16(offset + 0x1b, true),
		xyRatio: data[offset + 0x1d],
		boost: view.getInt16(offset + 0x2a, true),
		smoothness: data[offset + 0x24],
		invertY: data[offset + 0x25] !== 0
	};

	// Ballistic curve
	const curve: CurvePoint[] = [];
	for (let i = 0; i < CURVE_POINTS; i++) {
		const raw = data[offset + 0x2c + i];
		curve.push({
			x: i * CURVE_X_STEP,
			y: raw & ANCHOR_MASK,
			anchor: (raw & ANCHOR_BIT) !== 0
		});
	}

	// Movement keys
	const movement: MovementConfig = {
		forward: readMapping(data, offset + 0x4c),
		left: readMapping(data, offset + 0x4e),
		right: readMapping(data, offset + 0x50),
		back: readMapping(data, offset + 0x52),
		analogSim: data[offset + 0x63],
		walkScale: data[offset + 0x62]
	};

	// Controller
	const controller: ControllerAxes = {
		ids: Array.from(data.slice(offset + 0x64, offset + 0x6a)),
		leftStickDeadzone: view.getUint16(offset + 0x6a, true),
		rightStickDeadzone: view.getUint16(offset + 0x6c, true),
		leftTriggerDeadzone: data[offset + 0x6e],
		rightTriggerDeadzone: data[offset + 0x6f]
	};

	// Primary mappings (18 slots × 2 bytes)
	const primaryMappings: InputMapping[] = [];
	for (let i = 0; i < MAPPING_SLOTS; i++) {
		primaryMappings.push(readMapping(data, offset + 0x70 + i * 2));
	}

	// Secondary mappings (18 slots × 2 bytes)
	const secondaryMappings: InputMapping[] = [];
	for (let i = 0; i < MAPPING_SLOTS; i++) {
		secondaryMappings.push(readMapping(data, offset + 0x94 + i * 2));
	}

	// Activation tail (7 bytes) + deactivate delay at 0x09
	const activation: ActivationConfig = {
		enabled: data[offset + 0xb8] !== 0,
		inherit: data[offset + 0xb9] !== 0,
		mode: data[offset + 0xba],
		buttonId: data[offset + 0xbb],
		toggleToActivate: data[offset + 0xbc] !== 0,
		activateDelay: data[offset + 0xbd],
		_reserved6: data[offset + 0xbe],
		deactivateDelay: data[offset + 0x09]
	};

	return {
		name,
		flags,
		translator,
		aim,
		curve,
		movement,
		controller,
		primaryMappings,
		secondaryMappings,
		activation,
		_reserved
	};
}

function readMapping(data: Uint8Array, offset: number): InputMapping {
	return {
		type: data[offset] as InputDevice,
		code: data[offset + 1]
	};
}

/** Restore original text bytes that were clobbered by space→null conversion */
function restoreText(data: Uint8Array, orig: Uint8Array, offset: number, length: number): void {
	for (let i = 0; i < length; i++) {
		data[offset + i] = orig[offset + i];
	}
}

function readString(data: Uint8Array, offset: number, length: number, pad: number): string {
	let end = offset + length;
	while (end > offset && (data[end - 1] === pad || data[end - 1] === 0x00)) {
		end--;
	}
	return new TextDecoder().decode(data.slice(offset, end));
}

// ==================== Serializer ====================

/** Serialize a ZmkFile object back to a .zmk binary buffer */
export function serializeZmk(zmk: ZmkFile): ArrayBuffer {
	const pad = zmk.legacyFormat ? 0x20 : 0x00;

	// Calculate notes section
	const notesBytes = new TextEncoder().encode(zmk.notes);
	// Pad notes section to align (original files have ~25 null bytes before text)
	const notesPadding = 25; // observed padding length
	const totalSize = PROFILES_START + BLOCK_COUNT * BLOCK_SIZE + notesPadding + notesBytes.length;

	const buffer = new ArrayBuffer(totalSize);
	const data = new Uint8Array(buffer);
	const view = new DataView(buffer);

	// Fill with padding byte if legacy
	if (zmk.legacyFormat) {
		data.fill(pad);
	}

	// Header
	writeString(data, 0, MAGIC_SIZE, zmk.magic, pad);
	writeString(data, MAGIC_SIZE, VERSION_SIZE, zmk.formatVersion, pad);
	writeString(data, MAGIC_SIZE + VERSION_SIZE, NAME_SIZE, zmk.profileName, pad);
	// Reserved 4 bytes at 0x40 (keep as pad)
	writeString(
		data,
		MAGIC_SIZE + VERSION_SIZE + NAME_SIZE + RESERVED_SIZE,
		APP_VERSION_SIZE,
		zmk.appVersion,
		pad
	);

	// Global settings
	data.set(zmk.globalSettings, HEADER_SIZE);

	// Profile blocks
	for (let i = 0; i < BLOCK_COUNT; i++) {
		const blockStart = PROFILES_START + i * BLOCK_SIZE;
		serializeProfile(data, view, blockStart, zmk.profiles[i], pad);
	}

	// Notes section
	const notesOffset = PROFILES_START + BLOCK_COUNT * BLOCK_SIZE;
	// Padding bytes are already 0x00 or 0x20 from fill
	data.set(notesBytes, notesOffset + notesPadding);

	return buffer;
}

function serializeProfile(
	data: Uint8Array,
	view: DataView,
	offset: number,
	profile: ZmkProfile,
	pad: number
): void {
	data[offset] = profile.flags;

	// Write reserved regions back
	data.set(profile._reserved.block01_08, offset + 0x01);
	data[offset + 0x09] = profile.activation.deactivateDelay;
	data.set(profile._reserved.block0A, offset + 0x0a);
	data.set(profile._reserved.block14_1A, offset + 0x14);
	data.set(profile._reserved.block1E_23, offset + 0x1e);
	data.set(profile._reserved.block26_29, offset + 0x26);
	data.set(profile._reserved.block41_4B, offset + 0x41);
	data.set(profile._reserved.block54_61, offset + 0x54);

	// Translator
	data[offset + 0x0b] = profile.translator.deadzoneShape;
	view.setUint16(offset + 0x0c, profile.translator.deadzoneX, true);
	view.setUint16(offset + 0x0e, profile.translator.deadzoneY, true);
	view.setUint16(offset + 0x10, profile.translator.analogStickize, true);
	view.setUint16(offset + 0x12, profile.translator.analogStickize, true); // duplicate

	// Aim
	view.setUint16(offset + 0x1b, profile.aim.sensitivity, true);
	data[offset + 0x1d] = profile.aim.xyRatio;
	data[offset + 0x24] = profile.aim.smoothness;
	data[offset + 0x25] = profile.aim.invertY ? 1 : 0;
	view.setInt16(offset + 0x2a, profile.aim.boost, true);

	// Curve
	for (let i = 0; i < CURVE_POINTS; i++) {
		const pt = profile.curve[i];
		data[offset + 0x2c + i] = (pt.y & ANCHOR_MASK) | (pt.anchor ? ANCHOR_BIT : 0);
	}

	// Movement
	writeMapping(data, offset + 0x4c, profile.movement.forward);
	writeMapping(data, offset + 0x4e, profile.movement.left);
	writeMapping(data, offset + 0x50, profile.movement.right);
	writeMapping(data, offset + 0x52, profile.movement.back);
	data[offset + 0x62] = profile.movement.walkScale;
	data[offset + 0x63] = profile.movement.analogSim;

	// Controller
	for (let i = 0; i < 6; i++) {
		data[offset + 0x64 + i] = profile.controller.ids[i];
	}
	view.setUint16(offset + 0x6a, profile.controller.leftStickDeadzone, true);
	view.setUint16(offset + 0x6c, profile.controller.rightStickDeadzone, true);
	data[offset + 0x6e] = profile.controller.leftTriggerDeadzone;
	data[offset + 0x6f] = profile.controller.rightTriggerDeadzone;

	// Primary mappings
	for (let i = 0; i < MAPPING_SLOTS; i++) {
		writeMapping(data, offset + 0x70 + i * 2, profile.primaryMappings[i]);
	}

	// Secondary mappings
	for (let i = 0; i < MAPPING_SLOTS; i++) {
		writeMapping(data, offset + 0x94 + i * 2, profile.secondaryMappings[i]);
	}

	// Activation tail
	data[offset + 0xb8] = profile.activation.enabled ? 1 : 0;
	data[offset + 0xb9] = profile.activation.inherit ? 1 : 0;
	data[offset + 0xba] = profile.activation.mode;
	data[offset + 0xbb] = profile.activation.buttonId;
	data[offset + 0xbc] = profile.activation.toggleToActivate ? 1 : 0;
	data[offset + 0xbd] = profile.activation.activateDelay;
	data[offset + 0xbe] = profile.activation._reserved6;
}

function writeMapping(data: Uint8Array, offset: number, mapping: InputMapping): void {
	data[offset] = mapping.type;
	data[offset + 1] = mapping.code;
}

function writeString(
	data: Uint8Array,
	offset: number,
	length: number,
	value: string,
	pad: number
): void {
	const bytes = new TextEncoder().encode(value);
	const writeLen = Math.min(bytes.length, length);
	data.set(bytes.subarray(0, writeLen), offset);
	// Pad remaining bytes
	for (let i = writeLen; i < length; i++) {
		data[offset + i] = pad;
	}
}

// ==================== Utilities ====================

/** Format a sensitivity/deadzone value for display (raw ÷ 100) */
export function formatValue100(raw: number): string {
	return (raw / 100).toFixed(2);
}

/** Parse a display value back to raw (× 100) */
export function parseValue100(display: string): number {
	return Math.round(parseFloat(display) * 100);
}

/** Format XY ratio for display */
export function formatXYRatio(raw: number): string {
	return (raw / 100).toFixed(2);
}

/** Create a default empty mapping */
export function emptyMapping(): InputMapping {
	return { type: InputDevice.None, code: 0x00 };
}

/** Check if a mapping slot is empty */
export function isMappingEmpty(m: InputMapping): boolean {
	return m.type === InputDevice.None;
}

/** Create a linear ballistic curve (output matches input) */
export function linearCurve(): CurvePoint[] {
	const points: CurvePoint[] = [];
	for (let i = 0; i < CURVE_POINTS; i++) {
		const x = i * CURVE_X_STEP;
		points.push({
			x,
			y: x,
			anchor: true
		});
	}
	return points;
}

/** Get only anchor points from a curve (for display in a points list) */
export function getAnchorPoints(curve: CurvePoint[]): CurvePoint[] {
	return curve.filter((p) => p.anchor);
}

// ==================== ZenStudio Clipboard ====================
// Format: 2-byte magic + 1 byte format version (5) + "1.0.0\0" + data
// Magics: KM = key mappings, BC = ballistic curve / tuning, @A = translator

const CLIP_HEADER_SIZE = 9; // magic(2) + fmtVer(1) + version(5) + null(1)
const CLIP_FMT_VER = 5;
const CLIP_VERSION = '1.0.0';

function clipHeader(magic: string): Uint8Array {
	const buf = new Uint8Array(CLIP_HEADER_SIZE);
	buf[0] = magic.charCodeAt(0);
	buf[1] = magic.charCodeAt(1);
	buf[2] = CLIP_FMT_VER;
	const ver = new TextEncoder().encode(CLIP_VERSION);
	buf.set(ver, 3);
	buf[8] = 0;
	return buf;
}

function checkClipHeader(data: Uint8Array, magic: string): boolean {
	return data[0] === magic.charCodeAt(0) && data[1] === magic.charCodeAt(1);
}

/** Encode 18 primary/secondary mappings to ZenStudio clipboard format */
export function encodeBindsClip(mappings: InputMapping[]): string {
	const header = clipHeader('KM');
	const body = new Uint8Array(MAPPING_SLOTS * 2);
	for (let i = 0; i < MAPPING_SLOTS; i++) {
		body[i * 2] = mappings[i].type;
		body[i * 2 + 1] = mappings[i].code;
	}
	const buf = new Uint8Array(header.length + body.length);
	buf.set(header);
	buf.set(body, header.length);
	return btoa(String.fromCharCode(...buf));
}

/** Decode ZenStudio binds clipboard to 18 mappings */
export function decodeBindsClip(b64: string): InputMapping[] | null {
	try {
		const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		if (!checkClipHeader(raw, 'KM')) return null;
		const data = raw.slice(CLIP_HEADER_SIZE - 1); // data starts after "1.0.0" (no null sep in binds)
		const mappings: InputMapping[] = [];
		for (let i = 0; i < MAPPING_SLOTS; i++) {
			mappings.push({
				type: data[i * 2] as InputDevice,
				code: data[i * 2 + 1]
			});
		}
		return mappings;
	} catch {
		return null;
	}
}

/** Encode ballistic curve to ZenStudio clipboard format (anchor points as Y0, X1,Y1, X2,Y2...) */
export function encodeCurveClip(curve: CurvePoint[]): string {
	const header = clipHeader('BC');
	const anchors = curve.filter((p) => p.anchor);
	// First anchor Y (X=0 implied), then (X, Y) pairs for the rest
	const padded = new Uint8Array(41); // ZenStudio uses 41 bytes data
	padded[0] = anchors[0].y;
	for (let i = 1; i < anchors.length; i++) {
		padded[1 + (i - 1) * 2] = anchors[i].x;
		padded[1 + (i - 1) * 2 + 1] = anchors[i].y;
	}
	const buf = new Uint8Array(header.length + padded.length);
	buf.set(header);
	buf.set(padded, header.length);
	return btoa(String.fromCharCode(...buf));
}

/** Decode ZenStudio curve clipboard */
export function decodeCurveClip(b64: string): CurvePoint[] | null {
	try {
		const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		if (!checkClipHeader(raw, 'BC') || raw.length > 30) {
			// BC with length > 30 could be tuning (25 bytes), curve is 50 bytes
			if (raw.length < 40) return null;
		}
		const data = raw.slice(CLIP_HEADER_SIZE);
		// Parse anchor points: first byte = Y at X=0, then (X, Y) pairs
		const anchors: { x: number; y: number }[] = [{ x: 0, y: data[0] }];
		for (let i = 1; i < data.length - 1; i += 2) {
			const x = data[i];
			const y = data[i + 1];
			if (x === 0 && y === 0) break;
			anchors.push({ x, y });
		}
		// Build full 21-point curve with interpolation
		const curve: CurvePoint[] = [];
		for (let i = 0; i < CURVE_POINTS; i++) {
			const x = i * CURVE_X_STEP;
			const anchor = anchors.find((a) => a.x === x);
			curve.push({ x, y: anchor?.y ?? 0, anchor: !!anchor });
		}
		// Interpolate between anchors
		const anchorIndices = curve.map((p, idx) => (p.anchor ? idx : -1)).filter((i) => i >= 0);
		for (let a = 0; a < anchorIndices.length - 1; a++) {
			const si = anchorIndices[a];
			const ei = anchorIndices[a + 1];
			for (let i = si + 1; i < ei; i++) {
				const t = (i - si) / (ei - si);
				curve[i].y = Math.round(curve[si].y + t * (curve[ei].y - curve[si].y));
			}
		}
		return curve;
	} catch {
		return null;
	}
}

/** Encode aim tuning to ZenStudio clipboard format */
export function encodeTuningClip(aim: AimSettings): string {
	const header = clipHeader('BC');
	const body = new Uint8Array(17); // same padding as ZenStudio
	const view = new DataView(body.buffer);
	view.setUint16(0, aim.sensitivity, true);
	body[2] = aim.xyRatio;
	body[3] = aim.smoothness;
	body[4] = aim.invertY ? 1 : 0;
	view.setInt16(5, aim.boost, true);
	// rest is zeros
	const buf = new Uint8Array(header.length + body.length);
	buf.set(header);
	buf.set(body, header.length);
	return btoa(String.fromCharCode(...buf));
}

/** Decode ZenStudio tuning clipboard */
export function decodeTuningClip(b64: string): AimSettings | null {
	try {
		const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		if (!checkClipHeader(raw, 'BC')) return null;
		// Tuning is ~25 bytes, curve is ~50 bytes
		if (raw.length > 30) return null;
		const data = raw.slice(CLIP_HEADER_SIZE);
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		return {
			sensitivity: view.getUint16(0, true),
			xyRatio: data[2],
			smoothness: data[3],
			invertY: data[4] !== 0,
			boost: view.getInt16(5, true)
		};
	} catch {
		return null;
	}
}

/** Encode translator settings to ZenStudio clipboard format */
export function encodeTranslatorClip(translator: TranslatorSettings): string {
	const header = clipHeader('@A');
	const body = new Uint8Array(16);
	const view = new DataView(body.buffer);
	body[0] = translator.deadzoneShape;
	view.setUint16(1, translator.deadzoneX, true);
	view.setUint16(3, translator.deadzoneY, true);
	view.setUint16(5, translator.analogStickize, true);
	view.setUint16(7, translator.analogStickize, true); // duplicate
	const buf = new Uint8Array(header.length + body.length);
	buf.set(header);
	buf.set(body, header.length);
	return btoa(String.fromCharCode(...buf));
}

/** Decode ZenStudio translator clipboard */
export function decodeTranslatorClip(b64: string): TranslatorSettings | null {
	try {
		const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		if (!checkClipHeader(raw, '@A')) return null;
		const data = raw.slice(CLIP_HEADER_SIZE);
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		return {
			deadzoneShape: data[0] as DeadzoneShape,
			deadzoneX: view.getUint16(1, true),
			deadzoneY: view.getUint16(3, true),
			analogStickize: view.getUint16(5, true)
		};
	} catch {
		return null;
	}
}
