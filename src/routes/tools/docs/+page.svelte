<script lang="ts">
	import { marked, type TokenizerAndRendererExtension } from 'marked';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';

	const badgeColors: Record<string, { bg: string; border: string; text: string }> = {
		lsp: { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
		ide: { bg: '#14532d', border: '#22c55e', text: '#86efac' },
		language: { bg: '#4a1d96', border: '#8b5cf6', text: '#c4b5fd' },
		zen: { bg: '#78350f', border: '#f59e0b', text: '#fcd34d' },
		required: { bg: '#7f1d1d', border: '#ef4444', text: '#fca5a5' },
		optional: { bg: '#1c1917', border: '#78716c', text: '#d6d3d1' }
	};

	const defaultBadge = { bg: '#27272a', border: '#52525b', text: '#d4d4d8' };

	const badgeExtension: TokenizerAndRendererExtension = {
		name: 'badge',
		level: 'inline',
		start(src: string) {
			return src.indexOf('{');
		},
		tokenizer(src: string) {
			const match = src.match(/^\{([a-zA-Z0-9_-]+)\}/);
			if (match) {
				return {
					type: 'badge',
					raw: match[0],
					label: match[1]
				};
			}
			return undefined;
		},
		renderer(token) {
			const label = (token as unknown as { label: string }).label;
			const key = label.toLowerCase();
			const colors = badgeColors[key] ?? defaultBadge;
			return `<span class="docs-badge" style="background:${colors.bg};border-color:${colors.border};color:${colors.text}">${label.toUpperCase()}</span>`;
		}
	};

	marked.use({ extensions: [badgeExtension] });

	const categoryOrder = ['ide', 'tools', 'language', 'lsp'] as const;
	const categoryLabels: Record<string, string> = {
		ide: 'IDE',
		tools: 'Tools',
		language: 'Language',
		lsp: 'LSP'
	};

	interface DocEntry {
		category: string;
		slug: string;
		title: string;
		content: string;
	}

	const rawFiles = import.meta.glob('./content/**/*.md', {
		query: '?raw',
		eager: true
	}) as Record<string, { default: string }>;

	function buildDocs(): DocEntry[] {
		const entries: DocEntry[] = [];
		for (const [path, mod] of Object.entries(rawFiles)) {
			const match = path.match(/\.\/content\/([^/]+)\/(\d+-)?(.+)\.md$/);
			if (!match) continue;
			const category = match[1];
			const slug = match[3];
			const title = slug
				.split('-')
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(' ');
			entries.push({ category, slug, title, content: mod.default });
		}
		return entries;
	}

	const docs = buildDocs();

	function getCategories() {
		const cats: Array<{ key: string; label: string; entries: DocEntry[] }> = [];
		for (const key of categoryOrder) {
			const entries = docs.filter((d) => d.category === key);
			if (entries.length > 0) {
				cats.push({ key, label: categoryLabels[key] ?? key, entries });
			}
		}
		return cats;
	}

	const categories = getCategories();

	let activeCat = $state(categories[0]?.key ?? '');
	let activeSlug = $state(categories[0]?.entries[0]?.slug ?? '');
	let expandedCats = $state<Set<string>>(new Set(categoryOrder));
	let searchQuery = $state('');

	let activeDoc = $derived(docs.find((d) => d.category === activeCat && d.slug === activeSlug));
	let renderedHtml = $derived(activeDoc ? marked.parse(activeDoc.content) : '');

	let filteredCategories = $derived.by(() => {
		if (!searchQuery.trim()) return categories;
		const q = searchQuery.toLowerCase();
		return categories
			.map((cat) => ({
				...cat,
				entries: cat.entries.filter(
					(e) => e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)
				)
			}))
			.filter((cat) => cat.entries.length > 0);
	});

	let contentEl: HTMLDivElement | undefined = $state();

	function selectDoc(cat: string, slug: string) {
		activeCat = cat;
		activeSlug = slug;
		contentEl?.scrollTo(0, 0);
	}

	function toggleCategory(key: string) {
		const next = new Set(expandedCats);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expandedCats = next;
	}
</script>

