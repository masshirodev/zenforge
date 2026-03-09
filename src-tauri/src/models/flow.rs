use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Multi-flow project container stored as flows.json in game directories
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowProject {
    pub version: u32,
    pub flows: Vec<FlowGraph>,
    #[serde(default)]
    pub shared_variables: Vec<FlowVariable>,
    #[serde(default)]
    pub shared_code: String,
    #[serde(default)]
    pub updated_at: u64,
}

/// Complete flow graph definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowGraph {
    pub id: String,
    pub name: String,
    pub version: u32,
    #[serde(default = "default_menu")]
    pub flow_type: String, // "menu" | "gameplay"
    pub nodes: Vec<FlowNode>,
    pub edges: Vec<FlowEdge>,
    #[serde(default)]
    pub global_variables: Vec<FlowVariable>,
    #[serde(default)]
    pub global_code: String,
    pub settings: FlowSettings,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

/// A node in the flow graph representing a state/screen
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowNode {
    pub id: String,
    pub r#type: String, // intro, home, menu, submenu, custom, screensaver, debug
    pub label: String,
    pub position: Position,
    #[serde(default)]
    pub gpc_code: String,
    #[serde(default)]
    pub oled_scene: Option<SerializedScene>,
    #[serde(default)]
    pub oled_widgets: Vec<WidgetPlacement>,
    #[serde(default)]
    pub combo_code: String,
    #[serde(default)]
    pub is_initial_state: bool,
    #[serde(default)]
    pub variables: Vec<FlowVariable>,
    #[serde(default)]
    pub on_enter: String,
    #[serde(default)]
    pub on_exit: String,
    #[serde(default)]
    pub init_code: String,
    #[serde(default)]
    pub chunk_ref: Option<String>,
    // v2: sub-node system
    #[serde(default)]
    pub sub_nodes: Vec<SubNode>,
    #[serde(default)]
    pub stack_offset_x: f64,
    #[serde(default)]
    pub stack_offset_y: f64,
    #[serde(default)]
    pub visible_count: Option<u32>,
    #[serde(default)]
    pub scroll_mode: Option<String>,
    #[serde(default)]
    pub back_button: Option<String>,
    #[serde(default)]
    pub block_inputs: Option<bool>,
    #[serde(default)]
    pub module_data: Option<ModuleNodeData>,
}

/// Module-specific data for gameplay flow nodes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleNodeData {
    pub module_id: String,
    pub module_name: String,
    #[serde(default)]
    pub trigger_condition: String,
    #[serde(default)]
    pub enable_variable: String,
    // Code sections
    #[serde(default)]
    pub init_code: String,
    #[serde(default)]
    pub main_code: String,
    #[serde(default)]
    pub functions_code: String,
    #[serde(default)]
    pub combo_code: String,
    /// @deprecated Use main_code instead. Kept for migration.
    #[serde(default)]
    pub trigger_code: Option<String>,
    #[serde(default)]
    pub options: Vec<ModuleNodeOption>,
    #[serde(default)]
    pub extra_vars: HashMap<String, String>,
    /// Button/key params from module definition — key: param key, value: selected button constant
    #[serde(default)]
    pub params: Option<HashMap<String, String>>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    /// Quick toggle: 1-2 controller buttons or a single keyboard key
    #[serde(default)]
    pub quick_toggle: Option<Vec<String>>,
    #[serde(default)]
    pub needs_weapondata: bool,
    #[serde(default)]
    pub weapon_names: Option<Vec<String>>,
    /// Per-weapon recoil values — flat array [V0, H0, V1, H1, ...] indexed by weapon order
    #[serde(default)]
    pub weapon_recoil_values: Option<Vec<i32>>,
    /// Per-weapon ADT profiles for ADP (Weapon Detection) module
    #[serde(default)]
    pub adp_profiles: Option<Vec<WeaponADTProfile>>,
    /// When true, mainCode runs without enable variable guard
    #[serde(default)]
    pub always_active: Option<bool>,
    /// Structured keyboard mappings for keyboard module — converted to GPC code at build time
    #[serde(default)]
    pub keyboard_mappings: Option<Vec<KeyMapping>>,
    /// Which flow tab this module belongs to: "gameplay" (default) or "data"
    #[serde(default)]
    pub flow_target: Option<String>,
    /// Custom string arrays for arraybuilder module
    #[serde(default)]
    pub custom_arrays: Option<Vec<CustomArrayDef>>,
}

