<script lang="ts">
	import type { OledLayer } from './types';

	interface Props {
		layers: OledLayer[];
		activeLayerId: string;
		onSelect: (id: string) => void;
		onToggleVisibility: (id: string) => void;
		onAdd: () => void;
		onDelete: (id: string) => void;
		onRename: (id: string, name: string) => void;
		onReorder: (fromIndex: number, toIndex: number) => void;
		onMergeDown: (id: string) => void;
		onDuplicate: (id: string) => void;
		onConditionChange: (id: string, condition: OledLayer['condition']) => void;
	}

	let {
		layers,
		activeLayerId,
		onSelect,
		onToggleVisibility,
		onAdd,
		onDelete,
		onRename,
		onReorder,
		onMergeDown,
		onDuplicate,
		onConditionChange
	}: Props = $props();

	let editingId = $state<string | null>(null);
	let editingName = $state('');
	let dragIndex = $state(-1);
	let dropIndex = $state(-1);
	let expandedCondition = $state<string | null>(null);

	function startRename(id: string, name: string) {
		editingId = id;
		editingName = name;
	}

	function commitRename() {
		if (editingId && editingName.trim()) {
			onRename(editingId, editingName.trim());
		}
		editingId = null;
	}

	function handleDragStart(e: DragEvent, index: number) {
		dragIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		}
	}

	function handleDragOver(e: DragEvent, index: number) {
		e.preventDefault();
		dropIndex = index;
	}

	function handleDrop(e: DragEvent, index: number) {
		e.preventDefault();
		if (dragIndex >= 0 && dragIndex !== index) {
			onReorder(dragIndex, index);
		}
		dragIndex = -1;
		dropIndex = -1;
	}

	function handleDragEnd() {
		dragIndex = -1;
		dropIndex = -1;
	}
</script>

