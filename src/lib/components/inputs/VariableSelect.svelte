<script lang="ts">
	interface Props {
		value: string;
		options: { name: string; label: string }[];
		onchange: (value: string) => void;
		placeholder?: string;
	}

	let { value, options, onchange, placeholder = 'Search or type...' }: Props = $props();

	let search = $state('');
	let open = $state(false);
	let highlightIndex = $state(0);
	let inputEl: HTMLInputElement | undefined = $state();
	let listEl: HTMLDivElement | undefined = $state();

	// Sync search text when value changes externally
	$effect(() => {
		search = labelFor(value) || value || '';
	});

	/** Find the display label for the current value */
	function labelFor(val: string): string {
		if (!val) return '';
		const match = options.find((o) => o.name === val);
		return match ? match.label : val;
	}

	let filtered = $derived.by(() => {
		const noneEntry = { name: '', label: 'None' };
		if (!search) return [noneEntry, ...options];
		const q = search.toLowerCase();
		const matched = options.filter(
			(o) => o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)
		);
		return [noneEntry, ...matched];
	});

	function select(opt: { name: string; label: string }) {
		const val = opt.name;
		search = val ? labelFor(val) || val : '';
		onchange(val);
		open = false;
	}

	function commitCustom() {
		// When the user blurs or presses Enter without selecting from the list,
		// treat the search text as a raw variable name
		const trimmed = search.trim();
		if (!trimmed) {
			onchange('');
		} else {
			// Check if search matches a label — if so, use the corresponding name
			const match = options.find((o) => o.label === trimmed);
			if (match) {
				onchange(match.name);
			} else {
				onchange(trimmed);
			}
		}
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) {
			if (e.key === 'ArrowDown' || e.key === 'Enter') {
				open = true;
				highlightIndex = 0;
				e.preventDefault();
			}
			return;
		}

		if (e.key === 'ArrowDown') {
			highlightIndex = Math.min(highlightIndex + 1, filtered.length - 1);
			scrollToHighlight();
			e.preventDefault();
		} else if (e.key === 'ArrowUp') {
			highlightIndex = Math.max(highlightIndex - 1, 0);
			scrollToHighlight();
			e.preventDefault();
		} else if (e.key === 'Enter') {
			if (filtered[highlightIndex]) {
				select(filtered[highlightIndex]);
			} else {
				commitCustom();
			}
			e.preventDefault();
		} else if (e.key === 'Escape') {
			open = false;
			search = labelFor(value) || value || '';
			e.preventDefault();
		}
	}

	function scrollToHighlight() {
		if (listEl) {
			const item = listEl.children[highlightIndex] as HTMLElement | undefined;
			item?.scrollIntoView({ block: 'nearest' });
		}
	}

	function handleFocus() {
		open = true;
		highlightIndex = 0;
		search = '';
	}

	function handleBlur() {
		setTimeout(() => {
			if (!open) return;
			commitCustom();
		}, 150);
	}

	function handleInput() {
		open = true;
		highlightIndex = 0;
	}
</script>

<div class="relative">
	<input
		bind:this={inputEl}
		type="text"
		bind:value={search}
		onfocus={handleFocus}
		onblur={handleBlur}
		oninput={handleInput}
		onkeydown={handleKeydown}
		{placeholder}
		class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
	/>

	{#if value}
		<button
			type="button"
			title="Clear"
			class="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
			onmousedown={(e) => {
				e.preventDefault();
				select({ name: '', label: 'None' });
			}}
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
				<path
					fill-rule="evenodd"
					d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
					clip-rule="evenodd"
				/>
			</svg>
		</button>
	{/if}

	{#if open}
		<div
			bind:this={listEl}
			class="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-800 py-1 shadow-lg"
		>
			{#each filtered as opt, i}
				<button
					type="button"
					class="flex w-full items-center px-2 py-1 text-left text-xs {i === highlightIndex
						? 'bg-emerald-900/40 text-emerald-300'
						: opt.name === '' ? 'text-zinc-500 hover:bg-zinc-700' : 'text-zinc-200 hover:bg-zinc-700'}"
					onmousedown={(e) => {
						e.preventDefault();
						select(opt);
					}}
				>
					{opt.label}
				</button>
			{/each}
			{#if filtered.length <= 1 && search}
				<div class="px-2 py-1.5 text-[10px] text-zinc-500">
					Press Enter to use "{search}" as custom variable
				</div>
			{/if}
		</div>
	{/if}
</div>
