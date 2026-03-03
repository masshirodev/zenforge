<script lang="ts">
	import { listModules } from '$lib/tauri/commands';
	import { getSettings } from '$lib/stores/settings.svelte';
	import type { ModuleSummary } from '$lib/types/module';
	import { onMount } from 'svelte';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';

	let settingsStore = getSettings();
	let settings = $derived($settingsStore);

	let modules = $state<ModuleSummary[]>([]);
	let loading = $state(true);
	let selectedModule = $state<string | null>(null);
	let filterType = $state<string>('all');

	// SVG canvas state
	let canvasWidth = $state(900);
	let canvasHeight = $state(600);

	onMount(async () => {
		try {
			modules = await listModules(undefined, settings.workspaces);
		} catch {
			// ignore
		} finally {
			loading = false;
		}
	});

	let filteredModules = $derived.by(() => {
		if (filterType === 'all') return modules;
		return modules.filter((m) => m.module_type === filterType || m.module_type === 'all');
	});

	// Build conflict graph — which modules conflict with which
	let conflictEdges = $derived.by(() => {
		const edges: Array<{ from: string; to: string }> = [];
		const seen = new Set<string>();
		for (const mod of filteredModules) {
			for (const conflict of mod.conflicts) {
				const key = [mod.id, conflict].sort().join(':');
				if (!seen.has(key) && filteredModules.some((m) => m.id === conflict)) {
					seen.add(key);
					edges.push({ from: mod.id, to: conflict });
				}
			}
		}
		return edges;
	});

	// Dependency edges (needs_weapondata → weapondata)
	let dependencyEdges = $derived.by(() => {
		const edges: Array<{ from: string; to: string }> = [];
		for (const mod of filteredModules) {
			if (mod.needs_weapondata && filteredModules.some((m) => m.id === 'weapondata')) {
				edges.push({ from: mod.id, to: 'weapondata' });
			}
		}
		return edges;
	});

	// Layout: arrange modules in a circle
	let nodePositions = $derived.by(() => {
		const mods = filteredModules;
		const cx = canvasWidth / 2;
		const cy = canvasHeight / 2;
		const radius = Math.min(cx, cy) - 80;
		const positions = new Map<string, { x: number; y: number }>();

		mods.forEach((mod, i) => {
			const angle = (2 * Math.PI * i) / mods.length - Math.PI / 2;
			positions.set(mod.id, {
				x: cx + radius * Math.cos(angle),
				y: cy + radius * Math.sin(angle)
			});
		});

		return positions;
	});

	let highlightedModules = $derived.by(() => {
		if (!selectedModule) return new Set<string>();
		const set = new Set<string>([selectedModule]);
		const mod = modules.find((m) => m.id === selectedModule);
		if (mod) {
			for (const c of mod.conflicts) set.add(c);
			if (mod.needs_weapondata) set.add('weapondata');
		}
		// Also highlight modules that depend on selectedModule
		for (const m of modules) {
			if (m.needs_weapondata && selectedModule === 'weapondata') set.add(m.id);
			if (m.conflicts.includes(selectedModule)) set.add(m.id);
		}
		return set;
	});

	function getModuleColor(mod: ModuleSummary): string {
		switch (mod.module_type) {
			case 'fps':
				return '#34d399';
			case 'tps':
				return '#60a5fa';
			case 'fgs':
				return '#f472b6';
			default:
				return '#a78bfa';
		}
	}

	let typeOptions = $derived.by(() => {
		const types = new Set(modules.map((m) => m.module_type));
		types.delete('all');
		return ['all', ...Array.from(types).sort()];
	});
</script>

