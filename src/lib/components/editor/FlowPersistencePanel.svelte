<script lang="ts">
	import type { FlowProject } from '$lib/types/flow';
	import { collectCombinedPersistVars } from '$lib/flow/codegen-merged';
	import type { PersistVar } from '$lib/flow/codegen';
	import * as m from '$lib/paraglide/messages.js';

	const TOTAL_SPVAR_SLOTS = 64; // slots 1–64
	const BITS_PER_SLOT = 32;
	const TOTAL_BITS = TOTAL_SPVAR_SLOTS * BITS_PER_SLOT; // 2,048

	let { project }: { project: FlowProject } = $props();

	/** Mirror of GPC's _bp_bit_count: count bits needed to represent abs(val) */
	function bitCount(val: number): number {
		let bits = 0;
		val = Math.abs(val);
		while (val) {
			bits++;
			val = val >>> 1;
		}
		return bits;
	}

	/** Mirror of GPC's _bp_bit_count2: bits needed for a min/max range */
	function bitCount2(min: number, max: number): number {
		let bits = Math.max(bitCount(min), bitCount(max));
		if (min < 0 || max < 0) {
			bits++; // sign bit
		}
		return bits;
	}

	interface VarAnalysis {
		pv: PersistVar;
		bitsPerValue: number;
		type: 'scalar' | 'array' | 'sparse' | 'profile';
		minBits: number;
		maxBits: number;
		minEntries?: number;
		maxEntries?: number;
	}

	let persistVars = $derived<PersistVar[]>((() => {
		const menuFlow = project.flows.find((f) => f.flowType === 'menu');
		const gameplayFlow = project.flows.find((f) => f.flowType === 'gameplay');
		const dataFlow = project.flows.find((f) => f.flowType === 'data');

		if (!menuFlow || !gameplayFlow) return [];

		// When weapon defaults are active, profiles are bypassed
		const weaponDefaultsActive =
			project.weaponDefaults &&
			project.weaponDefaults.enabledVars.length > 0 &&
			[...gameplayFlow.nodes, ...(dataFlow?.nodes ?? [])].some(
				(n) => n.moduleData?.moduleId === 'weapondata'
			);
		const profileCount = weaponDefaultsActive ? 0 : (project.profiles?.length ?? 0);
		return collectCombinedPersistVars(project, menuFlow, gameplayFlow, profileCount, dataFlow);
	})());

	let analysis = $derived<VarAnalysis[]>(
		persistVars.map((pv) => {
			const bpv = bitCount2(pv.min, pv.max);

			if (pv.sparseArray) {
				// Sparse: count field + per-entry (index + stride values)
				const resolvedMaxCount = parseCountExpr(pv.sparseArray.maxCount);
				const countBits = bitCount2(0, resolvedMaxCount);
				const indexBits = bitCount2(0, resolvedMaxCount);
				const entryBits = indexBits + bpv * pv.sparseArray.stride;
				const maxEntries = resolvedMaxCount;
				return {
					pv,
					bitsPerValue: bpv,
					type: 'sparse' as const,
					minBits: countBits, // 0 entries = just count
					maxBits: countBits + maxEntries * entryBits, // all entries modified
					minEntries: 0,
					maxEntries,
				};
			}

			if (pv.arrayLoop) {
				// Full array: count * bits per value
				// Parse count expression (e.g., "WEAPON_COUNT * 2")
				const countStr = pv.arrayLoop.countExpr;
				// We can't resolve defines at design time, use a reasonable estimate
				const estimatedCount = parseCountExpr(countStr);
				const totalBits = estimatedCount * bpv;
				return {
					pv,
					bitsPerValue: bpv,
					type: 'array' as const,
					minBits: totalBits,
					maxBits: totalBits,
					maxEntries: estimatedCount,
				};
			}

			if (pv.perProfile && pv.profileCount && pv.profileCount > 1) {
				const totalBits = pv.profileCount * bpv;
				return {
					pv,
					bitsPerValue: bpv,
					type: 'profile' as const,
					minBits: totalBits,
					maxBits: totalBits,
					maxEntries: pv.profileCount,
				};
			}

			return {
				pv,
				bitsPerValue: bpv,
				type: 'scalar' as const,
				minBits: bpv,
				maxBits: bpv,
			};
		})
	);

	let totalMinBits = $derived(analysis.reduce((sum, a) => sum + a.minBits, 0));
	let totalMaxBits = $derived(analysis.reduce((sum, a) => sum + a.maxBits, 0));
	let minSlots = $derived(Math.ceil(totalMinBits / BITS_PER_SLOT));
	let maxSlots = $derived(Math.ceil(totalMaxBits / BITS_PER_SLOT));
	let hasSparse = $derived(analysis.some((a) => a.type === 'sparse'));
	let budgetStatus = $derived<'ok' | 'warning' | 'exceeded' | 'may-exceed'>(
		maxSlots > TOTAL_SPVAR_SLOTS
			? (hasSparse && minSlots <= TOTAL_SPVAR_SLOTS ? 'may-exceed' : 'exceeded')
			: maxSlots > TOTAL_SPVAR_SLOTS * 0.8 ? 'warning' : 'ok'
	);

	function parseCountExpr(expr: string): number {
		// Try to find WEAPON_COUNT from weapondata module in the project
		const weaponCount = findWeaponCount();
		const resolved = expr.replace(/WEAPON_COUNT/g, String(weaponCount));
		try {
			// Safe eval for simple math expressions like "120 * 2"
			return Function(`"use strict"; return (${resolved})`)() as number;
		} catch {
			return 120; // fallback
		}
	}

	function findWeaponCount(): number {
		for (const flow of project.flows) {
			for (const node of flow.nodes) {
				if (node.moduleData?.moduleId === 'weapondata') {
					// Look for WEAPON_COUNT in defines or options
					const opt = node.moduleData.options?.find((o) => o.name === 'Weapon Count');
					if (opt) return opt.defaultValue ?? 10;
					// Check variables for weapon count
					const v = node.variables.find((v) => v.name === 'WEAPON_COUNT' || v.name === 'WEAPON_MAX_INDEX');
					if (v?.name === 'WEAPON_COUNT') return Number(v.defaultValue) || 10;
					if (v?.name === 'WEAPON_MAX_INDEX') return (Number(v.defaultValue) || 9) + 1;
				}
			}
		}
		return 10; // default fallback
	}

	function typeLabel(type: string): string {
		switch (type) {
			case 'scalar': return m.persist_type_scalar();
			case 'array': return m.persist_type_array();
			case 'sparse': return m.persist_type_sparse();
			case 'profile': return m.persist_type_profile();
			default: return type;
		}
	}
