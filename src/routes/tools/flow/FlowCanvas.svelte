<script lang="ts">
	import type { FlowGraph, FlowNode as FlowNodeType } from '$lib/types/flow';
	import FlowNode from './FlowNode.svelte';
	import FlowEdge from './FlowEdge.svelte';
	import { getNodeHeight, getPortPosition, NODE_WIDTH } from '$lib/flow/layout';

	interface Props {
		graph: FlowGraph;
		selectedNodeIds: string[];
		selectedEdgeId: string | null;
		selectedSubNodeId: string | null;
		connecting: { sourceNodeId: string; sourcePort: string; sourceSubNodeId?: string | null; mouseX: number; mouseY: number } | null;
		expandedNodes: Set<string>;
		panX: number;
		panY: number;
		zoom: number;
		onSelectNode: (nodeId: string | null) => void;
		onSelectNodeMulti: (nodeId: string) => void;
		onSelectNodesBatch: (nodeIds: string[]) => void;
		onSelectEdge: (edgeId: string | null) => void;
		onSelectSubNode: (nodeId: string, subNodeId: string) => void;
		onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
		onMoveNodes: (deltas: { nodeId: string; position: { x: number; y: number } }[]) => void;
		onMoveNodeDone: (nodeId?: string) => void;
		onStartConnect: (nodeId: string, port: string, e: MouseEvent, subNodeId?: string) => void;
		onFinishConnect: (targetNodeId: string | null) => void;
		onUpdateConnect: (mx: number, my: number) => void;
		onToggleExpand: (nodeId: string) => void;
		onPan: (x: number, y: number) => void;
		onZoom: (zoom: number) => void;
	}

	let {
		graph,
		selectedNodeIds,
		selectedEdgeId,
		selectedSubNodeId,
		connecting,
		expandedNodes,
		panX,
		panY,
		zoom,
		onSelectNode,
		onSelectNodeMulti,
		onSelectNodesBatch,
		onSelectEdge,
		onSelectSubNode,
		onMoveNode,
		onMoveNodes,
		onMoveNodeDone,
		onStartConnect,
		onFinishConnect,
		onUpdateConnect,
		onToggleExpand,
		onPan,
		onZoom,
	}: Props = $props();

	let selectedNodeIdSet = $derived(new Set(selectedNodeIds));

	// Build a set of module node IDs that have active conflicts
	let conflictNodeIds = $derived.by(() => {
		const ids = new Set<string>();
		const moduleNodes = graph.nodes.filter((n) => n.type === 'module' && n.moduleData);
		const moduleIdMap = new Map(moduleNodes.map((n) => [n.moduleData!.moduleId, n]));
		for (const node of moduleNodes) {
			const conflicts = node.moduleData!.conflicts ?? [];
			for (const conflictId of conflicts) {
				if (moduleIdMap.has(conflictId)) {
					ids.add(node.id);
					ids.add(moduleIdMap.get(conflictId)!.id);
				}
			}
		}
		return ids;
	});

	// Build a set of module node IDs that share a moduleId with another node
	let duplicateNodeIds = $derived.by(() => {
		const ids = new Set<string>();
		const moduleNodes = graph.nodes.filter((n) => n.type === 'module' && n.moduleData);
		const byModuleId = new Map<string, string[]>();
		for (const node of moduleNodes) {
			const mid = node.moduleData!.moduleId;
			if (!byModuleId.has(mid)) byModuleId.set(mid, []);
			byModuleId.get(mid)!.push(node.id);
		}
		for (const nodeIds of byModuleId.values()) {
			if (nodeIds.length > 1) {
				for (const id of nodeIds) ids.add(id);
			}
		}
		return ids;
	});

	// Compute edge spread indices: for each edge, its index among siblings at the same source/target
	let edgeSpread = $derived.by(() => {
		const sourceGroups = new Map<string, string[]>(); // sourceKey -> edgeIds
		const targetGroups = new Map<string, string[]>(); // targetNodeId -> edgeIds
		for (const edge of graph.edges) {
			// Source grouping: node-level edges (no sub-node) from same source
			const srcKey = edge.sourceSubNodeId
				? `${edge.sourceNodeId}:${edge.sourceSubNodeId}`
				: edge.sourceNodeId;
			if (!sourceGroups.has(srcKey)) sourceGroups.set(srcKey, []);
			sourceGroups.get(srcKey)!.push(edge.id);
			// Target grouping: all edges to same target
			if (!targetGroups.has(edge.targetNodeId)) targetGroups.set(edge.targetNodeId, []);
			targetGroups.get(edge.targetNodeId)!.push(edge.id);
		}
		const result = new Map<string, { srcIdx: number; srcCount: number; tgtIdx: number; tgtCount: number }>();
		for (const edge of graph.edges) {
			const srcKey = edge.sourceSubNodeId
				? `${edge.sourceNodeId}:${edge.sourceSubNodeId}`
				: edge.sourceNodeId;
			const srcGroup = sourceGroups.get(srcKey)!;
			const tgtGroup = targetGroups.get(edge.targetNodeId)!;
			result.set(edge.id, {
				srcIdx: srcGroup.indexOf(edge.id),
				srcCount: srcGroup.length,
				tgtIdx: tgtGroup.indexOf(edge.id),
				tgtCount: tgtGroup.length,
			});
		}
		return result;
	});

	let svgEl: SVGSVGElement | undefined = $state();
	let containerEl: HTMLDivElement | undefined = $state();
	let containerWidth = $state(800);
	let containerHeight = $state(600);

	// Dragging state (single or multi)
	let dragging = $state<{
		nodeId: string;
		offsets: Map<string, { dx: number; dy: number }>;
	} | null>(null);
	let panning = $state<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);

	// Rubber-band (marquee) selection
	let rubberBand = $state<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
	let rubberBandCtrl = $state(false);
	const RUBBER_BAND_THRESHOLD = 5; // pixels before rubber-band activates

	// ResizeObserver for container size
	$effect(() => {
		if (!containerEl) return;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				containerWidth = entry.contentRect.width;
				containerHeight = entry.contentRect.height;
			}
		});
		observer.observe(containerEl);
		return () => observer.disconnect();
	});

	// Convert screen coordinates to SVG coordinates
	function screenToSvg(clientX: number, clientY: number): { x: number; y: number } {
		if (!svgEl) return { x: 0, y: 0 };
		const rect = svgEl.getBoundingClientRect();
		return {
			x: (clientX - rect.left) / zoom - panX,
			y: (clientY - rect.top) / zoom - panY,
		};
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const delta = e.deltaY > 0 ? 0.9 : 1.1;
		onZoom(zoom * delta);
	}

	function handleMouseDown(e: MouseEvent) {
		if (e.button === 1 || (e.button === 0 && e.altKey)) {
			// Middle click or Alt+Left click for panning
			e.preventDefault();
			panning = { startX: e.clientX, startY: e.clientY, startPanX: panX, startPanY: panY };
		} else if (e.button === 0) {
			// Left click on background — start rubber-band selection
			const pos = screenToSvg(e.clientX, e.clientY);
			rubberBand = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y };
			rubberBandCtrl = e.ctrlKey || e.metaKey;
		}
	}

	function handleMouseMove(e: MouseEvent) {
		if (panning) {
			const dx = (e.clientX - panning.startX) / zoom;
			const dy = (e.clientY - panning.startY) / zoom;
			onPan(panning.startPanX + dx, panning.startPanY + dy);
		} else if (dragging) {
			const pos = screenToSvg(e.clientX, e.clientY);
			if (dragging.offsets.size > 1) {
				// Multi-node drag
				const deltas: { nodeId: string; position: { x: number; y: number } }[] = [];
				for (const [nid, offset] of dragging.offsets) {
					deltas.push({ nodeId: nid, position: { x: pos.x - offset.dx, y: pos.y - offset.dy } });
				}
				onMoveNodes(deltas);
			} else {
				// Single node drag
				const offset = dragging.offsets.get(dragging.nodeId)!;
				onMoveNode(dragging.nodeId, {
					x: pos.x - offset.dx,
					y: pos.y - offset.dy,
				});
			}
		} else if (rubberBand) {
			const pos = screenToSvg(e.clientX, e.clientY);
			rubberBand = { ...rubberBand, endX: pos.x, endY: pos.y };
		} else if (connecting) {
			const pos = screenToSvg(e.clientX, e.clientY);
			onUpdateConnect(pos.x, pos.y);
		}
	}

	function handleMouseUp(e: MouseEvent) {
		if (panning) {
			panning = null;
		}
		if (dragging) {
			onMoveNodeDone(dragging.nodeId);
			dragging = null;
		}
		if (rubberBand) {
			const dx = Math.abs(rubberBand.endX - rubberBand.startX);
			const dy = Math.abs(rubberBand.endY - rubberBand.startY);
			if (dx < RUBBER_BAND_THRESHOLD && dy < RUBBER_BAND_THRESHOLD) {
				// Tiny drag = just a click on background → clear selection
				onSelectNode(null);
				onSelectEdge(null);
			} else {
				// Rubber-band → select intersecting nodes
				const minX = Math.min(rubberBand.startX, rubberBand.endX);
				const maxX = Math.max(rubberBand.startX, rubberBand.endX);
				const minY = Math.min(rubberBand.startY, rubberBand.endY);
				const maxY = Math.max(rubberBand.startY, rubberBand.endY);
				const hitIds = graph.nodes
					.filter((n) => {
						const nh = getNodeHeight(n, expandedNodes.has(n.id));
						const nx2 = n.position.x + NODE_WIDTH;
						const ny2 = n.position.y + nh;
						return n.position.x < maxX && nx2 > minX && n.position.y < maxY && ny2 > minY;
					})
					.map((n) => n.id);
				if (rubberBandCtrl) {
					// Ctrl+rubber-band: add to existing selection
					const merged = new Set(selectedNodeIds);
					for (const id of hitIds) merged.add(id);
					onSelectNodesBatch([...merged]);
				} else {
					onSelectNodesBatch(hitIds);
				}
			}
			rubberBand = null;
		}
		if (connecting) {
			onFinishConnect(null);
		}
	}

	function handleNodeSelect(nodeId: string) {
		onSelectNode(nodeId);
	}

	function handleNodeMouseDown(nodeId: string, e: MouseEvent) {
		const node = graph.nodes.find((n) => n.id === nodeId);
		if (!node) return;

		if (e.ctrlKey || e.metaKey) {
			// Ctrl+Click: toggle multi-selection
			onSelectNodeMulti(nodeId);
			return;
		}

		const pos = screenToSvg(e.clientX, e.clientY);
		const isAlreadySelected = selectedNodeIdSet.has(nodeId);

		if (isAlreadySelected && selectedNodeIds.length > 1) {
			// Dragging one of multiple selected nodes — move all
			const offsets = new Map<string, { dx: number; dy: number }>();
			for (const nid of selectedNodeIds) {
				const n = graph.nodes.find((nd) => nd.id === nid);
				if (n) {
					offsets.set(nid, { dx: pos.x - n.position.x, dy: pos.y - n.position.y });
				}
			}
			dragging = { nodeId, offsets };
		} else {
			// Single node drag
			onSelectNode(nodeId);
			const offsets = new Map<string, { dx: number; dy: number }>();
			offsets.set(nodeId, { dx: pos.x - node.position.x, dy: pos.y - node.position.y });
			dragging = { nodeId, offsets };
		}
	}

	function handleStartConnect(nodeId: string, port: string, e: MouseEvent, subNodeId?: string) {
		onStartConnect(nodeId, port, e, subNodeId);
	}

	function handlePortDrop(nodeId: string) {
		if (connecting) {
			onFinishConnect(nodeId);
		}
	}

	// Connecting line from source to mouse
	let connectLineSource = $derived.by(() => {
		if (!connecting) return null;
		const sourceNode = graph.nodes.find((n) => n.id === connecting.sourceNodeId);
		if (!sourceNode) return null;
		const isExpanded = expandedNodes.has(sourceNode.id);
		return getPortPosition(sourceNode, 'output', connecting.sourceSubNodeId, isExpanded);
	});

	// Rubber-band rect in SVG coordinates
	let rbRect = $derived.by(() => {
		if (!rubberBand) return null;
		const dx = Math.abs(rubberBand.endX - rubberBand.startX);
		const dy = Math.abs(rubberBand.endY - rubberBand.startY);
		if (dx < RUBBER_BAND_THRESHOLD && dy < RUBBER_BAND_THRESHOLD) return null;
		return {
			x: Math.min(rubberBand.startX, rubberBand.endX),
			y: Math.min(rubberBand.startY, rubberBand.endY),
			width: dx,
			height: dy,
		};
	});

	// Primary selected node (last in array, used for sub-node panel)
	let primaryNodeId = $derived(selectedNodeIds[selectedNodeIds.length - 1] ?? null);

	// viewBox
	let vb = $derived(
		`${-panX} ${-panY} ${containerWidth / zoom} ${containerHeight / zoom}`
	);
