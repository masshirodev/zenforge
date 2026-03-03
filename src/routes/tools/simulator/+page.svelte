<script lang="ts">
	import { addToast } from '$lib/stores/toast.svelte';
	import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';

	// Simulator state
	let code = $state(`combo RapidFire {
    set_val(PS5_R2, 100);
    wait(40);
    set_val(PS5_R2, 0);
    wait(40);
}`);

	interface SimStep {
		line: number;
		action: string;
		values: Map<string, number>;
		waitMs: number;
		timestamp: number;
	}

	let steps = $state<SimStep[]>([]);
	let currentStep = $state(-1);
	let currentLoop = $state(0);
	let playing = $state(false);
	let playTimer = $state<ReturnType<typeof setTimeout> | null>(null);
	let loopCount = $state(1);
	let speed = $state(1);
	let activeValues = $state<Map<string, number>>(new Map());
	let parseError = $state('');

	// All known GPC button/axis constants
	const BUTTON_NAMES = [
		'PS5_CROSS', 'PS5_CIRCLE', 'PS5_SQUARE', 'PS5_TRIANGLE',
		'PS5_L1', 'PS5_R1', 'PS5_L2', 'PS5_R2', 'PS5_L3', 'PS5_R3',
		'PS5_UP', 'PS5_DOWN', 'PS5_LEFT', 'PS5_RIGHT',
		'PS5_PS', 'PS5_TOUCH', 'PS5_OPTIONS', 'PS5_CREATE',
		'PS5_LX', 'PS5_LY', 'PS5_RX', 'PS5_RY',
		'XB1_A', 'XB1_B', 'XB1_X', 'XB1_Y',
		'XB1_LB', 'XB1_RB', 'XB1_LT', 'XB1_RT', 'XB1_LS', 'XB1_RS',
		'XB1_UP', 'XB1_DOWN', 'XB1_LEFT', 'XB1_RIGHT',
		'XB1_XBOX', 'XB1_VIEW', 'XB1_MENU',
		'XB1_LX', 'XB1_LY', 'XB1_RX', 'XB1_RY',
		'BUTTON_1', 'BUTTON_2', 'BUTTON_3', 'BUTTON_4',
		'BUTTON_5', 'BUTTON_6', 'BUTTON_7', 'BUTTON_8',
		'BUTTON_9', 'BUTTON_10', 'BUTTON_11', 'BUTTON_12',
		'BUTTON_13', 'BUTTON_14', 'BUTTON_15', 'BUTTON_16',
		'BUTTON_17', 'BUTTON_18', 'STICK_1_X', 'STICK_1_Y',
		'STICK_2_X', 'STICK_2_Y'
	];

	function parseCombo(source: string): SimStep[] {
		const result: SimStep[] = [];
		parseError = '';

		// Extract combo body
		const comboMatch = source.match(/combo\s+\w+\s*\{([\s\S]*)\}/);
		if (!comboMatch) {
			parseError = 'No combo block found. Wrap code in: combo Name { ... }';
			return [];
		}

		const body = comboMatch[1];
		const lines = body.split('\n');
		let currentValues = new Map<string, number>();
		let timestamp = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line || line.startsWith('//')) continue;

			// Match set_val(BUTTON, value)
			const setValMatch = line.match(/set_val\s*\(\s*(\w+)\s*,\s*(-?\d+)\s*\)/);
			if (setValMatch) {
				const btn = setValMatch[1];
				const val = parseInt(setValMatch[2]);
				currentValues = new Map(currentValues);
				currentValues.set(btn, val);
				result.push({
					line: i + 1,
					action: `set_val(${btn}, ${val})`,
					values: new Map(currentValues),
					waitMs: 0,
					timestamp
				});
				continue;
			}

			// Match wait(ms)
			const waitMatch = line.match(/wait\s*\(\s*(\d+)\s*\)/);
			if (waitMatch) {
				const ms = parseInt(waitMatch[1]);
				if (result.length > 0) {
					result[result.length - 1].waitMs = ms;
				} else {
					result.push({
						line: i + 1,
						action: `wait(${ms})`,
						values: new Map(currentValues),
						waitMs: ms,
						timestamp
					});
				}
				timestamp += ms;
				continue;
			}
		}

		return result;
	}

	function simulate() {
		stop();
		const parsed = parseCombo(code);
		if (parsed.length === 0 && !parseError) {
			parseError = 'No executable statements found';
			return;
		}
		steps = parsed;
		currentStep = -1;
		currentLoop = 0;
		activeValues = new Map();
	}

	function stepForward() {
		if (currentStep < steps.length - 1) {
			currentStep++;
			activeValues = new Map(steps[currentStep].values);
		} else if (currentLoop < loopCount - 1) {
			currentLoop++;
			currentStep = 0;
			activeValues = new Map(steps[0].values);
		}
	}

	function stepBack() {
		if (currentStep > 0) {
			currentStep--;
			activeValues = new Map(steps[currentStep].values);
		} else if (currentStep === 0 && currentLoop > 0) {
			currentLoop--;
			currentStep = steps.length - 1;
			activeValues = new Map(steps[currentStep].values);
		} else if (currentStep === 0) {
			currentStep = -1;
			activeValues = new Map();
		}
	}

	function play() {
		if (steps.length === 0) simulate();
		if (steps.length === 0) return;
		if (currentStep >= steps.length - 1 && currentLoop >= loopCount - 1) {
			currentStep = -1;
			currentLoop = 0;
			activeValues = new Map();
		}
		playing = true;
		playNext();
	}

	function playNext() {
		if (!playing) return;
		if (currentStep < steps.length - 1) {
			currentStep++;
		} else if (currentLoop < loopCount - 1) {
			currentLoop++;
			currentStep = 0;
		} else {
			playing = false;
			return;
		}
		activeValues = new Map(steps[currentStep].values);
		const waitMs = steps[currentStep].waitMs || 20;
		playTimer = setTimeout(playNext, waitMs / speed);
	}

	function stop() {
		playing = false;
		if (playTimer) {
			clearTimeout(playTimer);
			playTimer = null;
		}
	}

	function reset() {
		stop();
		currentStep = -1;
		currentLoop = 0;
		activeValues = new Map();
	}

	// Get button display state
	function getButtonValue(name: string): number {
		return activeValues.get(name) ?? 0;
	}

	function isAxis(name: string): boolean {
		return name.includes('LX') || name.includes('LY') ||
			name.includes('RX') || name.includes('RY') ||
			name.includes('STICK_');
	}

	// Active buttons for display
	let activeButtons = $derived(
		Array.from(activeValues.entries())
			.filter(([_, v]) => v !== 0)
			.sort((a, b) => a[0].localeCompare(b[0]))
	);

	let singleLoopDuration = $derived(
		steps.reduce((sum, s) => sum + s.waitMs, 0)
	);

	let totalDuration = $derived(singleLoopDuration * loopCount);

	let currentTime = $derived(
		currentStep >= 0
			? currentLoop * singleLoopDuration +
				steps.slice(0, currentStep + 1).reduce((sum, s) => sum + s.waitMs, 0)
			: 0
	);
