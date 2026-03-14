<script lang="ts">
	import type { FlowVariable, WeaponDefaultsConfig } from '$lib/types/flow';
	import * as m from '$lib/paraglide/messages.js';

	interface Props {
		weaponNames: string[];
		/** All module variables eligible for per-weapon defaults */
		eligibleVars: FlowVariable[];
		config?: WeaponDefaultsConfig;
		onToggleVar: (varName: string, enabled: boolean) => void;
		onUpdateOverride: (weaponIndex: number, varName: string, value: number | undefined) => void;
		onSetRememberTweaks: (value: boolean) => void;
	}

	let {
		weaponNames,
		eligibleVars,
		config,
		onToggleVar,
		onUpdateOverride,
		onSetRememberTweaks,
	}: Props = $props();

	let showAddDropdown = $state(false);

	let enabledVars = $derived(config?.enabledVars ?? []);
	let overrides = $derived(config?.overrides ?? {});
	let rememberTweaks = $derived(config?.rememberTweaks ?? false);

	// Eligible vars not yet enabled
	let availableVars = $derived(
		eligibleVars.filter((v) => !enabledVars.includes(v.name))
	);

	// Enabled vars with their FlowVariable data
	let enabledVarData = $derived(
		enabledVars
			.map((name) => eligibleVars.find((v) => v.name === name))
			.filter((v): v is FlowVariable => v != null)
	);

	function getOverrideValue(weaponIdx: number, varName: string): number | undefined {
		return overrides[weaponIdx]?.[varName];
	}

	function getDefaultValue(v: FlowVariable): number {
		return v.defaultValue as number;
	}

	function isToggle(v: FlowVariable): boolean {
		return (
			(v.min === undefined || v.min === 0) &&
			(v.max === undefined || v.max === 1) &&
			(v.defaultValue === 0 || v.defaultValue === 1)
		);
	}

	function handleCellChange(weaponIdx: number, varName: string, rawValue: string, v: FlowVariable) {
		const num = parseFloat(rawValue);
		if (isNaN(num)) {
			onUpdateOverride(weaponIdx, varName, undefined);
			return;
		}
		const clamped = Math.max(v.min ?? -Infinity, Math.min(v.max ?? Infinity, num));
		const defaultVal = getDefaultValue(v);
		// If value matches default, remove override
		if (clamped === defaultVal) {
			onUpdateOverride(weaponIdx, varName, undefined);
		} else {
			onUpdateOverride(weaponIdx, varName, clamped);
		}
	}

	function handleToggle(weaponIdx: number, varName: string, v: FlowVariable) {
		const current = getOverrideValue(weaponIdx, varName) ?? getDefaultValue(v);
		const newVal = current ? 0 : 1;
		const defaultVal = getDefaultValue(v);
		if (newVal === defaultVal) {
			onUpdateOverride(weaponIdx, varName, undefined);
		} else {
			onUpdateOverride(weaponIdx, varName, newVal);
		}
	}
</script>

