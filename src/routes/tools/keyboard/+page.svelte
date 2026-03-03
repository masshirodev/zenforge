<script lang="ts">
	import { goto } from '$app/navigation';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';
	import {
		getKeyboardTransfer,
		setKeyboardTransfer,
		clearKeyboardTransfer
	} from '$lib/stores/keyboard-transfer.svelte';
	import {
		type KeyMapping,
		removeMapping,
		toggleMapping,
		serializeKeyboardMappings
	} from '$lib/utils/keyboard-parser';
	import {
		CONTROLLER_LAYOUT,
		KEYBOARD_KEYS,
		BUTTON_GROUPS,
		getButtonLabel,
		getControllerButtons,
		getLayoutButtonName
	} from '$lib/utils/keyboard-constants';
	import {
		CONSOLE_TYPES,
		CONSOLE_LABELS,
		type ConsoleType
	} from '$lib/utils/console-buttons';
	import { addToast } from '$lib/stores/toast.svelte';
	import { onMount } from 'svelte';
	import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';

	let mappings = $state<KeyMapping[]>([]);
	let returnTo = $state<string | null>(null);

	// Console state
	let outputConsole = $state<ConsoleType>('ps5');
	let inputConsole = $state<ConsoleType>('ps5');

	// Mode: 'select_target' or 'select_source' or 'idle'
	let mode = $state<'idle' | 'select_target' | 'select_source'>('idle');
	let pendingTarget = $state<string | null>(null);

	let sourceTab = $state<'keyboard' | 'controller'>('keyboard');
	let sourceFilter = $state('');

	// Load transfer data on mount (must be in onMount for client-side state)
	onMount(() => {
		const transfer = getKeyboardTransfer();
		if (transfer) {
			mappings = [...transfer.mappings];
			returnTo = transfer.returnTo;
			outputConsole = transfer.outputConsole;
			inputConsole = transfer.inputConsole;
			clearKeyboardTransfer();
		}
	});

	function handleReturnToEditor() {
		if (returnTo === null) return;
		setKeyboardTransfer({
			mappings: [...mappings],
			returnTo,
			outputConsole,
			inputConsole
		});
		goto('/');
	}

	function handleTargetClick(buttonName: string) {
		pendingTarget = buttonName;
		mode = 'select_source';
		sourceFilter = '';
	}

	function handleSourceClick(sourceId: string, type: 'keyboard' | 'controller') {
		if (!pendingTarget) return;

		const isAxis = pendingTarget.endsWith('X') || pendingTarget.endsWith('Y');
		const defaultValue = type === 'controller' ? 0 : isAxis ? -100 : 100;

		const newMapping: KeyMapping = {
			source: sourceId,
			target: pendingTarget,
			value: defaultValue,
			type,
			enabled: true
		};

		mappings = [...mappings, newMapping];
		pendingTarget = null;
		mode = 'idle';
	}

	function handleRemove(idx: number) {
		mappings = removeMapping(mappings, idx);
	}

	function handleToggle(idx: number) {
		mappings = toggleMapping(mappings, idx);
	}

	function handleUpdateValue(idx: number, value: number) {
		mappings = mappings.map((m, i) => (i === idx ? { ...m, value } : m));
	}

	function handleCancel() {
		pendingTarget = null;
		mode = 'idle';
	}

	function getMappingsForButton(buttonName: string): KeyMapping[] {
		return mappings.filter((m) => m.target === buttonName);
	}

	function getButtonColor(buttonName: string): string {
		const btnMappings = getMappingsForButton(buttonName);
		if (selectedTarget === buttonName) return 'bg-blue-600 text-white border-blue-400';
		if (btnMappings.length === 0) return 'bg-zinc-700/80 text-zinc-400 border-zinc-600';
		return 'bg-emerald-900/60 text-emerald-300 border-emerald-600';
	}

	let selectedTarget = $derived(pendingTarget);

	let currentSourceList = $derived.by(() => {
		let list =
			sourceTab === 'keyboard' ? KEYBOARD_KEYS : getControllerButtons(inputConsole);

		if (sourceFilter.trim()) {
			const q = sourceFilter.toLowerCase();
			list = list.filter(
				(s) => s.label.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
			);
		}
		return list;
	});

	let showCode = $state(false);
	let showClearConfirm = $state(false);
	let comboPickerIdx = $state<number | null>(null);

	function handleSetCombo(idx: number, comboBtn: string) {
		mappings = mappings.map((m, i) =>
			i === idx ? { ...m, sourceCombo: comboBtn, type: 'controller' as const } : m
		);
		comboPickerIdx = null;
	}

	function handleRemoveCombo(idx: number) {
		mappings = mappings.map((m, i) => {
			if (i !== idx) return m;
			const { sourceCombo: _, ...rest } = m;
			return rest;
		});
	}

	function handleClearAll() {
		mappings = [];
		showClearConfirm = false;
		addToast('All mappings cleared', 'success');
	}

	// Skeleton template for standalone code generation
	const SKELETON = `function ApplyKeyboard() {\n    // No mappings configured\n}`;

	let generatedCode = $derived(serializeKeyboardMappings(SKELETON, mappings));

	async function handleCopyCode() {
		try {
			await navigator.clipboard.writeText(generatedCode);
			addToast('Code copied to clipboard', 'success');
		} catch {
			addToast('Failed to copy to clipboard', 'error');
		}
	}
