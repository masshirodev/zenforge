<script lang="ts">
    import type { GameConfig } from '$lib/types/config';
    import { saveGameConfig, readFile, readFileTree } from '$lib/tauri/commands';
    import { addToast } from '$lib/stores/toast.svelte';
    import { onMount } from 'svelte';
    import {
        analyzeBitLayout,
        decodeSPVAR,
        encodeSPVAR,
        bitToSlot,
        bitInSlot,
        getItemColor,
        scanGpcFile,
        mergeGpcScans,
        type BitLayout,
        type BitVariable,
        type GpcScanResult,
        type GpcSaveCall,
        type GpcSetPvarCall
    } from '$lib/utils/bitpack';

    interface Props {
        config: GameConfig;
        gamePath: string;
    }

    let { config, gamePath }: Props = $props();

    // ==================== Section State ====================
    let expandedSections = $state<Set<string>>(new Set(['layout']));

    function toggleSection(id: string) {
        const next = new Set(expandedSections);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        expandedSections = next;
    }

    // ==================== GPC Source Scan ====================
    let scanResult = $state<GpcScanResult | null>(null);
    let scanLoading = $state(false);
    let scanError = $state<string | null>(null);

    async function collectGpcPaths(basePath: string): Promise<string[]> {
        const paths: string[] = [];
        try {
            const tree = await readFileTree(basePath);
            for (const entry of tree) {
                if (!entry.is_dir && entry.name.endsWith('.gpc')) {
                    paths.push(entry.path);
                }
                if (entry.is_dir && entry.children) {
                    for (const child of entry.children) {
                        if (!child.is_dir && child.name.endsWith('.gpc')) {
                            paths.push(child.path);
                        }
                    }
                }
            }
        } catch {
            // Ignore tree read errors
        }
        return paths;
    }

    async function scanGameFiles() {
        scanLoading = true;
        scanError = null;
        scanResult = null;
        try {
            const gpcPaths = await collectGpcPaths(gamePath);
            const scans = [];
            for (const path of gpcPaths) {
                try {
                    const content = await readFile(path);
                    const fileName = path.split('/').pop() ?? path;
                    scans.push(scanGpcFile(content, fileName));
                } catch {
                    // Skip unreadable files
                }
            }
            scanResult = mergeGpcScans(scans);
        } catch (e) {
            scanError = e instanceof Error ? e.message : String(e);
        } finally {
            scanLoading = false;
        }
    }

    // Auto-scan on mount
    onMount(() => { scanGameFiles(); });

    // Diff: compare config-predicted vars with actual GPC calls
    interface ScanDiff {
        configOnly: BitVariable[];      // In config but not found in GPC
        gpcOnly: GpcSaveCall[];         // In GPC but not predicted by config
        matched: { config: BitVariable; gpc: GpcSaveCall }[];
    }

    let scanDiff = $derived.by((): ScanDiff | null => {
        if (!scanResult) return null;
        const configOnly: BitVariable[] = [];
        const matched: { config: BitVariable; gpc: GpcSaveCall }[] = [];

        // Track which GPC calls we've matched (allows profile vars to match multiple times)
        const matchedGpcIndices = new Set<number>();

        // Helper to check if varAccess patterns match (handles [Profile] vs [0]/[1])
        function varAccessMatches(configVar: string, gpcVar: string): boolean {
            if (configVar === gpcVar) return true;
            // Check if GPC has [Profile] and config has [0] or [1]
            const gpcBase = gpcVar.replace(/\[Profile\]$/, '');
            const configMatch = configVar.match(/^(.+)\[([01])\]$/);
            if (configMatch && configMatch[1] === gpcBase) return true;
            return false;
        }

        for (const v of layout.variables) {
            const gpcIdx = scanResult.saveCalls.findIndex(
                (c, i) => varAccessMatches(v.varAccess, c.varAccess)
            );
            if (gpcIdx >= 0) {
                matched.push({ config: v, gpc: scanResult.saveCalls[gpcIdx] });
                matchedGpcIndices.add(gpcIdx);
            } else {
                configOnly.push(v);
            }
        }

        // GPC calls not matched to any config variable (excluding marker)
        const gpcOnly = scanResult.saveCalls.filter(
            (c, i) => !matchedGpcIndices.has(i) && !(c.varAccess === '1' && c.min === 0 && c.max === 1)
        );

        return { configOnly, gpcOnly, matched };
    });

    // ==================== Layout Analysis ====================
    let layout = $derived(analyzeBitLayout(config));

    // Color map: menu item name → color index
    let menuItemColorMap = $derived.by(() => {
        const map = new Map<string, number>();
        let idx = 0;
        for (const v of layout.variables) {
            if (!map.has(v.menuItemName)) {
                map.set(v.menuItemName, idx++);
            }
        }
        return map;
    });

    function varColor(v: BitVariable): string {
        return getItemColor(menuItemColorMap.get(v.menuItemName) ?? 0);
    }

    // Effective totals: use scan data when available for the real picture
    let codeOnlyBits = $derived(scanDiff?.gpcOnly.reduce((sum, c) => sum + c.bitWidth, 0) ?? 0);
    let effectiveTotalBits = $derived(layout.totalBits + codeOnlyBits);
    let effectiveSlotsUsed = $derived(Math.ceil(effectiveTotalBits / 32));
    let capacityPercent = $derived(Math.round((effectiveTotalBits / (layout.maxSlots * 32)) * 100));

    // Group variables by menu item for the visual bar
    interface BarSegment {
        label: string;
        bitWidth: number;
        color: string;
        source: 'config' | 'code-only';
        variables: BitVariable[];
        codeOnlyVars: GpcSaveCall[];
    }

    let barSegments = $derived.by(() => {
        const segments: BarSegment[] = [];
        let currentVars: BitVariable[] = [];
        let currentLabel = '';
        let currentColor = '';

        function flush() {
            if (currentVars.length > 0) {
                segments.push({
                    label: currentLabel,
                    bitWidth: currentVars.reduce((s, v) => s + v.bitWidth, 0),
                    color: currentColor,
                    source: 'config',
                    variables: currentVars,
                    codeOnlyVars: []
                });
            }
        }

        for (const v of layout.variables) {
            if (currentLabel === v.menuItemName) {
                currentVars.push(v);
            } else {
                flush();
                currentLabel = v.menuItemName;
                currentColor = varColor(v);
                currentVars = [v];
            }
        }
        flush();

        // Add code-only segment at the end
        if (scanDiff && scanDiff.gpcOnly.length > 0) {
            segments.push({
                label: 'Code Only',
                bitWidth: codeOnlyBits,
                color: '#f59e0b', // amber
                source: 'code-only',
                variables: [],
                codeOnlyVars: scanDiff.gpcOnly
            });
        }
        return segments;
    });

    // ==================== Edit Ranges ====================
    let editableConfig = $state<GameConfig | null>(null);
    let editLayout = $derived(editableConfig ? analyzeBitLayout(editableConfig) : null);
    let editDirty = $state(false);
    let saving = $state(false);

    function startEditing() {
        editableConfig = JSON.parse(JSON.stringify(config));
        editDirty = false;
    }

    function cancelEditing() {
        editableConfig = null;
        editDirty = false;
    }

    async function saveEdits() {
        if (!editableConfig) return;
        saving = true;
        try {
            await saveGameConfig(gamePath, editableConfig);
            addToast('Config saved', 'success');
            editableConfig = null;
            editDirty = false;
        } catch (e) {
            addToast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
        } finally {
            saving = false;
        }
    }

    function updateOptionRange(
        menuIdx: number,
        optIdx: number | null,
        field: 'min' | 'max',
        value: number
    ) {
        if (!editableConfig) return;
        if (optIdx !== null) {
            const opt = editableConfig.menu[menuIdx]?.options?.[optIdx];
            if (opt) {
                opt[field] = value;
                editDirty = true;
            }
        } else {
            const item = editableConfig.menu[menuIdx];
            if (item) {
                item[field] = value;
                editDirty = true;
            }
        }
        // Force reactivity
        editableConfig = { ...editableConfig };
    }

    // Map each variable back to its menu/option index for editing
    interface EditableVar {
        variable: BitVariable;
        menuIdx: number;
        optIdx: number | null;
        editMin: number;
        editMax: number;
        editBitWidth: number;
    }

    let editableVars = $derived.by((): EditableVar[] => {
        const cfg = editableConfig ?? config;
        const currentLayout = editLayout ?? layout;
        const result: EditableVar[] = [];
        const seen = new Set<string>();

        for (const v of currentLayout.variables) {
            // Skip duplicates from profile-aware vars (show once)
            const key = `${v.menuItemName}:${v.varName}`;
            if (seen.has(key)) continue;
            seen.add(key);

            // Find the menu item and option indices
            const menuIdx = cfg.menu.findIndex((m) => m.name === v.menuItemName);
            if (menuIdx === -1) continue;
            const item = cfg.menu[menuIdx];
            let optIdx: number | null = null;

            if (item.type === 'clickable' && item.options) {
                const oi = item.options.findIndex(
                    (o) => (o.var ?? o.name) === v.varName
                );
                if (oi >= 0) optIdx = oi;
            }

            result.push({
                variable: v,
                menuIdx,
                optIdx,
                editMin: v.min,
                editMax: v.max,
                editBitWidth: v.bitWidth
            });
        }
        return result;
    });

    // ==================== SPVAR Debugger ====================
    let debugHexInput = $state('');
    let debugDecoded = $state<{ dataExists: boolean; values: Map<string, number> } | null>(null);
    let debugError = $state<string | null>(null);

    // Encode mode
    let encodeValues = $state<Map<string, number>>(new Map());
    let encodeResult = $state<number[] | null>(null);

    function handleDecode() {
        debugError = null;
        debugDecoded = null;
        try {
            const hexStrings = debugHexInput
                .trim()
                .split(/[\s,]+/)
                .filter((s) => s.length > 0);
            if (hexStrings.length === 0) {
                debugError = 'Enter hex values (e.g. 0x1A3F, 0x0000, ...)';
                return;
            }
            const slotValues = hexStrings.map((s) => {
                const n = parseInt(s, 16);
                if (isNaN(n)) throw new Error(`Invalid hex: ${s}`);
                return n >>> 0; // Ensure unsigned 32-bit
            });
            debugDecoded = decodeSPVAR(layout, slotValues);
        } catch (e) {
            debugError = e instanceof Error ? e.message : String(e);
        }
    }

    function initEncodeValues() {
        const map = new Map<string, number>();
        for (const v of layout.variables) {
            map.set(v.varAccess, v.default);
        }
        encodeValues = map;
        encodeResult = null;
    }

    function handleEncode() {
        encodeResult = encodeSPVAR(layout, encodeValues);
    }

    function updateEncodeValue(varAccess: string, val: number) {
        const next = new Map(encodeValues);
        next.set(varAccess, val);
        encodeValues = next;
    }

    function formatHex(val: number): string {
        return '0x' + (val >>> 0).toString(16).toUpperCase().padStart(8, '0');
    }

    // Tooltip state
    let hoveredSeg = $state<BarSegment | null>(null);
    let tooltipPos = $state({ x: 0, y: 0 });
