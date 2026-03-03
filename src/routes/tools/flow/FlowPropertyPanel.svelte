<script lang="ts">
	import type {
		FlowNode,
		FlowEdge,
		FlowConditionType,
		FlowNodeType,
		FlowVariable,
		FlowVariableType,
		SubNode,
		SubNodeType,
		ModuleNodeOption,
	} from '$lib/types/flow';
	import { NODE_LABELS, NODE_COLORS } from '$lib/types/flow';
	import { getSubNodeDef, listSubNodeDefs, listSubNodeCategories, SUBNODE_CATEGORY_LABELS } from '$lib/flow/subnodes/registry';
	import SubNodeParamEditor from './SubNodeParamEditor.svelte';
	import MiniMonaco from '$lib/components/editor/MiniMonaco.svelte';
	import ButtonSelect from '$lib/components/inputs/ButtonSelect.svelte';
	import VariableSelect from '$lib/components/inputs/VariableSelect.svelte';
	import { getSettings } from '$lib/stores/settings.svelte';
	import { listSpriteCollections, readSpriteCollection } from '$lib/tauri/commands';
	import { base64ToSprite, bytesPerRow } from '$lib/utils/sprite-pixels';
	import { pixelsToBase64 } from '../../tools/oled/pixels';
	import { OLED_WIDTH } from '../../tools/oled/types';
	import type { SpriteCollectionSummary, SpriteCollection } from '$lib/types/sprite';
	import { renderNodePreview, pixelsToDataUrl } from '$lib/flow/oled-preview';

	interface Props {
		selectedNode: FlowNode | null;
		selectedEdge: FlowEdge | null;
		selectedSubNode: SubNode | null;
		allModuleNodes?: FlowNode[];
		sharedVariables?: FlowVariable[];
		gameplayModuleNodes?: FlowNode[];
		onUpdateNode: (nodeId: string, updates: Partial<FlowNode>) => void;
		onUpdateEdge: (edgeId: string, updates: Partial<FlowEdge>) => void;
		onSetInitial: (nodeId: string) => void;
		onDuplicate: (nodeId: string) => void;
		onDelete: () => void;
		onEditOled: (nodeId: string) => void;
		onSaveAsChunk?: () => void;
		onAddSubNode: (nodeId: string, type: SubNodeType, label: string) => void;
		onRemoveSubNode: (nodeId: string, subNodeId: string) => void;
		onUpdateSubNode: (nodeId: string, subNodeId: string, updates: Partial<SubNode>) => void;
		onReorderSubNodes: (nodeId: string, fromIndex: number, toIndex: number) => void;
		onSelectSubNode: (nodeId: string, subNodeId: string | null) => void;
	}

	let {
		selectedNode,
		selectedEdge,
		selectedSubNode,
		allModuleNodes = [],
		sharedVariables = [],
		gameplayModuleNodes = [],
		onUpdateNode,
		onUpdateEdge,
		onSetInitial,
		onDuplicate,
		onDelete,
		onEditOled,
		onSaveAsChunk,
		onAddSubNode,
		onRemoveSubNode,
		onUpdateSubNode,
		onReorderSubNodes,
		onSelectSubNode,
	}: Props = $props();

	// Derive active conflicts for the selected module node
	let activeConflicts = $derived.by(() => {
		if (!selectedNode?.moduleData?.conflicts?.length) return [];
		const myConflicts = selectedNode.moduleData.conflicts;
		const myId = selectedNode.moduleData.moduleId;
		const conflicts: { nodeId: string; moduleName: string }[] = [];
		for (const other of allModuleNodes) {
			if (other.id === selectedNode.id || !other.moduleData) continue;
			const otherId = other.moduleData.moduleId;
			// Bidirectional check
			if (myConflicts.includes(otherId) || (other.moduleData.conflicts?.includes(myId))) {
				conflicts.push({ nodeId: other.id, moduleName: other.moduleData.moduleName });
			}
		}
		return conflicts;
	});

	const nodeTypes: FlowNodeType[] = ['intro', 'home', 'menu', 'submenu', 'custom', 'screensaver'];
	const conditionTypes: { value: FlowConditionType; label: string }[] = [
		{ value: 'button_press', label: 'Button Press' },
		{ value: 'button_hold', label: 'Button Hold' },
		{ value: 'timeout', label: 'Timeout' },
		{ value: 'variable', label: 'Variable' },
		{ value: 'custom', label: 'Custom Code' },
	];

	let codeTab = $state<'gpc' | 'enter' | 'exit' | 'combo'>('gpc');
	let showSubNodePicker = $state(false);

	// Sprite browsing state
	let settingsStore = getSettings();
	let settings = $derived($settingsStore);
	let showSpriteBrowser = $state(false);
	let spriteCollections = $state<SpriteCollectionSummary[]>([]);
	let activeSpriteCollection = $state<SpriteCollection | null>(null);
	let spriteLoading = $state(false);

	async function openSpriteBrowser() {
		showSpriteBrowser = true;
		activeSpriteCollection = null;
		spriteLoading = true;
		try {
			const results: SpriteCollectionSummary[] = [];
			for (const ws of settings.workspaces) {
				const cols = await listSpriteCollections(ws);
				results.push(...cols);
			}
			spriteCollections = results;
		} catch {
			spriteCollections = [];
		} finally {
			spriteLoading = false;
		}
	}

	async function selectSpriteCollection(summary: SpriteCollectionSummary) {
		spriteLoading = true;
		try {
			for (const ws of settings.workspaces) {
				try {
					activeSpriteCollection = await readSpriteCollection(ws, summary.id);
					break;
				} catch {
					continue;
				}
			}
		} catch {
			activeSpriteCollection = null;
		} finally {
			spriteLoading = false;
		}
	}

	function applySpriteFrame(framePixels: string, frameWidth: number, frameHeight: number) {
		if (!selectedNode || !selectedSubNode) return;

		// Convert sprite packed bytes to OLED 128x64 format
		const spriteBytes = base64ToSprite(framePixels);
		const bpr = bytesPerRow(frameWidth);
		const oledBytes = new Uint8Array(1024); // 128x64 / 8
		const oledBpr = OLED_WIDTH / 8; // 16

		for (let y = 0; y < frameHeight && y < 64; y++) {
			for (let x = 0; x < frameWidth && x < 128; x++) {
				const sByteIdx = y * bpr + Math.floor(x / 8);
				const sBitIdx = 7 - (x % 8);
				if (spriteBytes[sByteIdx] & (1 << sBitIdx)) {
					const oByteIdx = y * oledBpr + Math.floor(x / 8);
					const oBitIdx = 7 - (x % 8);
					oledBytes[oByteIdx] |= 1 << oBitIdx;
				}
			}
		}

		const oledBase64 = pixelsToBase64(oledBytes);

		onUpdateSubNode(selectedNode.id, selectedSubNode.id, {
			config: {
				...selectedSubNode.config,
				scene: { id: crypto.randomUUID(), name: 'sprite', pixels: oledBase64 },
				width: Math.min(frameWidth, 128),
				height: Math.min(frameHeight, 64),
			},
		});

		showSpriteBrowser = false;
		activeSpriteCollection = null;
	}

	// Local editing state for node
	let editLabel = $state('');
	let editGpcCode = $state('');
	let editOnEnter = $state('');
	let editOnExit = $state('');
	let editComboCode = $state('');

	// Sync node → local state only when a different node is selected
	let lastSyncedNodeId = '';
	let syncedLabel = '';
	let syncedGpcCode = '';
	let syncedOnEnter = '';
	let syncedOnExit = '';
	let syncedComboCode = '';

	// Commit pending node edits before switching away
	function flushNodeEdits(nodeId: string) {
		if (!nodeId) return;
		const updates: Partial<FlowNode> = {};
		if (editLabel !== syncedLabel) updates.label = editLabel;
		if (editGpcCode !== syncedGpcCode) updates.gpcCode = editGpcCode;
		if (editOnEnter !== syncedOnEnter) updates.onEnter = editOnEnter;
		if (editOnExit !== syncedOnExit) updates.onExit = editOnExit;
		if (editComboCode !== syncedComboCode) updates.comboCode = editComboCode;
		if (Object.keys(updates).length > 0) {
			onUpdateNode(nodeId, updates);
		}
	}

	$effect(() => {
		if (selectedNode && selectedNode.id !== lastSyncedNodeId) {
			// If switching from one node to another, flush the old one
			if (lastSyncedNodeId) flushNodeEdits(lastSyncedNodeId);
			lastSyncedNodeId = selectedNode.id;
			editLabel = syncedLabel = selectedNode.label;
			editGpcCode = syncedGpcCode = selectedNode.gpcCode;
			editOnEnter = syncedOnEnter = selectedNode.onEnter;
			editOnExit = syncedOnExit = selectedNode.onExit;
			editComboCode = syncedComboCode = selectedNode.comboCode;
		} else if (!selectedNode && lastSyncedNodeId) {
			// Deselected — flush pending edits
			flushNodeEdits(lastSyncedNodeId);
			lastSyncedNodeId = '';
		}
	});

	// Local editing state for module node
	let editInitCode = $state('');
	let editMainCode = $state('');
	let editFunctionsCode = $state('');
	let editModuleComboCode = $state('');
	let editEnableVariable = $state('');
	let moduleCodeTab = $state<'init' | 'main' | 'functions' | 'combos'>('main');
	let isModuleNode = $derived(selectedNode?.type === 'module');

	// OLED Preview for nodes with sub-nodes
	let oledPreview = $derived(
		selectedNode && selectedNode.subNodes.length > 0 && typeof document !== 'undefined'
			? pixelsToDataUrl(renderNodePreview(selectedNode))
			: ''
	);

	let lastSyncedModuleNodeId = '';
	let lastSyncedModuleData: import('$lib/types/flow').ModuleNodeData | null = null;

	function flushModuleEdits(nodeId: string) {
		if (!nodeId || !lastSyncedModuleData) return;
		const md = { ...lastSyncedModuleData };
		let changed = false;
		if (editInitCode !== (md.initCode ?? '')) { md.initCode = editInitCode; changed = true; }
		if (editMainCode !== (md.mainCode || md.triggerCode || '')) { md.mainCode = editMainCode; md.triggerCode = undefined; changed = true; }
		if (editFunctionsCode !== (md.functionsCode ?? '')) { md.functionsCode = editFunctionsCode; changed = true; }
		if (editModuleComboCode !== md.comboCode) { md.comboCode = editModuleComboCode; changed = true; }
		if (editEnableVariable !== md.enableVariable) { md.enableVariable = editEnableVariable; changed = true; }
		if (changed) onUpdateNode(nodeId, { moduleData: md });
	}

	$effect(() => {
		if (selectedNode && selectedNode.type === 'module' && selectedNode.id !== lastSyncedModuleNodeId) {
			if (lastSyncedModuleNodeId) flushModuleEdits(lastSyncedModuleNodeId);
			lastSyncedModuleNodeId = selectedNode.id;
			lastSyncedModuleData = selectedNode.moduleData ? { ...selectedNode.moduleData } : null;
			const md = selectedNode.moduleData;
			editInitCode = md?.initCode ?? '';
			editMainCode = md?.mainCode || md?.triggerCode || '';
			editFunctionsCode = md?.functionsCode ?? '';
			editModuleComboCode = md?.comboCode ?? '';
			editEnableVariable = md?.enableVariable ?? '';
		} else if (!selectedNode || selectedNode.type !== 'module') {
			if (lastSyncedModuleNodeId) flushModuleEdits(lastSyncedModuleNodeId);
			lastSyncedModuleNodeId = '';
			lastSyncedModuleData = null;
		}
	});

	function commitModuleData() {
		if (!selectedNode || !selectedNode.moduleData) return;
		const md = { ...selectedNode.moduleData };
		let changed = false;
		if (editInitCode !== (md.initCode ?? '')) { md.initCode = editInitCode; changed = true; }
		if (editMainCode !== (md.mainCode || md.triggerCode || '')) { md.mainCode = editMainCode; md.triggerCode = undefined; changed = true; }
		if (editFunctionsCode !== (md.functionsCode ?? '')) { md.functionsCode = editFunctionsCode; changed = true; }
		if (editModuleComboCode !== md.comboCode) { md.comboCode = editModuleComboCode; changed = true; }
		if (editEnableVariable !== md.enableVariable) { md.enableVariable = editEnableVariable; changed = true; }
		if (changed) {
			onUpdateNode(selectedNode.id, { moduleData: md });
		}
	}

	function updateModuleOption(index: number, updates: Partial<ModuleNodeOption>) {
		if (!selectedNode || !selectedNode.moduleData) return;
		const md = { ...selectedNode.moduleData };
		const opts = [...md.options];
		opts[index] = { ...opts[index], ...updates };
		md.options = opts;
		onUpdateNode(selectedNode.id, { moduleData: md });
	}

	function addModuleOption() {
		if (!selectedNode || !selectedNode.moduleData) return;
		const md = { ...selectedNode.moduleData };
		const newOpt: ModuleNodeOption = {
			name: `Option ${md.options.length + 1}`,
			variable: `opt_${md.options.length}`,
			type: 'value',
			defaultValue: 0,
		};
		md.options = [...md.options, newOpt];
		onUpdateNode(selectedNode.id, { moduleData: md });
	}

	function removeModuleOption(index: number) {
		if (!selectedNode || !selectedNode.moduleData) return;
		const md = { ...selectedNode.moduleData };
		md.options = md.options.filter((_, i) => i !== index);
		onUpdateNode(selectedNode.id, { moduleData: md });
	}

	// Weapon names for weapondata module
	let newWeaponName = $state('');

	function addWeaponName() {
		const name = newWeaponName.trim();
		if (!name || !selectedNode?.moduleData) return;
		const md = { ...selectedNode.moduleData };
		const existing = md.weaponNames ?? [];
		if (existing.includes(name)) {
			newWeaponName = '';
			return;
		}
		md.weaponNames = [...existing, name];
		onUpdateNode(selectedNode.id, { moduleData: md });
		newWeaponName = '';
	}

	function removeWeaponName(name: string) {
		if (!selectedNode?.moduleData) return;
		const md = { ...selectedNode.moduleData };
		md.weaponNames = (md.weaponNames ?? []).filter((w) => w !== name);
		onUpdateNode(selectedNode.id, { moduleData: md });
	}

	// Local editing state for sub-node
	let editSubLabel = $state('');
	let lastSyncedSubNodeId = '';
	let lastSyncedSubNodeParentId = '';

	function flushSubNodeEdits(parentId: string, subNodeId: string) {
		if (!parentId || !subNodeId) return;
		onUpdateSubNode(parentId, subNodeId, { label: editSubLabel });
	}

	$effect(() => {
		if (selectedSubNode && selectedSubNode.id !== lastSyncedSubNodeId) {
			if (lastSyncedSubNodeId) flushSubNodeEdits(lastSyncedSubNodeParentId, lastSyncedSubNodeId);
			lastSyncedSubNodeId = selectedSubNode.id;
			lastSyncedSubNodeParentId = selectedNode?.id ?? '';
			editSubLabel = selectedSubNode.label;
		} else if (!selectedSubNode && lastSyncedSubNodeId) {
			flushSubNodeEdits(lastSyncedSubNodeParentId, lastSyncedSubNodeId);
			lastSyncedSubNodeId = '';
			lastSyncedSubNodeParentId = '';
		}
	});

	// Local editing state for edge
	let editEdgeLabel = $state('');
	let editEdgeButton = $state('');
	let editEdgeTimeoutMs = $state(0);
	let editEdgeCustomCode = $state('');
	let editEdgeVariable = $state('');
	let editEdgeComparison = $state('==');
	let editEdgeValue = $state(0);
	let editEdgeModifiers = $state<string[]>([]);

	let lastSyncedEdgeKey = '';
	let lastSyncedEdgeId = '';

	function flushEdgeEdits(edgeId: string) {
		if (!edgeId) return;
		onUpdateEdge(edgeId, {
			label: editEdgeLabel,
			condition: {
				type: (lastSyncedEdgeKey.split(':')[1] ?? 'button_press') as FlowConditionType,
				button: editEdgeButton || undefined,
				modifiers: editEdgeModifiers.filter(Boolean).length > 0 ? editEdgeModifiers.filter(Boolean) : undefined,
				timeoutMs: editEdgeTimeoutMs || undefined,
				customCode: editEdgeCustomCode || undefined,
				variable: editEdgeVariable || undefined,
				comparison: (editEdgeComparison as FlowEdge['condition']['comparison']) || undefined,
				value: editEdgeValue,
			},
		});
	}

	$effect(() => {
		if (selectedEdge) {
			const key = `${selectedEdge.id}:${selectedEdge.condition.type}`;
			if (key !== lastSyncedEdgeKey) {
				if (lastSyncedEdgeId) flushEdgeEdits(lastSyncedEdgeId);
				lastSyncedEdgeKey = key;
				lastSyncedEdgeId = selectedEdge.id;
				editEdgeLabel = selectedEdge.label;
				editEdgeButton = selectedEdge.condition.button || '';
				editEdgeModifiers = [...(selectedEdge.condition.modifiers ?? [])];
				editEdgeTimeoutMs = selectedEdge.condition.timeoutMs ?? 3000;
				editEdgeCustomCode = selectedEdge.condition.customCode || '';
				editEdgeVariable = selectedEdge.condition.variable || '';
				editEdgeComparison = selectedEdge.condition.comparison || '==';
				editEdgeValue = selectedEdge.condition.value ?? 0;
			}
		} else if (lastSyncedEdgeId) {
			flushEdgeEdits(lastSyncedEdgeId);
			lastSyncedEdgeKey = '';
			lastSyncedEdgeId = '';
		}
	});

	// Derived
	let subNodeDef = $derived(selectedSubNode ? getSubNodeDef(selectedSubNode.type) : null);
	let isTextSubNode = $derived(
		selectedSubNode
			? ['header', 'text-line', 'menu-item', 'toggle-item', 'value-item', 'array-item'].includes(selectedSubNode.type)
			: false
	);
	let sortedSubNodes = $derived(
		selectedNode ? [...selectedNode.subNodes].sort((a, b) => a.order - b.order) : []
	);
	let subNodeCategories = $derived(listSubNodeCategories());
	let availableVariables = $derived.by(() => {
		if (!selectedNode) return [] as { name: string; label: string }[];
		const seen = new Set<string>();
		const result: { name: string; label: string }[] = [];

		// Local node variables
		for (const v of selectedNode.variables) {
			if (!seen.has(v.name)) {
				result.push({ name: v.name, label: v.name });
				seen.add(v.name);
			}
		}

		// Gameplay module variables (tagged G)
		for (const modNode of gameplayModuleNodes) {
			const md = modNode.moduleData;
			if (!md) continue;
			const tag = md.moduleName;
			for (const v of modNode.variables) {
				if (!seen.has(v.name)) {
					result.push({ name: v.name, label: `G:${tag} - ${v.name}` });
					seen.add(v.name);
				}
			}
		}

		// Shared variables (tagged S)
		for (const v of sharedVariables) {
			if (!seen.has(v.name)) {
				result.push({ name: v.name, label: `S - ${v.name}` });
				seen.add(v.name);
			}
		}

		return result;
	});

	function commitNodeLabel() {
		if (selectedNode && editLabel !== selectedNode.label) {
			onUpdateNode(selectedNode.id, { label: editLabel });
		}
	}

	function commitNodeCode() {
		if (!selectedNode) return;
		const updates: Partial<FlowNode> = {};
		if (editGpcCode !== selectedNode.gpcCode) updates.gpcCode = editGpcCode;
		if (editOnEnter !== selectedNode.onEnter) updates.onEnter = editOnEnter;
		if (editOnExit !== selectedNode.onExit) updates.onExit = editOnExit;
		if (editComboCode !== selectedNode.comboCode) updates.comboCode = editComboCode;
		if (Object.keys(updates).length > 0) {
			onUpdateNode(selectedNode.id, updates);
		}
	}

	function commitSubNodeLabel() {
		if (selectedNode && selectedSubNode && editSubLabel !== selectedSubNode.label) {
			onUpdateSubNode(selectedNode.id, selectedSubNode.id, { label: editSubLabel });
		}
	}

	function commitEdge() {
		if (!selectedEdge) return;
		const ctype = selectedEdge.condition.type;
		const filteredModifiers = editEdgeModifiers.filter(Boolean);
		onUpdateEdge(selectedEdge.id, {
			label: editEdgeLabel,
			condition: {
				...selectedEdge.condition,
				button: editEdgeButton || undefined,
				modifiers: filteredModifiers.length > 0 ? filteredModifiers : undefined,
				timeoutMs: ctype === 'button_hold' || ctype === 'timeout' ? editEdgeTimeoutMs : undefined,
				customCode: editEdgeCustomCode || undefined,
				variable: editEdgeVariable || undefined,
				comparison: (editEdgeComparison as FlowEdge['condition']['comparison']) || undefined,
				value: editEdgeValue,
			},
		});
	}

	function addVariable() {
		if (!selectedNode) return;
		const newVar: FlowVariable = {
			name: `var_${selectedNode.variables.length}`,
			type: 'int',
			defaultValue: 0,
			persist: false,
		};
		onUpdateNode(selectedNode.id, {
			variables: [...selectedNode.variables, newVar],
		});
	}

	function removeVariable(index: number) {
		if (!selectedNode) return;
		const vars = [...selectedNode.variables];
		vars.splice(index, 1);
		onUpdateNode(selectedNode.id, { variables: vars });
	}

	function updateVariable(index: number, updates: Partial<FlowVariable>) {
		if (!selectedNode) return;
		const vars = [...selectedNode.variables];
		const current = vars[index];
		if (updates.type && updates.type !== current.type) {
			if (updates.type === 'string' && typeof current.defaultValue !== 'string') {
				updates.defaultValue = '';
				updates.arraySize = 32;
			} else if (updates.type !== 'string' && typeof current.defaultValue === 'string') {
				updates.defaultValue = 0;
				updates.arraySize = undefined;
			}
		}
		vars[index] = { ...current, ...updates };
		onUpdateNode(selectedNode.id, { variables: vars });
	}

	function handleAddSubNode(type: SubNodeType) {
		if (!selectedNode) return;
		const def = getSubNodeDef(type);
		const label = def?.name || type;
		onAddSubNode(selectedNode.id, type, label);
		showSubNodePicker = false;
	}

	function handleMoveSubNode(fromIdx: number, direction: -1 | 1) {
		if (!selectedNode) return;
		const toIdx = fromIdx + direction;
		if (toIdx < 0 || toIdx >= sortedSubNodes.length) return;
		onReorderSubNodes(selectedNode.id, fromIdx, toIdx);
	}

	function handleSubNodeParamUpdate(key: string, value: unknown) {
		if (!selectedNode || !selectedSubNode) return;
		const newConfig = { ...selectedSubNode.config, [key]: value };
		onUpdateSubNode(selectedNode.id, selectedSubNode.id, { config: newConfig });
	}