/// A user-defined const string array for the Array Builder module
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomArrayDef {
    pub name: String,
    pub count_define: String,
    /// "1d" (default) or "2d" for array[][]
    #[serde(default)]
    pub dimension: Option<String>,
    /// 1D values — used when dimension is "1d" or absent
    #[serde(default)]
    pub values: Vec<String>,
    /// 2D values — each row is a Vec<String>; used when dimension is "2d"
    #[serde(default)]
    pub values_2d: Option<Vec<Vec<String>>>,
}

/// ADT signature for a single weapon used by the ADP weapon detection module.
/// Maps to ADP_Values[][] row: Mode, Start, F1, F2, StrLow, StrMid, StrHigh, 0, 0, Freq, 0
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponADTProfile {
    pub weapon_index: i32,
    #[serde(default)]
    pub mode: i32,
    #[serde(default)]
    pub start: i32,
    #[serde(default)]
    pub force1: i32,
    #[serde(default)]
    pub force2: i32,
    #[serde(default)]
    pub str_low: i32,
    #[serde(default)]
    pub str_mid: i32,
    #[serde(default)]
    pub str_high: i32,
    #[serde(default)]
    pub freq: i32,
}

/// A keyboard-to-controller mapping entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyMapping {
    pub source: String,
    #[serde(default)]
    pub source_combo: Option<String>,
    pub target: String,
    #[serde(default = "default_mapping_value")]
    pub value: i32,
    pub r#type: String, // "keyboard" | "controller"
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_mapping_value() -> i32 {
    100
}

/// A configurable option on a module node
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleNodeOption {
    pub name: String,
    pub variable: String,
    pub r#type: String, // "toggle" | "value" | "array"
    #[serde(default)]
    pub default_value: i32,
    #[serde(default)]
    pub min: Option<i32>,
    #[serde(default)]
    pub max: Option<i32>,
    /// For 'array' type: name of the const string[] array in GPC code
    #[serde(default)]
    pub array_name: Option<String>,
    /// For 'array' type: number of entries in the array
    #[serde(default)]
    pub array_size: Option<i32>,
}

/// An edge connecting two nodes representing a transition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowEdge {
    pub id: String,
    pub source_node_id: String,
    pub target_node_id: String,
    #[serde(default = "default_port")]
    pub source_port: String,
    #[serde(default = "default_port")]
    pub target_port: String,
    #[serde(default)]
    pub label: String,
    pub condition: FlowCondition,
    // v2: sub-node level edges
    #[serde(default)]
    pub source_sub_node_id: Option<String>,
    #[serde(default)]
    pub target_sub_node_id: Option<String>,
}

fn default_menu() -> String {
    "menu".to_string()
}

fn default_port() -> String {
    "right".to_string()
}

/// Transition condition for an edge
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowCondition {
    pub r#type: String, // button_press, button_hold, timeout, variable, custom
    #[serde(default)]
    pub button: Option<String>,
    #[serde(default)]
    pub modifiers: Option<Vec<String>>,
    #[serde(default)]
    pub timeout_ms: Option<u32>,
    #[serde(default)]
    pub variable: Option<String>,
    #[serde(default)]
    pub comparison: Option<String>,
    #[serde(default)]
    pub value: Option<i32>,
    #[serde(default)]
    pub custom_code: Option<String>,
}

/// A variable used in the flow
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowVariable {
    pub name: String,
    pub r#type: String, // int, int8, int16, int32, string
    #[serde(default)]
    pub default_value: serde_json::Value, // number or string
    #[serde(default)]
    pub persist: bool,
    #[serde(default)]
    pub min: Option<i32>,
    #[serde(default)]
    pub max: Option<i32>,
    #[serde(default)]
    pub array_size: Option<u32>,
}

