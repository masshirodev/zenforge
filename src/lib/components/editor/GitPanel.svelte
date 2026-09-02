<script lang="ts">
	import {
		gitStatusDetailed,
		gitStage,
		gitUnstage,
		gitCommit,
		gitDiffFile,
		gitInit,
		gitRemoteList,
		gitRemoteAdd,
		gitRemoteRemove,
		gitCurrentBranch,
		gitPush,
		gitPull
	} from '$lib/tauri/commands';
	import type { GitDetailedStatus, GitRemote } from '$lib/tauri/commands';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		repoPath: string;
		isGitRepo?: boolean;
		onCommitted?: () => void;
		onRepoInit?: () => void;
	}

	let { repoPath, isGitRepo = true, onCommitted, onRepoInit }: Props = $props();

	let statuses = $state<GitDetailedStatus[]>([]);
	let loading = $state(false);
	let commitMessage = $state('');
	let committing = $state(false);
	let diffPreview = $state<{ path: string; diff: string } | null>(null);
	let initializing = $state(false);

	// Remote management
	let remotes = $state<GitRemote[]>([]);
	let showRemoteForm = $state(false);
	let newRemoteName = $state('origin');
	let newRemoteUrl = $state('');
	let currentBranch = $state('');
	let pushing = $state(false);
	let pulling = $state(false);

	// Derived: staged files (have index status)
	let staged = $derived(statuses.filter((s) => s.index_status && s.index_status !== '?'));
	// Derived: unstaged/untracked files (have worktree status or are untracked)
	let unstaged = $derived(
		statuses.filter(
			(s) => s.worktree_status || (s.index_status === '?' && s.worktree_status === '?')
		)
	);

	$effect(() => {
		if (repoPath && isGitRepo) {
			refresh();
			loadRemotes();
			loadBranch();
		}
	});

	async function refresh() {
		loading = true;
		try {
			statuses = await gitStatusDetailed(repoPath);
		} catch (e) {
			statuses = [];
		} finally {
			loading = false;
		}
	}

	async function loadRemotes() {
		try {
			remotes = await gitRemoteList(repoPath);
		} catch {
			remotes = [];
		}
	}

	async function loadBranch() {
		try {
			currentBranch = await gitCurrentBranch(repoPath);
		} catch {
			currentBranch = '';
		}
	}

	async function handleInit() {
		initializing = true;
		try {
			await gitInit(repoPath);
			addToast('Git repository initialized', 'success');
			onRepoInit?.();
		} catch (e) {
			addToast(`Failed to initialize: ${e}`, 'error');
		} finally {
			initializing = false;
		}
	}

	async function handleStage(paths: string[]) {
		try {
			await gitStage(repoPath, paths);
			await refresh();
		} catch (e) {
			addToast(`Failed to stage: ${e}`, 'error');
		}
	}

	async function handleUnstage(paths: string[]) {
		try {
			await gitUnstage(repoPath, paths);
			await refresh();
		} catch (e) {
			addToast(`Failed to unstage: ${e}`, 'error');
		}
	}

	async function handleStageAll() {
		const paths = unstaged.map((s) => s.path);
		if (paths.length > 0) await handleStage(paths);
	}

	async function handleUnstageAll() {
		const paths = staged.map((s) => s.path);
		if (paths.length > 0) await handleUnstage(paths);
	}

	async function handleCommit() {
		if (!commitMessage.trim()) {
			addToast('Commit message cannot be empty', 'warning');
			return;
		}
		committing = true;
		try {
			await gitCommit(repoPath, commitMessage.trim());
			addToast('Changes committed successfully', 'success');
			commitMessage = '';
			diffPreview = null;
			await refresh();
			await loadBranch();
			onCommitted?.();
		} catch (e) {
			addToast(`Commit failed: ${e}`, 'error');
		} finally {
			committing = false;
		}
	}

	async function handleShowDiff(path: string) {
		if (diffPreview?.path === path) {
			diffPreview = null;
			return;
		}
		try {
			const diff = await gitDiffFile(repoPath, path);
			diffPreview = { path, diff: diff || '(no diff available — file may be untracked)' };
		} catch {
			diffPreview = { path, diff: '(failed to load diff)' };
		}
	}

	async function handleAddRemote() {
		if (!newRemoteName.trim() || !newRemoteUrl.trim()) {
			addToast('Remote name and URL are required', 'warning');
			return;
		}
		try {
			await gitRemoteAdd(repoPath, newRemoteName.trim(), newRemoteUrl.trim());
			addToast(`Remote "${newRemoteName}" added`, 'success');
			showRemoteForm = false;
			newRemoteName = 'origin';
			newRemoteUrl = '';
			await loadRemotes();
		} catch (e) {
			addToast(`Failed to add remote: ${e}`, 'error');
		}
	}

	async function handleRemoveRemote(name: string) {
		try {
			await gitRemoteRemove(repoPath, name);
			addToast(`Remote "${name}" removed`, 'success');
			await loadRemotes();
		} catch (e) {
			addToast(`Failed to remove remote: ${e}`, 'error');
		}
	}

	async function handlePush() {
		if (remotes.length === 0) {
			addToast('No remote configured. Add a remote first.', 'warning');
			return;
		}
		pushing = true;
		try {
			const remote = remotes[0].name;
			const branch = currentBranch || 'main';
			await gitPush(repoPath, remote, branch, true);
			addToast(`Pushed to ${remote}/${branch}`, 'success');
		} catch (e) {
			addToast(`Push failed: ${e}`, 'error');
		} finally {
			pushing = false;
		}
	}

	async function handlePull() {
		if (remotes.length === 0) {
			addToast('No remote configured. Add a remote first.', 'warning');
			return;
		}
		pulling = true;
		try {
			const remote = remotes[0].name;
			const branch = currentBranch || 'main';
			await gitPull(repoPath, remote, branch);
			addToast(`Pulled from ${remote}/${branch}`, 'success');
			await refresh();
		} catch (e) {
			addToast(`Pull failed: ${e}`, 'error');
		} finally {
			pulling = false;
		}
	}

	function fileName(path: string): string {
		return path.split('/').pop() ?? path;
	}

	function statusLabel(status: string): string {
		switch (status) {
			case 'M': return 'Modified';
			case 'A': return 'Added';
			case 'D': return 'Deleted';
			case '?': return 'Untracked';
			case 'R': return 'Renamed';
			default: return status;
		}
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'M': return 'text-amber-400';
			case 'A': return 'text-emerald-400';
			case 'D': return 'text-red-400';
			case '?': return 'text-zinc-400';
			case 'R': return 'text-blue-400';
			default: return 'text-zinc-400';
		}
	}
