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
	import KeySelect from '$lib/components/inputs/KeySelect.svelte';
	import VariableSelect from '$lib/components/inputs/VariableSelect.svelte';
	import { getSettings } from '$lib/stores/settings.svelte';
	import { getProfiles } from '$lib/stores/flow.svelte';
	import { listSpriteCollections, readSpriteCollection } from '$lib/tauri/commands';
	import { base64ToSprite, bytesPerRow } from '$lib/utils/sprite-pixels';
	import { pixelsToBase64 } from '../../tools/oled/pixels';
	import { OLED_WIDTH } from '../../tools/oled/types';
	import type { SpriteCollectionSummary, SpriteCollection } from '$lib/types/sprite';
	import { renderNodePreview, pixelsToDataUrl } from '$lib/flow/oled-preview';
	import MenuLayoutBuilder from '$lib/components/editor/MenuLayoutBuilder.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { setKeyboardTransfer } from '$lib/stores/keyboard-transfer.svelte';
	import { setRecoilTransfer } from '$lib/stores/recoil-transfer.svelte';
	import type { ModuleNodeData } from '$lib/types/flow';

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
		onOpenWeaponData?: () => void;
		onOpenWeaponDetection?: () => void;
		gamePath?: string | null;
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
		onOpenWeaponData,
		onOpenWeaponDetection,
		gamePath = null,
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

	const nodeTypes: FlowNodeType[] = ['intro', 'home', 'menu', 'submenu', 'custom', 'screensaver', 'debug'];
	const conditionTypes: { value: FlowConditionType; label: string }[] = [
		{ value: 'button_press', label: 'Button Press' },
		{ value: 'button_hold', label: 'Button Hold' },
		{ value: 'timeout', label: 'Timeout' },
		{ value: 'variable', label: 'Variable' },
		{ value: 'custom', label: 'Custom Code' },
	];

	let codeTab = $state<'gpc' | 'enter' | 'exit' | 'init' | 'combo'>('gpc');
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
	let editNodeInitCode = $state('');
	let editComboCode = $state('');

	// Sync node → local state only when a different node is selected
	let lastSyncedNodeId = '';
	let syncedLabel = '';
	let syncedGpcCode = '';
	let syncedOnEnter = '';
	let syncedOnExit = '';
	let syncedNodeInitCode = '';
	let syncedComboCode = '';

	// Commit pending node edits before switching away
	function flushNodeEdits(nodeId: string) {
		if (!nodeId) return;
		const updates: Partial<FlowNode> = {};
		if (editLabel !== syncedLabel) updates.label = editLabel;
		if (editGpcCode !== syncedGpcCode) updates.gpcCode = editGpcCode;
		if (editOnEnter !== syncedOnEnter) updates.onEnter = editOnEnter;
		if (editOnExit !== syncedOnExit) updates.onExit = editOnExit;
		if (editNodeInitCode !== syncedNodeInitCode) updates.initCode = editNodeInitCode;
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
			editNodeInitCode = syncedNodeInitCode = selectedNode.initCode ?? '';
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
	let recoilToolWeaponIdx = $state(0);
	let isModuleNode = $derived(selectedNode?.type === 'module');
	let showLayoutBuilder = $state(false);
	let isMenuNode = $derived(
		selectedNode?.type === 'menu' || selectedNode?.type === 'submenu' ||
		selectedNode?.type === 'home' || selectedNode?.type === 'intro' ||
		selectedNode?.type === 'debug'
	);

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

	// Weapon data modal state removed — modals rendered in FlowEditor

	// Get weapon names from the weapondata module node in the gameplay flow
	let weaponNamesFromData = $derived.by(() => {
		const wdNode = gameplayModuleNodes.find((n) => n.moduleData?.moduleId === 'weapondata');
		return wdNode?.moduleData?.weaponNames ?? [];
	});

	function updateModuleParam(key: string, value: string) {
		if (!selectedNode?.moduleData) return;
		const md = { ...selectedNode.moduleData };
		const params = { ...(md.params ?? {}) };
		params[key] = value;
		md.params = params;
		onUpdateNode(selectedNode.id, { moduleData: md });
	}

	function updateQuickToggle(nodeId: string, currentModuleData: NonNullable<FlowNode['moduleData']>, newVal: string[] | undefined) {
		if (!currentModuleData) return;
		const md = { ...currentModuleData };
		md.quickToggle = newVal && newVal.length > 0 ? newVal : undefined;
		onUpdateNode(nodeId, { moduleData: md });
	}

	// Local editing state for sub-node
	let editSubLabel = $state('');
	let editSubDisplayText = $state('');
	let lastSyncedSubNodeId = '';
	let lastSyncedSubNodeParentId = '';

	function flushSubNodeEdits(parentId: string, subNodeId: string) {
		if (!parentId || !subNodeId) return;
		const updates: Partial<SubNode> = { label: editSubLabel };
		if (isTextSubNode) updates.displayText = editSubDisplayText || undefined;
		onUpdateSubNode(parentId, subNodeId, updates);
	}

	$effect(() => {
		if (selectedSubNode && selectedSubNode.id !== lastSyncedSubNodeId) {
			if (lastSyncedSubNodeId) flushSubNodeEdits(lastSyncedSubNodeParentId, lastSyncedSubNodeId);
			lastSyncedSubNodeId = selectedSubNode.id;
			lastSyncedSubNodeParentId = selectedNode?.id ?? '';
			editSubLabel = selectedSubNode.label;
			editSubDisplayText = selectedSubNode.displayText || '';
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
				// Only flush when switching to a different edge, not when condition type
				// changes on the same edge (the dropdown onchange already saved via onUpdateEdge)
				if (lastSyncedEdgeId && lastSyncedEdgeId !== selectedEdge.id) flushEdgeEdits(lastSyncedEdgeId);
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
		if (editNodeInitCode !== (selectedNode.initCode ?? '')) updates.initCode = editNodeInitCode;
		if (editComboCode !== selectedNode.comboCode) updates.comboCode = editComboCode;
		if (Object.keys(updates).length > 0) {
			onUpdateNode(selectedNode.id, updates);
		}
	}

	function commitSubNodeLabel() {
		if (!selectedNode || !selectedSubNode) return;
		const updates: Partial<SubNode> = {};
		if (editSubLabel !== selectedSubNode.label) updates.label = editSubLabel;
		if (isTextSubNode && (editSubDisplayText || '') !== (selectedSubNode.displayText || '')) {
			updates.displayText = editSubDisplayText || undefined;
		}
		if (Object.keys(updates).length > 0) {
			onUpdateSubNode(selectedNode.id, selectedSubNode.id, updates);
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

	// Drag and drop state for subnode reordering
	let dragSubNodeIdx = $state<number | null>(null);
	let dragOverSubNodeIdx = $state<number | null>(null);

	function handleSubNodeDragStart(e: DragEvent, idx: number) {
		dragSubNodeIdx = idx;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(idx));
		}
	}

	function handleSubNodeDragOver(e: DragEvent, idx: number) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dragOverSubNodeIdx = idx;
	}

	function handleSubNodeDragLeave() {
		dragOverSubNodeIdx = null;
	}

	function handleSubNodeDrop(e: DragEvent, toIdx: number) {
		e.preventDefault();
		if (dragSubNodeIdx !== null && dragSubNodeIdx !== toIdx && selectedNode) {
			onReorderSubNodes(selectedNode.id, dragSubNodeIdx, toIdx);
		}
		dragSubNodeIdx = null;
		dragOverSubNodeIdx = null;
	}

	function handleSubNodeDragEnd() {
		dragSubNodeIdx = null;
		dragOverSubNodeIdx = null;
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
			<!-- Name -->
			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400" for="subnode-label">Name</label>
				<input
					id="subnode-label"
					type="text"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
					bind:value={editSubLabel}
					onblur={commitSubNodeLabel}
					onkeydown={(e) => { if (e.key === 'Enter') commitSubNodeLabel(); }}
					placeholder="Sub-node name..."
				/>
			</div>

			<!-- Display Text (for text/interactive subnodes) -->
			{#if isTextSubNode}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400" for="subnode-display-text">Display Text</label>
					<input
						id="subnode-display-text"
						type="text"
						class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
						bind:value={editSubDisplayText}
						onblur={commitSubNodeLabel}
						onkeydown={(e) => { if (e.key === 'Enter') commitSubNodeLabel(); }}
						placeholder="Text on OLED (empty = value only)"
					/>
					<p class="mt-0.5 text-[10px] text-zinc-600">Text rendered on the OLED. Leave empty for value-only display.</p>
				</div>
			{/if}

			<!-- Interactive toggle (for naturally interactive subnode types) -->
			{#if ['menu-item', 'toggle-item', 'value-item', 'array-item'].includes(selectedSubNode.type)}
				<div class="mb-3">
					<label class="flex items-center gap-2 text-xs text-zinc-400">
						<input
							type="checkbox"
							class="accent-emerald-600"
							checked={selectedSubNode.interactive}
							onchange={(e) => onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, { interactive: (e.target as HTMLInputElement).checked })}
						/>
						Selectable
					</label>
					<p class="mt-0.5 text-[10px] text-zinc-600">When off, displays as text only (no cursor, no input)</p>
				</div>
			{/if}

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

			<!-- Conditional rendering -->
			<div class="mb-3">
				<label class="mb-1 flex items-center gap-2 text-xs text-zinc-400">
					<input
						type="checkbox"
						class="accent-emerald-600"
						checked={!!selectedSubNode.condition}
						onchange={(e) => {
							if ((e.target as HTMLInputElement).checked) {
								onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, {
									condition: { variable: '', comparison: '!=', value: 0 }
								});
							} else {
								onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, { condition: undefined });
							}
						}}
					/>
					Conditional Rendering
				</label>
				{#if selectedSubNode.condition}
					<div class="mt-1.5 flex gap-1.5">
						<div class="flex-1">
							<VariableSelect
								value={selectedSubNode.condition.variable}
								options={availableVariables}
								placeholder="Variable..."
								onchange={(val) => {
									onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, {
										condition: { ...selectedSubNode!.condition!, variable: val || '' }
									});
								}}
							/>
						</div>
						<select
							class="w-14 rounded border border-zinc-700 bg-zinc-800 px-1 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
							value={selectedSubNode.condition.comparison}
							onchange={(e) => {
								onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, {
									condition: { ...selectedSubNode!.condition!, comparison: (e.target as HTMLSelectElement).value as '==' | '!=' | '>' | '<' | '>=' | '<=' }
								});
							}}
						>
							<option value="==">=</option>
							<option value="!=">!=</option>
							<option value=">">&gt;</option>
							<option value="<">&lt;</option>
							<option value=">=">&gt;=</option>
							<option value="<=">&lt;=</option>
						</select>
						<input
							type="number"
							class="w-14 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
							value={selectedSubNode.condition.value}
							onchange={(e) => {
								onUpdateSubNode(selectedNode!.id, selectedSubNode!.id, {
									condition: { ...selectedSubNode!.condition!, value: parseInt((e.target as HTMLInputElement).value) || 0 }
								});
							}}
						/>
					</div>
					<p class="mt-1 text-[10px] text-zinc-600">
						Only renders when {selectedSubNode.condition.variable || '?'} {selectedSubNode.condition.comparison} {selectedSubNode.condition.value}
					</p>
				{/if}
			</div>

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
				{@const isData = selectedNode.moduleData.flowTarget === 'data'}
				<div class="mb-3 flex items-center gap-2">
					<span class="rounded px-2 py-0.5 text-xs {isData ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'}">
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

			<!-- Enable Variable (hidden for alwaysActive modules) -->
			{#if !selectedNode.moduleData?.alwaysActive}
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
			{/if}

			<!-- Button Params (modules that need custom buttons) -->
			{#if selectedNode.moduleData?.params && Object.keys(selectedNode.moduleData.params).length > 0}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400">Button Mapping</label>
					<div class="space-y-1.5">
						{#each Object.entries(selectedNode.moduleData.params) as [key, value]}
							<div>
								<label class="mb-0.5 block text-[10px] text-zinc-500">{key.replace(/_/g, ' ')}</label>
								<ButtonSelect
									{value}
									onchange={(v) => updateModuleParam(key, v)}
								/>
								<p class="mt-0.5 text-[10px] text-zinc-600">
									{selectedNode.moduleData?.moduleId.toUpperCase()}_{key.toUpperCase()}
								</p>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Quick Toggle (only for modules with a Status toggle, not data modules) -->
			{#if selectedNode.moduleData?.enableVariable && selectedNode.moduleData.options.some(o => o.type === 'toggle' && o.name === 'Status')}
			{#key selectedNode.id}
				{@const nodeId = selectedNode.id}
				{@const md = selectedNode.moduleData}
				{@const qt = md.quickToggle ?? []}
				{@const isKeyboard = qt.length === 1 && qt[0].startsWith('KEY_')}
				<div class="mb-3">
					<div class="mb-1 flex items-center justify-between">
						<label class="text-xs text-zinc-400">Quick Toggle</label>
						{#if qt.length > 0}
							<button
								type="button"
								class="text-[10px] text-zinc-500 hover:text-zinc-300"
								onclick={() => updateQuickToggle(nodeId, md, undefined)}
							>
								Clear
							</button>
						{/if}
					</div>
					<div class="mb-1.5 flex gap-1">
						<button
							type="button"
							class="rounded px-2 py-0.5 text-[10px] {!isKeyboard ? 'bg-emerald-900/40 text-emerald-300' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'}"
							onclick={() => { if (isKeyboard) updateQuickToggle(nodeId, md, undefined); }}
						>
							Controller
						</button>
						<button
							type="button"
							class="rounded px-2 py-0.5 text-[10px] {isKeyboard ? 'bg-emerald-900/40 text-emerald-300' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'}"
							onclick={() => { if (!isKeyboard) updateQuickToggle(nodeId, md, ['KEY_']); }}
						>
							Keyboard
						</button>
					</div>
					{#if isKeyboard}
						<KeySelect
							value={qt[0] === 'KEY_' ? '' : qt[0]}
							onchange={(v) => updateQuickToggle(nodeId, md, v ? [v] : undefined)}
							placeholder="Select key..."
						/>
						<p class="mt-0.5 text-[10px] text-zinc-600">Uses GetKeyboardKey()</p>
					{:else}
						<div class="flex items-center gap-1.5">
							<div class="flex-1">
								<ButtonSelect
									value={qt[0] ?? ''}
									onchange={(v) => updateQuickToggle(nodeId, md, v ? [v, ...(qt[1] ? [qt[1]] : [])] : qt[1] ? [qt[1]] : undefined)}
									placeholder="Hold..."
								/>
							</div>
							<span class="text-[10px] text-zinc-500">+</span>
							<div class="flex-1">
								<ButtonSelect
									value={qt[1] ?? ''}
									onchange={(v) => updateQuickToggle(nodeId, md, qt[0] ? [qt[0], ...(v ? [v] : [])] : v ? [v] : undefined)}
									placeholder="Press..."
								/>
							</div>
						</div>
						<p class="mt-0.5 text-[10px] text-zinc-600">Uses get_val() + event_press()</p>
					{/if}
				</div>
			{/key}
			{/if}

			<!-- Send to Keyboard Mapper (keyboard module only) -->
			{#if selectedNode.moduleData?.moduleId === 'keyboard'}
				<div class="mb-3">
					<div class="mb-1.5 flex items-center justify-between">
						<span class="text-xs text-zinc-400">Mappings</span>
						<span class="text-[10px] text-zinc-600">
							{selectedNode.moduleData.keyboardMappings?.length ?? 0} configured
						</span>
					</div>
					{#if (selectedNode.moduleData.keyboardMappings?.length ?? 0) > 0}
						<div class="mb-1.5 max-h-24 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/50">
							{#each selectedNode.moduleData.keyboardMappings ?? [] as mapping}
								<div class="flex items-center gap-1.5 border-b border-zinc-800/50 px-2 py-1 text-[10px] last:border-0"
									class:opacity-40={!mapping.enabled}
								>
									<span class="text-amber-400">{mapping.source}</span>
									{#if mapping.sourceCombo}
										<span class="text-zinc-600">+</span>
										<span class="text-amber-400">{mapping.sourceCombo}</span>
									{/if}
									<span class="text-zinc-600">&rarr;</span>
									<span class="text-emerald-400">{mapping.target}</span>
									{#if mapping.value !== 0 && mapping.value !== 100}
										<span class="text-zinc-500">({mapping.value})</span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
					<button
						class="w-full rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
						onclick={() => {
							if (!selectedNode?.moduleData) return;
							setKeyboardTransfer({
								mappings: [...(selectedNode.moduleData.keyboardMappings ?? [])],
								returnTo: null,
								outputConsole: 'ps5',
								inputConsole: 'ps5',
								returnPath: page.url.pathname,
								nodeId: selectedNode.id
							});
							goto('/tools/keyboard');
						}}
					>
						{(selectedNode.moduleData.keyboardMappings?.length ?? 0) > 0 ? 'Edit in Mapper' : 'Open Mapper'}
					</button>
					<p class="mt-0.5 text-[10px] text-zinc-600">Edit mappings visually in the Keyboard Mapper tool</p>
				</div>
			{/if}

			<!-- Weapon Data (weapondata module only) -->
			{#if selectedNode.moduleData?.moduleId === 'weapondata'}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400">Weapon Data</label>
					<button
						class="w-full rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
						onclick={() => { onOpenWeaponData?.(); }}
					>
						{(selectedNode.moduleData.weaponNames ?? []).length > 0
							? `Edit Weapons (${(selectedNode.moduleData.weaponNames ?? []).length})`
							: 'Configure Weapons'}
					</button>
					<p class="mt-0.5 text-[10px] text-zinc-600">
						Manage weapon names and per-weapon recoil values
					</p>
				</div>
			{/if}

			<!-- Weapon Detection (adp module only) -->
			{#if selectedNode.moduleData?.moduleId === 'adp'}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400">Weapon Detection</label>
					<button
						class="w-full rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
						onclick={() => { onOpenWeaponDetection?.(); }}
					>
						{(selectedNode.moduleData.adpProfiles ?? []).length > 0
							? `Edit ADT Profiles (${(selectedNode.moduleData.adpProfiles ?? []).length})`
							: 'Configure ADT Profiles'}
					</button>
					<p class="mt-0.5 text-[10px] text-zinc-600">
						{weaponNamesFromData.length > 0
							? `${weaponNamesFromData.length} weapons from Weapon Data module`
							: 'Add a Weapon Data module first to define weapons'}
					</p>
				</div>
			{/if}

			<!-- ProfileData exposed variables -->
			{#if selectedNode.moduleData?.moduleId === 'profiledata'}
				<div class="mb-3 rounded border border-emerald-900 bg-emerald-950/30 px-2 py-2">
					<p class="mb-1.5 text-xs font-medium text-emerald-400">Exposed Variables</p>
					<div class="space-y-1 text-[10px]">
						<div class="flex items-center justify-between">
							<span class="font-mono text-emerald-300">PROFILE_COUNT</span>
							<span class="text-zinc-500">define</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="font-mono text-emerald-300">ProfileLabels[]</span>
							<span class="text-zinc-500">const string[]</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="font-mono text-emerald-300">FLOW_PROFILE_COUNT</span>
							<span class="text-zinc-500">define</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="font-mono text-emerald-300">Flow_CurrentProfile</span>
							<span class="text-zinc-500">int variable</span>
						</div>
					</div>
					<p class="mt-1.5 text-[10px] text-zinc-600">Auto-populated from the project's Profile panel</p>
				</div>
			{/if}

			<!-- Array Builder UI -->
			{#if selectedNode.moduleData?.moduleId === 'arraybuilder'}
				{@const arrays = selectedNode.moduleData.customArrays ?? []}
				<div class="mb-3">
					<div class="mb-1 flex items-center justify-between">
						<label class="text-xs text-zinc-400">Arrays</label>
						<div class="flex gap-1">
							<button
								class="rounded px-1.5 py-0.5 text-xs text-emerald-400 hover:bg-zinc-800"
								onclick={() => {
									if (!selectedNode?.moduleData) return;
									const existing = selectedNode.moduleData.customArrays ?? [];
									const idx = existing.length + 1;
									const name = `Array${idx}`;
									onUpdateNode(selectedNode.id, {
										moduleData: {
											...selectedNode.moduleData,
											customArrays: [...existing, { name, countDefine: `${name.toUpperCase()}_COUNT`, values: ['Item 1'] }]
										}
									});
								}}
							>
								+ 1D
							</button>
							<button
								class="rounded px-1.5 py-0.5 text-xs text-blue-400 hover:bg-zinc-800"
								onclick={() => {
									if (!selectedNode?.moduleData) return;
									const existing = selectedNode.moduleData.customArrays ?? [];
									const idx = existing.length + 1;
									const name = `Array${idx}`;
									onUpdateNode(selectedNode.id, {
										moduleData: {
											...selectedNode.moduleData,
											customArrays: [...existing, { name, countDefine: `${name.toUpperCase()}_COUNT`, dimension: '2d', values: [], values2d: [['Item 1']] }]
										}
									});
								}}
							>
								+ 2D
							</button>
						</div>
					</div>
					{#if arrays.length > 0}
						<div class="space-y-2">
							{#each arrays as arr, ai}
								{@const is2d = arr.dimension === '2d'}
								<div class="rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1.5">
									<div class="mb-1 flex items-center gap-1">
										<input
											type="text"
											class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs font-medium text-emerald-300 focus:border-emerald-500 focus:outline-none"
											value={arr.name}
											placeholder="Array Name"
											onchange={(e) => {
												if (!selectedNode?.moduleData) return;
												const updated = [...(selectedNode.moduleData.customArrays ?? [])];
												const newName = (e.target as HTMLInputElement).value;
												updated[ai] = { ...updated[ai], name: newName, countDefine: `${newName.toUpperCase()}_COUNT` };
												onUpdateNode(selectedNode.id, { moduleData: { ...selectedNode.moduleData, customArrays: updated } });
											}}
										/>
										<span class="rounded bg-zinc-900 px-1 py-0.5 text-[9px] {is2d ? 'text-blue-400' : 'text-zinc-500'}">
											{is2d ? '[][]' : '[]'}
										</span>
										<button
											class="text-zinc-600 hover:text-red-400"
											onclick={() => {
												if (!selectedNode?.moduleData) return;
												const updated = [...(selectedNode.moduleData.customArrays ?? [])];
												updated.splice(ai, 1);
												onUpdateNode(selectedNode.id, { moduleData: { ...selectedNode.moduleData, customArrays: updated } });
											}}
										>
											<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
											</svg>
										</button>
									</div>

									{#if is2d}
										{@const rows = arr.values2d ?? []}
										{@const offsets = rows.reduce((acc, r, i) => { acc.push(i === 0 ? 0 : acc[i - 1] + rows[i - 1].length); return acc; }, [] as number[])}
										<p class="mb-0.5 text-[10px] text-zinc-600">
											<span class="font-mono text-zinc-500">{arr.countDefine}</span> = {rows.length}
										</p>
										<p class="mb-0.5 text-[10px] text-zinc-600">
											<span class="font-mono text-zinc-500">{arr.name}_Offsets[]</span> = [{offsets.join(', ')}]
										</p>
										<p class="mb-1 text-[10px] text-zinc-600">
											<span class="font-mono text-zinc-500">{arr.name}_RowCounts[]</span> = [{rows.map(r => r.length).join(', ')}]
										</p>
										<div class="space-y-1.5">
											{#each rows as row, ri}
												<div class="rounded border border-zinc-700/50 bg-zinc-900/50 px-1.5 py-1">
													<div class="mb-0.5 flex items-center justify-between">
														<span class="text-[9px] font-medium text-blue-400">Row {ri}</span>
														<div class="flex items-center gap-1">
															<span class="text-[9px] text-zinc-600">{row.length} items</span>
															<button
																class="text-zinc-600 hover:text-red-400"
																onclick={() => {
																	if (!selectedNode?.moduleData) return;
																	const updated = [...(selectedNode.moduleData.customArrays ?? [])];
																	const newRows = [...(updated[ai].values2d ?? [])];
																	newRows.splice(ri, 1);
																	updated[ai] = { ...updated[ai], values2d: newRows };
																	onUpdateNode(selectedNode.id, { moduleData: { ...selectedNode.moduleData, customArrays: updated } });
																}}
															>
																<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																	<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
																</svg>
															</button>
														</div>
													</div>
													<div class="space-y-0.5">
														{#each row as val, ci}
															<div class="flex items-center gap-1">
																<span class="w-4 text-right text-[9px] text-zinc-600">{ci}</span>
																<input
																	type="text"
																	class="flex-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none"
																	value={val}
																	onchange={(e) => {
																		if (!selectedNode?.moduleData) return;
																		const updated = [...(selectedNode.moduleData.customArrays ?? [])];
																		const newRows = [...(updated[ai].values2d ?? [])];
																		const newRow = [...newRows[ri]];
																		newRow[ci] = (e.target as HTMLInputElement).value;
																		newRows[ri] = newRow;
																		updated[ai] = { ...updated[ai], values2d: newRows };
																		onUpdateNode(selectedNode.id, { moduleData: { ...selectedNode.moduleData, customArrays: updated } });
																	}}
																/>
																<button
																	class="text-zinc-600 hover:text-red-400"
																	onclick={() => {
																		if (!selectedNode?.moduleData) return;
																		const updated = [...(selectedNode.moduleData.customArrays ?? [])];
																		const newRows = [...(updated[ai].values2d ?? [])];
																		const newRow = [...newRows[ri]];
																		newRow.splice(ci, 1);
																		newRows[ri] = newRow;
																		updated[ai] = { ...updated[ai], values2d: newRows };
																		onUpdateNode(selectedNode.id, { moduleData: { ...selectedNode.moduleData, customArrays: updated } });
																	}}
																>
																	<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
																	</svg>
																</button>
															</div>
														{/each}
													</div>
													<button
														class="mt-0.5 w-full rounded border border-dashed border-zinc-700/50 py-0.5 text-[10px] text-zinc-600 hover:border-zinc-600 hover:text-zinc-400"
														onclick={() => {
															if (!selectedNode?.moduleData) return;
															const updated = [...(selectedNode.moduleData.customArrays ?? [])];
															const newRows = [...(updated[ai].values2d ?? [])];
															newRows[ri] = [...newRows[ri], ''];
															updated[ai] = { ...updated[ai], values2d: newRows };
															onUpdateNode(selectedNode.id, { moduleData: { ...selectedNode.moduleData, customArrays: updated } });
														}}
													>
														+ Item
													</button>
												</div>
											{/each}
										</div>
										<button
											class="mt-1 w-full rounded border border-dashed border-zinc-700 py-0.5 text-[10px] text-blue-500 hover:border-blue-700 hover:text-blue-400"
											onclick={() => {
												if (!selectedNode?.moduleData) return;
												const updated = [...(selectedNode.moduleData.customArrays ?? [])];
												const newRows = [...(updated[ai].values2d ?? [])];
												newRows.push(['']);
												updated[ai] = { ...updated[ai], values2d: newRows };
												onUpdateNode(selectedNode.id, { moduleData: { ...selectedNode.moduleData, customArrays: updated } });
											}}
										>
											+ Add Row
										</button>
									{:else}
										<p class="mb-1 text-[10px] text-zinc-600">
											<span class="font-mono text-zinc-500">{arr.countDefine}</span> = {arr.values.length}
										</p>
										<div class="space-y-0.5">
											{#each arr.values as val, vi}
												<div class="flex items-center gap-1">
													<span class="w-4 text-right text-[9px] text-zinc-600">{vi}</span>
													<input
														type="text"
														class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
														value={val}
														onchange={(e) => {
															if (!selectedNode?.moduleData) return;
															const updated = [...(selectedNode.moduleData.customArrays ?? [])];
															const newValues = [...updated[ai].values];
															newValues[vi] = (e.target as HTMLInputElement).value;
															updated[ai] = { ...updated[ai], values: newValues };
															onUpdateNode(selectedNode.id, { moduleData: { ...selectedNode.moduleData, customArrays: updated } });
														}}
													/>
													<button
														class="text-zinc-600 hover:text-red-400"
														onclick={() => {
															if (!selectedNode?.moduleData) return;
															const updated = [...(selectedNode.moduleData.customArrays ?? [])];
															const newValues = [...updated[ai].values];
															newValues.splice(vi, 1);
															updated[ai] = { ...updated[ai], values: newValues };
															onUpdateNode(selectedNode.id, { moduleData: { ...selectedNode.moduleData, customArrays: updated } });
														}}
													>
														<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
														</svg>
													</button>
												</div>
											{/each}
										</div>
										<button
											class="mt-1 w-full rounded border border-dashed border-zinc-700 py-0.5 text-[10px] text-zinc-500 hover:border-zinc-600 hover:text-zinc-400"
											onclick={() => {
												if (!selectedNode?.moduleData) return;
												const updated = [...(selectedNode.moduleData.customArrays ?? [])];
												updated[ai] = { ...updated[ai], values: [...updated[ai].values, ''] };
												onUpdateNode(selectedNode.id, { moduleData: { ...selectedNode.moduleData, customArrays: updated } });
											}}
										>
											+ Add Item
										</button>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<div class="rounded border border-dashed border-zinc-700 px-2 py-2 text-center text-xs text-zinc-600">
							No arrays defined
						</div>
					{/if}
					<p class="mt-1 text-[10px] text-zinc-600">
						<span class="font-mono">[]</span> flat string array &middot;
						<span class="font-mono">[][]</span> 2D array for cascading items
					</p>
				</div>
			{/if}

			<!-- Send to Recoil Tool (antirecoil_timeline module only) -->
			{#if selectedNode.moduleData?.moduleId === 'antirecoil_timeline'}
				<div class="mb-3">
					<label class="mb-1 block text-xs text-zinc-400">Recoil Timeline</label>
					{#if weaponNamesFromData.length > 0}
						<select
							class="mb-1.5 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200"
							value={recoilToolWeaponIdx}
							onchange={(e) => { recoilToolWeaponIdx = parseInt((e.target as HTMLSelectElement).value); }}
						>
							{#each weaponNamesFromData as name, i}
								<option value={i}>{i}. {name}</option>
							{/each}
						</select>
					{/if}
					<button
						class="w-full rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
						onclick={() => {
							setRecoilTransfer({
								weaponName: weaponNamesFromData[recoilToolWeaponIdx] ?? '',
								weaponIndex: recoilToolWeaponIdx,
								values: [],
								returnTo: gamePath ? gamePath + '/recoiltable.gpc' : null
							});
							goto('/tools/recoil');
						}}
					>
						Open Spray Tool
					</button>
					<p class="mt-0.5 text-[10px] text-zinc-600">Draw spray patterns to generate recoil phase values</p>
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
						...(selectedNode?.moduleData?.moduleId === 'keyboard' ? [] : [{ key: 'combos', label: 'Combos' }]),
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
										onchange={(e) => updateModuleOption(i, { type: (e.target as HTMLSelectElement).value as 'toggle' | 'value' | 'array' })}
									>
										<option value="toggle">Toggle</option>
										<option value="value">Value</option>
										<option value="array">Array</option>
									</select>
								</div>
								{#if opt.type === 'value' || opt.type === 'array'}
									<div class="mt-1 flex items-center gap-1">
										<span class="text-[10px] text-zinc-500">Default</span>
										<input
											type="number"
											class="w-14 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
											value={opt.defaultValue}
											onchange={(e) => updateModuleOption(i, { defaultValue: parseInt((e.target as HTMLInputElement).value) || 0 })}
										/>
										<span class="text-[10px] text-zinc-500">Min</span>
										<input
											type="number"
											class="w-12 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
											value={opt.min ?? 0}
											onchange={(e) => updateModuleOption(i, { min: parseInt((e.target as HTMLInputElement).value) || 0 })}
										/>
										<span class="text-[10px] text-zinc-500">Max</span>
										<input
											type="number"
											class="w-12 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
											value={opt.max ?? 100}
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

			<!-- Variables (only those NOT already managed by Options) -->
			{#if selectedNode.variables.some((v) => !(selectedNode.moduleData?.options ?? []).some((o) => o.variable === v.name)) || !selectedNode.moduleData?.options.length}
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
					{#each selectedNode.variables.map((v, i) => ({ variable: v, index: i })).filter(({ variable }) => !(selectedNode.moduleData?.options ?? []).some((o) => o.variable === variable.name)) as { variable, index: i }}
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
						<div class="mb-1 ml-1 flex items-center gap-1">
							<span class="text-[10px] text-zinc-500">Default</span>
							<input
								type="number"
								class="w-16 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
								value={typeof variable.defaultValue === 'number' ? variable.defaultValue : 0}
								onchange={(e) => updateVariable(i, { defaultValue: parseInt((e.target as HTMLInputElement).value) || 0 })}
							/>
							<span class="text-[10px] text-zinc-500">Min</span>
							<input
								type="number"
								class="w-14 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
								value={variable.min ?? ''}
								placeholder="—"
								onchange={(e) => { const v = (e.target as HTMLInputElement).value; updateVariable(i, { min: v === '' ? undefined : parseInt(v) }); }}
							/>
							<span class="text-[10px] text-zinc-500">Max</span>
							<input
								type="number"
								class="w-14 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
								value={variable.max ?? ''}
								placeholder="—"
								onchange={(e) => { const v = (e.target as HTMLInputElement).value; updateVariable(i, { max: v === '' ? undefined : parseInt(v) }); }}
							/>
						</div>
						<div class="mb-1 ml-1 flex items-center gap-2">
							<label class="flex items-center gap-1 text-[10px] text-zinc-500">
								<input
									type="checkbox"
									class="accent-emerald-500"
									checked={variable.persist}
									onchange={(e) => updateVariable(i, { persist: (e.target as HTMLInputElement).checked })}
								/>
								Persist
							</label>
							{#if getProfiles().length > 1}
								<label class="flex items-center gap-1 text-[10px] text-zinc-500">
									<input
										type="checkbox"
										class="accent-emerald-500"
										checked={variable.perProfile ?? false}
										onchange={(e) => updateVariable(i, { perProfile: (e.target as HTMLInputElement).checked || undefined })}
									/>
									Per Profile
								</label>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

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
			<!-- OLED Preview + Layout Builder button for menu nodes -->
			{#if isMenuNode && selectedNode.subNodes.length > 0}
				<div class="mb-3">
					{#if oledPreview}
						<div class="rounded border border-zinc-800 bg-zinc-950 p-2">
							<img
								src={oledPreview}
								alt="OLED preview"
								class="w-full"
								style="image-rendering: pixelated;"
							/>
						</div>
					{/if}
					<button
						class="mt-1.5 w-full rounded bg-zinc-700 px-2 py-1.5 text-[11px] font-medium text-zinc-200 hover:bg-zinc-600"
						onclick={() => (showLayoutBuilder = true)}
					>
						Open Layout Builder
					</button>
				</div>
			{:else if oledPreview}
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
							<div
								class="flex items-center gap-1 rounded px-1.5 py-1 transition-colors {dragOverSubNodeIdx === i && dragSubNodeIdx !== i ? 'border border-emerald-500/50 bg-emerald-900/20' : 'bg-zinc-800'} {dragSubNodeIdx === i ? 'opacity-40' : ''}"
								draggable="true"
								ondragstart={(e) => handleSubNodeDragStart(e, i)}
								ondragover={(e) => handleSubNodeDragOver(e, i)}
								ondragleave={handleSubNodeDragLeave}
								ondrop={(e) => handleSubNodeDrop(e, i)}
								ondragend={handleSubNodeDragEnd}
							>
								<!-- Drag handle + reorder buttons -->
								<div class="flex flex-col cursor-grab active:cursor-grabbing">
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
						{#if selectedNode.backButton === '_ANY_BUTTON'}
							<div class="flex h-[38px] items-center rounded-md border border-emerald-700 bg-emerald-950/40 px-3 text-sm text-emerald-400">
								Any Button
							</div>
						{:else}
							<ButtonSelect
								value={selectedNode.backButton || ''}
								onchange={(v) => onUpdateNode(selectedNode!.id, { backButton: v || undefined })}
								placeholder="None (no back navigation)"
							/>
						{/if}
					</div>
					<button
						class="rounded px-1.5 py-1 text-xs {selectedNode.backButton === '_ANY_BUTTON' ? 'bg-emerald-900/40 text-emerald-400' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}"
						title="Any button (e.g. for screensavers)"
						onclick={() => onUpdateNode(selectedNode!.id, { backButton: selectedNode!.backButton === '_ANY_BUTTON' ? undefined : '_ANY_BUTTON' })}
					>
						Any
					</button>
					{#if selectedNode.backButton && selectedNode.backButton !== '_ANY_BUTTON'}
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
				<p class="mt-0.5 text-[10px] text-zinc-600">
					{selectedNode.backButton === '_ANY_BUTTON' ? 'Any button press returns to previous state' : 'Returns to the previous state when pressed'}
				</p>
			</div>

			<!-- Block Inputs -->
			<div class="mb-3">
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						class="accent-emerald-500"
						checked={selectedNode.blockInputs ?? false}
						onchange={(e) => onUpdateNode(selectedNode!.id, { blockInputs: (e.target as HTMLInputElement).checked })}
					/>
					<span class="text-xs text-zinc-300">Block All Inputs</span>
				</label>
				<p class="mt-0.5 ml-5 text-[10px] text-zinc-600">Calls block_all_inputs() to prevent button presses from reaching the console while in this state</p>
			</div>

			<!-- Code Tabs -->
			<div class="mb-2">
				<label class="mb-1 block text-xs text-zinc-400">Code</label>
				<div class="flex gap-0.5 rounded bg-zinc-800 p-0.5">
					{#each [
						{ key: 'gpc', label: 'Main' },
						{ key: 'enter', label: 'Enter' },
						{ key: 'exit', label: 'Exit' },
						{ key: 'init', label: 'Init' },
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
				{:else if codeTab === 'init'}
					<MiniMonaco
						value={editNodeInitCode}
						language="gpc"
						label="Init Code"
						onchange={(v) => { editNodeInitCode = v; commitNodeCode(); }}
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
						<div class="mb-1 ml-1 flex items-center gap-2">
							<label class="flex items-center gap-1 text-[10px] text-zinc-500">
								<input
									type="checkbox"
									class="accent-emerald-500"
									checked={variable.persist}
									onchange={(e) => updateVariable(i, { persist: (e.target as HTMLInputElement).checked })}
								/>
								Persist
							</label>
						</div>
					{:else}
						<div class="mb-1 ml-1 flex items-center gap-1">
							<span class="text-[10px] text-zinc-500">Default</span>
							<input
								type="number"
								class="w-16 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
								value={typeof variable.defaultValue === 'number' ? variable.defaultValue : 0}
								onchange={(e) => updateVariable(i, { defaultValue: parseInt((e.target as HTMLInputElement).value) || 0 })}
							/>
							<span class="text-[10px] text-zinc-500">Min</span>
							<input
								type="number"
								class="w-14 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
								value={variable.min ?? ''}
								placeholder="—"
								onchange={(e) => { const v = (e.target as HTMLInputElement).value; updateVariable(i, { min: v === '' ? undefined : parseInt(v) }); }}
							/>
							<span class="text-[10px] text-zinc-500">Max</span>
							<input
								type="number"
								class="w-14 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
								value={variable.max ?? ''}
								placeholder="—"
								onchange={(e) => { const v = (e.target as HTMLInputElement).value; updateVariable(i, { max: v === '' ? undefined : parseInt(v) }); }}
							/>
						</div>
						<div class="mb-1 ml-1 flex items-center gap-2">
							<label class="flex items-center gap-1 text-[10px] text-zinc-500">
								<input
									type="checkbox"
									class="accent-emerald-500"
									checked={variable.persist}
									onchange={(e) => updateVariable(i, { persist: (e.target as HTMLInputElement).checked })}
								/>
								Persist
							</label>
							{#if getProfiles().length > 1}
								<label class="flex items-center gap-1 text-[10px] text-zinc-500">
									<input
										type="checkbox"
										class="accent-emerald-500"
										checked={variable.perProfile ?? false}
										onchange={(e) => updateVariable(i, { perProfile: (e.target as HTMLInputElement).checked || undefined })}
									/>
									Per Profile
								</label>
							{/if}
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

{#if selectedNode && isMenuNode}
	<MenuLayoutBuilder
		open={showLayoutBuilder}
		node={selectedNode}
		{onUpdateNode}
		{onAddSubNode}
		{onRemoveSubNode}
		{onUpdateSubNode}
		onclose={() => (showLayoutBuilder = false)}
	/>
{/if}