</script>

<div class="flex h-full flex-col bg-zinc-950">
	<!-- Header -->
	<ToolHeader title="Keyboard / Controller Mapper" subtitle="Map keyboard keys and controller buttons">
		<span class="text-sm text-zinc-500">({mappings.length} mappings)</span>
		<div class="ml-auto flex items-center gap-2">
			{#if mappings.length > 0}
				<button
					class="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
					onclick={() => (showCode = !showCode)}
				>
					{showCode ? 'Hide Code' : 'Show Code'}
				</button>
				<button
					class="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
					onclick={handleCopyCode}
				>
					Copy Code
				</button>
				<button
					class="rounded border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/30"
					onclick={() => (showClearConfirm = true)}
				>
					Clear All
				</button>
			{/if}
			{#if returnTo}
				<button
					class="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
					onclick={handleReturnToEditor}
				>
					Return to Editor
				</button>
			{/if}
		</div>
	</ToolHeader>

	{#if showCode}
		<div class="h-48 border-b border-zinc-800">
			<MonacoEditor value={generatedCode} language="gpc" readonly />
		</div>
	{/if}

	<div class="flex flex-1 overflow-hidden">
		<!-- Left panel: Source selection -->
		<div class="flex w-64 flex-col border-r border-zinc-800 bg-zinc-900/50">
			<div class="border-b border-zinc-800 p-3">
				<div class="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
					Source Input
				</div>
				<!-- Tabs -->
				<div class="mb-2 flex gap-1">
					{#each ['keyboard', 'controller'] as tab}
						<button
							class="flex-1 rounded px-2 py-1 text-xs font-medium {sourceTab === tab
								? 'bg-zinc-700 text-zinc-200'
								: 'text-zinc-500 hover:text-zinc-300'}"
							onclick={() => (sourceTab = tab as typeof sourceTab)}
						>
							{tab === 'keyboard' ? 'Keys' : 'Controller'}
						</button>
					{/each}
				</div>
				{#if sourceTab === 'controller'}
					<div class="mb-2">
						<select
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
							bind:value={inputConsole}
						>
							{#each CONSOLE_TYPES as ct}
								<option value={ct}>{CONSOLE_LABELS[ct]}</option>
							{/each}
						</select>
					</div>
				{/if}
				<input
					type="text"
					placeholder="Filter..."
					bind:value={sourceFilter}
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
				/>
			</div>
			<div class="flex-1 overflow-y-auto p-2">
				<div class="grid grid-cols-4 gap-1">
					{#each currentSourceList as source}
						<button
							class="rounded border px-1 py-1.5 text-[10px] font-medium transition-colors {mode ===
							'select_source'
								? 'border-zinc-600 bg-zinc-800 text-zinc-300 hover:border-blue-400 hover:bg-blue-900/30'
								: 'border-zinc-700 bg-zinc-800/50 text-zinc-500'}"
							disabled={mode !== 'select_source'}
							onclick={() => handleSourceClick(source.id, sourceTab)}
							title={source.id}
						>
							{source.label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<!-- Center: Controller diagram -->
		<div class="flex flex-1 flex-col items-center justify-center overflow-auto p-6">
			{#if mode === 'select_source'}
				<div
					class="mb-4 rounded-lg border border-blue-800 bg-blue-900/20 px-4 py-2 text-sm text-blue-300"
				>
					Select a source key/button for <span class="font-semibold"
						>{getButtonLabel(pendingTarget ?? '')}</span
					>
					<button
						class="ml-3 text-xs text-blue-400 underline hover:text-blue-300"
						onclick={handleCancel}
					>
						Cancel
					</button>
				</div>
			{:else}
				<div class="mb-4 text-sm text-zinc-500">
					Click a controller button to assign a mapping
				</div>
			{/if}

			<!-- Output console selector -->
			<div class="mb-3 flex items-center gap-2">
				<label class="text-xs text-zinc-500">Output Console:</label>
				<select
					class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
					bind:value={outputConsole}
				>
					{#each CONSOLE_TYPES as ct}
						<option value={ct}>{CONSOLE_LABELS[ct]}</option>
					{/each}
				</select>
			</div>

			<div class="relative w-full max-w-xl" style="aspect-ratio: 16/10;">
				<!-- Controller body -->
				<div class="absolute inset-0 rounded-3xl border-2 border-zinc-700 bg-zinc-900/80"></div>

				{#each CONTROLLER_LAYOUT as pos}
					{@const btnName = getLayoutButtonName(pos, outputConsole)}
					{@const btnMappings = getMappingsForButton(btnName)}
					<button
						class="absolute flex flex-col items-center justify-center rounded-md border text-[11px] font-medium transition-all hover:brightness-125 {getButtonColor(
							btnName
						)}"
						style="left: {pos.x}%; top: {pos.y}%; width: {pos.width}%; height: {pos.height}%;"
						onclick={() => handleTargetClick(btnName)}
					>
						<span>{getButtonLabel(btnName)}</span>
						{#if btnMappings.length > 0}
							<span class="text-[9px] opacity-75">
								{btnMappings.map((m) => m.sourceCombo ? `${getButtonLabel(m.sourceCombo)}+${getButtonLabel(m.source)}` : getButtonLabel(m.source)).join(', ')}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<!-- Right panel: Mapping list -->
		<div class="flex w-72 flex-col border-l border-zinc-800 bg-zinc-900/50">
			<div class="border-b border-zinc-800 p-3">
				<div class="text-xs font-medium uppercase tracking-wider text-zinc-500">
					Mapping List
				</div>
			</div>
			<div class="flex-1 overflow-y-auto p-2">
				{#if mappings.length === 0}
					<p class="py-8 text-center text-xs text-zinc-600">No mappings yet</p>
				{:else}
					<div class="space-y-1">
						{#each mappings as mapping, idx}
							<div
								class="group rounded border border-zinc-800 bg-zinc-800/30 px-2 py-1.5"
								class:opacity-40={!mapping.enabled}
							>
								<div class="flex items-center gap-1.5 text-xs">
									{#if mapping.sourceCombo}
										<span class="rounded bg-purple-900/50 px-1 py-0.5 text-purple-400">
											{getButtonLabel(mapping.sourceCombo)}
										</span>
										<span class="text-zinc-600">+</span>
									{/if}
									<span
										class="rounded px-1 py-0.5 {mapping.type === 'keyboard'
											? 'bg-blue-900/50 text-blue-400'
											: 'bg-amber-900/50 text-amber-400'}"
									>
										{getButtonLabel(mapping.source)}
									</span>
									<span class="text-zinc-600">&rarr;</span>
									<span class="text-zinc-300">{getButtonLabel(mapping.target)}</span>
									<div class="ml-auto flex gap-1 opacity-0 group-hover:opacity-100">
										{#if mapping.type === 'controller'}
											{#if mapping.sourceCombo}
												<button
													class="text-purple-400 hover:text-purple-300"
													onclick={() => handleRemoveCombo(idx)}
													title="Remove combo"
												>
													−
												</button>
											{:else}
												<button
													class="text-zinc-500 hover:text-purple-400"
													onclick={() => (comboPickerIdx = comboPickerIdx === idx ? null : idx)}
													title="Add combo button"
												>
													+
												</button>
											{/if}
										{/if}
										<button
											class="text-zinc-500 hover:text-zinc-300"
											onclick={() => handleToggle(idx)}
											title={mapping.enabled ? 'Disable' : 'Enable'}
										>
											{mapping.enabled ? '●' : '○'}
										</button>
										<button
											class="text-zinc-500 hover:text-red-400"
											onclick={() => handleRemove(idx)}
											title="Remove"
										>
											✕
										</button>
									</div>
								</div>
								{#if comboPickerIdx === idx}
									<div class="mt-1 rounded border border-purple-800/50 bg-purple-900/10 p-1.5">
										<div class="mb-1 text-[10px] text-purple-400">Select held button:</div>
										<div class="flex flex-wrap gap-0.5">
											{#each getControllerButtons(inputConsole).filter((b) => b.id !== mapping.source).slice(0, 20) as btn}
												<button
													class="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-300 hover:border-purple-500 hover:text-purple-300"
													onclick={() => handleSetCombo(idx, btn.id)}
												>
													{btn.label}
												</button>
											{/each}
										</div>
									</div>
								{/if}
								{#if mapping.value !== 0}
									<div class="mt-1 flex items-center gap-2">
										<span class="text-[10px] text-zinc-600">Value:</span>
										<input
											type="number"
											value={mapping.value}
											class="w-16 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-300 focus:border-emerald-500 focus:outline-none"
											onchange={(e) =>
												handleUpdateValue(
													idx,
													parseInt(e.currentTarget.value) || 100
												)}
										/>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

{#if showClearConfirm}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
		onkeydown={(e) => e.key === 'Escape' && (showClearConfirm = false)}
		onclick={(e) => e.target === e.currentTarget && (showClearConfirm = false)}
	>
		<div class="w-80 rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-xl">
			<h3 class="mb-2 text-sm font-semibold text-zinc-100">Clear All Mappings</h3>
			<p class="mb-4 text-xs text-zinc-400">
				Are you sure you want to remove all {mappings.length} mapping(s)? This cannot be undone.
			</p>
			<div class="flex justify-end gap-2">
				<button
					class="rounded px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
					onclick={() => (showClearConfirm = false)}
				>
					Cancel
				</button>
				<button
					class="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
					onclick={handleClearAll}
				>
					Clear All
				</button>
			</div>
		</div>
	</div>
{/if}
