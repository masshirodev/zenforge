import type { SubNodeDef } from '$lib/types/flow';
import { addString } from '$lib/types/flow';
import { widgetDrawRect } from '$lib/oled-widgets/types';
import { drawBitmapText, measureText } from '$lib/oled-widgets/font';

export const arrayItemDef: SubNodeDef = {
	id: 'array-item',
	name: 'Array Item',
	category: 'interactive',
	description: 'Menu item that cycles through a string array (e.g. weapon names)',
	interactive: true,
	defaultConfig: {
		cursorStyle: 'prefix',
		prefixChar: '>',
		prefixSpacing: 1,
		arrayName: '',
		arraySize: 10,
		useCountVar: false,
		countVar: '',
		font: 'default',
	},
	params: [
		{
			key: 'cursorStyle',
			label: 'Cursor Style',
			type: 'select',
			default: 'prefix',
			options: [
				{ value: 'prefix', label: 'Prefix Character' },
				{ value: 'invert', label: 'Invert Row' },
				{ value: 'bracket', label: 'Brackets' },
			],
		},
		{ key: 'prefixChar', label: 'Prefix Character', type: 'string', default: '>' },
		{ key: 'prefixSpacing', label: 'Prefix Spacing', type: 'number', default: 1, min: 0, max: 4 },
		{ key: 'arrayName', label: 'Array Name', type: 'string', default: '', description: 'Name of the const string[] array in GPC code' },
		{ key: 'arraySize', label: 'Array Size', type: 'number', default: 10, min: 1, max: 100 },
		{ key: 'useCountVar', label: 'Use Variable for Count', type: 'boolean', default: false, description: 'Use a define/variable (e.g. WEAPON_COUNT) instead of a fixed number' },
		{ key: 'countVar', label: 'Count Variable', type: 'string', default: '', description: 'Define or variable holding the array length (e.g. WEAPON_COUNT)' },
		{
			key: 'font',
			label: 'Font',
			type: 'select',
			default: 'default',
			options: [
				{ value: 'default', label: 'Default (5x7)' },
				{ value: 'small', label: 'Small (3x5)' },
			],
		},
	],
	stackHeight: 8,
	render(config, ctx) {
		const style = (config.cursorStyle as string) || 'prefix';
		const label = (config as Record<string, unknown>).label as string || 'Array';
		const arrayName = (config.arrayName as string) || '?';
		const val = typeof ctx.boundValue === 'number' ? ctx.boundValue : 0;
		const valStr = `${arrayName}[${val}]`;
		const on = style !== 'invert' || !ctx.isSelected;

		if (ctx.isSelected && style === 'invert') {
			widgetDrawRect(ctx.pixels, ctx.x, ctx.y, ctx.x + ctx.width - 1, ctx.y + 7, true);
		}

		if (ctx.isSelected && style === 'prefix') {
			const prefix = (config.prefixChar as string) || '>';
			drawBitmapText(ctx.pixels, prefix, ctx.x, ctx.y);
		}

		if (ctx.isSelected && style === 'bracket') {
			drawBitmapText(ctx.pixels, `[${label}]`, ctx.x, ctx.y, on);
		} else {
			const textX = ctx.isSelected && style === 'prefix' ? ctx.x + 8 : ctx.x + 2;
			drawBitmapText(ctx.pixels, label, textX, ctx.y, on);
		}

		// Show array reference on right
		const valX = ctx.x + ctx.width - measureText(valStr) - 2;
		drawBitmapText(ctx.pixels, valStr, valX, ctx.y, on);
	},
	generateGpc(config, ctx) {
		const style = (config.cursorStyle as string) || 'prefix';
		const prefix = (config.prefixChar as string) || '>';
		const spacing = (config.prefixSpacing as number) ?? 1;
		const arrayName = (config.arrayName as string) || 'ArrayData';
		const arraySize = (config.arraySize as number) || 10;
		const useCountVar = !!config.useCountVar;
		const countVar = (config.countVar as string) || '';
		const font = 'OLED_FONT_SMALL';
		const label = (config as Record<string, unknown>).label as string || 'Array';
		const boundVar = ctx.boundVariable || '_array_idx';
		const labelIdx = addString(ctx, label);
		const labelRef = `${ctx.stringArrayName}[${labelIdx}]`;
		const lines: string[] = [];

		lines.push(`    // Array: ${label} (index ${ctx.cursorIndex})`);

		const prefixOffset = (prefix.length + spacing) * 6;
		const labelX = style === 'prefix' ? ctx.x + prefixOffset : ctx.x + 2;

		// Cursor rendering
		if (style === 'invert') {
			lines.push(`    if(${ctx.cursorVar} == ${ctx.cursorIndex}) {`);
			lines.push(`        rect_oled(${ctx.x}, ${ctx.y}, ${128 - ctx.x}, 8, 1, OLED_WHITE);`);
			lines.push(`        print(${ctx.x + 2}, ${ctx.y}, ${font}, OLED_BLACK, ${labelRef});`);
			lines.push(`        print(80, ${ctx.y}, ${font}, OLED_BLACK, ${arrayName}[${boundVar}]);`);
			lines.push(`    } else {`);
			lines.push(`        print(${ctx.x + 2}, ${ctx.y}, ${font}, OLED_WHITE, ${labelRef});`);
			lines.push(`        print(80, ${ctx.y}, ${font}, OLED_WHITE, ${arrayName}[${boundVar}]);`);
			lines.push(`    }`);
		} else {
			const prefixIdx = addString(ctx, prefix);
			const prefixRef = `${ctx.stringArrayName}[${prefixIdx}]`;
			lines.push(`    if(${ctx.cursorVar} == ${ctx.cursorIndex}) print(${ctx.x}, ${ctx.y}, ${font}, OLED_WHITE, ${prefixRef});`);
			lines.push(`    print(${labelX}, ${ctx.y}, ${font}, OLED_WHITE, ${labelRef});`);
			lines.push(`    print(80, ${ctx.y}, ${font}, OLED_WHITE, ${arrayName}[${boundVar}]);`);
		}

		// Wrap-around cycling with left/right
		const maxExpr = useCountVar && countVar ? `(${countVar} - 1)` : String(arraySize - 1);
		lines.push(`    if(${ctx.cursorVar} == ${ctx.cursorIndex}) {`);
		lines.push(`        if(event_press(${ctx.buttons.left})) { ${boundVar}--; if(${boundVar} < 0) ${boundVar} = ${maxExpr}; }`);
		lines.push(`        if(event_press(${ctx.buttons.right})) { ${boundVar}++; if(${boundVar} > ${maxExpr}) ${boundVar} = 0; }`);
		lines.push(`    }`);

		return lines.join('\n');
	},
};
