use serde::{Deserialize, Serialize};

/// Lightweight game metadata stored as game.json in game directories.
/// Replaces config.toml as the primary game metadata source for flow-based games.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameMeta {
    pub name: String,
    pub filename: String,
    pub version: u32,
    pub game_type: String,
    pub console_type: String,
    #[serde(default)]
    pub username: Option<String>,
    /// Always "flow" for new games. Legacy config-based games use config.toml instead.
    #[serde(default = "default_generation_mode")]
    pub generation_mode: String,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// User-defined comments to include in the built output file header
    #[serde(default)]
    pub header_comments: Option<String>,
}

fn default_generation_mode() -> String {
    "flow".to_string()
}
