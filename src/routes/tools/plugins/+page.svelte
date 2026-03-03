<script lang="ts">
	import { onMount } from 'svelte';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';
	import {
		listPlugins,
		togglePlugin,
		createPlugin,
		deletePlugin,
		readPluginFile
	} from '$lib/tauri/commands';
	import type { PluginInfo } from '$lib/tauri/commands';
	import { addToast } from '$lib/stores/toast.svelte';
	import { getSettings } from '$lib/stores/settings.svelte';
	import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';

	let settingsStore = getSettings();
	let settings = $derived($settingsStore);

	let plugins = $state<PluginInfo[]>([]);
	let loading = $state(true);
	let selectedPlugin = $state<PluginInfo | null>(null);
	let manifestContent = $state<string | null>(null);

	// Create plugin form
	let showCreateForm = $state(false);
	let newPluginId = $state('');
	let newPluginName = $state('');
	let newPluginDesc = $state('');

	onMount(() => {
		loadPlugins();
	});

	async function loadPlugins() {
		loading = true;
		try {
			plugins = await listPlugins(settings.workspaces.length > 0 ? settings.workspaces : undefined);
		} catch (e) {
			addToast(`Failed to load plugins: ${e}`, 'error');
		} finally {
			loading = false;
		}
	}

	async function handleToggle(plugin: PluginInfo) {
		const ws = settings.workspaces[0];
		if (!ws) {
			addToast('No workspace configured', 'error');
			return;
		}
		try {
			await togglePlugin(ws, plugin.manifest.id, !plugin.enabled);
			await loadPlugins();
			addToast(
				`${plugin.manifest.name} ${plugin.enabled ? 'disabled' : 'enabled'}`,
				'success'
			);
		} catch (e) {
			addToast(`Failed to toggle plugin: ${e}`, 'error');
		}
	}

	async function handleSelect(plugin: PluginInfo) {
		selectedPlugin = plugin;
		manifestContent = null;
		try {
			manifestContent = await readPluginFile(plugin.path, 'plugin.toml');
		} catch (e) {
			manifestContent = null;
		}
	}

	async function handleCreate() {
		const ws = settings.workspaces[0];
		if (!ws) {
			addToast('No workspace configured', 'error');
			return;
		}
		if (!newPluginId.trim() || !newPluginName.trim()) {
			addToast('Plugin ID and name are required', 'error');
			return;
		}
		try {
			await createPlugin(ws, newPluginId.trim(), newPluginName.trim(), newPluginDesc.trim() || undefined);
			addToast(`Plugin "${newPluginName}" created`, 'success');
			showCreateForm = false;
			newPluginId = '';
			newPluginName = '';
			newPluginDesc = '';
			await loadPlugins();
		} catch (e) {
			addToast(`Failed to create plugin: ${e}`, 'error');
		}
	}

	async function handleDelete(plugin: PluginInfo) {
		if (!confirm(`Delete plugin "${plugin.manifest.name}"? This cannot be undone.`)) return;
		try {
			await deletePlugin(plugin.path);
			if (selectedPlugin?.path === plugin.path) {
				selectedPlugin = null;
				manifestContent = null;
			}
			addToast(`Plugin "${plugin.manifest.name}" deleted`, 'success');
			await loadPlugins();
		} catch (e) {
			addToast(`Failed to delete plugin: ${e}`, 'error');
		}
	}
</script>