</script>

<div class="space-y-6">
	<h2 class="text-lg font-semibold text-zinc-100">{m.persist_title()}</h2>

	{#if analysis.length === 0}
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-500">
			{m.persist_no_vars()}
		</div>
	{:else}
		<!-- Budget Overview -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
			<div class="grid grid-cols-2 gap-4 text-sm">
				<div>
					<div class="text-zinc-500">{m.persist_total_bits()}</div>
					<div class="mt-1 font-mono text-zinc-200">
						{#if totalMinBits === totalMaxBits}
							{totalMaxBits}
						{:else}
							{totalMinBits} – {totalMaxBits}
						{/if}
					</div>
				</div>
				<div>
					<div class="text-zinc-500">{m.persist_slots_used()}</div>
					<div class="mt-1 font-mono text-zinc-200">
						{#if minSlots === maxSlots}
							{maxSlots}
						{:else}
							{minSlots} – {maxSlots}
						{/if}
						<span class="text-zinc-500"> / {TOTAL_SPVAR_SLOTS}</span>
					</div>
				</div>
			</div>

			<!-- Progress bar -->
			<div class="mt-3">
				<div class="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
					{#if minSlots !== maxSlots}
						<!-- Min range (solid) -->
						<div
							class="relative h-full rounded-full transition-all"
							style="width: {Math.min((maxSlots / TOTAL_SPVAR_SLOTS) * 100, 100)}%"
						>
							<div
								class="absolute inset-y-0 left-0 rounded-full {budgetStatus === 'exceeded' ? 'bg-red-500/30' : budgetStatus === 'may-exceed' || budgetStatus === 'warning' ? 'bg-amber-500/30' : 'bg-emerald-500/30'}"
								style="width: 100%"
							></div>
							<div
								class="absolute inset-y-0 left-0 rounded-full {budgetStatus === 'exceeded' ? 'bg-red-500' : budgetStatus === 'may-exceed' || budgetStatus === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'}"
								style="width: {maxSlots > 0 ? (minSlots / maxSlots) * 100 : 0}%"
							></div>
						</div>
					{:else}
						<div
							class="h-full rounded-full transition-all {budgetStatus === 'exceeded' ? 'bg-red-500' : budgetStatus === 'may-exceed' || budgetStatus === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'}"
							style="width: {Math.min((maxSlots / TOTAL_SPVAR_SLOTS) * 100, 100)}%"
						></div>
					{/if}
				</div>
			</div>

			<!-- Status badge -->
			<div class="mt-2 text-xs {budgetStatus === 'exceeded' ? 'text-red-400' : budgetStatus === 'may-exceed' || budgetStatus === 'warning' ? 'text-amber-400' : 'text-emerald-400'}">
				{budgetStatus === 'exceeded' ? m.persist_budget_exceeded() : budgetStatus === 'may-exceed' ? m.persist_budget_may_exceed() : budgetStatus === 'warning' ? m.persist_budget_warning() : m.persist_budget_ok()}
				<span class="ml-2 text-zinc-500">
					{m.persist_remaining()}: {TOTAL_SPVAR_SLOTS - maxSlots} – {TOTAL_SPVAR_SLOTS - minSlots} slots
				</span>
			</div>
		</div>

		<!-- Variable Table -->
		<div class="overflow-hidden rounded-lg border border-zinc-800">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-zinc-800 bg-zinc-900/50">
					<tr>
						<th class="px-3 py-2 font-medium text-zinc-400">{m.persist_variable()}</th>
						<th class="px-3 py-2 font-medium text-zinc-400">{m.persist_type()}</th>
						<th class="px-3 py-2 text-right font-medium text-zinc-400">Min/Max</th>
						<th class="px-3 py-2 text-right font-medium text-zinc-400">{m.persist_bits()}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-zinc-800/50">
					{#each analysis as a}
						<tr class="hover:bg-zinc-800/30">
							<td class="px-3 py-2">
								<span class="font-mono text-zinc-200">{a.pv.name}</span>
							</td>
							<td class="px-3 py-2">
								<span class="rounded bg-zinc-800 px-1.5 py-0.5 text-xs {a.type === 'sparse' ? 'text-amber-400' : a.type === 'array' ? 'text-blue-400' : a.type === 'profile' ? 'text-purple-400' : 'text-zinc-400'}">
									{typeLabel(a.type)}
								</span>
								{#if a.type === 'array' && a.maxEntries}
									<span class="ml-1 text-xs text-zinc-500">[{a.maxEntries}]</span>
								{/if}
								{#if a.type === 'profile' && a.maxEntries}
									<span class="ml-1 text-xs text-zinc-500">x{a.maxEntries}</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-right font-mono text-xs text-zinc-400">
								{a.pv.min} .. {a.pv.max}
							</td>
							<td class="px-3 py-2 text-right font-mono">
								{#if a.minBits === a.maxBits}
									<span class="text-zinc-200">{a.maxBits}</span>
								{:else}
									<span class="text-zinc-400">{a.minBits}</span>
									<span class="text-zinc-600"> – </span>
									<span class="text-zinc-200">{a.maxBits}</span>
								{/if}
							</td>
						</tr>
						{#if a.type === 'sparse'}
							<tr class="bg-zinc-900/30">
								<td colspan="4" class="px-3 py-1.5 text-xs text-zinc-500">
									{m.persist_min_entries()}: {a.minEntries} ({a.minBits} bits)
									&nbsp;&middot;&nbsp;
									{m.persist_max_entries()}: {a.maxEntries} ({a.maxBits} bits)
									&nbsp;&middot;&nbsp;
									{a.bitsPerValue} bits/value &times; {a.pv.sparseArray?.stride ?? 1} stride + index
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
				<tfoot class="border-t border-zinc-700 bg-zinc-900/50">
					<tr>
						<td class="px-3 py-2 font-medium text-zinc-300" colspan="3">Total</td>
						<td class="px-3 py-2 text-right font-mono font-medium">
							{#if totalMinBits === totalMaxBits}
								<span class="text-zinc-200">{totalMaxBits}</span>
							{:else}
								<span class="text-zinc-400">{totalMinBits}</span>
								<span class="text-zinc-600"> – </span>
								<span class="text-zinc-200">{totalMaxBits}</span>
							{/if}
							<span class="ml-1 text-xs text-zinc-500">
								({#if minSlots === maxSlots}{maxSlots}{:else}{minSlots}–{maxSlots}{/if} slots)
							</span>
						</td>
					</tr>
				</tfoot>
			</table>
		</div>
	{/if}
</div>