</script>

{#if !isGitRepo}
<div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center">
	<svg class="mx-auto mb-3 h-10 w-10 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
	</svg>
	<p class="text-sm text-zinc-400">This game directory is not inside a Git repository.</p>
	<p class="mt-2 text-xs text-zinc-600">Initialize a Git repository to start tracking changes.</p>
	<button
		class="mt-4 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
		disabled={initializing}
		onclick={handleInit}
	>
		{initializing ? 'Initializing...' : 'Initialize Git Repository'}
	</button>
</div>
{:else}
<div class="flex h-full gap-4 overflow-hidden">
	<!-- Left: staged/unstaged lists + commit -->
	<div class="flex w-96 shrink-0 flex-col overflow-hidden">
		<!-- Branch & Push/Pull -->
		<div class="flex items-center gap-2 border-b border-zinc-800 px-1 pb-2">
			{#if currentBranch}
				<span class="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
					<svg class="mr-1 inline h-3 w-3 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
					</svg>
					{currentBranch}
				</span>
			{/if}
			<div class="ml-auto flex gap-1">
				<button
					class="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-40"
					disabled={pulling || remotes.length === 0}
					onclick={handlePull}
					title="Pull from remote"
				>
					{pulling ? '...' : 'Pull'}
				</button>
				<button
					class="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-40"
					disabled={pushing || remotes.length === 0}
					onclick={handlePush}
					title="Push to remote"
				>
					{pushing ? '...' : 'Push'}
				</button>
			</div>
		</div>

		<!-- Remotes -->
		<div class="border-b border-zinc-800 py-1.5">
			<div class="flex items-center justify-between px-1">
				<span class="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Remotes</span>
				<button
					class="text-[10px] text-zinc-500 hover:text-zinc-300"
					onclick={() => (showRemoteForm = !showRemoteForm)}
				>
					{showRemoteForm ? 'Cancel' : '+ Add'}
				</button>
			</div>
			{#if showRemoteForm}
				<div class="mt-1.5 flex flex-col gap-1.5 px-1">
					<div class="flex gap-1.5">
						<input
							class="w-20 rounded border border-zinc-700 bg-zinc-800/50 px-1.5 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
							placeholder="name"
							bind:value={newRemoteName}
						/>
						<input
							class="flex-1 rounded border border-zinc-700 bg-zinc-800/50 px-1.5 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
							placeholder="https://github.com/user/repo.git"
							bind:value={newRemoteUrl}
							onkeydown={(e) => { if (e.key === 'Enter') handleAddRemote(); }}
						/>
					</div>
					<button
						class="w-full rounded bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-emerald-500"
						onclick={handleAddRemote}
					>
						Add Remote
					</button>
				</div>
			{/if}
			{#if remotes.length > 0}
				<div class="mt-1 px-1">
					{#each remotes as remote}
						<div class="group flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-zinc-800/50">
							<span class="text-[11px] font-medium text-zinc-300">{remote.name}</span>
							<span class="min-w-0 flex-1 truncate text-[10px] text-zinc-500" title={remote.url}>{remote.url}</span>
							<button
								class="shrink-0 text-[10px] text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400"
								onclick={() => handleRemoveRemote(remote.name)}
								title="Remove remote"
							>
								&times;
							</button>
						</div>
					{/each}
				</div>
			{:else if !showRemoteForm}
				<p class="mt-1 px-2 text-[10px] text-zinc-600">No remotes configured</p>
			{/if}
		</div>

		<!-- Unstaged changes -->
		<div class="flex flex-col overflow-hidden border-b border-zinc-800 pb-2">
			<div class="flex items-center justify-between px-1 py-1.5">
				<span class="text-xs font-semibold text-zinc-300">
					Changes ({unstaged.length})
				</span>
				{#if unstaged.length > 0}
					<button
						class="text-[10px] text-zinc-500 hover:text-zinc-300"
						onclick={handleStageAll}
					>
						Stage All
					</button>
				{/if}
			</div>
			<div class="max-h-40 overflow-y-auto">
				{#if loading}
					<div class="px-2 py-4 text-center text-xs text-zinc-600">Loading...</div>
				{:else if unstaged.length === 0}
					<div class="px-2 py-4 text-center text-xs text-zinc-600">No unstaged changes</div>
				{:else}
					{#each unstaged as file}
						<div class="group flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800/50">
							<span class="w-4 text-center text-[10px] font-bold {statusColor(file.worktree_status || file.index_status)}">
								{file.worktree_status || file.index_status}
							</span>
							<button
								class="min-w-0 flex-1 truncate text-left text-xs text-zinc-400 hover:text-zinc-200"
								title={file.path}
								onclick={() => handleShowDiff(file.path)}
							>
								{fileName(file.path)}
							</button>
							<button
								class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-300"
								onclick={() => handleStage([file.path])}
								title="Stage file"
							>
								+
							</button>
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<!-- Staged changes -->
		<div class="flex flex-col overflow-hidden border-b border-zinc-800 pb-2">
			<div class="flex items-center justify-between px-1 py-1.5">
				<span class="text-xs font-semibold text-emerald-400">
					Staged ({staged.length})
				</span>
				{#if staged.length > 0}
					<button
						class="text-[10px] text-zinc-500 hover:text-zinc-300"
						onclick={handleUnstageAll}
					>
						Unstage All
					</button>
				{/if}
			</div>
			<div class="max-h-40 overflow-y-auto">
				{#if staged.length === 0}
					<div class="px-2 py-4 text-center text-xs text-zinc-600">No staged changes</div>
				{:else}
					{#each staged as file}
						<div class="group flex items-center gap-1.5 rounded px-2 py-1 hover:bg-zinc-800/50">
							<span class="w-4 text-center text-[10px] font-bold {statusColor(file.index_status)}">
								{file.index_status}
							</span>
							<button
								class="min-w-0 flex-1 truncate text-left text-xs text-zinc-300"
								title={file.path}
								onclick={() => handleShowDiff(file.path)}
							>
								{fileName(file.path)}
							</button>
							<button
								class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-300"
								onclick={() => handleUnstage([file.path])}
								title="Unstage file"
							>
								−
							</button>
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<!-- Commit area -->
		<div class="flex flex-col gap-2 pt-2">
			<textarea
				class="w-full resize-none rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
				rows="3"
				placeholder="Commit message..."
				bind:value={commitMessage}
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
						e.preventDefault();
						handleCommit();
					}
				}}
			></textarea>
			<button
				class="w-full rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600"
				disabled={staged.length === 0 || !commitMessage.trim() || committing}
				onclick={handleCommit}
			>
				{committing ? 'Committing...' : `Commit (${staged.length} file${staged.length !== 1 ? 's' : ''})`}
			</button>
			<div class="text-center text-[10px] text-zinc-600">Ctrl+Enter to commit</div>
		</div>

		<!-- Refresh button -->
		<div class="mt-auto pt-2">
			<button
				class="w-full rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
				onclick={refresh}
			>
				Refresh
			</button>
		</div>
	</div>

	<!-- Right: diff preview -->
	<div class="flex flex-1 flex-col overflow-hidden rounded border border-zinc-800">
		{#if diffPreview}
			<div class="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
				<span class="truncate text-xs text-zinc-300">{fileName(diffPreview.path)}</span>
				<button
					class="text-xs text-zinc-500 hover:text-zinc-300"
					onclick={() => (diffPreview = null)}
				>
					Close
				</button>
			</div>
			<pre class="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">{#each diffPreview.diff.split('\n') as line}<span class={line.startsWith('+') && !line.startsWith('+++') ? 'text-emerald-400' : line.startsWith('-') && !line.startsWith('---') ? 'text-red-400' : line.startsWith('@@') ? 'text-blue-400' : 'text-zinc-500'}>{line}</span>
{/each}</pre>
		{:else}
			<div class="flex h-full items-center justify-center text-xs text-zinc-600">
				Click a file to preview its diff
			</div>
		{/if}
	</div>
</div>
{/if}
