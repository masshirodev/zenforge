import { invoke } from '@tauri-apps/api/core';
import type { GameConfig, GameSummary, GameMeta } from '$lib/types/config';
import type { ModuleSummary, ModuleDefinition } from '$lib/types/module';

export async function listGames(workspacePaths?: string[]): Promise<GameSummary[]> {
	return invoke<GameSummary[]>('list_games', { workspacePaths: workspacePaths ?? null });
}

export async function getGameConfig(gamePath: string): Promise<GameConfig> {
	return invoke<GameConfig>('get_game_config', { gamePath });
}

export async function getAppRoot(): Promise<string> {
	return invoke<string>('get_app_root');
}

export async function deleteGame(gamePath: string): Promise<void> {
	return invoke<void>('delete_game', { gamePath });
}

export async function listModules(moduleType?: string, workspacePaths?: string[]): Promise<ModuleSummary[]> {
	return invoke<ModuleSummary[]>('list_modules', {
		moduleType: moduleType ?? null,
		workspacePaths: workspacePaths ?? null
	});
}

export async function listAvailableModules(gamePath: string, workspacePaths?: string[]): Promise<ModuleSummary[]> {
	return invoke<ModuleSummary[]>('list_available_modules', {
		gamePath,
		workspacePaths: workspacePaths ?? null
	});
}

export async function getModule(moduleId: string, workspacePaths?: string[]): Promise<ModuleDefinition> {
	return invoke<ModuleDefinition>('get_module', {
		moduleId,
		workspacePaths: workspacePaths ?? null
	});
}

export async function validateModuleSelection(moduleIds: string[], workspacePaths?: string[]): Promise<string[]> {
	return invoke<string[]>('validate_module_selection', {
		moduleIds,
		workspacePaths: workspacePaths ?? null
	});
}

// === User Module Commands ===

export async function saveUserModule(
	workspacePath: string,
	moduleDef: ModuleDefinition
): Promise<string> {
	return invoke<string>('save_user_module', { workspacePath, moduleDef });
}

export async function exportModuleToml(
	moduleId: string,
	workspacePaths?: string[]
): Promise<string | null> {
	return invoke<string | null>('export_module_toml', {
		moduleId,
		workspacePaths: workspacePaths ?? null
	});
}

export async function importModuleToml(workspacePath: string): Promise<string | null> {
	return invoke<string | null>('import_module_toml', { workspacePath });
}

export async function deleteUserModule(moduleId: string, workspacePaths?: string[]): Promise<void> {
	return invoke<void>('delete_user_module', {
		moduleId,
		workspacePaths: workspacePaths ?? null
	});
}

export interface CreateGameParams {
	name: string;
	display_name?: string;
	username?: string;
	game_type: string;
	console_type?: string;
	version: number;
	workspace_path?: string;
	header_comments?: string;
}

export interface CreateGameResult {
	game_path: string;
	files_created: string[];
}

export async function createGame(params: CreateGameParams): Promise<CreateGameResult> {
	return invoke<CreateGameResult>('create_game', { params });
}

// === Build Commands ===

export interface BuildResult {
	output_path: string;
	success: boolean;
	errors: string[];
	warnings: string[];
}

export async function buildGame(gamePath: string, workspacePath?: string): Promise<BuildResult> {
	return invoke<BuildResult>('build_game_cmd', {
		gamePath,
		workspacePath: workspacePath ?? null
	});
}

export async function getBuildOutputPath(gamePath: string, workspacePath?: string): Promise<string> {
	return invoke<string>('get_build_output_path', {
		gamePath,
		workspacePath: workspacePath ?? null
	});
}

// === Config Commands ===

export async function saveGameConfig(gamePath: string, config: GameConfig): Promise<void> {
	return invoke<void>('save_game_config', { gamePath, config });
}

// === File Commands ===

