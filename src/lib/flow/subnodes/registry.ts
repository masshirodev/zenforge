import type { SubNodeDef } from '$lib/types/flow';
import { headerDef } from './defs/header';
import { menuItemDef } from './defs/menu-item';
import { toggleItemDef } from './defs/toggle-item';
import { valueItemDef } from './defs/value-item';
import { arrayItemDef } from './defs/array-item';
import { scrollBarDef } from './defs/scroll-bar';
import { textLineDef } from './defs/text-line';
import { barDef } from './defs/bar';
import { indicatorDef } from './defs/indicator';
import { pixelArtDef } from './defs/pixel-art';
import { separatorDef } from './defs/separator';
import { blankDef } from './defs/blank';
import { customDef } from './defs/custom';

const ALL_SUBNODE_DEFS: SubNodeDef[] = [
	headerDef,
	menuItemDef,
	toggleItemDef,
	valueItemDef,
	arrayItemDef,
	scrollBarDef,
	textLineDef,
	barDef,
	indicatorDef,
	pixelArtDef,
	separatorDef,
	blankDef,
	customDef,
];

const defMap = new Map<string, SubNodeDef>(ALL_SUBNODE_DEFS.map((d) => [d.id, d]));

export function getSubNodeDef(id: string): SubNodeDef | undefined {
	return defMap.get(id);
}

export function listSubNodeDefs(category?: string): SubNodeDef[] {
	if (!category) return ALL_SUBNODE_DEFS;
	return ALL_SUBNODE_DEFS.filter((d) => d.category === category);
}

export function listSubNodeCategories(): string[] {
	return [...new Set(ALL_SUBNODE_DEFS.map((d) => d.category))];
}

export const SUBNODE_CATEGORY_LABELS: Record<string, string> = {
	text: 'Text & Headers',
	interactive: 'Interactive Items',
	display: 'Display Widgets',
	advanced: 'Advanced',
};
