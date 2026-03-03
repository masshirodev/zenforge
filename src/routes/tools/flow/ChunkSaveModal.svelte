<script lang="ts">
	import type { FlowNode, FlowChunk } from '$lib/types/flow';
	import { saveChunk } from '$lib/tauri/commands';
	import { getSettings } from '$lib/stores/settings.svelte';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		open: boolean;
		node: FlowNode | null;
		onclose: () => void;
		onsaved?: () => void;
	}

	let { open, node, onclose, onsaved }: Props = $props();

	let settingsStore = getSettings();
	let settings = $derived($settingsStore);

	let name = $state('');
	let description = $state('');
	let category = $state('menu');
	let tags = $state('');
	let saving = $state(false);

	$effect(() => {
		if (open && node) {
			name = node.label;
			description = '';
			category = node.type === 'intro' ? 'intro' : node.type === 'screensaver' ? 'screensaver' : node.type === 'home' ? 'home' : 'menu';
			tags = '';
		}
	});

	async function handleSave() {
		if (!node || !name.trim()) return;
		if (settings.workspaces.length === 0) {
			addToast('No workspace configured', 'error');
			return;
		}

		// Snapshot to unwrap Svelte 5 $state proxy — structuredClone fails on proxied objects
		const plain = $state.snapshot(node) as FlowNode;

		saving = true;
		try {
			const chunk: FlowChunk = {
				id: crypto.randomUUID(),
				name: name.trim(),
				description: description.trim(),
				category,
				tags: tags
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean),
				nodeTemplate: {
					type: plain.type,
					label: plain.label,
					gpcCode: plain.gpcCode,
					oledScene: plain.oledScene,
					oledWidgets: plain.oledWidgets,
					comboCode: plain.comboCode,
					variables: plain.variables,
					onEnter: plain.onEnter,
					onExit: plain.onExit,
					subNodes: plain.subNodes,
					stackOffsetX: plain.stackOffsetX,
					stackOffsetY: plain.stackOffsetY,
				},
				edgeTemplates: [],
				parameters: [],
				createdAt: Date.now(),
				updatedAt: Date.now(),
			};

			await saveChunk(settings.workspaces[0], chunk);
			addToast(`Chunk "${name}" saved`, 'success');
			onclose();
			onsaved?.();
		} catch (e) {
			addToast(`Failed to save chunk: ${e}`, 'error');
		} finally {
			saving = false;
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
		onmousedown={(e) => { if (e.target === e.currentTarget) onclose(); }}
	>
		<div class="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
			<h2 class="mb-4 text-lg font-semibold text-zinc-100">Save as Chunk</h2>

			<div class="space-y-3">
				<div>
					<label class="mb-1 block text-xs text-zinc-400" for="chunk-name">Name</label>
					<input
						id="chunk-name"
						type="text"
						class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
						bind:value={name}
					/>
				</div>

				<div>
					<label class="mb-1 block text-xs text-zinc-400" for="chunk-desc">Description</label>
					<textarea
						id="chunk-desc"
						class="h-16 w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
						bind:value={description}
						placeholder="Briefly describe what this chunk does..."
					></textarea>
				</div>

				<div>
					<label class="mb-1 block text-xs text-zinc-400" for="chunk-category">Category</label>
					<select
						id="chunk-category"
						class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
						bind:value={category}
					>
						<option value="intro">Intro / Splash</option>
						<option value="menu">Menu Pages</option>
						<option value="home">Home / Status</option>
						<option value="screensaver">Screensaver</option>
						<option value="utility">Utility</option>
					</select>
				</div>

				<div>
					<label class="mb-1 block text-xs text-zinc-400" for="chunk-tags">Tags (comma-separated)</label>
					<input
						id="chunk-tags"
						type="text"
						class="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
						bind:value={tags}
						placeholder="menu, navigation, 3-item"
					/>
				</div>
			</div>

			<div class="mt-5 flex justify-end gap-2">
				<button
					class="rounded border border-zinc-700 bg-zinc-800 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
					onclick={onclose}
				>
					Cancel
				</button>
				<button
					class="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
					disabled={!name.trim() || saving}
					onclick={handleSave}
				>
					{saving ? 'Saving...' : 'Save Chunk'}
				</button>
			</div>
		</div>
	</div>
{/if}
