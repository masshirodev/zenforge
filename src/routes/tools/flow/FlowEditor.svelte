<script lang="ts">
	import FlowCanvas from './FlowCanvas.svelte';
	import FlowToolbar from './FlowToolbar.svelte';
	import FlowPropertyPanel from './FlowPropertyPanel.svelte';
	import ProfilePanel from './ProfilePanel.svelte';
	import ChunkLibrary from './ChunkLibrary.svelte';
	import ChunkSaveModal from './ChunkSaveModal.svelte';
	import WeaponDataModal from './WeaponDataModal.svelte';
	import WeaponDetectionModal from './WeaponDetectionModal.svelte';
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
		formatLayout,
	} from '$lib/stores/flow.svelte';
	import { saveFlowProject, loadFlowProject, listModules, getModule, readFile, writeFile, buildGame } from '$lib/tauri/commands';
	import { generateMergedFlowGpc } from '$lib/flow/codegen-merged';
	import { mergeRecoilTable, parseWeaponNames } from '$lib/utils/recoil-parser';
	import { createModuleNode } from '$lib/flow/module-nodes';
	import { getFlowOledTransfer, setFlowOledTransfer, clearFlowOledTransfer, type FlowOledLayer } from '$lib/stores/flow-transfer.svelte';
	import { setLastBuildResult } from '$lib/stores/build.svelte';
	import { getKeyboardTransfer, clearKeyboardTransfer } from '$lib/stores/keyboard-transfer.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import type { FlowNodeType, FlowChunk, FlowType, ModuleNodeData, SubNodeCondition } from '$lib/types/flow';
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
	let rightPanelTab = $state<'properties' | 'profiles'>('properties');
	let weaponDataModalOpen = $state(false);
	let weaponDetectionModalOpen = $state(false);

	function handleModuleDataSave(updates: Partial<ModuleNodeData>) {
		if (!selectedNode?.moduleData) return;
		const md = { ...selectedNode.moduleData, ...updates };
		updateNode(selectedNode.id, { moduleData: md });
	}

	let weaponNamesFromData = $derived.by(() => {
		const allModuleNodes = flowStore.project?.flows
			.filter((f) => f.flowType === 'gameplay' || f.flowType === 'data')
			.flatMap((f) => f.nodes) ?? [];
		const wdNode = allModuleNodes.find((n) => n.moduleData?.moduleId === 'weapondata');
		return wdNode?.moduleData?.weaponNames ?? [];
	});
	let availableModules = $state<ModuleSummary[]>([]);
	let filteredModulesForFlow = $derived(
		availableModules.filter((m) => {
			const target = m.flow_target || 'gameplay';
			if (flowStore.activeFlowType === 'data') return target === 'data';
			if (flowStore.activeFlowType === 'gameplay') return target === 'gameplay';
			return true;
		})
	);
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

	// Apply pending transfers once the graph is loaded
	let transfersApplied = $state(false);
	$effect(() => {
		if (transfersApplied) return;
		const graph = flowStore.graph;
		if (!graph) return;
		transfersApplied = true;

		untrack(() => {
			// Handle return from OLED editor with pixel data
			const transfer = getFlowOledTransfer();
			if (transfer) {
				const node = graph.nodes.find((n) => n.id === transfer.nodeId);
				if (node) {
					if (transfer.animation) {
						// Animation mode: update the animation subnode with scenes + config
						const sub = node.subNodes.find((s) => s.id === transfer.animation!.subNodeId);
						if (sub && sub.type === 'animation') {
							updateSubNode(node.id, sub.id, {
								config: {
									...sub.config,
									scenes: transfer.animation.scenes,
									frameDelayMs: transfer.animation.frameDelayMs,
									loop: transfer.animation.loop,
								},
							});
							addToast(`Animation updated (${transfer.animation.scenes.length} frames)`, 'success');
						}
					} else if (transfer.layers && transfer.layers.length > 0) {
						// Layer mode: update existing and create new pixel-art subnodes from layers
						let updated = 0;
						let created = 0;
						for (const layer of transfer.layers) {
							const condition: SubNodeCondition | undefined = layer.condition?.variable
								? {
									variable: layer.condition.variable,
									comparison: (layer.condition.operator ?? '==') as SubNodeCondition['comparison'],
									value: Number(layer.condition.value ?? 0),
								}
								: undefined;
							const sub = node.subNodes.find((s) => s.id === layer.subNodeId);
							if (sub && sub.type === 'pixel-art') {
								updateSubNode(node.id, sub.id, {
									label: layer.label,
									config: { ...sub.config, scene: { id: sub.id, name: layer.label, pixels: layer.pixels } },
									condition,
									hidden: !layer.visible || undefined,
								});
								updated++;
							} else {
								// New layer created in OLED — create a pixel-art subnode
								const newSub = addSubNode(node.id, 'pixel-art', layer.label);
								if (newSub) {
									updateSubNode(node.id, newSub.id, {
										config: { ...newSub.config, scene: { id: newSub.id, name: layer.label, pixels: layer.pixels } },
										condition,
										hidden: !layer.visible || undefined,
									});
									created++;
								}
							}
						}
						const parts: string[] = [];
						if (updated > 0) parts.push(`${updated} updated`);
						if (created > 0) parts.push(`${created} created`);
						if (parts.length > 0) {
							addToast(`Pixel art layers: ${parts.join(', ')}`, 'success');
						}
					} else if (transfer.subNodeId) {
						const sub = node.subNodes.find((s) => s.id === transfer.subNodeId);
						if (sub && sub.type === 'pixel-art') {
							updateSubNode(node.id, sub.id, {
								config: { ...sub.config, scene: { id: transfer.scene.id, name: transfer.scene.name, pixels: transfer.scene.pixels } },
							});
							addToast('Pixel art updated from OLED editor', 'success');
						}
					} else {
						updateNode(node.id, { oledScene: transfer.scene });
						addToast('OLED scene updated', 'success');
					}
				}
				clearFlowOledTransfer();
			}

			// Handle return from Keyboard Mapper with updated mappings
			const kbTransfer = getKeyboardTransfer();
			if (kbTransfer?.nodeId) {
				const node = graph.nodes.find((n) => n.id === kbTransfer.nodeId);
				if (node?.moduleData) {
					updateNode(node.id, {
						moduleData: { ...node.moduleData, keyboardMappings: [...kbTransfer.mappings] }
					});
					addToast(`Keyboard mappings updated (${kbTransfer.mappings.length} mappings)`, 'success');
				}
				clearKeyboardTransfer();
			}
		});
	});

	// Load available modules for gameplay flow on mount
	onMount(async () => {
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

			// Auto-add weapondata dependency — always place on the data flow
			if (moduleDef.needs_weapondata) {
				// Check all flows for existing weapondata, not just the current one
				const allModuleNodes = flowStore.project?.flows
					.flatMap((f) => f.nodes)
					.filter((n) => n.type === 'module' && n.moduleData) ?? [];
				if (!allModuleNodes.some((n) => n.moduleData!.moduleId === 'weapondata')) {
					try {
						const wdDef = await getModule('weapondata', workspacePaths);
						const dataFlow = flowStore.project?.flows.find((f) => f.flowType === 'data');
						if (dataFlow) {
							const wdNodeCount = dataFlow.nodes.length;
							const wdX = 300 + (wdNodeCount % 5) * 260;
							const wdY = 200 + Math.floor(wdNodeCount / 5) * 140;
							const wdModuleNode = createModuleNode(wdDef, { x: wdX, y: wdY });
							wdModuleNode.id = crypto.randomUUID();
							if (dataFlow.nodes.length === 0) {
								wdModuleNode.isInitialState = true;
							}
							dataFlow.nodes = [...dataFlow.nodes, wdModuleNode];
							dataFlow.updatedAt = Date.now();
						}
						addToast(`Auto-added Weapon Data to Data flow (required by ${moduleDef.display_name})`, 'info');
					} catch {
						addToast(`${moduleDef.display_name} requires Weapon Data but it could not be loaded`, 'warning');
					}
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
			const meta = gameStore.selectedMeta;
			const { code: gpcCode, extraFiles } = generateMergedFlowGpc(project, {
				gameVersion: meta?.version,
				gameName: meta?.name,
				filename: meta?.filename,
				gameType: meta?.game_type,
				consoleType: meta?.console_type,
				username: meta?.username,
				headerComments: meta?.header_comments,
			});

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
				// Store result so the main page Build tab can pick it up
				try {
					const outputContent = await readFile(result.output_path);
					setLastBuildResult(result, outputContent, gamePath);
				} catch {
					setLastBuildResult(result, null, gamePath);
				}
			} else {
				const errMsg = result.errors.length > 0
					? result.errors.join('; ')
					: 'Unknown build error';
				addToast(`Build failed: ${errMsg}`, 'error');
				setLastBuildResult(result, null, gamePath);
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

		// Check if an animation sub-node is selected — open in animation mode
		const animSubNode = selectedSubNode?.type === 'animation' ? selectedSubNode : null;
		if (animSubNode) {
			const scenes = (animSubNode.config.scenes as { id?: string; name?: string; pixels?: string }[]) || [];
			const emptyPixels = btoa(String.fromCharCode(...new Uint8Array(1024)));
			const serializedScenes = scenes.map((s, i) => ({
				id: s.id || crypto.randomUUID(),
				name: s.name || `Frame ${i + 1}`,
				pixels: s.pixels || emptyPixels,
			}));

			setFlowOledTransfer({
				nodeId,
				subNodeId: animSubNode.id,
				scene: serializedScenes[0] || {
					id: crypto.randomUUID(),
					name: animSubNode.label || 'Animation',
					pixels: emptyPixels,
				},
				returnTo: flowStore.gamePath,
				returnPath: page.url.pathname,
				animation: {
					subNodeId: animSubNode.id,
					scenes: serializedScenes,
					frameDelayMs: (animSubNode.config.frameDelayMs as number) || 100,
					loop: animSubNode.config.loop !== false,
				},
			});
			goto('/tools/oled');
			return;
		}

		// Check if a pixel-art sub-node is selected — use its scene data
		const pixelSubNode = selectedSubNode?.type === 'pixel-art' ? selectedSubNode : null;
		const sceneData = pixelSubNode
			? (pixelSubNode.config.scene as { id?: string; name?: string; pixels: string } | null)
			: null;

		// Collect ALL pixel-art subnodes for layer mode
		const pixelArtSubs = node.subNodes.filter((s) => s.type === 'pixel-art');

		// If there are multiple pixel-art subnodes (or even one), use layer mode
		if (pixelArtSubs.length > 0) {
			const emptyPixels = btoa(String.fromCharCode(...new Uint8Array(1024)));
			const layers: FlowOledLayer[] = pixelArtSubs.map((sub) => {
				const scene = sub.config.scene as { id?: string; name?: string; pixels?: string } | null;
				return {
					subNodeId: sub.id,
					label: sub.label || 'Pixel Art',
					pixels: scene?.pixels || emptyPixels,
					visible: !sub.hidden,
					condition: sub.condition ? {
						variable: sub.condition.variable,
						operator: sub.condition.comparison,
						value: String(sub.condition.value),
					} : null,
				};
			});

			// The "scene" field uses the selected subnode or the first one
			const primarySub = pixelSubNode || pixelArtSubs[0];
			const primaryScene = primarySub.config.scene as { id?: string; name?: string; pixels?: string } | null;

			setFlowOledTransfer({
				nodeId,
				subNodeId: primarySub.id,
				scene: {
					id: primaryScene?.id || crypto.randomUUID(),
					name: primarySub.label || node.label,
					pixels: primaryScene?.pixels || emptyPixels,
				},
				returnTo: flowStore.gamePath,
				returnPath: page.url.pathname,
				layers,
			});
		} else {
			// Legacy mode: no pixel-art subnodes, use node-level oledScene
			setFlowOledTransfer({
				nodeId,
				scene: node.oledScene || {
					id: crypto.randomUUID(),
					name: node.label,
					pixels: btoa(String.fromCharCode(...new Uint8Array(1024))),
				},
				returnTo: flowStore.gamePath,
				returnPath: page.url.pathname,
			});
		}
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
			// Regenerate sub-node IDs and populate displayText from label
			for (const sub of node.subNodes) {
				sub.id = crypto.randomUUID();
				if (sub.displayText === undefined) sub.displayText = sub.label;
			}
		}
		if (template.stackOffsetX !== undefined) node.stackOffsetX = template.stackOffsetX;
		if (template.stackOffsetY !== undefined) node.stackOffsetY = template.stackOffsetY;
		if (template.onEnter !== undefined) node.onEnter = template.onEnter;
		if (template.onExit !== undefined) node.onExit = template.onExit;
		if (template.initCode !== undefined) node.initCode = template.initCode;
		if (template.moduleData) node.moduleData = structuredClone(template.moduleData);
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
				initCode: node.initCode,
				moduleData: node.moduleData,
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
		{#each [{ type: 'menu' as FlowType, label: 'Menu Flow' }, { type: 'gameplay' as FlowType, label: 'Gameplay Flow' }, { type: 'data' as FlowType, label: 'Data' }] as tab}
			<button
				class="px-5 py-2 text-sm font-medium transition-colors {flowStore.activeFlowType === tab.type
					? 'border-b-2 border-emerald-500 text-emerald-400'
					: 'text-zinc-500 hover:text-zinc-300'}"
				onclick={() => switchFlow(tab.type)}
			>
				{tab.label}{#if flowStore.activeFlowType === tab.type && flowStore.dirty}<span class="ml-1 text-amber-400">*</span>{/if}
			</button>
		{/each}
	</div>
{/if}

<!-- Toolbar -->
{#if flowStore.graph}
	<FlowToolbar
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
		onFormat={formatLayout}
		canUndo={canUndo()}
		canRedo={canRedo()}
		{hasSelection}
		{building}
		flowType={flowStore.activeFlowType}
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
				availableModules={filteredModulesForFlow}
				onAddModule={handleAddModule}
				onAddNode={handleAddNode}
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
			isDataFlow={flowStore.activeFlowType === 'data'}
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

		<!-- Right panel: Properties / Profiles / Weapon Defaults -->
		{#if showRightPanel}
		<div class="flex h-full w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-900">
			<!-- Panel tabs -->
			<div class="flex border-b border-zinc-800">
				<button
					class="flex-1 px-3 py-1.5 text-xs font-medium {rightPanelTab === 'properties' ? 'border-b-2 border-emerald-500 text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}"
					onclick={() => (rightPanelTab = 'properties')}
				>
					Properties
				</button>
				<button
					class="flex-1 px-3 py-1.5 text-xs font-medium {rightPanelTab === 'profiles' ? 'border-b-2 border-emerald-500 text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}"
					onclick={() => (rightPanelTab = 'profiles')}
				>
					Profiles{profiles.length > 0 ? ` (${profiles.length})` : ''}
				</button>
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if rightPanelTab === 'profiles'}
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
						allNodes={flowStore.graph?.nodes ?? []}
						sharedVariables={flowStore.project?.sharedVariables ?? []}
						gameplayModuleNodes={flowStore.project?.flows.filter((f) => f.flowType === 'gameplay' || f.flowType === 'data').flatMap((f) => f.nodes).filter((n) => n.type === 'module' && n.moduleData) ?? []}
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
						onOpenWeaponData={() => { weaponDataModalOpen = true; }}
						onOpenWeaponDetection={() => { weaponDetectionModalOpen = true; }}
						gamePath={flowStore.gamePath}
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

<ChunkSaveModal open={showChunkSave} node={selectedNode} flowType={flowStore.activeFlowType} onclose={() => (showChunkSave = false)} onsaved={() => chunkRefreshKey++} />

<WeaponDataModal
	open={weaponDataModalOpen}
	moduleData={selectedNode?.moduleData ?? null}
	onclose={() => { weaponDataModalOpen = false; }}
	onsave={handleModuleDataSave}
/>

<WeaponDetectionModal
	open={weaponDetectionModalOpen}
	moduleData={selectedNode?.moduleData ?? null}
	weaponNames={weaponNamesFromData}
	onclose={() => { weaponDetectionModalOpen = false; }}
	onsave={handleModuleDataSave}
/>

{#if flowStore.graph}
	<FlowEmulator graph={flowStore.graph} open={showEmulator} onclose={() => (showEmulator = false)} />
{/if}
