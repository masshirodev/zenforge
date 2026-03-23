<script lang="ts">
	import type { GameConfig, GameSummary, GameMeta } from '$lib/types/config';
	import { saveGameMeta } from '$lib/tauri/commands';
	import { addToast } from '$lib/stores/toast.svelte';
	import { getSettings, updateSettings } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages.js';

	interface Props {
		game: GameSummary;
		meta: GameMeta | null;
		config: GameConfig | null;
		onTagsChanged?: (tags: string[]) => void;
		onMetaChanged?: () => void;
		onSaveAsTemplate?: () => void;
		onExportZip?: () => void;
	}

	let { game, meta, config, onTagsChanged, onMetaChanged, onSaveAsTemplate, onExportZip }: Props = $props();

	let isFlowGame = $derived(game.generation_mode === 'flow');

	let settingsStore = getSettings();
	let settings = $derived($settingsStore);

	// --- Metadata editing ---
	let editingMeta = $state(false);
	let editName = $state('');
	let editGameType = $state('');
	let editConsoleType = $state('');
	let editVersion = $state(0);
	let editUsername = $state('');
	let editFilename = $state('');
	let metaSaving = $state(false);

	function startEditingMeta() {
		if (!meta) return;
		editName = meta.name;
		editGameType = meta.game_type;
		editConsoleType = meta.console_type;
		editVersion = meta.version;
		editUsername = meta.username ?? '';
		editFilename = meta.filename;
		editingMeta = true;
	}

	function cancelEditingMeta() {
		editingMeta = false;
	}

	async function saveMetadata() {
		if (!meta) return;
		metaSaving = true;
		try {
			await saveGameMeta(game.path, {
				...meta,
				name: editName,
				game_type: editGameType,
				console_type: editConsoleType,
				version: editVersion,
				username: editUsername || undefined,
				filename: editFilename
			});
			editingMeta = false;
			addToast('Game metadata saved', 'success', 2000);
			onMetaChanged?.();
		} catch (e) {
			addToast(`Failed to save metadata: ${e}`, 'error');
		} finally {
			metaSaving = false;
		}
	}

	// --- Header comments editing ---
	let headerComments = $state('');
	let commentsSaving = $state(false);
	let generateModuleInfo = $state(true);

	$effect(() => {
		headerComments = meta?.header_comments ?? '';
		generateModuleInfo = meta?.generate_module_info !== false;
	});

	async function saveHeaderComments() {
		if (!meta) return;
		commentsSaving = true;
		try {
			await saveGameMeta(game.path, {
				...meta,
				header_comments: headerComments || undefined,
				generate_module_info: generateModuleInfo,
			});
			addToast('Header comments saved', 'success', 2000);
			onMetaChanged?.();
		} catch (e) {
			addToast(`Failed to save comments: ${e}`, 'error');
		} finally {
			commentsSaving = false;
		}
	}

	async function toggleModuleInfo() {
		if (!meta) return;
		generateModuleInfo = !generateModuleInfo;
		try {
			await saveGameMeta(game.path, {
				...meta,
				generate_module_info: generateModuleInfo,
			});
			onMetaChanged?.();
		} catch {
			// Revert on error
			generateModuleInfo = !generateModuleInfo;
		}
	}

	function saveHeaderCommentsAsDefault() {
		updateSettings({ defaultHeaderComments: headerComments || '' });
		addToast('Saved as default for new games', 'success', 2000);
	}

	// --- Tags editing ---
	let newTag = $state('');
	let tags = $state<string[]>([]);

	// Sync tags from meta/game when they change
	$effect(() => {
		tags = [...(meta?.tags ?? game.tags ?? [])];
	});

	async function addTag() {
		const tag = newTag.trim().toLowerCase();
		if (!tag || tags.includes(tag)) {
			newTag = '';
			return;
		}
		tags = [...tags, tag];
		newTag = '';
		await saveTags();
	}

	async function removeTag(tag: string) {
		tags = tags.filter(t => t !== tag);
		await saveTags();
	}

	async function saveTags() {
		if (!meta) return;
		try {
			await saveGameMeta(game.path, { ...meta, tags });
			onTagsChanged?.(tags);
		} catch (e) {
			addToast(m.toast_failed_save_tags({ error: String(e) }), 'error');
		}
	}
</script>