<div class="flex h-full flex-col bg-zinc-950 text-zinc-100">
	<ToolHeader title="Module Dependency Graph" subtitle="Visualize dependencies between game modules">
		<div class="ml-auto flex items-center gap-2">
			<label class="text-xs text-zinc-400" for="filter-type">Filter:</label>
			<select
				id="filter-type"
				bind:value={filterType}
				class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
			>
				{#each typeOptions as type}
					<option value={type}>{type === 'all' ? 'All Types' : type.toUpperCase()}</option>
				{/each}
			</select>
		</div>
	</ToolHeader>

	{#if loading}
		<div class="flex flex-1 items-center justify-center text-sm text-zinc-500">
			Loading modules...
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<!-- Graph -->
			<div class="flex-1 overflow-auto">
				<svg width={canvasWidth} height={canvasHeight} class="mx-auto">
					<!-- Conflict edges (red dashed) -->
					{#each conflictEdges as edge}
						{@const from = nodePositions.get(edge.from)}
						{@const to = nodePositions.get(edge.to)}
						{#if from && to}
							<line
								x1={from.x}
								y1={from.y}
								x2={to.x}
								y2={to.y}
								stroke={selectedModule && (highlightedModules.has(edge.from) && highlightedModules.has(edge.to)) ? '#ef4444' : '#3f3f46'}
								stroke-width={selectedModule && highlightedModules.has(edge.from) && highlightedModules.has(edge.to) ? 2 : 1}
								stroke-dasharray="6,3"
								opacity={selectedModule ? (highlightedModules.has(edge.from) && highlightedModules.has(edge.to) ? 1 : 0.15) : 0.5}
							/>
						{/if}
					{/each}

					<!-- Dependency edges (green solid, with arrow) -->
					{#each dependencyEdges as edge}
						{@const from = nodePositions.get(edge.from)}
						{@const to = nodePositions.get(edge.to)}
						{#if from && to}
							<line
								x1={from.x}
								y1={from.y}
								x2={to.x}
								y2={to.y}
								stroke={selectedModule && (highlightedModules.has(edge.from) && highlightedModules.has(edge.to)) ? '#34d399' : '#3f3f46'}
								stroke-width={selectedModule && highlightedModules.has(edge.from) && highlightedModules.has(edge.to) ? 2 : 1}
								opacity={selectedModule ? (highlightedModules.has(edge.from) && highlightedModules.has(edge.to) ? 1 : 0.15) : 0.5}
							/>
						{/if}
					{/each}

					<!-- Nodes -->
					{#each filteredModules as mod}
						{@const pos = nodePositions.get(mod.id)}
						{#if pos}
							<g
								class="cursor-pointer"
								transform="translate({pos.x},{pos.y})"
								onclick={() => (selectedModule = selectedModule === mod.id ? null : mod.id)}
								opacity={selectedModule ? (highlightedModules.has(mod.id) ? 1 : 0.2) : 1}
							>
								<circle
									r={selectedModule === mod.id ? 22 : 18}
									fill={selectedModule === mod.id ? getModuleColor(mod) : '#27272a'}
									stroke={getModuleColor(mod)}
									stroke-width={selectedModule === mod.id ? 3 : 1.5}
								/>
								<text
									text-anchor="middle"
									dy="28"
									fill={selectedModule === mod.id ? '#fff' : '#a1a1aa'}
									font-size="10"
									font-weight={selectedModule === mod.id ? 'bold' : 'normal'}
								>
									{mod.display_name.length > 14 ? mod.display_name.slice(0, 12) + '..' : mod.display_name}
								</text>
							</g>
						{/if}
					{/each}
				</svg>
			</div>

			<!-- Detail panel -->
			<div class="w-72 border-l border-zinc-800 p-4">
				{#if selectedModule}
					{@const mod = modules.find((m) => m.id === selectedModule)}
					{#if mod}
						<h3 class="text-lg font-semibold text-zinc-100">{mod.display_name}</h3>
						<p class="mt-1 text-xs text-zinc-400">{mod.id}</p>
						<div class="mt-3 space-y-3">
							<div>
								<span class="text-xs font-medium text-zinc-500">Type</span>
								<div class="mt-0.5 text-sm" style="color: {getModuleColor(mod)}">{mod.module_type.toUpperCase()}</div>
							</div>
							{#if mod.conflicts.length > 0}
								<div>
									<span class="text-xs font-medium text-red-400">Conflicts with</span>
									<div class="mt-1 space-y-1">
										{#each mod.conflicts as c}
											{@const cMod = modules.find((m) => m.id === c)}
											<button
												class="block text-sm text-red-300 hover:text-red-200"
												onclick={() => (selectedModule = c)}
											>
												{cMod?.display_name ?? c}
											</button>
										{/each}
									</div>
								</div>
							{/if}
							{#if mod.needs_weapondata}
								<div>
									<span class="text-xs font-medium text-emerald-400">Depends on</span>
									<div class="mt-1">
										<button
											class="text-sm text-emerald-300 hover:text-emerald-200"
											onclick={() => (selectedModule = 'weapondata')}
										>
											Weapon Data
										</button>
									</div>
								</div>
							{/if}
							<div>
								<span class="text-xs font-medium text-zinc-500">Options</span>
								<div class="mt-0.5 text-sm text-zinc-300">{mod.option_count} option{mod.option_count !== 1 ? 's' : ''}</div>
							</div>
							{#if mod.param_count > 0}
								<div>
									<span class="text-xs font-medium text-zinc-500">Parameters</span>
									<div class="mt-0.5 text-sm text-zinc-300">{mod.param_count} param{mod.param_count !== 1 ? 's' : ''}</div>
								</div>
							{/if}
						</div>
					{/if}
				{:else}
					<div class="space-y-3 text-sm text-zinc-500">
						<p>Click a module node to see its conflicts and dependencies.</p>
						<div class="space-y-2 text-xs">
							<div class="flex items-center gap-2">
								<div class="h-0.5 w-6 border-t-2 border-dashed border-red-500"></div>
								<span>Conflict</span>
							</div>
							<div class="flex items-center gap-2">
								<div class="h-0.5 w-6 border-t-2 border-emerald-500"></div>
								<span>Dependency</span>
							</div>
							<div class="mt-2 flex items-center gap-2">
								<div class="h-3 w-3 rounded-full bg-emerald-400"></div>
								<span>FPS</span>
							</div>
							<div class="flex items-center gap-2">
								<div class="h-3 w-3 rounded-full bg-blue-400"></div>
								<span>TPS</span>
							</div>
							<div class="flex items-center gap-2">
								<div class="h-3 w-3 rounded-full bg-pink-400"></div>
								<span>FGS</span>
							</div>
							<div class="flex items-center gap-2">
								<div class="h-3 w-3 rounded-full bg-purple-400"></div>
								<span>All</span>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
