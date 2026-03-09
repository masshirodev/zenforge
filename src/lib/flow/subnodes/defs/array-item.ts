import type { SubNodeDef } from '$lib/types/flow';
import { addString } from '$lib/types/flow';
import { widgetDrawRect } from '$lib/oled-widgets/types';
import { drawBitmapText, measureText } from '$lib/oled-widgets/font';

/**
 * Build the GPC array access expression based on indexMode.
 *
 * - 'direct':  arrayName[boundVar]
 * - '2d':      arrayName[parentVar][boundVar]
 * - 'offset':  arrayName[offsetArray[parentVar] + boundVar]
 */
function arrayAccessExpr(
	arrayName: string,
	boundVar: string,
	config: Record<string, unknown>
): string {
	const mode = (config.indexMode as string) || 'direct';
	const parentVar = (config.parentVar as string) || '';

	if ((mode === '2d' || mode === 'offset') && parentVar) {
		// Both 2d and offset use flattened array with offset table
		const offsetArray = (config.offsetArray as string) || `${arrayName}_Offsets`;
		return `${arrayName}[${offsetArray}[${parentVar}] + ${boundVar}]`;
	}
	return `${arrayName}[${boundVar}]`;
}

/**
 * Build the max expression for wrap-around cycling.
 *
 * - countMode 'fixed':    arraySize - 1
 * - countMode 'variable': countVar - 1
 * - countMode 'array':    countArray[parentVar] - 1
 */
