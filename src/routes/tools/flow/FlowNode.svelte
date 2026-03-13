<script lang="ts">
	import type { FlowNode } from '$lib/types/flow';
	import { NODE_COLORS, NODE_LABELS } from '$lib/types/flow';
	import {
		NODE_WIDTH,
		HEADER_HEIGHT,
		SUBNODE_ROW_HEIGHT,
		FOOTER_HEIGHT,
		PORT_RADIUS,
		getNodeHeight,
		getVisibleSubNodeCount,
		getSortedSubNodes,
	} from '$lib/flow/layout';

	interface Props {
		node: FlowNode;
		selected: boolean;
		expanded: boolean;
		selectedSubNodeId: string | null;
		hasConflict?: boolean;
		isDuplicate?: boolean;
		onSelect: (nodeId: string) => void;
		onSelectSubNode: (nodeId: string, subNodeId: string) => void;
		onStartConnect: (nodeId: string, port: string, e: MouseEvent, subNodeId?: string) => void;
		onPortDrop: (nodeId: string) => void;
		onToggleExpand: (nodeId: string) => void;
	}

	let {
		node,
		selected,
		expanded,
		selectedSubNodeId,
		hasConflict = false,
		isDuplicate = false,
		onSelect,
		onSelectSubNode,
		onStartConnect,
		onPortDrop,
		onToggleExpand,
	}: Props = $props();

	let isModule = $derived(node.type === 'module');
	let height = $derived(isModule ? HEADER_HEIGHT + 62 + FOOTER_HEIGHT : getNodeHeight(node, expanded));
	let color = $derived(
		node.moduleData?.flowTarget === 'data' ? '#10b981' : (NODE_COLORS[node.type] || '#6b7280')
	);
	let hasCode = $derived(node.gpcCode.trim().length > 0);
	let hasCombo = $derived(node.comboCode.trim().length > 0 || (node.moduleData?.comboCode?.trim().length ?? 0) > 0);
	let sortedSubNodes = $derived(getSortedSubNodes(node));
	let visibleCount = $derived(getVisibleSubNodeCount(node, expanded));
	let hiddenCount = $derived(node.subNodes.length - visibleCount);
	let hasSubNodes = $derived(node.subNodes.length > 0);
	let optionCount = $derived(node.moduleData?.options.length ?? 0);

	// Module code section indicators
	let hasInitCode = $derived((node.moduleData?.initCode ?? '').trim().length > 0);
	let hasMainCode = $derived((node.moduleData?.mainCode || node.moduleData?.triggerCode || '').trim().length > 0);
	let hasFunctionsCode = $derived((node.moduleData?.functionsCode ?? '').trim().length > 0);
	let hasModuleComboCode = $derived((node.moduleData?.comboCode ?? '').trim().length > 0);

	// Sub-node type abbreviations for the row icon
	const TYPE_ABBREVS: Record<string, string> = {
		header: 'H',
		'menu-item': 'M',
		'toggle-item': 'T',
		'value-item': 'V',
		'scroll-bar': 'S',
		'text-line': 'T',
		bar: 'B',
		indicator: 'I',
		'pixel-art': 'P',
		animation: 'A',
		separator: '—',
		custom: '*',
	};
</script>

<g
	class="flow-node cursor-grab"
	transform="translate({node.position.x},{node.position.y})"
