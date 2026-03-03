<script lang="ts">
	import { getGameStore, gamesByType, clearSelection } from '$lib/stores/game.svelte';
	import { goto } from '$app/navigation';
	import type { GameSummary } from '$lib/types/config';
	import { getSettings, togglePinnedGame, isGamePinned, removeRecentFile, clearRecentFiles } from '$lib/stores/settings.svelte';
	import { openTab } from '$lib/stores/editor.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import AppLogo from './AppLogo.svelte';

	interface Props {
		onSelectGame: (game: GameSummary) => void;
		onDeleteGame?: (game: GameSummary) => void;
		onCollapse?: () => void;
		onOpenSettings?: () => void;
		onNewFromTemplate?: () => void;
	}

	let { onSelectGame, onDeleteGame, onCollapse, onOpenSettings, onNewFromTemplate }: Props = $props();
	let store = getGameStore();
	let settingsStore = getSettings();
	let settings = $derived($settingsStore);
	let grouped = $derived(gamesByType(store.games));
	let types = $derived(Object.keys(grouped).sort());

	// Pinned games derived from settings + game list
	let pinnedGames = $derived(
		store.games.filter(g => settings.pinnedGames.includes(g.path))
	);

	// Recent files (just filenames for display)
	let recentFiles = $derived(settings.recentFiles);
	let showRecentFiles = $state(false);

	interface ToolItem {
		href: string;
		label: string;
		icon: string;
		stroke?: boolean;
	}

	interface ToolCategory {
		name: string;
		tools: ToolItem[];
	}

	const categoryLabels: Record<string, () => string> = {
		'OLED': () => m.layout_sidebar_category_oled(),
		'Combat': () => m.layout_sidebar_category_combat(),
		'Code': () => m.layout_sidebar_category_code(),
		'Project': () => m.layout_sidebar_category_project(),
		'Testing': () => m.layout_sidebar_category_testing(),
		'Reference': () => m.layout_sidebar_category_reference()
	};

	const toolLabels: Record<string, () => string> = {
		'/tools/oled': () => m.layout_sidebar_tool_oled_creator(),
		'/tools/font-import': () => m.layout_sidebar_tool_font_import(),
		'/tools/sprite-import': () => m.layout_sidebar_tool_sprite_import(),
		'/tools/recoil': () => m.layout_sidebar_tool_spray_pattern(),
		'/tools/combo': () => m.layout_sidebar_tool_combo_maker(),
		'/tools/snippets': () => m.layout_sidebar_tool_snippets(),
		'/tools/string-to-array': () => m.layout_sidebar_tool_string_to_array(),
		'/tools/obfuscate': () => m.layout_sidebar_tool_obfuscator(),
		'/tools/modules': () => m.layout_sidebar_tool_module_manager(),
		'/tools/builds': () => m.layout_sidebar_tool_built_games(),
		'/tools/depgraph': () => m.layout_sidebar_tool_dep_graph(),
		'/tools/plugins': () => m.layout_sidebar_tool_plugins(),
		'/tools/compare': () => m.layout_sidebar_tool_compare_games(),
		'/tools/simulator': () => m.layout_sidebar_tool_simulator(),
		'/tools/keyboard': () => m.layout_sidebar_tool_keyboard_mapper(),
		'/tools/docs': () => m.layout_sidebar_tool_documentation()
	};

	const toolCategories: ToolCategory[] = [
		{
			name: 'OLED',
			tools: [
				{
					href: '/tools/oled',
					label: 'OLED Creator',
					icon: 'M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z'
				},
				{
					href: '/tools/font-import',
					label: 'Font Import',
					icon: 'M4 6h16M4 12h16m-7 6h7',
					stroke: true
				},
				{
					href: '/tools/sprite-import',
					label: 'Sprite Import',
					icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
					stroke: true
				}
			]
		},
		{
			name: 'Combat',
			tools: [
				{
					href: '/tools/recoil',
					label: 'Spray Pattern',
					icon: 'M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z'
				},
				{
					href: '/tools/combo',
					label: 'Combo Maker',
					icon: 'M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h8a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h4a1 1 0 110 2H4a1 1 0 01-1-1z'
				}
			]
		},
		{
			name: 'Code',
			tools: [
				{
					href: '/tools/snippets',
					label: 'Snippets',
					icon: 'M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z'
				},
				{
					href: '/tools/string-to-array',
					label: 'String to Array',
					icon: 'M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm4 1a1 1 0 00-1 1v1a1 1 0 002 0V7a1 1 0 00-1-1zm3 0a1 1 0 00-1 1v3a1 1 0 002 0V7a1 1 0 00-1-1zm3 0a1 1 0 00-1 1v5a1 1 0 002 0V7a1 1 0 00-1-1z'
				},
				{
					href: '/tools/obfuscate',
					label: 'Obfuscator',
					icon: 'M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z'
				}
			]
		},
		{
			name: 'Project',
			tools: [
				{
					href: '/tools/modules',
					label: 'Module Manager',
					icon: 'M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z'
				},
				{
					href: '/tools/builds',
					label: 'Built Games',
					icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
					stroke: true
				},
				{
					href: '/tools/depgraph',
					label: 'Dep Graph',
					icon: 'M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 011.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z'
				},
				{
					href: '/tools/plugins',
					label: 'Plugins',
					icon: 'M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h2a2 2 0 002-2v-2a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2z'
				},
				{
					href: '/tools/compare',
					label: 'Compare Games',
					icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
					stroke: true
				}
			]
		},
		{
			name: 'Testing',
			tools: [
				{
					href: '/tools/simulator',
					label: 'Combo Simulator',
					icon: 'M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z'
				},
				{
					href: '/tools/keyboard',
					label: 'Keyboard Mapper',
					icon: 'M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z'
				}
			]
		},
		{
			name: 'Reference',
			tools: [
				{
					href: '/tools/docs',
					label: 'Documentation',
					icon: 'M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z'
				}
			]
		}
	];

	// --- Tag filtering ---
	let activeTagFilter = $state<string | null>(null);
	let allTags = $derived(
		[...new Set(store.games.flatMap(g => g.tags ?? []))].sort()
	);
	let filteredGrouped = $derived(() => {
		if (!activeTagFilter) return grouped;
		const filtered: Record<string, typeof store.games> = {};
		for (const [type, games] of Object.entries(grouped)) {
			const matching = games.filter(g => g.tags?.includes(activeTagFilter!));
			if (matching.length > 0) filtered[type] = matching;
		}
		return filtered;
	});
	let filteredTypes = $derived(Object.keys(filteredGrouped()).sort());

	let collapsedCategories = $state<Record<string, boolean>>({});

	function toggleCategory(name: string) {
		collapsedCategories[name] = !collapsedCategories[name];
	}
