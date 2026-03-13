<script lang="ts">
	import type { FlowNode, SubNode, SubNodeType } from '$lib/types/flow';
	import { getSubNodeDef } from '$lib/flow/subnodes/registry';
	import { getSortedSubNodes, computeSubNodePixelY } from '$lib/flow/layout';
	import { renderNodePreview, pixelsToDataUrl } from '$lib/flow/oled-preview';

	interface Props {
		open: boolean;
		node: FlowNode;
		onUpdateNode: (id: string, updates: Partial<FlowNode>) => void;
		onAddSubNode: (nodeId: string, type: SubNodeType, label: string) => void;
		onRemoveSubNode: (nodeId: string, subNodeId: string) => void;
		onUpdateSubNode: (nodeId: string, subNodeId: string, updates: Partial<SubNode>) => void;
		onclose: () => void;
	}

	let { open, node, onUpdateNode, onAddSubNode, onRemoveSubNode, onUpdateSubNode, onclose }: Props = $props();

	const SCALE = 3;
	const CANVAS_W = 128;
	const CANVAS_H = 64;

	let dragging = $state<'offset' | null>(null);
	let activePreset = $state<string | null>(null);
	let saveName = $state('');
	let showSaveForm = $state(false);

	// Reset highlighted preset when modal reopens or node changes
	$effect(() => {
		void node.id;
		void open;
		activePreset = null;
	});

	// Saved layout templates (localStorage)
	// Saves layout settings (offsets, scroll, visible count) — NOT the sub-node items.
	// Users apply a template to an already-built node to adjust its layout.
	interface SavedTemplate {
		id: string;
		name: string;
		offsetX: number;
		offsetY: number;
		lineMargin?: number;
		scrollMode?: 'window' | 'wrap';
		visibleCount?: number;
	}

	const STORAGE_KEY = 'zenforge:layout-templates';

	function loadSavedTemplates(): SavedTemplate[] {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			return raw ? JSON.parse(raw) : [];
		} catch { return []; }
	}

	function persistTemplates(templates: SavedTemplate[]) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
	}

	let savedTemplates = $state<SavedTemplate[]>(loadSavedTemplates());

	function saveCurrentLayout() {
		const name = saveName.trim();
		if (!name) return;
		const template: SavedTemplate = {
			id: crypto.randomUUID(),
			name,
			offsetX: node.stackOffsetX,
			offsetY: node.stackOffsetY,
			lineMargin: node.lineMargin,
			scrollMode: node.scrollMode,
			visibleCount: node.visibleCount,
		};
		savedTemplates = [...savedTemplates, template];
		persistTemplates(savedTemplates);
		saveName = '';
		showSaveForm = false;
	}

	function deleteSavedTemplate(id: string) {
		savedTemplates = savedTemplates.filter((t) => t.id !== id);
		persistTemplates(savedTemplates);
	}

	function applySavedTemplate(template: SavedTemplate) {
		onUpdateNode(node.id, {
			stackOffsetX: template.offsetX,
			stackOffsetY: template.offsetY,
			lineMargin: template.lineMargin,
			scrollMode: template.scrollMode,
			visibleCount: template.visibleCount,
		});
		activePreset = template.id;
	}

	// Compute layout info for each sub-node
	let layoutItems = $derived.by(() => {
		const sorted = getSortedSubNodes(node);
		return sorted.map((sub) => {
			const def = getSubNodeDef(sub.type);
			const y = computeSubNodePixelY(node, sub);
			const h = def?.stackHeight ?? 8;
			return { sub, def, y, h };
		});
	});

	let interactiveCount = $derived(layoutItems.filter((i) => i.sub.interactive).length);
	let stackedItems = $derived(layoutItems.filter((i) => i.sub.position === 'stack'));
	let totalStackHeight = $derived(
		stackedItems.reduce((sum, i) => sum + i.h, 0) + Math.max(0, stackedItems.length - 1) * (node.lineMargin ?? 0)
	);
	let contentBottom = $derived(node.stackOffsetY + totalStackHeight);

	// Live OLED preview
	let previewUrl = $derived(
		open && node.subNodes.length > 0 && typeof document !== 'undefined'
			? pixelsToDataUrl(renderNodePreview(node))
			: ''
	);

	function handleCanvasMouseDown(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = Math.round((e.clientX - rect.left) / SCALE);
		const y = Math.round((e.clientY - rect.top) / SCALE);
		dragging = 'offset';
		onUpdateNode(node.id, { stackOffsetX: Math.max(0, Math.min(x, 120)), stackOffsetY: Math.max(0, Math.min(y, 56)) });
	}

	function handleCanvasMouseMove(e: MouseEvent) {
		if (!dragging) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = Math.round((e.clientX - rect.left) / SCALE);
		const y = Math.round((e.clientY - rect.top) / SCALE);
		onUpdateNode(node.id, { stackOffsetX: Math.max(0, Math.min(x, 120)), stackOffsetY: Math.max(0, Math.min(y, 56)) });
	}

	function handleCanvasMouseUp() {
		dragging = null;
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	// Preset templates
	interface MenuPreset {
		id: string;
		name: string;
		description: string;
		offsetX: number;
		offsetY: number;
		subNodes: Array<{ type: SubNodeType; label: string; config?: Record<string, unknown>; position?: 'stack' | 'absolute'; x?: number; y?: number }>;
	}

	const presets: MenuPreset[] = [
		{
			id: 'compact-3',
			name: 'Compact (3 items)',
			description: 'Header + 3 small items, top-aligned',
			offsetX: 0,
			offsetY: 0,
			subNodes: [
				{ type: 'header', label: 'MENU', config: { separator: true, paddingTop: 0 } },
				{ type: 'menu-item', label: 'Item 1', config: { cursorStyle: 'prefix' } },
				{ type: 'menu-item', label: 'Item 2', config: { cursorStyle: 'prefix' } },
				{ type: 'menu-item', label: 'Item 3', config: { cursorStyle: 'prefix' } },
			],
		},
		{
			id: 'centered-5',
			name: 'Centered (5 items)',
			description: 'Header + 5 items centered vertically',
			offsetX: 0,
			offsetY: 0,
			subNodes: [
				{ type: 'header', label: 'SETTINGS', config: { align: 'center', separator: true } },
				{ type: 'menu-item', label: 'Option 1', config: { cursorStyle: 'invert' } },
				{ type: 'menu-item', label: 'Option 2', config: { cursorStyle: 'invert' } },
				{ type: 'menu-item', label: 'Option 3', config: { cursorStyle: 'invert' } },
				{ type: 'menu-item', label: 'Option 4', config: { cursorStyle: 'invert' } },
				{ type: 'menu-item', label: 'Option 5', config: { cursorStyle: 'invert' } },
			],
		},
		{
			id: 'scrollable-list',
			name: 'Scrollable List',
			description: 'Header + items with scrollbar',
			offsetX: 0,
			offsetY: 0,
			subNodes: [
				{ type: 'header', label: 'SELECT', config: { separator: true } },
				{ type: 'menu-item', label: 'Entry 1', config: { cursorStyle: 'invert' } },
				{ type: 'menu-item', label: 'Entry 2', config: { cursorStyle: 'invert' } },
				{ type: 'menu-item', label: 'Entry 3', config: { cursorStyle: 'invert' } },
				{ type: 'menu-item', label: 'Entry 4', config: { cursorStyle: 'invert' } },
				{ type: 'scroll-bar', label: 'Scrollbar', config: { orientation: 'vertical', thickness: 3, style: 'bar', trackVisible: true, autoSource: true }, position: 'absolute', x: 125, y: 10 },
			],
		},
		{
			id: 'toggles',
			name: 'Toggle Settings',
			description: 'Header + toggle items for settings',
			offsetX: 0,
			offsetY: 0,
			subNodes: [
				{ type: 'header', label: 'OPTIONS', config: { separator: true } },
				{ type: 'toggle-item', label: 'Feature A', config: { onText: 'ON', offText: 'OFF' } },
				{ type: 'toggle-item', label: 'Feature B', config: { onText: 'ON', offText: 'OFF' } },
				{ type: 'toggle-item', label: 'Feature C', config: { onText: 'ON', offText: 'OFF' } },
			],
		},
		{
			id: 'values',
			name: 'Value Settings',
			description: 'Header + value items for numeric settings',
			offsetX: 0,
			offsetY: 0,
			subNodes: [
				{ type: 'header', label: 'ADJUST', config: { separator: true } },
				{ type: 'value-item', label: 'Speed', config: { min: 0, max: 100, step: 5 } },
				{ type: 'value-item', label: 'Strength', config: { min: 0, max: 100, step: 5 } },
				{ type: 'value-item', label: 'Delay', config: { min: 0, max: 500, step: 10 } },
			],
		},
		{
			id: 'status-display',
			name: 'Status Screen',
			description: 'Header + text lines + indicator bars',
			offsetX: 0,
			offsetY: 0,
			subNodes: [
				{ type: 'header', label: 'STATUS', config: { align: 'center', separator: true } },
				{ type: 'text-line', label: 'Profile: Default', config: {} },
				{ type: 'separator', label: '', config: {} },
				{ type: 'bar', label: 'Sensitivity', config: { style: 'filled', width: 100 } },
				{ type: 'text-line', label: 'Ready', config: {} },
			],
		},
	];

	function applyPreset(preset: MenuPreset) {
		for (const sub of [...node.subNodes]) {
			onRemoveSubNode(node.id, sub.id);
		}
		onUpdateNode(node.id, { stackOffsetX: preset.offsetX, stackOffsetY: preset.offsetY });
		for (const item of preset.subNodes) {
			onAddSubNode(node.id, item.type, item.label);
		}
		activePreset = preset.id;

		setTimeout(() => {
			const sorted = getSortedSubNodes(node);
			for (let i = 0; i < Math.min(sorted.length, preset.subNodes.length); i++) {
				const presetSub = preset.subNodes[i];
				const updates: Partial<SubNode> = { label: presetSub.label, displayText: presetSub.label };
				if (presetSub.config) {
					updates.config = { ...sorted[i].config, ...presetSub.config };
				}
				if (presetSub.position) {
					updates.position = presetSub.position;
					updates.x = presetSub.x ?? 0;
					updates.y = presetSub.y ?? 0;
				}
				onUpdateSubNode(node.id, sorted[i].id, updates);
			}
		}, 50);
	}
</script>

{#if open}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
	onmousedown={handleBackdrop}
	onkeydown={handleKeydown}
>
	<div class="flex max-h-[85vh] w-[720px] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
			<div>
				<h2 class="text-sm font-semibold text-zinc-100">Menu Layout Builder</h2>
				<p class="text-[11px] text-zinc-500">{node.label}</p>
			</div>
			<button
				class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
				onclick={onclose}
			>
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Body -->
		<div class="flex min-h-0 flex-1 overflow-hidden">
			<!-- Left: Preview + Controls -->
			<div class="flex flex-1 flex-col gap-3 overflow-y-auto border-r border-zinc-800 p-4">
				<!-- OLED Canvas -->
				<div class="rounded border border-zinc-800 bg-zinc-950 p-2">
					<div class="mb-1.5 flex items-center justify-between">
						<span class="text-[10px] font-medium uppercase tracking-wider text-zinc-500">OLED Layout</span>
						<span class="text-[10px] text-zinc-600">Click to set content start</span>
					</div>

					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="relative cursor-crosshair overflow-hidden rounded border border-zinc-700"
						style="width: {CANVAS_W * SCALE}px; height: {CANVAS_H * SCALE}px;"
						onmousedown={handleCanvasMouseDown}
						onmousemove={handleCanvasMouseMove}
						onmouseup={handleCanvasMouseUp}
						onmouseleave={handleCanvasMouseUp}
						role="presentation"
					>
						{#if previewUrl}
							<img src={previewUrl} alt="OLED preview" class="absolute inset-0 h-full w-full" style="image-rendering: pixelated;" />
						{:else}
							<div class="absolute inset-0 bg-zinc-950"></div>
						{/if}

						<svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 {CANVAS_W} {CANVAS_H}">
							<line x1={node.stackOffsetX} y1="0" x2={node.stackOffsetX} y2={CANVAS_H} stroke="rgba(16, 185, 129, 0.4)" stroke-width="0.5" stroke-dasharray="2,2" />
							<line x1="0" y1={node.stackOffsetY} x2={CANVAS_W} y2={node.stackOffsetY} stroke="rgba(16, 185, 129, 0.4)" stroke-width="0.5" stroke-dasharray="2,2" />
							<circle cx={node.stackOffsetX} cy={node.stackOffsetY} r="2" fill="rgba(16, 185, 129, 0.8)" />
							{#each layoutItems as item}
								{#if item.sub.position === 'stack'}
									<rect x={node.stackOffsetX} y={item.y} width={CANVAS_W - node.stackOffsetX} height={item.h} fill="none" stroke={item.sub.interactive ? 'rgba(168, 85, 247, 0.3)' : 'rgba(100, 100, 100, 0.2)'} stroke-width="0.5" />
								{/if}
							{/each}
							{#if contentBottom <= CANVAS_H}
								<line x1={node.stackOffsetX} y1={contentBottom} x2={CANVAS_W} y2={contentBottom} stroke="rgba(239, 68, 68, 0.3)" stroke-width="0.5" stroke-dasharray="1,1" />
							{/if}
						</svg>
					</div>

					<div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-zinc-500">
						<span>Start: <span class="text-zinc-300">{node.stackOffsetX},{node.stackOffsetY}</span></span>
						<span>Items: <span class="text-zinc-300">{interactiveCount}</span></span>
						<span>Height: <span class="text-zinc-300">{totalStackHeight}px</span></span>
						{#if contentBottom > CANVAS_H}
							<span class="text-amber-400">Overflow: {contentBottom - CANVAS_H}px</span>
						{/if}
					</div>
				</div>

				<!-- Controls -->
				<div class="flex gap-2">
					<div class="flex-1">
						<label class="mb-0.5 block text-[10px] text-zinc-500">Content X</label>
						<input type="number" class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none" value={node.stackOffsetX} min="0" max="120" onchange={(e) => onUpdateNode(node.id, { stackOffsetX: parseInt((e.target as HTMLInputElement).value) || 0 })} />
					</div>
					<div class="flex-1">
						<label class="mb-0.5 block text-[10px] text-zinc-500">Content Y</label>
						<input type="number" class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none" value={node.stackOffsetY} min="0" max="56" onchange={(e) => onUpdateNode(node.id, { stackOffsetY: parseInt((e.target as HTMLInputElement).value) || 0 })} />
					</div>
					<div class="flex-1">
						<label class="mb-0.5 block text-[10px] text-zinc-500">Line Margin</label>
						<input type="number" class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none" value={node.lineMargin ?? 0} min="0" max="16" onchange={(e) => onUpdateNode(node.id, { lineMargin: parseInt((e.target as HTMLInputElement).value) || 0 })} />
					</div>
					<div class="flex-1">
						<label class="mb-0.5 block text-[10px] text-zinc-500">Visible Items</label>
						<input type="number" class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none" value={node.visibleCount ?? interactiveCount} min="1" max="20" onchange={(e) => onUpdateNode(node.id, { visibleCount: parseInt((e.target as HTMLInputElement).value) || undefined })} />
					</div>
				</div>

				<!-- Scroll mode -->
				{#if interactiveCount > 0}
					<div>
						<label class="mb-0.5 block text-[10px] text-zinc-500">Scroll Mode</label>
						<div class="flex gap-1">
							{#each [{ value: undefined, label: 'None' }, { value: 'window', label: 'Window' }, { value: 'wrap', label: 'Wrap' }] as opt}
								<button
									class="flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors {node.scrollMode === opt.value ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300'}"
									onclick={() => onUpdateNode(node.id, { scrollMode: opt.value as 'window' | 'wrap' | undefined })}
								>
									{opt.label}
								</button>
							{/each}
						</div>
						<p class="mt-0.5 text-[9px] text-zinc-600">
							{#if node.scrollMode === 'window'}
								Shows a window of items, scrolls when cursor moves past visible area
							{:else if node.scrollMode === 'wrap'}
								Cursor wraps from last item to first and vice versa
							{:else}
								No scrolling, all items visible at once
							{/if}
						</p>
					</div>
				{/if}

				<!-- Layout Items -->
				<div>
					<div class="mb-1 flex items-center justify-between">
						<span class="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Layout Items</span>
						<span class="text-[10px] text-zinc-600">{node.subNodes.length} items</span>
					</div>
					<div class="space-y-0.5">
						{#each layoutItems as item, i}
							<div class="flex items-center gap-1.5 rounded bg-zinc-800/50 px-2 py-1 text-xs">
								<span class="w-4 text-center text-[10px] text-zinc-600">{i}</span>
								<span class="w-3 rounded text-center text-[9px] {item.sub.interactive ? 'bg-purple-900/50 text-purple-400' : 'bg-zinc-800 text-zinc-600'}">
									{item.sub.interactive ? 'I' : '-'}
								</span>
								<span class="min-w-0 flex-1 truncate text-zinc-300" title={item.sub.label}>
									{item.sub.label || item.def?.name || item.sub.type}
								</span>
								<span class="shrink-0 text-[10px] text-zinc-500">y{item.y}</span>
								<span class="shrink-0 text-[10px] text-zinc-500">h{item.h}</span>
							</div>
						{/each}
					</div>
				</div>
			</div>

			<!-- Right: Templates -->
			<div class="flex w-56 shrink-0 flex-col overflow-y-auto p-4">
				<!-- Save current layout -->
				<div class="mb-3">
					{#if showSaveForm}
						<form class="flex flex-col gap-1" onsubmit={(e) => { e.preventDefault(); saveCurrentLayout(); }}>
							<input
								type="text"
								class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
								placeholder="Template name..."
								bind:value={saveName}
							/>
							<div class="flex gap-1">
								<button type="submit" class="flex-1 rounded bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-500" disabled={!saveName.trim()}>Save</button>
								<button type="button" class="flex-1 rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-700" onclick={() => { showSaveForm = false; saveName = ''; }}>Cancel</button>
							</div>
						</form>
					{:else}
						<button
							class="w-full rounded border border-dashed border-zinc-600 px-2 py-1.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
							onclick={() => { showSaveForm = true; }}
						>
							Save Layout Settings
						</button>
					{/if}
				</div>

				<!-- Saved templates -->
				{#if savedTemplates.length > 0}
					<div class="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Saved</div>
					<div class="mb-3 flex flex-col gap-1.5">
						{#each savedTemplates as template}
							<div class="group relative">
								<button
									class="w-full rounded border px-3 py-2 text-left transition-colors {activePreset === template.id ? 'border-emerald-600 bg-emerald-950/30' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600 hover:bg-zinc-800'}"
									onclick={() => applySavedTemplate(template)}
								>
									<div class="text-[11px] font-medium text-zinc-300">{template.name}</div>
									<div class="mt-0.5 text-[9px] leading-tight text-zinc-500">{template.offsetX},{template.offsetY} · {template.scrollMode ?? 'no scroll'}</div>
								</button>
								<button
									class="absolute right-1 top-1 rounded p-0.5 text-zinc-600 opacity-0 hover:bg-zinc-700 hover:text-red-400 group-hover:opacity-100"
									onclick={() => deleteSavedTemplate(template.id)}
									title="Delete template"
								>
									<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Built-in presets -->
				<div class="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Built-in</div>
				<div class="flex flex-col gap-1.5">
					{#each presets as preset}
						<button
							class="rounded border px-3 py-2 text-left transition-colors {activePreset === preset.id ? 'border-emerald-600 bg-emerald-950/30' : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600 hover:bg-zinc-800'}"
							onclick={() => applyPreset(preset)}
							title={preset.description}
						>
							<div class="text-[11px] font-medium text-zinc-300">{preset.name}</div>
							<div class="mt-0.5 text-[9px] leading-tight text-zinc-500">{preset.description}</div>
						</button>
					{/each}
				</div>
			</div>
		</div>

		<!-- Footer -->
		<div class="flex justify-end border-t border-zinc-800 px-5 py-3">
			<button
				class="rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
				onclick={onclose}
			>
				Done
			</button>
		</div>
	</div>
</div>
{/if}