/// OLED scene data (matches frontend SerializedScene)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedScene {
    pub id: String,
    pub name: String,
    pub pixels: String, // Base64-encoded Uint8Array
}

/// Widget placement within a node's OLED area
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetPlacement {
    pub widget_id: String,
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub config: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub bound_variable: Option<String>,
}

/// Condition for conditional sub-node rendering
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubNodeCondition {
    pub variable: String,
    pub comparison: String, // "==" | "!=" | ">" | "<" | ">=" | "<="
    pub value: i32,
}

/// A sub-node within a flow node (v2)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubNode {
    pub id: String,
    pub r#type: String, // header, menu-item, toggle-item, value-item, scroll-bar, text-line, bar, indicator, pixel-art, separator, custom
    #[serde(default)]
    pub label: String,
    #[serde(default = "default_stack")]
    pub position: String, // stack | absolute
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub order: u32,
    #[serde(default)]
    pub interactive: bool,
    #[serde(default)]
    pub config: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub render_code: Option<String>,
    #[serde(default)]
    pub interact_code: Option<String>,
    #[serde(default)]
    pub bound_variable: Option<String>,
    /// When set, this sub-node only renders when the condition is met
    #[serde(default)]
    pub condition: Option<SubNodeCondition>,
    /// Text rendered on the OLED. When empty, falls back to label.
    #[serde(default)]
    pub display_text: Option<String>,
}

fn default_stack() -> String {
    "stack".to_string()
}

/// Position on the canvas
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

/// Flow settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowSettings {
    #[serde(default = "default_timeout")]
    pub screen_timeout_ms: u32,
    #[serde(default = "default_font")]
    pub default_font: String,
    #[serde(default = "default_true")]
    pub include_common_utils: bool,
    #[serde(default = "default_true")]
    pub persistence_enabled: bool,
    #[serde(default)]
    pub button_mapping: FlowButtonMapping,
}

fn default_timeout() -> u32 {
    5000
}
fn default_font() -> String {
    "OLED_FONT_SMALL".to_string()
}
fn default_true() -> bool {
    true
}

/// Button mapping for flow navigation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowButtonMapping {
    #[serde(default = "default_confirm")]
    pub confirm: String,
    #[serde(default = "default_cancel")]
    pub cancel: String,
    #[serde(default = "default_up")]
    pub up: String,
    #[serde(default = "default_down")]
    pub down: String,
    #[serde(default = "default_left")]
    pub left: String,
    #[serde(default = "default_right")]
    pub right: String,
}

impl Default for FlowButtonMapping {
    fn default() -> Self {
        Self {
            confirm: default_confirm(),
            cancel: default_cancel(),
            up: default_up(),
            down: default_down(),
            left: default_left(),
            right: default_right(),
        }
    }
}

fn default_confirm() -> String {
    "CONFIRM_BTN".to_string()
}
fn default_cancel() -> String {
    "CANCEL_BTN".to_string()
}
fn default_up() -> String {
    "UP_BTN".to_string()
}
fn default_down() -> String {
    "DOWN_BTN".to_string()
}
fn default_left() -> String {
    "LEFT_BTN".to_string()
}
fn default_right() -> String {
    "RIGHT_BTN".to_string()
}

/// Reusable chunk stored in workspace chunks/ directory
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowChunk {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub creator: Option<String>,
    pub node_template: serde_json::Value, // Partial FlowNode as JSON
    #[serde(default)]
    pub edge_templates: Vec<ChunkEdgeTemplate>,
    #[serde(default)]
    pub parameters: Vec<ChunkParameter>,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

/// Edge template for a chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkEdgeTemplate {
    pub label: String,
    pub condition: FlowCondition,
    pub direction: String, // "outgoing" | "incoming"
    #[serde(default)]
    pub source_sub_node_id: Option<String>,
}

/// Configurable parameter for a chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkParameter {
    pub key: String,
    pub label: String,
    pub r#type: String, // string, number, boolean, button, code
    pub default_value: String,
    #[serde(default)]
    pub description: String,
}