{#if isFlowGame && meta}
	<!-- Flow-based game overview -->
	<div class="grid grid-cols-2 gap-4">
		<div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-sm font-semibold tracking-wider text-zinc-400 uppercase">
					{m.editor_overview_metadata()}
				</h2>
				{#if !editingMeta}
					<button
						class="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={startEditingMeta}
					>
						Edit
					</button>
				{/if}
			</div>

			{#if editingMeta}
				<div class="space-y-2">
					<div class="rounded bg-zinc-800/50 px-3 py-2">
						<label class="mb-1 block text-xs text-zinc-400">{m.editor_overview_name()}</label>
						<input
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							bind:value={editName}
						/>
					</div>
					<div class="rounded bg-zinc-800/50 px-3 py-2">
						<label class="mb-1 block text-xs text-zinc-400">{m.editor_overview_game_type()}</label>
						<input
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							bind:value={editGameType}
						/>
					</div>
					<div class="rounded bg-zinc-800/50 px-3 py-2">
						<label class="mb-1 block text-xs text-zinc-400">{m.editor_overview_console()}</label>
						<select
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							bind:value={editConsoleType}
						>
							<option value="ps5">PS5</option>
							<option value="ps4">PS4</option>
							<option value="xbox">Xbox</option>
							<option value="switch">Switch</option>
						</select>
					</div>
					<div class="rounded bg-zinc-800/50 px-3 py-2">
						<label class="mb-1 block text-xs text-zinc-400">{m.editor_overview_version()}</label>
						<input
							type="number"
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							bind:value={editVersion}
							min="0"
						/>
					</div>
					<div class="rounded bg-zinc-800/50 px-3 py-2">
						<label class="mb-1 block text-xs text-zinc-400">{m.editor_overview_username()}</label>
						<input
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
							bind:value={editUsername}
							placeholder="Optional"
						/>
					</div>
					<div class="rounded bg-zinc-800/50 px-3 py-2">
						<label class="mb-1 block text-xs text-zinc-400">{m.editor_overview_filename_template()}</label>
						<input
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							bind:value={editFilename}
						/>
					</div>
					<div class="flex items-center gap-2 pt-1">
						<button
							class="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
							onclick={saveMetadata}
							disabled={metaSaving}
						>
							{metaSaving ? 'Saving...' : 'Save'}
						</button>
						<button
							class="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
							onclick={cancelEditingMeta}
						>
							Cancel
						</button>
					</div>
				</div>
			{:else}
				<div class="space-y-2">
					<div class="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2">
						<span class="text-sm text-zinc-400">{m.editor_overview_name()}</span>
						<span class="text-sm text-zinc-200">{meta.name}</span>
					</div>
					<div class="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2">
						<span class="text-sm text-zinc-400">{m.editor_overview_game_type()}</span>
						<span class="rounded bg-emerald-900/50 px-1.5 py-0.5 text-xs font-medium text-emerald-400 uppercase">{meta.game_type}</span>
					</div>
					<div class="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2">
						<span class="text-sm text-zinc-400">{m.editor_overview_console()}</span>
						<span class="text-sm text-zinc-200 uppercase">{meta.console_type}</span>
					</div>
					<div class="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2">
						<span class="text-sm text-zinc-400">{m.editor_overview_version()}</span>
						<span class="text-sm text-zinc-200">{meta.version}</span>
					</div>
					{#if meta.username}
						<div class="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2">
							<span class="text-sm text-zinc-400">{m.editor_overview_username()}</span>
							<span class="text-sm text-zinc-200">{meta.username}</span>
						</div>
					{/if}
					<div class="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2">
						<span class="text-sm text-zinc-400">{m.editor_overview_filename_template()}</span>
						<code class="rounded bg-zinc-800 px-2 py-0.5 text-xs text-emerald-400">{meta.filename}</code>
					</div>
				</div>
			{/if}
		</div>

		<div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h2 class="mb-3 text-sm font-semibold tracking-wider text-zinc-400 uppercase">
				{m.editor_overview_generation()}
			</h2>
			<div class="space-y-3">
				<div class="rounded bg-zinc-800/50 px-3 py-2">
					<span class="text-sm text-zinc-400">{m.editor_overview_mode()}</span>
					<span class="ml-2 rounded bg-blue-900/50 px-1.5 py-0.5 text-xs font-medium text-blue-400">{m.editor_overview_flow_editor()}</span>
				</div>
				<p class="text-xs text-zinc-500">
					{m.editor_overview_flow_hint()}
				</p>
			</div>
		</div>
	</div>
{:else if config}
	<!-- Legacy config-based game overview (read-only) -->
	<div class="mb-3 rounded border border-amber-800/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
		{m.editor_overview_legacy_warning()}
	</div>
	<div class="grid grid-cols-2 gap-4">
		<!-- Menu Items (read-only) -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h2 class="mb-3 text-sm font-semibold tracking-wider text-zinc-400 uppercase">
				{m.editor_overview_menu_items({ count: config.menu.length })}
			</h2>
			<div class="space-y-2">
				{#each config.menu as item}
					<div class="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2">
						<span class="text-sm text-zinc-200">{item.name}</span>
						<span class="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300">
							{item.type}
						</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Button Mappings (read-only) -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
			<h2 class="mb-3 text-sm font-semibold tracking-wider text-zinc-400 uppercase">
				{m.editor_overview_button_mappings()}
			</h2>
			<div class="space-y-1.5">
				{#each Object.entries(config.buttons) as [key, value]}
					<div class="flex items-center justify-between rounded px-2 py-1 text-sm">
						<span class="text-zinc-400">{key.replace(/_/g, ' ')}</span>
						<code class="rounded bg-zinc-800 px-2 py-0.5 text-xs text-emerald-400">{value}</code>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<!-- Tags -->
<div class="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
	<h2 class="mb-3 text-sm font-semibold tracking-wider text-zinc-400 uppercase">{m.editor_overview_tags()}</h2>
	<div class="flex flex-wrap items-center gap-2">
		{#each tags as tag}
			<span class="group flex items-center gap-1 rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">
				{tag}
				<button
					class="text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-red-400"
					onclick={() => removeTag(tag)}
				>
					<svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
					</svg>
				</button>
			</span>
		{/each}
		<form
			class="flex items-center gap-1"
			onsubmit={(e) => { e.preventDefault(); addTag(); }}
		>
			<input
				class="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
				placeholder={m.editor_overview_add_tag_placeholder()}
				bind:value={newTag}
			/>
			<button
				type="submit"
				class="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-600"
				disabled={!newTag.trim()}
			>
				+
			</button>
		</form>
	</div>
</div>

<!-- Header Comments -->
{#if isFlowGame && meta}
	<div class="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="text-sm font-semibold tracking-wider text-zinc-400 uppercase">Build Header Comments</h2>
			<div class="flex items-center gap-2">
				<button
					class="rounded px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 {commentsSaving
						? 'bg-zinc-700'
						: 'bg-emerald-600 hover:bg-emerald-500'}"
					onclick={saveHeaderComments}
					disabled={commentsSaving}
				>
					{commentsSaving ? 'Saving...' : 'Save'}
				</button>
				<button
					class="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					onclick={() => { headerComments = settings.defaultHeaderComments || ''; }}
					title="Load the default header comments saved in settings"
				>
					Load Default
				</button>
				<button
					class="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					onclick={saveHeaderCommentsAsDefault}
					title="Save current header comments as the default for newly created games"
				>
					Save as Default
				</button>
			</div>
		</div>
		<textarea
			class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
			rows="4"
			placeholder="Custom comments for built files — use template variables below"
			bind:value={headerComments}
		></textarea>
		<p class="mt-1.5 text-xs text-zinc-600">
			Each line will be prefixed with <code class="text-zinc-500">//</code> in the output file.
		</p>
		<div class="mt-3 rounded border border-zinc-800 bg-zinc-800/40 px-3 py-2">
			<p class="mb-1.5 text-[11px] font-medium tracking-wider text-zinc-500 uppercase">Template Variables</p>
			<div class="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
				<span><code class="text-emerald-500">{'{'+'name}'}</code> <span class="text-zinc-500">— Game name</span></span>
				<span><code class="text-emerald-500">{'{'+'version}'}</code> <span class="text-zinc-500">— Version number</span></span>
				<span><code class="text-emerald-500">{'{'+'username}'}</code> <span class="text-zinc-500">— Author</span></span>
				<span><code class="text-emerald-500">{'{'+'gameabbr}'}</code> <span class="text-zinc-500">— Abbreviated name</span></span>
				<span><code class="text-emerald-500">{'{'+'game_type}'}</code> <span class="text-zinc-500">— Game type</span></span>
				<span><code class="text-emerald-500">{'{'+'console}'}</code> <span class="text-zinc-500">— Console type</span></span>
				<span><code class="text-emerald-500">{'{'+'filename}'}</code> <span class="text-zinc-500">— Output filename</span></span>
			</div>
		</div>
		<label class="mt-3 flex cursor-pointer items-center gap-2">
			<input
				type="checkbox"
				class="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
				checked={generateModuleInfo}
				onchange={toggleModuleInfo}
			/>
			<span class="text-xs text-zinc-400">Auto-generate module info</span>
			<span class="text-[10px] text-zinc-600">— navigation, modules, keyboard shortcuts</span>
		</label>
	</div>
{/if}

<!-- Actions -->
<div class="mt-4 flex items-center gap-3">
	{#if onSaveAsTemplate}
		<button
			class="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
			onclick={onSaveAsTemplate}
		>
			{m.editor_overview_save_as_template()}
		</button>
	{/if}
	{#if onExportZip}
		<button
			class="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
			onclick={onExportZip}
		>
			{m.editor_overview_export_zip()}
		</button>
	{/if}
	<span class="flex-1 truncate text-xs text-zinc-600">{game.path}</span>
</div>
