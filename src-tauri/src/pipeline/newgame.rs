use crate::models::game_meta::GameMeta;
use std::path::{Path, PathBuf};

/// Parameters received from the frontend wizard
#[derive(Debug, Clone, serde::Deserialize)]
pub struct CreateGameParams {
    pub name: String,
    pub display_name: Option<String>,
    pub username: Option<String>,
    pub game_type: String,
    pub console_type: Option<String>,
    pub version: f64,
    pub workspace_path: Option<String>,
    pub header_comments: Option<String>,
}

/// Result of game creation
#[derive(Debug, Clone, serde::Serialize)]
pub struct CreateGameResult {
    pub game_path: String,
    pub files_created: Vec<String>,
}

/// Create a new flow-based game: write game.json and copy template files
pub fn create_game(
    app_root: &Path,
    params: CreateGameParams,
) -> Result<CreateGameResult, String> {
    let workspace = params.workspace_path.as_ref()
        .map(|p| PathBuf::from(p))
        .unwrap_or_else(|| app_root.join("Games"));
    let game_dir = workspace.join(&params.name);

    if game_dir.exists() {
        return Err(format!(
            "Game directory already exists: {}",
            game_dir.display()
        ));
    }

    // Create directories
    std::fs::create_dir_all(&game_dir)
        .map_err(|e| format!("Failed to create game directory: {}", e))?;
    std::fs::create_dir_all(game_dir.join("modules"))
        .map_err(|e| format!("Failed to create modules directory: {}", e))?;

    let mut files_created = Vec::new();

    // Build the filename template
    let filename = build_filename(params.username.as_deref());

    // Write game.json
    let console_type = params.console_type.clone().unwrap_or_else(|| "ps5".to_string());
    let display_name = params.display_name.clone()
        .unwrap_or_else(|| game_basename(&params.name));
    let meta = GameMeta {
        name: display_name,
        filename,
        version: params.version,
        game_type: params.game_type.clone(),
        console_type,
        username: params.username.clone(),
        generation_mode: "flow".to_string(),
        tags: None,
        header_comments: params.header_comments.clone(),
        generate_module_info: None,
    };

    let meta_content = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Failed to serialize game.json: {}", e))?;
    std::fs::write(game_dir.join("game.json"), &meta_content)
        .map_err(|e| format!("Failed to write game.json: {}", e))?;
    files_created.push("game.json".to_string());

    // Copy required common template files
    let common_dest_dir = game_dir.join("common");
    std::fs::create_dir_all(&common_dest_dir)
        .map_err(|e| format!("Failed to create common directory: {}", e))?;
    let common_files = get_required_common_files(&params.game_type);
    for common_file in common_files {
        let source = app_root.join("common").join(&common_file);
        let dest = common_dest_dir.join(&common_file);
        if source.exists() {
            match std::fs::copy(&source, &dest) {
                Ok(_) => files_created.push(format!("common/{}", common_file)),
                Err(e) => log::warn!("Failed to copy common/{}: {}", common_file, e),
            }
        }
    }


    Ok(CreateGameResult {
        game_path: game_dir.to_string_lossy().to_string(),
        files_created,
    })
}

fn build_filename(username: Option<&str>) -> String {
    match username {
        Some(u) if !u.trim().is_empty() => "{username}-{gameabbr}-v{version}".to_string(),
        _ => "{gameabbr}-v{version}".to_string(),
    }
}

fn get_required_common_files(game_type: &str) -> Vec<String> {
    let mut files = vec![
        "bitpack.gpc".to_string(),
        "helper.gpc".to_string(),
        "text.gpc".to_string(),
        "scroll.gpc".to_string(),
        "oled.gpc".to_string(),
        "control.gpc".to_string(),
    ];
    if game_type == "fgs" {
        files.push("fgc.gpc".to_string());
    }
    files
}

fn game_basename(name: &str) -> String {
    Path::new(name)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}
