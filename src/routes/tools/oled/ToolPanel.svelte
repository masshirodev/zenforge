<script lang="ts">
	import type { DrawTool, BrushShape, TextState, FontSize, TextAlign } from './types';

	interface Props {
		tool: DrawTool;
		brush: BrushShape;
		filled: boolean;
		textState: TextState;
		onToolChange: (tool: DrawTool) => void;
		onBrushChange: (brush: BrushShape) => void;
		onFilledChange: (filled: boolean) => void;
		onTextChange: (state: TextState) => void;
		onTextApply: () => void;
		onClear: () => void;
		onInvert: () => void;
		onShift: (dx: number, dy: number) => void;
		onImport: () => void;
	}

	let { tool, brush, filled, textState, onToolChange, onBrushChange, onFilledChange, onTextChange, onTextApply, onClear, onInvert, onShift, onImport }: Props =
		$props();

	const fontSizes: FontSize[] = ['3x5', '5x7', '8x8'];
	const alignments: { id: TextAlign; label: string; icon: string }[] = [
		{ id: 'left', label: 'Left', icon: 'M3 6h18M3 12h12M3 18h15' },
		{ id: 'center', label: 'Center', icon: 'M3 6h18M6 12h12M5 18h14' },
		{ id: 'right', label: 'Right', icon: 'M3 6h18M9 12h12M6 18h15' },
	];

	const tools: { id: DrawTool; label: string; key: string; icon: string }[] = [
		{ id: 'pen', label: 'Pen', key: 'P', icon: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z' },
		{ id: 'eraser', label: 'Eraser', key: 'E', icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' },
		{ id: 'line', label: 'Line', key: 'L', icon: 'M4 20L20 4' },
		{ id: 'rect', label: 'Rect', key: 'R', icon: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z' },
		{ id: 'ellipse', label: 'Ellipse', key: 'O', icon: 'M12 6a8 4 0 100 12 8 4 0 000-12z' },
		{ id: 'fill', label: 'Fill', key: 'G', icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12V9' },
		{ id: 'text', label: 'Text', key: 'T', icon: 'M4 6h16M4 6v2m16-2v2M7 6v12m0 0h2m-2 0H5m12-12v12m0 0h2m-2 0h-2' },
		{ id: 'move', label: 'Move', key: 'M', icon: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20' },
	];
</script>

<div class="flex flex-col gap-3">
	<!-- Tools -->
	<div>
		<h3 class="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Tools</h3>
		<div class="grid grid-cols-4 gap-1">
			{#each tools as t}
				<button
					class="flex flex-col items-center gap-0.5 rounded px-1.5 py-1.5 text-xs transition-colors
						{tool === t.id ? 'bg-emerald-600/20 text-emerald-400' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}"
					onclick={() => onToolChange(t.id)}
					title="{t.label} ({t.key})"
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d={t.icon} />
					</svg>
					<span>{t.label}</span>
				</button>
			{/each}
		</div>
	</div>

	<!-- Brush -->
	{#if tool === 'pen' || tool === 'eraser' || tool === 'line'}
		<div>
			<h3 class="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Brush</h3>
			<div class="space-y-2">
				<div class="flex gap-2">
					<button
						class="flex-1 rounded px-2 py-1 text-xs {brush.type === 'square'
							? 'bg-emerald-600/20 text-emerald-400'
							: 'text-zinc-400 hover:bg-zinc-800'}"
						onclick={() => onBrushChange({ ...brush, type: 'square' })}
					>
						Square
					</button>
					<button
						class="flex-1 rounded px-2 py-1 text-xs {brush.type === 'circle'
							? 'bg-emerald-600/20 text-emerald-400'
							: 'text-zinc-400 hover:bg-zinc-800'}"
						onclick={() => onBrushChange({ ...brush, type: 'circle' })}
					>
						Circle
					</button>
				</div>
				<label class="block">
					<span class="text-xs text-zinc-400">Width</span>
					<input
						type="range"
						min="1"
						max="32"
						value={brush.width}
						oninput={(e) =>
							onBrushChange({ ...brush, width: parseInt(e.currentTarget.value) })}
						class="mt-0.5 block w-full accent-emerald-600"
					/>
					<span class="text-xs text-zinc-500">{brush.width}px</span>
				</label>
				<label class="block">
					<span class="text-xs text-zinc-400">Height</span>
					<input
						type="range"
						min="1"
						max="32"
						value={brush.height}
						oninput={(e) =>
							onBrushChange({ ...brush, height: parseInt(e.currentTarget.value) })}
						class="mt-0.5 block w-full accent-emerald-600"
					/>
					<span class="text-xs text-zinc-500">{brush.height}px</span>
				</label>
			</div>
		</div>
	{/if}

	<!-- Shape Fill -->
	{#if tool === 'rect' || tool === 'ellipse'}
		<div>
			<h3 class="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Fill</h3>
			<div class="flex gap-2">
				<button
					class="flex-1 rounded px-2 py-1 text-xs {filled
						? 'bg-emerald-600/20 text-emerald-400'
						: 'text-zinc-400 hover:bg-zinc-800'}"
					onclick={() => onFilledChange(true)}
				>
					Filled
				</button>
				<button
					class="flex-1 rounded px-2 py-1 text-xs {!filled
						? 'bg-emerald-600/20 text-emerald-400'
						: 'text-zinc-400 hover:bg-zinc-800'}"
					onclick={() => onFilledChange(false)}
				>
					Outline
				</button>
			</div>
		</div>
	{/if}

	<!-- Text Settings -->
	{#if tool === 'text'}
		<div>
			<h3 class="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Text</h3>
			<div class="space-y-2">
				<input
					type="text"
					class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-600 focus:outline-none"
					placeholder="Type text..."
					value={textState.text}
					oninput={(e) => onTextChange({ ...textState, text: e.currentTarget.value })}
					onkeydown={(e) => {
						if (e.key === 'Enter' && textState.text && textState.originX >= 0) {
							e.preventDefault();
							onTextApply();
						}
					}}
				/>
				<div>
					<span class="text-xs text-zinc-400">Font Size</span>
					<div class="mt-1 flex gap-1">
						{#each fontSizes as size}
							<button
								class="flex-1 rounded px-2 py-1 text-xs {textState.fontSize === size
									? 'bg-emerald-600/20 text-emerald-400'
									: 'text-zinc-400 hover:bg-zinc-800'}"
								onclick={() => onTextChange({ ...textState, fontSize: size })}
							>
								{size}
							</button>
						{/each}
					</div>
				</div>
				<div>
					<span class="text-xs text-zinc-400">Alignment</span>
					<div class="mt-1 flex gap-1">
						{#each alignments as a}
							<button
								class="flex flex-1 items-center justify-center rounded px-2 py-1 text-xs {textState.align === a.id
									? 'bg-emerald-600/20 text-emerald-400'
									: 'text-zinc-400 hover:bg-zinc-800'}"
								onclick={() => onTextChange({ ...textState, align: a.id })}
								title="{a.label} align"
							>
								<svg class="mr-1 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d={a.icon} />
								</svg>
								{a.label}
							</button>
						{/each}
					</div>
				</div>
				{#if textState.originX < 0}
					<p class="text-xs text-zinc-500">Click on canvas to place text</p>
				{:else}
					<p class="text-xs text-zinc-500">
						Position: {textState.originX}, {textState.originY}
					</p>
					<button
						class="w-full rounded bg-emerald-600/20 px-2 py-1.5 text-xs text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-40 disabled:hover:bg-emerald-600/20"
						disabled={!textState.text}
						onclick={onTextApply}
					>
						Apply Text (Enter)
					</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Canvas Actions -->
	<div>
		<h3 class="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Actions</h3>
		<div class="space-y-1">
			<button
				class="w-full rounded px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
				onclick={onClear}
			>
				Clear Canvas
			</button>
			<button
				class="w-full rounded px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
				onclick={onInvert}
			>
				Invert Colors
			</button>
			<div class="flex items-center gap-1 pt-1">
				<span class="text-xs text-zinc-500">Shift:</span>
				<button
					class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					onclick={() => onShift(-1, 0)}
					title="Shift Left"
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
				</button>
				<button
					class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					onclick={() => onShift(1, 0)}
					title="Shift Right"
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" /></svg>
				</button>
				<button
					class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					onclick={() => onShift(0, -1)}
					title="Shift Up"
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
				</button>
				<button
					class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					onclick={() => onShift(0, 1)}
					title="Shift Down"
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
				</button>
			</div>
		</div>
	</div>

	<!-- Import -->
	<div>
		<button
			class="w-full rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
			onclick={onImport}
		>
			Import Image...
		</button>
	</div>
</div>