</script>

<div class="flex h-full flex-col">
	{#if selectedNode && selectedSubNode}
		<!-- ==================== Sub-Node Properties ==================== -->
		<div class="border-b border-zinc-800 px-3 py-2">
			<div class="flex items-center gap-2">
				<button
					class="text-zinc-400 hover:text-zinc-200"
					onclick={() => onSelectSubNode(selectedNode!.id, null)}
					title="Back to node"
				>
					<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
						<path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
					</svg>
				</button>
				<h3 class="text-xs font-medium uppercase tracking-wider text-zinc-500">Sub-Node</h3>
				<span class="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
					{subNodeDef?.name || selectedSubNode.type}
				</span>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto px-3 py-2">
			<!-- Label / Display Text -->
			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400" for="subnode-label">
					{isTextSubNode ? 'Display Text' : 'Label'}
				</label>
				<input
					id="subnode-label"
					type="text"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
					bind:value={editSubLabel}
					onblur={commitSubNodeLabel}
					onkeydown={(e) => { if (e.key === 'Enter') commitSubNodeLabel(); }}
					placeholder={isTextSubNode ? 'Text shown on OLED...' : 'Sub-node label...'}
				/>
				{#if isTextSubNode}
					<p class="mt-0.5 text-[10px] text-zinc-600">This text is rendered on the OLED screen</p>
				{/if}
			</div>

			<!-- Pixel Art: Edit button + Browse Sprites -->
			{#if selectedSubNode.type === 'pixel-art'}
				<div class="mb-3 flex gap-1">
					<button
						class="flex-1 rounded border border-blue-800 bg-blue-950 px-2 py-1.5 text-xs text-blue-300 hover:bg-blue-900"
						onclick={() => onEditOled(selectedNode!.id)}
					>
						Edit in OLED Editor
					</button>
					<button
						class="flex-1 rounded border border-emerald-800 bg-emerald-950 px-2 py-1.5 text-xs text-emerald-300 hover:bg-emerald-900"
						onclick={openSpriteBrowser}
					>
						Browse Sprites
					</button>
				</div>

				{#if showSpriteBrowser}
					<div class="mb-3 rounded border border-zinc-700 bg-zinc-900 p-2">
						{#if spriteLoading}
							<p class="text-xs text-zinc-500">Loading...</p>
						{:else if !activeSpriteCollection}
							{#if spriteCollections.length === 0}
								<p class="text-xs text-zinc-500">No sprite collections found</p>
							{:else}
								<p class="mb-1 text-[10px] uppercase text-zinc-500">Collections</p>
								{#each spriteCollections as col}
									<button
										class="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800"
										onclick={() => selectSpriteCollection(col)}
									>
										<span>{col.name}</span>
										<span class="text-zinc-600">{col.frame_count}f</span>
									</button>
								{/each}
							{/if}
							<button
								class="mt-1 w-full text-right text-[10px] text-zinc-600 hover:text-zinc-400"
								onclick={() => { showSpriteBrowser = false; }}
							>
								Close
							</button>
						{:else}
							<button
								class="mb-1 flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
								onclick={() => { activeSpriteCollection = null; }}
							>
								<svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
								{activeSpriteCollection.name}
							</button>
							<div class="flex flex-wrap gap-1">
								{#each activeSpriteCollection.frames as frame}
									<button
										class="rounded border border-zinc-700 p-0.5 hover:border-emerald-600"
										onclick={() => applySpriteFrame(frame.pixels, frame.width, frame.height)}
										title="{frame.width}x{frame.height}"
									>
										<div class="h-8 w-8 bg-zinc-950" style="image-rendering: pixelated"></div>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			{/if}

			<!-- Position mode -->
			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400">Position</label>
				<div class="flex gap-1">
					<button
						class="flex-1 rounded px-2 py-1 text-xs {selectedSubNode.position === 'stack' ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}"
						onclick={() => onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, { position: 'stack' })}
					>
						Stack
					</button>
					<button
						class="flex-1 rounded px-2 py-1 text-xs {selectedSubNode.position === 'absolute' ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}"
						onclick={() => onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, { position: 'absolute' })}
					>
						Absolute
					</button>
				</div>
			</div>

			<!-- Absolute x/y inputs -->
			{#if selectedSubNode.position === 'absolute'}
				<div class="mb-3 flex gap-2">
					<div class="flex-1">
						<label class="mb-0.5 block text-xs text-zinc-400" for="subnode-x">X</label>
						<input
							id="subnode-x"
							type="number"
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							value={selectedSubNode.x ?? 0}
							min="0"
							max="127"
							onchange={(e) => onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, { x: parseInt((e.target as HTMLInputElement).value) || 0 })}
						/>
					</div>
					<div class="flex-1">
						<label class="mb-0.5 block text-xs text-zinc-400" for="subnode-y">Y</label>
						<input
							id="subnode-y"
							type="number"
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							value={selectedSubNode.y ?? 0}
							min="0"
							max="63"
							onchange={(e) => onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, { y: parseInt((e.target as HTMLInputElement).value) || 0 })}
						/>
					</div>
				</div>
			{/if}

			<!-- Variable binding -->
			{#if selectedSubNode.interactive || ['bar', 'indicator', 'toggle-item', 'value-item', 'array-item'].includes(selectedSubNode.type)}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400">Bound Variable</label>
					<VariableSelect
						value={selectedSubNode.boundVariable || ''}
						options={availableVariables}
						placeholder="Search or type variable..."
						onchange={(val) => {
							onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, { boundVariable: val || undefined });
						}}
					/>
				</div>
			{/if}

			<!-- Type-specific parameters -->
			{#if subNodeDef && subNodeDef.params.length > 0}
				<div class="mb-3">
					<label class="mb-1 block text-xs font-medium text-zinc-400">Parameters</label>
					<SubNodeParamEditor
						params={subNodeDef.params}
						config={selectedSubNode.config}
						onUpdate={handleSubNodeParamUpdate}
					/>
				</div>
			{/if}

			<!-- Custom code -->
			{#if selectedSubNode.type === 'custom'}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400">Render Code</label>
					<div class="h-24 overflow-hidden rounded border border-zinc-700">
						<MiniMonaco
							value={selectedSubNode.renderCode || ''}
							language="gpc"
							label="Render Code"
							onchange={(v) => onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, { renderCode: v })}
						/>
					</div>
				</div>
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400">Interact Code</label>
					<div class="h-24 overflow-hidden rounded border border-zinc-700">
						<MiniMonaco
							value={selectedSubNode.interactCode || ''}
							language="gpc"
							label="Interact Code"
							onchange={(v) => onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, { interactCode: v })}
						/>
					</div>
				</div>
			{/if}

			<!-- Delete sub-node -->
			<button
				class="mt-4 w-full rounded border border-red-800 bg-red-950 px-2 py-1.5 text-xs text-red-300 hover:bg-red-900"
				onclick={() => {
					if (selectedNode && selectedSubNode) {
						onRemoveSubNode(selectedNode.id, selectedSubNode.id);
					}
				}}
			>
				Delete Sub-Node
			</button>
		</div>

	{:else if selectedNode && isModuleNode}
		<!-- ==================== Module Node Properties ==================== -->
		<div class="border-b border-zinc-800 px-3 py-2">
			<h3 class="text-xs font-medium uppercase tracking-wider text-zinc-500">Module Properties</h3>
		</div>
		<div class="flex-1 overflow-y-auto px-3 py-2">
			<!-- Label -->
			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400" for="module-label">Label</label>
				<input
					id="module-label"
					type="text"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
					bind:value={editLabel}
					onblur={commitNodeLabel}
					onkeydown={(e) => { if (e.key === 'Enter') commitNodeLabel(); }}
				/>
			</div>

			<!-- Module ID badge -->
			{#if selectedNode.moduleData}
				<div class="mb-3 flex items-center gap-2">
					<span class="rounded bg-red-950 px-2 py-0.5 text-xs text-red-300">
						{selectedNode.moduleData.moduleId}
					</span>
					<span class="text-xs text-zinc-500">{selectedNode.moduleData.moduleName}</span>
				</div>
			{/if}

			<!-- Conflict Warning -->
			{#if activeConflicts.length > 0}
				<div class="mb-3 rounded border border-orange-800 bg-orange-950/50 px-2 py-1.5">
					<p class="text-xs font-medium text-orange-400">Conflicts Detected</p>
					<ul class="mt-0.5 space-y-0.5">
						{#each activeConflicts as conflict}
							<li class="text-[10px] text-orange-300">• {conflict.moduleName}</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- Enable Variable -->
			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400" for="module-enable-var">Enable Variable</label>
				<input
					id="module-enable-var"
					type="text"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
					bind:value={editEnableVariable}
					onblur={commitModuleData}
					onkeydown={(e) => { if (e.key === 'Enter') commitModuleData(); }}
				/>
				<p class="mt-0.5 text-[10px] text-zinc-600">Toggle variable shared with Menu Flow</p>
			</div>

			<!-- Weapon Names (weapondata module only) -->
			{#if selectedNode.moduleData?.moduleId === 'weapondata'}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400" for="weapon-name-input">Weapon Names</label>
					<div class="flex flex-wrap items-center gap-1.5">
						{#each selectedNode.moduleData.weaponNames ?? [] as weapon}
							<span class="group flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
								{weapon}
								<button
									class="text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-red-400"
									title="Remove {weapon}"
									onclick={() => removeWeaponName(weapon)}
								>
									<svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
										<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
									</svg>
								</button>
							</span>
						{/each}
						<form
							class="flex items-center gap-1"
							onsubmit={(e) => { e.preventDefault(); addWeaponName(); }}
						>
							<input
								id="weapon-name-input"
								class="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
								placeholder="Add weapon..."
								bind:value={newWeaponName}
							/>
							<button
								type="submit"
								class="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-600"
								disabled={!newWeaponName.trim()}
							>
								+
							</button>
						</form>
					</div>
					<p class="mt-1 text-[10px] text-zinc-600">
						{(selectedNode.moduleData.weaponNames ?? []).length} weapons — generates Weapons[] array, WEAPON_COUNT, WEAPON_MAX_INDEX
					</p>
				</div>
			{/if}

			<!-- Code Tabs -->
			<div class="mb-2">
				<label class="mb-1 block text-xs text-zinc-400">Code</label>
				<div class="flex gap-0.5 rounded bg-zinc-800 p-0.5">
					{#each [
						{ key: 'init', label: 'Init' },
						{ key: 'main', label: 'Main' },
						{ key: 'functions', label: 'Funcs' },
						{ key: 'combos', label: 'Combos' },
					] as tab}
						<button
							class="flex-1 rounded px-1 py-1 text-xs {moduleCodeTab === tab.key ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}"
							onclick={() => {
								commitModuleData();
								moduleCodeTab = tab.key as typeof moduleCodeTab;
							}}
						>
							{tab.label}
						</button>
					{/each}
				</div>
			</div>
			<div class="mb-3 h-32 overflow-hidden rounded border border-zinc-700">
				{#if moduleCodeTab === 'init'}
					<MiniMonaco
						value={editInitCode}
						language="gpc"
						label="Init Code"
						onchange={(v) => { editInitCode = v; commitModuleData(); }}
					/>
				{:else if moduleCodeTab === 'main'}
					<MiniMonaco
						value={editMainCode}
						language="gpc"
						label="Main Code"
						onchange={(v) => { editMainCode = v; commitModuleData(); }}
					/>
				{:else if moduleCodeTab === 'functions'}
					<MiniMonaco
						value={editFunctionsCode}
						language="gpc"
						label="Functions"
						onchange={(v) => { editFunctionsCode = v; commitModuleData(); }}
					/>
				{:else if moduleCodeTab === 'combos'}
					<MiniMonaco
						value={editModuleComboCode}
						language="gpc"
						label="Combos"
						onchange={(v) => { editModuleComboCode = v; commitModuleData(); }}
					/>
				{/if}
			</div>
			<p class="mb-3 text-[10px] text-zinc-600">
				{#if moduleCodeTab === 'init'}Runs once in the init block
				{:else if moduleCodeTab === 'main'}Runs every frame in main, guarded by enable variable
				{:else if moduleCodeTab === 'functions'}Function definitions, constants, and defines
				{:else}Combo blocks
				{/if}
			</p>

			<!-- Options -->
			<div class="mb-3">
				<div class="mb-1 flex items-center justify-between">
					<label class="text-xs text-zinc-400">Options</label>
					<button
						class="rounded px-1.5 py-0.5 text-xs text-emerald-400 hover:bg-zinc-800"
						onclick={addModuleOption}
					>
						+ Add
					</button>
				</div>
				{#if selectedNode.moduleData && selectedNode.moduleData.options.length > 0}
					<div class="space-y-1">
						{#each selectedNode.moduleData.options as opt, i}
							<div class="rounded bg-zinc-800 px-2 py-1.5">
								<div class="mb-1 flex items-center gap-1">
									<input
										type="text"
										class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
										value={opt.name}
										placeholder="Name"
										onchange={(e) => updateModuleOption(i, { name: (e.target as HTMLInputElement).value })}
									/>
									<button
										class="text-zinc-600 hover:text-red-400"
										onclick={() => removeModuleOption(i)}
									>
										<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
										</svg>
									</button>
								</div>
								<div class="flex items-center gap-1">
									<input
										type="text"
										class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
										value={opt.variable}
										placeholder="Variable"
										onchange={(e) => updateModuleOption(i, { variable: (e.target as HTMLInputElement).value })}
									/>
									<select
										class="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
										value={opt.type}
										onchange={(e) => updateModuleOption(i, { type: (e.target as HTMLSelectElement).value as 'toggle' | 'value' })}
									>
										<option value="toggle">Toggle</option>
										<option value="value">Value</option>
									</select>
								</div>
								{#if opt.type === 'value'}
									<div class="mt-1 flex gap-1">
										<input
											type="number"
											class="w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
											value={opt.defaultValue}
											placeholder="Default"
											title="Default"
											onchange={(e) => updateModuleOption(i, { defaultValue: parseInt((e.target as HTMLInputElement).value) || 0 })}
										/>
										<input
											type="number"
											class="w-14 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
											value={opt.min ?? 0}
											placeholder="Min"
											title="Min"
											onchange={(e) => updateModuleOption(i, { min: parseInt((e.target as HTMLInputElement).value) || 0 })}
										/>
										<input
											type="number"
											class="w-14 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
											value={opt.max ?? 100}
											placeholder="Max"
											title="Max"
											onchange={(e) => updateModuleOption(i, { max: parseInt((e.target as HTMLInputElement).value) || 100 })}
										/>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="rounded border border-dashed border-zinc-700 px-2 py-2 text-center text-xs text-zinc-600">
						No options configured
					</div>
				{/if}
			</div>

			<!-- Variables (auto-generated from module) -->
			<div class="mb-3">
				<div class="mb-1 flex items-center justify-between">
					<label class="text-xs text-zinc-400">Variables</label>
					<button
						class="rounded px-1.5 py-0.5 text-xs text-emerald-400 hover:bg-zinc-800"
						onclick={addVariable}
					>
						+ Add
					</button>
				</div>
				{#each selectedNode.variables as variable, i}
					<div class="mb-1 flex items-center gap-1">
						<input
							type="text"
							class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
							value={variable.name}
							onchange={(e) => updateVariable(i, { name: (e.target as HTMLInputElement).value })}
						/>
						<select
							class="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
							value={variable.type}
							onchange={(e) => updateVariable(i, { type: (e.target as HTMLSelectElement).value as FlowVariableType })}
						>
							<option value="int">int</option>
							<option value="int8">int8</option>
							<option value="int16">int16</option>
							<option value="int32">int32</option>
						</select>
						<button
							class="text-zinc-500 hover:text-red-400"
							onclick={() => removeVariable(i)}
						>
							<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				{/each}
			</div>

			<!-- Actions -->
			<div class="mt-4 space-y-2">
				<div class="flex gap-2">
					<button
						class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
						onclick={() => onDuplicate(selectedNode!.id)}
					>
						Duplicate
					</button>
					<button
						class="flex-1 rounded border border-red-800 bg-red-950 px-2 py-1.5 text-xs text-red-300 hover:bg-red-900"
						onclick={onDelete}
					>
						Delete
					</button>
				</div>
			</div>
		</div>

	{:else if selectedNode}
		<!-- ==================== Node Properties ==================== -->
		<div class="border-b border-zinc-800 px-3 py-2">
			<h3 class="text-xs font-medium uppercase tracking-wider text-zinc-500">Node Properties</h3>
		</div>
		<div class="flex-1 overflow-y-auto px-3 py-2">
			<!-- OLED Preview -->
			{#if oledPreview}
				<div class="mb-3 rounded border border-zinc-800 bg-zinc-950 p-2">
					<div class="mb-1 text-[10px] font-medium text-zinc-500 uppercase">OLED Preview</div>
					<img
						src={oledPreview}
						alt="OLED preview"
						class="w-full"
						style="image-rendering: pixelated;"
					/>
				</div>
			{/if}

			<!-- Label -->
			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400" for="node-label">Label</label>
				<input
					id="node-label"
					type="text"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
					bind:value={editLabel}
					onblur={commitNodeLabel}
					onkeydown={(e) => { if (e.key === 'Enter') commitNodeLabel(); }}
				/>
			</div>

			<!-- Type -->
			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400" for="node-type">Type</label>
				<select
					id="node-type"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
					value={selectedNode.type}
					onchange={(e) => onUpdateNode(selectedNode!.id, { type: (e.target as HTMLSelectElement).value as FlowNodeType })}
				>
					{#each nodeTypes as type}
						<option value={type}>{NODE_LABELS[type]}</option>
					{/each}
				</select>
			</div>

			<!-- Initial state -->
			{#if !selectedNode.isInitialState}
				<button
					class="mb-3 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
					onclick={() => onSetInitial(selectedNode!.id)}
				>
					Set as Initial State
				</button>
			{:else}
				<div class="mb-3 rounded border border-emerald-800 bg-emerald-950 px-2 py-1.5 text-center text-xs text-emerald-400">
					Initial State
				</div>
			{/if}

			<!-- Sub-Nodes -->
			<div class="mb-3">
				<div class="mb-1 flex items-center justify-between">
					<label class="text-xs text-zinc-400">Sub-Nodes</label>
					<button
						class="rounded px-1.5 py-0.5 text-xs text-emerald-400 hover:bg-zinc-800"
						onclick={() => (showSubNodePicker = !showSubNodePicker)}
					>
						+ Add
					</button>
				</div>

				<!-- Sub-node type picker -->
				{#if showSubNodePicker}
					<div class="mb-2 max-h-48 overflow-y-auto rounded border border-zinc-700 bg-zinc-800 p-1">
						{#each subNodeCategories as cat}
							<div class="mb-1">
								<div class="px-1 py-0.5 text-xs font-medium text-zinc-500">
									{SUBNODE_CATEGORY_LABELS[cat] || cat}
								</div>
								{#each listSubNodeDefs(cat) as def}
									<button
										class="w-full rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-700"
										onclick={() => handleAddSubNode(def.id as SubNodeType)}
										title={def.description}
									>
										{def.name}
									</button>
								{/each}
							</div>
						{/each}
					</div>
				{/if}

				<!-- Sub-node list -->
				{#if sortedSubNodes.length > 0}
					<div class="space-y-0.5">
						{#each sortedSubNodes as subNode, i (subNode.id)}
							{@const def = getSubNodeDef(subNode.type)}
							<div class="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-1">
								<!-- Reorder buttons -->
								<div class="flex flex-col">
									<button
										class="text-zinc-600 hover:text-zinc-300 disabled:opacity-30"
										disabled={i === 0}
										onclick={() => handleMoveSubNode(i, -1)}
									>
										<svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
											<path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" />
										</svg>
									</button>
									<button
										class="text-zinc-600 hover:text-zinc-300 disabled:opacity-30"
										disabled={i === sortedSubNodes.length - 1}
										onclick={() => handleMoveSubNode(i, 1)}
									>
										<svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
											<path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
										</svg>
									</button>
								</div>

								<!-- Click to select -->
								<button
									class="flex-1 truncate text-left text-xs text-zinc-300 hover:text-zinc-100"
									onclick={() => onSelectSubNode(selectedNode!.id, subNode.id)}
								>
									<span class="mr-1 text-zinc-500">{def?.name || subNode.type}</span>
									{subNode.label}
								</button>

								<!-- Interactive badge -->
								{#if subNode.interactive}
									<span class="rounded bg-purple-900/50 px-1 text-[9px] text-purple-400">INT</span>
								{/if}

								<!-- Remove -->
								<button
									class="text-zinc-600 hover:text-red-400"
									onclick={() => onRemoveSubNode(selectedNode!.id, subNode.id)}
								>
									<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>
						{/each}
					</div>
				{:else}
					<div class="rounded border border-dashed border-zinc-700 px-2 py-2 text-center text-xs text-zinc-600">
						No sub-nodes. Add one above.
					</div>
				{/if}
			</div>

			<!-- Stack offset -->
			{#if selectedNode.subNodes.length > 0}
				<div class="mb-3 flex gap-2">
					<div class="flex-1">
						<label class="mb-0.5 block text-xs text-zinc-400" for="stack-offset-x">Stack Offset X</label>
						<input
							id="stack-offset-x"
							type="number"
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							value={selectedNode.stackOffsetX}
							onchange={(e) => onUpdateNode(selectedNode!.id, { stackOffsetX: parseInt((e.target as HTMLInputElement).value) || 0 })}
						/>
					</div>
					<div class="flex-1">
						<label class="mb-0.5 block text-xs text-zinc-400" for="stack-offset-y">Stack Offset Y</label>
						<input
							id="stack-offset-y"
							type="number"
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							value={selectedNode.stackOffsetY}
							onchange={(e) => onUpdateNode(selectedNode!.id, { stackOffsetY: parseInt((e.target as HTMLInputElement).value) || 0 })}
						/>
					</div>
				</div>
			{/if}

			<!-- Back Button -->
			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400">Back Button</label>
				<div class="flex items-center gap-1">
					<div class="flex-1">
						<ButtonSelect
							value={selectedNode.backButton || ''}
							onchange={(v) => onUpdateNode(selectedNode!.id, { backButton: v || undefined })}
							placeholder="None (no back navigation)"
						/>
					</div>
					{#if selectedNode.backButton}
						<button
							class="rounded px-1.5 py-1 text-xs text-zinc-500 hover:text-zinc-300"
							title="Clear back button"
							onclick={() => onUpdateNode(selectedNode!.id, { backButton: undefined })}
						>
							<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					{/if}
				</div>
				<p class="mt-0.5 text-[10px] text-zinc-600">Returns to the previous state when pressed</p>
			</div>

			<!-- Code Tabs -->
			<div class="mb-2">
				<label class="mb-1 block text-xs text-zinc-400">Code</label>
				<div class="flex gap-0.5 rounded bg-zinc-800 p-0.5">
					{#each [
						{ key: 'gpc', label: 'Main' },
						{ key: 'enter', label: 'Enter' },
						{ key: 'exit', label: 'Exit' },
						{ key: 'combo', label: 'Combo' },
					] as tab}
						<button
							class="flex-1 rounded px-1 py-1 text-xs {codeTab === tab.key ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}"
							onclick={() => {
								commitNodeCode();
								codeTab = tab.key as typeof codeTab;
							}}
						>
							{tab.label}
						</button>
					{/each}
				</div>
			</div>
			<div class="mb-3 h-32 overflow-hidden rounded border border-zinc-700">
				{#if codeTab === 'gpc'}
					<MiniMonaco
						value={editGpcCode}
						language="gpc"
						label="Main Code"
						onchange={(v) => { editGpcCode = v; commitNodeCode(); }}
					/>
				{:else if codeTab === 'enter'}
					<MiniMonaco
						value={editOnEnter}
						language="gpc"
						label="On Enter"
						onchange={(v) => { editOnEnter = v; commitNodeCode(); }}
					/>
				{:else if codeTab === 'exit'}
					<MiniMonaco
						value={editOnExit}
						language="gpc"
						label="On Exit"
						onchange={(v) => { editOnExit = v; commitNodeCode(); }}
					/>
				{:else if codeTab === 'combo'}
					<MiniMonaco
						value={editComboCode}
						language="gpc"
						label="Combo Code"
						onchange={(v) => { editComboCode = v; commitNodeCode(); }}
					/>
				{/if}
			</div>

			<!-- Variables -->
			<div class="mb-3">
				<div class="mb-1 flex items-center justify-between">
					<label class="text-xs text-zinc-400">Variables</label>
					<button
						class="rounded px-1.5 py-0.5 text-xs text-emerald-400 hover:bg-zinc-800"
						onclick={addVariable}
					>
						+ Add
					</button>
				</div>
				{#each selectedNode.variables as variable, i}
					<div class="mb-1 flex items-center gap-1">
						<input
							type="text"
							class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
							value={variable.name}
							onchange={(e) => updateVariable(i, { name: (e.target as HTMLInputElement).value })}
						/>
						<select
							class="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
							value={variable.type}
							onchange={(e) => updateVariable(i, { type: (e.target as HTMLSelectElement).value as FlowVariableType })}
						>
							<option value="int">int</option>
							<option value="int8">int8</option>
							<option value="int16">int16</option>
							<option value="int32">int32</option>
							<option value="string">string</option>
						</select>
						<button
							class="text-zinc-500 hover:text-red-400"
							onclick={() => removeVariable(i)}
						>
							<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					{#if variable.type === 'string'}
						<div class="mb-1 ml-1 flex items-center gap-1">
							<input
								type="text"
								class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
								value={typeof variable.defaultValue === 'string' ? variable.defaultValue : ''}
								placeholder="Default value"
								onchange={(e) => updateVariable(i, { defaultValue: (e.target as HTMLInputElement).value })}
							/>
							<input
								type="number"
								class="w-14 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
								value={variable.arraySize ?? 32}
								title="Array size"
								min="1"
								max="256"
								onchange={(e) => updateVariable(i, { arraySize: parseInt((e.target as HTMLInputElement).value) || 32 })}
							/>
						</div>
					{/if}
				{/each}
			</div>

			<!-- Actions -->
			<div class="mt-4 space-y-2">
				{#if onSaveAsChunk}
					<button
						class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
						onclick={onSaveAsChunk}
					>
						Save as Chunk
					</button>
				{/if}
				<div class="flex gap-2">
					<button
						class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
						onclick={() => onDuplicate(selectedNode!.id)}
					>
						Duplicate
					</button>
					<button
						class="flex-1 rounded border border-red-800 bg-red-950 px-2 py-1.5 text-xs text-red-300 hover:bg-red-900"
						onclick={onDelete}
					>
						Delete
					</button>
				</div>
			</div>
		</div>
	{:else if selectedEdge}
		<!-- ==================== Edge Properties ==================== -->
		<div class="border-b border-zinc-800 px-3 py-2">
			<h3 class="text-xs font-medium uppercase tracking-wider text-zinc-500">Edge Properties</h3>
		</div>
		<div class="flex-1 overflow-y-auto px-3 py-2">
			<!-- Label -->
			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400" for="edge-label">Label</label>
				<input
					id="edge-label"
					type="text"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
					bind:value={editEdgeLabel}
					onblur={commitEdge}
				/>
			</div>

			<!-- Condition type -->
			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400" for="edge-condition-type">Condition</label>
				<select
					id="edge-condition-type"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
					value={selectedEdge.condition.type}
					onchange={(e) => {
						const newType = (e.target as HTMLSelectElement).value as FlowConditionType;
						const cond = { ...selectedEdge!.condition, type: newType };
						if ((newType === 'button_hold' || newType === 'timeout') && !cond.timeoutMs) {
							cond.timeoutMs = 3000;
						}
						onUpdateEdge(selectedEdge!.id, { condition: cond });
					}}
				>
					{#each conditionTypes as ct}
						<option value={ct.value}>{ct.label}</option>
					{/each}
				</select>
			</div>

			<!-- Condition-specific fields -->
			{#if selectedEdge.condition.type === 'button_press' || selectedEdge.condition.type === 'button_hold'}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400">Button</label>
					<ButtonSelect
						value={editEdgeButton}
						onchange={(v) => { editEdgeButton = v; commitEdge(); }}
						placeholder="Search buttons..."
					/>
				</div>
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400">Modifiers (held buttons)</label>
					{#each editEdgeModifiers as mod, i}
						<div class="mb-1 flex items-center gap-1">
							<div class="flex-1">
								<ButtonSelect
									value={mod}
									onchange={(v) => {
										const mods = [...editEdgeModifiers];
										mods[i] = v;
										editEdgeModifiers = mods;
										commitEdge();
									}}
									placeholder="Search buttons..."
								/>
							</div>
							<button
								class="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
								onclick={() => {
									editEdgeModifiers = editEdgeModifiers.filter((_, idx) => idx !== i);
									commitEdge();
								}}
								title="Remove modifier"
							>
								<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
					{/each}
					<button
						class="mt-1 text-xs text-emerald-500 hover:text-emerald-400"
						onclick={() => { editEdgeModifiers = [...editEdgeModifiers, '']; }}
					>
						+ Add Modifier
					</button>
				</div>
				{#if selectedEdge.condition.type === 'button_hold'}
					<div class="mb-3">
						<label class="mb-1 block text-xs text-zinc-400" for="edge-hold">Hold Duration (ms)</label>
						<input
							id="edge-hold"
							type="number"
							class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
							bind:value={editEdgeTimeoutMs}
							onblur={commitEdge}
						/>
					</div>
				{/if}
			{:else if selectedEdge.condition.type === 'timeout'}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400" for="edge-timeout">Timeout (ms)</label>
					<input
						id="edge-timeout"
						type="number"
						class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
						bind:value={editEdgeTimeoutMs}
						onblur={commitEdge}
					/>
				</div>
			{:else if selectedEdge.condition.type === 'variable'}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400" for="edge-var">Variable</label>
					<input
						id="edge-var"
						type="text"
						class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
						bind:value={editEdgeVariable}
						onblur={commitEdge}
					/>
				</div>
				<div class="mb-3 flex gap-2">
					<select
						class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
						bind:value={editEdgeComparison}
						onchange={commitEdge}
					>
						<option value="==">==</option>
						<option value="!=">!=</option>
						<option value=">">&gt;</option>
						<option value="<">&lt;</option>
						<option value=">=">&gt;=</option>
						<option value="<=">&lt;=</option>
					</select>
					<input
						type="number"
						class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
						bind:value={editEdgeValue}
						onblur={commitEdge}
					/>
				</div>
			{:else if selectedEdge.condition.type === 'custom'}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400">Custom Condition</label>
					<div class="h-20 overflow-hidden rounded border border-zinc-700">
						<MiniMonaco
							value={editEdgeCustomCode}
							language="gpc"
							label="Custom Condition"
							onchange={(v) => { editEdgeCustomCode = v; commitEdge(); }}
						/>
					</div>
				</div>
			{/if}

			<!-- Delete -->
			<button
				class="mt-4 w-full rounded border border-red-800 bg-red-950 px-2 py-1.5 text-xs text-red-300 hover:bg-red-900"
				onclick={onDelete}
			>
				Delete Edge
			</button>
		</div>
	{:else}
		<!-- ==================== No Selection ==================== -->
		<div class="border-b border-zinc-800 px-3 py-2">
			<h3 class="text-xs font-medium uppercase tracking-wider text-zinc-500">Properties</h3>
		</div>
		<div class="flex-1 px-3 py-4">
			<p class="text-xs text-zinc-500">
				Select a node or edge to edit its properties.
			</p>
			<div class="mt-4 space-y-2 text-xs text-zinc-600">
				<p>Drag from an output port (right) to an input port (left) to create edges.</p>
				<p>Middle-click or Alt+drag to pan. Scroll to zoom.</p>
				<p>Press Delete to remove selected items.</p>
			</div>
		</div>
	{/if}
</div>
