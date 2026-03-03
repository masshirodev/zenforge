<script lang="ts">
    import SprayCanvas from './SprayCanvas.svelte';
    import ConfigPanel from './ConfigPanel.svelte';
    import PhasePanel from './PhasePanel.svelte';
    import OutputPanel from './OutputPanel.svelte';
    import ToolHeader from '$lib/components/layout/ToolHeader.svelte';

    import { addToast } from '$lib/stores/toast.svelte';
    import { goto } from '$app/navigation';
    import {
        getRecoilTransfer,
        setRecoilTransfer,
        clearRecoilTransfer
    } from '$lib/stores/recoil-transfer.svelte';
    import { onMount } from 'svelte';

    // --- Constants ---
    const PHASE_ENDS_CYCLES = [8, 16, 28, 42, 60, 80, 105, 135, 175, 999];
    const PHASE_BOUNDARIES_MS = [80, 160, 280, 420, 600, 800, 1050, 1350, 1750, Infinity];
    const PHASE_LABELS = [
        '~80ms', '~160ms', '~280ms', '~420ms', '~600ms',
        '~800ms', '~1.05s', '~1.35s', '~1.75s', '1.75s+'
    ];
    const PHASE_COLORS = [
        '#e94560', '#ff6b6b', '#ffa07a', '#ffb347',
        '#ffd700', '#95d5b2', '#48cae4', '#7b68ee',
        '#c084fc', '#f472b6'
    ];

    // --- State ---
    let assignMode = $state<'manual' | 'auto'>('auto');
    let drawPhase = $state<'draw' | 'phase'>('draw');
    let points = $state<{ x: number; y: number }[]>([]);
    let manualPhasePoints = $state<(number | null)[]>(new Array(10).fill(null));
    let hoveredPoint = $state(-1);

    // Config
    let bulletCount = $state(30);
    let fireRate = $state(600);
    let scale = $state(3);

    // --- Transfer from recoil table editor ---
    let transferWeaponName = $state<string | null>(null);
    let transferReturnTo = $state<string | null>(null);
    let transferWeaponIndex = $state<number | null>(null);
    let transferValues = $state<number[] | null>(null);

    onMount(() => {
        const transfer = getRecoilTransfer();
        if (transfer) {
            transferWeaponName = transfer.weaponName;
            transferReturnTo = transfer.returnTo;
            transferWeaponIndex = transfer.weaponIndex;
            transferValues = [...transfer.values];
            clearRecoilTransfer();
        }
    });

    function handleReturnToEditor() {
        if (transferReturnTo === null || transferWeaponIndex === null) return;
        // Build values from current phaseValues output
        const newValues: number[] = [];
        for (const pv of phaseValues) {
            newValues.push(pv.v, pv.h);
        }
        setRecoilTransfer({
            weaponName: transferWeaponName ?? '',
            weaponIndex: transferWeaponIndex,
            values: newValues,
            returnTo: transferReturnTo
        });
        goto('/');
    }

    // --- Auto-assignment ---
    function autoAssignPhases(count: number, rpm: number): number[] {
        const msPerBullet = 60000 / rpm;
        const assignments: number[] = [];
        for (let i = 0; i < count; i++) {
            const bulletTime = i * msPerBullet;
            let phaseIdx = PHASE_BOUNDARIES_MS.findIndex(b => bulletTime < b);
            if (phaseIdx === -1) phaseIdx = 9;
            assignments.push(phaseIdx);
        }
        return assignments;
    }

    let autoAssignments = $derived(
        assignMode === 'auto' ? autoAssignPhases(points.length, fireRate) : []
    );

    // --- Phase value computation ---
    interface PhaseValue {
        v: number;
        h: number;
        assigned: boolean;
    }

    function computeManualPhaseValue(
        phaseIdx: number,
        pts: { x: number; y: number }[],
        phaseAssignments: (number | null)[],
        canvasCenter: { x: number; y: number },
        scaleVal: number
    ): PhaseValue {
        if (phaseAssignments[phaseIdx] === null) return { v: 0, h: 0, assigned: false };

        const startPt = pts[phaseAssignments[phaseIdx]!];
        if (!startPt) return { v: 0, h: 0, assigned: false };

        let endPt = startPt;
        for (let j = phaseIdx + 1; j < 10; j++) {
            if (phaseAssignments[j] !== null && pts[phaseAssignments[j]!]) {
                endPt = pts[phaseAssignments[j]!];
                break;
            }
        }

        let dx: number, dy: number;
        if (phaseIdx === 0) {
            dx = endPt.x - canvasCenter.x;
            dy = endPt.y - canvasCenter.y;
            if (endPt === startPt) {
                dx = startPt.x - canvasCenter.x;
                dy = startPt.y - canvasCenter.y;
            }
        } else {
            if (endPt === startPt) return { v: 0, h: 0, assigned: true };
            dx = endPt.x - startPt.x;
            dy = endPt.y - startPt.y;
        }

        const phaseStart = phaseIdx === 0 ? 0 : PHASE_ENDS_CYCLES[phaseIdx - 1];
        const phaseEnd = PHASE_ENDS_CYCLES[phaseIdx];
        const phaseCycles = Math.min(phaseEnd, 200) - phaseStart;

        const rawV = -dy / scaleVal;
        const rawH = dx / scaleVal;
        const v = Math.round((rawV / phaseCycles) * (phaseEnd - phaseStart));
        const h = Math.round((rawH / phaseCycles) * (phaseEnd - phaseStart));

        return {
            v: Math.max(-100, Math.min(100, v)),
            h: Math.max(-100, Math.min(100, h)),
            assigned: true
        };
    }

    function computeAutoPhaseValue(
        phaseIdx: number,
        pts: { x: number; y: number }[],
        assignments: number[],
        canvasCenter: { x: number; y: number },
        scaleVal: number
    ): PhaseValue {
        const indices = assignments
            .map((p, i) => (p === phaseIdx ? i : -1))
            .filter((i) => i >= 0);

        if (indices.length === 0) return { v: 0, h: 0, assigned: false };

        const firstIdx = indices[0];
        const lastIdx = indices[indices.length - 1];

        if (!pts[firstIdx] || !pts[lastIdx]) return { v: 0, h: 0, assigned: false };

        let dx: number, dy: number;
        if (phaseIdx === 0) {
            // Displacement from center to last point in phase 0
            const endPt = pts[lastIdx];
            dx = endPt.x - canvasCenter.x;
            dy = endPt.y - canvasCenter.y;
        } else {
            // Find the last point of previous phase (or center if no previous points)
            let prevPt = canvasCenter;
            for (let p = phaseIdx - 1; p >= 0; p--) {
                const prevIndices = assignments
                    .map((a, i) => (a === p ? i : -1))
                    .filter((i) => i >= 0);
                if (prevIndices.length > 0 && pts[prevIndices[prevIndices.length - 1]]) {
                    prevPt = pts[prevIndices[prevIndices.length - 1]];
                    break;
                }
            }
            dx = pts[lastIdx].x - prevPt.x;
            dy = pts[lastIdx].y - prevPt.y;
        }

        const phaseStart = phaseIdx === 0 ? 0 : PHASE_ENDS_CYCLES[phaseIdx - 1];
        const phaseEnd = PHASE_ENDS_CYCLES[phaseIdx];
        const phaseCycles = Math.min(phaseEnd, 200) - phaseStart;

        const rawV = -dy / scaleVal;
        const rawH = dx / scaleVal;
        const v = Math.round((rawV / phaseCycles) * (phaseEnd - phaseStart));
        const h = Math.round((rawH / phaseCycles) * (phaseEnd - phaseStart));

        return {
            v: Math.max(-100, Math.min(100, v)),
            h: Math.max(-100, Math.min(100, h)),
            assigned: indices.length > 0
        };
    }

    // We need canvas center for computation — use a default that SprayCanvas will update
    let canvasCenter = $state({ x: 300, y: 300 });

    let phaseValues = $derived.by(() => {
        const values: PhaseValue[] = [];
        for (let i = 0; i < 10; i++) {
            if (assignMode === 'manual') {
                values.push(
                    computeManualPhaseValue(i, points, manualPhasePoints, canvasCenter, scale)
                );
            } else {
                values.push(
                    computeAutoPhaseValue(i, points, autoAssignments, canvasCenter, scale)
                );
            }
        }
        return values;
    });

    let outputString = $derived.by(() => {
        const nums: number[] = [];
        for (const pv of phaseValues) {
            nums.push(pv.v, pv.h);
        }
        const parts = nums.map((v) => {
            const s = String(v);
            return s.length < 3 ? s.padStart(3, ' ') : s;
        });
        return `{${parts.join(',')}}`;
    });

    // --- Canvas interaction handlers ---
    function handleAddPoint(x: number, y: number) {
        if (assignMode === 'auto' && points.length >= bulletCount) return;
        points = [...points, { x, y }];
    }

    function handleAssignPhase(pointIdx: number) {
        if (assignMode !== 'manual') return;
        const nextPhase = manualPhasePoints.findIndex((p) => p === null);
        if (nextPhase === -1) return;

        const updated = [...manualPhasePoints];
        // Remove if already assigned
        for (let i = 0; i < 10; i++) {
            if (updated[i] === pointIdx) updated[i] = null;
        }
        updated[nextPhase] = pointIdx;
        manualPhasePoints = updated;
    }

    function handleClearPhase(phaseIdx: number) {
        const updated = [...manualPhasePoints];
        updated[phaseIdx] = null;
        manualPhasePoints = updated;
    }

    function handleUndo() {
        if (points.length === 0) return;
        const removedIdx = points.length - 1;
        points = points.slice(0, -1);
        if (assignMode === 'manual') {
            manualPhasePoints = manualPhasePoints.map((p) => (p === removedIdx ? null : p));
        }
    }

    function handleClear() {
        points = [];
        manualPhasePoints = new Array(10).fill(null);
        hoveredPoint = -1;
    }

    function handleCopy() {
        navigator.clipboard.writeText(outputString).then(() => {
            addToast('Copied to clipboard', 'success', 2000);
        });
    }

    // --- Keyboard shortcuts ---
    function handleKeydown(e: KeyboardEvent) {
        if ((e.target as HTMLElement)?.tagName === 'INPUT') return;

        if (e.code === 'Space' && assignMode === 'manual') {
            e.preventDefault();
            drawPhase = drawPhase === 'draw' ? 'phase' : 'draw';
        } else if (e.code === 'KeyZ') {
            handleUndo();
        } else if (e.code === 'KeyC') {
            handleClear();
        }
    }

    // Effective phase assignments for canvas rendering
    let effectivePhasePoints = $derived.by(() => {
        if (assignMode === 'manual') return manualPhasePoints;
        // Auto: build a (number | null)[] where each phase gets its first point index
        const result: (number | null)[] = new Array(10).fill(null);
        for (let i = 0; i < autoAssignments.length; i++) {
            const phase = autoAssignments[i];
            if (result[phase] === null) {
                result[phase] = i;
            }
        }
        return result;
    });

    // For auto mode: point-to-phase color map
    let pointPhaseMap = $derived.by(() => {
        if (assignMode !== 'auto') return new Map<number, number>();
        const map = new Map<number, number>();
        for (let i = 0; i < autoAssignments.length; i++) {
            map.set(i, autoAssignments[i]);
        }
        return map;
    });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-full flex-col bg-zinc-950">
    <!-- Header -->
    <ToolHeader title="Spray Pattern Tool" subtitle="Design and test anti-recoil spray patterns">
        {#if transferWeaponName}
            <span class="rounded bg-blue-900/50 px-2 py-1 text-xs text-blue-300">
                {transferWeaponName}
            </span>
            {#if transferReturnTo}
                <button
                    class="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
                    onclick={handleReturnToEditor}
                >
                    Return to {transferWeaponName}
                </button>
            {/if}
        {/if}
        <div class="ml-auto flex items-center gap-3 text-xs text-zinc-500">
            {#if assignMode === 'manual'}
                <span class="rounded px-2 py-0.5 {drawPhase === 'draw' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-amber-900/50 text-amber-400'}">
                    {drawPhase === 'draw' ? 'DRAW' : 'PHASE'}
                </span>
            {/if}
            <span>{points.length}{assignMode === 'auto' ? `/${bulletCount}` : ''} points</span>
            <span class="text-zinc-600">|</span>
            <span>
                <kbd class="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">Z</kbd> undo
                <kbd class="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">C</kbd> clear
                {#if assignMode === 'manual'}
                    <kbd class="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">Space</kbd> toggle mode
                {/if}
            </span>
        </div>
    </ToolHeader>

    <!-- Body -->
    <div class="flex flex-1 overflow-hidden">
        <!-- Left panel -->
        <div class="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-zinc-800 p-4">
            <ConfigPanel
                bind:assignMode
                bind:bulletCount
                bind:fireRate
                bind:scale
                onClear={handleClear}
            />

            <PhasePanel
                {phaseValues}
                phaseLabels={PHASE_LABELS}
                phaseColors={PHASE_COLORS}
                mode={assignMode}
                onClearPhase={handleClearPhase}
            />

            <OutputPanel
                output={outputString}
                onCopy={handleCopy}
            />


            {#if transferValues}
                <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                    <div class="mb-1 text-xs text-zinc-500">Original ({transferWeaponName})</div>
                    <code class="block select-all font-mono text-[10px] leading-relaxed text-zinc-500">
                        {`{${transferValues.map((v) => String(v).padStart(3, ' ')).join(',')}}`}
                    </code>
                </div>
            {/if}
        </div>

        <!-- Canvas -->
        <div class="flex-1">
            <SprayCanvas
                {points}
                phasePoints={effectivePhasePoints}
                {pointPhaseMap}
                phaseColors={PHASE_COLORS}
                mode={assignMode}
                drawPhase={assignMode === 'manual' ? drawPhase : 'draw'}
                {scale}
                bind:hoveredPoint
                bind:canvasCenter
                onAddPoint={handleAddPoint}
                onAssignPhase={handleAssignPhase}
            />
        </div>
    </div>
</div>