<div>
	<div class="mb-2 flex items-center justify-between">
		<h3 class="text-xs font-medium uppercase tracking-wider text-zinc-500">Layers</h3>
		<button
			class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
			onclick={onAdd}
			title="Add layer"
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
				<path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
			</svg>
		</button>
	</div>

	<div class="space-y-0.5">
		{#each layers as layer, i}
			{@const isActive = layer.id === activeLayerId}
			{@const isDragOver = dropIndex === i && dragIndex !== i}
			<div
				class="group rounded border transition-colors
					{isActive ? 'border-emerald-600/40 bg-emerald-950/30' : 'border-transparent hover:bg-zinc-800/50'}
					{isDragOver ? 'border-t-2 border-t-blue-500' : ''}"
				draggable="true"
				role="listitem"
				ondragstart={(e) => handleDragStart(e, i)}
				ondragover={(e) => handleDragOver(e, i)}
				ondrop={(e) => handleDrop(e, i)}
				ondragend={handleDragEnd}
			>
				<div class="flex items-center gap-1 px-1.5 py-1">
					<!-- Visibility toggle -->
					<button
						class="shrink-0 rounded p-0.5 {layer.visible ? 'text-zinc-300' : 'text-zinc-600'} hover:bg-zinc-700"
						onclick={(e) => { e.stopPropagation(); onToggleVisibility(layer.id); }}
						title={layer.visible ? 'Hide layer' : 'Show layer'}
					>
						<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
							{#if layer.visible}
								<path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
								<path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd" />
							{:else}
								<path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd" />
								<path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
							{/if}
						</svg>
					</button>

					<!-- Layer name (click to select, dblclick to rename) -->
					{#if editingId === layer.id}
						<input
							type="text"
							class="min-w-0 flex-1 rounded bg-zinc-800 px-1 py-0.5 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-emerald-600"
							bind:value={editingName}
							onblur={commitRename}
							onkeydown={(e) => {
								if (e.key === 'Enter') commitRename();
								if (e.key === 'Escape') { editingId = null; }
							}}
							autofocus
						/>
					{:else}
						<button
							class="min-w-0 flex-1 truncate text-left text-xs {isActive ? 'text-emerald-400' : 'text-zinc-300'}"
							onclick={() => onSelect(layer.id)}
							ondblclick={() => startRename(layer.id, layer.label)}
						>
							{layer.label}
						</button>
					{/if}

					<!-- Condition indicator -->
					{#if layer.condition?.variable}
						<button
							class="shrink-0 rounded p-0.5 text-amber-400 hover:bg-zinc-700"
							onclick={(e) => { e.stopPropagation(); expandedCondition = expandedCondition === layer.id ? null : layer.id; }}
							title="Has condition"
						>
							<svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
								<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
							</svg>
						</button>
					{/if}

					<!-- Actions (visible on hover) -->
					<div class="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
						<button
							class="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
							onclick={(e) => { e.stopPropagation(); onDuplicate(layer.id); }}
							title="Duplicate layer"
						>
							<svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
								<path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
								<path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h8a2 2 0 00-2-2H5z" />
							</svg>
						</button>
						{#if i < layers.length - 1}
							<button
								class="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
								onclick={(e) => { e.stopPropagation(); onMergeDown(layer.id); }}
								title="Merge down"
							>
								<svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
									<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clip-rule="evenodd" />
								</svg>
							</button>
						{/if}
						{#if layers.length > 1}
							<button
								class="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
								onclick={(e) => { e.stopPropagation(); onDelete(layer.id); }}
								title="Delete layer"
							>
								<svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
									<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
								</svg>
							</button>
						{/if}
					</div>
				</div>

				<!-- Condition editor (expanded) -->
				{#if expandedCondition === layer.id}
					<div class="border-t border-zinc-800 px-2 py-1.5">
						<div class="space-y-1.5">
							<label class="block">
								<span class="text-[10px] uppercase text-zinc-500">Variable</span>
								<input
									type="text"
									class="mt-0.5 block w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-600 focus:outline-none"
									placeholder="e.g. toggleA"
									value={layer.condition?.variable ?? ''}
									oninput={(e) => onConditionChange(layer.id, { ...layer.condition, variable: e.currentTarget.value })}
								/>
							</label>
							<div class="flex gap-1">
								<label class="flex-1">
									<span class="text-[10px] uppercase text-zinc-500">Op</span>
									<select
										class="mt-0.5 block w-full rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-200 focus:border-emerald-600 focus:outline-none"
										value={layer.condition?.operator ?? '=='}
										onchange={(e) => onConditionChange(layer.id, { ...layer.condition, operator: e.currentTarget.value })}
									>
										<option value="==">==</option>
										<option value="!=">!=</option>
										<option value=">">{'>'}</option>
										<option value="<">{'<'}</option>
										<option value=">=">{'≥'}</option>
										<option value="<=">{'≤'}</option>
									</select>
								</label>
								<label class="flex-1">
									<span class="text-[10px] uppercase text-zinc-500">Value</span>
									<input
										type="text"
										class="mt-0.5 block w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-600 focus:outline-none"
										placeholder="1"
										value={layer.condition?.value ?? ''}
										oninput={(e) => onConditionChange(layer.id, { ...layer.condition, value: e.currentTarget.value })}
									/>
								</label>
							</div>
							<button
								class="text-[10px] text-zinc-500 hover:text-zinc-300"
								onclick={() => { onConditionChange(layer.id, null); expandedCondition = null; }}
							>
								Clear condition
							</button>
						</div>
					</div>
				{/if}

				<!-- Add condition button (if no condition set) -->
				{#if !layer.condition?.variable && expandedCondition !== layer.id && isActive}
					<button
						class="w-full border-t border-zinc-800/50 px-2 py-0.5 text-left text-[10px] text-zinc-600 hover:text-zinc-400"
						onclick={() => { expandedCondition = layer.id; onConditionChange(layer.id, { variable: '', operator: '==', value: '' }); }}
					>
						+ Add condition
					</button>
				{/if}
			</div>
		{/each}
	</div>

	<p class="mt-2 text-[10px] text-zinc-600">
		Drag to reorder. Double-click to rename.
	</p>
</div>