export async function readFile(path: string): Promise<string> {
	return invoke<string>('read_file', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
	return invoke<void>('write_file', { path, content });
}

export async function readBytes(path: string): Promise<number[]> {
	return invoke<number[]>('read_bytes', { path });
}

export async function writeBytes(path: string, data: number[]): Promise<void> {
	return invoke<void>('write_bytes', { path, data });
}

export async function importFiles(gamePath: string, filePaths: string[]): Promise<string[]> {
	return invoke<string[]>('import_files', { gamePath, filePaths });
}

// === Export / Import ===

export async function exportGameZip(gamePath: string, outputPath: string): Promise<string> {
	return invoke<string>('export_game_zip', { gamePath, outputPath });
}

export async function importGameZip(zipPath: string, workspacePath: string): Promise<string> {
	return invoke<string>('import_game_zip', { zipPath, workspacePath });
}

// === Task Runner ===

export interface TaskResult {
	success: boolean;
	exit_code: number;
	stdout: string;
	stderr: string;
}

export async function runTask(gamePath: string, command: string): Promise<TaskResult> {
	return invoke<TaskResult>('run_task', { gamePath, command });
}

// === Git Commands ===

export interface GitFileStatus {
	path: string;
	status: string; // "M" | "A" | "D" | "?" | "R"
}

export async function gitIsRepo(gamePath: string): Promise<boolean> {
	return invoke<boolean>('git_is_repo', { gamePath });
}

export async function gitStatus(gamePath: string): Promise<GitFileStatus[]> {
	return invoke<GitFileStatus[]>('git_status', { gamePath });
}

export async function gitDiffFile(gamePath: string, filePath: string): Promise<string> {
	return invoke<string>('git_diff_file', { gamePath, filePath });
}

export async function gitStage(gamePath: string, filePaths: string[]): Promise<void> {
	return invoke<void>('git_stage', { gamePath, filePaths });
}

export async function gitUnstage(gamePath: string, filePaths: string[]): Promise<void> {
	return invoke<void>('git_unstage', { gamePath, filePaths });
}

export async function gitCommit(gamePath: string, message: string): Promise<string> {
	return invoke<string>('git_commit', { gamePath, message });
}

export interface GitDetailedStatus {
	path: string;
	index_status: string;
	worktree_status: string;
}

export async function gitStatusDetailed(gamePath: string): Promise<GitDetailedStatus[]> {
	return invoke<GitDetailedStatus[]>('git_status_detailed', { gamePath });
}

export async function gitInit(gamePath: string): Promise<string> {
	return invoke<string>('git_init', { gamePath });
}

export interface GitRemote {
	name: string;
	url: string;
}

export async function gitRemoteList(gamePath: string): Promise<GitRemote[]> {
	return invoke<GitRemote[]>('git_remote_list', { gamePath });
}

export async function gitRemoteAdd(gamePath: string, name: string, url: string): Promise<void> {
	return invoke<void>('git_remote_add', { gamePath, name, url });
}

export async function gitRemoteRemove(gamePath: string, name: string): Promise<void> {
	return invoke<void>('git_remote_remove', { gamePath, name });
}

export async function gitCurrentBranch(gamePath: string): Promise<string> {
	return invoke<string>('git_current_branch', { gamePath });
}

export async function gitPush(
	gamePath: string,
	remote: string,
	branch: string,
	setUpstream: boolean = false
): Promise<string> {
	return invoke<string>('git_push', { gamePath, remote, branch, setUpstream });
}

export async function gitPull(gamePath: string, remote: string, branch: string): Promise<string> {
	return invoke<string>('git_pull', { gamePath, remote, branch });
}

export interface FileTreeEntry {
	name: string;
	path: string;
	is_dir: boolean;
	children?: FileTreeEntry[];
}

export async function readFileTree(path: string): Promise<FileTreeEntry[]> {
	return invoke<FileTreeEntry[]>('read_file_tree', { path });
}

export async function createStandaloneFile(gamePath: string, filename: string): Promise<string> {
	return invoke<string>('create_standalone_file', { gamePath, filename });
}

export async function deleteFile(filePath: string): Promise<void> {
	return invoke<void>('delete_file', { filePath });
}

// === Game Meta Commands ===

export async function saveGameMeta(gamePath: string, meta: GameMeta): Promise<void> {
	return invoke<void>('save_game_meta', { gamePath, meta });
}

export async function loadGameMeta(gamePath: string): Promise<GameMeta | null> {
	return invoke<GameMeta | null>('load_game_meta', { gamePath });
}


// === File Watcher Commands ===

export async function watchDirectory(path: string): Promise<void> {
	return invoke<void>('watch_directory', { path });
}

export async function watchWorkspaces(paths: string[]): Promise<void> {
	return invoke<void>('watch_workspaces', { paths });
}

export async function unwatchDirectory(): Promise<void> {
	return invoke<void>('unwatch_directory');
}

// === Workspace Commands ===

export async function pickWorkspaceDirectory(): Promise<string | null> {
	return invoke<string | null>('pick_workspace_directory');
}

export async function getDefaultWorkspace(): Promise<string> {
	return invoke<string>('get_default_workspace');
}

// === Template Commands ===

export interface TemplateFile {
	name: string;
	path: string;
	category: string;
	description: string;
	size: number;
}

export async function listTemplates(): Promise<TemplateFile[]> {
	return invoke<TemplateFile[]>('list_templates');
}

export async function readTemplate(templatePath: string): Promise<string> {
	return invoke<string>('read_template', { templatePath });
}

export async function importTemplate(
	gamePath: string,
	templatePath: string,
	targetFilename?: string
): Promise<string> {
	return invoke<string>('import_template', {
		gamePath,
		templatePath,
		targetFilename: targetFilename ?? null
	});
}

// === Project Template Commands ===

export interface ProjectTemplateMeta {
	name: string;
	description: string;
	game_type: string;
	console_type: string;
	created_at: number;
}

export interface ProjectTemplateInfo {
	id: string;
	path: string;
	meta: ProjectTemplateMeta;
	file_count: number;
}

export async function saveProjectTemplate(
	gamePath: string,
	workspacePath: string,
	name: string,
	description: string
): Promise<ProjectTemplateInfo> {
	return invoke<ProjectTemplateInfo>('save_project_template', {
		gamePath,
		workspacePath,
		name,
		description
	});
}

export async function listProjectTemplates(workspacePaths: string[]): Promise<ProjectTemplateInfo[]> {
	return invoke<ProjectTemplateInfo[]>('list_project_templates', { workspacePaths });
}

export async function createGameFromTemplate(
	templatePath: string,
	gameName: string,
	workspacePath: string
): Promise<string> {
	return invoke<string>('create_game_from_template', {
		templatePath,
		gameName,
		workspacePath
	});
}

export async function deleteProjectTemplate(templatePath: string): Promise<void> {
	return invoke<void>('delete_project_template', { templatePath });
}

// === Search Commands ===

export interface SearchMatch {
	line_number: number;
	line_content: string;
	match_start: number;
	match_end: number;
}

export interface SearchFileResult {
	path: string;
	matches: SearchMatch[];
}

export async function searchInFiles(
	directory: string,
	query: string,
	caseSensitive: boolean,
	useRegex: boolean
): Promise<SearchFileResult[]> {
	return invoke<SearchFileResult[]>('search_in_files', {
		directory,
		query,
		caseSensitive,
		useRegex
	});
}

export async function replaceInFile(
	path: string,
	query: string,
	replacement: string,
	caseSensitive: boolean,
	useRegex: boolean
): Promise<number> {
	return invoke<number>('replace_in_file', {
		path,
		query,
		replacement,
		caseSensitive,
		useRegex
	});
}

// === Plugin Commands ===

export interface PluginHooks {
	pre_build?: string;
	post_build?: string;
	includes?: string[];
	extra_vars?: Record<string, string>;
	extra_defines?: Record<string, string>;
}

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	description?: string;
	author?: string;
	homepage?: string;
	hooks: PluginHooks;
}