<div class="flex h-full flex-col bg-zinc-950">
	<ToolHeader title="Documentation" subtitle="GPC language reference and API documentation" />

	<div class="flex flex-1 overflow-hidden">
		<div class="flex w-64 flex-col border-r border-zinc-800 bg-zinc-900">
			<div class="border-b border-zinc-800 p-3">
				<input
					type="text"
					placeholder="Search docs..."
					bind:value={searchQuery}
					class="w-full rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500"
				/>
			</div>

			<nav class="scrollbar-none flex-1 overflow-y-auto px-2 py-2">
				{#each filteredCategories as cat}
					<div class="mb-1">
						<button
							class="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs font-semibold tracking-wider text-zinc-400 uppercase hover:bg-zinc-800 hover:text-zinc-300"
							onclick={() => toggleCategory(cat.key)}
						>
							<svg
								class="h-3 w-3 transition-transform"
								class:rotate-90={expandedCats.has(cat.key)}
								fill="currentColor"
								viewBox="0 0 20 20"
							>
								<path
									fill-rule="evenodd"
									d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
									clip-rule="evenodd"
								/>
							</svg>
							{cat.label}
						</button>

						{#if expandedCats.has(cat.key)}
							{#each cat.entries as entry}
								<button
									class="flex w-full items-center rounded px-3 py-1.5 text-left text-sm {activeCat ===
										cat.key && activeSlug === entry.slug
										? 'bg-emerald-900/30 text-emerald-400'
										: 'text-zinc-300 hover:bg-zinc-800'}"
									onclick={() => selectDoc(cat.key, entry.slug)}
								>
									{entry.title}
								</button>
							{/each}
						{/if}
					</div>
				{/each}
			</nav>
		</div>

		<div class="scrollbar-none flex-1 overflow-y-auto" bind:this={contentEl}>
			{#if activeDoc}
				<article class="docs-prose mx-auto max-w-3xl px-8 py-8">
					{@html renderedHtml}
				</article>
			{:else}
				<div class="flex h-full items-center justify-center text-zinc-500">
					Select a topic from the sidebar
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	:global(.docs-prose) {
		color: #d4d4d8;
		line-height: 1.7;
	}
	:global(.docs-prose h1) {
		font-size: 1.875rem;
		font-weight: 700;
		color: #f4f4f5;
		margin-bottom: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid #3f3f46;
	}
	:global(.docs-prose h2) {
		font-size: 1.375rem;
		font-weight: 600;
		color: #e4e4e7;
		margin-top: 2rem;
		margin-bottom: 0.75rem;
	}
	:global(.docs-prose h3) {
		font-size: 1.125rem;
		font-weight: 600;
		color: #d4d4d8;
		margin-top: 1.5rem;
		margin-bottom: 0.5rem;
	}
	:global(.docs-prose p) {
		margin-bottom: 1rem;
	}
	:global(.docs-prose a) {
		color: #34d399;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	:global(.docs-prose a:hover) {
		color: #6ee7b7;
	}
	:global(.docs-prose strong) {
		color: #f4f4f5;
		font-weight: 600;
	}
	:global(.docs-prose ul) {
		list-style-type: disc;
		padding-left: 1.5rem;
		margin-bottom: 1rem;
	}
	:global(.docs-prose ol) {
		list-style-type: decimal;
		padding-left: 1.5rem;
		margin-bottom: 1rem;
	}
	:global(.docs-prose li) {
		margin-bottom: 0.25rem;
	}
	:global(.docs-prose code) {
		background-color: #27272a;
		color: #6ee7b7;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.875rem;
	}
	:global(.docs-prose pre) {
		background-color: #18181b;
		border: 1px solid #3f3f46;
		border-radius: 0.5rem;
		padding: 1rem;
		overflow-x: auto;
		margin-bottom: 1rem;
	}
	:global(.docs-prose pre code) {
		background: none;
		padding: 0;
		color: #d4d4d8;
		font-size: 0.8125rem;
		line-height: 1.6;
	}
	:global(.docs-prose table) {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 1rem;
	}
	:global(.docs-prose th) {
		text-align: left;
		padding: 0.5rem 0.75rem;
		font-weight: 600;
		color: #e4e4e7;
		border-bottom: 2px solid #3f3f46;
	}
	:global(.docs-prose td) {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #27272a;
	}
	:global(.docs-prose blockquote) {
		border-left: 3px solid #34d399;
		padding-left: 1rem;
		color: #a1a1aa;
		margin-bottom: 1rem;
	}
	:global(.docs-prose hr) {
		border-color: #3f3f46;
		margin: 2rem 0;
	}
	:global(.docs-badge) {
		display: inline-flex;
		align-items: center;
		padding: 0.0625rem 0.4375rem;
		border: 1px solid;
		border-radius: 0.25rem;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.025em;
		line-height: 1.5;
		vertical-align: middle;
	}
</style>
