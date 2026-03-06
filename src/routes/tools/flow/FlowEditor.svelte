<script lang="ts">
	import FlowCanvas from './FlowCanvas.svelte';
	import FlowToolbar from './FlowToolbar.svelte';
	import FlowPropertyPanel from './FlowPropertyPanel.svelte';
	import ProfilePanel from './ProfilePanel.svelte';
	import ChunkLibrary from './ChunkLibrary.svelte';
	import ChunkSaveModal from './ChunkSaveModal.svelte';
	import FlowEmulator from './FlowEmulator.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import { getSettings } from '$lib/stores/settings.svelte';
	import { getGameStore } from '$lib/stores/game.svelte';
	import {
		getFlowStore,
		getSelectedNode,
		getSelectedEdge,
		getSelectedSubNode,
		getExpandedNodes,
		canUndo,
		canRedo,
		newGraph,
		loadProject,
		closeGraph,
		markClean,
		switchFlow,
		getSyncedProject,
		addNode,
		removeNode,
		removeNodes,
		updateNode,
		moveNode,
		moveNodes,
		moveNodeDone,
		setInitialState,
		duplicateNode,
		removeEdge,
		updateEdge,
		selectNode,
		selectNodeMulti,
		selectNodesBatch,
		selectSubNode,
		selectEdge,
		clearSelection,
		setPan,
		setZoom,
		zoomToFit,
		startConnecting,
		updateConnecting,
		finishConnecting,
		cancelConnecting,
		toggleNodeExpanded,
		addSubNode,
		removeSubNode,
		updateSubNode,
		reorderSubNodes,
		undo,
		redo,
		getProfiles,
		getProfileSwitch,
		addProfile,
		removeProfile,
		updateProfile,
		setProfileSwitch,
	} from '$lib/stores/flow.svelte';
	import { saveFlowProject, loadFlowProject, listModules, getModule, readFile, writeFile, buildGame } from '$lib/tauri/commands';
	import { generateMergedFlowGpc } from '$lib/flow/codegen-merged';
	import { mergeRecoilTable, parseWeaponNames } from '$lib/utils/recoil-parser';
	import { createModuleNode } from '$lib/flow/module-nodes';
	import { getFlowOledTransfer, setFlowOledTransfer, clearFlowOledTransfer } from '$lib/stores/flow-transfer.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { FlowNodeType, FlowChunk, FlowType } from '$lib/types/flow';
	import { createFlowNode } from '$lib/types/flow';
	import type { ModuleSummary } from '$lib/types/module';

	let settingsStore = getSettings();
	let settings = $derived($settingsStore);
	let gameStore = getGameStore();
	let flowStore = getFlowStore();

	let selectedNode = $derived(getSelectedNode());
	let selectedEdge = $derived(getSelectedEdge());
	let selectedSubNode = $derived(getSelectedSubNode());
	let expandedNodes = $derived(getExpandedNodes());
	let hasSelection = $derived(flowStore.selectedNodeIds.length > 0 || flowStore.selectedEdgeId !== null);
	let profiles = $derived(getProfiles());
	let profileSwitchConfig = $derived(getProfileSwitch());
	let perProfileVars = $derived.by(() => {
		if (!flowStore.project) return [];
		const vars: import('$lib/types/flow').FlowVariable[] = [];
		const seen = new Set<string>();
		const addVars = (list: import('$lib/types/flow').FlowVariable[]) => {
			for (const v of list) {
				if (v.perProfile && !seen.has(v.name)) {
					vars.push(v);
					seen.add(v.name);
				}
			}
		};
		addVars(flowStore.project.sharedVariables);
		for (const flow of flowStore.project.flows) {
			addVars(flow.globalVariables);
			for (const node of flow.nodes) {
				addVars(node.variables);
			}
		}
		return vars;
	});
	let showChunkSave = $state(false);
	let showChunkLibrary = $state(true);
	let showRightPanel = $state(true);
	let chunkRefreshKey = $state(0);
	let showEmulator = $state(false);
	let showProfiles = $state(false);
	let availableModules = $state<ModuleSummary[]>([]);
	let building = $state(false);

	let lastLoadedGamePath = $state<string | null>(flowStore.gamePath);

	async function loadFlowForGame(gamePath: string, gameName: string) {
		if (gamePath === lastLoadedGamePath) return;
		lastLoadedGamePath = gamePath;

		// Close existing graph before loading new one
		if (flowStore.project) {
			closeGraph();
		}

		try {
			const project = await loadFlowProject(gamePath);
			if (project) {
				loadProject(project, gamePath);
			}
		} catch {
			// No flow project exists yet
		}
		if (!flowStore.project) {
			newGraph(gameName || 'Untitled Flow', gamePath);
		}
	}

	// Reload flow when selected game changes
	$effect(() => {
		const game = gameStore.selectedGame;
		if (game) {
			loadFlowForGame(game.path, game.name);
		}
	});

	// Load flow project from selected game on mount
	onMount(async () => {
		// Handle return from OLED editor with pixel data
		const transfer = getFlowOledTransfer();
		if (transfer && flowStore.graph) {
			const node = flowStore.graph.nodes.find((n) => n.id === transfer.nodeId);
			if (node) {
				if (transfer.subNodeId) {
					// Apply to pixel-art sub-node
					const sub = node.subNodes.find((s) => s.id === transfer.subNodeId);
					if (sub && sub.type === 'pixel-art') {
						updateSubNode(node.id, sub.id, {
							config: { ...sub.config, scene: { id: transfer.scene.id, name: transfer.scene.name, pixels: transfer.scene.pixels } },
						});
						addToast('Pixel art updated from OLED editor', 'success');
					}
				} else {
					// Apply to node-level oledScene (legacy)
					updateNode(node.id, { oledScene: transfer.scene });
					addToast('OLED scene updated', 'success');
				}
			}
			clearFlowOledTransfer();
		}

		// Load available modules for gameplay flow
		try {
			const workspacePaths = settings.workspaces ?? [];
			availableModules = await listModules(undefined, workspacePaths);
		} catch {
			// Modules not available (e.g. no modules directory)
		}
	});

	// Keyboard shortcuts
	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
		if (showEmulator) return;

		if (e.key === 'Delete' || e.key === 'Backspace') {
			deleteSelected();
		} else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
			e.preventDefault();
			undo();
		} else if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
			e.preventDefault();
			redo();
		} else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			handleSave();
		} else if (e.key === 'Escape') {
			clearSelection();
			cancelConnecting();
		}
	}

	function handleAddNode(type: FlowNodeType) {
		// Place at center of visible area, offset to avoid stacking
		const baseX = -flowStore.canvas.panX + 300;
		const baseY = -flowStore.canvas.panY + 200;
		const nodeCount = flowStore.graph?.nodes.length ?? 0;
		const offsetX = (nodeCount % 4) * 260;
		const offsetY = Math.floor(nodeCount / 4) * 140;
		const node = addNode(type, { x: baseX + offsetX, y: baseY + offsetY });
		if (node) {
			selectNode(node.id);
		}
	}

	async function handleAddModule(moduleId: string) {
		try {
			const workspacePaths = settings.workspaces ?? [];
			const moduleDef = await getModule(moduleId, workspacePaths);
			const nodeCount = flowStore.graph?.nodes.length ?? 0;
			const x = -flowStore.canvas.panX + 300 + (nodeCount % 4) * 260;
			const y = -flowStore.canvas.panY + 200 + Math.floor(nodeCount / 4) * 140;
			const moduleNode = createModuleNode(moduleDef, { x, y });
			if (!flowStore.graph) return;

			// Check for conflicts with existing module nodes
			const existingModules = flowStore.graph.nodes.filter((n) => n.type === 'module' && n.moduleData);
			const newConflicts = moduleNode.moduleData?.conflicts ?? [];
			for (const existing of existingModules) {
				const existId = existing.moduleData!.moduleId;
				const existConflicts = existing.moduleData!.conflicts ?? [];
				if (newConflicts.includes(existId) || existConflicts.includes(moduleId)) {
					addToast(`Warning: ${moduleDef.display_name} conflicts with ${existing.moduleData!.moduleName}`, 'warning');
				}
			}

			// Auto-add weapondata dependency
			if (moduleDef.needs_weapondata && !existingModules.some((n) => n.moduleData!.moduleId === 'weapondata')) {
				try {
					const wdDef = await getModule('weapondata', workspacePaths);
					const wdX = x - 260;
					const wdY = y;
					const wdModuleNode = createModuleNode(wdDef, { x: wdX, y: wdY });
					const wdCreated = addNode('module', { x: wdX, y: wdY });
					if (wdCreated) {
						updateNode(wdCreated.id, {
							label: wdModuleNode.label,
							moduleData: wdModuleNode.moduleData,
							variables: wdModuleNode.variables,
						});
					}
					addToast(`Auto-added Weapon Data (required by ${moduleDef.display_name})`, 'info');
				} catch {
					addToast(`${moduleDef.display_name} requires Weapon Data but it could not be loaded`, 'warning');
				}
			}

			const created = addNode('module', { x, y });
			if (created) {
				updateNode(created.id, {
					label: moduleNode.label,
					moduleData: moduleNode.moduleData,
					variables: moduleNode.variables,
				});
				selectNode(created.id);
			}
		} catch (e) {
			addToast(`Failed to add module: ${e}`, 'error');
		}
	}

	function deleteSelected() {
		if (flowStore.selectedNodeIds.length > 1) {
			removeNodes([...flowStore.selectedNodeIds]);
		} else if (flowStore.selectedNodeId) {
			removeNode(flowStore.selectedNodeId);
		} else if (flowStore.selectedEdgeId) {
			removeEdge(flowStore.selectedEdgeId);
		}
	}

	async function handleSave() {
		const project = getSyncedProject();
		if (!project) return;
		const gamePath = flowStore.gamePath || gameStore.selectedGame?.path;
		if (!gamePath) {
			addToast('No game selected. Select a game first to save the flow graph.', 'warning');
			return;
		}
		try {
			await saveFlowProject(gamePath, project);
			markClean();
			addToast('Flow project saved', 'success');
		} catch (e) {
			addToast(`Failed to save flow project: ${e}`, 'error');
		}
	}

	async function handleLoad() {
		const gamePath = gameStore.selectedGame?.path;
		if (!gamePath) {
			addToast('Select a game first', 'warning');
			return;
		}
		try {
			const project = await loadFlowProject(gamePath);
			if (project) {
				loadProject(project, gamePath);
				addToast('Flow project loaded', 'success');
			} else {
				addToast('No flow project found for this game', 'info');
			}
		} catch (e) {
			addToast(`Failed to load: ${e}`, 'error');
		}
	}

	function handleNewGraph() {
		const name = gameStore.selectedGame?.name || 'Untitled Flow';
		newGraph(name, gameStore.selectedGame?.path);
		addToast('New flow graph created', 'success');
	}

	async function handleBuildToGame() {
		const project = getSyncedProject();
		if (!project) return;

		const gamePath = flowStore.gamePath || gameStore.selectedGame?.path;
		if (!gamePath) {
			addToast('No game selected. Select a game first.', 'warning');
			return;
		}

		building = true;
		try {
			// Save the flow project first
			await saveFlowProject(gamePath, project);
			markClean();

			// Generate the merged GPC code
			const { code: gpcCode, extraFiles } = generateMergedFlowGpc(project);

			// Write main.gpc and any extra files (e.g. recoiltable.gpc)
			await writeFile(gamePath + '/main.gpc', gpcCode);
			for (const [fileName, content] of Object.entries(extraFiles)) {
				if (fileName === 'recoiltable.gpc') {
					// Merge with existing file to preserve user-edited recoil values
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

			// Trigger the build pipeline
			const workspacePath = (settings.workspaces ?? []).find(
				(ws: string) => gamePath.startsWith(ws)
			);
			const result = await buildGame(gamePath, workspacePath);

			if (result.success && result.output_path) {
				const fileName = result.output_path.split('/').pop() || 'output';
				addToast(`Build succeeded: ${fileName}`, 'success');
			} else {
				const errMsg = result.errors.length > 0
					? result.errors.join('; ')
					: 'Unknown build error';
				addToast(`Build failed: ${errMsg}`, 'error');
			}
		} catch (e) {
			addToast(`Build failed: ${e}`, 'error');
		} finally {
			building = false;
		}
	}

	function handleEditOled(nodeId: string) {
		const node = flowStore.graph?.nodes.find((n) => n.id === nodeId);
		if (!node) return;

		// Check if a pixel-art sub-node is selected — use its scene data
		const pixelSubNode = selectedSubNode?.type === 'pixel-art' ? selectedSubNode : null;
		const sceneData = pixelSubNode
			? (pixelSubNode.config.scene as { id?: string; name?: string; pixels: string } | null)
			: null;

		setFlowOledTransfer({
			nodeId,
			subNodeId: pixelSubNode?.id,
			scene: sceneData
				? { id: sceneData.id || crypto.randomUUID(), name: pixelSubNode!.label, pixels: sceneData.pixels }
				: node.oledScene || {
						id: crypto.randomUUID(),
						name: node.label,
						pixels: btoa(String.fromCharCode(...new Uint8Array(1024))),
					},
			returnTo: flowStore.gamePath,
		});
		goto('/tools/oled');
	}

	function handleStartConnect(nodeId: string, port: string, e: MouseEvent, subNodeId?: string) {
		startConnecting(nodeId, port, e.clientX, e.clientY, subNodeId);
	}

	function handleInsertChunk(chunk: FlowChunk) {
		// Snapshot to unwrap Svelte 5 $state proxy — structuredClone fails on proxied objects
		const plain = $state.snapshot(chunk) as FlowChunk;
		const nodeCount = flowStore.graph?.nodes.length ?? 0;
		const x = -flowStore.canvas.panX + 300 + (nodeCount % 4) * 260;
		const y = -flowStore.canvas.panY + 200 + Math.floor(nodeCount / 4) * 140;
		const template = plain.nodeTemplate;
		const node = createFlowNode(
			(template.type as FlowNodeType) || 'custom',
			template.label || chunk.name,
			{ x, y }
		);
		// Apply template properties
		if (template.gpcCode !== undefined) node.gpcCode = template.gpcCode;
		if (template.oledScene !== undefined) node.oledScene = template.oledScene ?? null;
		if (template.oledWidgets) node.oledWidgets = template.oledWidgets;
		if (template.comboCode !== undefined) node.comboCode = template.comboCode;
		if (template.variables) node.variables = structuredClone(template.variables);
		if (template.subNodes) {
			node.subNodes = structuredClone(template.subNodes);
			// Regenerate sub-node IDs to ensure uniqueness
			for (const sub of node.subNodes) {
				sub.id = crypto.randomUUID();
			}
		}
		if (template.stackOffsetX !== undefined) node.stackOffsetX = template.stackOffsetX;
		if (template.stackOffsetY !== undefined) node.stackOffsetY = template.stackOffsetY;
		if (template.onEnter !== undefined) node.onEnter = template.onEnter;
		if (template.onExit !== undefined) node.onExit = template.onExit;
		node.chunkRef = chunk.id;

		if (!flowStore.graph) return;
		const created = addNode(node.type, { x, y });
		if (created) {
			updateNode(created.id, {
				label: node.label,
				gpcCode: node.gpcCode,
				oledScene: node.oledScene,
				oledWidgets: node.oledWidgets,
				comboCode: node.comboCode,
				variables: node.variables,
				subNodes: node.subNodes,
				stackOffsetX: node.stackOffsetX,
				stackOffsetY: node.stackOffsetY,
				onEnter: node.onEnter,
				onExit: node.onExit,
				chunkRef: node.chunkRef,
			});
			selectNode(created.id);
		}
	}

	function handleSaveAsChunk() {
		showChunkSave = true;
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Flow type tabs -->
{#if flowStore.project}
	<div class="flex border-b border-zinc-800 bg-zinc-900/50">
		{#each [{ type: 'menu' as FlowType, label: 'Menu Flow' }, { type: 'gameplay' as FlowType, label: 'Gameplay Flow' }] as tab}
			<button
				class="px-5 py-2 text-sm font-medium transition-colors {flowStore.activeFlowType === tab.type
					? 'border-b-2 border-emerald-500 text-emerald-400'
					: 'text-zinc-500 hover:text-zinc-300'}"
				onclick={() => switchFlow(tab.type)}
			>
				{tab.label}
			</button>
		{/each}
	</div>
{/if}

<!-- Toolbar -->
{#if flowStore.graph}
	<FlowToolbar
		onAddNode={handleAddNode}
		onAddModule={handleAddModule}
		onDeleteSelected={deleteSelected}
		onZoomIn={() => setZoom(flowStore.canvas.zoom * 1.2)}
		onZoomOut={() => setZoom(flowStore.canvas.zoom * 0.8)}
		onZoomFit={zoomToFit}
		onUndo={undo}
		onRedo={redo}
		onSave={handleSave}
		onBuildToGame={handleBuildToGame}
		onNewGraph={handleNewGraph}
		onLoadGraph={handleLoad}
		onEmulator={() => (showEmulator = true)}
		canUndo={canUndo()}
		canRedo={canRedo()}
		{hasSelection}
		dirty={flowStore.dirty}
		{building}
		graphName={flowStore.graph.name}
		flowType={flowStore.activeFlowType}
		{availableModules}
	/>
{/if}

<!-- Main content -->
<div class="flex min-h-0 flex-1">
	{#if flowStore.graph}
		<!-- Left sidebar toggle -->
		<button
			class="flex w-5 shrink-0 items-center justify-center border-r border-zinc-800 bg-zinc-900/80 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
			onclick={() => (showChunkLibrary = !showChunkLibrary)}
			title={showChunkLibrary ? 'Collapse library' : 'Expand library'}
		>
			<svg class="h-3.5 w-3.5 transition-transform {showChunkLibrary ? '' : 'rotate-180'}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
			</svg>
		</button>

		<!-- Chunk Library -->
		{#if showChunkLibrary}
			<ChunkLibrary
				flowType={flowStore.activeFlowType}
				onInsertChunk={handleInsertChunk}
				{availableModules}
				onAddModule={handleAddModule}
				gameType={gameStore.selectedGame?.game_type}
				refreshKey={chunkRefreshKey}
			/>
		{/if}

		<!-- Canvas -->
		<FlowCanvas
			graph={flowStore.graph}
			selectedNodeIds={flowStore.selectedNodeIds}
			selectedEdgeId={flowStore.selectedEdgeId}
			selectedSubNodeId={flowStore.selectedSubNodeId}
			connecting={flowStore.connecting}
			{expandedNodes}
			panX={flowStore.canvas.panX}
			panY={flowStore.canvas.panY}
			zoom={flowStore.canvas.zoom}
			onSelectNode={selectNode}
			onSelectNodeMulti={selectNodeMulti}
			onSelectNodesBatch={selectNodesBatch}
			onSelectEdge={selectEdge}
			onSelectSubNode={selectSubNode}
			onMoveNode={moveNode}
			onMoveNodes={moveNodes}
			onMoveNodeDone={moveNodeDone}
			onStartConnect={handleStartConnect}
			onFinishConnect={finishConnecting}
			onUpdateConnect={(mx, my) => updateConnecting(mx, my)}
			onToggleExpand={toggleNodeExpanded}
			onPan={setPan}
			onZoom={setZoom}
		/>

		<!-- Right sidebar toggle -->
		<button
			class="flex w-5 shrink-0 items-center justify-center border-l border-zinc-800 bg-zinc-900/80 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
			onclick={() => (showRightPanel = !showRightPanel)}
			title={showRightPanel ? 'Collapse properties' : 'Expand properties'}
		>
			<svg class="h-3.5 w-3.5 transition-transform {showRightPanel ? '' : 'rotate-180'}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
			</svg>
		</button>

		<!-- Right panel: Properties / Profiles -->
		{#if showRightPanel}
		<div class="flex h-full w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-900">
			<!-- Panel tabs -->
			<div class="flex border-b border-zinc-800">
				<button
					class="flex-1 px-3 py-1.5 text-xs font-medium {!showProfiles ? 'border-b-2 border-emerald-500 text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}"
					onclick={() => (showProfiles = false)}
				>
					Properties
				</button>
				<button
					class="flex-1 px-3 py-1.5 text-xs font-medium {showProfiles ? 'border-b-2 border-emerald-500 text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}"
					onclick={() => (showProfiles = true)}
				>
					Profiles{profiles.length > 0 ? ` (${profiles.length})` : ''}
				</button>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if showProfiles}
					<ProfilePanel
						{profiles}
						profileSwitch={profileSwitchConfig}
						{perProfileVars}
						onAddProfile={addProfile}
						onRemoveProfile={removeProfile}
						onUpdateProfile={updateProfile}
						onSetProfileSwitch={setProfileSwitch}
					/>
				{:else}
					<FlowPropertyPanel
						{selectedNode}
						{selectedEdge}
						selectedSubNode={selectedSubNode}
						allModuleNodes={flowStore.graph?.nodes.filter((n) => n.type === 'module' && n.moduleData) ?? []}
						sharedVariables={flowStore.project?.sharedVariables ?? []}
						gameplayModuleNodes={flowStore.project?.flows.find((f) => f.flowType === 'gameplay')?.nodes.filter((n) => n.type === 'module' && n.moduleData) ?? []}
						onUpdateNode={updateNode}
						onUpdateEdge={updateEdge}
						onSetInitial={setInitialState}
						onDuplicate={duplicateNode}
						onDelete={deleteSelected}
						onEditOled={handleEditOled}
						onSaveAsChunk={handleSaveAsChunk}
						onAddSubNode={addSubNode}
						onRemoveSubNode={removeSubNode}
						onUpdateSubNode={updateSubNode}
						onReorderSubNodes={reorderSubNodes}
						onSelectSubNode={selectSubNode}
					/>
				{/if}
			</div>
		</div>
		{/if}
	{:else}
		<div class="flex flex-1 items-center justify-center text-sm text-zinc-500">
			<div class="text-center">
				<p class="mb-4">No flow graph loaded.</p>
				<div class="flex gap-3">
					<button
						class="rounded bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500"
						onclick={handleNewGraph}
					>
						Create New
					</button>
					<button
						class="rounded border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
						onclick={handleLoad}
					>
						Load Existing
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<ChunkSaveModal open={showChunkSave} node={selectedNode} onclose={() => (showChunkSave = false)} onsaved={() => chunkRefreshKey++} />

{#if flowStore.graph}
	<FlowEmulator graph={flowStore.graph} open={showEmulator} onclose={() => (showEmulator = false)} />
{/if}
