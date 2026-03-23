<script lang="ts">
	import { addToast } from '$lib/stores/toast.svelte';
	import MonacoEditor from '$lib/components/editor/MonacoEditor.svelte';
	import ToolHeader from '$lib/components/layout/ToolHeader.svelte';
	import {
		CONSOLE_BUTTONS,
		CONSOLE_AXES,
		CONSOLE_LABELS,
		CONSOLE_TYPES,
		type ConsoleType
	} from '$lib/utils/console-buttons';

	// Simulator state
	let code = $state(`combo FullTest {
    // Triggers ramp
    set_val(PS5_R2, 50);
    set_val(PS5_L2, 50);
    wait(80);
    set_val(PS5_R2, 100);
    set_val(PS5_L2, 100);
    wait(80);
    set_val(PS5_R2, 0);
    set_val(PS5_L2, 0);
    wait(60);

    // Bumpers
    set_val(PS5_R1, 100);
    wait(60);
    set_val(PS5_R1, 0);
    set_val(PS5_L1, 100);
    wait(60);
    set_val(PS5_L1, 0);
    wait(40);

    // Face buttons
    set_val(PS5_TRIANGLE, 100);
    wait(80);
    set_val(PS5_TRIANGLE, 0);
    set_val(PS5_CIRCLE, 100);
    wait(80);
    set_val(PS5_CIRCLE, 0);
    set_val(PS5_CROSS, 100);
    wait(80);
    set_val(PS5_CROSS, 0);
    set_val(PS5_SQUARE, 100);
    wait(80);
    set_val(PS5_SQUARE, 0);
    wait(40);

    // D-Pad circle
    set_val(PS5_UP, 100);
    wait(60);
    set_val(PS5_UP, 0);
    set_val(PS5_RIGHT, 100);
    wait(60);
    set_val(PS5_RIGHT, 0);
    set_val(PS5_DOWN, 100);
    wait(60);
    set_val(PS5_DOWN, 0);
    set_val(PS5_LEFT, 100);
    wait(60);
    set_val(PS5_LEFT, 0);
    wait(40);

    // Left stick: circle pattern
    set_val(PS5_LX, 0);
    set_val(PS5_LY, -100);
    wait(60);
    set_val(PS5_LX, 70);
    set_val(PS5_LY, -70);
    wait(60);
    set_val(PS5_LX, 100);
    set_val(PS5_LY, 0);
    wait(60);
    set_val(PS5_LX, 70);
    set_val(PS5_LY, 70);
    wait(60);
    set_val(PS5_LX, 0);
    set_val(PS5_LY, 100);
    wait(60);
    set_val(PS5_LX, -70);
    set_val(PS5_LY, 70);
    wait(60);
    set_val(PS5_LX, -100);
    set_val(PS5_LY, 0);
    wait(60);
    set_val(PS5_LX, -70);
    set_val(PS5_LY, -70);
    wait(60);
    set_val(PS5_LX, 0);
    set_val(PS5_LY, 0);
    wait(40);

    // Right stick: diagonal sweep
    set_val(PS5_RX, -100);
    set_val(PS5_RY, -100);
    wait(60);
    set_val(PS5_RX, 0);
    set_val(PS5_RY, -50);
    wait(60);
    set_val(PS5_RX, 100);
    set_val(PS5_RY, 0);
    wait(60);
    set_val(PS5_RX, 50);
    set_val(PS5_RY, 50);
    wait(60);
    set_val(PS5_RX, -50);
    set_val(PS5_RY, 100);
    wait(60);
    set_val(PS5_RX, -100);
    set_val(PS5_RY, 50);
    wait(60);
    set_val(PS5_RX, 0);
    set_val(PS5_RY, 0);
    wait(40);

    // System buttons
    set_val(PS5_OPTIONS, 100);
    wait(60);
    set_val(PS5_OPTIONS, 0);
    set_val(PS5_SHARE, 100);
    wait(60);
    set_val(PS5_SHARE, 0);
    set_val(PS5_PS, 100);
    wait(60);
    set_val(PS5_PS, 0);
    set_val(PS5_TOUCH, 100);
    wait(60);
    set_val(PS5_TOUCH, 0);
    wait(40);

    // Stick clicks
    set_val(PS5_L3, 100);
    wait(60);
    set_val(PS5_L3, 0);
    set_val(PS5_R3, 100);
    wait(60);
    set_val(PS5_R3, 0);
    wait(40);

    // Combo finish: rapid fire burst
    set_val(PS5_R2, 100);
    set_val(PS5_CROSS, 100);
    wait(40);
    set_val(PS5_R2, 0);
    set_val(PS5_CROSS, 0);
    wait(40);
    set_val(PS5_R2, 100);
    set_val(PS5_CROSS, 100);
    wait(40);
    set_val(PS5_R2, 0);
    set_val(PS5_CROSS, 0);
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
	let loopCount = $state(100);
	let speed = $state(1);
	let activeValues = $state<Map<string, number>>(new Map());
	let parseError = $state('');
	let consoleOverride = $state<ConsoleType | 'auto'>('auto');

	// All known GPC button/axis constants
	const BUTTON_NAMES = [
		'PS5_CROSS', 'PS5_CIRCLE', 'PS5_SQUARE', 'PS5_TRIANGLE',
		'PS5_L1', 'PS5_R1', 'PS5_L2', 'PS5_R2', 'PS5_L3', 'PS5_R3',
		'PS5_UP', 'PS5_DOWN', 'PS5_LEFT', 'PS5_RIGHT',
		'PS5_PS', 'PS5_TOUCH', 'PS5_OPTIONS', 'PS5_SHARE',
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

	// Console detection from combo code
	let detectedConsole = $derived.by((): ConsoleType => {
		if (consoleOverride !== 'auto') return consoleOverride;
		for (const step of steps) {
			for (const key of step.values.keys()) {
				if (key.startsWith('PS5_') || key.startsWith('PS4_') || key.startsWith('PS3_')) return 'ps5';
				if (key.startsWith('XB1_') || key.startsWith('XB360_')) return 'xb1';
				if (key.startsWith('SWI_')) return 'swi';
				if (key.startsWith('WII_')) return 'wii';
			}
		}
		return 'ps5';
	});

	// Controller value helpers
	function btnVal(gpcValue: number): number {
		const btn = CONSOLE_BUTTONS[detectedConsole]?.find((b) => b.value === gpcValue);
		if (btn && activeValues.has(btn.name)) return activeValues.get(btn.name)!;
		const genericName = `BUTTON_${gpcValue + 1}`;
		if (activeValues.has(genericName)) return activeValues.get(genericName)!;
		return 0;
	}

	function btnOn(gpcValue: number): boolean {
		return btnVal(gpcValue) !== 0;
	}

	function stickVal(axis: 'lx' | 'ly' | 'rx' | 'ry'): number {
		const axes = CONSOLE_AXES[detectedConsole];
		const name = axes[axis];
		if (activeValues.has(name)) return activeValues.get(name)!;
		const genericMap = { lx: 'STICK_1_X', ly: 'STICK_1_Y', rx: 'STICK_2_X', ry: 'STICK_2_Y' };
		return activeValues.get(genericMap[axis]) ?? 0;
	}

	let leftStickActive = $derived(stickVal('lx') !== 0 || stickVal('ly') !== 0);
	let rightStickActive = $derived(stickVal('rx') !== 0 || stickVal('ry') !== 0);

	// Face button labels per console
	const FACE_LABELS: Record<string, Record<number, string>> = {
		ps5: { 17: '△', 18: '○', 19: '✕', 20: '□' },
		xb1: { 17: 'Y', 18: 'B', 19: 'A', 20: 'X' },
		swi: { 17: 'X', 18: 'A', 19: 'B', 20: 'Y' },
		wii: { 17: 'X', 18: 'B', 19: 'A', 20: 'Y' }
	};

	const SHOULDER_LABELS: Record<string, Record<number, string>> = {
		ps5: { 7: 'L2', 6: 'L1', 4: 'R2', 3: 'R1' },
		xb1: { 7: 'LT', 6: 'LB', 4: 'RT', 3: 'RB' },
		swi: { 7: 'ZL', 6: 'L', 4: 'ZR', 3: 'R' },
		wii: { 7: 'ZL', 6: 'LT', 4: 'ZR', 3: 'RT' }
	};

	function faceLabel(gpcValue: number): string {
		return FACE_LABELS[detectedConsole]?.[gpcValue] ?? '';
	}

	function shoulderLabel(gpcValue: number): string {
		return SHOULDER_LABELS[detectedConsole]?.[gpcValue] ?? '';
	}

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

	function isAxis(name: string): boolean {
		return name.includes('LX') || name.includes('LY') ||
			name.includes('RX') || name.includes('RY') ||
			name.includes('STICK_');
	}

	// Track all buttons ever used in the combo
	let usedButtons = $derived.by(() => {
		const used = new Set<string>();
		for (const step of steps) {
			for (const key of step.values.keys()) {
				used.add(key);
			}
		}
		return used;
	});

	// Show all used buttons, even if currently at 0
	let activeButtons = $derived(
		Array.from(usedButtons)
			.map((name) => [name, activeValues.get(name) ?? 0] as [string, number])
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

	// SVG constants for controller
	const C = {
		// Stick centers
		lsX: 130, lsY: 160,
		rsX: 230, rsY: 160,
		stickR: 26,
		dotR: 7,
		dotScale: 0.19,
		// Face button center
		fbX: 275, fbY: 105,
		fbR: 12, fbSpread: 21,
		// D-pad center
		dpX: 85, dpY: 105,
	};

	// Stick trace: collect all stick positions from step 0..currentStep
	function buildStickTrace(
		xAxis: 'lx' | 'rx',
		yAxis: 'ly' | 'ry',
		centerX: number,
		centerY: number
	): string {
		if (currentStep < 0) return '';
		const axes = CONSOLE_AXES[detectedConsole];
		const xName = axes[xAxis];
		const yName = axes[yAxis];
		const genericX = xAxis === 'lx' ? 'STICK_1_X' : 'STICK_2_X';
		const genericY = yAxis === 'ly' ? 'STICK_1_Y' : 'STICK_2_Y';

		const points: string[] = [];
		let lastX = 0, lastY = 0;

		for (let i = 0; i <= currentStep; i++) {
			const vals = steps[i].values;
			const sx = vals.get(xName) ?? vals.get(genericX) ?? 0;
			const sy = vals.get(yName) ?? vals.get(genericY) ?? 0;
			if (sx !== lastX || sy !== lastY || i === 0) {
				points.push(`${centerX + sx * C.dotScale},${centerY + sy * C.dotScale}`);
				lastX = sx;
				lastY = sy;
			}
		}

		return points.length > 1 ? points.join(' ') : '';
	}

	let leftTrace = $derived(buildStickTrace('lx', 'ly', C.lsX, C.lsY));
	let rightTrace = $derived(buildStickTrace('rx', 'ry', C.rsX, C.rsY));
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
							Console:
							<select
								bind:value={consoleOverride}
								class="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200"
							>
								<option value="auto">Auto</option>
								{#each CONSOLE_TYPES as ct}
									<option value={ct}>{CONSOLE_LABELS[ct]}</option>
								{/each}
							</select>
						</label>
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

			<!-- Simulation Content -->
			<div class="flex-1 overflow-y-auto p-4">
				{#if steps.length === 0}
					<div class="flex h-full items-center justify-center text-sm text-zinc-600">
						Paste a combo and click "Parse" to begin simulation
					</div>
				{:else}
					<!-- Controller Visualization -->
					<div class="mb-4">
						<div class="flex justify-center">
							<svg viewBox="0 0 360 220" class="w-full max-w-md" xmlns="http://www.w3.org/2000/svg">
								<!-- Controller body -->
								<rect x="10" y="28" width="340" height="172" rx="48" ry="48"
									fill="#18181b" stroke="#3f3f46" stroke-width="1.5"/>
								<!-- Left grip -->
								<rect x="10" y="120" width="65" height="90" rx="24" ry="24"
									fill="#18181b" stroke="#3f3f46" stroke-width="1.5"/>
								<!-- Right grip -->
								<rect x="285" y="120" width="65" height="90" rx="24" ry="24"
									fill="#18181b" stroke="#3f3f46" stroke-width="1.5"/>
								<!-- Cover grip/body seam -->
								<rect x="22" y="125" width="50" height="50" fill="#18181b"/>
								<rect x="288" y="125" width="50" height="50" fill="#18181b"/>

								<!-- L2 Trigger -->
								<rect x="32" y="6" width="68" height="18" rx="5"
									fill="#0a0a0a" stroke="#3f3f46" stroke-width="1"/>
								{#if btnVal(7) > 0}
									<rect x="32" y="6" width={68 * btnVal(7) / 100} height="18" rx="5"
										fill="#10b981" opacity="0.85"/>
								{/if}
								<text x="66" y="19" text-anchor="middle" font-size="9" font-weight="600"
									fill={btnOn(7) ? 'white' : '#71717a'}>{shoulderLabel(7)}</text>

								<!-- R2 Trigger -->
								<rect x="260" y="6" width="68" height="18" rx="5"
									fill="#0a0a0a" stroke="#3f3f46" stroke-width="1"/>
								{#if btnVal(4) > 0}
									<rect x={260 + 68 - 68 * btnVal(4) / 100} y="6"
										width={68 * btnVal(4) / 100} height="18" rx="5"
										fill="#10b981" opacity="0.85"/>
								{/if}
								<text x="294" y="19" text-anchor="middle" font-size="9" font-weight="600"
									fill={btnOn(4) ? 'white' : '#71717a'}>{shoulderLabel(4)}</text>

								<!-- L1 Bumper -->
								<rect x="34" y="30" width="64" height="14" rx="5"
									fill={btnOn(6) ? '#10b981' : '#27272a'} stroke="#3f3f46" stroke-width="0.8"/>
								<text x="66" y="41" text-anchor="middle" font-size="8" font-weight="600"
									fill={btnOn(6) ? 'white' : '#71717a'}>{shoulderLabel(6)}</text>

								<!-- R1 Bumper -->
								<rect x="262" y="30" width="64" height="14" rx="5"
									fill={btnOn(3) ? '#10b981' : '#27272a'} stroke="#3f3f46" stroke-width="0.8"/>
								<text x="294" y="41" text-anchor="middle" font-size="8" font-weight="600"
									fill={btnOn(3) ? 'white' : '#71717a'}>{shoulderLabel(3)}</text>

								<!-- D-Pad -->
								<!-- Vertical bar -->
								<rect x={C.dpX - 7} y={C.dpY - 22} width="14" height="44" rx="3"
									fill="#1f1f23"/>
								<!-- Horizontal bar -->
								<rect x={C.dpX - 22} y={C.dpY - 7} width="44" height="14" rx="3"
									fill="#1f1f23"/>
								<!-- Up -->
								<rect x={C.dpX - 7} y={C.dpY - 22} width="14" height="19" rx="3"
									fill={btnOn(13) ? '#10b981' : 'transparent'}
									opacity={btnOn(13) ? 0.85 : 0}/>
								{#if btnOn(13)}
									<text x={C.dpX} y={C.dpY - 9} text-anchor="middle" font-size="10"
										fill="white">↑</text>
								{/if}
								<!-- Down -->
								<rect x={C.dpX - 7} y={C.dpY + 3} width="14" height="19" rx="3"
									fill={btnOn(14) ? '#10b981' : 'transparent'}
									opacity={btnOn(14) ? 0.85 : 0}/>
								{#if btnOn(14)}
									<text x={C.dpX} y={C.dpY + 17} text-anchor="middle" font-size="10"
										fill="white">↓</text>
								{/if}
								<!-- Left -->
								<rect x={C.dpX - 22} y={C.dpY - 7} width="19" height="14" rx="3"
									fill={btnOn(15) ? '#10b981' : 'transparent'}
									opacity={btnOn(15) ? 0.85 : 0}/>
								{#if btnOn(15)}
									<text x={C.dpX - 13} y={C.dpY + 1} text-anchor="middle" font-size="10"
										fill="white">←</text>
								{/if}
								<!-- Right -->
								<rect x={C.dpX + 3} y={C.dpY - 7} width="19" height="14" rx="3"
									fill={btnOn(16) ? '#10b981' : 'transparent'}
									opacity={btnOn(16) ? 0.85 : 0}/>
								{#if btnOn(16)}
									<text x={C.dpX + 13} y={C.dpY + 1} text-anchor="middle" font-size="10"
										fill="white">→</text>
								{/if}
								<!-- D-pad center -->
								<circle cx={C.dpX} cy={C.dpY} r="3" fill="#27272a"/>

								<!-- Face Buttons -->
								<!-- Triangle/Y (top) -->
								<circle cx={C.fbX} cy={C.fbY - C.fbSpread} r={C.fbR}
									fill={btnOn(17) ? '#10b981' : '#27272a'} stroke="#3f3f46" stroke-width="0.8"/>
								<text x={C.fbX} y={C.fbY - C.fbSpread + 4} text-anchor="middle" font-size="10"
									fill={btnOn(17) ? 'white' : '#71717a'}>{faceLabel(17)}</text>
								<!-- Circle/B (right) -->
								<circle cx={C.fbX + C.fbSpread} cy={C.fbY} r={C.fbR}
									fill={btnOn(18) ? '#10b981' : '#27272a'} stroke="#3f3f46" stroke-width="0.8"/>
								<text x={C.fbX + C.fbSpread} y={C.fbY + 4} text-anchor="middle" font-size="10"
									fill={btnOn(18) ? 'white' : '#71717a'}>{faceLabel(18)}</text>
								<!-- Cross/A (bottom) -->
								<circle cx={C.fbX} cy={C.fbY + C.fbSpread} r={C.fbR}
									fill={btnOn(19) ? '#10b981' : '#27272a'} stroke="#3f3f46" stroke-width="0.8"/>
								<text x={C.fbX} y={C.fbY + C.fbSpread + 4} text-anchor="middle" font-size="10"
									fill={btnOn(19) ? 'white' : '#71717a'}>{faceLabel(19)}</text>
								<!-- Square/X (left) -->
								<circle cx={C.fbX - C.fbSpread} cy={C.fbY} r={C.fbR}
									fill={btnOn(20) ? '#10b981' : '#27272a'} stroke="#3f3f46" stroke-width="0.8"/>
								<text x={C.fbX - C.fbSpread} y={C.fbY + 4} text-anchor="middle" font-size="10"
									fill={btnOn(20) ? 'white' : '#71717a'}>{faceLabel(20)}</text>

								<!-- System Buttons -->
								<!-- Share/View -->
								<circle cx="143" cy="65" r="6"
									fill={btnOn(1) ? '#10b981' : '#27272a'} stroke="#3f3f46" stroke-width="0.5"/>
								<!-- PS/Home -->
								<circle cx="180" cy="70" r="8"
									fill={btnOn(0) ? '#10b981' : '#27272a'} stroke="#3f3f46" stroke-width="0.5"/>
								<!-- Options/Menu -->
								<circle cx="217" cy="65" r="6"
									fill={btnOn(2) ? '#10b981' : '#27272a'} stroke="#3f3f46" stroke-width="0.5"/>
								<!-- Touch/Sync -->
								<rect x="163" y="84" width="34" height="10" rx="5"
									fill={btnOn(27) ? '#10b981' : '#27272a'} stroke="#3f3f46" stroke-width="0.5"/>

								<!-- Left Stick -->
								<circle cx={C.lsX} cy={C.lsY} r={C.stickR}
									fill="#0a0a0a" stroke="#3f3f46" stroke-width="1"/>
								<!-- Crosshairs -->
								<line x1={C.lsX} y1={C.lsY - C.stickR + 4}
									x2={C.lsX} y2={C.lsY + C.stickR - 4}
									stroke="#1f1f23" stroke-width="0.5"/>
								<line x1={C.lsX - C.stickR + 4} y1={C.lsY}
									x2={C.lsX + C.stickR - 4} y2={C.lsY}
									stroke="#1f1f23" stroke-width="0.5"/>
								<!-- Stick trace path -->
								{#if leftTrace}
									<polyline points={leftTrace} fill="none"
										stroke="#10b981" stroke-width="1" opacity="0.4"
										stroke-linejoin="round" stroke-linecap="round"/>
								{/if}
								<!-- Stick position dot -->
								<circle
									cx={C.lsX + stickVal('lx') * C.dotScale}
									cy={C.lsY + stickVal('ly') * C.dotScale}
									r={C.dotR}
									fill={leftStickActive ? '#10b981' : '#3f3f46'}
									stroke={leftStickActive ? '#059669' : '#52525b'}
									stroke-width="1.5"
								/>
								<!-- L3 indicator -->
								{#if btnOn(8)}
									<circle cx={C.lsX} cy={C.lsY} r={C.stickR}
										fill="none" stroke="#10b981" stroke-width="1.5" opacity="0.5"/>
								{/if}
								<text x={C.lsX} y={C.lsY + C.stickR + 14} text-anchor="middle"
									font-size="8" fill={btnOn(8) ? '#10b981' : '#52525b'}>L3</text>

								<!-- Right Stick -->
								<circle cx={C.rsX} cy={C.rsY} r={C.stickR}
									fill="#0a0a0a" stroke="#3f3f46" stroke-width="1"/>
								<!-- Crosshairs -->
								<line x1={C.rsX} y1={C.rsY - C.stickR + 4}
									x2={C.rsX} y2={C.rsY + C.stickR - 4}
									stroke="#1f1f23" stroke-width="0.5"/>
								<line x1={C.rsX - C.stickR + 4} y1={C.rsY}
									x2={C.rsX + C.stickR - 4} y2={C.rsY}
									stroke="#1f1f23" stroke-width="0.5"/>
								<!-- Stick trace path -->
								{#if rightTrace}
									<polyline points={rightTrace} fill="none"
										stroke="#10b981" stroke-width="1" opacity="0.4"
										stroke-linejoin="round" stroke-linecap="round"/>
								{/if}
								<!-- Stick position dot -->
								<circle
									cx={C.rsX + stickVal('rx') * C.dotScale}
									cy={C.rsY + stickVal('ry') * C.dotScale}
									r={C.dotR}
									fill={rightStickActive ? '#10b981' : '#3f3f46'}
									stroke={rightStickActive ? '#059669' : '#52525b'}
									stroke-width="1.5"
								/>
								<!-- R3 indicator -->
								{#if btnOn(5)}
									<circle cx={C.rsX} cy={C.rsY} r={C.stickR}
										fill="none" stroke="#10b981" stroke-width="1.5" opacity="0.5"/>
								{/if}
								<text x={C.rsX} y={C.rsY + C.stickR + 14} text-anchor="middle"
									font-size="8" fill={btnOn(5) ? '#10b981' : '#52525b'}>R3</text>

								<!-- Stick value labels (shown when active) -->
								{#if leftStickActive}
									<text x={C.lsX} y={C.lsY - C.stickR - 5} text-anchor="middle"
										font-size="8" font-family="monospace" fill="#a1a1aa">
										{stickVal('lx')},{stickVal('ly')}
									</text>
								{/if}
								{#if rightStickActive}
									<text x={C.rsX} y={C.rsY - C.stickR - 5} text-anchor="middle"
										font-size="8" font-family="monospace" fill="#a1a1aa">
										{stickVal('rx')},{stickVal('ry')}
									</text>
								{/if}

								<!-- Trigger value labels (shown when analog) -->
								{#if btnVal(7) > 0 && btnVal(7) < 100}
									<text x="100" y="19" text-anchor="start" font-size="8"
										font-family="monospace" fill="#a1a1aa">{btnVal(7)}</text>
								{/if}
								{#if btnVal(4) > 0 && btnVal(4) < 100}
									<text x="252" y="19" text-anchor="end" font-size="8"
										font-family="monospace" fill="#a1a1aa">{btnVal(4)}</text>
								{/if}
							</svg>
						</div>
					</div>

					<!-- Active Values (compact) -->
					{#if activeButtons.length > 0 && currentStep >= 0}
						<div class="mb-4">
							<h3 class="mb-2 text-xs font-semibold text-zinc-400 uppercase">Active Outputs</h3>
							<div class="flex flex-wrap gap-1.5">
								{#each activeButtons as [name, value]}
									<div class="flex items-center gap-1.5 rounded border px-2 py-1 text-xs
										{value !== 0
											? isAxis(name)
												? 'border-blue-800 bg-blue-950/40 text-blue-300'
												: 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
											: 'border-zinc-800 bg-zinc-900 text-zinc-600'}">
										<span class="font-medium">{name}</span>
										<span class="font-mono">{value}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

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
									class="flex w-full items-center gap-3 rounded px-2 py-1 text-left text-xs {currentStep === i ? 'bg-emerald-900/40 text-emerald-300' : 'text-zinc-400 hover:bg-zinc-900'}"
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
