import type { SubNodeDef } from '$lib/types/flow';
import { widgetSetPixel } from '$lib/oled-widgets/types';

export const animationDef: SubNodeDef = {
	id: 'animation',
	name: 'Animation',
	category: 'display',
	description: 'Multi-frame pixel animation (opens OLED animation editor)',
	interactive: false,
	defaultConfig: {
		scenes: [],
		frameDelayMs: 100,
		loop: true,
		width: 128,
		height: 64,
	},
	params: [
		{ key: 'frameDelayMs', label: 'Frame Delay (ms)', type: 'number', default: 100, min: 10, max: 10000 },
		{
			key: 'loop',
			label: 'Loop',
			type: 'boolean',
			default: true,
		},
		{ key: 'width', label: 'Width', type: 'number', default: 128, min: 1, max: 128 },
		{ key: 'height', label: 'Height', type: 'number', default: 64, min: 1, max: 64 },
	],
	stackHeight: 64,
	render(config, ctx) {
		// Render the first frame as a static preview
		const scenes = config.scenes as { pixels?: string }[] | null;
		if (!scenes || scenes.length === 0) return;

		const scene = scenes[0];
		if (!scene?.pixels) return;

		try {
			const raw = atob(scene.pixels);
			const bytes = new Uint8Array(raw.length);
			for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

			const cropW = (config.width as number) || 128;
			const cropH = (config.height as number) || 64;

			for (let py = 0; py < cropH && py < 64; py++) {
				for (let px = 0; px < cropW && px < 128; px++) {
					const byteIdx = py * 16 + Math.floor(px / 8);
					const bitIdx = 7 - (px % 8);
					if (byteIdx < bytes.length && bytes[byteIdx] & (1 << bitIdx)) {
						widgetSetPixel(ctx.pixels, ctx.x + px, ctx.y + py);
					}
				}
			}
		} catch {
			// Invalid base64 — skip
		}
	},
	generateGpc(config, ctx) {
		const scenes = config.scenes as { id?: string; name?: string; pixels?: string }[] | null;
		if (!scenes || scenes.length === 0) return '    // Animation: no frames';

		const cropW = (config.width as number) || 128;
		const cropH = (config.height as number) || 64;
		const frameCount = scenes.length;

		// Generate const image for each frame
		const imageNames: string[] = [];
		for (let fi = 0; fi < frameCount; fi++) {
			const scene = scenes[fi];
			if (!scene?.pixels) continue;

			try {
				const raw = atob(scene.pixels);
				const bytes = new Uint8Array(raw.length);
				for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

				const packed: number[] = [];
				let currentByte = 0;
				let bit = 0;
				for (let py = 0; py < cropH && py < 64; py++) {
					for (let px = 0; px < cropW && px < 128; px++) {
						currentByte <<= 1;
						const byteIdx = py * 16 + Math.floor(px / 8);
						const bitIdx = 7 - (px % 8);
						if (byteIdx < bytes.length && bytes[byteIdx] & (1 << bitIdx)) {
							currentByte |= 1;
						}
						bit++;
						if (bit === 8) {
							packed.push(currentByte);
							currentByte = 0;
							bit = 0;
						}
					}
				}
				if (bit > 0) {
					packed.push(currentByte << (8 - bit));
				}

				const hexRows: string[] = [];
				for (let i = 0; i < packed.length; i += 16) {
					const row = packed
						.slice(i, Math.min(i + 16, packed.length))
						.map((b) => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`)
						.join(', ');
					hexRows.push(`    ${row}`);
				}

				const imageIdx = ctx.images.length;
				const imageName = `${ctx.varPrefix}_anim${imageIdx}`;
				const decl = `const image ${imageName} = {${cropW}, ${cropH},\n${hexRows.join(',\n')}\n};`;
				ctx.images.push(decl);
				imageNames.push(imageName);
			} catch {
				// Skip invalid frame
			}
		}

		if (imageNames.length === 0) return '    // Animation: no valid frames';

		// Single frame — just render it directly (no animation logic needed)
		if (imageNames.length === 1) {
			return `    // Animation (1 frame)\n    image_oled(${ctx.x}, ${ctx.y}, TRUE, TRUE, ${imageNames[0]}[0]);`;
		}

		// Multi-frame: render based on current frame variable
		// Timer advancement and frame calculation happen outside FlowRedraw (added by codegen engine)
		const frameVar = `${ctx.varPrefix}_animFrame`;

		const lines: string[] = [];
		lines.push(`    // Animation (${imageNames.length} frames)`);

		for (let i = 0; i < imageNames.length; i++) {
			const keyword = i === 0 ? 'if' : 'else if';
			lines.push(`    ${keyword}(${frameVar} == ${i}) { image_oled(${ctx.x}, ${ctx.y}, TRUE, TRUE, ${imageNames[i]}[0]); }`);
		}

		return lines.join('\n');
	},
};