export interface PluginInfo {
	manifest: PluginManifest;
	path: string;
	enabled: boolean;
}

export async function listPlugins(workspacePaths?: string[]): Promise<PluginInfo[]> {
	return invoke<PluginInfo[]>('list_plugins', { workspacePaths: workspacePaths ?? null });
}

export async function togglePlugin(workspacePath: string, pluginId: string, enabled: boolean): Promise<void> {
	return invoke<void>('toggle_plugin', { workspacePath, pluginId, enabled });
}

export async function readPluginFile(pluginPath: string, fileName: string): Promise<string> {
	return invoke<string>('read_plugin_file', { pluginPath, fileName });
}

export async function createPlugin(
	workspacePath: string,
	pluginId: string,
	pluginName: string,
	description?: string
): Promise<string> {
	return invoke<string>('create_plugin', {
		workspacePath,
		pluginId,
		pluginName,
		description: description ?? null
	});
}

export async function deletePlugin(pluginPath: string): Promise<void> {
	return invoke<void>('delete_plugin', { pluginPath });
}

// === History Commands ===

export interface SnapshotMeta {
	id: string;
	timestamp: number;
	label: string | null;
}

export async function createSnapshot(gamePath: string, label?: string): Promise<SnapshotMeta> {
	return invoke<SnapshotMeta>('create_snapshot', { gamePath, label: label ?? null });
}

