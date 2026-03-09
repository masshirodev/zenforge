<script lang="ts">
	import type { SubNodeParam } from '$lib/types/flow';
	import MiniMonaco from '$lib/components/editor/MiniMonaco.svelte';

	interface Props {
		params: SubNodeParam[];
		config: Record<string, unknown>;
		onUpdate: (key: string, value: unknown) => void;
	}

	let { params, config, onUpdate }: Props = $props();
</script>

{#each params as param (param.key)}
	{@const visible = !param.visibleWhen || param.visibleWhen.values.includes(config[param.visibleWhen.key] ?? '')}
	{#if visible}
	<div class="mb-2">
		<label class="mb-0.5 block text-xs text-zinc-400" for="param-{param.key}">
			{param.label}
			{#if param.description}
				<span class="text-zinc-600" title={param.description}> (?)</span>
			{/if}
		</label>

		{#if param.type === 'number'}
			<input
				id="param-{param.key}"
				type="number"
				class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
				value={config[param.key] ?? param.default}
				min={param.min}
				max={param.max}
				onchange={(e) => onUpdate(param.key, parseFloat((e.target as HTMLInputElement).value))}
			/>
		{:else if param.type === 'boolean'}
			<label class="flex items-center gap-2 text-xs text-zinc-300">
				<input
					type="checkbox"
					class="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
					checked={(config[param.key] ?? param.default) as boolean}
					onchange={(e) => onUpdate(param.key, (e.target as HTMLInputElement).checked)}
				/>
				{(config[param.key] ?? param.default) ? 'On' : 'Off'}
			</label>
		{:else if param.type === 'select' && param.options}
			<select
				id="param-{param.key}"
				class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
				value={config[param.key] ?? param.default}
				onchange={(e) => onUpdate(param.key, (e.target as HTMLSelectElement).value)}
			>
				{#each param.options as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		{:else if param.type === 'string'}
			<input
				id="param-{param.key}"
				type="text"
				class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
				value={config[param.key] ?? param.default ?? ''}
				onchange={(e) => onUpdate(param.key, (e.target as HTMLInputElement).value)}
			/>
		{:else if param.type === 'code'}
			<div class="h-20 overflow-hidden rounded border border-zinc-700">
				<MiniMonaco
					value={(config[param.key] as string) ?? ''}
					language="gpc"
					label={param.label}
					onchange={(v) => onUpdate(param.key, v)}
				/>
			</div>
		{/if}
	</div>
	{/if}
{/each}