</script>

<div class="flex h-full flex-col bg-zinc-950 text-zinc-200">
	<ToolHeader title="Combo Simulator" subtitle="Test and debug GPC combos in real-time" />

	<!-- Main Content -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Left Panel: Code Editor -->
		<div class="flex w-1/2 flex-col border-r border-zinc-800">
			<div class="border-b border-zinc-800 px-3 py-2">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium text-zinc-400">Combo Code</span>
					<div class="flex items-center gap-2">
						<label class="flex items-center gap-1.5 text-xs text-zinc-500">
							Loops:
							<input
								type="number"
								min="1"
								max="9999"
								bind:value={loopCount}
								class="w-14 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200"
							/>
						</label>
						<label class="flex items-center gap-1.5 text-xs text-zinc-500">
							Speed:
							<select
								bind:value={speed}
								class="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200"
							>
								<option value={0.25}>0.25x</option>
								<option value={0.5}>0.5x</option>
								<option value={1}>1x</option>
								<option value={2}>2x</option>
								<option value={4}>4x</option>
							</select>
						</label>
						<button
							class="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500"
							onclick={simulate}
						>
							Parse
						</button>
					</div>
				</div>
			</div>
			<div class="flex-1">
				<MonacoEditor
					value={code}
					language="gpc"
					onchange={(v) => (code = v)}
				/>
			</div>
		</div>

		<!-- Right Panel: Simulation -->
		<div class="flex w-1/2 flex-col">
			<!-- Controls -->
			<div class="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
				<button
					class="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
					onclick={stepBack}
					disabled={currentStep < 0 || playing}
					title="Step back"
				>
					&#9664;&#9664;
				</button>
				{#if playing}
					<button
						class="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
						onclick={stop}
					>
						Pause
					</button>
				{:else}
					<button
						class="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
						onclick={play}
						disabled={steps.length === 0}
					>
						Play
					</button>
				{/if}
				<button
					class="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
					onclick={stepForward}
					disabled={(currentStep >= steps.length - 1 && currentLoop >= loopCount - 1) || playing}
					title="Step forward"
				>
					&#9654;&#9654;
				</button>
				<button
					class="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
					onclick={reset}
					title="Reset"
				>
					Reset
				</button>
				<div class="ml-auto flex items-center gap-3 text-xs text-zinc-500">
					<span>Step {currentStep + 1}/{steps.length}</span>
					{#if loopCount > 1}
						<span>Loop {currentLoop + 1}/{loopCount}</span>
					{/if}
					<span>{currentTime}ms / {totalDuration}ms</span>
				</div>
			</div>

			{#if parseError}
				<div class="border-b border-red-900 bg-red-950/30 px-4 py-2 text-xs text-red-400">
					{parseError}
				</div>
			{/if}

			<!-- Active Values Display -->
			<div class="flex-1 overflow-y-auto p-4">
				{#if steps.length === 0}
					<div class="flex h-full items-center justify-center text-sm text-zinc-600">
						Paste a combo and click "Parse" to begin simulation
					</div>
				{:else}
					<!-- Current state -->
					<div class="mb-4 min-h-24">
						<h3 class="mb-2 text-xs font-semibold text-zinc-400 uppercase">Active Outputs</h3>
						{#if activeButtons.length === 0}
							<div class="rounded border border-zinc-800 bg-zinc-900 px-3 py-4 text-center text-xs text-zinc-600">
								No active outputs
							</div>
						{:else}
							<div class="grid grid-cols-2 gap-2">
								{#each activeButtons as [name, value]}
									<div class="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
										<span class="text-xs font-medium text-zinc-200">{name}</span>
										<div class="flex items-center gap-2">
											<div class="h-1.5 w-16 rounded-full bg-zinc-800">
												<div
													class="h-1.5 rounded-full transition-all {isAxis(name) ? 'bg-blue-400' : 'bg-emerald-400'}"
													style="width: {Math.abs(value)}%"
												></div>
											</div>
											<span class="w-8 text-right text-xs font-mono {value > 0 ? 'text-emerald-400' : 'text-blue-400'}">
												{value}
											</span>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Step Timeline -->
					<div>
						<h3 class="mb-2 text-xs font-semibold text-zinc-400 uppercase">Execution Timeline</h3>
						{#if loopCount > 1}
							<div class="mb-2 flex items-center gap-2 rounded bg-zinc-900 px-2 py-1 text-xs">
								<span class="text-zinc-500">Loop</span>
								<span class="font-medium text-emerald-400">{currentLoop + 1}</span>
								<span class="text-zinc-600">of {loopCount}</span>
								<div class="ml-auto h-1 w-20 rounded-full bg-zinc-800">
									<div
										class="h-1 rounded-full bg-emerald-500 transition-all"
										style="width: {((currentLoop + 1) / loopCount) * 100}%"
									></div>
								</div>
							</div>
						{/if}
						<div class="space-y-0.5">
							{#each steps as step, i}
								<button
									class="flex w-full items-center gap-3 rounded px-2 py-1 text-left text-xs transition-colors {currentStep === i ? 'bg-emerald-900/40 text-emerald-300' : 'text-zinc-400 hover:bg-zinc-900'}"
									onclick={() => {
										currentStep = i;
										activeValues = new Map(steps[i].values);
									}}
								>
									<span class="w-6 shrink-0 text-right text-zinc-600">{i + 1}</span>
									<span class="flex-1 font-mono">{step.action}</span>
									{#if step.waitMs > 0}
										<span class="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
											{step.waitMs}ms
										</span>
									{/if}
									<span class="text-[10px] text-zinc-600">{step.timestamp}ms</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