function maxExpression(config: Record<string, unknown>): string {
	const countMode = (config.countMode as string) || 'fixed';
	const indexMode = (config.indexMode as string) || 'direct';
	const parentVar = (config.parentVar as string) || '';

	// 2d mode auto-derives count array from arrayName
	if (indexMode === '2d' && parentVar) {
		const arrayName = (config.arrayName as string) || '';
		return `(${arrayName}_RowCounts[${parentVar}] - 1)`;
	}

	if (countMode === 'array' && parentVar) {
		const countArray = (config.countArray as string) || '';
		if (countArray) return `(${countArray}[${parentVar}] - 1)`;
	}

	// Legacy: useCountVar + countVar (backwards compatible)
	const useCountVar = !!config.useCountVar;
	const countVar = (config.countVar as string) || '';
	if ((countMode === 'variable' || useCountVar) && countVar) {
		return `(${countVar} - 1)`;
	}

	const arraySize = (config.arraySize as number) || 10;
	return String(arraySize - 1);
}

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
		// Dependency (cascading) support
		indexMode: 'direct',
		parentVar: '',
		offsetArray: '',
		countMode: 'fixed',
		countArray: '',
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
		{ key: 'prefixChar', label: 'Prefix Character', type: 'string', default: '>', visibleWhen: { key: 'cursorStyle', values: ['prefix'] } },
		{ key: 'prefixSpacing', label: 'Prefix Spacing', type: 'number', default: 1, min: 0, max: 4, visibleWhen: { key: 'cursorStyle', values: ['prefix'] } },
		{ key: 'arrayName', label: 'Array Name', type: 'string', default: '', description: 'Name of the const string[] array in GPC code' },
		{ key: 'arraySize', label: 'Array Size', type: 'number', default: 10, min: 1, max: 100, visibleWhen: { key: 'indexMode', values: ['direct', undefined, ''] } },
		{ key: 'useCountVar', label: 'Use Variable for Count', type: 'boolean', default: false, description: 'Use a define/variable instead of a fixed number', visibleWhen: { key: 'indexMode', values: ['direct', undefined, ''] } },
		{ key: 'countVar', label: 'Count Variable', type: 'string', default: '', description: 'Define or variable holding the array length (e.g. WEAPON_COUNT)', visibleWhen: { key: 'useCountVar', values: [true] } },
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
		// --- Dependency / Cascading ---
		{
			key: 'indexMode',
			label: 'Index Mode',
			type: 'select',
			default: 'direct',
			description: 'How to index into the array. Use 2D or Offset for cascading dependencies.',
			options: [
				{ value: 'direct', label: 'Direct — array[index]' },
				{ value: '2d', label: '2D — auto offsets from Array Builder' },
				{ value: 'offset', label: 'Offset — custom offset/count arrays' },
			],
		},
		{
			key: 'parentVar',
			label: 'Parent Variable',
			type: 'string',
			default: '',
			description: 'Bound variable of the parent array-item this depends on',
			visibleWhen: { key: 'indexMode', values: ['2d', 'offset'] },
		},
		{
			key: 'offsetArray',
			label: 'Offset Array',
			type: 'string',
			default: '',
			description: 'Name of the int[] array holding per-parent offsets',
			visibleWhen: { key: 'indexMode', values: ['offset'] },
		},
		{
			key: 'countMode',
			label: 'Count Mode',
			type: 'select',
			default: 'fixed',
			description: 'How to determine the number of items to cycle through',
			options: [
				{ value: 'fixed', label: 'Fixed — arraySize' },
				{ value: 'variable', label: 'Variable — countVar' },
				{ value: 'array', label: 'Array — countArray[parent]' },
			],
			visibleWhen: { key: 'indexMode', values: ['offset'] },
		},
		{
			key: 'countArray',
			label: 'Count Array',
			type: 'string',
			default: '',
			description: 'Name of the int[] array holding per-parent counts',
			visibleWhen: { key: 'indexMode', values: ['offset'] },
		},
	],
	stackHeight: 8,
	render(config, ctx) {
		const style = (config.cursorStyle as string) || 'prefix';
		const label = (config as Record<string, unknown>).label as string || 'Array';
		const arrayName = (config.arrayName as string) || '?';
		const val = typeof ctx.boundValue === 'number' ? ctx.boundValue : 0;
		const mode = (config.indexMode as string) || 'direct';
		const parentVar = (config.parentVar as string) || '';

		let valStr: string;
		if ((mode === '2d' || mode === 'offset') && parentVar) {
			const oa = (config.offsetArray as string) || `${arrayName}_Offsets`;
			const shortOa = oa.length > 12 ? '..Off' : oa;
			valStr = `[${shortOa}[${parentVar}]+${val}]`;
		} else {
			valStr = `${arrayName}[${val}]`;
		}

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
		const font = 'OLED_FONT_SMALL';
		const label = (config as Record<string, unknown>).label as string || '';
		const boundVar = ctx.boundVariable || '_array_idx';
		const lines: string[] = [];

		const accessExpr = arrayAccessExpr(arrayName, boundVar, config);

		// Non-interactive: just print label (if any) + array value
		if (ctx.cursorIndex < 0) {
			if (label) {
				const labelIdx = addString(ctx, label);
				lines.push(`    print(${ctx.x + 2}, ${ctx.y}, ${font}, OLED_WHITE, ${ctx.stringArrayName}[${labelIdx}]);`);
			}
			lines.push(`    print(${label ? 80 : ctx.x + 2}, ${ctx.y}, ${font}, OLED_WHITE, ${accessExpr});`);
			return lines.join('\n');
		}

		const labelIdx = addString(ctx, label || 'Array');
		const labelRef = `${ctx.stringArrayName}[${labelIdx}]`;

		lines.push(`    // Array: ${label || 'Array'} (index ${ctx.cursorIndex})`);

		const prefixOffset = (prefix.length + spacing) * 6;
		const labelX = style === 'prefix' ? ctx.x + prefixOffset : ctx.x + 2;

		// Cursor rendering
		if (style === 'invert') {
			lines.push(`    if(${ctx.cursorVar} == ${ctx.cursorIndex}) {`);
			lines.push(`        rect_oled(${ctx.x}, ${ctx.y}, ${128 - ctx.x}, 8, 1, OLED_WHITE);`);
			if (label) lines.push(`        print(${ctx.x + 2}, ${ctx.y}, ${font}, OLED_BLACK, ${labelRef});`);
			lines.push(`        print(${label ? 80 : ctx.x + 2}, ${ctx.y}, ${font}, OLED_BLACK, ${accessExpr});`);
			lines.push(`    } else {`);
			if (label) lines.push(`        print(${ctx.x + 2}, ${ctx.y}, ${font}, OLED_WHITE, ${labelRef});`);
			lines.push(`        print(${label ? 80 : ctx.x + 2}, ${ctx.y}, ${font}, OLED_WHITE, ${accessExpr});`);
			lines.push(`    }`);
		} else {
			const prefixIdx = addString(ctx, prefix);
			const prefixRef = `${ctx.stringArrayName}[${prefixIdx}]`;
			lines.push(`    if(${ctx.cursorVar} == ${ctx.cursorIndex}) print(${ctx.x}, ${ctx.y}, ${font}, OLED_WHITE, ${prefixRef});`);
			if (label) lines.push(`    print(${labelX}, ${ctx.y}, ${font}, OLED_WHITE, ${labelRef});`);
			lines.push(`    print(${label ? 80 : labelX}, ${ctx.y}, ${font}, OLED_WHITE, ${accessExpr});`);
		}

		return lines.join('\n');
	},
	generateGpcInput(config, ctx) {
		if (ctx.cursorIndex < 0) return '';
		const boundVar = ctx.boundVariable || '_array_idx';
		const label = (config as Record<string, unknown>).label as string || 'Array';
		const maxExpr = maxExpression(config);
		const onChangeCode = (config.onChangeCode as string) || '';
		const changeSuffix = onChangeCode ? ` ${onChangeCode}` : '';
		const lines: string[] = [];

		lines.push(`    // Array cycle: ${label}`);
		lines.push(`    if(${ctx.cursorVar} == ${ctx.cursorIndex}) {`);
		lines.push(`        if(event_press(${ctx.buttons.left})) { ${boundVar}--; if(${boundVar} < 0) ${boundVar} = ${maxExpr}; FlowRedraw = TRUE;${changeSuffix} }`);
		lines.push(`        if(event_press(${ctx.buttons.right})) { ${boundVar}++; if(${boundVar} > ${maxExpr}) ${boundVar} = 0; FlowRedraw = TRUE;${changeSuffix} }`);
		lines.push(`    }`);

		return lines.join('\n');
	},
};
