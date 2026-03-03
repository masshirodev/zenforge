<script lang="ts">
	import { addToast } from '$lib/stores/toast.svelte';
	import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';

	let inputText = $state('Hello World');
	let nullTerminate = $state(true);
	let padTo = $state(0);
	let arrayType = $state<'int8' | 'int16'>('int8');
	let arrayName = $state('my_string');
	let showDecimal = $state(false);

	let bytes = $derived.by(() => {
		const encoded = new TextEncoder().encode(inputText);
		const arr = [...encoded];
		if (nullTerminate) arr.push(0);
		if (padTo > 0) {
			while (arr.length < padTo) arr.push(0);
		}
		return arr;
	});

	let gpcCode = $derived.by(() => {
		const lines: string[] = [];
		const count = arrayType === 'int16' ? Math.ceil(bytes.length / 2) : bytes.length;

		lines.push(`// "${inputText}" (${bytes.length} bytes${nullTerminate ? ', null-terminated' : ''})`);

		if (arrayType === 'int16') {
			const words: number[] = [];
			for (let i = 0; i < bytes.length; i += 2) {
				words.push((bytes[i] << 8) | (bytes[i + 1] || 0));
			}
			const fmt = showDecimal
				? words.map((w) => w.toString()).join(', ')
				: words.map((w) => '0x' + w.toString(16).toUpperCase().padStart(4, '0')).join(', ');
			lines.push(`const int16 ${arrayName}[] = { ${fmt} };`);
			lines.push(`define ${arrayName}_LEN = ${words.length};`);
		} else {
			const chunkSize = 16;
			lines.push(`const int8 ${arrayName}[] = {`);
			for (let i = 0; i < bytes.length; i += chunkSize) {
				const chunk = bytes.slice(i, i + chunkSize);
				const fmt = showDecimal
					? chunk.map((b) => b.toString().padStart(3)).join(', ')
					: chunk.map((b) => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(', ');
				const comma = i + chunkSize < bytes.length ? ',' : '';
				lines.push(`    ${fmt}${comma}`);
			}
			lines.push(`};`);
			lines.push(`define ${arrayName}_LEN = ${bytes.length};`);
		}

		return lines.join('\n');
	});

	function handleCopy() {
		navigator.clipboard.writeText(gpcCode);
		addToast('GPC code copied to clipboard', 'success');
	}
</script>

<div class="flex h-full flex-col bg-zinc-950 text-zinc-100">
	<ToolHeader title="String to GPC Array" subtitle="Convert text strings to GPC-compatible byte arrays" />

	<div class="flex min-h-0 flex-1">
		<!-- Input panel -->
		<div class="w-80 overflow-y-auto border-r border-zinc-800 p-4">
			<div class="mb-4">
				<label class="mb-1 block text-xs text-zinc-400" for="input-text">Input String</label>
				<textarea
					id="input-text"
					class="h-32 w-full resize-y rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
					bind:value={inputText}
					placeholder="Enter text to convert..."
				></textarea>
			</div>

			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400" for="array-name">Array Name</label>
				<input
					id="array-name"
					type="text"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200"
					bind:value={arrayName}
				/>
			</div>

			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400" for="array-type">Type</label>
				<select
					id="array-type"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200"
					bind:value={arrayType}
				>
					<option value="int8">int8 (byte array)</option>
					<option value="int16">int16 (word array)</option>
				</select>
			</div>

			<div class="mb-3">
				<label class="flex items-center gap-2 text-sm text-zinc-300">
					<input type="checkbox" bind:checked={nullTerminate} class="accent-emerald-500" />
					Null-terminate
				</label>
			</div>

			<div class="mb-3">
				<label class="flex items-center gap-2 text-sm text-zinc-300">
					<input type="checkbox" bind:checked={showDecimal} class="accent-emerald-500" />
					Show as decimal
				</label>
			</div>

			<div class="mb-3">
				<label class="mb-1 block text-xs text-zinc-400" for="pad-to">Pad to length</label>
				<input
					id="pad-to"
					type="number"
					min="0"
					max="1024"
					class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200"
					bind:value={padTo}
				/>
				<p class="mt-0.5 text-xs text-zinc-600">0 = no padding</p>
			</div>

			<!-- Stats -->
			<div class="mt-4 rounded border border-zinc-800 bg-zinc-900 p-3">
				<h3 class="mb-2 text-xs font-medium text-zinc-400">Statistics</h3>
				<div class="space-y-1 text-xs text-zinc-500">
					<div class="flex justify-between">
						<span>Characters</span>
						<span class="text-zinc-300">{inputText.length}</span>
					</div>
					<div class="flex justify-between">
						<span>Bytes (UTF-8)</span>
						<span class="text-zinc-300">{bytes.length}</span>
					</div>
					<div class="flex justify-between">
						<span>Array elements</span>
						<span class="text-zinc-300">
							{arrayType === 'int16' ? Math.ceil(bytes.length / 2) : bytes.length}
						</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Output -->
		<div class="flex flex-1 flex-col p-4">
			<div class="mb-2 flex items-center justify-between">
				<h3 class="text-sm font-semibold text-zinc-300">GPC Output</h3>
				<button
					class="rounded bg-emerald-600 px-4 py-1.5 text-sm text-white hover:bg-emerald-500"
					onclick={handleCopy}
				>
					Copy
				</button>
			</div>
			<div class="flex-1 overflow-hidden rounded border border-zinc-700">
				<MonacoEditor value={gpcCode} language="gpc" readonly={true} />
			</div>

			<!-- Byte view -->
			<div class="mt-4">
				<h3 class="mb-2 text-sm font-semibold text-zinc-300">Byte View</h3>
				<div
					class="max-h-24 overflow-auto rounded border border-zinc-700 bg-zinc-900 p-3 font-mono text-xs"
				>
					{#each bytes as b, i}
						<span
							class="mr-1 inline-block {b >= 32 && b < 127
								? 'text-emerald-400'
								: 'text-zinc-500'}"
							title="{b >= 32 && b < 127 ? String.fromCharCode(b) : '.'} ({b})"
						>
							{b.toString(16).toUpperCase().padStart(2, '0')}
						</span>
						{#if (i + 1) % 16 === 0}
							<br />
						{/if}
					{/each}
				</div>
			</div>
		</div>
	</div>
</div>