<div class="flex h-full flex-col bg-zinc-950 text-zinc-200">
	<ToolHeader title="Plugins" subtitle="Extend Zen Forge with community plugins">
		<div class="ml-auto flex items-center gap-2">
			<button
				class="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
				onclick={() => (showCreateForm = !showCreateForm)}
			>
				{showCreateForm ? 'Cancel' : 'New Plugin'}
			</button>
			<button
				class="flex items-center gap-1.5 rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
				onclick={loadPlugins}
				disabled={loading}
			>
				Refresh
			</button>
		</div>
	</ToolHeader>

	{#if showCreateForm}
		<div class="border-b border-zinc-800 bg-zinc-900/50 p-4">
			<div class="mx-auto flex max-w-lg items-end gap-3">
				<div class="flex-1">
					<label class="mb-1 block text-xs text-zinc-500">Plugin ID</label>
					<input
						type="text"
						bind:value={newPluginId}
						placeholder="my-plugin"
						class="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
					/>
				</div>
				<div class="flex-1">
					<label class="mb-1 block text-xs text-zinc-500">Name</label>
					<input
						type="text"
						bind:value={newPluginName}
						placeholder="My Plugin"
						class="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
					/>
				</div>
				<div class="flex-1">
					<label class="mb-1 block text-xs text-zinc-500">Description</label>
					<input
						type="text"
						bind:value={newPluginDesc}
						placeholder="Optional description"
						class="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
					/>
				</div>
				<button
					class="rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
					onclick={handleCreate}
				>
					Create
				</button>
			</div>
		</div>
	{/if}

	<!-- Main Content -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Left Panel: Plugin List -->
		<div class="flex w-80 shrink-0 flex-col border-r border-zinc-800">
			<div class="flex-1 overflow-y-auto">
				{#if loading}
					<div class="px-4 py-6 text-center text-xs text-zinc-500">Loading plugins...</div>
				{:else if plugins.length === 0}
					<div class="px-4 py-6 text-center text-xs text-zinc-500">
						<p>No plugins found.</p>
						<p class="mt-1 text-zinc-600">
							Create one or add plugin directories to your workspace's <code class="text-zinc-400">plugins/</code> folder.
						</p>
					</div>
				{:else}
					{#each plugins as plugin}
						<div
							class="group flex items-center gap-3 border-b border-zinc-800/50 px-3 py-3 transition-colors {selectedPlugin?.path === plugin.path ? 'bg-zinc-800/80' : 'hover:bg-zinc-900'}"
						>
							<button
								class="flex flex-1 flex-col text-left"
								onclick={() => handleSelect(plugin)}
							>
								<div class="flex items-center gap-2">
									<span class="text-sm font-medium text-zinc-200">{plugin.manifest.name}</span>
									<span class="text-[10px] text-zinc-600">v{plugin.manifest.version}</span>
								</div>
								{#if plugin.manifest.description}
									<span class="mt-0.5 text-xs text-zinc-500">{plugin.manifest.description}</span>
								{/if}
								<span class="mt-0.5 text-[10px] text-zinc-600">{plugin.manifest.id}</span>
							</button>
							<div class="flex shrink-0 items-center gap-2">
								<button
									class="rounded px-2 py-0.5 text-xs transition-colors {plugin.enabled ? 'bg-emerald-900/50 text-emerald-400 hover:bg-emerald-900/70' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}"
									onclick={() => handleToggle(plugin)}
								>
									{plugin.enabled ? 'On' : 'Off'}
								</button>
								<button
									class="rounded p-1 text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
									onclick={() => handleDelete(plugin)}
									title="Delete plugin"
								>
									<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
									</svg>
								</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>
			<div class="border-t border-zinc-800 px-3 py-2 text-[10px] text-zinc-600">
				{plugins.length} plugin{plugins.length !== 1 ? 's' : ''} &middot;
				{plugins.filter((p) => p.enabled).length} enabled
			</div>
		</div>

		<!-- Right Panel: Plugin Detail -->
		<div class="flex flex-1 flex-col overflow-hidden">
			{#if selectedPlugin}
				<div class="border-b border-zinc-800 bg-zinc-900/80 px-4 py-3">
					<div class="flex items-center justify-between">
						<div>
							<h2 class="text-sm font-semibold text-zinc-100">{selectedPlugin.manifest.name}</h2>
							<p class="text-xs text-zinc-500">
								{selectedPlugin.manifest.id} &middot; v{selectedPlugin.manifest.version}
								{#if selectedPlugin.manifest.author}
									&middot; by {selectedPlugin.manifest.author}
								{/if}
							</p>
						</div>
						<span
							class="rounded px-2 py-0.5 text-xs {selectedPlugin.enabled ? 'bg-emerald-900/50 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}"
						>
							{selectedPlugin.enabled ? 'Enabled' : 'Disabled'}
						</span>
					</div>
					{#if selectedPlugin.manifest.description}
						<p class="mt-1 text-xs text-zinc-400">{selectedPlugin.manifest.description}</p>
					{/if}

					<!-- Hooks summary -->
					<div class="mt-3 flex flex-wrap gap-2">
						{#if selectedPlugin.manifest.hooks.pre_build}
							<span class="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">pre_build</span>
						{/if}
						{#if selectedPlugin.manifest.hooks.post_build}
							<span class="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">post_build</span>
						{/if}
						{#if selectedPlugin.manifest.hooks.includes?.length}
							<span class="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
								{selectedPlugin.manifest.hooks.includes.length} include{selectedPlugin.manifest.hooks.includes.length !== 1 ? 's' : ''}
							</span>
						{/if}
						{#if selectedPlugin.manifest.hooks.extra_vars && Object.keys(selectedPlugin.manifest.hooks.extra_vars).length > 0}
							<span class="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
								{Object.keys(selectedPlugin.manifest.hooks.extra_vars).length} var{Object.keys(selectedPlugin.manifest.hooks.extra_vars).length !== 1 ? 's' : ''}
							</span>
						{/if}
						{#if selectedPlugin.manifest.hooks.extra_defines && Object.keys(selectedPlugin.manifest.hooks.extra_defines).length > 0}
							<span class="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
								{Object.keys(selectedPlugin.manifest.hooks.extra_defines).length} define{Object.keys(selectedPlugin.manifest.hooks.extra_defines).length !== 1 ? 's' : ''}
							</span>
						{/if}
					</div>
				</div>

				<!-- Manifest Editor -->
				<div class="flex-1 overflow-hidden">
					{#if manifestContent !== null}
						<MonacoEditor
							value={manifestContent}
							language="ini"
							readonly={true}
						/>
					{:else}
						<div class="flex h-full items-center justify-center text-xs text-zinc-600">
							Loading manifest...
						</div>
					{/if}
				</div>
			{:else}
				<div class="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
					<svg class="h-10 w-10 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h2a2 2 0 002-2v-2a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2z" />
					</svg>
					<p class="text-xs">Select a plugin to view its manifest</p>
				</div>
			{/if}
		</div>
	</div>
</div>
