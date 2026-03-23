export interface GameConfig {
	filename: string;
	version: number;
	name?: string;
	username?: string;
	type?: string;
	console_type?: string;
	profile_count: number;
	state_screen: StateScreen;
	buttons: ButtonConfig;
	keyboard: Record<string, string>;
	custom_includes?: CustomIncludes;
	menu: MenuItem[];
	extra_vars: Record<string, string>;
	extra_defines: Record<string, string>;
}

export interface StateScreen {
	title: string;
	profile_labels?: string[];
}

export interface ButtonConfig {
	menu_mod: string;
	menu_btn: string;
	confirm: string;
	cancel: string;
	up: string;
	down: string;
	left: string;
	right: string;
}

export interface CustomIncludes {
	data: string[];
	menu: string[];
	persistence: string[];
}

export interface MenuItem {
	name: string;
	type: string;
	var?: string;
	state_display?: string;
	display_function?: string;
	edit_function?: string;
	render_function?: string;
	state_function?: string;
	status_var?: string;
	module?: string;
	custom_trigger?: boolean;
	file_id?: string;
	display_type?: string;
	profile_aware?: boolean;
	depends_on?: string;
	value_x?: number;
	default?: unknown;
	min?: number;
	max?: number;
	option_labels?: string[];
	resets?: string[];
	items?: string[] | string[][];
	options?: MenuOption[];
}

export interface MenuOption {
	name: string;
	var: string;
	type: string;
	default?: unknown;
	min?: number;
	max?: number;
	state_display?: string;
	items?: string[];
}

export interface GameSummary {
	name: string;
	path: string;
	game_type: string;
	console_type: string;
	version: number;
	title: string;
	module_count: number;
	generation_mode: 'flow' | 'config';
	updated_at: number;
	tags?: string[];
}

export interface GameMeta {
	name: string;
	filename: string;
	version: number;
	game_type: string;
	console_type: string;
	username?: string;
	generation_mode: string;
	tags?: string[];
	header_comments?: string;
	generate_module_info?: boolean;
}
