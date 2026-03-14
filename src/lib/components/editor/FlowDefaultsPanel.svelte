<script lang="ts">
	import type { FlowVariable, FlowProject, FlowProfile, WeaponDefaultsConfig } from '$lib/types/flow';
	import * as m from '$lib/paraglide/messages.js';

	interface Props {
		project: FlowProject;
		weaponNames: string[];
		onUpdateDefault: (varName: string, value: number) => void;
		onUpdateProfileOverride: (profileId: string, varName: string, value: number | undefined) => void;
		onUpdateWeaponOverride: (weaponIndex: number, varName: string, value: number | undefined) => void;
	}

	let {
		project,
		weaponNames,
		onUpdateDefault,
		onUpdateProfileOverride,
		onUpdateWeaponOverride,
	}: Props = $props();

	let profiles = $derived(project.profiles ?? []);
	let weaponDefaults = $derived(project.weaponDefaults);
	let hasProfiles = $derived(profiles.length > 1);
	let hasWeapons = $derived(weaponNames.length > 0 && weaponDefaults?.enabledVars?.length);

	// Collect all non-string variables from all flows, deduplicated by name
	let allVars = $derived.by(() => {
		const vars: FlowVariable[] = [];
		const seen = new Set<string>();
		const add = (v: FlowVariable) => {
			if (v.type !== 'string' && !seen.has(v.name)) {
				vars.push(v);
				seen.add(v.name);
			}
		};
		for (const v of project.sharedVariables) add(v);
		for (const flow of project.flows) {
			for (const v of flow.globalVariables) add(v);
			for (const node of flow.nodes) {
				for (const v of node.variables) add(v);
			}
		}
		return vars;
	});

	function isToggle(v: FlowVariable): boolean {
		return (
			(v.min === undefined || v.min === 0) &&
			(v.max === undefined || v.max === 1) &&
			(v.defaultValue === 0 || v.defaultValue === 1)
		);
	}

	function getProfileOverride(profile: FlowProfile, varName: string): number | undefined {
		return profile.variableOverrides[varName];
	}

	function getWeaponOverride(weaponIdx: number, varName: string): number | undefined {
		return weaponDefaults?.overrides[weaponIdx]?.[varName];
	}

	function handleBaseChange(v: FlowVariable, rawValue: string) {
		const num = parseFloat(rawValue);
		if (isNaN(num)) return;
		const clamped = Math.max(v.min ?? -Infinity, Math.min(v.max ?? Infinity, num));
		onUpdateDefault(v.name, clamped);
	}

	function handleBaseToggle(v: FlowVariable) {
		const current = v.defaultValue as number;
		onUpdateDefault(v.name, current ? 0 : 1);
	}

	function handleProfileChange(profile: FlowProfile, v: FlowVariable, rawValue: string) {
		const num = parseFloat(rawValue);
		if (isNaN(num)) {
			onUpdateProfileOverride(profile.id, v.name, undefined);
			return;
		}
		const clamped = Math.max(v.min ?? -Infinity, Math.min(v.max ?? Infinity, num));
		if (clamped === (v.defaultValue as number)) {
			onUpdateProfileOverride(profile.id, v.name, undefined);
		} else {
			onUpdateProfileOverride(profile.id, v.name, clamped);
		}
	}

	function handleProfileToggle(profile: FlowProfile, v: FlowVariable) {
		const current = getProfileOverride(profile, v.name) ?? (v.defaultValue as number);
		const newVal = current ? 0 : 1;
		if (newVal === (v.defaultValue as number)) {
			onUpdateProfileOverride(profile.id, v.name, undefined);
		} else {
			onUpdateProfileOverride(profile.id, v.name, newVal);
		}
	}

	function handleWeaponChange(weaponIdx: number, v: FlowVariable, rawValue: string) {
		const num = parseFloat(rawValue);
		if (isNaN(num)) {
			onUpdateWeaponOverride(weaponIdx, v.name, undefined);
			return;
		}
		const clamped = Math.max(v.min ?? -Infinity, Math.min(v.max ?? Infinity, num));
		if (clamped === (v.defaultValue as number)) {
			onUpdateWeaponOverride(weaponIdx, v.name, undefined);
		} else {
			onUpdateWeaponOverride(weaponIdx, v.name, clamped);
		}
	}

	function handleWeaponToggle(weaponIdx: number, v: FlowVariable) {
		const current = getWeaponOverride(weaponIdx, v.name) ?? (v.defaultValue as number);
		const newVal = current ? 0 : 1;
		if (newVal === (v.defaultValue as number)) {
			onUpdateWeaponOverride(weaponIdx, v.name, undefined);
		} else {
			onUpdateWeaponOverride(weaponIdx, v.name, newVal);
		}
	}
</script>

