use crate::models::config::GameConfig;
use std::path::PathBuf;

/// Save a game configuration back to config.toml (legacy config-based games)
#[tauri::command]
pub fn save_game_config(game_path: String, config: GameConfig) -> Result<(), String> {
    let config_path = PathBuf::from(&game_path).join("config.toml");

    let content = toml::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_path, &content)
        .map_err(|e| format!("Failed to write config.toml: {}", e))?;

    Ok(())
}

/// Read a file's contents (for the code editor)
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Write a file's contents (for the code editor)
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))
}

/// Read binary data from a file
#[tauri::command]
pub fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Write binary data to a file
#[tauri::command]
pub fn write_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| format!("Failed to write file: {}", e))
}

/// Read the file tree for a game directory
#[tauri::command]
pub fn read_file_tree(path: String) -> Result<Vec<FileTreeEntry>, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("Directory not found: {}", path));
    }

    let mut entries = Vec::new();
    collect_tree_entries(&root, &root, &mut entries)?;
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    Ok(entries)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileTreeEntry>>,
}

fn collect_tree_entries(
    dir: &PathBuf,
    root: &PathBuf,
    entries: &mut Vec<FileTreeEntry>,
) -> Result<(), String> {
    let read_dir =
        std::fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and build artifacts
        if name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            let mut children = Vec::new();
            collect_tree_entries(&path, root, &mut children)?;
            children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            });
            entries.push(FileTreeEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: true,
                children: Some(children),
            });
        } else {
            entries.push(FileTreeEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                children: None,
            });
        }
    }
    Ok(())
}

/// Create a new standalone file in the game directory (defaults to .gpc if no extension given)
#[tauri::command]
pub fn create_standalone_file(game_path: String, filename: String) -> Result<String, String> {
    let filename = resolve_filename(filename);

    if filename.contains('/') || filename.contains('\\') {
        return Err("Filename cannot contain slashes".to_string());
    }

    let file_path = PathBuf::from(&game_path).join(&filename);

    if file_path.exists() {
        return Err(format!("File already exists: {}", filename));
    }

    let content = if filename.ends_with(".gpc") {
        format!(
            "// {}\n// Created by Cronus IDE\n\n// Add your code here\n",
            filename
        )
    } else {
        String::new()
    };
    std::fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Resolve filename: adds .gpc if no extension is present.
/// Extracted for testability.
fn resolve_filename(filename: String) -> String {
    if filename.contains('.') {
        filename
    } else {
        format!("{}.gpc", filename)
    }
}

/// Delete a file (prevents deletion of critical game files)
#[tauri::command]
pub fn delete_file(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err("File not found".to_string());
    }

    if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
        // Protect critical game files
        if filename == "config.toml" || filename == "game.json" {
            return Err(format!("Cannot delete protected file: {}", filename));
        }
    }

    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn resolve_filename_adds_gpc_when_no_extension() {
        assert_eq!(resolve_filename("myfile".into()), "myfile.gpc");
    }

    #[test]
    fn resolve_filename_preserves_gpc_extension() {
        assert_eq!(resolve_filename("myfile.gpc".into()), "myfile.gpc");
    }

    #[test]
    fn resolve_filename_preserves_other_extensions() {
        assert_eq!(resolve_filename("readme.txt".into()), "readme.txt");
        assert_eq!(resolve_filename("data.json".into()), "data.json");
        assert_eq!(resolve_filename("script.js".into()), "script.js");
    }

    #[test]
    fn resolve_filename_preserves_double_extensions() {
        assert_eq!(resolve_filename("project.oled.json".into()), "project.oled.json");
    }

    #[test]
    fn create_file_without_extension_gets_gpc() {
        let dir = tempdir().unwrap();
        let result = create_standalone_file(
            dir.path().to_string_lossy().to_string(),
            "myfile".into(),
        );
        assert!(result.is_ok());
        let path = PathBuf::from(result.unwrap());
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "myfile.gpc");
        assert!(path.exists());
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("// myfile.gpc"));
    }

    #[test]
    fn create_file_with_custom_extension_preserves_it() {
        let dir = tempdir().unwrap();
        let result = create_standalone_file(
            dir.path().to_string_lossy().to_string(),
            "notes.txt".into(),
        );
        assert!(result.is_ok());
        let path = PathBuf::from(result.unwrap());
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "notes.txt");
        assert!(path.exists());
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.is_empty());
    }

    #[test]
    fn create_file_with_gpc_extension_gets_boilerplate() {
        let dir = tempdir().unwrap();
        let result = create_standalone_file(
            dir.path().to_string_lossy().to_string(),
            "custom.gpc".into(),
        );
        assert!(result.is_ok());
        let path = PathBuf::from(result.unwrap());
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("// custom.gpc"));
    }

    #[test]
    fn create_file_rejects_slashes() {
        let dir = tempdir().unwrap();
        let result = create_standalone_file(
            dir.path().to_string_lossy().to_string(),
            "sub/file.gpc".into(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("slashes"));
    }

    #[test]
    fn create_file_rejects_duplicates() {
        let dir = tempdir().unwrap();
        let _ = create_standalone_file(
            dir.path().to_string_lossy().to_string(),
            "existing.gpc".into(),
        );
        let result = create_standalone_file(
            dir.path().to_string_lossy().to_string(),
            "existing.gpc".into(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }
}
