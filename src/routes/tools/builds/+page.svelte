<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';
	import { onFileChange } from '$lib/tauri/events';
	import {
		readFileTree,
		readFile,
		writeFile,
		getAppRoot,
		listGames,
		buildGame,
		loadFlowProject,
		loadGameMeta,
		startFileServer
	} from '$lib/tauri/commands';
	import { generateMergedFlowGpc } from '$lib/flow/codegen-merged';
	import { mergeRecoilTable, parseWeaponNames } from '$lib/utils/recoil-parser';
	import { addToast } from '$lib/stores/toast.svelte';
	import { getSettings } from '$lib/stores/settings.svelte';
	import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import type { FileTreeEntry, BuildResult } from '$lib/tauri/commands';
	import type { GameSummary } from '$lib/types/config';

	let settingsStore = getSettings();
	let settings = $derived($settingsStore);

	// Active view tab
	let viewTab = $state<'files' | 'queue'>('files');

	interface BuildFile {
		name: string;
		path: string;
		source: string;
	}

	let files = $state<BuildFile[]>([]);
	let loading = $state(true);
	let selectedFile = $state<BuildFile | null>(null);
	let fileContent = $state<string | null>(null);
	let loadingContent = $state(false);
	let copied = $state(false);
	let searchQuery = $state('');
	let sendingToZenStudio = $state(false);

	// TODO: Replace with actual Zen Studio URL when known
	const ZEN_STUDIO_URL = 'http://localhost:3000';

	// Build queue state
	interface QueueItem {
		game: GameSummary;
		status: 'pending' | 'building' | 'success' | 'error';
		result?: BuildResult;
	}

	let allGames = $state<GameSummary[]>([]);
	let selectedGamePaths = $state<Set<string>>(new Set());
	let buildQueue = $state<QueueItem[]>([]);
	let queueRunning = $state(false);

	async function loadAllGames() {
		try {
			allGames = await listGames(settings.workspaces.length > 0 ? settings.workspaces : undefined);
		} catch (e) {
			addToast(`Failed to list games: ${e}`, 'error');
		}
	}

	function toggleGameSelection(path: string) {
		const next = new Set(selectedGamePaths);
		if (next.has(path)) {
			next.delete(path);
		} else {
			next.add(path);
		}
		selectedGamePaths = next;
	}

	function selectAllGames() {
		selectedGamePaths = new Set(allGames.map((g) => g.path));
	}

	function clearSelection() {
		selectedGamePaths = new Set();
	}

	function getWorkspaceForGame(gamePath: string): string | undefined {
		return settings.workspaces.find((ws) => gamePath.startsWith(ws));
	}

	async function runBuildQueue() {
		if (selectedGamePaths.size === 0) return;
		queueRunning = true;
		buildQueue = allGames
			.filter((g) => selectedGamePaths.has(g.path))
			.map((game) => ({ game, status: 'pending' as const }));

		for (let i = 0; i < buildQueue.length; i++) {
			buildQueue[i].status = 'building';
			buildQueue = [...buildQueue]; // trigger reactivity
			try {
				const gamePath = buildQueue[i].game.path;
				const ws = getWorkspaceForGame(gamePath);

				// For flow-based games, generate main.gpc before building
				if (buildQueue[i].game.generation_mode === 'flow') {
					const flowProject = await loadFlowProject(gamePath);
					if (flowProject) {
						const gameMeta = await loadGameMeta(gamePath);
						const { code: gpcCode, extraFiles } = generateMergedFlowGpc(flowProject, {
							gameVersion: gameMeta?.version,
							gameName: gameMeta?.name,
							filename: gameMeta?.filename,
							gameType: gameMeta?.game_type,
							consoleType: gameMeta?.console_type,
							username: gameMeta?.username,
							headerComments: gameMeta?.header_comments,
						});
						await writeFile(gamePath + '/main.gpc', gpcCode);
						for (const [fn, content] of Object.entries(extraFiles)) {
							if (fn === 'recoiltable.gpc') {
								try {
									const existing = await readFile(gamePath + '/' + fn);
									const names = parseWeaponNames(gpcCode);
									await writeFile(gamePath + '/' + fn, mergeRecoilTable(existing, names));
								} catch {
									await writeFile(gamePath + '/' + fn, content);
								}
							} else {
								try { await readFile(gamePath + '/' + fn); } catch {
									await writeFile(gamePath + '/' + fn, content);
								}
							}
						}
					}
				}

				const result = await buildGame(gamePath, ws);
				buildQueue[i].status = result.success ? 'success' : 'error';
				buildQueue[i].result = result;
			} catch (e) {
				buildQueue[i].status = 'error';
				buildQueue[i].result = {
					output_path: '',
					success: false,
					errors: [String(e)],
					warnings: []
				};
			}
			buildQueue = [...buildQueue];
		}

		const successes = buildQueue.filter((q) => q.status === 'success').length;
		const failures = buildQueue.filter((q) => q.status === 'error').length;
		addToast(
			`Build queue complete: ${successes} succeeded, ${failures} failed`,
			failures > 0 ? 'warning' : 'success'
		);
		queueRunning = false;
		await loadBuilds();
	}

	let filteredFiles = $derived.by(() => {
		if (!searchQuery.trim()) return files;
		const q = searchQuery.toLowerCase();
		return files.filter((f) => f.name.toLowerCase().includes(q));
	});

	afterNavigate(() => {
		loadBuilds();
		loadAllGames();
	});

	onMount(() => {
		let unlisten: (() => void) | undefined;
		onFileChange((event) => {
			if (event.paths.some((p) => p.includes('/dist/') && p.endsWith('.gpc'))) {
				loadBuilds();
			}
		}).then((fn) => (unlisten = fn));

		return () => unlisten?.();
	});

	async function loadBuilds() {
		loading = true;
		files = [];
		try {
			const sources: Array<{ path: string; label: string }> = [];

			for (const ws of settings.workspaces) {
				sources.push({ path: `${ws}/dist`, label: ws.split('/').pop() ?? ws });
			}

			try {
				const appRoot = await getAppRoot();
				const appDist = `${appRoot}/dist`;
				if (!sources.some((s) => s.path === appDist)) {
					sources.push({ path: appDist, label: 'app' });
				}
			} catch {
				// ignore if getAppRoot fails
			}

			const allFiles: BuildFile[] = [];

			for (const src of sources) {
				try {
					const entries = await readFileTree(src.path);
					flattenGpcFiles(entries, src.label, allFiles);
				} catch {
					// dist dir might not exist yet, that's fine
				}
			}

			allFiles.sort((a, b) => a.name.localeCompare(b.name));
			files = allFiles;
		} catch (e) {
			addToast(`Failed to scan dist directories: ${e}`, 'error');
		} finally {
			loading = false;
		}
	}

	function flattenGpcFiles(entries: FileTreeEntry[], source: string, out: BuildFile[]) {
		for (const entry of entries) {
			if (entry.is_dir && entry.children) {
				flattenGpcFiles(entry.children, source, out);
			} else if (entry.name.endsWith('.gpc')) {
				out.push({ name: entry.name, path: entry.path, source });
			}
		}
	}

	async function selectFile(file: BuildFile) {
		selectedFile = file;
		fileContent = null;
		loadingContent = true;
		copied = false;
		try {
			fileContent = await readFile(file.path);
		} catch (e) {
			addToast(`Failed to read file: ${e}`, 'error');
			fileContent = null;
		} finally {
			loadingContent = false;
		}
	}

	async function handleCopy() {
		if (!fileContent) return;
		try {
			await navigator.clipboard.writeText(fileContent);
			copied = true;
			addToast('Copied to clipboard', 'success');
			setTimeout(() => (copied = false), 2000);
		} catch {
			addToast('Failed to copy to clipboard', 'error');
		}
	}

	async function handleDelete(file: BuildFile) {
		try {
			const { deleteFile } = await import('$lib/tauri/commands');
			await deleteFile(file.path);
			addToast(`Deleted ${file.name}`, 'success');
			if (selectedFile?.path === file.path) {
				selectedFile = null;
				fileContent = null;
			}
			await loadBuilds();
		} catch (e) {
			addToast(`Failed to delete: ${e}`, 'error');
		}
	}

	async function handleSendToZenStudio() {
		if (!selectedFile) return;
		sendingToZenStudio = true;
		try {
			const serverUrl = await startFileServer(selectedFile.path);
			const studioUrl = `${ZEN_STUDIO_URL}?url=${encodeURIComponent(serverUrl)}`;
			const { openUrl } = await import('@tauri-apps/plugin-opener');
			await openUrl(studioUrl);
			addToast(m.editor_build_zen_studio_success(), 'success');
		} catch (e) {
			addToast(m.editor_build_zen_studio_error({ error: String(e) }), 'error');
		} finally {
			sendingToZenStudio = false;
		}
	}
