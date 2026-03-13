<script lang="ts">
	import { exportComboGPC, exportModuleTOML, exportComboData, exportAllCombosGPC, exportAllCombosData } from './export';
	import type { ComboProject, ModuleExportConfig } from './types';
	import { addToast } from '$lib/stores/toast.svelte';
	import MiniMonaco from '$lib/components/editor/MiniMonaco.svelte';
	import { saveUserModule, listModules } from '$lib/tauri/commands';
	import { getSettings } from '$lib/stores/settings.svelte';
	import { getGameStore } from '$lib/stores/game.svelte';
	import { setComboTransfer } from '$lib/stores/combo-transfer.svelte';
	import { getProjectCombos } from './export';
	import { goto } from '$app/navigation';
	import {
		CONSOLE_TYPES,
		CONSOLE_LABELS,
		CONSOLE_BUTTONS,
		type ConsoleType
	} from '$lib/utils/console-buttons';

	interface Props {
		project: ComboProject;
	}

	let { project }: Props = $props();

	let tab = $state<'gpc' | 'toml' | 'data'>('gpc');
	let exportConsole = $state<ConsoleType>('ps5');

	$effect(() => {
		exportConsole = project.consoleType;
	});

	// Module TOML config
	let gameType = $state<'fps' | 'tps' | 'fgs' | 'all'>('all');
	let description = $state('');
	let triggerButton = $state('PS5_CROSS');
	let triggerMode = $state<'press' | 'hold'>('press');

	let moduleConfig = $derived<ModuleExportConfig>({
		displayName: project.name,
		id: project.name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mycombo',
		description,
		gameType,
		triggerButton,
		triggerMode
	});

	let splitPerNode = $state(false);
	let hasMultipleCombos = $derived((project.combos?.length ?? 0) > 1);
	let gpcOutput = $derived(hasMultipleCombos ? exportAllCombosGPC(project, exportConsole) : exportComboGPC(project, exportConsole));
	let tomlOutput = $derived(exportModuleTOML(project, moduleConfig));
	let dataOutput = $derived(hasMultipleCombos ? exportAllCombosData(project, exportConsole) : exportComboData(project, exportConsole));

	let settingsStore = getSettings();
	let settings = $derived($settingsStore);
	let saving = $state(false);
	let saved = $state(false);

	async function copyToClipboard(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			addToast('Copied to clipboard', 'success', 2000);
		} catch {
			addToast('Failed to copy', 'error');
		}
	}

	let gameStore = getGameStore();

	function sendToGame() {
		if (!gameStore.selectedGame) {
			addToast('No game selected. Select a game in the sidebar first.', 'error');
			return;
		}
		const combos = getProjectCombos(project);
		const allCode = hasMultipleCombos ? exportAllCombosGPC(project, exportConsole) : exportComboGPC(project, exportConsole);
		const name = project.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'combo';

		if (hasMultipleCombos && splitPerNode) {
			// One node per combo
			setComboTransfer({
				comboName: name,
				gpcCode: allCode,
				returnTo: gameStore.selectedGame.path,
				createNodes: true,
				nodeEntries: combos.map(c => ({
					name: c.name,
					gpcCode: exportComboGPC({ ...project, name: c.name, steps: c.steps }, exportConsole),
				})),
			});
		} else {
			// Single node with all combos
			setComboTransfer({
				comboName: name,
				gpcCode: allCode,
				returnTo: gameStore.selectedGame.path,
				createNodes: true,
				nodeEntries: [{ name: project.name || 'Combo', gpcCode: allCode }],
			});
		}
		goto('/');
	}

	async function saveAsModule() {
		if (settings.workspaces.length === 0) {
			addToast('No workspace configured. Add a workspace in Settings first.', 'error');
			return;
		}

		saving = true;
		try {
			// Check if a built-in module with this ID already exists
			const allModules = await listModules(undefined, settings.workspaces);
			const existing = allModules.find((m) => m.id === moduleConfig.id);
			if (existing && !existing.is_user_module) {
				addToast(
					`Cannot overwrite built-in module "${existing.display_name}". Choose a different name.`,
					'error'
				);
				return;
			}

			await saveUserModule(settings.workspaces[0], tomlOutput);
			addToast(
				existing
					? `Module "${moduleConfig.displayName}" updated`
					: `Module "${moduleConfig.displayName}" saved to workspace`,
				'success'
			);
			saved = true;
			setTimeout(() => (saved = false), 2000);
		} catch (e) {
			addToast(`Failed to save module: ${e}`, 'error');
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex h-full flex-col gap-3">
	<h3 class="text-sm font-medium text-zinc-300">Export</h3>

	<!-- Console selector -->
	<div>
		<label class="mb-1 block text-xs text-zinc-500" for="export-console">Console</label>
		<select
			id="export-console"
			bind:value={exportConsole}
			class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
		>
			{#each CONSOLE_TYPES as ct}
				<option value={ct}>{CONSOLE_LABELS[ct]}</option>
			{/each}
		</select>
	</div>

	<!-- Tab switcher -->
	<div class="flex rounded bg-zinc-800">
		<button
			class="flex-1 rounded px-3 py-1 text-xs {tab === 'gpc'
				? 'bg-emerald-600/20 text-emerald-400'
				: 'text-zinc-500 hover:text-zinc-300'}"
			onclick={() => (tab = 'gpc')}
		>
			GPC Code
		</button>
		<button
			class="flex-1 rounded px-3 py-1 text-xs {tab === 'data'
				? 'bg-emerald-600/20 text-emerald-400'
				: 'text-zinc-500 hover:text-zinc-300'}"
			onclick={() => (tab = 'data')}
		>
			data()
		</button>
		<button
			class="flex-1 rounded px-3 py-1 text-xs {tab === 'toml'
				? 'bg-emerald-600/20 text-emerald-400'
				: 'text-zinc-500 hover:text-zinc-300'}"
			onclick={() => (tab = 'toml')}
		>
			Node
		</button>
	</div>

	{#if tab === 'toml'}
		<!-- Module config -->
		<div class="space-y-2">
			<div>
				<label class="mb-0.5 block text-xs text-zinc-500" for="mod-desc">Description</label>
				<input
					id="mod-desc"
					type="text"
					bind:value={description}
					placeholder="What does this combo do?"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
				/>
			</div>
			<div>
				<label class="mb-0.5 block text-xs text-zinc-500" for="mod-type">Game Type</label>
				<select
					id="mod-type"
					bind:value={gameType}
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
				>
					<option value="all">All types</option>
					<option value="fgs">Fighting (fgs)</option>
					<option value="fps">Shooter (fps)</option>
					<option value="tps">Third Person (tps)</option>
				</select>
			</div>
			<div>
				<label class="mb-0.5 block text-xs text-zinc-500" for="mod-trigger">Trigger Button</label>
				<select
					id="mod-trigger"
					bind:value={triggerButton}
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
				>
					{#each CONSOLE_BUTTONS[exportConsole] as btn}
						<option value={btn.name}>{btn.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="mb-0.5 block text-xs text-zinc-500" for="mod-mode">Trigger Mode</label>
				<select
					id="mod-mode"
					bind:value={triggerMode}
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
				>
					<option value="press">On Press (run once)</option>
					<option value="hold">While Held (loop)</option>
				</select>
			</div>
		</div>

		<!-- Save as module button -->
		<button
			class="w-full rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 {saved
				? 'bg-emerald-700'
				: 'bg-emerald-600 hover:bg-emerald-500'}"
			onclick={saveAsModule}
			disabled={saving || saved}
		>
			{saving ? 'Saving...' : saved ? 'Saved!' : 'Save as Module'}
		</button>
		{#if settings.workspaces.length > 0}
			<div class="text-xs text-zinc-600 truncate" title={settings.workspaces[0]}>
				Saves to: {settings.workspaces[0]}/modules/
			</div>
		{/if}
	{/if}

	<!-- Send to Game -->
	<button
		class="w-full rounded border border-blue-600 bg-blue-600/10 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-600/20"
		onclick={sendToGame}
	>
		Send to Game
	</button>
	{#if hasMultipleCombos}
		<label class="flex items-center gap-2 text-xs text-zinc-400">
			<input type="checkbox" bind:checked={splitPerNode} class="accent-emerald-500" />
			Separate node per combo
		</label>
	{/if}
	{#if gameStore.selectedGame}
		<div class="truncate text-xs text-zinc-600" title={gameStore.selectedGame.name}>
			Game: {gameStore.selectedGame.name}
		</div>
	{:else}
		<div class="text-xs text-zinc-600">No game selected</div>
	{/if}

	<!-- Output -->
	<div class="flex flex-1 flex-col">
		<div class="mb-1 flex items-center justify-between">
			<span class="text-xs text-zinc-500">Output</span>
			<button
				class="text-xs text-zinc-500 hover:text-emerald-400"
				onclick={() => copyToClipboard(tab === 'gpc' ? gpcOutput : tab === 'data' ? dataOutput : tomlOutput)}
			>
				Copy
			</button>
		</div>
		<div class="flex-1 overflow-hidden rounded border border-zinc-700">
			<MiniMonaco
				value={tab === 'gpc' ? gpcOutput : tab === 'data' ? dataOutput : tomlOutput}
				language={tab === 'toml' ? 'toml' : 'gpc'}
				readonly={true}
				label={tab === 'gpc' ? 'GPC Output' : tab === 'data' ? 'Data Array' : 'Module TOML'}
			/>
		</div>
	</div>
</div>