<div class="space-y-4 p-3">
	<h3 class="text-sm font-semibold text-zinc-300">{m.flow_weapon_defaults_title()}</h3>

	{#if weaponNames.length === 0}
		<p class="text-xs text-zinc-500">
			{m.flow_weapon_defaults_no_weapons()}
		</p>
	{:else}
		<!-- Remember tweaks toggle -->
		<label class="flex items-center gap-2 text-xs text-zinc-400">
			<input
				type="checkbox"
				class="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
				checked={rememberTweaks}
				onchange={() => onSetRememberTweaks(!rememberTweaks)}
			/>
			{m.flow_weapon_defaults_remember()}
		</label>
		{#if rememberTweaks}
			<p class="text-xs text-amber-500/80">
				{m.flow_weapon_defaults_remember_warning()}
			</p>
		{/if}

		<!-- Add variable dropdown -->
		<div class="relative">
			<button
				class="w-full rounded border border-dashed border-zinc-600 px-3 py-1.5 text-xs text-zinc-400 hover:border-emerald-500 hover:text-emerald-400"
				onclick={() => (showAddDropdown = !showAddDropdown)}
			>
				+ {m.flow_weapon_defaults_add_var()}
			</button>
			{#if showAddDropdown && availableVars.length > 0}
				<div class="absolute z-50 mt-1 max-h-40 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 shadow-lg">
					{#each availableVars as v}
						<button
							class="w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700"
							onclick={() => {
								onToggleVar(v.name, true);
								showAddDropdown = false;
							}}
						>
							{v.name}
							<span class="ml-1 text-zinc-500">
								({isToggle(v) ? 'toggle' : `${v.min ?? 0}-${v.max ?? 100}`})
							</span>
						</button>
					{/each}
				</div>
			{/if}
			{#if showAddDropdown && availableVars.length === 0}
				<div class="absolute z-50 mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-500 shadow-lg">
					{m.flow_weapon_defaults_no_vars()}
				</div>
			{/if}
		</div>

		<!-- Weapon defaults table -->
		{#if enabledVarData.length > 0}
			<div class="overflow-x-auto">
				<table class="w-full text-xs">
					<thead>
						<tr class="border-b border-zinc-700">
							<th class="sticky left-0 bg-zinc-900 px-2 py-1 text-left font-medium text-zinc-400">
								{m.flow_weapon_defaults_weapon()}
							</th>
							{#each enabledVarData as v}
								<th class="px-2 py-1 text-center font-medium text-zinc-400">
									<div class="flex items-center justify-center gap-1">
										<span class="truncate" title={v.name}>{v.name}</span>
										<button
											class="shrink-0 text-zinc-600 hover:text-red-400"
											onclick={() => onToggleVar(v.name, false)}
											title={m.flow_weapon_defaults_remove_var()}
										>
											<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
											</svg>
										</button>
									</div>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each weaponNames as weapon, wi}
							<tr class="border-b border-zinc-800 hover:bg-zinc-800/50">
								<td class="sticky left-0 bg-zinc-900 px-2 py-1 text-zinc-300">
									<span class="text-zinc-600">{wi}.</span> {weapon}
								</td>
								{#each enabledVarData as v}
									{@const overrideVal = getOverrideValue(wi, v.name)}
									{@const isOverridden = overrideVal !== undefined}
									{@const displayVal = overrideVal ?? getDefaultValue(v)}
									<td class="px-2 py-1 text-center">
										{#if isToggle(v)}
											<button
												class="rounded px-2 py-0.5 text-xs {isOverridden
													? displayVal
														? 'bg-emerald-600/30 text-emerald-400'
														: 'bg-red-600/20 text-red-400'
													: displayVal
														? 'bg-zinc-700/50 text-zinc-400'
														: 'bg-zinc-800 text-zinc-600'}"
												onclick={() => handleToggle(wi, v.name, v)}
											>
												{displayVal ? 'ON' : 'OFF'}
											</button>
										{:else}
											<div class="flex items-center justify-center gap-0.5">
												<input
													type="number"
													class="w-14 rounded border px-1 py-0.5 text-center text-xs focus:outline-none {isOverridden
														? 'border-emerald-600/50 bg-emerald-900/20 text-emerald-300'
														: 'border-zinc-700 bg-zinc-800 text-zinc-500'}"
													value={displayVal}
													min={v.min}
													max={v.max}
													onchange={(e) =>
														handleCellChange(wi, v.name, (e.target as HTMLInputElement).value, v)}
												/>
												{#if isOverridden}
													<button
														class="shrink-0 text-zinc-600 hover:text-zinc-300"
														onclick={() => onUpdateOverride(wi, v.name, undefined)}
														title={m.flow_weapon_defaults_reset()}
													>
														<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
														</svg>
													</button>
												{/if}
											</div>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if enabledVarData.length > 0}
			<p class="text-xs text-zinc-600">
				{m.flow_weapon_defaults_hint()}
			</p>
		{/if}
	{/if}
</div>
