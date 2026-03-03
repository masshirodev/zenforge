<script lang="ts">
	import { getSettings, addSnippet, updateSnippet, removeSnippet, getAllSnippets, isBuiltinSnippet } from '$lib/stores/settings.svelte';
	import type { Snippet } from '$lib/stores/settings.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';

	let settingsStore = getSettings();
	let settings = $derived($settingsStore);

	let searchQuery = $state('');
	let selectedSnippet = $state<Snippet | null>(null);
	let editing = $state(false);

	// New snippet form
	let showCreate = $state(false);
	let newName = $state('');
	let newDescription = $state('');
	let newCode = $state('');
	let newTags = $state('');

	let allSnippets = $derived(getAllSnippets(settings));

	let filteredSnippets = $derived.by(() => {
		const q = searchQuery.toLowerCase().trim();
		if (!q) return allSnippets;
		return allSnippets.filter(
			(s) =>
				s.name.toLowerCase().includes(q) ||
				s.description.toLowerCase().includes(q) ||
				s.tags.some((t) => t.toLowerCase().includes(q))
		);
	});

	function handleCreate() {
		if (!newName.trim()) {
			addToast('Snippet name is required', 'error');
			return;
		}
		const snippet = addSnippet({
			name: newName.trim(),
			description: newDescription.trim(),
			code: newCode,
			tags: newTags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean)
		});
		selectedSnippet = snippet;
		showCreate = false;
		newName = '';
		newDescription = '';
		newCode = '';
		newTags = '';
		addToast(`Snippet "${snippet.name}" created`, 'success');
	}

	function handleDelete(id: string) {
		const name = settings.snippets.find((s) => s.id === id)?.name;
		removeSnippet(id);
		if (selectedSnippet?.id === id) selectedSnippet = null;
		addToast(`Snippet "${name}" deleted`, 'success');
	}

	function handleSave() {
		if (!selectedSnippet) return;
		updateSnippet(selectedSnippet.id, {
			name: selectedSnippet.name,
			description: selectedSnippet.description,
			code: selectedSnippet.code,
			tags: selectedSnippet.tags
		});
		editing = false;
		addToast('Snippet saved', 'success');
	}

	async function copyToClipboard(code: string) {
		try {
			await navigator.clipboard.writeText(code);
			addToast('Copied to clipboard', 'success', 2000);
		} catch {
			addToast('Failed to copy', 'error');
		}
	}

	function handleImport() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json';
		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;
			try {
				const text = await file.text();
				const data = JSON.parse(text);
				const snippets = Array.isArray(data) ? data : [data];
				let count = 0;
				for (const s of snippets) {
					if (s.name && s.code) {
						addSnippet({
							name: s.name,
							description: s.description || '',
							code: s.code,
							tags: s.tags || []
						});
						count++;
					}
				}
				addToast(`Imported ${count} snippet(s)`, 'success');
			} catch {
				addToast('Failed to parse snippet file', 'error');
			}
		};
		input.click();
	}

	function handleExport() {
		const data = JSON.stringify(settings.snippets, null, 2);
		const blob = new Blob([data], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'gpc-snippets.json';
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="flex h-full flex-col bg-zinc-950 text-zinc-100">
	<ToolHeader title="Snippet Library" subtitle="Save and reuse common GPC code snippets">
		<span class="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
			{allSnippets.length} snippet{allSnippets.length !== 1 ? 's' : ''}
		</span>
		<div class="ml-auto flex gap-2">
			<button
				class="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
				onclick={handleImport}
			>
				Import
			</button>
			<button
				class="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
				onclick={handleExport}
				disabled={settings.snippets.length === 0}
			>
				Export
			</button>
			<button
				class="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
				onclick={() => (showCreate = true)}
			>
				+ New Snippet
			</button>
		</div>
	</ToolHeader>

	<div class="flex min-h-0 flex-1">
		<!-- Snippet list -->
		<div class="flex w-72 flex-col border-r border-zinc-800">
			<div class="border-b border-zinc-800 p-3">
				<input
					type="text"
					placeholder="Search snippets..."
					bind:value={searchQuery}
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
				/>
			</div>
			<div class="flex-1 overflow-y-auto">
				{#each filteredSnippets as snippet}
					<button
						class="flex w-full flex-col gap-0.5 border-b border-zinc-800/50 px-3 py-2 text-left transition-colors {selectedSnippet?.id === snippet.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'}"
						onclick={() => {
							selectedSnippet = { ...snippet };
							editing = false;
						}}
					>
						<div class="flex items-center gap-1.5">
						<span class="text-sm font-medium text-zinc-200">{snippet.name}</span>
						{#if isBuiltinSnippet(snippet.id)}
							<span class="rounded bg-blue-900/50 px-1.5 py-0.5 text-[10px] text-blue-400">built-in</span>
						{/if}
					</div>
						{#if snippet.description}
							<span class="truncate text-xs text-zinc-500">{snippet.description}</span>
						{/if}
						{#if snippet.creator}
							<span class="text-[10px] text-zinc-600">Originally made by {snippet.creator}</span>
						{/if}
						{#if snippet.tags.length > 0}
							<div class="flex gap-1">
								{#each snippet.tags as tag}
									<span class="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-400">{tag}</span>
								{/each}
							</div>
						{/if}
					</button>
				{/each}
				{#if filteredSnippets.length === 0}
					<div class="p-4 text-center text-sm text-zinc-500">
						{searchQuery ? 'No snippets match your search' : 'No snippets yet. Create one!'}
					</div>
				{/if}
			</div>
		</div>

		<!-- Snippet detail -->
		<div class="flex flex-1 flex-col">
			{#if showCreate}
				<div class="flex flex-1 flex-col gap-4 p-6">
					<h2 class="text-lg font-semibold">New Snippet</h2>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label class="mb-1 block text-xs text-zinc-400">Name</label>
							<input
								type="text"
								bind:value={newName}
								class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
								placeholder="My snippet"
							/>
						</div>
						<div>
							<label class="mb-1 block text-xs text-zinc-400">Tags (comma-separated)</label>
							<input
								type="text"
								bind:value={newTags}
								class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
								placeholder="utility, combo, menu"
							/>
						</div>
					</div>
					<div>
						<label class="mb-1 block text-xs text-zinc-400">Description</label>
						<input
							type="text"
							bind:value={newDescription}
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							placeholder="What does this snippet do?"
						/>
					</div>
					<div class="flex-1">
						<label class="mb-1 block text-xs text-zinc-400">Code</label>
						<div class="h-64 overflow-hidden rounded border border-zinc-700">
							<MonacoEditor
								value={newCode}
								language="gpc"
								onchange={(v) => (newCode = v)}
							/>
						</div>
					</div>
					<div class="flex gap-2">
						<button
							class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
							onclick={handleCreate}
						>
							Create Snippet
						</button>
						<button
							class="rounded border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
							onclick={() => (showCreate = false)}
						>
							Cancel
						</button>
					</div>
				</div>
			{:else if selectedSnippet}
				<div class="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
					<div class="flex items-center gap-3">
						{#if editing}
							<input
								type="text"
								bind:value={selectedSnippet.name}
								class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							/>
						{:else}
							<h2 class="text-lg font-semibold">{selectedSnippet.name}</h2>
						{/if}
						{#if selectedSnippet.tags.length > 0 && !editing}
							{#each selectedSnippet.tags as tag}
								<span class="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-400">{tag}</span>
							{/each}
						{/if}
					</div>
					<div class="flex gap-2">
						{#if editing}
							<button
								class="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500"
								onclick={handleSave}
							>
								Save
							</button>
							<button
								class="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
								onclick={() => (editing = false)}
							>
								Cancel
							</button>
						{:else}
							<button
								class="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
								onclick={() => copyToClipboard(selectedSnippet!.code)}
							>
								Copy
							</button>
							{#if !isBuiltinSnippet(selectedSnippet!.id)}
								<button
									class="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
									onclick={() => (editing = true)}
								>
									Edit
								</button>
								<button
									class="rounded border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30"
									onclick={() => handleDelete(selectedSnippet!.id)}
								>
									Delete
								</button>
							{/if}
						{/if}
					</div>
				</div>
				{#if editing}
					<div class="border-b border-zinc-800 p-4">
						<div class="grid grid-cols-2 gap-4">
							<div>
								<label class="mb-1 block text-xs text-zinc-400">Description</label>
								<input
									type="text"
									bind:value={selectedSnippet.description}
									class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
								/>
							</div>
							<div>
								<label class="mb-1 block text-xs text-zinc-400">Tags</label>
								<input
									type="text"
									value={selectedSnippet.tags.join(', ')}
									onchange={(e) => {
										if (selectedSnippet) {
											selectedSnippet.tags = (e.target as HTMLInputElement).value
												.split(',')
												.map((t) => t.trim())
												.filter(Boolean);
										}
									}}
									class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
								/>
							</div>
						</div>
					</div>
				{:else if selectedSnippet.description}
					<div class="border-b border-zinc-800 px-4 py-2 text-sm text-zinc-400">
						{selectedSnippet.description}
					</div>
				{/if}
				<div class="flex-1">
					<MonacoEditor
						value={selectedSnippet.code}
						language="gpc"
						readonly={!editing}
						onchange={(v) => {
							if (selectedSnippet && editing) selectedSnippet.code = v;
						}}
					/>
				</div>
			{:else}
				<div class="flex flex-1 items-center justify-center text-sm text-zinc-500">
					Select a snippet or create a new one
				</div>
			{/if}
		</div>
	</div>
</div>
