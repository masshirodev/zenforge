import type { Combo, ComboProject, ComboStep, ModuleExportConfig } from './types';
import {
	CONSOLE_AXES,
	translateButton,
	type ConsoleType
} from '$lib/utils/console-buttons';

function translateStepButtons(
	step: ComboStep,
	from: ConsoleType,
	to: ConsoleType
): ComboStep {
	if (from === to) return step;
	return {
		...step,
		buttons: step.buttons.map((b) => ({
			...b,
			button: translateButton(b.button, from, to)
		}))
	};
}

function generateStepCode(step: ComboStep, consoleType: ConsoleType, indent: string): string {
	const lines: string[] = [];
	const axes = CONSOLE_AXES[consoleType];

	// Button set_val calls
	for (const b of step.buttons) {
		lines.push(`${indent}set_val(${b.button}, ${b.value});`);
	}

	// Stick set_val calls
	for (const s of step.sticks) {
		const ax = s.axis === 'left' ? axes.lx : axes.rx;
		const ay = s.axis === 'left' ? axes.ly : axes.ry;
		if (s.x !== 0) lines.push(`${indent}set_val(${ax}, ${s.x});`);
		if (s.y !== 0) lines.push(`${indent}set_val(${ay}, ${s.y});`);
	}

	// Wait
	if (step.waitMs > 0) {
		lines.push(`${indent}wait(${step.waitMs});`);
	}

	return lines.join('\n');
}

export function exportComboGPC(
	project: ComboProject,
	targetConsole?: ConsoleType
): string {
	const target = targetConsole ?? project.consoleType;
	const name = sanitizeName(project.name);
	const indent = '    ';

	const stepBlocks = project.steps.map((step, i) => {
		const translated = translateStepButtons(step, project.consoleType, target);
		const comment = step.label ? `${indent}// ${step.label}\n` : '';
		return comment + generateStepCode(translated, target, indent);
	});

	return `combo ${name} {\n${stepBlocks.join('\n')}\n}`;
}

export function exportModuleTOML(
	project: ComboProject,
	config: ModuleExportConfig
): string {
	const comboName = sanitizeName(project.name);
	const comboCode = exportComboGPC(project);

	// Build trigger
	let trigger: string;
	if (config.triggerMode === 'hold') {
		trigger = `if (${comboName}Status && get_val(${config.triggerButton})) {\\n    combo_run(${comboName});\\n} else {\\n    combo_stop(${comboName});\\n}`;
	} else {
		trigger = `if (${comboName}Status && event_press(${config.triggerButton})) {\\n    combo_run(${comboName});\\n}`;
	}

	// Escape combo code for TOML string
	const escapedCombo = comboCode.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

	const lines: string[] = [
		`[${config.id}]`,
		`display_name = "${config.displayName}"`,
		`id = "${config.id}"`,
		`type = "${config.gameType}"`,
		`description = "${(config.description || 'Custom combo created with Combo Maker').replace(/"/g, '\\"')}"`,
		`state_display = "${config.id.slice(0, 2).toUpperCase()}"`,
		`status_var = "${comboName}Status"`,
		`trigger = "${trigger}"`,
		`combo = "${escapedCombo}"`,
		'',
		`[[${config.id}.options]]`,
		`name = "Status"`,
		`var = "${comboName}Status"`,
		`type = "toggle"`,
		`default = 0`
	];

	return lines.join('\n');
}

/**
 * Export combo steps as a GPC data() block.
 * Format per step: button_count, button_names..., wait_centiseconds
 * Terminated with EOC per combo, EOD to end the data block.
 */
export function exportComboData(
	project: ComboProject,
	targetConsole?: ConsoleType
): string {
	const target = targetConsole ?? project.consoleType;
	const name = sanitizeName(project.name);
	const axes = CONSOLE_AXES[target];

	const stepLines: string[] = [];

	for (const step of project.steps) {
		const translated = translateStepButtons(step, project.consoleType, target);

		// Collect all inputs for this step (buttons + stick axes as buttons)
		const inputs: string[] = [];
		for (const b of translated.buttons) {
			inputs.push(b.button);
		}
		for (const s of translated.sticks) {
			const ax = s.axis === 'left' ? axes.lx : axes.rx;
			const ay = s.axis === 'left' ? axes.ly : axes.ry;
			if (s.x !== 0) inputs.push(ax);
			if (s.y !== 0) inputs.push(ay);
		}

		// Wait in centiseconds (ms / 10), clamped to 0-254
		const waitCs = Math.min(Math.max(Math.round(step.waitMs / 10), 0), 254);

		const comment = step.label ? `  // ${step.label}` : '';
		const parts = inputs.length > 0 ? `${inputs.length},${inputs.join(',')},${waitCs},` : `0,${waitCs},`;
		stepLines.push(parts + comment);
	}

	const lines = [
		`// ${name} — ${project.steps.length} step(s)`,
		'// Format: button_count, buttons..., wait (x10ms) per step',
		'data(',
		`${name},`,
		...stepLines,
		'EOC,',
		'EOD );'
	];

	return lines.join('\n');
}

function sanitizeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]/g, '') || 'MyCombo';
}

/** Resolve the list of combos from a project (backwards compatible with single-combo format) */
export function getProjectCombos(project: ComboProject): Combo[] {
	if (project.combos && project.combos.length > 0) return project.combos;
	return [{ id: 'legacy', name: project.name, steps: project.steps }];
}

/** Export all combos in a project as GPC code */
export function exportAllCombosGPC(
	project: ComboProject,
	targetConsole?: ConsoleType
): string {
	const combos = getProjectCombos(project);
	return combos
		.map((c) => {
			const legacy: ComboProject = { ...project, name: c.name, steps: c.steps };
			return exportComboGPC(legacy, targetConsole);
		})
		.join('\n\n');
}

/** Export all combos in a project as a single data() block */
export function exportAllCombosData(
	project: ComboProject,
	targetConsole?: ConsoleType
): string {
	const combos = getProjectCombos(project);
	if (combos.length <= 1) {
		return exportComboData(project, targetConsole);
	}

	const target = targetConsole ?? project.consoleType;
	const axes = CONSOLE_AXES[target];
	const sections: string[] = [];

	for (const combo of combos) {
		const name = sanitizeName(combo.name);
		const stepLines: string[] = [];

		for (const step of combo.steps) {
			const translated = translateStepButtons(step, project.consoleType, target);
			const inputs: string[] = [];
			for (const b of translated.buttons) inputs.push(b.button);
			for (const s of translated.sticks) {
				const ax = s.axis === 'left' ? axes.lx : axes.rx;
				const ay = s.axis === 'left' ? axes.ly : axes.ry;
				if (s.x !== 0) inputs.push(ax);
				if (s.y !== 0) inputs.push(ay);
			}
			const waitCs = Math.min(Math.max(Math.round(step.waitMs / 10), 0), 254);
			const comment = step.label ? `  // ${step.label}` : '';
			const parts = inputs.length > 0
				? `${inputs.length},${inputs.join(',')},${waitCs},`
				: `0,${waitCs},`;
			stepLines.push(parts + comment);
		}

		sections.push(
			`// ${name} — ${combo.steps.length} step(s)\n` +
			'// Format: button_count, buttons..., wait (x10ms) per step\n\n' +
			`${name},\n` +
			stepLines.join('\n') + '\n' +
			'EOC,'
		);
	}

	return 'data(\n' + sections.join('\n\n') + '\nEOD );';
}
