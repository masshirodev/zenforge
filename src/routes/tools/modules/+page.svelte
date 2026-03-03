<script lang="ts">
	import { onMount } from 'svelte';
	import { listModules, getModule, saveUserModule, deleteUserModule } from '$lib/tauri/commands';
	import { addToast } from '$lib/stores/toast.svelte';
	import { getSettings, getAllGameTypes } from '$lib/stores/settings.svelte';
	import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
	import ConfirmDialog from '$lib/components/modals/ConfirmDialog.svelte';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';
	import type { ModuleSummary, ModuleDefinition } from '$lib/types/module';

	let settingsStore = getSettings();
	let settings = $derived($settingsStore);

	// Module list state
	let modules = $state<ModuleSummary[]>([]);
	let loading = $state(true);
	let searchQuery = $state('');
	let filterTab = $state<'all' | 'user' | 'builtin'>('all');

	// Selection / mode
	let selectedModuleId = $state<string | null>(null);
	let selectedModule = $state<ModuleDefinition | null>(null);
	let loadingDetail = $state(false);
	let mode = $state<'browse' | 'create' | 'edit'>('browse');

	// Confirm dialog
	let confirmDialog = $state({ open: false, title: '', message: '', moduleId: '' });

	// Form state
	let moduleId = $state('');
	let displayName = $state('');
	let moduleType = $state('fps');
	let gameTypeOptions = $derived([...getAllGameTypes(settings), 'all']);
	let description = $state('');
	let hasQuickToggle = $state(false);
	let stateDisplay = $state('');
	let statusVar = $state('');
	let options = $state<
		Array<{
			name: string;
			var: string;
			type: 'toggle' | 'value';
			default: string;
			min: string;
			max: string;
		}>
	>([]);
	let trigger = $state('');
	let combo = $state('');
	let showAdvanced = $state(false);
	let conflicts = $state<string[]>([]);
	let conflictInput = $state('');
	let needsWeapondata = $state(false);
	let needsRecoiltable = $state(false);
	let requiresKeyboardFile = $state(false);
	let menuPriority = $state('');
	let extraVars = $state<Array<{ name: string; type: string }>>([]);
	let params = $state<Array<{ key: string; prompt: string; type: string; default: string }>>([]);
	let hasConfigMenu = $state(false);
	let configMenuName = $state('');
	let configMenuType = $state('clickable');
	let configMenuDisplayFn = $state('');
	let configMenuEditFn = $state('');
	let configMenuRenderFn = $state('');
	let configMenuProfileAware = $state(false);

	let saving = $state(false);
	let formError = $state('');

	// Filtered modules
	let filteredModules = $derived.by(() => {
		let list = modules;
		if (filterTab === 'user') list = list.filter((m) => m.is_user_module);
		else if (filterTab === 'builtin') list = list.filter((m) => !m.is_user_module);
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			list = list.filter(
				(m) =>
					m.id.toLowerCase().includes(q) ||
					m.display_name.toLowerCase().includes(q) ||
					(m.description && m.description.toLowerCase().includes(q))
			);
		}
		return list;
	});

	onMount(() => {
		loadModules();
	});

	async function loadModules() {
		loading = true;
		try {
			modules = await listModules(undefined, settings.workspaces);
		} catch (e) {
			addToast(`Failed to load modules: ${e}`, 'error');
		} finally {
			loading = false;
		}
	}

	async function selectModule(id: string) {
		if (mode !== 'browse') return;
		selectedModuleId = id;
		loadingDetail = true;
		try {
			selectedModule = await getModule(id, settings.workspaces);
		} catch (e) {
			addToast(`Failed to load module: ${e}`, 'error');
			selectedModule = null;
		} finally {
			loadingDetail = false;
		}
	}

	function resetForm() {
		moduleId = '';
		displayName = '';
		moduleType = 'fps';
		description = '';
		hasQuickToggle = false;
		stateDisplay = '';
		statusVar = '';
		options = [];
		trigger = '';
		combo = '';
		showAdvanced = false;
		conflicts = [];
		conflictInput = '';
		needsWeapondata = false;
		needsRecoiltable = false;
		requiresKeyboardFile = false;
		menuPriority = '';
		extraVars = [];
		params = [];
		hasConfigMenu = false;
		configMenuName = '';
		configMenuType = 'clickable';
		configMenuDisplayFn = '';
		configMenuEditFn = '';
		configMenuRenderFn = '';
		configMenuProfileAware = false;
		formError = '';
	}

	function enterCreateMode() {
		resetForm();
		mode = 'create';
		selectedModuleId = null;
		selectedModule = null;
	}

	async function enterEditMode(mod: ModuleDefinition) {
		resetForm();
		moduleId = mod.id;
		displayName = mod.display_name;
		moduleType = mod.type;
		description = mod.description ?? '';
		hasQuickToggle = mod.has_quick_toggle ?? false;
		stateDisplay = mod.state_display ?? '';
		statusVar = mod.status_var ?? '';
		options = (mod.options ?? []).map((o) => ({
			name: o.name,
			var: o.var,
			type: (o.type === 'value' ? 'value' : 'toggle') as 'toggle' | 'value',
			default: String(o.default ?? '0'),
			min: String(o.min ?? '0'),
			max: String(o.max ?? '100')
		}));
		trigger = mod.trigger ?? '';
		combo = mod.combo ?? '';
		conflicts = [...(mod.conflicts ?? [])];
		needsWeapondata = mod.needs_weapondata ?? false;
		needsRecoiltable = false;
		requiresKeyboardFile = mod.requires_keyboard_file ?? false;
		menuPriority = mod.menu_priority !== undefined ? String(mod.menu_priority) : '';
		extraVars = Object.entries(mod.extra_vars ?? {}).map(([name, type]) => ({ name, type }));
		params = (mod.params ?? []).map((p) => ({
			key: p.key,
			prompt: p.prompt,
			type: p.type,
			default: p.default ?? ''
		}));
		if (mod.config_menu) {
			hasConfigMenu = true;
			configMenuName = mod.config_menu.name ?? '';
			configMenuType = mod.config_menu.type ?? 'clickable';
			configMenuDisplayFn = mod.config_menu.display_function ?? '';
			configMenuEditFn = mod.config_menu.edit_function ?? '';
			configMenuRenderFn = '';
			configMenuProfileAware = mod.config_menu.profile_aware ?? false;
		}
		showAdvanced =
			conflicts.length > 0 ||
			needsWeapondata ||
			needsRecoiltable ||
			requiresKeyboardFile ||
			menuPriority !== '' ||
			extraVars.length > 0 ||
			params.length > 0 ||
			hasConfigMenu;
		mode = 'edit';
	}

	function cancelForm() {
		resetForm();
		mode = 'browse';
	}

	// Form helpers
	function addOption() {
		options = [
			...options,
			{ name: '', var: '', type: 'toggle', default: '0', min: '0', max: '100' }
		];
	}
	function removeOption(index: number) {
		options = options.filter((_, i) => i !== index);
	}
	function addConflict() {
		const id = conflictInput.trim().toLowerCase();
		if (id && !conflicts.includes(id)) {
			conflicts = [...conflicts, id];
			conflictInput = '';
		}
	}
	function removeConflict(id: string) {
		conflicts = conflicts.filter((c) => c !== id);
	}
	function addExtraVar() {
		extraVars = [...extraVars, { name: '', type: 'int' }];
	}
	function removeExtraVar(index: number) {
		extraVars = extraVars.filter((_, i) => i !== index);
	}
	function addParam() {
		params = [...params, { key: '', prompt: '', type: 'button', default: '' }];
	}
	function removeParam(index: number) {
		params = params.filter((_, i) => i !== index);
	}

	function generateToml(): string {
		let out = `[${moduleId}]\n`;
		out += `id = "${moduleId}"\n`;
		out += `display_name = "${displayName}"\n`;
		out += `type = "${moduleType}"\n`;
		if (description) out += `description = "${description}"\n`;
		if (stateDisplay) out += `state_display = "${stateDisplay}"\n`;
		if (statusVar) out += `status_var = "${statusVar}"\n`;
		if (hasQuickToggle) out += `has_quick_toggle = true\n`;
		if (needsWeapondata) out += `needs_weapondata = true\n`;
		if (needsRecoiltable) out += `needs_recoiltable = true\n`;
		if (requiresKeyboardFile) out += `requires_keyboard_file = true\n`;
		if (menuPriority !== '') out += `menu_priority = ${parseInt(menuPriority) || 0}\n`;
		if (conflicts.length > 0)
			out += `conflicts = [${conflicts.map((c) => `"${c}"`).join(', ')}]\n`;
		if (trigger.trim()) out += `trigger = """\n${trigger.trim()}\n"""\n`;
		if (combo.trim()) out += `combo = """\n${combo.trim()}\n"""\n`;

		for (const opt of options) {
			if (!opt.name || !opt.var) continue;
			out += `\n[[${moduleId}.options]]\n`;
			out += `name = "${opt.name}"\n`;
			out += `var = "${opt.var}"\n`;
			out += `type = "${opt.type}"\n`;
			out += `default = ${opt.default || '0'}\n`;
			if (opt.type === 'value') {
				out += `min = ${opt.min || '0'}\n`;
				out += `max = ${opt.max || '100'}\n`;
			}
		}
		for (const p of params) {
			if (!p.key) continue;
			out += `\n[[${moduleId}.params]]\n`;
			out += `key = "${p.key}"\n`;
			out += `prompt = "${p.prompt}"\n`;
			out += `type = "${p.type}"\n`;
			if (p.default) out += `default = "${p.default}"\n`;
		}
		const validVars = extraVars.filter((v) => v.name.trim());
		if (validVars.length > 0) {
			out += `\n[${moduleId}.extra_vars]\n`;
			for (const v of validVars) {
				out += `${v.name} = "${v.type}"\n`;
			}
		}
		if (hasConfigMenu && configMenuName) {
			out += `\n[${moduleId}.config_menu]\n`;
			out += `name = "${configMenuName}"\n`;
			out += `type = "${configMenuType}"\n`;
			if (configMenuDisplayFn) out += `display_function = "${configMenuDisplayFn}"\n`;
			if (configMenuEditFn) out += `edit_function = "${configMenuEditFn}"\n`;
			if (configMenuRenderFn) out += `render_function = "${configMenuRenderFn}"\n`;
			if (configMenuProfileAware) out += `profile_aware = true\n`;
		}
		return out;
	}

	async function handleSave() {
		if (!moduleId.trim() || !displayName.trim() || saving) return;
		if (!/^[a-z][a-z0-9_]*$/.test(moduleId)) {
			formError =
				'Module ID must start with a letter and contain only lowercase letters, numbers, and underscores.';
			return;
		}
		if (settings.workspaces.length === 0) {
			formError = 'No workspace configured. Add a workspace in Settings first.';
			return;
		}

		saving = true;
		formError = '';
		try {
			const toml = generateToml();
			await saveUserModule(settings.workspaces[0], toml);
			addToast(
				mode === 'create'
					? `Module "${displayName}" created`
					: `Module "${displayName}" updated`,
				'success'
			);
			resetForm();
			mode = 'browse';
			await loadModules();
		} catch (e) {
			formError = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	function confirmDelete(mod: ModuleSummary) {
		confirmDialog = {
			open: true,
			title: 'Delete Module',
			message: `Are you sure you want to delete "${mod.display_name}" (${mod.id})? This cannot be undone.`,
			moduleId: mod.id
		};
	}

	async function handleDelete() {
		const id = confirmDialog.moduleId;
		confirmDialog = { open: false, title: '', message: '', moduleId: '' };
		try {
			await deleteUserModule(id, settings.workspaces);
			addToast(`Module "${id}" deleted`, 'success');
			if (selectedModuleId === id) {
				selectedModuleId = null;
				selectedModule = null;
			}
			await loadModules();
		} catch (e) {
			addToast(`Failed to delete module: ${e}`, 'error');
		}
	}
</script>

<div class="flex h-full flex-col bg-zinc-950 text-zinc-200">
	<!-- Top Bar -->
	<ToolHeader title="Module Manager" subtitle="Browse, install, and configure game modules">
		{#if mode === 'browse'}
			<div class="ml-auto flex items-center gap-2">
				<button
					class="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
					onclick={enterCreateMode}
				>
					+ New Module
				</button>
			</div>
		{/if}
	</ToolHeader>

	<!-- Main Content -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Left Panel: Module List -->
		<div class="flex w-80 shrink-0 flex-col border-r border-zinc-800">
			<!-- Search + Filter -->
			<div class="space-y-2 border-b border-zinc-800 p-3">
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search modules..."
					class="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
				/>
				<div class="flex gap-1">
					{#each [
						['all', 'All'],
						['user', 'User'],
						['builtin', 'Built-in']
					] as [value, label]}
						<button
							class="rounded px-2.5 py-1 text-xs transition-colors {filterTab === value
								? 'bg-zinc-700 text-zinc-100'
								: 'text-zinc-500 hover:text-zinc-300'}"
							onclick={() => (filterTab = value as 'all' | 'user' | 'builtin')}
						>
							{label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Module List -->
			<div class="flex-1 overflow-y-auto">
				{#if loading}
					<div class="px-3 py-6 text-center text-xs text-zinc-500">Loading modules...</div>
				{:else if filteredModules.length === 0}
					<div class="px-3 py-6 text-center text-xs text-zinc-500">No modules found</div>
				{:else}
					{#each filteredModules as mod (mod.id)}
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div
							class="group flex w-full cursor-pointer items-start gap-2 border-b border-zinc-800/50 px-3 py-2.5 text-left transition-colors {selectedModuleId ===
								mod.id && mode === 'browse'
								? 'bg-zinc-800/80'
								: 'hover:bg-zinc-900'}"
							onclick={() => selectModule(mod.id)}
						>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="truncate text-xs font-medium text-zinc-200"
										>{mod.display_name}</span
									>
									<span
										class="shrink-0 rounded px-1.5 py-0.5 text-[10px] {mod.is_user_module
											? 'bg-blue-900/40 text-blue-400'
											: 'bg-zinc-800 text-zinc-500'}"
									>
										{mod.is_user_module ? 'user' : 'built-in'}
									</span>
								</div>
								<div class="mt-0.5 flex items-center gap-2">
									<span class="text-[10px] text-zinc-600">{mod.id}</span>
									<span
										class="rounded bg-zinc-800/60 px-1 py-0.5 text-[10px] text-zinc-500"
										>{mod.module_type}</span
									>
								</div>
								{#if mod.description}
									<p class="mt-1 truncate text-[10px] text-zinc-500">
										{mod.description}
									</p>
								{/if}
							</div>
							{#if mod.is_user_module}
								<button
									class="shrink-0 rounded p-1 text-zinc-600 opacity-0 hover:text-red-400 group-hover:opacity-100"
									onclick={(e) => {
										e.stopPropagation();
										confirmDelete(mod);
									}}
									title="Delete module"
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
							{/if}
						</div>
					{/each}
				{/if}
			</div>

			<!-- List footer -->
			<div class="border-t border-zinc-800 px-3 py-2 text-[10px] text-zinc-600">
				{filteredModules.length} module{filteredModules.length !== 1 ? 's' : ''}
			</div>
		</div>

		<!-- Right Panel: Detail / Form -->
		<div class="flex flex-1 flex-col overflow-hidden">
			{#if mode === 'create' || mode === 'edit'}
				<!-- Create / Edit Form -->
				<div class="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
					<h2 class="text-sm font-semibold text-zinc-200">
						{mode === 'create' ? 'Create Module' : `Edit: ${displayName || moduleId}`}
					</h2>
					<div class="flex items-center gap-2">
						<button
							class="rounded px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
							onclick={cancelForm}
							disabled={saving}
						>
							Cancel
						</button>
						<button
							class="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
							onclick={handleSave}
							disabled={!moduleId.trim() || !displayName.trim() || saving}
						>
							{saving
								? 'Saving...'
								: mode === 'create'
									? 'Create Module'
									: 'Save Changes'}
						</button>
					</div>
				</div>

				<div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
					<!-- Basic Info -->
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label class="mb-1 block text-sm text-zinc-300" for="mod-id">Module ID</label
							>
							<input
								id="mod-id"
								type="text"
								bind:value={moduleId}
								placeholder="e.g., my_feature"
								class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
								disabled={saving || mode === 'edit'}
							/>
							<p class="mt-1 text-xs text-zinc-500">Lowercase, no spaces (a-z, 0-9, _)</p>
						</div>
						<div>
							<label class="mb-1 block text-sm text-zinc-300" for="mod-name"
								>Display Name</label
							>
							<input
								id="mod-name"
								type="text"
								bind:value={displayName}
								placeholder="e.g., My Feature"
								class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
								disabled={saving}
							/>
						</div>
					</div>

					<div class="grid grid-cols-2 gap-4">
						<div>
							<label class="mb-1 block text-sm text-zinc-300" for="mod-type">Game Type</label
							>
							<select
								id="mod-type"
								bind:value={moduleType}
								class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
								disabled={saving}
							>
								{#each gameTypeOptions as type}
									<option value={type}
										>{type === 'all' ? 'All Types' : type.toUpperCase()}</option
									>
								{/each}
							</select>
						</div>
						<div>
							<label class="mb-1 block text-sm text-zinc-300" for="mod-desc"
								>Description</label
							>
							<input
								id="mod-desc"
								type="text"
								bind:value={description}
								placeholder="Brief description"
								class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
								disabled={saving}
							/>
						</div>
					</div>

					<!-- Status display / Quick Toggle -->
					<div class="grid grid-cols-3 gap-4">
						<div>
							<label class="mb-1 block text-sm text-zinc-300" for="mod-sd"
								>State Display</label
							>
							<input
								id="mod-sd"
								type="text"
								bind:value={stateDisplay}
								placeholder="e.g., MF"
								class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
								disabled={saving}
							/>
							<p class="mt-1 text-xs text-zinc-500">Short label for OLED</p>
						</div>
						<div>
							<label class="mb-1 block text-sm text-zinc-300" for="mod-sv"
								>Status Variable</label
							>
							<input
								id="mod-sv"
								type="text"
								bind:value={statusVar}
								placeholder="e.g., MyFeatureStatus"
								class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
								disabled={saving}
							/>
						</div>
						<div>
							<label class="mb-1 block text-sm text-zinc-300">Quick Toggle</label>
							<div
								class="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-3 py-2"
							>
								<input
									type="checkbox"
									bind:checked={hasQuickToggle}
									class="rounded border-zinc-600 bg-zinc-800 text-emerald-600 focus:ring-emerald-500"
									disabled={saving}
								/>
								<span class="text-sm text-zinc-300">Enable</span>
							</div>
						</div>
					</div>

					<!-- Options Section -->
					<div>
						<div class="mb-2 flex items-center justify-between">
							<span class="text-sm font-medium text-zinc-300">Menu Options</span>
							<button
								class="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
								onclick={addOption}
								disabled={saving}
							>
								+ Add Option
							</button>
						</div>
						{#each options as opt, i}
							<div
								class="mb-2 flex items-end gap-2 rounded border border-zinc-800 bg-zinc-800/30 p-2"
							>
								<div class="flex-1">
									<label class="mb-0.5 block text-xs text-zinc-500">Name</label>
									<input
										type="text"
										bind:value={opt.name}
										placeholder="Status"
										class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
									/>
								</div>
								<div class="flex-1">
									<label class="mb-0.5 block text-xs text-zinc-500">Variable</label>
									<input
										type="text"
										bind:value={opt.var}
										placeholder="MyVar"
										class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
									/>
								</div>
								<div class="w-24">
									<label class="mb-0.5 block text-xs text-zinc-500">Type</label>
									<select
										bind:value={opt.type}
										class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
									>
										<option value="toggle">Toggle</option>
										<option value="value">Value</option>
									</select>
								</div>
								<div class="w-16">
									<label class="mb-0.5 block text-xs text-zinc-500">Default</label>
									<input
										type="number"
										bind:value={opt.default}
										class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
									/>
								</div>
								{#if opt.type === 'value'}
									<div class="w-14">
										<label class="mb-0.5 block text-xs text-zinc-500">Min</label>
										<input
											type="number"
											bind:value={opt.min}
											class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
										/>
									</div>
									<div class="w-14">
										<label class="mb-0.5 block text-xs text-zinc-500">Max</label>
										<input
											type="number"
											bind:value={opt.max}
											class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
										/>
									</div>
								{/if}
								<button
									class="p-1 text-zinc-500 hover:text-red-400"
									onclick={() => removeOption(i)}
								>
									<svg
										class="h-4 w-4"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M6 18L18 6M6 6l12 12"
										/>
									</svg>
								</button>
							</div>
						{/each}
						{#if options.length === 0}
							<p class="py-2 text-xs text-zinc-500">
								No options added. Options create menu toggles/values for this module.
							</p>
						{/if}
					</div>

					<!-- Advanced Options -->
					<div>
						<button
							class="flex w-full items-center gap-2 text-sm font-medium text-zinc-400 hover:text-zinc-200"
							onclick={() => (showAdvanced = !showAdvanced)}
						>
							<svg
								class="h-4 w-4 transition-transform {showAdvanced ? 'rotate-90' : ''}"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 5l7 7-7 7"
								/>
							</svg>
							Advanced Options
						</button>

						{#if showAdvanced}
							<div
								class="mt-3 space-y-4 rounded border border-zinc-800 bg-zinc-800/20 p-4"
							>
								<!-- Flags -->
								<div>
									<span class="mb-2 block text-xs font-medium text-zinc-400">Flags</span>
									<div class="flex flex-wrap gap-4">
										<label class="flex items-center gap-2">
											<input
												type="checkbox"
												bind:checked={needsWeapondata}
												class="rounded border-zinc-600 bg-zinc-800 text-emerald-600 focus:ring-emerald-500"
												disabled={saving}
											/>
											<span class="text-xs text-zinc-300">Needs Weapondata</span>
										</label>
										<label class="flex items-center gap-2">
											<input
												type="checkbox"
												bind:checked={needsRecoiltable}
												class="rounded border-zinc-600 bg-zinc-800 text-emerald-600 focus:ring-emerald-500"
												disabled={saving}
											/>
											<span class="text-xs text-zinc-300">Needs Recoil Table</span>
										</label>
										<label class="flex items-center gap-2">
											<input
												type="checkbox"
												bind:checked={requiresKeyboardFile}
												class="rounded border-zinc-600 bg-zinc-800 text-emerald-600 focus:ring-emerald-500"
												disabled={saving}
											/>
											<span class="text-xs text-zinc-300"
												>Requires Keyboard File</span
											>
										</label>
									</div>
								</div>

								<!-- Menu Priority -->
								<div class="w-32">
									<label class="mb-1 block text-xs text-zinc-400">Menu Priority</label>
									<input
										type="number"
										bind:value={menuPriority}
										placeholder="Optional"
										class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
										disabled={saving}
									/>
									<p class="mt-0.5 text-[10px] text-zinc-500">
										Lower = earlier in menu
									</p>
								</div>

								<!-- Conflicts -->
								<div>
									<span class="mb-1 block text-xs font-medium text-zinc-400"
										>Conflicts</span
									>
									{#if conflicts.length > 0}
										<div class="mb-2 flex flex-wrap gap-1.5">
											{#each conflicts as conflict}
												<span
													class="flex items-center gap-1 rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300"
												>
													{conflict}
													<button
														class="text-zinc-500 hover:text-red-400"
														onclick={() => removeConflict(conflict)}
													>
														<svg
															class="h-3 w-3"
															viewBox="0 0 20 20"
															fill="currentColor"
														>
															<path
																fill-rule="evenodd"
																d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
																clip-rule="evenodd"
															/>
														</svg>
													</button>
												</span>
											{/each}
										</div>
									{/if}
									<div class="flex gap-2">
										<input
											type="text"
											bind:value={conflictInput}
											placeholder="Module ID to conflict with"
											class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
											onkeydown={(e) => {
												if (e.key === 'Enter') {
													e.preventDefault();
													addConflict();
												}
											}}
											disabled={saving}
										/>
										<button
											class="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
											onclick={addConflict}
											disabled={!conflictInput.trim() || saving}
										>
											Add
										</button>
									</div>
								</div>

								<!-- Extra Variables -->
								<div>
									<div class="mb-1 flex items-center justify-between">
										<span class="text-xs font-medium text-zinc-400"
											>Extra Variables</span
										>
										<button
											class="rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
											onclick={addExtraVar}
											disabled={saving}
										>
											+ Add
										</button>
									</div>
									{#each extraVars as v, i}
										<div class="mb-1 flex items-center gap-2">
											<input
												type="text"
												bind:value={v.name}
												placeholder="VariableName"
												class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
											/>
											<input
												type="text"
												bind:value={v.type}
												placeholder="int, int [10], etc."
												class="w-28 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
											/>
											<button
												class="p-0.5 text-zinc-500 hover:text-red-400"
												onclick={() => removeExtraVar(i)}
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
														d="M6 18L18 6M6 6l12 12"
													/>
												</svg>
											</button>
										</div>
									{/each}
									{#if extraVars.length === 0}
										<p class="text-[10px] text-zinc-500">
											GPC variables this module needs declared (e.g., int MyTimer)
										</p>
									{/if}
								</div>

								<!-- Parameters -->
								<div>
									<div class="mb-1 flex items-center justify-between">
										<span class="text-xs font-medium text-zinc-400"
											>Setup Parameters</span
										>
										<button
											class="rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
											onclick={addParam}
											disabled={saving}
										>
											+ Add
										</button>
									</div>
									{#each params as p, i}
										<div class="mb-1 flex items-center gap-2">
											<input
												type="text"
												bind:value={p.key}
												placeholder="Key"
												class="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
											/>
											<input
												type="text"
												bind:value={p.prompt}
												placeholder="User prompt text"
												class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
											/>
											<select
												bind:value={p.type}
												class="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
											>
												<option value="button">Button</option>
												<option value="number">Number</option>
											</select>
											<input
												type="text"
												bind:value={p.default}
												placeholder="Default"
												class="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
											/>
											<button
												class="p-0.5 text-zinc-500 hover:text-red-400"
												onclick={() => removeParam(i)}
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
														d="M6 18L18 6M6 6l12 12"
													/>
												</svg>
											</button>
										</div>
									{/each}
									{#if params.length === 0}
										<p class="text-[10px] text-zinc-500">
											Parameters prompted during module setup (e.g., button selection)
										</p>
									{/if}
								</div>

								<!-- Config Menu -->
								<div>
									<label class="mb-2 flex items-center gap-2">
										<input
											type="checkbox"
											bind:checked={hasConfigMenu}
											class="rounded border-zinc-600 bg-zinc-800 text-emerald-600 focus:ring-emerald-500"
											disabled={saving}
										/>
										<span class="text-xs font-medium text-zinc-400"
											>Custom Config Menu (OLED Submenu)</span
										>
									</label>
									{#if hasConfigMenu}
										<div
											class="space-y-2 rounded border border-zinc-700 bg-zinc-800/30 p-3"
										>
											<div class="grid grid-cols-2 gap-2">
												<div>
													<label class="mb-0.5 block text-[10px] text-zinc-500"
														>Menu Name</label
													>
													<input
														type="text"
														bind:value={configMenuName}
														placeholder="Submenu title"
														class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
														disabled={saving}
													/>
												</div>
												<div>
													<label class="mb-0.5 block text-[10px] text-zinc-500"
														>Type</label
													>
													<select
														bind:value={configMenuType}
														class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
														disabled={saving}
													>
														<option value="clickable">Clickable</option>
														<option value="custom">Custom</option>
													</select>
												</div>
											</div>
											<div class="grid grid-cols-3 gap-2">
												<div>
													<label class="mb-0.5 block text-[10px] text-zinc-500"
														>Display Function</label
													>
													<input
														type="text"
														bind:value={configMenuDisplayFn}
														placeholder="FnName"
														class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
														disabled={saving}
													/>
												</div>
												<div>
													<label class="mb-0.5 block text-[10px] text-zinc-500"
														>Edit Function</label
													>
													<input
														type="text"
														bind:value={configMenuEditFn}
														placeholder="FnName"
														class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
														disabled={saving}
													/>
												</div>
												<div>
													<label class="mb-0.5 block text-[10px] text-zinc-500"
														>Render Function</label
													>
													<input
														type="text"
														bind:value={configMenuRenderFn}
														placeholder="FnName"
														class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
														disabled={saving}
													/>
												</div>
											</div>
											<label class="flex items-center gap-2">
												<input
													type="checkbox"
													bind:checked={configMenuProfileAware}
													class="rounded border-zinc-600 bg-zinc-800 text-emerald-600 focus:ring-emerald-500"
													disabled={saving}
												/>
												<span class="text-xs text-zinc-300">Profile Aware</span>
											</label>
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>

					<!-- Trigger Code -->
					<div>
						<label class="mb-1 block text-sm text-zinc-300">Trigger Code</label>
						<div class="h-32 overflow-hidden rounded border border-zinc-700">
							<MonacoEditor
								value={trigger}
								language="gpc"
								readonly={saving}
								onchange={(v) => (trigger = v)}
							/>
						</div>
						<p class="mt-1 text-xs text-zinc-500">
							Code that runs in the main loop to trigger the combo
						</p>
					</div>

					<!-- Combo Code -->
					<div>
						<label class="mb-1 block text-sm text-zinc-300">Combo Code</label>
						<div class="h-48 overflow-hidden rounded border border-zinc-700">
							<MonacoEditor
								value={combo}
								language="gpc"
								readonly={saving}
								onchange={(v) => (combo = v)}
							/>
						</div>
						<p class="mt-1 text-xs text-zinc-500">GPC combo definition</p>
					</div>

					{#if formError}
						<div
							class="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-400"
						>
							{formError}
						</div>
					{/if}

					<!-- Save location -->
					<div class="pb-4 text-xs text-zinc-500">
						Saves to: {settings.workspaces.length > 0
							? settings.workspaces[0]
							: '(no workspace)'}/modules/
					</div>
				</div>
			{:else if loadingDetail}
				<div class="flex flex-1 items-center justify-center text-xs text-zinc-500">
					Loading module details...
				</div>
			{:else if selectedModule}
				<!-- Detail View -->
				<div class="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
					<div class="flex items-center gap-2">
						<h2 class="text-sm font-semibold text-zinc-200">
							{selectedModule.display_name}
						</h2>
						<span
							class="rounded px-1.5 py-0.5 text-[10px] {modules.find((m) => m.id === selectedModule?.id)?.is_user_module
								? 'bg-blue-900/40 text-blue-400'
								: 'bg-zinc-800 text-zinc-500'}"
						>
							{modules.find((m) => m.id === selectedModule?.id)?.is_user_module
								? 'user'
								: 'built-in'}
						</span>
					</div>
					{#if modules.find((m) => m.id === selectedModule?.id)?.is_user_module}
						<button
							class="rounded border border-zinc-600 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
							onclick={() => {
								if (selectedModule) enterEditMode(selectedModule);
							}}
						>
							Edit
						</button>
					{/if}
				</div>

				<div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
					<!-- Basic Info -->
					<div class="grid grid-cols-2 gap-x-6 gap-y-2">
						<div>
							<span class="text-xs text-zinc-500">ID</span>
							<p class="text-sm text-zinc-200">{selectedModule.id}</p>
						</div>
						<div>
							<span class="text-xs text-zinc-500">Type</span>
							<p class="text-sm text-zinc-200">{selectedModule.type.toUpperCase()}</p>
						</div>
						{#if selectedModule.description}
							<div class="col-span-2">
								<span class="text-xs text-zinc-500">Description</span>
								<p class="text-sm text-zinc-200">{selectedModule.description}</p>
							</div>
						{/if}
						{#if selectedModule.state_display}
							<div>
								<span class="text-xs text-zinc-500">State Display</span>
								<p class="text-sm text-zinc-200">{selectedModule.state_display}</p>
							</div>
						{/if}
						{#if selectedModule.status_var}
							<div>
								<span class="text-xs text-zinc-500">Status Variable</span>
								<p class="font-mono text-sm text-zinc-200">
									{selectedModule.status_var}
								</p>
							</div>
						{/if}
						{#if selectedModule.has_quick_toggle}
							<div>
								<span class="text-xs text-zinc-500">Quick Toggle</span>
								<p class="text-sm text-emerald-400">Enabled</p>
							</div>
						{/if}
						{#if selectedModule.menu_priority !== undefined}
							<div>
								<span class="text-xs text-zinc-500">Menu Priority</span>
								<p class="text-sm text-zinc-200">{selectedModule.menu_priority}</p>
							</div>
						{/if}
					</div>

					<!-- Options -->
					{#if selectedModule.options && selectedModule.options.length > 0}
						<div>
							<h3 class="mb-2 text-xs font-medium text-zinc-400">
								Menu Options ({selectedModule.options.length})
							</h3>
							<div class="space-y-1">
								{#each selectedModule.options as opt}
									<div
										class="flex items-center gap-3 rounded bg-zinc-800/50 px-3 py-1.5 text-xs"
									>
										<span class="text-zinc-200">{opt.name}</span>
										<span class="font-mono text-zinc-500">{opt.var}</span>
										<span class="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400"
											>{opt.type}</span
										>
										{#if opt.default !== undefined}
											<span class="text-zinc-500">default: {opt.default}</span>
										{/if}
										{#if opt.type === 'value' && opt.min !== undefined}
											<span class="text-zinc-600"
												>({opt.min}-{opt.max})</span
											>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Conflicts -->
					{#if selectedModule.conflicts && selectedModule.conflicts.length > 0}
						<div>
							<h3 class="mb-2 text-xs font-medium text-zinc-400">Conflicts</h3>
							<div class="flex flex-wrap gap-1.5">
								{#each selectedModule.conflicts as conflict}
									<span
										class="rounded bg-red-900/20 px-2 py-0.5 text-xs text-red-400"
										>{conflict}</span
									>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Extra Vars -->
					{#if selectedModule.extra_vars && Object.keys(selectedModule.extra_vars).length > 0}
						<div>
							<h3 class="mb-2 text-xs font-medium text-zinc-400">Extra Variables</h3>
							<div class="space-y-1">
								{#each Object.entries(selectedModule.extra_vars) as [name, type]}
									<div class="text-xs">
										<span class="font-mono text-zinc-200">{type}</span>
										<span class="font-mono text-emerald-400">{name}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Params -->
					{#if selectedModule.params && selectedModule.params.length > 0}
						<div>
							<h3 class="mb-2 text-xs font-medium text-zinc-400">Setup Parameters</h3>
							<div class="space-y-1">
								{#each selectedModule.params as p}
									<div
										class="flex items-center gap-3 rounded bg-zinc-800/50 px-3 py-1.5 text-xs"
									>
										<span class="font-mono text-zinc-200">{p.key}</span>
										<span class="text-zinc-400">{p.prompt}</span>
										<span class="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400"
											>{p.type}</span
										>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Flags -->
					{#if selectedModule.needs_weapondata || selectedModule.requires_keyboard_file}
						<div>
							<h3 class="mb-2 text-xs font-medium text-zinc-400">Flags</h3>
							<div class="flex flex-wrap gap-2">
								{#if selectedModule.needs_weapondata}
									<span
										class="rounded bg-amber-900/20 px-2 py-0.5 text-xs text-amber-400"
										>Needs Weapondata</span
									>
								{/if}
								{#if selectedModule.requires_keyboard_file}
									<span
										class="rounded bg-amber-900/20 px-2 py-0.5 text-xs text-amber-400"
										>Requires Keyboard File</span
									>
								{/if}
							</div>
						</div>
					{/if}

					<!-- Config Menu -->
					{#if selectedModule.config_menu}
						<div>
							<h3 class="mb-2 text-xs font-medium text-zinc-400">Config Menu</h3>
							<div class="rounded bg-zinc-800/50 px-3 py-2 text-xs">
								<div class="grid grid-cols-2 gap-2">
									<div>
										<span class="text-zinc-500">Name:</span>
										<span class="text-zinc-200"
											>{selectedModule.config_menu.name}</span
										>
									</div>
									<div>
										<span class="text-zinc-500">Type:</span>
										<span class="text-zinc-200"
											>{selectedModule.config_menu.type}</span
										>
									</div>
									{#if selectedModule.config_menu.display_function}
										<div>
											<span class="text-zinc-500">Display:</span>
											<span class="font-mono text-zinc-200"
												>{selectedModule.config_menu.display_function}</span
											>
										</div>
									{/if}
									{#if selectedModule.config_menu.edit_function}
										<div>
											<span class="text-zinc-500">Edit:</span>
											<span class="font-mono text-zinc-200"
												>{selectedModule.config_menu.edit_function}</span
											>
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/if}

					<!-- Trigger Code -->
					{#if selectedModule.trigger}
						<div>
							<h3 class="mb-2 text-xs font-medium text-zinc-400">Trigger Code</h3>
							<div class="h-32 overflow-hidden rounded border border-zinc-700">
								<MonacoEditor
									value={selectedModule.trigger}
									language="gpc"
									readonly={true}
								/>
							</div>
						</div>
					{/if}

					<!-- Combo Code -->
					{#if selectedModule.combo}
						<div>
							<h3 class="mb-2 text-xs font-medium text-zinc-400">Combo Code</h3>
							<div class="h-48 overflow-hidden rounded border border-zinc-700">
								<MonacoEditor
									value={selectedModule.combo}
									language="gpc"
									readonly={true}
								/>
							</div>
						</div>
					{/if}
				</div>
			{:else}
				<!-- Empty state -->
				<div class="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
					<svg class="h-10 w-10 text-zinc-700" viewBox="0 0 20 20" fill="currentColor">
						<path
							d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"
						/>
					</svg>
					<p class="text-xs">Select a module to view details, or create a new one</p>
				</div>
			{/if}
		</div>
	</div>
</div>

<ConfirmDialog
	open={confirmDialog.open}
	title={confirmDialog.title}
	message={confirmDialog.message}
	confirmLabel="Delete"
	variant="danger"
	onconfirm={handleDelete}
	oncancel={() => (confirmDialog = { open: false, title: '', message: '', moduleId: '' })}
/>
