<script lang="ts">
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';
	import ZmkMappingSelect from '$lib/components/inputs/ZmkMappingSelect.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import { getAppRoot, readBytes, writeBytes } from '$lib/tauri/commands';
	import {
		parseZmk,
		serializeZmk,
		formatValue100,
		formatXYRatio,
		linearCurve,
		encodeBindsClip,
		decodeBindsClip,
		encodeCurveClip,
		decodeCurveClip,
		encodeTuningClip,
		decodeTuningClip,
		encodeTranslatorClip,
		decodeTranslatorClip
	} from '$lib/utils/zmk-parser';
	import {
		CONTROLLER_SLOTS,
		PROFILE_NAMES,
		DEADZONE_SHAPE_NAMES,
		AXIS_NAMES,
		AXIS_SLOT_LABELS,
		DeadzoneShape,
		InputDevice,
		getSlotDisplayName,
		type ZmkFile,
		type CurvePoint,
		type InputMapping,
		type ButtonLayout
	} from '$lib/types/zmk';

	// Embedded default .zmk profile (base64)
	const DEFAULT_ZMK_B64 =
		'TUtaRU4AAAAxLjAuMAAAAERlZmF1bHQgUHJvZmlsZQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxLjAuMS1iZXRhLjEAAAAAAAAAAAAAAAAAAAAAAToAAAABQwAAAQAAAAAAAAEAAAAAAAAAAAAAABQFFAUkLCQsAAAAAAAAANwFZwAAAAAAAAAAAAAAAAAAgAUKDxQZHiMoLTI3PEFGS1BVWl/kAAAAAAAAAAAAAAABGgEEAQcBFgAAAAAAAAAAAAAAAAAAAAABAgQFBwhMHUwdFBQCAQICAQgB4QEKARQBLAEGARUBHgFSAVEBTwFQAUgBSwEpASsAAAEYAhIAAAIEAAAAAAAAAgMCEQAAAAAAAAAAAAAAAAIFAAABAQICAAAAAQAAAAAAAAAAAAAAFAUUBSQsJCwAAAAAAAAA3AVkAAAAAAAAAAAAAQAAAACABQoPFBkeIygtMjc8QUZLUFVaX+QAAAAAAAAAAAAAAAEaAQQBBwEWAAAAAAAAAAAAAAAAAAAAAAECBAUHCEwdTB0UFAIBAgIBCAHhAQoBFAEsAQYBFQEeAVIBUQFPAVABSAFLASkBKwAAARgCEgAAAgQAAAAAAAACAwIRAAAAAAAAAAAAAAAAAgUAAAAAAAAAAAABAAAAAAAAAAAAAAAUBRQFJCwkLAAAAAAAAADcBWcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARoBBAEHARYAAAAAAAAAAAAAAAAAAAAAAQIEBQcITB1MHRQUAgECAgEIAeEBCgEUASwBBgEVAR4BUgFRAU8BUAFIAUsBKQErAAABGAISAAACBAAAAAAAAAIDAhEAAAAAAAAAAAAAAAACBQAAAAAAAAAAAAEAAAAAAAAAAAAAABQFFAUkLCQsAAAAAAAAANwFZwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGgEEAQcBFgAAAAAAAAAAAAAAAAAAAAABAgQFBwhMHUwdFBQCAQICAQgB4QEKARQBLAEGARUBHgFSAVEBTwFQAUgBSwEpASsAAAEYAhIAAAIEAAAAAAAAAgMCEQAAAAAAAAAAAAAAAAIFAAAAAAAAAAAAAQAAAAAAAAAAAAAAFAUUBSQsJCwAAAAAAAAA3AVnAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEaAQQBBwEWAAAAAAAAAAAAAAAAAAAAAAECBAUHCEwdTB0UFAIBAgIBCAHhAQoBFAEsAQYBFQEeAVIBUQFPAVABSAFLASkBKwAAARgCEgAAAgQAAAAAAAACAwIRAAAAAAAAAAAAAAAAAgUAAAAAAAAAAAABAAAAAAAAAAAAAAAUBRQFJCwkLAAAAAAAAADcBWcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARoBBAEHARYAAAAAAAAAAAAAAAAAAAAAAQIEBQcITB1MHRQUAgECAgEIAeEBCgEUASwBBgEVAR4BUgFRAU8BUAFIAUsBKQErAAABGAISAAACBAAAAAAAAAIDAhEAAAAAAAAAAAAAAAACBQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

	let zmk = $state<ZmkFile | null>(null);
	let fileName = $state('');
	let activeProfile = $state(0);
	let activeTab = $state<
		'primary' | 'secondary' | 'movement' | 'controller' | 'activation' | 'curve'
	>('primary');
	let buttonLayout = $state<ButtonLayout>('ps');
	let lastLoadedBuffer = $state<ArrayBuffer | null>(null);
	let fileInput: HTMLInputElement;

	let profile = $derived(zmk?.profiles[activeProfile] ?? null);

	// --- Curve editor state ---
	let draggingPointIndex = $state<number | null>(null);
	let hoveredPointIndex = $state<number | null>(null);
	let curveEl: SVGSVGElement | undefined = $state();
	let savedCurve = $state<CurvePoint[] | null>(null);
	let drawMode = $state(false);
	let drawPoints = $state<{ svgX: number; svgY: number }[]>([]);

	// Curve canvas dimensions
	const CX = 40; // left padding for Y axis labels
	const CY = 10; // top padding
	const CW = 480; // chart width
	const CH = 360; // chart height
	const CB = 30; // bottom padding for X axis labels
	const SVG_W = CX + CW + 20;
	const SVG_H = CY + CH + CB;

	// --- Helpers ---

	function sliderFill(value: number, min: number, max: number): number {
		if (max === min) return 0;
		return ((value - min) / (max - min)) * 100;
	}

	const numCls =
		'w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none';

	function sliderBg(fill: number): string {
		return `background: linear-gradient(to right, #10b981 0%, #10b981 ${fill}%, #3f3f46 ${fill}%, #3f3f46 100%)`;
	}

	// --- File I/O ---

	async function handleLoad() {
		try {
			const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
			const path = await openDialog({
				filters: [{ name: 'ZMK Profile', extensions: ['zmk'] }]
			});
			if (!path) return;
			const bytes = await readBytes(path as string);
			const buffer = new Uint8Array(bytes).buffer;
			loadFromBuffer(buffer, (path as string).split('/').pop() ?? '');
			lastSavedPath = path as string;
			addToast(`Loaded ${zmk!.profileName}`, 'success');
		} catch {
			// Fallback to file input if Tauri dialog fails (e.g. dev mode)
			fileInput.click();
		}
	}

	function loadFromBuffer(buffer: ArrayBuffer, name: string) {
		zmk = parseZmk(buffer);
		fileName = name;
		lastLoadedBuffer = buffer.slice(0);
		savedCurve = zmk.profiles[activeProfile].curve.map((p) => ({ ...p }));
		if (zmk.legacyFormat) {
			addToast('Legacy format detected — some key mappings may be inaccurate', 'warning', 5000);
		}
	}

	async function handleFileSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const buffer = await file.arrayBuffer();
			loadFromBuffer(buffer, file.name);
			addToast(`Loaded ${zmk!.profileName}`, 'success');
		} catch (err) {
			addToast(`Failed to parse .zmk: ${err}`, 'error');
		}
		input.value = '';
	}

	function handleNew() {
		try {
			const raw = atob(DEFAULT_ZMK_B64);
			const buffer = new ArrayBuffer(raw.length);
			const view = new Uint8Array(buffer);
			for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
			loadFromBuffer(buffer, '');
			zmk!.profileName = 'New Profile';
			activeProfile = 0;
			addToast('Created new profile', 'success');
		} catch (err) {
			addToast(`Failed to create: ${err}`, 'error');
		}
	}

	function handleReload() {
		if (!lastLoadedBuffer) return;
		try {
			loadFromBuffer(lastLoadedBuffer, fileName);
			addToast('Reloaded from last save', 'success');
		} catch (err) {
			addToast(`Failed to reload: ${err}`, 'error');
		}
	}

	let lastSavedPath = $state('');

	async function handleSave() {
		if (!zmk) return;
		try {
			const saveZmk = { ...zmk, legacyFormat: false };
			const buffer = serializeZmk(saveZmk);
			const bytes = Array.from(new Uint8Array(buffer));

			// Default to workspace/profiles/ directory
			const appRoot = await getAppRoot();
			const defaultName = fileName || `${zmk.profileName}.zmk`;
			const defaultDir = `${appRoot}/profiles`;
			const defaultPath = lastSavedPath || `${defaultDir}/${defaultName}`;

			const { save } = await import('@tauri-apps/plugin-dialog');
			const path = await save({
				defaultPath,
				filters: [{ name: 'ZMK Profile', extensions: ['zmk'] }]
			});
			if (!path) return;

			await writeBytes(path, bytes);
			lastSavedPath = path;
			lastLoadedBuffer = buffer.slice(0);
			const shortName = path.split('/').pop() ?? path;
			addToast(`Saved ${shortName}`, 'success');
		} catch (err) {
			addToast(`Failed to save: ${err}`, 'error');
		}
	}

	async function handleOpenFolder() {
		if (!lastSavedPath) return;
		try {
			const dir = lastSavedPath.substring(0, lastSavedPath.lastIndexOf('/'));
			const { openPath } = await import('@tauri-apps/plugin-opener');
			await openPath(dir);
		} catch {
			// ignore
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		const file = e.dataTransfer?.files[0];
		if (file && file.name.endsWith('.zmk')) {
			file.arrayBuffer().then((buf) => {
				try {
					loadFromBuffer(buf, file.name);
					addToast(`Loaded ${zmk!.profileName}`, 'success');
				} catch (err) {
					addToast(`Failed to parse: ${err}`, 'error');
				}
			});
		}
	}

	// --- Curve editor ---


	function curveToSvgX(x: number): number {
		return CX + (x / 100) * CW;
	}

	function curveToSvgY(y: number): number {
		return CY + CH - (y / 100) * CH;
	}

	function svgToCurveY(svgY: number): number {
		return Math.round(Math.max(0, Math.min(100, ((CY + CH - svgY) / CH) * 100)));
	}

	function getSvgPoint(e: MouseEvent): { svgX: number; svgY: number } {
		if (!curveEl) return { svgX: 0, svgY: 0 };
		const pt = curveEl.createSVGPoint();
		pt.x = e.clientX;
		pt.y = e.clientY;
		const svgPt = pt.matrixTransform(curveEl.getScreenCTM()!.inverse());
		return { svgX: svgPt.x, svgY: svgPt.y };
	}

	function handleCurveMousedown(e: MouseEvent, index: number) {
		if (e.button !== 0) return;
		e.preventDefault();
		draggingPointIndex = index;
	}

	function handleSvgMousedown(e: MouseEvent) {
		if (!drawMode || e.button !== 0) return;
		e.preventDefault();
		drawPoints = [getSvgPoint(e)];
	}

	function handleSvgMousemove(e: MouseEvent) {
		if (drawMode) {
			if (drawPoints.length > 0) {
				drawPoints = [...drawPoints, getSvgPoint(e)];
			}
			return;
		}
		if (draggingPointIndex === null || !profile) return;
		const { svgY } = getSvgPoint(e);
		profile.curve[draggingPointIndex].y = svgToCurveY(svgY);
	}

	function handleSvgMouseup() {
		if (drawMode && drawPoints.length > 1 && profile) {
			// Sample the freehand drawing at the 21 X positions
			// Sort draw points by svgX
			const sorted = [...drawPoints].sort((a, b) => a.svgX - b.svgX);
			for (let i = 0; i < 21; i++) {
				const targetSvgX = curveToSvgX(i * 5);
				// Find the closest drawn point to this X
				let closest = sorted[0];
				let bestDist = Math.abs(sorted[0].svgX - targetSvgX);
				for (const dp of sorted) {
					const dist = Math.abs(dp.svgX - targetSvgX);
					if (dist < bestDist) {
						bestDist = dist;
						closest = dp;
					}
				}
				profile.curve[i].y = svgToCurveY(closest.svgY);
				profile.curve[i].anchor = true;
			}
			drawPoints = [];
			drawMode = false;
			addToast('Curve drawn', 'success');
			return;
		}
		drawPoints = [];
		draggingPointIndex = null;
	}

	function applyCurvePreset(type: 'linear' | 'aggressive' | 'smooth' | 'reset') {
		if (!profile) return;
		if (type === 'reset' && savedCurve) {
			profile.curve = savedCurve.map((p) => ({ ...p }));
			return;
		}
		if (type === 'linear') {
			profile.curve = linearCurve();
			return;
		}
		const pts: CurvePoint[] = [];
		for (let i = 0; i < 21; i++) {
			const x = i * 5;
			const t = x / 100;
			let y: number;
			if (type === 'aggressive') {
				y = Math.round(Math.pow(t, 0.5) * 100);
			} else {
				// smooth S-curve
				const s = t * t * (3 - 2 * t);
				y = Math.round(s * 100);
			}
			pts.push({ x, y, anchor: true });
		}
		profile.curve = pts;
	}

	// --- Copy/Paste (ZenStudio compatible) ---

	async function copyBinds() {
		if (!profile) return;
		const mappings =
			activeTab === 'secondary' ? profile.secondaryMappings : profile.primaryMappings;
		await navigator.clipboard.writeText(encodeBindsClip(mappings));
		addToast('Binds copied', 'success');
	}

	async function pasteBinds() {
		if (!profile) return;
		const text = await navigator.clipboard.readText();
		const mappings = decodeBindsClip(text);
		if (!mappings) {
			addToast('Invalid binds clipboard data', 'error');
			return;
		}
		if (activeTab === 'secondary') {
			profile.secondaryMappings = mappings;
		} else {
			profile.primaryMappings = mappings;
		}
		addToast('Binds pasted', 'success');
	}

	async function copyCurve() {
		if (!profile) return;
		await navigator.clipboard.writeText(encodeCurveClip(profile.curve));
		addToast('Curve copied', 'success');
	}

	async function pasteCurve() {
		if (!profile) return;
		const text = await navigator.clipboard.readText();
		const curve = decodeCurveClip(text);
		if (!curve) {
			addToast('Invalid curve clipboard data', 'error');
			return;
		}
		profile.curve = curve;
		addToast('Curve pasted', 'success');
	}

	async function copyTuning() {
		if (!profile) return;
		await navigator.clipboard.writeText(encodeTuningClip(profile.aim));
		addToast('Tuning copied', 'success');
	}

	async function pasteTuning() {
		if (!profile) return;
		const text = await navigator.clipboard.readText();
		const aim = decodeTuningClip(text);
		if (!aim) {
			addToast('Invalid tuning clipboard data', 'error');
			return;
		}
		profile.aim = aim;
		addToast('Tuning pasted', 'success');
	}

	async function copyTranslator() {
		if (!profile) return;
		await navigator.clipboard.writeText(encodeTranslatorClip(profile.translator));
		addToast('Translator copied', 'success');
	}

	async function pasteTranslator() {
		if (!profile) return;
		const text = await navigator.clipboard.readText();
		const translator = decodeTranslatorClip(text);
		if (!translator) {
			addToast('Invalid translator clipboard data', 'error');
			return;
		}
		profile.translator = translator;
		addToast('Translator pasted', 'success');
	}

	let curvePolyline = $derived(
		profile?.curve.map((p) => `${curveToSvgX(p.x)},${curveToSvgY(p.y)}`).join(' ') ?? ''
	);

	let curveFillPath = $derived.by(() => {
		if (!profile) return '';
		const pts = profile.curve;
		const start = `${curveToSvgX(0)},${curveToSvgY(0)}`;
		const line = pts
			.map((p) => `${curveToSvgX(p.x)},${curveToSvgY(p.y)}`)
			.join(' ');
		const end = `${curveToSvgX(100)},${curveToSvgY(0)}`;
		return `M${start} L${line} L${end} Z`;
	});
</script>

<input
	type="file"
	accept=".zmk"
	class="hidden"
	bind:this={fileInput}
	onchange={handleFileSelected}
/>

<div class="flex h-full flex-col bg-zinc-950 text-zinc-100">
	<ToolHeader title="M&K Settings Editor" subtitle="View and edit Cronus Zen .zmk profiles">
		{#snippet children()}
			<div class="flex items-center gap-2">
				<button
					class="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600"
					onclick={handleNew}
				>
					New
				</button>
				<button
					class="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600"
					onclick={handleLoad}
				>
					Open .zmk
				</button>
				{#if zmk}
					<button
						class="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-600"
						onclick={handleReload}
						title="Reload from last loaded file"
					>
						Reload
					</button>
					<button
						class="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500"
						onclick={handleSave}
					>
						Save
					</button>
					{#if lastSavedPath}
						<button
							class="rounded bg-zinc-700 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200"
							onclick={handleOpenFolder}
							title="Open containing folder"
						>
							<svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
								<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
							</svg>
						</button>
					{/if}
					<span class="mx-1 h-5 w-px bg-zinc-700"></span>
					<button
						class="rounded px-2 py-1.5 text-xs {buttonLayout === 'ps'
							? 'bg-blue-600 text-white'
							: 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}"
						onclick={() => (buttonLayout = 'ps')}
					>
						PS
					</button>
					<button
						class="rounded px-2 py-1.5 text-xs {buttonLayout === 'xbox'
							? 'bg-green-600 text-white'
							: 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}"
						onclick={() => (buttonLayout = 'xbox')}
					>
						Xbox
					</button>
				{/if}
			</div>
		{/snippet}
	</ToolHeader>

	{#if !zmk}
		<!-- Drop zone -->
		<div
			class="flex flex-1 items-center justify-center"
			role="region"
			ondragover={(e) => e.preventDefault()}
			ondrop={handleDrop}
		>
			<div class="text-center">
				<div class="mb-4 text-6xl text-zinc-700">
					<svg
						class="mx-auto h-16 w-16"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
						/>
					</svg>
				</div>
				<p class="mb-2 text-lg text-zinc-400">Drop a .zmk file here</p>
				<p class="text-sm text-zinc-600">
					or click "Open .zmk" above, or
					<button
						class="text-emerald-500 underline hover:text-emerald-400"
						onclick={handleNew}>create a new one</button
					>
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<!-- Left sidebar: Profile info + sub-profile tabs -->
			<div class="w-64 overflow-y-auto border-r border-zinc-800">
				<div class="border-b border-zinc-800 p-4">
					<label class="mb-1 block text-xs text-zinc-500" for="zmk-name">Profile Name</label
					>
					<input
						id="zmk-name"
						type="text"
						class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
						bind:value={zmk.profileName}
					/>
					<p class="mt-2 text-xs text-zinc-600">
						Format {zmk.formatVersion} | {zmk.appVersion}
					</p>
				</div>

				<div class="p-2">
					<p class="px-2 py-1 text-xs font-medium text-zinc-500">Sub-Profiles</p>
					{#each PROFILE_NAMES as pname, i}
						<button
							class="w-full rounded px-3 py-2 text-left text-sm {activeProfile === i
								? 'bg-emerald-600/20 text-emerald-400'
								: 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'}"
							onclick={() => {
								activeProfile = i;
								savedCurve = zmk!.profiles[i].curve.map((p) => ({ ...p }));
							}}
						>
							<span class="font-medium">{pname}</span>
							{#if zmk.profiles[i].aim.sensitivity > 0}
								<span class="ml-2 text-xs text-zinc-600">
									{formatValue100(zmk.profiles[i].aim.sensitivity)} sens
								</span>
							{/if}
						</button>
					{/each}
				</div>

				<div class="border-t border-zinc-800 p-4">
					<label class="mb-1 block text-xs text-zinc-500" for="zmk-notes"
						>In-Game Notes</label
					>
					<textarea
						id="zmk-notes"
						class="h-20 w-full resize-y rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-emerald-500 focus:outline-none"
						bind:value={zmk.notes}
					></textarea>
				</div>
			</div>

			<!-- Main content -->
			{#if profile}
				<div class="flex flex-1 flex-col overflow-hidden">
					<!-- Tabs -->
					<div class="flex border-b border-zinc-800">
						{#each ['primary', 'secondary', 'movement', 'controller', 'activation', 'curve'] as tab}
							<button
								class="border-b-2 px-4 py-2.5 text-sm font-medium uppercase tracking-wide {activeTab ===
								tab
									? 'border-emerald-500 text-emerald-400'
									: 'border-transparent text-zinc-500 hover:text-zinc-300'}"
								onclick={() => (activeTab = tab as typeof activeTab)}
							>
								{tab}
							</button>
						{/each}
					</div>

					<div class="flex min-h-0 flex-1">
						<!-- Main panel -->
						<div class="flex-1 overflow-y-auto p-4">
							{#if activeTab === 'primary' || activeTab === 'secondary'}
								{@const mappings =
									activeTab === 'primary'
										? profile.primaryMappings
										: profile.secondaryMappings}
								<div class="flex h-full gap-4">
									<!-- Mappings list -->
									<div class="flex min-h-0 flex-1 flex-col">
										<div class="mb-2 flex items-center gap-1">
											<button
												class="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
												onclick={copyBinds}>Copy</button
											>
											<button
												class="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
												onclick={pasteBinds}>Paste</button
											>
										</div>
										<div class="min-h-0 flex-1 space-y-1 overflow-y-auto">
											{#each CONTROLLER_SLOTS as slot, i}
												<div
													class="flex items-center gap-2 rounded px-3 py-1.5 {mappings[i].type === InputDevice.None ? 'opacity-40' : 'bg-zinc-900'}"
												>
													<span class="w-20 shrink-0 text-xs font-medium text-zinc-500"
														>{getSlotDisplayName(slot, buttonLayout)}</span
													>
													<div class="flex-1">
														<ZmkMappingSelect
															mapping={mappings[i]}
															onchange={(m) => {
																mappings[i] = m;
															}}
														/>
													</div>
												</div>
											{/each}
										</div>
									</div>
									<!-- Curve preview -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div
										class="flex min-h-0 flex-1 cursor-pointer flex-col rounded border border-zinc-800 bg-zinc-900 p-3 transition-colors hover:border-zinc-700"
										onclick={() => (activeTab = 'curve')}
										title="Click to edit curve"
									>
										<h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
											Ballistic Curve
										</h3>
										<svg viewBox="-4 -4 108 108" class="min-h-0 w-full flex-1" preserveAspectRatio="xMidYMid meet">
											{#each [0, 25, 50, 75, 100] as g}
												<line x1={g} y1="0" x2={g} y2="100" stroke="#27272a" stroke-width="0.5" />
												<line x1="0" y1={g} x2="100" y2={g} stroke="#27272a" stroke-width="0.5" />
											{/each}
											<line x1="0" y1="100" x2="100" y2="0" stroke="#3f3f46" stroke-width="0.5" stroke-dasharray="2 2" />
											<polyline
												fill="none"
												stroke="#10b981"
												stroke-width="1.5"
												stroke-linejoin="round"
												points={profile.curve
													.map((p) => `${p.x},${100 - p.y}`)
													.join(' ')}
											/>
											{#each profile.curve.filter((p) => p.anchor) as p}
												<circle cx={p.x} cy={100 - p.y} r="2" fill="#fbbf24" />
											{/each}
										</svg>
										<div class="mt-2 flex flex-wrap gap-1">
											{#each profile.curve.filter((p) => p.anchor) as p}
												<span class="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
													{p.x},{p.y}
												</span>
											{/each}
										</div>
									</div>
								</div>
							{:else if activeTab === 'movement'}
								<div class="space-y-3">
									<div class="rounded bg-zinc-900 p-4">
										<h3 class="mb-3 text-sm font-medium text-zinc-400">
											WASD Keys
										</h3>
										<div class="grid grid-cols-2 gap-2">
											{#each [{ label: 'Forward', key: 'forward' as const }, { label: 'Left', key: 'left' as const }, { label: 'Right', key: 'right' as const }, { label: 'Back', key: 'back' as const }] as { label, key }}
												<div class="rounded bg-zinc-800 px-3 py-2">
													<span class="mb-1 block text-xs text-zinc-500"
														>{label}</span
													>
													<ZmkMappingSelect
														mapping={profile.movement[key]}
														onchange={(m) => {
															profile.movement[key] = m;
														}}
													/>
												</div>
											{/each}
										</div>
									</div>
									<div class="rounded bg-zinc-900 p-4">
										<div class="space-y-3">
											<div>
												<div class="mb-1 flex items-center justify-between">
													<span class="text-sm text-zinc-400">Analog Sim</span>
													<input
														type="number"
														step="1"
														min="0"
														max="100"
														class={numCls}
														value={profile.movement.analogSim}
														onchange={(e) => {
															const v = parseInt(
																(e.target as HTMLInputElement).value
															);
															if (!isNaN(v))
																profile.movement.analogSim = Math.max(
																	0,
																	Math.min(100, v)
																);
														}}
													/>
												</div>
												<input
													type="range"
													min="0"
													max="100"
													class="zmk-slider h-1.5 w-full cursor-pointer appearance-none rounded-lg"
													style={sliderBg(sliderFill(profile.movement.analogSim, 0, 100))}
													value={profile.movement.analogSim}
													oninput={(e) => {
														profile.movement.analogSim = parseInt(
															(e.target as HTMLInputElement).value
														);
													}}
												/>
											</div>
											<div>
												<div class="mb-1 flex items-center justify-between">
													<span class="text-sm text-zinc-400">Walk Scale</span>
													<input
														type="number"
														step="1"
														min="1"
														max="100"
														class={numCls}
														value={profile.movement.walkScale}
														onchange={(e) => {
															const v = parseInt(
																(e.target as HTMLInputElement).value
															);
															if (!isNaN(v))
																profile.movement.walkScale = Math.max(
																	1,
																	Math.min(100, v)
																);
														}}
													/>
												</div>
												<input
													type="range"
													min="1"
													max="100"
													class="zmk-slider h-1.5 w-full cursor-pointer appearance-none rounded-lg"
													style={sliderBg(sliderFill(profile.movement.walkScale, 1, 100))}
													value={profile.movement.walkScale}
													oninput={(e) => {
														profile.movement.walkScale = parseInt(
															(e.target as HTMLInputElement).value
														);
													}}
												/>
											</div>
										</div>
									</div>
								</div>
							{:else if activeTab === 'controller'}
								<div class="space-y-3">
									<div class="rounded bg-zinc-900 p-4">
										<h3 class="mb-3 text-sm font-medium text-zinc-400">
											Axis Assignments
										</h3>
										<div class="space-y-2">
											{#each AXIS_SLOT_LABELS as label, i}
												<div class="flex items-center gap-3">
													<span class="w-28 shrink-0 text-xs text-zinc-500"
														>{label}</span
													>
													<select
														class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
														onchange={(e) => {
															profile.controller.ids[i] = parseInt(
																(e.target as HTMLSelectElement).value
															);
														}}
													>
														{#each Object.entries(AXIS_NAMES) as [val, name]}
															<option value={val} selected={parseInt(val) === profile.controller.ids[i]}>{name}</option>
														{/each}
													</select>
												</div>
											{/each}
										</div>
									</div>
									<div class="rounded bg-zinc-900 p-4">
										<h3 class="mb-3 text-sm font-medium text-zinc-400">
											Stick Deadzones
										</h3>
										<div class="grid grid-cols-2 gap-4">
											<div>
												<div class="mb-1 flex items-center justify-between">
													<span class="text-xs text-zinc-500">Left Stick</span>
													<input
														type="number"
														step="0.01"
														min="0"
														max="75.00"
														class={numCls}
														value={formatValue100(
															profile.controller.leftStickDeadzone
														)}
														onchange={(e) => {
															const v = parseFloat(
																(e.target as HTMLInputElement).value
															);
															if (!isNaN(v))
																profile.controller.leftStickDeadzone =
																	Math.round(v * 100);
														}}
													/>
												</div>
												<input
													type="range"
													min="0"
													max="7500"
													class="zmk-slider h-1.5 w-full cursor-pointer appearance-none rounded-lg"
													style={sliderBg(sliderFill(profile.controller.leftStickDeadzone, 0, 7500))}
													value={profile.controller.leftStickDeadzone}
													oninput={(e) => {
														profile.controller.leftStickDeadzone = parseInt(
															(e.target as HTMLInputElement).value
														);
													}}
												/>
											</div>
											<div>
												<div class="mb-1 flex items-center justify-between">
													<span class="text-xs text-zinc-500">Right Stick</span>
													<input
														type="number"
														step="0.01"
														min="0"
														max="75.00"
														class={numCls}
														value={formatValue100(
															profile.controller.rightStickDeadzone
														)}
														onchange={(e) => {
															const v = parseFloat(
																(e.target as HTMLInputElement).value
															);
															if (!isNaN(v))
																profile.controller.rightStickDeadzone =
																	Math.round(v * 100);
														}}
													/>
												</div>
												<input
													type="range"
													min="0"
													max="7500"
													class="zmk-slider h-1.5 w-full cursor-pointer appearance-none rounded-lg"
													style={sliderBg(sliderFill(profile.controller.rightStickDeadzone, 0, 7500))}
													value={profile.controller.rightStickDeadzone}
													oninput={(e) => {
														profile.controller.rightStickDeadzone = parseInt(
															(e.target as HTMLInputElement).value
														);
													}}
												/>
											</div>
										</div>
									</div>
									<div class="rounded bg-zinc-900 p-4">
										<h3 class="mb-3 text-sm font-medium text-zinc-400">
											Trigger Deadzones
										</h3>
										<div class="grid grid-cols-2 gap-4">
											<div>
												<div class="mb-1 flex items-center justify-between">
													<span class="text-xs text-zinc-500">Left Trigger</span>
													<input
														type="number"
														step="1"
														min="0"
														max="20"
														class={numCls}
														value={profile.controller.leftTriggerDeadzone}
														onchange={(e) => {
															const v = parseInt(
																(e.target as HTMLInputElement).value
															);
															if (!isNaN(v))
																profile.controller.leftTriggerDeadzone =
																	Math.max(0, Math.min(20, v));
														}}
													/>
												</div>
												<input
													type="range"
													min="0"
													max="20"
													class="zmk-slider h-1.5 w-full cursor-pointer appearance-none rounded-lg"
													style={sliderBg(sliderFill(profile.controller.leftTriggerDeadzone, 0, 20))}
													value={profile.controller.leftTriggerDeadzone}
													oninput={(e) => {
														profile.controller.leftTriggerDeadzone = parseInt(
															(e.target as HTMLInputElement).value
														);
													}}
												/>
											</div>
											<div>
												<div class="mb-1 flex items-center justify-between">
													<span class="text-xs text-zinc-500">Right Trigger</span>
													<input
														type="number"
														step="1"
														min="0"
														max="20"
														class={numCls}
														value={profile.controller.rightTriggerDeadzone}
														onchange={(e) => {
															const v = parseInt(
																(e.target as HTMLInputElement).value
															);
															if (!isNaN(v))
																profile.controller.rightTriggerDeadzone =
																	Math.max(0, Math.min(20, v));
														}}
													/>
												</div>
												<input
													type="range"
													min="0"
													max="20"
													class="zmk-slider h-1.5 w-full cursor-pointer appearance-none rounded-lg"
													style={sliderBg(sliderFill(profile.controller.rightTriggerDeadzone, 0, 20))}
													value={profile.controller.rightTriggerDeadzone}
													oninput={(e) => {
														profile.controller.rightTriggerDeadzone = parseInt(
															(e.target as HTMLInputElement).value
														);
													}}
												/>
											</div>
										</div>
									</div>
								</div>
							{:else if activeTab === 'activation'}
								<div class="space-y-3">
									<div class="rounded bg-zinc-900 p-4">
										<div class="space-y-3">
											<label class="flex items-center gap-2 text-sm text-zinc-400">
												<input
													type="checkbox"
													class="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
													checked={profile.activation.enabled}
													onchange={(e) => {
														profile.activation.enabled = (
															e.target as HTMLInputElement
														).checked;
													}}
												/>
												Enabled
											</label>
											<label class="flex items-center gap-2 text-sm text-zinc-400">
												<input
													type="checkbox"
													class="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
													checked={profile.activation.inherit}
													onchange={(e) => {
														profile.activation.inherit = (
															e.target as HTMLInputElement
														).checked;
													}}
												/>
												Inherit Mappings
											</label>
											<label class="flex items-center gap-2 text-sm text-zinc-400">
												<input
													type="checkbox"
													class="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
													checked={profile.activation.toggleToActivate}
													onchange={(e) => {
														profile.activation.toggleToActivate = (
															e.target as HTMLInputElement
														).checked;
													}}
												/>
												Toggle to Activate
											</label>
										</div>
									</div>
									<div class="rounded bg-zinc-900 p-4">
										<h3 class="mb-3 text-sm font-medium text-zinc-400">Delays</h3>
										<div class="space-y-3">
											<div>
												<div class="mb-1 flex items-center justify-between">
													<span class="text-sm text-zinc-400"
														>Activate (ms)</span
													>
													<input
														type="number"
														step="1"
														min="0"
														max="255"
														class={numCls}
														value={profile.activation.activateDelay}
														onchange={(e) => {
															const v = parseInt(
																(e.target as HTMLInputElement).value
															);
															if (!isNaN(v))
																profile.activation.activateDelay = Math.max(
																	0,
																	Math.min(255, v)
																);
														}}
													/>
												</div>
												<input
													type="range"
													min="0"
													max="255"
													class="zmk-slider h-1.5 w-full cursor-pointer appearance-none rounded-lg"
													style={sliderBg(sliderFill(profile.activation.activateDelay, 0, 255))}
													value={profile.activation.activateDelay}
													oninput={(e) => {
														profile.activation.activateDelay = parseInt(
															(e.target as HTMLInputElement).value
														);
													}}
												/>
											</div>
											<div>
												<div class="mb-1 flex items-center justify-between">
													<span class="text-sm text-zinc-400"
														>Deactivate (ms)</span
													>
													<input
														type="number"
														step="1"
														min="0"
														max="255"
														class={numCls}
														value={profile.activation.deactivateDelay}
														onchange={(e) => {
															const v = parseInt(
																(e.target as HTMLInputElement).value
															);
															if (!isNaN(v))
																profile.activation.deactivateDelay = Math.max(
																	0,
																	Math.min(255, v)
																);
														}}
													/>
												</div>
												<input
													type="range"
													min="0"
													max="255"
													class="zmk-slider h-1.5 w-full cursor-pointer appearance-none rounded-lg"
													style={sliderBg(sliderFill(profile.activation.deactivateDelay, 0, 255))}
													value={profile.activation.deactivateDelay}
													oninput={(e) => {
														profile.activation.deactivateDelay = parseInt(
															(e.target as HTMLInputElement).value
														);
													}}
												/>
											</div>
										</div>
									</div>
									<div class="rounded bg-zinc-900 p-4">
										<h3 class="mb-3 text-sm font-medium text-zinc-400">
											Raw Values
										</h3>
										<div class="space-y-1 text-xs text-zinc-500">
											<div>
												Mode: {profile.activation.mode} | Button ID: 0x{profile.activation.buttonId
													.toString(16)
													.toUpperCase()
													.padStart(2, '0')}
											</div>
										</div>
									</div>
								</div>
							{:else if activeTab === 'curve'}
								<!-- Interactive Ballistic Curve Editor -->
								<div class="flex h-full flex-col">
									<!-- Preset buttons -->
									<div class="mb-3 flex items-center gap-2">
										<span class="text-xs text-zinc-500">Presets:</span>
										{#each [{ id: 'linear', label: 'Linear' }, { id: 'aggressive', label: 'Aggressive' }, { id: 'smooth', label: 'S-Curve' }, { id: 'reset', label: 'Reset' }] as preset}
											<button
												class="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
												onclick={() =>
													applyCurvePreset(
														preset.id as
															| 'linear'
															| 'aggressive'
															| 'smooth'
															| 'reset'
													)}
											>
												{preset.label}
											</button>
										{/each}
										<span class="mx-1 h-4 w-px bg-zinc-700"></span>
										<button
											class="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
											onclick={copyCurve}>Copy</button
										>
										<button
											class="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
											onclick={pasteCurve}>Paste</button
										>
										<span class="mx-1 h-4 w-px bg-zinc-700"></span>
										<button
											class="rounded px-2.5 py-1 text-xs {drawMode
												? 'bg-emerald-600 text-white'
												: 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}"
											onclick={() => {
												drawMode = !drawMode;
												drawPoints = [];
											}}>Draw</button
										>
										<span class="ml-auto text-[10px] text-zinc-600">
											{drawMode
												? 'Click and drag to draw a curve'
												: 'Drag points to adjust curve'}
										</span>
									</div>

									<!-- SVG curve canvas -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<svg
										bind:this={curveEl}
										viewBox="0 0 {SVG_W} {SVG_H}"
										class="min-h-0 w-full flex-1 rounded border border-zinc-800 bg-zinc-900 {drawMode
											? 'cursor-crosshair'
											: ''}"
										style="max-height: 500px"
										onmousedown={handleSvgMousedown}
										onmousemove={handleSvgMousemove}
										onmouseup={handleSvgMouseup}
										onmouseleave={handleSvgMouseup}

									>
										<!-- Grid lines -->
										{#each [0, 25, 50, 75, 100] as gx}
											{@const x = curveToSvgX(gx)}
											<line
												x1={x}
												y1={CY}
												x2={x}
												y2={CY + CH}
												stroke="#27272a"
												stroke-width="0.5"
											/>
											<text
												x={x}
												y={CY + CH + 16}
												fill="#52525b"
												font-size="10"
												text-anchor="middle">{gx}</text
											>
										{/each}
										{#each [0, 25, 50, 75, 100] as gy}
											{@const y = curveToSvgY(gy)}
											<line
												x1={CX}
												y1={y}
												x2={CX + CW}
												y2={y}
												stroke="#27272a"
												stroke-width="0.5"
											/>
											<text
												x={CX - 6}
												y={y + 3}
												fill="#52525b"
												font-size="10"
												text-anchor="end">{gy}</text
											>
										{/each}

										<!-- Axis labels -->
										<text
											x={CX + CW / 2}
											y={SVG_H - 2}
											fill="#71717a"
											font-size="11"
											text-anchor="middle">Input %</text
										>
										<text
											x={12}
											y={CY + CH / 2}
											fill="#71717a"
											font-size="11"
											text-anchor="middle"
											transform="rotate(-90, 12, {CY + CH / 2})">Output</text
										>

										<!-- Linear reference -->
										<line
											x1={curveToSvgX(0)}
											y1={curveToSvgY(0)}
											x2={curveToSvgX(100)}
											y2={curveToSvgY(100)}
											stroke="#3f3f46"
											stroke-width="1"
											stroke-dasharray="4 4"
										/>

										<!-- Filled area under curve -->
										<path d={curveFillPath} fill="#10b981" fill-opacity="0.08" />

										<!-- Curve line -->
										<polyline
											fill="none"
											stroke="#10b981"
											stroke-width="2"
											stroke-linejoin="round"
											points={curvePolyline}
										/>

										<!-- Draggable points -->
										{#each profile.curve as p, i}
											{@const cx = curveToSvgX(p.x)}
											{@const cy = curveToSvgY(p.y)}
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<circle
												{cx}
												{cy}
												r="5"
												fill="#fbbf24"
												fill-opacity={draggingPointIndex === i ? 1 : 0.7}
												stroke="#92400e"
												stroke-width="1.5"
												class="cursor-grab"
												onmousedown={(e) => handleCurveMousedown(e, i)}
												onmouseenter={() => (hoveredPointIndex = i)}
												onmouseleave={() => (hoveredPointIndex = null)}
											/>
										{/each}

										<!-- Tooltip -->
										{#if hoveredPointIndex !== null && profile.curve[hoveredPointIndex]}
											{@const tp = profile.curve[hoveredPointIndex]}
											{@const tx = curveToSvgX(tp.x)}
											{@const ty = curveToSvgY(tp.y) - 14}
											<rect
												x={tx - 28}
												y={ty - 12}
												width="56"
												height="16"
												rx="3"
												fill="#18181b"
												stroke="#3f3f46"
												stroke-width="0.5"
											/>
											<text
												x={tx}
												y={ty - 1}
												fill="#e4e4e7"
												font-size="10"
												text-anchor="middle">{tp.x}, {tp.y}</text
											>
										{/if}

										<!-- Freehand drawing path -->
										{#if drawPoints.length > 1}
											<polyline
												fill="none"
												stroke="#f59e0b"
												stroke-width="2"
												stroke-dasharray="4 2"
												opacity="0.8"
												points={drawPoints
													.map((dp) => `${dp.svgX},${dp.svgY}`)
													.join(' ')}
											/>
										{/if}
									</svg>

									<!-- Anchor points list -->
									<div class="mt-2 flex flex-wrap gap-1">
										{#each profile.curve as p}
											<span
												class="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500"
											>
												{p.x}:{p.y}
											</span>
										{/each}
									</div>
								</div>
							{/if}
						</div>

						<!-- Right panel: Aim & Translator settings -->
						<div class="w-72 overflow-y-auto border-l border-zinc-800 p-4">
							<!-- Aim Tuning -->
							<div class="mb-6">
								<div
									class="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2"
								>
									<h3
										class="text-xs font-semibold uppercase tracking-wider text-zinc-500"
									>
										Aim Tuning
									</h3>
									<div class="flex gap-1">
										<button
											class="rounded px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
											onclick={copyTuning}>Copy</button
										>
										<button
											class="rounded px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
											onclick={pasteTuning}>Paste</button
										>
									</div>
								</div>
								<div class="space-y-3">
									<div>
										<label
											class="mb-1 block text-xs text-zinc-500"
											for="sens-{activeProfile}">Sensitivity</label
										>
										<div class="flex items-center gap-2">
											<input
												type="range"
												min="100"
												max="10000"
												class="zmk-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg"
												style={sliderBg(sliderFill(profile.aim.sensitivity, 100, 10000))}
												value={profile.aim.sensitivity}
												oninput={(e) => {
													profile.aim.sensitivity = parseInt(
														(e.target as HTMLInputElement).value
													);
												}}
											/>
											<input
												id="sens-{activeProfile}"
												type="number"
												step="0.01"
												min="0"
												class={numCls}
												value={formatValue100(profile.aim.sensitivity)}
												onchange={(e) => {
													const v = parseFloat(
														(e.target as HTMLInputElement).value
													);
													if (!isNaN(v))
														profile.aim.sensitivity = Math.round(v * 100);
												}}
											/>
										</div>
									</div>
									<div>
										<label
											class="mb-1 block text-xs text-zinc-500"
											for="xy-{activeProfile}">X/Y Axis Ratio</label
										>
										<div class="flex items-center gap-2">
											<input
												type="range"
												min="10"
												max="199"
												class="zmk-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg"
												style={sliderBg(sliderFill(profile.aim.xyRatio, 10, 199))}
												value={profile.aim.xyRatio}
												oninput={(e) => {
													profile.aim.xyRatio = parseInt(
														(e.target as HTMLInputElement).value
													);
												}}
											/>
											<input
												id="xy-{activeProfile}"
												type="number"
												step="0.01"
												min="0.10"
												max="1.99"
												class={numCls}
												value={formatXYRatio(profile.aim.xyRatio)}
												onchange={(e) => {
													const v = parseFloat(
														(e.target as HTMLInputElement).value
													);
													if (!isNaN(v))
														profile.aim.xyRatio = Math.round(v * 100);
												}}
											/>
										</div>
									</div>
									<div>
										<label
											class="mb-1 block text-xs text-zinc-500"
											for="boost-{activeProfile}">Boost</label
										>
										<div class="flex items-center gap-2">
											<input
												type="range"
												min="-1000"
												max="1000"
												class="zmk-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg"
												style={sliderBg(sliderFill(profile.aim.boost, -1000, 1000))}
												value={profile.aim.boost}
												oninput={(e) => {
													profile.aim.boost = parseInt(
														(e.target as HTMLInputElement).value
													);
												}}
											/>
											<input
												id="boost-{activeProfile}"
												type="number"
												step="0.01"
												min="0"
												class={numCls}
												value={formatValue100(profile.aim.boost)}
												onchange={(e) => {
													const v = parseFloat(
														(e.target as HTMLInputElement).value
													);
													if (!isNaN(v))
														profile.aim.boost = Math.round(v * 100);
												}}
											/>
										</div>
									</div>
									<div>
										<label
											class="mb-1 block text-xs text-zinc-500"
											for="smooth-{activeProfile}">Smoothness</label
										>
										<div class="flex items-center gap-2">
											<input
												type="range"
												min="0"
												max="99"
												class="zmk-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg"
												style={sliderBg(sliderFill(profile.aim.smoothness, 0, 99))}
												value={profile.aim.smoothness}
												oninput={(e) => {
													profile.aim.smoothness = parseInt(
														(e.target as HTMLInputElement).value
													);
												}}
											/>
											<input
												id="smooth-{activeProfile}"
												type="number"
												step="1"
												min="0"
												max="99"
												class={numCls}
												value={profile.aim.smoothness}
												onchange={(e) => {
													const v = parseInt(
														(e.target as HTMLInputElement).value
													);
													if (!isNaN(v))
														profile.aim.smoothness = Math.max(
															0,
															Math.min(99, v)
														);
												}}
											/>
										</div>
									</div>
									<div>
										<label
											class="flex items-center gap-2 text-xs text-zinc-400"
										>
											<input
												type="checkbox"
												class="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500"
												checked={profile.aim.invertY}
												onchange={(e) => {
													profile.aim.invertY = (
														e.target as HTMLInputElement
													).checked;
												}}
											/>
											Invert Y-Axis
										</label>
									</div>
								</div>
							</div>

							<!-- Translator -->
							<div class="mb-6">
								<div
									class="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2"
								>
									<h3
										class="text-xs font-semibold uppercase tracking-wider text-zinc-500"
									>
										Translator
									</h3>
									<div class="flex gap-1">
										<button
											class="rounded px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
											onclick={copyTranslator}>Copy</button
										>
										<button
											class="rounded px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
											onclick={pasteTranslator}>Paste</button
										>
									</div>
								</div>
								<div class="space-y-3">
									<div>
										<label
											class="mb-1 block text-xs text-zinc-500"
											for="dzx-{activeProfile}">Deadzone X</label
										>
										<div class="flex items-center gap-2">
											<input
												type="range"
												min="100"
												max="10000"
												class="zmk-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg"
												style={sliderBg(sliderFill(profile.translator.deadzoneX, 100, 10000))}
												value={profile.translator.deadzoneX}
												oninput={(e) => {
													profile.translator.deadzoneX = parseInt(
														(e.target as HTMLInputElement).value
													);
												}}
											/>
											<input
												id="dzx-{activeProfile}"
												type="number"
												step="0.01"
												min="0"
												class={numCls}
												value={formatValue100(profile.translator.deadzoneX)}
												onchange={(e) => {
													const v = parseFloat(
														(e.target as HTMLInputElement).value
													);
													if (!isNaN(v))
														profile.translator.deadzoneX = Math.round(
															v * 100
														);
												}}
											/>
										</div>
									</div>
									<div>
										<label
											class="mb-1 block text-xs text-zinc-500"
											for="dzy-{activeProfile}">Deadzone Y</label
										>
										<div class="flex items-center gap-2">
											<input
												type="range"
												min="100"
												max="10000"
												class="zmk-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg"
												style={sliderBg(sliderFill(profile.translator.deadzoneY, 100, 10000))}
												value={profile.translator.deadzoneY}
												oninput={(e) => {
													profile.translator.deadzoneY = parseInt(
														(e.target as HTMLInputElement).value
													);
												}}
											/>
											<input
												id="dzy-{activeProfile}"
												type="number"
												step="0.01"
												min="0"
												class={numCls}
												value={formatValue100(profile.translator.deadzoneY)}
												onchange={(e) => {
													const v = parseFloat(
														(e.target as HTMLInputElement).value
													);
													if (!isNaN(v))
														profile.translator.deadzoneY = Math.round(
															v * 100
														);
												}}
											/>
										</div>
									</div>
									<div>
										<label
											class="mb-1 block text-xs text-zinc-500"
											for="stk-{activeProfile}">Analog Stickize</label
										>
										<div class="flex items-center gap-2">
											<input
												type="range"
												min="10000"
												max="14200"
												class="zmk-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg"
												style={sliderBg(sliderFill(profile.translator.analogStickize, 10000, 14200))}
												value={profile.translator.analogStickize}
												oninput={(e) => {
													profile.translator.analogStickize = parseInt(
														(e.target as HTMLInputElement).value
													);
												}}
											/>
											<input
												id="stk-{activeProfile}"
												type="number"
												step="0.01"
												min="0"
												class={numCls}
												value={formatValue100(
													profile.translator.analogStickize
												)}
												onchange={(e) => {
													const v = parseFloat(
														(e.target as HTMLInputElement).value
													);
													if (!isNaN(v))
														profile.translator.analogStickize = Math.round(
															v * 100
														);
												}}
											/>
										</div>
									</div>
									<div>
										<label
											class="mb-1 block text-xs text-zinc-500"
											for="dzshape-{activeProfile}">Deadzone Shape</label
										>
										<select
											id="dzshape-{activeProfile}"
											class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
											onchange={(e) => {
												profile.translator.deadzoneShape = parseInt(
													(e.target as HTMLSelectElement).value
												) as DeadzoneShape;
											}}
										>
											{#each Object.entries(DEADZONE_SHAPE_NAMES) as [val, name]}
												<option value={val} selected={parseInt(val) === profile.translator.deadzoneShape}>{name}</option>
											{/each}
										</select>
									</div>
								</div>
							</div>

						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.zmk-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #10b981;
		border: 2px solid #064e3b;
		cursor: pointer;
	}
	.zmk-slider::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #10b981;
		border: 2px solid #064e3b;
		cursor: pointer;
	}
</style>
