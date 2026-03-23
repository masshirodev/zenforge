use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

/// Top-level game configuration parsed from config.toml
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameConfig {
    pub filename: String,
    pub version: f64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub console_type: Option<String>,
    #[serde(default)]
    pub profile_count: Option<u32>,
    #[serde(default)]
    pub weapons: Option<Vec<String>>,

    pub state_screen: StateScreen,
    pub buttons: ButtonConfig,
    #[serde(default)]
    pub keyboard: HashMap<String, String>,
    #[serde(default)]
    pub custom_includes: Option<CustomIncludes>,
    #[serde(default)]
    pub menu: Vec<MenuItem>,
    #[serde(default)]
    pub extra_vars: Option<HashMap<String, String>>,
    #[serde(default)]
    pub extra_defines: Option<HashMap<String, String>>,
    #[serde(default)]
    pub module_params: Option<HashMap<String, HashMap<String, String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateScreen {
    pub title: String,
    #[serde(default)]
    pub profile_labels: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ButtonConfig {
    pub menu_mod: String,
    pub menu_btn: String,
    pub confirm: String,
    pub cancel: String,
    pub up: String,
    pub down: String,
    pub left: String,
    pub right: String,
    #[serde(default)]
    pub fire: Option<String>,
    #[serde(default)]
    pub ads: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomIncludes {
    #[serde(default)]
    pub data: Option<Vec<String>>,
    #[serde(default)]
    pub menu: Option<Vec<String>>,
    #[serde(default)]
    pub persistence: Option<Vec<String>>,
}

/// A menu item in the game configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuItem {
    pub name: String,
    pub r#type: String,
    #[serde(default)]
    pub var: Option<String>,
    #[serde(default)]
    pub state_display: Option<String>,
    #[serde(default)]
    pub display_function: Option<String>,
    #[serde(default)]
    pub edit_function: Option<String>,
    #[serde(default)]
    pub render_function: Option<String>,
    #[serde(default)]
    pub state_function: Option<String>,
    #[serde(default)]
    pub status_var: Option<String>,
    #[serde(default)]
    pub module: Option<String>,
    #[serde(default)]
    pub custom_trigger: Option<bool>,
    #[serde(default)]
    pub file_id: Option<String>,
    #[serde(default)]
    pub display_type: Option<String>,
    #[serde(default)]
    pub profile_aware: Option<bool>,
    #[serde(default)]
    pub depends_on: Option<String>,
    #[serde(default)]
    pub value_x: Option<u32>,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub min: Option<i32>,
    #[serde(default)]
    pub max: Option<i32>,
    #[serde(default)]
    pub option_labels: Option<Vec<String>>,
    #[serde(default)]
    pub resets: Option<Vec<String>>,
    /// Items: flat for selector, nested for dependent_selector
    #[serde(default, deserialize_with = "deserialize_menu_items")]
    pub items: Option<MenuItems>,
    #[serde(default)]
    pub options: Option<Vec<MenuOption>>,
}

/// An option within a clickable menu item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuOption {
    pub name: String,
    pub var: String,
    pub r#type: String,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub min: Option<i32>,
    #[serde(default)]
    pub max: Option<i32>,
    #[serde(default)]
    pub state_display: Option<String>,
    #[serde(default)]
    pub profile_aware: Option<bool>,
    #[serde(default)]
    pub items: Option<Vec<String>>,
}

/// Summary info for displaying in the game list
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameSummary {
    pub name: String,
    pub path: String,
    pub game_type: String,
    pub console_type: String,
    pub version: f64,
    pub title: String,
    pub module_count: usize,
    /// "flow" for flow-based games, "config" for legacy config-based games
    #[serde(default = "default_generation_mode")]
    pub generation_mode: String,
    /// Last modified time in milliseconds since epoch
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_generation_mode() -> String {
    "config".to_string()
}

/// Menu items can be flat (selector) or nested (dependent_selector)
/// Uses untagged serialization so JSON output is a plain array, not {"Flat": [...]}
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum MenuItems {
    Flat(Vec<String>),
    Nested(Vec<Vec<String>>),
}

impl MenuItems {
    /// Get as flat list (for selector type)
    pub fn as_flat(&self) -> Option<&Vec<String>> {
        match self {
            MenuItems::Flat(v) => Some(v),
            _ => None,
        }
    }

    /// Get as nested list (for dependent_selector type)
    pub fn as_nested(&self) -> Option<&Vec<Vec<String>>> {
        match self {
            MenuItems::Nested(v) => Some(v),
            _ => None,
        }
    }
}

fn deserialize_menu_items<'de, D>(deserializer: D) -> Result<Option<MenuItems>, D::Error>
where
    D: Deserializer<'de>,
{
    let value: Option<toml::Value> = Option::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(toml::Value::Array(arr)) => {
            if arr.is_empty() {
                return Ok(Some(MenuItems::Flat(Vec::new())));
            }
            // Check if first element is a string or an array
            match &arr[0] {
                toml::Value::String(_) => {
                    // Flat array of strings
                    let strings: Result<Vec<String>, _> = arr
                        .into_iter()
                        .map(|v| match v {
                            toml::Value::String(s) => Ok(s),
                            _ => Err(serde::de::Error::custom("expected string in items array")),
                        })
                        .collect();
                    Ok(Some(MenuItems::Flat(strings?)))
                }
                toml::Value::Array(_) => {
                    // Nested array of arrays of strings
                    let nested: Result<Vec<Vec<String>>, _> = arr
                        .into_iter()
                        .map(|v| match v {
                            toml::Value::Array(inner) => inner
                                .into_iter()
                                .map(|iv| match iv {
                                    toml::Value::String(s) => Ok(s),
                                    _ => Err(serde::de::Error::custom(
                                        "expected string in nested items array",
                                    )),
                                })
                                .collect(),
                            _ => Err(serde::de::Error::custom("expected array in items")),
                        })
                        .collect();
                    Ok(Some(MenuItems::Nested(nested?)))
                }
                _ => Err(serde::de::Error::custom(
                    "items must be an array of strings or arrays",
                )),
            }
        }
        _ => Err(serde::de::Error::custom("items must be an array")),
    }
}