export async function listSnapshots(gamePath: string): Promise<SnapshotMeta[]> {
	return invoke<SnapshotMeta[]>('list_snapshots', { gamePath });
}

export async function getSnapshot(gamePath: string, snapshotId: string): Promise<string> {
	return invoke<string>('get_snapshot', { gamePath, snapshotId });
}

export async function rollbackSnapshot(gamePath: string, snapshotId: string): Promise<SnapshotMeta> {
	return invoke<SnapshotMeta>('rollback_snapshot', { gamePath, snapshotId });
}

export async function deleteSnapshot(gamePath: string, snapshotId: string): Promise<void> {
	return invoke<void>('delete_snapshot', { gamePath, snapshotId });
}

export async function renameSnapshot(gamePath: string, snapshotId: string, label: string): Promise<void> {
	return invoke<void>('rename_snapshot', { gamePath, snapshotId, label });
}

// === Obfuscation Commands ===

export interface ObfuscateStats {
	identifiers_renamed: number;
	comments_removed: number;
	strings_encoded: number;
	dead_code_blocks: number;
	lines_before: number;
	lines_after: number;
}

export interface ObfuscateResult {
	output: string;
	stats: ObfuscateStats;
}

export async function obfuscateGpc(source: string, level: number): Promise<ObfuscateResult> {
	return invoke<ObfuscateResult>('obfuscate_gpc', { source, level });
}

// === Flow Commands ===

import type { FlowGraph, FlowProject, FlowChunk } from '$lib/types/flow';

export async function saveFlowProject(gamePath: string, flowProject: FlowProject): Promise<void> {
	return invoke<void>('save_flow_project', { gamePath, flowProject });
}

export async function loadFlowProject(gamePath: string): Promise<FlowProject | null> {
	return invoke<FlowProject | null>('load_flow_project', { gamePath });
}

export async function saveFlowGraph(gamePath: string, flowGraph: FlowGraph): Promise<void> {
	return invoke<void>('save_flow_graph', { gamePath, flowGraph });
}

export async function loadFlowGraph(gamePath: string): Promise<FlowGraph | null> {
	return invoke<FlowGraph | null>('load_flow_graph', { gamePath });
}

export async function deleteFlowGraph(gamePath: string): Promise<void> {
	return invoke<void>('delete_flow_graph', { gamePath });
}

export async function listChunks(workspacePaths: string[]): Promise<FlowChunk[]> {
	return invoke<FlowChunk[]>('list_chunks', { workspacePaths });
}

export async function saveChunk(workspacePath: string, chunk: FlowChunk): Promise<void> {
	return invoke<void>('save_chunk', { workspacePath, chunk });
}

export async function deleteChunk(workspacePaths: string[], chunkId: string): Promise<void> {
	return invoke<void>('delete_chunk', { workspacePaths, chunkId });
}

export async function getChunk(workspacePaths: string[], chunkId: string): Promise<FlowChunk> {
	return invoke<FlowChunk>('get_chunk', { workspacePaths, chunkId });
}

// === Command Runner ===

export async function runCommand(cwd: string, command: string): Promise<void> {
	return invoke<void>('run_command', { cwd, command });
}

export async function killCommand(): Promise<void> {
	return invoke<void>('kill_command');
}

// === Sprite Collection Commands ===

import type { SpriteCollection, SpriteCollectionSummary } from '$lib/types/sprite';

export async function listSpriteCollections(workspace: string): Promise<SpriteCollectionSummary[]> {
	return invoke<SpriteCollectionSummary[]>('list_sprite_collections', { workspace });
}

export async function readSpriteCollection(workspace: string, id: string): Promise<SpriteCollection> {
	return invoke<SpriteCollection>('read_sprite_collection', { workspace, id });
}

export async function saveSpriteCollection(workspace: string, collection: SpriteCollection): Promise<void> {
	return invoke<void>('save_sprite_collection', { workspace, collection });
}

export async function deleteSpriteCollection(workspace: string, id: string): Promise<void> {
	return invoke<void>('delete_sprite_collection', { workspace, id });
}

// === File Server Commands ===

export async function startFileServer(filePath: string): Promise<string> {
	return invoke<string>('start_file_server', { filePath });
}

export async function stopFileServer(): Promise<void> {
	return invoke<void>('stop_file_server', {});
}

// === Opener Commands ===

export async function openInDefaultApp(path: string): Promise<void> {
	const { openPath } = await import('@tauri-apps/plugin-opener');
	return openPath(path);
}