>
	<!-- Drop shadow -->
	<rect
		x="2"
		y="2"
		width={NODE_WIDTH}
		{height}
		rx="6"
		fill="rgba(0,0,0,0.3)"
	/>

	<!-- Node body -->
	<rect
		width={NODE_WIDTH}
		{height}
		rx="6"
		fill="#18181b"
		stroke={selected ? '#f59e0b' : hasConflict ? '#f97316' : isDuplicate ? '#facc15' : color}
		stroke-width={selected ? 2.5 : hasConflict ? 2 : isDuplicate ? 2 : 1.5}
		stroke-dasharray={isDuplicate && !selected && !hasConflict ? '6 3' : 'none'}
	/>

	<!-- Header bar -->
	<rect
		width={NODE_WIDTH}
		height={HEADER_HEIGHT}
		rx="6"
		fill={color}
	/>
	<!-- Cover bottom corners of header -->
	<rect
		y={HEADER_HEIGHT - 6}
		width={NODE_WIDTH}
		height="6"
		fill={color}
	/>

	<!-- Initial state indicator -->
	{#if node.isInitialState}
		<circle cx="12" cy={HEADER_HEIGHT / 2} r="4" fill="#fff" opacity="0.8" />
	{/if}

	<!-- Node label -->
	<text
		x={node.isInitialState ? 22 : 10}
		y={HEADER_HEIGHT / 2 + 1}
		fill="#fff"
		font-size="11"
		font-weight="600"
		dominant-baseline="middle"
		style="pointer-events: none; user-select: none;"
	>
		{node.label}
	</text>

	<!-- Type badge -->
	<text
		x={NODE_WIDTH - 10}
		y={HEADER_HEIGHT / 2 + 1}
		fill="rgba(255,255,255,0.6)"
		font-size="9"
		text-anchor="end"
		dominant-baseline="middle"
		style="pointer-events: none; user-select: none;"
	>
		{NODE_LABELS[node.type]}
	</text>

	<!-- Duplicate module badge -->
	{#if isDuplicate}
		<rect x={NODE_WIDTH - 28} y="2" width="24" height="12" rx="3" fill="#854d0e" />
		<text
			x={NODE_WIDTH - 16}
			y="9"
			fill="#facc15"
			font-size="8"
			font-weight="700"
			text-anchor="middle"
			style="pointer-events: none; user-select: none;"
		>DUP</text>
	{/if}

	{#if isModule}
		<!-- Module node body -->
		<g transform="translate(0, {HEADER_HEIGHT})">
			<!-- Code section badges row -->
			<g transform="translate(8, 6)">
				{#each [
					{ key: 'I', active: hasInitCode, color: '#60a5fa' },
					{ key: 'M', active: hasMainCode, color: '#34d399' },
					{ key: 'F', active: hasFunctionsCode, color: '#a78bfa' },
					{ key: 'C', active: hasModuleComboCode, color: '#f472b6' },
				] as badge, idx}
					<g transform="translate({idx * 20}, 0)">
						<rect width="16" height="14" rx="2" fill={badge.active ? '#27272a' : '#1a1a1e'} stroke={badge.active ? '#3f3f46' : '#27272a'} stroke-width="0.5" />
						<text x="8" y="10" text-anchor="middle" fill={badge.active ? badge.color : '#3f3f46'} font-size="8" font-weight="600" style="pointer-events: none; user-select: none;">
							{badge.key}
						</text>
					</g>
				{/each}

				<!-- Conflict warning badge -->
				{#if hasConflict}
					<g transform="translate(84, 0)">
						<rect width="14" height="14" rx="2" fill="#451a03" stroke="#92400e" stroke-width="0.5" />
						<text x="7" y="10" text-anchor="middle" fill="#f97316" font-size="9" font-weight="700" style="pointer-events: none; user-select: none;">!</text>
					</g>
				{/if}
			</g>

			<!-- Options count + info row -->
			<g transform="translate(8, 32)">
				{#if optionCount > 0}
					<text fill="#71717a" font-size="8" style="pointer-events: none; user-select: none;">
						{optionCount} option{optionCount !== 1 ? 's' : ''}
					</text>
				{/if}
				{#if node.moduleData?.enableVariable}
					<text
						x={optionCount > 0 ? 60 : 0}
						fill="#52525b"
						font-size="7"
						style="pointer-events: none; user-select: none;"
					>
						{node.moduleData.enableVariable}
					</text>
				{/if}
			</g>
		</g>
	{:else if hasSubNodes}
		<!-- Sub-node rows -->
		{#each sortedSubNodes.slice(0, visibleCount) as subNode, i (subNode.id)}
			{@const rowY = HEADER_HEIGHT + i * SUBNODE_ROW_HEIGHT}
			{@const isSubSelected = selectedSubNodeId === subNode.id}
			{@const prevGroup = i > 0 ? sortedSubNodes[i - 1]?.group : undefined}
			{@const isNewGroup = !!subNode.group && subNode.group !== prevGroup}
			<!-- Row background (clickable) -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<rect
				x="1"
				y={rowY}
				width={NODE_WIDTH - 2}
				height={SUBNODE_ROW_HEIGHT}
				fill={isSubSelected ? 'rgba(245,158,11,0.15)' : 'transparent'}
				class="cursor-pointer"
				onmousedown={(e) => {
					e.stopPropagation();
					onSelectSubNode(node.id, subNode.id);
				}}
			/>

			<!-- Separator line between rows / group label -->
			{#if i > 0}
				{#if isNewGroup}
					<line
						x1="4"
						y1={rowY}
						x2={NODE_WIDTH - 4}
						y2={rowY}
						stroke="#3f3f46"
						stroke-width="1"
					/>
					<text
						x={NODE_WIDTH / 2}
						y={rowY}
						text-anchor="middle"
						fill="#71717a"
						font-size="7"
						dominant-baseline="middle"
						style="pointer-events: none; user-select: none;"
					>
						{subNode.group}
					</text>
				{:else}
					<line
						x1="8"
						y1={rowY}
						x2={NODE_WIDTH - 8}
						y2={rowY}
						stroke="#27272a"
						stroke-width="0.5"
					/>
				{/if}
			{/if}

			<!-- Group indicator bar -->
			{#if subNode.group}
				<rect
					x="2"
					y={rowY + 2}
					width="2"
					height={SUBNODE_ROW_HEIGHT - 4}
					rx="1"
					fill="#3f3f46"
					style="pointer-events: none;"
				/>
			{/if}

			<!-- Type abbreviation badge -->
			<rect
				x="8"
				y={rowY + 4}
				width="16"
				height="16"
				rx="3"
				fill={subNode.hidden ? '#1a1a1e' : subNode.interactive ? '#3b2f6b' : '#1f2937'}
				style="pointer-events: none;"
			/>
			<text
				x="16"
				y={rowY + SUBNODE_ROW_HEIGHT / 2 + 1}
				text-anchor="middle"
				fill={subNode.hidden ? '#3f3f46' : subNode.interactive ? '#a78bfa' : '#6b7280'}
				font-size="8"
				font-weight="600"
				dominant-baseline="middle"
				style="pointer-events: none; user-select: none;"
			>
				{TYPE_ABBREVS[subNode.type] || '?'}
			</text>

			<!-- Sub-node label -->
			<text
				x="30"
				y={rowY + SUBNODE_ROW_HEIGHT / 2 + 1}
				fill={subNode.hidden ? '#3f3f46' : isSubSelected ? '#fbbf24' : '#d4d4d8'}
				font-size="10"
				dominant-baseline="middle"
				style="pointer-events: none; user-select: none;"
				text-decoration={subNode.hidden ? 'line-through' : 'none'}
			>
				{subNode.label.length > 22 ? subNode.label.slice(0, 20) + '...' : subNode.label}
			</text>

			<!-- Hidden indicator -->
			{#if subNode.hidden}
				<text
					x={NODE_WIDTH - 14}
					y={rowY + SUBNODE_ROW_HEIGHT / 2 + 1}
					text-anchor="end"
					fill="#52525b"
					font-size="7"
					dominant-baseline="middle"
					style="pointer-events: none; user-select: none;"
				>HID</text>
			{/if}

			<!-- Output port for sub-node (right side) -->
			<circle
				cx={NODE_WIDTH}
				cy={rowY + SUBNODE_ROW_HEIGHT / 2}
				r={PORT_RADIUS - 1}
				fill={isSubSelected ? '#292524' : '#27272a'}
				stroke={isSubSelected ? '#f59e0b' : color}
				stroke-width="1.5"
				class="cursor-crosshair"
				onmousedown={(e) => {
					e.stopPropagation();
					e.preventDefault();
					onStartConnect(node.id, 'right', e, subNode.id);
				}}
			/>
		{/each}

		<!-- "+N more" indicator when collapsed -->
		{#if hiddenCount > 0}
			{@const moreY = HEADER_HEIGHT + visibleCount * SUBNODE_ROW_HEIGHT}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<g
				class="cursor-pointer"
				onmousedown={(e) => {
					e.stopPropagation();
					onToggleExpand(node.id);
				}}
			>
				<rect
					x="1"
					y={moreY}
					width={NODE_WIDTH - 2}
					height={SUBNODE_ROW_HEIGHT}
					fill="transparent"
				/>
				<text
					x={NODE_WIDTH / 2}
					y={moreY + SUBNODE_ROW_HEIGHT / 2}
					text-anchor="middle"
					dominant-baseline="middle"
					fill="#71717a"
					font-size="9"
					class="cursor-pointer"
					style="pointer-events: none; user-select: none;"
				>
					+{hiddenCount} more...
				</text>
			</g>
		{/if}
	{:else}
		<!-- Empty node body: content indicators -->
		<g transform="translate(10, {HEADER_HEIGHT + 12})">
			{#if hasCode}
				<g>
					<rect width="14" height="14" rx="2" fill="#27272a" stroke="#3f3f46" stroke-width="0.5" />
					<text x="7" y="11" text-anchor="middle" fill="#a78bfa" font-size="8" style="pointer-events: none; user-select: none;">C</text>
				</g>
			{/if}
			{#if hasCombo}
				<g transform="translate({hasCode ? 18 : 0}, 0)">
					<rect width="14" height="14" rx="2" fill="#27272a" stroke="#3f3f46" stroke-width="0.5" />
					<text x="7" y="11" text-anchor="middle" fill="#f472b6" font-size="8" style="pointer-events: none; user-select: none;">X</text>
				</g>
			{/if}
		</g>
	{/if}

	<!-- Footer separator -->
	<line
		x1="0"
		y1={height - FOOTER_HEIGHT}
		x2={NODE_WIDTH}
		y2={height - FOOTER_HEIGHT}
		stroke="#27272a"
		stroke-width="0.5"
	/>

	<!-- Footer content: variables count + badges -->
	{#if node.variables.length > 0}
		<text
			x={NODE_WIDTH - 10}
			y={height - FOOTER_HEIGHT / 2 + 1}
			fill="#71717a"
			font-size="9"
			text-anchor="end"
			dominant-baseline="middle"
			style="pointer-events: none; user-select: none;"
		>
			{node.variables.length} var{node.variables.length !== 1 ? 's' : ''}
		</text>
	{/if}

	<!-- Expand/collapse button in footer (when node has sub-nodes) -->
	{#if hasSubNodes && node.subNodes.length > 8}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<g
			class="cursor-pointer"
			transform="translate(8, {height - FOOTER_HEIGHT / 2 - 6})"
			onmousedown={(e) => {
				e.stopPropagation();
				onToggleExpand(node.id);
			}}
		>
			<rect width="12" height="12" rx="2" fill="#27272a" stroke="#3f3f46" stroke-width="0.5" />
			<text x="6" y="9" text-anchor="middle" fill="#71717a" font-size="9" style="pointer-events: none; user-select: none;">
				{expanded ? '▲' : '▼'}
			</text>
		</g>
	{/if}

	<!-- Input port (left, beside title) -->
	<circle
		cx={0}
		cy={HEADER_HEIGHT / 2}
		r={PORT_RADIUS}
		fill="#27272a"
		stroke="#71717a"
		stroke-width="1.5"
		class="cursor-crosshair"
		onmousedown={(e) => {
			e.stopPropagation();
		}}
		onmouseup={(e) => {
			e.stopPropagation();
			onPortDrop(node.id);
		}}
	/>

	<!-- Node-level output port (right, in footer area) -->
	<circle
		cx={NODE_WIDTH}
		cy={height - FOOTER_HEIGHT / 2}
		r={PORT_RADIUS}
		fill="#27272a"
		stroke={color}
		stroke-width="1.5"
		class="cursor-crosshair"
		onmousedown={(e) => {
			e.stopPropagation();
			e.preventDefault();
			onStartConnect(node.id, 'right', e);
		}}
	/>
</g>
