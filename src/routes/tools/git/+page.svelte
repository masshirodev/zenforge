<script lang="ts">
	import { getSettings } from '$lib/stores/settings.svelte';
	import { gitIsRepo } from '$lib/tauri/commands';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';
	import GitPanel from '$lib/components/editor/GitPanel.svelte';
	import { onMount } from 'svelte';

	let settingsStore = getSettings();
	let settings = $derived($settingsStore);

	let selectedWorkspace = $state('');
	let isGitRepo = $state(false);
	let checking = $state(true);

	onMount(() => {
		if (settings.workspaces.length > 0) {
			selectedWorkspace = settings.workspaces[0];
		}
	});

	$effect(() => {
		if (selectedWorkspace) {
			checking = true;
			gitIsRepo(selectedWorkspace)
				.then((v) => (isGitRepo = v))
				.catch(() => (isGitRepo = false))
				.finally(() => (checking = false));
		} else {
			isGitRepo = false;
			checking = false;
		}
	});
</script>

<div class="flex h-full flex-col bg-zinc-950">
	<ToolHeader title="Git" subtitle="Workspace version control">
		{#if settings.workspaces.length > 1}
			<select
				class="ml-auto rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
				bind:value={selectedWorkspace}
			>
				{#each settings.workspaces as ws}
					<option value={ws}>{ws.split('/').pop() || ws}</option>
				{/each}
			</select>
		{/if}
	</ToolHeader>

	<div class="flex-1 overflow-auto p-6">
		{#if settings.workspaces.length === 0}
			<div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center">
				<p class="text-sm text-zinc-400">No workspace configured.</p>
				<p class="mt-2 text-xs text-zinc-600">Add a workspace in Settings to use Git.</p>
			</div>
		{:else if checking}
			<div class="py-8 text-center text-sm text-zinc-500">Checking repository...</div>
		{:else}
			<GitPanel
				repoPath={selectedWorkspace}
				{isGitRepo}
				onRepoInit={() => {
					isGitRepo = true;
				}}
			/>
		{/if}
	</div>
</div>