<div class="space-y-6">
	<div>
		<h2 class="text-lg font-semibold text-zinc-200">{m.flow_defaults_title()}</h2>
		<p class="mt-1 text-sm text-zinc-500">{m.flow_defaults_description()}</p>
	</div>

	{#if allVars.length === 0}
		<p class="text-sm text-zinc-500">{m.flow_defaults_no_vars()}</p>
	{:else}
		<div class="overflow-x-auto rounded-lg border border-zinc-800">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-zinc-700 bg-zinc-800/50">
						<th class="sticky left-0 z-10 bg-zinc-800/90 px-4 py-2 text-left font-medium text-zinc-300">
							{m.flow_defaults_variable()}
						</th>
						<th class="px-4 py-2 text-center font-medium text-zinc-300">
							{m.flow_defaults_base()}
						</th>
						{#if hasProfiles}
							{#each profiles as profile, pi}
								<th class="px-4 py-2 text-center font-medium text-zinc-400" title={profile.name}>
									{m.flow_defaults_profile_col({ index: String(pi + 1) })}
									<span class="block text-[10px] font-normal text-zinc-600 truncate max-w-16">{profile.name}</span>
								</th>
							{/each}
						{/if}
						{#if hasWeapons}
							{#each weaponNames as weapon, wi}
								<th class="px-4 py-2 text-center font-medium text-zinc-400" title={weapon}>
									{m.flow_defaults_weapon_col({ index: String(wi) })}
									<span class="block text-[10px] font-normal text-zinc-600 truncate max-w-16">{weapon}</span>
								</th>
							{/each}
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each allVars as v}
						{@const toggle = isToggle(v)}
						{@const isPerProfile = v.perProfile && hasProfiles}
						{@const isWeaponVar = hasWeapons && weaponDefaults?.enabledVars.includes(v.name)}
						<tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30">
							<!-- Variable name -->
							<td class="sticky left-0 z-10 bg-zinc-900 px-4 py-1.5 font-mono text-xs text-zinc-300">
								{v.name}
								<span class="ml-1 text-zinc-600">
									{#if toggle}(toggle){:else}({v.min ?? 0}–{v.max ?? 100}){/if}
								</span>
							</td>

							<!-- Base default -->
							<td class="px-4 py-1.5 text-center">
								{#if toggle}
									<button
										class="rounded px-3 py-0.5 text-xs font-medium {v.defaultValue
											? 'bg-emerald-600/30 text-emerald-400'
											: 'bg-zinc-700/50 text-zinc-500'}"
										onclick={() => handleBaseToggle(v)}
									>
										{v.defaultValue ? 'ON' : 'OFF'}
									</button>
								{:else}
									<input
										type="number"
										class="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-center text-xs text-zinc-300 focus:border-emerald-600 focus:outline-none"
										value={v.defaultValue}
										min={v.min}
										max={v.max}
										onchange={(e) => handleBaseChange(v, (e.target as HTMLInputElement).value)}
									/>
								{/if}
							</td>

							<!-- Profile columns -->
							{#if hasProfiles}
								{#each profiles as profile}
									{@const override = getProfileOverride(profile, v.name)}
									{@const isOverridden = override !== undefined}
									{@const displayVal = override ?? (v.defaultValue as number)}
									<td class="px-4 py-1.5 text-center">
										{#if isPerProfile}
											{#if toggle}
												<button
													class="rounded px-3 py-0.5 text-xs font-medium {isOverridden
														? displayVal
															? 'bg-emerald-600/30 text-emerald-400'
															: 'bg-red-600/20 text-red-400'
														: displayVal
															? 'bg-zinc-700/50 text-zinc-500'
															: 'bg-zinc-800 text-zinc-600'}"
													onclick={() => handleProfileToggle(profile, v)}
												>
													{displayVal ? 'ON' : 'OFF'}
												</button>
											{:else}
												<div class="flex items-center justify-center gap-0.5">
													<input
														type="number"
														class="w-14 rounded border px-1 py-0.5 text-center text-xs focus:outline-none {isOverridden
															? 'border-emerald-600/50 bg-emerald-900/20 text-emerald-300'
															: 'border-zinc-700 bg-zinc-800 text-zinc-600'}"
														value={displayVal}
														min={v.min}
														max={v.max}
														onchange={(e) => handleProfileChange(profile, v, (e.target as HTMLInputElement).value)}
													/>
													{#if isOverridden}
														<button
															class="shrink-0 text-zinc-600 hover:text-zinc-300"
															onclick={() => onUpdateProfileOverride(profile.id, v.name, undefined)}
															title={m.flow_weapon_defaults_reset()}
														>
															<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
															</svg>
														</button>
													{/if}
												</div>
											{/if}
										{:else}
											<span class="text-zinc-700">—</span>
										{/if}
									</td>
								{/each}
							{/if}

							<!-- Weapon columns -->
							{#if hasWeapons}
								{#each weaponNames as _, wi}
									{@const override = getWeaponOverride(wi, v.name)}
									{@const isOverridden = override !== undefined}
									{@const displayVal = override ?? (v.defaultValue as number)}
									<td class="px-4 py-1.5 text-center">
										{#if isWeaponVar}
											{#if toggle}
												<button
													class="rounded px-3 py-0.5 text-xs font-medium {isOverridden
														? displayVal
															? 'bg-emerald-600/30 text-emerald-400'
															: 'bg-red-600/20 text-red-400'
														: displayVal
															? 'bg-zinc-700/50 text-zinc-500'
															: 'bg-zinc-800 text-zinc-600'}"
													onclick={() => handleWeaponToggle(wi, v)}
												>
													{displayVal ? 'ON' : 'OFF'}
												</button>
											{:else}
												<div class="flex items-center justify-center gap-0.5">
													<input
														type="number"
														class="w-14 rounded border px-1 py-0.5 text-center text-xs focus:outline-none {isOverridden
															? 'border-emerald-600/50 bg-emerald-900/20 text-emerald-300'
															: 'border-zinc-700 bg-zinc-800 text-zinc-600'}"
														value={displayVal}
														min={v.min}
														max={v.max}
														onchange={(e) => handleWeaponChange(wi, v, (e.target as HTMLInputElement).value)}
													/>
													{#if isOverridden}
														<button
															class="shrink-0 text-zinc-600 hover:text-zinc-300"
															onclick={() => onUpdateWeaponOverride(wi, v.name, undefined)}
															title={m.flow_weapon_defaults_reset()}
														>
															<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
															</svg>
														</button>
													{/if}
												</div>
											{/if}
										{:else}
											<span class="text-zinc-700">—</span>
										{/if}
									</td>
								{/each}
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