</script>

<aside
	class="flex h-full w-64 flex-col border-r border-zinc-700 bg-zinc-900"
	onclick={(e) => {
		const target = (e.target as HTMLElement).closest('a, button');
		if (target && !target.matches('[data-no-collapse]')) onCollapse?.();
	}}
>
	<div class="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
		<div class="flex items-center gap-2">
			<AppLogo />
			<span class="text-sm font-semibold text-zinc-100">Zen Forge</span>
		</div>
		{#if onCollapse}
			<button
				class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
				data-no-collapse
				onclick={onCollapse}
				title={m.layout_sidebar_collapse()}
			>
				<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
					<path
						fill-rule="evenodd"
						d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
						clip-rule="evenodd"
					/>
				</svg>
			</button>
		{/if}
	</div>

	<nav class="scrollbar-none flex-1 overflow-y-auto px-2 py-2">
		<button
			class="mb-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800"
			onclick={() => {
				clearSelection();
				goto('/');
			}}
		>
			<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
				<path
					d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"
				/>
			</svg>
			{m.layout_sidebar_dashboard()}
		</button>

		<!-- Pinned Games -->
		{#if pinnedGames.length > 0}
			<div class="mt-4 mb-2 px-3 text-xs font-medium tracking-wider text-zinc-500 uppercase">
				{m.layout_sidebar_pinned()}
			</div>
			{#each pinnedGames as game}
				<div
					class="group flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
					class:bg-zinc-800={store.selectedGame?.path === game.path}
					class:text-emerald-400={store.selectedGame?.path === game.path}
				>
					<button class="flex-1 truncate text-left" onclick={() => onSelectGame(game)}>
						{game.name}
					</button>
					<div class="flex items-center gap-1">
						<span class="text-xs text-zinc-500">v{game.version}</span>
						<button
							class="rounded p-0.5 text-amber-500/70 opacity-0 group-hover:opacity-100 hover:text-amber-400"
							data-no-collapse
							onclick={(e) => {
								e.stopPropagation();
								togglePinnedGame(game.path);
							}}
							title={m.layout_sidebar_unpin()}
						>
							<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
								<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
							</svg>
						</button>
					</div>
				</div>
			{/each}
		{/if}

		<!-- Recent Files -->
		{#if recentFiles.length > 0}
			<div class="mt-4 mb-1 flex items-center justify-between px-3">
				<button
					class="flex items-center gap-1 text-xs font-medium tracking-wider text-zinc-500 uppercase hover:text-zinc-400"
					data-no-collapse
					onclick={() => (showRecentFiles = !showRecentFiles)}
				>
					<svg
						class="h-3 w-3 transition-transform"
						class:rotate-90={showRecentFiles}
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
							clip-rule="evenodd"
						/>
					</svg>
					{m.layout_sidebar_recent()}
				</button>
				<button
					class="text-xs text-zinc-600 hover:text-zinc-400"
					data-no-collapse
					onclick={() => clearRecentFiles()}
					title={m.layout_sidebar_clear_recent()}
				>
					{m.common_clear()}
				</button>
			</div>
			{#if showRecentFiles}
				{#each recentFiles.slice(0, 10) as filePath}
					<div
						class="group flex w-full items-center rounded px-3 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
					>
						<button
							class="flex-1 truncate text-left"
							onclick={() => openTab(filePath)}
							title={filePath}
						>
							{filePath.split('/').pop()}
						</button>
						<button
							class="rounded p-0.5 text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
							data-no-collapse
							onclick={(e) => {
								e.stopPropagation();
								removeRecentFile(filePath);
							}}
							title={m.layout_sidebar_remove_recent()}
						>
							<svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
								<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
							</svg>
						</button>
					</div>
				{/each}
			{/if}
		{/if}

		<div class="mt-4 mb-2 px-3 text-xs font-medium tracking-wider text-zinc-500 uppercase">
			{m.layout_sidebar_games()}
		</div>

		{#if allTags.length > 0}
			<div class="mb-2 flex flex-wrap gap-1 px-3">
				{#each allTags as tag}
					<button
						class="rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors {activeTagFilter === tag ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300'}"
						data-no-collapse
						onclick={() => { activeTagFilter = activeTagFilter === tag ? null : tag; }}
					>
						{tag}
					</button>
				{/each}
			</div>
		{/if}

		{#each filteredTypes as type}
			<div class="mb-1">
				<div class="px-3 py-1 text-xs font-medium text-zinc-500">{type}</div>
				{#each filteredGrouped()[type] as game}
					<div
						class="group flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
						class:bg-zinc-800={store.selectedGame?.path === game.path}
						class:text-emerald-400={store.selectedGame?.path === game.path}
					>
						<button class="flex-1 truncate text-left" onclick={() => onSelectGame(game)}>
							{game.name}
						</button>
						<div class="flex items-center gap-1">
							<span class="text-xs text-zinc-500">v{game.version}</span>
							<button
								class="rounded p-0.5 opacity-0 group-hover:opacity-100 {isGamePinned(settings, game.path) ? 'text-amber-500/70 hover:text-amber-400' : 'text-zinc-600 hover:text-amber-400'}"
								class:opacity-100={isGamePinned(settings, game.path)}
								data-no-collapse
								onclick={(e) => {
									e.stopPropagation();
									togglePinnedGame(game.path);
								}}
								title={isGamePinned(settings, game.path) ? m.layout_sidebar_unpin() : m.layout_sidebar_pin()}
							>
								<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
									<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
								</svg>
							</button>
							{#if onDeleteGame}
								<button
									class="rounded p-0.5 text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
									data-no-collapse
									onclick={(e) => {
										e.stopPropagation();
										onDeleteGame(game);
									}}
									title={m.layout_sidebar_delete_game()}
								>
									<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/each}

		{#if store.loading}
			<div class="px-3 py-2 text-sm text-zinc-500">{m.common_loading()}</div>
		{/if}

		{#if store.error}
			<div class="px-3 py-2 text-sm text-red-400">{store.error}</div>
		{/if}

		<div class="mt-4 mb-2 px-3 text-xs font-medium tracking-wider text-zinc-500 uppercase">
			{m.layout_sidebar_tools()}
		</div>
		{#each toolCategories as category}
			<div class="mb-1">
				<button
					class="flex w-full items-center gap-1 px-3 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-400"
					data-no-collapse
					onclick={() => toggleCategory(category.name)}
				>
					<svg
						class="h-3 w-3 transition-transform"
						class:rotate-90={!collapsedCategories[category.name]}
						viewBox="0 0 20 20"
						fill="currentColor"
					>
						<path
							fill-rule="evenodd"
							d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
							clip-rule="evenodd"
						/>
					</svg>
					{categoryLabels[category.name]?.() ?? category.name}
				</button>
				{#if !collapsedCategories[category.name]}
					{#each category.tools as tool}
						<a
							href={tool.href}
							class="mb-0.5 flex items-center gap-2 rounded px-3 py-1.5 pl-6 text-sm text-zinc-300 hover:bg-zinc-800"
						>
							{#if tool.stroke}
								<svg
									class="h-4 w-4 shrink-0"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d={tool.icon}
									/>
								</svg>
							{:else}
								<svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
									<path d={tool.icon} />
								</svg>
							{/if}
							{toolLabels[tool.href]?.() ?? tool.label}
						</a>
					{/each}
				{/if}
			</div>
		{/each}
	</nav>

	<div class="space-y-1.5 border-t border-zinc-700 p-2">
		<a
			href="/wizard"
			class="flex w-full items-center justify-center gap-2 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
		>
			<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
				<path
					d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
				/>
			</svg>
			{m.layout_sidebar_new_game()}
		</a>
		{#if onNewFromTemplate}
			<button
				class="flex w-full items-center gap-2 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
				onclick={onNewFromTemplate}
			>
				<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
					<path d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V8z" />
				</svg>
				{m.layout_sidebar_from_template()}
			</button>
		{/if}
		{#if onOpenSettings}
			<button
				class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
				onclick={onOpenSettings}
			>
				<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
					<path
						fill-rule="evenodd"
						d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
						clip-rule="evenodd"
					/>
				</svg>
				{m.layout_sidebar_settings()}
			</button>
		{/if}
	</div>
</aside>
