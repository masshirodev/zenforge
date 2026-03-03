<script lang="ts">
	import { getGameStore, loadGames } from '$lib/stores/game.svelte';
	import { getSettings } from '$lib/stores/settings.svelte';
	import { readFile, readFileTree } from '$lib/tauri/commands';
	import type { FileTreeEntry } from '$lib/tauri/commands';
	import DiffViewer from '$lib/components/editor/DiffViewer.svelte';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';
	import { onMount } from 'svelte';

	let store = getGameStore();
	let settingsStore = getSettings();
	let settings = $derived($settingsStore);

	let gameA = $state<string>('');
	let gameB = $state<string>('');
	let fileTreeA = $state<string[]>([]);
	let fileTreeB = $state<string[]>([]);
	let commonFiles = $derived(fileTreeA.filter((f) => fileTreeB.includes(f)));
	let selectedFile = $state<string>('');

	let contentA = $state('');
	let contentB = $state('');
	let loading = $state(false);
	let comparing = $state(false);

	onMount(() => {
		if (store.games.length === 0) {
			loadGames(settings.workspaces);
		}
	});

	function flattenTree(entries: FileTreeEntry[], prefix = ''): string[] {
		const result: string[] = [];
		for (const entry of entries) {
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.is_dir && entry.children) {
				result.push(...flattenTree(entry.children, relative));
			} else if (!entry.is_dir) {
				result.push(relative);
			}
		}
		return result.sort();
	}

	async function loadFileList(gamePath: string): Promise<string[]> {
		try {
			const tree = await readFileTree(gamePath);
			return flattenTree(tree);
		} catch {
			return [];
		}
	}

	// Load file lists when games change
	$effect(() => {
		if (gameA) {
			loadFileList(gameA).then((files) => {
				fileTreeA = files;
			});
		} else {
			fileTreeA = [];
		}
	});

	$effect(() => {
		if (gameB) {
			loadFileList(gameB).then((files) => {
				fileTreeB = files;
			});
		} else {
			fileTreeB = [];
		}
	});

	// Auto-select config.toml if it's a common file
	$effect(() => {
		if (commonFiles.length > 0 && !selectedFile) {
			const cfg = commonFiles.find((f) => f === 'config.toml');
			selectedFile = cfg ?? commonFiles[0];
		}
	});

	async function compare() {
		if (!gameA || !gameB || !selectedFile) return;
		comparing = true;
		loading = true;
		try {
			const [a, b] = await Promise.all([
				readFile(`${gameA}/${selectedFile}`),
				readFile(`${gameB}/${selectedFile}`)
			]);
			contentA = a;
			contentB = b;
		} catch (e) {
			contentA = `Error loading file: ${e}`;
			contentB = '';
		} finally {
			loading = false;
		}
	}

	function getLanguage(file: string): string {
		if (file.endsWith('.gpc')) return 'gpc';
		if (file.endsWith('.toml')) return 'ini';
		if (file.endsWith('.json')) return 'json';
		return 'plaintext';
	}

	function gameName(path: string): string {
		return path.split('/').pop() ?? path;
	}
</script>

<div class="flex h-full flex-col bg-zinc-950 text-zinc-200">
	<!-- Header -->
	<ToolHeader title="Game Comparison" subtitle="Compare game files to find differences" />

	<!-- Selectors -->
	<div class="flex flex-wrap items-end gap-3 border-b border-zinc-800 p-4">
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<label class="text-[10px] font-medium text-zinc-500 uppercase">Game A</label>
			<select
				class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
				bind:value={gameA}
				onchange={() => { comparing = false; selectedFile = ''; }}
			>
				<option value="">Select game...</option>
				{#each store.games as game}
					<option value={game.path} disabled={game.path === gameB}>{game.name} ({game.game_type})</option>
				{/each}
			</select>
		</div>

		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<label class="text-[10px] font-medium text-zinc-500 uppercase">Game B</label>
			<select
				class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
				bind:value={gameB}
				onchange={() => { comparing = false; selectedFile = ''; }}
			>
				<option value="">Select game...</option>
				{#each store.games as game}
					<option value={game.path} disabled={game.path === gameA}>{game.name} ({game.game_type})</option>
				{/each}
			</select>
		</div>

		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<label class="text-[10px] font-medium text-zinc-500 uppercase">
				File ({commonFiles.length} common)
			</label>
			<select
				class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
				bind:value={selectedFile}
				disabled={commonFiles.length === 0}
			>
				{#if commonFiles.length === 0}
					<option value="">No common files</option>
				{:else}
					{#each commonFiles as file}
						<option value={file}>{file}</option>
					{/each}
				{/if}
			</select>
		</div>

		<button
			class="shrink-0 rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
			disabled={!gameA || !gameB || !selectedFile || loading}
			onclick={compare}
		>
			{loading ? 'Loading...' : 'Compare'}
		</button>
	</div>

	<!-- Diff viewer area -->
	<div class="min-h-0 flex-1 overflow-hidden">
		{#if comparing && contentA !== undefined}
			{#key `${gameA}:${gameB}:${selectedFile}`}
				<DiffViewer
					originalValue={contentA}
					modifiedValue={contentB}
					originalLabel={gameName(gameA)}
					modifiedLabel={gameName(gameB)}
					language={getLanguage(selectedFile)}
				/>
			{/key}
		{:else}
			<div class="flex h-full items-center justify-center text-sm text-zinc-600">
				Select two games and a file to compare
			</div>
		{/if}
	</div>
</div>
