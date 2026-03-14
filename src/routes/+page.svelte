<script lang="ts">
	import { getGameStore, gamesByType, gamesByWorkspace, recentGames, loadGames, clearSelection } from '$lib/stores/game.svelte';
	import { selectGame } from '$lib/stores/game.svelte';
	import {
		getEditorStore,
		getActiveTab as getActiveEditorTab,
		openTab,
		openTabAtLine,
		closeTab,
		activateTab,
		updateTabContent,
		saveTab,
		closeAllTabs,
		reloadTab,
		getTab,
		wasRecentlySaved,
		restoreSession
	} from '$lib/stores/editor.svelte';
	import {
		getUiStore,
		setSidebarCollapsed,
		toggleBottomPanel,
		setBottomPanelOpen,
		setBottomPanelActiveTab,
		consumeFileNavigation
	} from '$lib/stores/ui.svelte';
	import { getLspStore, startLsp, stopLsp, restartLsp, getLspClient } from '$lib/stores/lsp.svelte';
	import { MonacoLspBridge } from '$lib/lsp/MonacoLspBridge';
	import {
		buildGame,
		readFileTree,
		readFile,
		writeFile,
		watchDirectory,
		deleteFile,
		deleteGame,
		openInDefaultApp,
		startFileServer,
		createSnapshot,
		listSnapshots,
		getSnapshot,
		rollbackSnapshot,
		deleteSnapshot,
		renameSnapshot,
		importFiles,
		gitStatus,
		gitDiffFile,
		gitIsRepo,
		exportGameZip,
		importGameZip,
		loadFlowProject
	} from '$lib/tauri/commands';
	import { onFileChange } from '$lib/tauri/events';
	import type { BuildResult, FileTreeEntry, SnapshotMeta } from '$lib/tauri/commands';
	import type { UnlistenFn } from '@tauri-apps/api/event';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
	import { onMount } from 'svelte';
	import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
	import FlowEditor from './tools/flow/FlowEditor.svelte';
	import NewFileModal from '$lib/components/modals/NewFileModal.svelte';
	import TemplateImportModal from '$lib/components/modals/TemplateImportModal.svelte';
	import ConfirmDialog from '$lib/components/modals/ConfirmDialog.svelte';
	import SaveTemplateModal from '$lib/components/modals/SaveTemplateModal.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import { getSettings } from '$lib/stores/settings.svelte';
	import { getRecoilTransfer, clearRecoilTransfer } from '$lib/stores/recoil-transfer.svelte';
	import {
		getKeyboardTransfer,
		clearKeyboardTransfer
	} from '$lib/stores/keyboard-transfer.svelte';
	import { getComboTransfer, clearComboTransfer } from '$lib/stores/combo-transfer.svelte';
	import { getFlowOledTransfer } from '$lib/stores/flow-transfer.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import {
		type KeyMapping,
		parseKeyboardMappings,
		serializeKeyboardMappings
	} from '$lib/utils/keyboard-parser';
	import {
		parseRecoilTable,
		serializeRecoilTable,
		updateWeaponValues
	} from '$lib/utils/recoil-parser';
	import { parseBuildErrorLink } from '$lib/utils/editor-helpers';
	import { generateMergedFlowGpc } from '$lib/flow/codegen-merged';
	import { mergeRecoilTable, parseWeaponNames } from '$lib/utils/recoil-parser';
	import { parseDiffToLineChanges } from '$lib/utils/diff-parser';
	import type { GitLineChange } from '$lib/utils/diff-parser';

	// Extracted components
	import DashboardView from '$lib/components/editor/DashboardView.svelte';
	import GameOverviewPanel from '$lib/components/editor/GameOverviewPanel.svelte';
	import FileTreePanel from '$lib/components/editor/FileTreePanel.svelte';
	import EditorPanel from '$lib/components/editor/EditorPanel.svelte';
	import BuildPanel from '$lib/components/editor/BuildPanel.svelte';
	import TaskRunnerPanel from '$lib/components/editor/TaskRunnerPanel.svelte';
	import HistoryPanel from '$lib/components/editor/HistoryPanel.svelte';
	import GitPanel from '$lib/components/editor/GitPanel.svelte';
	import FlowPersistencePanel from '$lib/components/editor/FlowPersistencePanel.svelte';
	import FlowDefaultsPanel from '$lib/components/editor/FlowDefaultsPanel.svelte';
	import { getDiagnosticsStore, getFileSeverityMap } from '$lib/stores/diagnostics.svelte';
	import { getFlowStore, closeGraph, addNode, updateNode, switchFlow, updateVariableDefault, updateProfile, updateWeaponOverride } from '$lib/stores/flow.svelte';
	import { getKeyCombo, matchesCombo } from '$lib/stores/keybindings.svelte';
	import CommandPalette from '$lib/components/layout/CommandPalette.svelte';
	import type { Command } from '$lib/components/layout/CommandPalette.svelte';
	import RecoilTableEditor from '$lib/components/editor/RecoilTableEditor.svelte';

	let store = getGameStore();
	let editorStore = getEditorStore();
	let flowStore = getFlowStore();
	let ui = getUiStore();
	let lspStore = getLspStore();
	let settingsStore = getSettings();
	let settings = $derived($settingsStore);
	let diagStore = getDiagnosticsStore();
	let fileSeverities = $derived(getFileSeverityMap(diagStore.byUri));

	// Theme accent colors for tree view
	interface ThemeAccent {
		bg: string;
		text: string;
		bgHover: string;
		treeBg: string;
		treeBorder: string;
		treeHover: string;
		treeHeaderBg: string;
		tabBarBg: string;
		tabActiveBg: string;
		tabInactiveBg: string;
	}
	const themeAccents: Record<string, ThemeAccent> = {
		'gpc-dark':         { bg: 'rgba(6, 78, 59, 0.3)',       text: '#34d399',  bgHover: 'rgba(6, 78, 59, 0.2)',       treeBg: '#0c0c0c', treeBorder: '#1f1f1f', treeHover: '#1a1a1a', treeHeaderBg: '#0a0a0a', tabBarBg: '#111111', tabActiveBg: '#0a0a0a', tabInactiveBg: '#111111' },
		'atom-one-dark':    { bg: 'rgba(40, 80, 180, 0.2)',     text: '#528bff',  bgHover: 'rgba(40, 80, 180, 0.15)',    treeBg: '#21252b', treeBorder: '#333842', treeHover: '#2c313c', treeHeaderBg: '#282c34', tabBarBg: '#21252b', tabActiveBg: '#282c34', tabInactiveBg: '#21252b' },
		'monokai':          { bg: 'rgba(166, 226, 46, 0.12)',   text: '#a6e22e',  bgHover: 'rgba(166, 226, 46, 0.08)',   treeBg: '#1e1f1c', treeBorder: '#3b3a32', treeHover: '#3e3d32', treeHeaderBg: '#272822', tabBarBg: '#1e1f1c', tabActiveBg: '#272822', tabInactiveBg: '#1e1f1c' },
		'kanagawa':         { bg: 'rgba(127, 180, 202, 0.15)',  text: '#7fb4ca',  bgHover: 'rgba(127, 180, 202, 0.1)',   treeBg: '#1a1a22', treeBorder: '#2a2a37', treeHover: '#2a2a37', treeHeaderBg: '#1f1f28', tabBarBg: '#1a1a22', tabActiveBg: '#1f1f28', tabInactiveBg: '#1a1a22' },
		'dracula':          { bg: 'rgba(189, 147, 249, 0.15)',  text: '#bd93f9',  bgHover: 'rgba(189, 147, 249, 0.1)',   treeBg: '#21222c', treeBorder: '#44475a', treeHover: '#44475a', treeHeaderBg: '#282a36', tabBarBg: '#21222c', tabActiveBg: '#282a36', tabInactiveBg: '#21222c' },
		'gruvbox-dark':     { bg: 'rgba(184, 187, 38, 0.15)',   text: '#b8bb26',  bgHover: 'rgba(184, 187, 38, 0.1)',    treeBg: '#1d2021', treeBorder: '#3c3836', treeHover: '#3c3836', treeHeaderBg: '#282828', tabBarBg: '#1d2021', tabActiveBg: '#282828', tabInactiveBg: '#1d2021' },
		'nord':             { bg: 'rgba(136, 192, 208, 0.15)',  text: '#88c0d0',  bgHover: 'rgba(136, 192, 208, 0.1)',   treeBg: '#272c36', treeBorder: '#3b4252', treeHover: '#3b4252', treeHeaderBg: '#2e3440', tabBarBg: '#272c36', tabActiveBg: '#2e3440', tabInactiveBg: '#272c36' },
		'catppuccin-mocha': { bg: 'rgba(203, 166, 247, 0.15)',  text: '#cba6f7',  bgHover: 'rgba(203, 166, 247, 0.1)',   treeBg: '#181825', treeBorder: '#313244', treeHover: '#313244', treeHeaderBg: '#1e1e2e', tabBarBg: '#181825', tabActiveBg: '#1e1e2e', tabInactiveBg: '#181825' }
	};
	let themeAccent = $derived(themeAccents[settings.editorTheme] ?? themeAccents['gpc-dark']);

	let grouped = $derived(gamesByType(store.games));
	let types = $derived(Object.keys(grouped).sort());
	let workspaceGrouped = $derived(gamesByWorkspace(store.games, settings.workspaces));
	let recent = $derived(recentGames(store.games, 3));
	let gameConsoleType = $derived(
		(store.selectedGame?.console_type ?? 'ps5') as import('$lib/utils/console-buttons').ConsoleType
	);

	// Active editor tab
	let currentEditorTab = $derived(getActiveEditorTab());

	// Build state
	let building = $state(false);
	let buildResult = $state<BuildResult | null>(null);
	let buildOutputContent = $state<string | null>(null);
	let buildOutputLoading = $state(false);
	let sendingToZenStudio = $state(false);

	// TODO: Replace with actual Zen Studio URL when known
	const ZEN_STUDIO_URL = 'http://localhost:3000';

	// Command palette state
	let showCommandPalette = $state(false);
	let paletteCommands = $derived<Command[]>([
		{ id: 'save', label: m.cmd_save_file(), category: m.cmd_category_file(), shortcut: getKeyCombo('save'), action: () => saveTab() },
		{ id: 'build', label: m.cmd_build_game(), category: m.cmd_category_build(), shortcut: getKeyCombo('build'), action: () => { activeTab = 'build'; handleBuild(); } },
		{ id: 'toggleBottom', label: m.cmd_toggle_bottom(), category: m.cmd_category_view(), shortcut: getKeyCombo('toggleBottomPanel'), action: () => toggleBottomPanel() },
		{ id: 'search', label: m.cmd_global_search(), category: m.cmd_category_search(), shortcut: getKeyCombo('globalSearch'), action: () => { setBottomPanelActiveTab('search'); setBottomPanelOpen(true); } },
		{ id: 'newFile', label: m.cmd_new_file(), category: m.cmd_category_file(), action: () => { showNewFileModal = true; } },
		{ id: 'closeTab', label: m.cmd_close_tab(), category: m.cmd_category_file(), action: () => { if (editorStore.activeTabPath) closeTab(editorStore.activeTabPath); } },
		{ id: 'closeAllTabs', label: m.cmd_close_all(), category: m.cmd_category_file(), action: () => closeAllTabs() },
		{ id: 'tabOverview', label: m.cmd_go_overview(), category: m.cmd_category_navigate(), action: () => { activeTab = 'overview'; } },
		{ id: 'tabFiles', label: m.cmd_go_files(), category: m.cmd_category_navigate(), action: () => { activeTab = 'files'; } },
		{ id: 'tabBuild', label: m.cmd_go_build(), category: m.cmd_category_navigate(), action: () => { activeTab = 'build'; } },
		{ id: 'tabHistory', label: m.cmd_go_history(), category: m.cmd_category_navigate(), action: () => { activeTab = 'history'; } },
		{ id: 'restartLsp', label: m.cmd_restart_lsp(), category: m.cmd_category_lsp(), action: () => restartLsp() },
		{ id: 'stopLsp', label: m.cmd_stop_lsp(), category: m.cmd_category_lsp(), action: () => stopLsp() },
		{ id: 'exportZip', label: m.cmd_export_zip(), category: m.cmd_category_file(), action: handleExportZip },
		{ id: 'importZip', label: m.cmd_import_zip(), category: m.cmd_category_file(), action: handleImportZip }
	]);

	// Modal state
	let showNewFileModal = $state(false);
	let showTemplateImportModal = $state(false);
	let showSaveTemplateModal = $state(false);
	// Confirm dialog state
	let confirmDialog = $state<{
		open: boolean;
		title: string;
		message: string;
		confirmLabel: string;
		variant: 'danger' | 'warning' | 'info';
		onconfirm: () => void;
	}>({
		open: false,
		title: '',
		message: '',
		confirmLabel: 'Confirm',
		variant: 'info',
		onconfirm: () => {}
	});

	function showConfirm(opts: {
		title: string;
		message: string;
		confirmLabel?: string;
		variant?: 'danger' | 'warning' | 'info';
	}): Promise<boolean> {
		return new Promise((resolve) => {
			confirmDialog = {
				open: true,
				title: opts.title,
				message: opts.message,
				confirmLabel: opts.confirmLabel ?? 'Confirm',
				variant: opts.variant ?? 'info',
				onconfirm: () => {
					confirmDialog.open = false;
					resolve(true);
				}
			};
			// Store resolve for cancel path
			confirmDialogCancel = () => {
				confirmDialog.open = false;
				resolve(false);
			};
		});
	}

	let confirmDialogCancel = $state<() => void>(() => {});

	// File tree state
	let fileTree = $state<FileTreeEntry[]>([]);
	let expandedDirs = $state<Set<string>>(new Set());

	// Drag & drop state
	let fileDragOver = $state(false);

	// Git status state
	let gitFileStatuses = $state<Map<string, string>>(new Map());
	let activeFileGitChanges = $state<GitLineChange[]>([]);

	// Page tab state
	let activeTab = $state<'overview' | 'files' | 'flow' | 'build' | 'history' | 'git' | 'recoil' | 'persistence' | 'defaults'>('overview');

	// Git repo detection
	let isGitRepo = $state(false);

	// Recoil tab state
	let recoilContent = $state<string | null>(null);
	let recoilFilePath = $state<string | null>(null);

	// Cached flow project for tabs that need it without opening the Flow tab
	let cachedFlowProject = $state<import('$lib/types/flow').FlowProject | null>(null);

	// Load flow project when a flow game is selected
	$effect(() => {
		const game = store.selectedGame;
		if (!game || game.generation_mode !== 'flow') {
			cachedFlowProject = null;
			return;
		}
		// If flow store already has the project loaded, use it
		if (flowStore.project && flowStore.gamePath === game.path) {
			cachedFlowProject = flowStore.project;
			return;
		}
		// Otherwise load from disk
		loadFlowProject(game.path)
			.then((project) => {
				cachedFlowProject = project ?? null;
			})
			.catch(() => {
				cachedFlowProject = null;
			});
	});

	// Keep in sync when flowStore.project changes (e.g. user adds/removes modules)
	$effect(() => {
		if (flowStore.project && flowStore.gamePath === store.selectedGame?.path) {
			cachedFlowProject = flowStore.project;
		}
	});

	// Detect antirecoil_timeline module in flow project
	let hasAntirecoilTimeline = $derived.by(() => {
		if (!cachedFlowProject) return false;
		return cachedFlowProject.flows
			.filter((f) => f.flowType === 'gameplay' || f.flowType === 'data')
			.some((flow) =>
				flow.nodes.some(
					(n) => n.type === 'module' && n.moduleData?.moduleId === 'antirecoil_timeline'
				)
			);
	});

	// Weapon names from weapondata module node for defaults panel
	let cachedWeaponNames = $derived.by(() => {
		if (!cachedFlowProject) return [];
		const allNodes = cachedFlowProject.flows
			.filter((f) => f.flowType === 'gameplay' || f.flowType === 'data')
			.flatMap((f) => f.nodes);
		const wdNode = allNodes.find((n) => n.moduleData?.moduleId === 'weapondata');
		return wdNode?.moduleData?.weaponNames ?? [];
	});

	let gameTabs = $derived((() => {
		const isFlow = store.selectedGame?.generation_mode === 'flow';
		const tabs = ['overview'];
		if (isFlow) {
			tabs.push('flow', 'files');
		} else {
			tabs.push('files');
		}
		if (hasAntirecoilTimeline) {
			tabs.push('recoil');
		}
		if (isFlow) {
			tabs.push('defaults', 'persistence');
		}
		tabs.push('build', 'history', 'git');
		return tabs;
	})());

	// History state
	let snapshots = $state<SnapshotMeta[]>([]);
	let snapshotsLoading = $state(false);
	let snapshotPreview = $state<{ id: string; content: string } | null>(null);
	let renamingSnapshotId = $state<string | null>(null);
	let renameLabel = $state('');

	async function loadSnapshots() {
		if (!store.selectedGame) return;
		snapshotsLoading = true;
		try {
			snapshots = await listSnapshots(store.selectedGame.path);
		} catch (e) {
			addToast(`Failed to load snapshots: ${e}`, 'error');
		} finally {
			snapshotsLoading = false;
		}
	}

	async function handleCreateSnapshot() {
		if (!store.selectedGame) return;
		try {
			const meta = await createSnapshot(store.selectedGame.path, 'Manual snapshot');
			addToast(m.toast_snapshot_created(), 'success');
			await loadSnapshots();
		} catch (e) {
			addToast(`Failed to create snapshot: ${e}`, 'error');
		}
	}

	async function handleRollback(snapshotId: string) {
		if (!store.selectedGame) return;
		const confirmed = await showConfirm({
			title: m.confirm_rollback_title(),
			message: m.confirm_rollback_message(),
			confirmLabel: 'Rollback',
			variant: 'warning'
		});
		if (!confirmed) return;
		try {
			await rollbackSnapshot(store.selectedGame.path, snapshotId);
			await selectGame(store.selectedGame);
			await loadSnapshots();
			addToast(m.toast_config_restored(), 'success');
		} catch (e) {
			addToast(`Rollback failed: ${e}`, 'error');
		}
	}

	async function handleDeleteSnapshot(snapshotId: string) {
		if (!store.selectedGame) return;
		const confirmed = await showConfirm({
			title: m.confirm_delete_snapshot_title(),
			message: m.confirm_delete_snapshot_message(),
			confirmLabel: 'Delete',
			variant: 'danger'
		});
		if (!confirmed) return;
		try {
			await deleteSnapshot(store.selectedGame.path, snapshotId);
			if (snapshotPreview?.id === snapshotId) snapshotPreview = null;
			await loadSnapshots();
			addToast(m.toast_snapshot_deleted(), 'success');
		} catch (e) {
			addToast(`Failed to delete snapshot: ${e}`, 'error');
		}
	}

	async function handlePreviewSnapshot(snapshotId: string) {
		if (!store.selectedGame) return;
		if (snapshotPreview?.id === snapshotId) {
			snapshotPreview = null;
			return;
		}
		try {
			const content = await getSnapshot(store.selectedGame.path, snapshotId);
			snapshotPreview = { id: snapshotId, content };
		} catch (e) {
			addToast(`Failed to load snapshot: ${e}`, 'error');
		}
	}

	async function handleRenameSnapshot(snapshotId: string) {
		if (!store.selectedGame || !renameLabel.trim()) return;
		try {
			await renameSnapshot(store.selectedGame.path, snapshotId, renameLabel.trim());
			renamingSnapshotId = null;
			renameLabel = '';
			await loadSnapshots();
		} catch (e) {
			addToast(`Failed to rename snapshot: ${e}`, 'error');
		}
	}

	// Track which game we loaded the file tree for to avoid re-loading
	let lastLoadedGamePath = $state<string | null>(null);

	// LSP bridge (registered once when LSP becomes running)
	let bridge: MonacoLspBridge | null = null;
	let currentEditor: import('monaco-editor').editor.IStandaloneCodeEditor | null = null;

	// File watcher — debounced refresh
	let fsUnlisten: UnlistenFn | null = null;
	let fsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

	// Restore previously open tabs on startup
	onMount(() => {
		restoreSession();
	});

	// Drag & drop file import
	onMount(() => {
		let unlisten: UnlistenFn | null = null;
		const setup = async () => {
			const win = getCurrentWindow();
			unlisten = await win.onDragDropEvent(async (event) => {
				if (event.payload.type === 'enter' || event.payload.type === 'over') {
					fileDragOver = true;
				} else if (event.payload.type === 'drop') {
					fileDragOver = false;
					const paths = event.payload.paths;
					if (paths.length > 0 && store.selectedGame) {
						try {
							const imported = await importFiles(store.selectedGame.path, paths);
							if (imported.length > 0) {
								addToast(m.toast_imported_files({ count: imported.length }), 'success');
								await refreshFileTree(store.selectedGame.path);
								// Open the first imported file
								openTab(imported[0]);
								activeTab = 'files';
							}
						} catch (e) {
							addToast(`Failed to import files: ${e}`, 'error');
						}
					}
				} else {
					fileDragOver = false;
				}
			});
		};
		setup();
		return () => { unlisten?.(); };
	});

	onMount(() => {
		const setupWatcher = async () => {
			fsUnlisten = await onFileChange((event) => {
				// Debounce file tree refresh (500ms)
				if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
				fsRefreshTimer = setTimeout(() => {
					if (store.selectedGame) {
						refreshFileTree(store.selectedGame.path);
					}
				}, 500);

				// Auto-reload open tabs when files are modified externally
				if (event.kind === 'modify' && event.paths) {
					for (const changedPath of event.paths) {
						// Skip files we just saved ourselves
						if (wasRecentlySaved(changedPath)) continue;

						const tab = getTab(changedPath);
						if (tab) {
							if (tab.dirty) {
								// Tab has local changes — ask user
								showConfirm({
									title: m.confirm_file_changed_title(),
									message: m.confirm_file_changed_message({ name: tab.name }),
									confirmLabel: 'Reload',
									variant: 'warning'
								}).then((confirmed) => {
									if (confirmed) reloadTab(changedPath);
								});
							} else {
								// No local changes — reload silently
								reloadTab(changedPath);
							}
						}
					}
				}
			});
		};
		setupWatcher();

		return () => {
			fsUnlisten?.();
			if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
		};
	});

	async function refreshFileTree(gamePath: string) {
		try {
			const newTree = await readFileTree(gamePath);
			fileTree = newTree;
		} catch (e) {
			console.error('Failed to refresh file tree:', e);
		}
		refreshGitStatus(gamePath);
	}

	async function refreshGitStatus(gamePath: string) {
		try {
			const statuses = await gitStatus(gamePath);
			const map = new Map<string, string>();
			for (const s of statuses) map.set(s.path, s.status);
			gitFileStatuses = map;
		} catch {
			gitFileStatuses = new Map();
		}
	}

	// Fetch git diff for the active editor file
	$effect(() => {
		const gamePath = store.selectedGame?.path;
		const filePath = editorStore.activeTabPath;
		if (!gamePath || !filePath) {
			activeFileGitChanges = [];
			return;
		}
		const status = gitFileStatuses.get(filePath);
		if (!status || status === '?') {
			// Untracked or no git status — no diff to show
			activeFileGitChanges = [];
			return;
		}
		gitDiffFile(gamePath, filePath)
			.then((diff) => {
				// Only update if we're still on the same file
				if (editorStore.activeTabPath === filePath) {
					activeFileGitChanges = parseDiffToLineChanges(diff);
				}
			})
			.catch(() => {
				activeFileGitChanges = [];
			});
	});

	// Load recoil table content when recoil tab is selected
	$effect(() => {
		if (activeTab === 'recoil' && store.selectedGame) {
			const gamePath = store.selectedGame.path;
			const path = `${gamePath}/recoiltable.gpc`;
			recoilFilePath = path;
			readFile(path)
				.then((content) => {
					recoilContent = content;
				})
				.catch(() => {
					recoilContent = '';
				});
		}
	});

	// Auto-collapse sidebar when switching to files tab
	$effect(() => {
		if (activeTab === 'files' || activeTab === 'flow') {
			setSidebarCollapsed(true);
		}
	});

	// Load snapshots when history tab is selected
	$effect(() => {
		if (activeTab === 'history' && store.selectedGame) {
			loadSnapshots();
		}
	});

	// Load file tree and start LSP when a game is selected
	$effect(() => {
		const game = store.selectedGame;
		if (game && game.path !== lastLoadedGamePath) {
			lastLoadedGamePath = game.path;
			loadFileTree(game.path);
			buildResult = null;
			buildOutputContent = null;
			closeAllTabs();
			activeTab = 'overview';
			// Dispose old LSP bridge and start LSP for new game
			if (bridge) {
				bridge.dispose();
				bridge = null;
			}
			startLsp(game.path);
			watchDirectory(game.path).catch((e) => console.warn('File watcher setup failed:', e));
			gitIsRepo(game.path).then((v) => (isGitRepo = v)).catch(() => (isGitRepo = false));
		}
	});

	// Register MonacoLspBridge when LSP becomes running
	$effect(() => {
		if (lspStore.status === 'running' && !bridge) {
			initLspBridge();
		} else if (lspStore.status !== 'running' && bridge) {
			bridge.dispose();
			bridge = null;
		}
	});

	async function initLspBridge() {
		const monacoModule = await import('monaco-editor');
		const client = getLspClient();
		if (client) {
			bridge = new MonacoLspBridge(monacoModule, client);
			bridge.registerProviders();
			if (currentEditor) bridge.setEditor(currentEditor);
		}
	}

	function handleEditorReady(editor: import('monaco-editor').editor.IStandaloneCodeEditor) {
		currentEditor = editor;
		if (bridge) bridge.setEditor(editor);

		editor.addAction({
			id: 'gpc.lsp.restart',
			label: 'GPC: Restart Language Server',
			run: () => {
				restartLsp();
			}
		});

		editor.addAction({
			id: 'gpc.lsp.stop',
			label: 'GPC: Stop Language Server',
			run: () => {
				stopLsp();
			}
		});
	}

	async function loadFileTree(gamePath: string) {
		try {
			fileTree = await readFileTree(gamePath);
			// Auto-expand all top-level directories
			expandedDirs = new Set(fileTree.filter((e) => e.is_dir).map((e) => e.path));
		} catch (e) {
			console.error('Failed to load file tree:', e);
		}
	}

	function getWorkspaceForGame(gamePath: string): string | undefined {
		return settings.workspaces.find((ws) => gamePath.startsWith(ws));
	}

	async function handleBuild() {
		await executeBuild();
	}

	async function executeBuild() {
		if (!store.selectedGame) return;
		building = true;
		try {
			const gamePath = store.selectedGame.path;
			const workspacePath = getWorkspaceForGame(gamePath);

			// For flow-based games, generate main.gpc from the flow project before building
			if (store.selectedGame.generation_mode === 'flow') {
				const flowProject = await loadFlowProject(gamePath);
				if (flowProject) {
					const { code: gpcCode, extraFiles } = generateMergedFlowGpc(flowProject);
					await writeFile(gamePath + '/main.gpc', gpcCode);
					for (const [fileName, content] of Object.entries(extraFiles)) {
						if (fileName === 'recoiltable.gpc') {
							try {
								const existing = await readFile(gamePath + '/' + fileName);
								const names = parseWeaponNames(gpcCode);
								await writeFile(gamePath + '/' + fileName, mergeRecoilTable(existing, names));
							} catch {
								await writeFile(gamePath + '/' + fileName, content);
							}
						} else {
							try { await readFile(gamePath + '/' + fileName); } catch {
								await writeFile(gamePath + '/' + fileName, content);
							}
						}
					}
				}
			}

			buildResult = await buildGame(gamePath, workspacePath);
			if (buildResult.success && buildResult.output_path) {
				const fileName = buildResult.output_path.split('/').pop() || 'output';
				addToast(`Build succeeded: ${fileName}`, 'success');
				buildOutputLoading = true;
				try {
					buildOutputContent = await readFile(buildResult.output_path);
				} catch {
					buildOutputContent = null;
				} finally {
					buildOutputLoading = false;
				}
			} else if (!buildResult.success) {
				addToast(`Build failed with ${buildResult.errors.length} error(s)`, 'error');
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			addToast(`Build error: ${msg}`, 'error');
			buildResult = {
				output_path: '',
				success: false,
				errors: [msg],
				warnings: []
			};
		} finally {
			building = false;
		}
	}

	function handleFileClick(path: string) {
		openTab(path);
	}

	async function handleDeleteFile(e: MouseEvent, path: string) {
		e.stopPropagation();

		if (
			!(await showConfirm({
				title: 'Delete File',
				message: `Are you sure you want to delete ${path.split('/').pop()}?`,
				confirmLabel: 'Delete',
				variant: 'danger'
			}))
		) {
			return;
		}

		try {
			await deleteFile(path);
			addToast('File deleted successfully', 'success');
			if (store.selectedGame) {
				await loadFileTree(store.selectedGame.path);
			}
			closeTab(path);
		} catch (e) {
			addToast(`Failed to delete file: ${e}`, 'error');
		}
	}

	async function handleDeleteGameFromDashboard(
		e: MouseEvent,
		game: import('$lib/types/config').GameSummary
	) {
		e.stopPropagation();
		if (
			!(await showConfirm({
				title: 'Delete Game',
				message: `Delete "${game.name}"? This will permanently delete all files in the game directory.`,
				confirmLabel: 'Delete',
				variant: 'danger'
			}))
		) {
			return;
		}
		try {
			await deleteGame(game.path);
			const flowStore = getFlowStore();
			if (flowStore.gamePath === game.path) {
				closeGraph();
			}
			if (store.selectedGame?.path === game.path) {
				clearSelection();
			}
			await loadGames(settings.workspaces);
			addToast(`Game "${game.name}" deleted`, 'success');
		} catch (e) {
			addToast(`Failed to delete game: ${e}`, 'error');
		}
	}

	function toggleDir(path: string) {
		const next = new Set(expandedDirs);
		if (next.has(path)) {
			next.delete(path);
		} else {
			next.add(path);
		}
		expandedDirs = next;
	}

	let editorComponent = $state<MonacoEditor>();
	let editorPanelComponent = $state<EditorPanel>();

	// Handle return from spray tool — apply updated values
	onMount(() => {
		const transfer = getRecoilTransfer();
		if (transfer?.returnTo) {
			const filePath = transfer.returnTo;
			const weaponIndex = transfer.weaponIndex;
			const newValues = transfer.values;
			clearRecoilTransfer();

			// If returning to recoiltable.gpc and the recoil tab is available, use it
			if (filePath.endsWith('recoiltable.gpc') && hasAntirecoilTimeline) {
				readFile(filePath).then((content) => {
					const entries = parseRecoilTable(content);
					const updated = updateWeaponValues(entries, weaponIndex, newValues);
					const newContent = serializeRecoilTable(content, updated);
					writeFile(filePath, newContent);
					recoilContent = newContent;
					recoilFilePath = filePath;
					activeTab = 'recoil';
					addToast(`Applied recoil values for weapon #${weaponIndex}`, 'success');
				});
			} else {
				openTab(filePath).then(() => {
					activeTab = 'files';
					const tab = editorStore.tabs.find((t) => t.path === filePath);
					if (tab) {
						const entries = parseRecoilTable(tab.content);
						const updated = updateWeaponValues(entries, weaponIndex, newValues);
						const newContent = serializeRecoilTable(tab.content, updated);
						updateTabContent(filePath, newContent);
						addToast(`Applied recoil values for weapon #${weaponIndex}`, 'success');
					}
				});
			}
		}

		// Handle return from keyboard mapper tool — apply updated mappings
		const kbTransfer = getKeyboardTransfer();
		if (kbTransfer?.returnTo) {
			const filePath = kbTransfer.returnTo;
			const newMappings = kbTransfer.mappings;
			clearKeyboardTransfer();

			openTab(filePath).then(() => {
				activeTab = 'files';
				const tab = editorStore.tabs.find((t) => t.path === filePath);
				if (tab) {
					const newContent = serializeKeyboardMappings(tab.content, newMappings);
					updateTabContent(filePath, newContent);
					addToast(`Applied ${newMappings.length} keyboard mapping(s)`, 'success');
				}
			});
		}

		// Handle return from OLED editor or keyboard mapper with flow data — switch to flow tab
		if (getFlowOledTransfer() || getKeyboardTransfer()?.nodeId) {
			activeTab = 'flow';
		}

		// Handle return from combo editor — create flow node(s) or write GPC file
		const comboTransfer = getComboTransfer();
		if (comboTransfer?.returnTo && store.selectedGame?.path === comboTransfer.returnTo) {
			clearComboTransfer();

			if (comboTransfer.createNodes && comboTransfer.nodeEntries?.length && flowStore.project) {
				// Create gameplay flow node(s)
				switchFlow('gameplay');
				const entries = comboTransfer.nodeEntries;
				let count = 0;
				for (const entry of entries) {
					const nodeCount = flowStore.graph?.nodes.length ?? 0;
					const x = -flowStore.canvas.panX + 300 + ((nodeCount + count) % 4) * 260;
					const y = -flowStore.canvas.panY + 200 + Math.floor((nodeCount + count) / 4) * 140;
					const created = addNode('custom', { x, y });
					if (created) {
						updateNode(created.id, {
							label: entry.name,
							comboCode: entry.gpcCode,
						});
					}
					count++;
				}
				activeTab = 'flow';
				const plural = entries.length > 1 ? `${entries.length} nodes` : 'node';
				addToast(`Combo ${plural} added to gameplay flow`, 'success');
			} else {
				// Legacy: write as .gpc file
				const fileName = `${comboTransfer.comboName}.gpc`;
				const filePath = `${comboTransfer.returnTo}/${fileName}`;

				import('$lib/tauri/commands').then(async ({ writeFile }) => {
					const header = `// ${fileName}\n// Generated by Combo Maker\n\n`;
					await writeFile(filePath, header + comboTransfer.gpcCode);
					await loadFileTree(comboTransfer.returnTo!);
					openTab(filePath).then(() => {
						activeTab = 'files';
					});
					addToast(`Combo "${comboTransfer.comboName}" added to game`, 'success');
				}).catch((e) => {
					addToast(`Failed to write combo: ${e}`, 'error');
				});
			}
		}
	});

	async function handleExportZip() {
		if (!store.selectedGame) return;
		const gameName = store.selectedGame.name;
		const outputPath = await saveDialog({
			title: 'Export Game',
			defaultPath: `${gameName}.zforge`,
			filters: [{ name: 'Zen Forge Archive', extensions: ['zforge'] }]
		});
		if (!outputPath) return;
		try {
			await exportGameZip(store.selectedGame.path, outputPath);
			addToast(`Exported "${gameName}" to ${outputPath.split('/').pop()}`, 'success');
		} catch (e) {
			addToast(`Export failed: ${e}`, 'error');
		}
	}

	async function handleImportZip() {
		const zipPath = await openDialog({
			title: 'Import Game',
			filters: [{ name: 'Zen Forge Archive', extensions: ['zforge', 'zip'] }],
			multiple: false
		});
		if (!zipPath) return;
		const workspace = settings.workspaces[0];
		if (!workspace) {
			addToast('No workspace configured', 'error');
			return;
		}
		try {
			const gamePath = await importGameZip(zipPath as string, workspace);
			addToast(`Imported game to ${gamePath.split('/').pop()}`, 'success');
			await loadGames(settings.workspaces);
		} catch (e) {
			addToast(`Import failed: ${e}`, 'error');
		}
	}

	async function handleBuildErrorClick(error: string) {
		const link = parseBuildErrorLink(error);
		if (!link) return;

		activeTab = 'files';
		if (link.line !== undefined) {
			if (editorStore.activeTabPath === link.path) {
				editorComponent?.revealLine(link.line);
			} else {
				await openTabAtLine(link.path, link.line);
			}
		} else {
			await openTab(link.path);
		}
	}

	async function handleOpenExternal() {
		if (!currentEditorTab) return;
		try {
			await openInDefaultApp(currentEditorTab.path);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			addToast(`Failed to open external editor: ${msg}`, 'error');
		}
	}

	async function handleCopyBuildOutput() {
		if (!buildOutputContent) return;
		try {
			await navigator.clipboard.writeText(buildOutputContent);
			addToast(m.toast_build_output_copied(), 'success');
		} catch {
			addToast('Failed to copy to clipboard', 'error');
		}
	}

	async function handleSendToZenStudio() {
		if (!buildResult?.output_path) return;
		sendingToZenStudio = true;
		try {
			const serverUrl = await startFileServer(buildResult.output_path);
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

	function handleKeydown(e: KeyboardEvent) {
		if (matchesCombo(e, getKeyCombo('save'))) {
			e.preventDefault();
			saveTab();
		} else if (matchesCombo(e, getKeyCombo('build'))) {
			e.preventDefault();
			activeTab = 'build';
			handleBuild();
		} else if (matchesCombo(e, getKeyCombo('toggleBottomPanel'))) {
			e.preventDefault();
			toggleBottomPanel();
		} else if (matchesCombo(e, getKeyCombo('globalSearch'))) {
			e.preventDefault();
			setBottomPanelActiveTab('search');
			setBottomPanelOpen(true);
		} else if (matchesCombo(e, getKeyCombo('commandPalette'))) {
			e.preventDefault();
			showCommandPalette = !showCommandPalette;
		}
	}

	// Watch for file navigation requests from the bottom panel (Problems/Search tabs)
	$effect(() => {
		const nav = consumeFileNavigation();
		if (nav && store.selectedGame) {
			activeTab = 'files';
			if (editorStore.activeTabPath === nav.path) {
				editorComponent?.revealLine(nav.line);
			} else {
				openTabAtLine(nav.path, nav.line);
			}
		}
	});

	function handleCloseTab(e: MouseEvent, path: string) {
		e.stopPropagation();
		closeTab(path);
	}

</script>

<svelte:window onkeydown={handleKeydown} />

{#if store.selectedGame && (store.selectedMeta || store.selectedConfig)}
	<!-- Game Detail View -->
	{@const gameVersion = store.selectedMeta?.version ?? store.selectedConfig?.version ?? 0}
	{@const isFlowGame = store.selectedGame.generation_mode === 'flow'}
	<div class="flex h-full flex-col overflow-hidden">
		<div class="shrink-0 px-4 pt-3">
			<div class="mb-4 flex items-center justify-between">
				<div>
					<h1 class="text-2xl font-bold text-zinc-100">{store.selectedGame.name}</h1>
					<p class="text-sm text-zinc-400">
						{store.selectedGame.console_type.toUpperCase()} &middot; {store.selectedGame.game_type.toUpperCase()}
						{#if !isFlowGame}
							<span class="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">Legacy</span>
						{/if}
					</p>
				</div>
				<div class="flex items-center gap-2">
					{#if store.selectedGame.game_type}
						<span
							class="rounded bg-emerald-900/50 px-2 py-1 text-xs font-medium text-emerald-400 uppercase"
						>
							{store.selectedGame.game_type}
						</span>
					{/if}
					<span
						class="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400"
					>
						v{gameVersion}
					</span>
				</div>
			</div>

			<!-- Tab Bar -->
			<div class="mb-4 flex gap-1 border-b border-zinc-800">
			{#each gameTabs as tab}
				<button
					class="border-b-2 px-4 py-2 text-sm font-medium transition-colors"
					class:border-emerald-400={activeTab === tab}
					class:text-emerald-400={activeTab === tab}
					class:border-transparent={activeTab !== tab}
					class:text-zinc-400={activeTab !== tab}
					class:hover:text-zinc-200={activeTab !== tab}
					onclick={() => (activeTab = tab as typeof activeTab)}
				>
					{{ overview: m.page_tab_overview(), files: m.page_tab_files(), flow: m.page_tab_flow(), build: m.page_tab_build(), history: m.page_tab_history(), git: m.page_tab_git(), recoil: 'Recoil', persistence: m.page_tab_persistence(), defaults: m.page_tab_defaults() }[tab]}
					{#if tab === 'build' && buildResult}
						<span
							class="ml-1 inline-block h-2 w-2 rounded-full"
							class:bg-emerald-400={buildResult.success}
							class:bg-red-400={!buildResult.success}
						></span>
					{/if}
				</button>
			{/each}
			</div>
		</div>

		{#if activeTab === 'files'}
			<!-- File Browser - Full Width -->
			<div class="flex min-h-0 flex-1 gap-0">
				<FileTreePanel
					{fileTree}
					{expandedDirs}
					activeFilePath={editorStore.activeTabPath}
					{themeAccent}
					gamePath={store.selectedGame?.path ?? ''}
					{fileSeverities}
					{gitFileStatuses}
					dragOver={fileDragOver}
					onToggleDir={toggleDir}
					onFileClick={handleFileClick}
					onDeleteFile={handleDeleteFile}
					onNewFile={() => (showNewFileModal = true)}
					onImportTemplate={() => (showTemplateImportModal = true)}
				/>

				<EditorPanel
					bind:this={editorPanelComponent}
					currentTab={currentEditorTab}
					gamePath={store.selectedGame?.path ?? ''}
					consoleType={gameConsoleType}
					{themeAccent}
					gitChanges={activeFileGitChanges}
					onCloseTab={handleCloseTab}
					onContentChange={(path, content) => updateTabContent(path, content)}
					onEditorReady={handleEditorReady}
					onOpenExternal={handleOpenExternal}
					bind:editorComponent
				/>
			</div>
		{:else if activeTab === 'flow'}
			<FlowEditor />
		{:else}
			<div class="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
				<div class="mx-auto max-w-5xl">
					{#if activeTab === 'overview'}
						<GameOverviewPanel
							game={store.selectedGame}
							meta={store.selectedMeta}
							config={store.selectedConfig}
							onTagsChanged={async () => { await loadGames(settings.workspaces); }}
							onMetaChanged={async () => { await loadGames(settings.workspaces); if (store.selectedGame) await selectGame(store.selectedGame); }}
							onSaveAsTemplate={() => (showSaveTemplateModal = true)}
							onExportZip={handleExportZip}
						/>
					{:else if activeTab === 'build'}
						<BuildPanel
							{buildResult}
							{buildOutputContent}
							{buildOutputLoading}
							{building}
							{sendingToZenStudio}
							onBuild={handleBuild}
							onBuildErrorClick={handleBuildErrorClick}
							onCopyBuildOutput={handleCopyBuildOutput}
							onSendToZenStudio={handleSendToZenStudio}
						/>
						<div class="mt-4">
							<TaskRunnerPanel gamePath={store.selectedGame?.path ?? ''} />
						</div>
					{:else if activeTab === 'history'}
						<HistoryPanel
							{snapshots}
							{snapshotsLoading}
							{snapshotPreview}
							{renamingSnapshotId}
							{renameLabel}
							gamePath={store.selectedGame?.path ?? ''}
							currentConfigContent={editorStore.tabs.find(t => t.path.endsWith('config.toml'))?.content ?? ''}
							onCreateSnapshot={handleCreateSnapshot}
							onPreviewSnapshot={handlePreviewSnapshot}
							onRollback={handleRollback}
							onDeleteSnapshot={handleDeleteSnapshot}
							onStartRename={(id, label) => {
								renamingSnapshotId = id;
								renameLabel = label;
							}}
							onCancelRename={() => (renamingSnapshotId = null)}
							onRenameSnapshot={handleRenameSnapshot}
							onRenameLabelChange={(v) => (renameLabel = v)}
						/>
					{:else if activeTab === 'recoil'}
						{#if recoilContent !== null}
							<RecoilTableEditor
								content={recoilContent}
								gamePath={store.selectedGame?.path ?? ''}
								filePath={recoilFilePath ?? undefined}
								onchange={async (newContent) => {
									recoilContent = newContent;
									if (recoilFilePath) {
										await writeFile(recoilFilePath, newContent);
										addToast('Recoil table saved', 'success');
									}
								}}
							/>
						{:else}
							<div class="flex h-64 items-center justify-center text-sm text-zinc-500">
								Loading recoil table...
							</div>
						{/if}
					{:else if activeTab === 'defaults'}
						{#if cachedFlowProject}
							<FlowDefaultsPanel
								project={cachedFlowProject}
								weaponNames={cachedWeaponNames}
								onUpdateDefault={updateVariableDefault}
								onUpdateProfileOverride={(profileId, varName, value) => {
									const profile = (cachedFlowProject?.profiles ?? []).find((p) => p.id === profileId);
									if (!profile) return;
									const overrides = { ...profile.variableOverrides };
									if (value === undefined) {
										delete overrides[varName];
									} else {
										overrides[varName] = value;
									}
									updateProfile(profileId, { variableOverrides: overrides });
								}}
								onUpdateWeaponOverride={updateWeaponOverride}
							/>
						{/if}
					{:else if activeTab === 'persistence'}
						{#if cachedFlowProject}
							<FlowPersistencePanel project={cachedFlowProject} />
						{/if}
					{:else if activeTab === 'git'}
						<GitPanel
							gamePath={store.selectedGame?.path ?? ''}
							{isGitRepo}
							onCommitted={async () => {
								if (store.selectedGame) {
									await refreshFileTree(store.selectedGame.path);
								}
							}}
							onRepoInit={async () => {
								isGitRepo = true;
							}}
						/>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{:else}
	<DashboardView
		games={store.games}
		{workspaceGrouped}
		{recent}
		loading={store.loading}
		error={store.error}
		onSelectGame={selectGame}
		onDeleteGame={handleDeleteGameFromDashboard}
	/>
{/if}

<!-- Modals -->
{#if store.selectedGame}
	<NewFileModal
		open={showNewFileModal}
		gamePath={store.selectedGame.path}
		onclose={() => (showNewFileModal = false)}
		onsuccess={async (filePath) => {
			if (store.selectedGame) {
				await loadFileTree(store.selectedGame.path);
				openTab(filePath);
			}
		}}
	/>

	<TemplateImportModal
		open={showTemplateImportModal}
		gamePath={store.selectedGame?.path ?? null}
		onclose={() => (showTemplateImportModal = false)}
		onimport={async () => {
			if (store.selectedGame) {
				await loadFileTree(store.selectedGame.path);
			}
		}}
	/>

	<SaveTemplateModal
		open={showSaveTemplateModal}
		gamePath={store.selectedGame.path}
		gameName={store.selectedGame.name}
		onclose={() => (showSaveTemplateModal = false)}
	/>
{/if}

<ConfirmDialog
	open={confirmDialog.open}
	title={confirmDialog.title}
	message={confirmDialog.message}
	confirmLabel={confirmDialog.confirmLabel}
	variant={confirmDialog.variant}
	onconfirm={confirmDialog.onconfirm}
	oncancel={confirmDialogCancel}
/>

<CommandPalette
	open={showCommandPalette}
	commands={paletteCommands}
	onclose={() => { showCommandPalette = false; }}
/>