</script>

<div class="space-y-4">
    <!-- ==================== Section A: Bit Layout ==================== -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900">
        <button
            class="flex w-full items-center justify-between px-4 py-3"
            onclick={() => toggleSection('layout')}
        >
            <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Bit Layout
            </h2>
            <span class="text-xs text-zinc-500">{expandedSections.has('layout') ? '▼' : '▶'}</span>
        </button>

        {#if expandedSections.has('layout')}
            <div class="border-t border-zinc-800 p-4">
                <!-- Capacity Bar -->
                <div class="group/cap relative mb-4">
                    <div class="mb-1 flex items-center justify-between text-xs">
                        <span class="text-zinc-400">
                            {effectiveTotalBits} <span class="text-zinc-600">/ {layout.maxSlots * 32}</span> bits ({effectiveSlotsUsed} <span class="text-zinc-600">/ {layout.maxSlots}</span> slots)
                        </span>
                        <span
                            class:text-emerald-400={capacityPercent < 60}
                            class:text-amber-400={capacityPercent >= 60 && capacityPercent < 80}
                            class:text-red-400={capacityPercent >= 80}
                        >
                            {capacityPercent}% capacity
                        </span>
                    </div>
                    <div class="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div
                            class="h-full rounded-full transition-all"
                            class:bg-emerald-500={capacityPercent < 60}
                            class:bg-amber-500={capacityPercent >= 60 && capacityPercent < 80}
                            class:bg-red-500={capacityPercent >= 80}
                            style="width: {Math.min(capacityPercent, 100)}%"
                        ></div>
                    </div>
                    <!-- Hover breakdown -->
                    <div class="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs shadow-lg group-hover/cap:block">
                        <div class="text-zinc-300">{layout.totalBits} bits from config</div>
                        {#if codeOnlyBits > 0}
                            <div class="text-amber-400">+ {codeOnlyBits} bits from code only</div>
                            <div class="mt-1 border-t border-zinc-700 pt-1 text-zinc-200">{effectiveTotalBits} total bits</div>
                        {/if}
                    </div>
                </div>

                <!-- Visual Bit Bar -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="relative mb-4">
                    <div class="flex h-8 w-full overflow-hidden rounded border border-zinc-700 bg-zinc-800">
                        <!-- Marker bit -->
                        <div
                            class="h-full shrink-0 border-r border-zinc-600 bg-zinc-500"
                            style="width: {(1 / effectiveTotalBits) * 100}%"
                            title="Data-exists marker (1 bit)"
                        ></div>
                        <!-- Variable segments -->
                        {#each barSegments as seg}
                            <div
                                class="h-full shrink-0 cursor-pointer border-r border-zinc-900/50 transition-opacity hover:opacity-80"
                                class:opacity-60={seg.source === 'code-only'}
                                style="width: {(seg.bitWidth / effectiveTotalBits) * 100}%; background-color: {seg.color};"
                                onmouseenter={(e) => {
                                    hoveredSeg = seg;
                                    tooltipPos = { x: e.clientX, y: e.clientY };
                                }}
                                onmousemove={(e) => {
                                    tooltipPos = { x: e.clientX, y: e.clientY };
                                }}
                                onmouseleave={() => { hoveredSeg = null; }}
                            ></div>
                        {/each}
                    </div>
                    <!-- SPVAR slot markers -->
                    <div class="relative mt-0.5 h-3 w-full">
                        {#each { length: Math.min(effectiveSlotsUsed, layout.maxSlots) } as _, i}
                            {@const bitPos = (i + 1) * 32}
                            {@const pct = (bitPos / effectiveTotalBits) * 100}
                            {#if bitPos < effectiveTotalBits && pct < 100}
                                <div
                                    class="absolute top-0 h-full border-l border-zinc-600"
                                    style="left: {pct}%"
                                >
                                    <span class="ml-0.5 text-[9px] text-zinc-600">S{i + 2}</span>
                                </div>
                            {/if}
                        {/each}
                    </div>
                </div>

                <!-- Tooltip -->
                {#if hoveredSeg}
                    <div
                        class="pointer-events-none fixed z-50 max-w-md rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs shadow-lg"
                        style="left: {tooltipPos.x + 12}px; top: {tooltipPos.y - 10}px"
                    >
                        <div class="font-medium text-zinc-200">{hoveredSeg.label}</div>
                        <div class="mb-1 text-zinc-400">
                            {hoveredSeg.bitWidth} bits &middot;
                            {hoveredSeg.source === 'code-only' ? 'manual (code only)' : 'config'}
                        </div>
                        {#if hoveredSeg.source === 'config' && hoveredSeg.variables.length > 0}
                            <div class="mt-1 space-y-0.5 border-t border-zinc-700 pt-1">
                                {#each hoveredSeg.variables as v}
                                    <div class="flex justify-between gap-4 text-[10px]">
                                        <span class="font-mono text-zinc-300">{v.varAccess}</span>
                                        <span class="text-zinc-500">
                                            {v.bitWidth}b @ {bitToSlot(v.bitOffset) + 1}:{bitInSlot(v.bitOffset)}
                                            [{v.min}..{v.max}]
                                        </span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                        {#if hoveredSeg.source === 'code-only' && hoveredSeg.codeOnlyVars.length > 0}
                            <div class="mt-1 space-y-0.5 border-t border-zinc-700 pt-1">
                                {#each hoveredSeg.codeOnlyVars as c}
                                    <div class="flex justify-between gap-4 text-[10px]">
                                        <span class="font-mono text-amber-300">{c.varAccess}</span>
                                        <span class="text-zinc-500">
                                            {c.bitWidth}b [{c.min}..{c.max}] &middot; {c.file}:{c.line}
                                        </span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/if}

                <!-- Variable Table -->
                <div class="overflow-x-auto rounded border border-zinc-800">
                    <table class="w-full text-xs">
                        <thead>
                            <tr class="border-b border-zinc-800 bg-zinc-900/80 text-zinc-500">
                                <th class="px-3 py-2 text-left font-medium"></th>
                                <th class="px-3 py-2 text-left font-medium">Variable</th>
                                <th class="px-3 py-2 text-left font-medium">Menu Item</th>
                                <th class="px-3 py-2 text-right font-medium">Bits</th>
                                <th class="px-3 py-2 text-right font-medium">Offset</th>
                                <th class="px-3 py-2 text-right font-medium">SPVAR</th>
                                <th class="px-3 py-2 text-right font-medium">Range</th>
                                <th class="px-3 py-2 text-right font-medium">Default</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each layout.variables as v, i}
                                <tr class="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                    <td class="px-3 py-1.5">
                                        <span
                                            class="inline-block h-3 w-3 rounded-sm"
                                            style="background-color: {varColor(v)}"
                                        ></span>
                                    </td>
                                    <td class="px-3 py-1.5 font-mono text-zinc-200">
                                        {v.varAccess}
                                    </td>
                                    <td class="px-3 py-1.5 text-zinc-400">{v.menuItemName}</td>
                                    <td class="px-3 py-1.5 text-right text-zinc-300">{v.bitWidth}</td>
                                    <td class="px-3 py-1.5 text-right text-zinc-400">{v.bitOffset}</td>
                                    <td class="px-3 py-1.5 text-right text-zinc-400">
                                        {bitToSlot(v.bitOffset) + 1}:{bitInSlot(v.bitOffset)}
                                    </td>
                                    <td class="px-3 py-1.5 text-right text-zinc-400">
                                        [{v.min}, {v.max}]
                                    </td>
                                    <td class="px-3 py-1.5 text-right text-zinc-300">{v.default}</td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            </div>
        {/if}
    </div>

    <!-- ==================== Section B: Source Code Scan ==================== -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900">
        <button
            class="flex w-full items-center justify-between px-4 py-3"
            onclick={() => toggleSection('scan')}
        >
            <div class="flex items-center gap-2">
                <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                    Source Code Scan
                </h2>
                {#if scanResult && scanDiff}
                    {#if scanDiff.gpcOnly.length > 0 || scanDiff.configOnly.length > 0}
                        <span class="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] text-amber-400">
                            {scanDiff.gpcOnly.length + scanDiff.configOnly.length} diff(s)
                        </span>
                    {:else}
                        <span class="rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-400">
                            matched
                        </span>
                    {/if}
                {/if}
            </div>
            <span class="text-xs text-zinc-500">{expandedSections.has('scan') ? '▼' : '▶'}</span>
        </button>

        {#if expandedSections.has('scan')}
            <div class="border-t border-zinc-800 p-4">
                {#if scanLoading}
                    <div class="flex items-center gap-2 text-xs text-zinc-500">
                        <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Scanning .gpc files...
                    </div>
                {:else if scanError}
                    <div class="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-400">
                        {scanError}
                    </div>
                {:else if scanResult}
                    <div class="mb-3 flex items-center gap-4 text-xs">
                        <span class="text-zinc-400">
                            {scanResult.saveCalls.length} save_spvar() calls
                        </span>
                        <span class="text-zinc-400">
                            {scanResult.totalBitpackBits} total bits
                        </span>
                        {#if scanResult.setPvarCalls.length > 0}
                            <span class="text-amber-400">
                                {scanResult.setPvarCalls.length} set_pvar() calls
                            </span>
                        {/if}
                        <button
                            class="ml-auto rounded bg-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-600"
                            onclick={scanGameFiles}
                        >
                            Rescan
                        </button>
                    </div>

                    {#if scanDiff}
                        <!-- Matched variables -->
                        {#if scanDiff.matched.length > 0}
                            <div class="mb-3">
                                <h3 class="mb-1.5 text-[10px] font-medium uppercase text-zinc-500">
                                    Matched ({scanDiff.matched.length})
                                </h3>
                                <div class="overflow-x-auto rounded border border-zinc-800">
                                    <table class="w-full text-xs">
                                        <thead>
                                            <tr class="border-b border-zinc-800 bg-zinc-900/80 text-zinc-500">
                                                <th class="px-3 py-1.5 text-left font-medium">Variable</th>
                                                <th class="px-3 py-1.5 text-right font-medium">Range</th>
                                                <th class="px-3 py-1.5 text-right font-medium">Bits</th>
                                                <th class="px-3 py-1.5 text-left font-medium">File</th>
                                                <th class="px-3 py-1.5 text-right font-medium">Line</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each scanDiff.matched as m}
                                                <tr class="border-b border-zinc-800/30">
                                                    <td class="px-3 py-1 font-mono text-zinc-200">{m.gpc.varAccess}</td>
                                                    <td class="px-3 py-1 text-right text-zinc-400">[{m.gpc.min}, {m.gpc.max}]</td>
                                                    <td class="px-3 py-1 text-right text-zinc-300">{m.gpc.bitWidth}</td>
                                                    <td class="px-3 py-1 text-zinc-500">{m.gpc.file}</td>
                                                    <td class="px-3 py-1 text-right text-zinc-500">{m.gpc.line}</td>
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        {/if}

                        <!-- GPC-only (manual additions not in config) -->
                        {#if scanDiff.gpcOnly.length > 0}
                            <div class="mb-3">
                                <h3 class="mb-1.5 text-[10px] font-medium uppercase text-amber-400">
                                    In Code Only ({scanDiff.gpcOnly.length})
                                </h3>
                                <div class="overflow-x-auto rounded border border-amber-800/50">
                                    <table class="w-full text-xs">
                                        <thead>
                                            <tr class="border-b border-amber-800/30 bg-amber-900/10 text-zinc-500">
                                                <th class="px-3 py-1.5 text-left font-medium">Variable</th>
                                                <th class="px-3 py-1.5 text-right font-medium">Range</th>
                                                <th class="px-3 py-1.5 text-right font-medium">Bits</th>
                                                <th class="px-3 py-1.5 text-left font-medium">File</th>
                                                <th class="px-3 py-1.5 text-right font-medium">Line</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each scanDiff.gpcOnly as c}
                                                <tr class="border-b border-amber-800/20">
                                                    <td class="px-3 py-1 font-mono text-amber-300">{c.varAccess}</td>
                                                    <td class="px-3 py-1 text-right text-zinc-400">[{c.min}, {c.max}]</td>
                                                    <td class="px-3 py-1 text-right text-zinc-300">{c.bitWidth}</td>
                                                    <td class="px-3 py-1 text-zinc-500">{c.file}</td>
                                                    <td class="px-3 py-1 text-right text-zinc-500">{c.line}</td>
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        {/if}

                        <!-- Config-only (in config but not found in code) -->
                        {#if scanDiff.configOnly.length > 0}
                            <div class="mb-3">
                                <h3 class="mb-1.5 text-[10px] font-medium uppercase text-red-400">
                                    Missing from Code ({scanDiff.configOnly.length})
                                </h3>
                                <div class="overflow-x-auto rounded border border-red-800/50">
                                    <table class="w-full text-xs">
                                        <thead>
                                            <tr class="border-b border-red-800/30 bg-red-900/10 text-zinc-500">
                                                <th class="px-3 py-1.5 text-left font-medium">Variable</th>
                                                <th class="px-3 py-1.5 text-left font-medium">Menu Item</th>
                                                <th class="px-3 py-1.5 text-right font-medium">Range</th>
                                                <th class="px-3 py-1.5 text-right font-medium">Bits</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each scanDiff.configOnly as v}
                                                <tr class="border-b border-red-800/20">
                                                    <td class="px-3 py-1 font-mono text-red-300">{v.varAccess}</td>
                                                    <td class="px-3 py-1 text-zinc-400">{v.menuItemName}</td>
                                                    <td class="px-3 py-1 text-right text-zinc-400">[{v.min}, {v.max}]</td>
                                                    <td class="px-3 py-1 text-right text-zinc-300">{v.bitWidth}</td>
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        {/if}
                    {/if}

                    <!-- Manual set_pvar calls -->
                    {#if scanResult.setPvarCalls.length > 0}
                        <div>
                            <h3 class="mb-1.5 text-[10px] font-medium uppercase text-blue-400">
                                Manual set_pvar() ({scanResult.setPvarCalls.length})
                            </h3>
                            <div class="overflow-x-auto rounded border border-blue-800/50">
                                <table class="w-full text-xs">
                                    <thead>
                                        <tr class="border-b border-blue-800/30 bg-blue-900/10 text-zinc-500">
                                            <th class="px-3 py-1.5 text-left font-medium">SPVAR Slot</th>
                                            <th class="px-3 py-1.5 text-left font-medium">Value</th>
                                            <th class="px-3 py-1.5 text-left font-medium">File</th>
                                            <th class="px-3 py-1.5 text-right font-medium">Line</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each scanResult.setPvarCalls as c}
                                            <tr class="border-b border-blue-800/20">
                                                <td class="px-3 py-1 font-mono text-blue-300">{c.slotName}</td>
                                                <td class="px-3 py-1 font-mono text-zinc-300">{c.value}</td>
                                                <td class="px-3 py-1 text-zinc-500">{c.file}</td>
                                                <td class="px-3 py-1 text-right text-zinc-500">{c.line}</td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    {/if}
                {/if}
            </div>
        {/if}
    </div>

    <!-- ==================== Section C: Edit Ranges ==================== -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900">
        <button
            class="flex w-full items-center justify-between px-4 py-3"
            onclick={() => toggleSection('edit')}
        >
            <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Edit Ranges
            </h2>
            <span class="text-xs text-zinc-500">{expandedSections.has('edit') ? '▼' : '▶'}</span>
        </button>

        {#if expandedSections.has('edit')}
            <div class="border-t border-zinc-800 p-4">
                {#if !editableConfig}
                    <button
                        class="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
                        onclick={startEditing}
                    >
                        Edit Min/Max Ranges
                    </button>
                {:else}
                    <!-- Edit capacity indicator -->
                    {#if editLayout}
                        {@const editPercent = Math.round((editLayout.totalBits / (editLayout.maxSlots * 32)) * 100)}
                        <div class="mb-3 flex items-center gap-3 text-xs">
                            <span class="text-zinc-400">
                                {editLayout.totalBits} bits
                                ({editLayout.slotsUsed} slots)
                            </span>
                            {#if editLayout.totalBits !== layout.totalBits}
                                <span
                                    class:text-emerald-400={editLayout.totalBits < layout.totalBits}
                                    class:text-red-400={editLayout.totalBits > layout.totalBits}
                                >
                                    {editLayout.totalBits > layout.totalBits ? '+' : ''}{editLayout.totalBits - layout.totalBits} bits
                                </span>
                            {/if}
                            {#if editPercent >= 80}
                                <span class="text-red-400">Warning: {editPercent}% capacity</span>
                            {/if}
                        </div>
                    {/if}

                    <div class="mb-3 overflow-x-auto rounded border border-zinc-800">
                        <table class="w-full text-xs">
                            <thead>
                                <tr class="border-b border-zinc-800 bg-zinc-900/80 text-zinc-500">
                                    <th class="px-3 py-2 text-left font-medium">Variable</th>
                                    <th class="px-3 py-2 text-left font-medium">Type</th>
                                    <th class="w-24 px-3 py-2 text-right font-medium">Min</th>
                                    <th class="w-24 px-3 py-2 text-right font-medium">Max</th>
                                    <th class="px-3 py-2 text-right font-medium">Bits</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each editableVars as ev}
                                    {@const isToggle = ev.variable.min === 0 && ev.variable.max === 1}
                                    <tr class="border-b border-zinc-800/50">
                                        <td class="px-3 py-1.5 font-mono text-zinc-200">
                                            {ev.variable.varName}
                                        </td>
                                        <td class="px-3 py-1.5 text-zinc-400">
                                            {isToggle ? 'toggle' : 'value'}
                                        </td>
                                        <td class="px-1 py-1">
                                            {#if isToggle}
                                                <span class="px-2 text-zinc-500">0</span>
                                            {:else}
                                                <input
                                                    type="number"
                                                    value={ev.editMin}
                                                    class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-xs text-zinc-200 focus:border-emerald-600 focus:outline-none"
                                                    onchange={(e) => updateOptionRange(ev.menuIdx, ev.optIdx, 'min', parseInt((e.target as HTMLInputElement).value) || 0)}
                                                />
                                            {/if}
                                        </td>
                                        <td class="px-1 py-1">
                                            {#if isToggle}
                                                <span class="px-2 text-zinc-500">1</span>
                                            {:else}
                                                <input
                                                    type="number"
                                                    value={ev.editMax}
                                                    class="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-xs text-zinc-200 focus:border-emerald-600 focus:outline-none"
                                                    onchange={(e) => updateOptionRange(ev.menuIdx, ev.optIdx, 'max', parseInt((e.target as HTMLInputElement).value) || 0)}
                                                />
                                            {/if}
                                        </td>
                                        <td class="px-3 py-1.5 text-right text-zinc-300">
                                            {ev.editBitWidth}
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>

                    <div class="flex gap-2">
                        <button
                            class="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                            onclick={saveEdits}
                            disabled={saving || !editDirty}
                        >
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                            class="rounded bg-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-600"
                            onclick={cancelEditing}
                        >
                            Cancel
                        </button>
                    </div>
                {/if}
            </div>
        {/if}
    </div>

    <!-- ==================== Section C: SPVAR Debugger ==================== -->
    <div class="rounded-lg border border-zinc-800 bg-zinc-900">
        <button
            class="flex w-full items-center justify-between px-4 py-3"
            onclick={() => toggleSection('debugger')}
        >
            <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                SPVAR Debugger
            </h2>
            <span class="text-xs text-zinc-500">{expandedSections.has('debugger') ? '▼' : '▶'}</span>
        </button>

        {#if expandedSections.has('debugger')}
            <div class="border-t border-zinc-800 p-4">
                <!-- Decode Tab -->
                <div class="mb-4">
                    <h3 class="mb-2 text-xs font-medium text-zinc-400">Decode SPVAR → Values</h3>
                    <div class="flex gap-2">
                        <input
                            type="text"
                            bind:value={debugHexInput}
                            placeholder="0x1A3F0000, 0x00000000, ..."
                            class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 font-mono text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-600 focus:outline-none"
                        />
                        <button
                            class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                            onclick={handleDecode}
                        >
                            Decode
                        </button>
                    </div>
                    <div class="mt-1 text-[10px] text-zinc-600">
                        Comma-separated hex values, one per SPVAR slot (starting from slot 1)
                    </div>

                    {#if debugError}
                        <div class="mt-2 rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-400">
                            {debugError}
                        </div>
                    {/if}

                    {#if debugDecoded}
                        <div class="mt-2 rounded border border-zinc-800 bg-zinc-950 p-3">
                            <div class="mb-2 flex items-center gap-2 text-xs">
                                <span class="font-medium text-zinc-400">Data Marker:</span>
                                {#if debugDecoded.dataExists}
                                    <span class="rounded bg-emerald-900/50 px-1.5 py-0.5 text-emerald-400">Present</span>
                                {:else}
                                    <span class="rounded bg-red-900/50 px-1.5 py-0.5 text-red-400">Missing (defaults used)</span>
                                {/if}
                            </div>
                            <table class="w-full text-xs">
                                <thead>
                                    <tr class="border-b border-zinc-800 text-zinc-500">
                                        <th class="px-2 py-1 text-left font-medium">Variable</th>
                                        <th class="px-2 py-1 text-right font-medium">Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each [...debugDecoded.values.entries()] as [name, val]}
                                        <tr class="border-b border-zinc-800/30">
                                            <td class="px-2 py-1 font-mono text-zinc-300">{name}</td>
                                            <td class="px-2 py-1 text-right text-zinc-200">{val}</td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        </div>
                    {/if}
                </div>

                <!-- Encode Tab -->
                <div>
                    <div class="mb-2 flex items-center gap-2">
                        <h3 class="text-xs font-medium text-zinc-400">Encode Values → SPVAR</h3>
                        <button
                            class="rounded bg-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-600"
                            onclick={initEncodeValues}
                        >
                            Load Defaults
                        </button>
                    </div>

                    {#if encodeValues.size > 0}
                        <div class="mb-3 grid grid-cols-2 gap-x-4 gap-y-1">
                            {#each layout.variables as v}
                                <div class="flex items-center gap-2 text-xs">
                                    <label class="w-36 truncate font-mono text-zinc-400" title={v.varAccess}>
                                        {v.varAccess}
                                    </label>
                                    <input
                                        type="number"
                                        min={v.min}
                                        max={v.max}
                                        value={encodeValues.get(v.varAccess) ?? v.default}
                                        class="w-20 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-right text-xs text-zinc-200 focus:border-emerald-600 focus:outline-none"
                                        onchange={(e) => updateEncodeValue(v.varAccess, parseInt((e.target as HTMLInputElement).value) || 0)}
                                    />
                                </div>
                            {/each}
                        </div>

                        <button
                            class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                            onclick={handleEncode}
                        >
                            Encode
                        </button>

                        {#if encodeResult}
                            <div class="mt-2 rounded border border-zinc-800 bg-zinc-950 p-3">
                                <div class="mb-1 text-[10px] text-zinc-500">
                                    {encodeResult.length} slot(s)
                                </div>
                                <code class="block select-all font-mono text-xs text-emerald-400">
                                    {encodeResult.map(formatHex).join(', ')}
                                </code>
                            </div>
                        {/if}
                    {:else}
                        <div class="text-xs text-zinc-500">
                            Click "Load Defaults" to populate variable values for encoding.
                        </div>
                    {/if}
                </div>
            </div>
        {/if}
    </div>
</div>