</script>

<div
	bind:this={containerEl}
	class="relative flex-1 overflow-hidden bg-zinc-950"
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg
		bind:this={svgEl}
		width="100%"
		height="100%"
		viewBox={vb}
		onwheel={handleWheel}
		onmousedown={handleMouseDown}
		onmousemove={handleMouseMove}
		onmouseup={handleMouseUp}
		class="select-none"
		style="cursor: {panning ? 'grabbing' : dragging ? 'grabbing' : rubberBand ? 'crosshair' : 'default'}"
	>
		<defs>
			<!-- Grid pattern -->
			<pattern id="flow-grid" width="40" height="40" patternUnits="userSpaceOnUse">
				<circle cx="0.5" cy="0.5" r="0.5" fill="#27272a" />
			</pattern>
			<!-- Arrow marker -->
			<marker
				id="flow-arrow"
				viewBox="0 0 10 10"
				refX="10"
				refY="5"
				markerWidth="8"
				markerHeight="8"
				orient="auto-start-reverse"
			>
				<path d="M 0 0 L 10 5 L 0 10 z" fill="#52525b" />
			</marker>
		</defs>

		<!-- Background grid -->
		<rect
			x={-panX - 1000}
			y={-panY - 1000}
			width={containerWidth / zoom + 2000}
			height={containerHeight / zoom + 2000}
			fill="url(#flow-grid)"
		/>

		<!-- Edges (render below nodes) -->
		{#each graph.edges as edge (edge.id)}
			{@const sourceNode = graph.nodes.find((n) => n.id === edge.sourceNodeId)}
			{@const targetNode = graph.nodes.find((n) => n.id === edge.targetNodeId)}
			{@const spread = edgeSpread.get(edge.id)}
			{#if sourceNode && targetNode}
				<FlowEdge
					{edge}
					{sourceNode}
					{targetNode}
					selected={selectedEdgeId === edge.id}
					sourceExpanded={expandedNodes.has(sourceNode.id)}
					targetExpanded={expandedNodes.has(targetNode.id)}
					sourceEdgeIndex={spread?.srcIdx ?? 0}
					sourceEdgeCount={spread?.srcCount ?? 1}
					targetEdgeIndex={spread?.tgtIdx ?? 0}
					targetEdgeCount={spread?.tgtCount ?? 1}
					onSelect={(id) => onSelectEdge(id)}
				/>
			{/if}
		{/each}

		<!-- Connecting line (while dragging to create edge) -->
		{#if connecting && connectLineSource}
			<path
				d="M {connectLineSource.x} {connectLineSource.y} C {connectLineSource.x + 60} {connectLineSource.y}, {connecting.mouseX - 60} {connecting.mouseY}, {connecting.mouseX} {connecting.mouseY}"
				fill="none"
				stroke="#f59e0b"
				stroke-width="2"
				stroke-dasharray="6,3"
				opacity="0.7"
			/>
		{/if}

		<!-- Nodes -->
		{#each graph.nodes as node (node.id)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<g
				onmousedown={(e) => {
					if (e.button === 0 && !e.altKey) {
						e.stopPropagation();
						handleNodeMouseDown(node.id, e);
					}
				}}
			>
				<FlowNode
					{node}
					selected={selectedNodeIdSet.has(node.id)}
					expanded={expandedNodes.has(node.id)}
					selectedSubNodeId={primaryNodeId === node.id ? selectedSubNodeId : null}
					hasConflict={conflictNodeIds.has(node.id)}
					isDuplicate={duplicateNodeIds.has(node.id)}
					onSelect={handleNodeSelect}
					onSelectSubNode={onSelectSubNode}
					onStartConnect={handleStartConnect}
					onPortDrop={handlePortDrop}
					onToggleExpand={onToggleExpand}
				/>
			</g>
		{/each}

		<!-- Rubber-band selection rectangle -->
		{#if rbRect}
			<rect
				x={rbRect.x}
				y={rbRect.y}
				width={rbRect.width}
				height={rbRect.height}
				fill="rgba(59, 130, 246, 0.1)"
				stroke="#3b82f6"
				stroke-width={1.5 / zoom}
				stroke-dasharray="{4 / zoom},{2 / zoom}"
			/>
		{/if}
	</svg>

	<!-- Zoom indicator -->
	<div class="absolute bottom-3 right-3 rounded bg-zinc-800/80 px-2 py-1 text-xs text-zinc-400">
		{Math.round(zoom * 100)}%
	</div>
</div>