</script>

<div class="flex h-full flex-col bg-zinc-950 text-zinc-200">
	<ToolHeader title="Built Games" subtitle="Browse compiled game files and manage the build queue">
		<div class="ml-4 flex rounded border border-zinc-800">
			<button
				class="px-3 py-1 text-xs font-medium transition-colors {viewTab === 'files' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}"
				onclick={() => (viewTab = 'files')}
			>
				Files
			</button>
			<button
				class="px-3 py-1 text-xs font-medium transition-colors {viewTab === 'queue' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}"
				onclick={() => (viewTab = 'queue')}
			>
				Build Queue
			</button>
		</div>
		<div class="ml-auto flex items-center gap-2">
			{#if viewTab === 'files'}
				<button
					class="flex items-center gap-1.5 rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					onclick={loadBuilds}
					disabled={loading}
				>
					<svg
						class="h-3.5 w-3.5 {loading ? 'animate-spin' : ''}"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
						/>
					</svg>
					Refresh
				</button>
			{/if}
		</div>
	</ToolHeader>

	<!-- Main Content -->
	{#if viewTab === 'queue'}
		<!-- Build Queue View -->
		<div class="flex flex-1 flex-col overflow-hidden p-4">
			<div class="mb-4 flex items-center justify-between">
				<div class="flex items-center gap-3">
					<button
						class="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
						onclick={runBuildQueue}
						disabled={queueRunning || selectedGamePaths.size === 0}
					>
						{queueRunning ? 'Building...' : `Build ${selectedGamePaths.size} Game${selectedGamePaths.size !== 1 ? 's' : ''}`}
					</button>
					<button
						class="rounded border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
						onclick={selectAllGames}
						disabled={queueRunning}
					>
						Select All
					</button>
					<button
						class="rounded border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
						onclick={clearSelection}
						disabled={queueRunning}
					>
						Clear
					</button>
				</div>
				<span class="text-xs text-zinc-500">{allGames.length} games available</span>
			</div>

			<div class="flex-1 overflow-y-auto">
				{#if allGames.length === 0}
					<div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">
						No games found. Create a game first.
					</div>
				{:else}
					<div class="space-y-1">
						{#each allGames as game}
							{@const queueItem = buildQueue.find((q) => q.game.path === game.path)}
							<div
								class="flex items-center gap-3 rounded border px-3 py-2 transition-colors {selectedGamePaths.has(game.path) ? 'border-emerald-800 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'}"
							>
								<input
									type="checkbox"
									checked={selectedGamePaths.has(game.path)}
									onchange={() => toggleGameSelection(game.path)}
									disabled={queueRunning}
									class="accent-emerald-500"
								/>
								<div class="flex-1">
									<div class="text-sm font-medium text-zinc-200">{game.name}</div>
									<div class="text-xs text-zinc-500">{game.path}</div>
								</div>
								<span class="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400 uppercase">{game.game_type}</span>
								<span class="text-xs text-zinc-500">v{game.version}</span>
								{#if queueItem}
									{#if queueItem.status === 'building'}
										<div class="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent"></div>
									{:else if queueItem.status === 'success'}
										<svg class="h-4 w-4 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
											<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
										</svg>
									{:else if queueItem.status === 'error'}
										<svg class="h-4 w-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
											<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
										</svg>
									{/if}
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				{#if buildQueue.length > 0 && !queueRunning}
					<div class="mt-4 rounded border border-zinc-800 bg-zinc-900 p-3">
						<h3 class="mb-2 text-xs font-semibold text-zinc-400 uppercase">Results</h3>
						{#each buildQueue as item}
							<div class="flex items-center justify-between py-1 text-xs">
								<span class="text-zinc-300">{item.game.name}</span>
								{#if item.status === 'success'}
									<span class="text-emerald-400">Success</span>
								{:else if item.status === 'error'}
									<span class="text-red-400" title={item.result?.errors.join(', ')}>
										Failed: {item.result?.errors[0]?.slice(0, 60)}
									</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{:else}
	<div class="flex flex-1 overflow-hidden">
		<!-- Left Panel: File List -->
		<div class="flex w-72 shrink-0 flex-col border-r border-zinc-800">
			<!-- Search -->
			<div class="border-b border-zinc-800 p-3">
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search builds..."
					class="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
				/>
			</div>

			<!-- File List -->
			<div class="flex-1 overflow-y-auto">
				{#if loading}
					<div class="px-3 py-6 text-center text-xs text-zinc-500">
						Scanning dist directories...
					</div>
				{:else if filteredFiles.length === 0}
					<div class="px-3 py-6 text-center text-xs text-zinc-500">
						{files.length === 0 ? 'No built files found. Build a game first.' : 'No matches'}
					</div>
				{:else}
					{#each filteredFiles as file (file.path)}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div
							class="group flex w-full cursor-pointer items-center gap-2 border-b border-zinc-800/50 px-3 py-2.5 text-left transition-colors {selectedFile?.path ===
							file.path
								? 'bg-zinc-800/80'
								: 'hover:bg-zinc-900'}"
							onclick={() => selectFile(file)}
						>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<svg
										class="h-3.5 w-3.5 shrink-0 text-emerald-500"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
										/>
									</svg>
									<span class="truncate text-xs font-medium text-zinc-200"
										>{file.name}</span
									>
								</div>
								<div class="mt-0.5 pl-5.5 text-[10px] text-zinc-600">
									{file.source}
								</div>
							</div>
							<button
								class="shrink-0 rounded p-1 text-zinc-600 opacity-0 hover:text-red-400 group-hover:opacity-100"
								onclick={(e) => {
									e.stopPropagation();
									handleDelete(file);
								}}
								title="Delete build file"
							>
								<svg
									class="h-3.5 w-3.5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
									/>
								</svg>
							</button>
						</div>
					{/each}
				{/if}
			</div>

			<!-- Footer -->
			<div class="border-t border-zinc-800 px-3 py-2 text-[10px] text-zinc-600">
				{filteredFiles.length} file{filteredFiles.length !== 1 ? 's' : ''}
			</div>
		</div>

		<!-- Right Panel: File Content -->
		<div class="flex flex-1 flex-col overflow-hidden">
			{#if loadingContent}
				<div class="flex flex-1 items-center justify-center text-xs text-zinc-500">
					Loading file...
				</div>
			{:else if selectedFile && fileContent !== null}
				<!-- File header -->
				<div
					class="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-2"
				>
					<div class="flex items-center gap-3">
						<span class="text-xs font-medium text-zinc-200">{selectedFile.name}</span>
						<span class="text-xs text-zinc-600">
							{fileContent.split('\n').length} lines
						</span>
					</div>
					<div class="flex items-center gap-2">
						<button
							class="flex items-center gap-1.5 rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
							onclick={handleCopy}
							title="Copy to clipboard"
						>
							<svg
								class="h-3 w-3"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
								/>
							</svg>
							{copied ? 'Copied!' : 'Copy'}
						</button>
						<button
							class="hidden items-center gap-1.5 rounded border border-blue-700/50 px-2.5 py-1 text-xs text-blue-400 transition-colors hover:bg-blue-900/30 hover:text-blue-300 disabled:opacity-50"
							onclick={handleSendToZenStudio}
							disabled={sendingToZenStudio}
							title={m.editor_build_send_zen_studio()}
						>
							<svg
								class="h-3 w-3"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
								/>
							</svg>
							{sendingToZenStudio ? m.editor_build_sending_zen_studio() : m.editor_build_send_zen_studio()}
						</button>
					</div>
				</div>

				<!-- Editor -->
				<div class="flex-1">
					<MonacoEditor value={fileContent} language="gpc" readonly={true} />
				</div>
			{:else}
				<!-- Empty state -->
				<div class="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
					<svg class="h-10 w-10 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
						/>
					</svg>
					<p class="text-xs">Select a built file to view its contents</p>
				</div>
			{/if}
		</div>
	</div>
	{/if}
</div>
