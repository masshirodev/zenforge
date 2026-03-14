use crate::models::flow::{FlowChunk, FlowGraph, FlowProject};
use std::path::PathBuf;

const FLOW_FILENAME: &str = "flow.json";
const FLOWS_FILENAME: &str = "flows.json";
const CHUNKS_DIR: &str = "chunks";

// ==================== Flow Project Commands ====================

/// Save a flow project to a game directory as flows.json
#[tauri::command]
pub fn save_flow_project(game_path: String, flow_project: FlowProject) -> Result<(), String> {
    let path = PathBuf::from(&game_path).join(FLOWS_FILENAME);
    let content = serde_json::to_string_pretty(&flow_project)
        .map_err(|e| format!("Failed to serialize flow project: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write flows.json: {}", e))?;
    Ok(())
}

/// Load a flow project from a game directory.
/// Falls back to legacy flow.json if flows.json doesn't exist.
#[tauri::command]
pub fn load_flow_project(game_path: String) -> Result<Option<FlowProject>, String> {
    let project_path = PathBuf::from(&game_path).join(FLOWS_FILENAME);
    if project_path.exists() {
        let content = std::fs::read_to_string(&project_path)
            .map_err(|e| format!("Failed to read flows.json: {}", e))?;
        let project: FlowProject = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse flows.json: {}", e))?;
        return Ok(Some(project));
    }

    // Fallback: load legacy flow.json and wrap in a FlowProject
    let legacy_path = PathBuf::from(&game_path).join(FLOW_FILENAME);
    if legacy_path.exists() {
        let content = std::fs::read_to_string(&legacy_path)
            .map_err(|e| format!("Failed to read flow.json: {}", e))?;
        let mut graph: FlowGraph = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse flow.json: {}", e))?;
        // Ensure legacy graphs get tagged as menu flow
        if graph.flow_type.is_empty() {
            graph.flow_type = "menu".to_string();
        }
        let project = FlowProject {
            version: 1,
            flows: vec![graph],
            shared_variables: vec![],
            shared_code: String::new(),
            profiles: None,
            profile_switch: None,
            weapon_defaults: None,
            updated_at: 0,
        };
        return Ok(Some(project));
    }

    Ok(None)
}

// ==================== Legacy Flow Graph Commands ====================

/// Save a flow graph to a game directory as flow.json
#[tauri::command]
pub fn save_flow_graph(game_path: String, flow_graph: FlowGraph) -> Result<(), String> {
    let path = PathBuf::from(&game_path).join(FLOW_FILENAME);
    let content = serde_json::to_string_pretty(&flow_graph)
        .map_err(|e| format!("Failed to serialize flow graph: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write flow.json: {}", e))?;
    Ok(())
}

/// Load a flow graph from a game directory (returns None if no flow.json exists)
#[tauri::command]
pub fn load_flow_graph(game_path: String) -> Result<Option<FlowGraph>, String> {
    let path = PathBuf::from(&game_path).join(FLOW_FILENAME);
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read flow.json: {}", e))?;
    let graph: FlowGraph = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse flow.json: {}", e))?;
    Ok(Some(graph))
}

/// Delete the flow graph from a game directory
#[tauri::command]
pub fn delete_flow_graph(game_path: String) -> Result<(), String> {
    let path = PathBuf::from(&game_path).join(FLOW_FILENAME);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete flow.json: {}", e))?;
    }
    Ok(())
}

// ==================== Chunk Commands ====================

fn chunks_dir(workspace_path: &str) -> PathBuf {
    PathBuf::from(workspace_path).join(CHUNKS_DIR)
}

/// List all chunks across all workspace paths
#[tauri::command]
pub fn list_chunks(workspace_paths: Vec<String>) -> Result<Vec<FlowChunk>, String> {
    let mut chunks = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for workspace in &workspace_paths {
        let dir = chunks_dir(workspace);
        if !dir.exists() {
            continue;
        }
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| format!("Failed to read chunks directory: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            if !matches!(path.extension().and_then(|e| e.to_str()), Some("zchunk") | Some("json")) {
                continue;
            }
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let chunk: FlowChunk = match serde_json::from_str(&content) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if seen_ids.insert(chunk.id.clone()) {
                chunks.push(chunk);
            }
        }
    }

    chunks.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(chunks)
}

/// Save a chunk to a workspace's chunks/ directory
#[tauri::command]
pub fn save_chunk(workspace_path: String, chunk: FlowChunk) -> Result<(), String> {
    let dir = chunks_dir(&workspace_path);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create chunks directory: {}", e))?;

    let filename = format!("{}.zchunk", chunk.id);
    let path = dir.join(filename);
    let content = serde_json::to_string_pretty(&chunk)
        .map_err(|e| format!("Failed to serialize chunk: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write chunk file: {}", e))?;
    Ok(())
}

/// Delete a chunk from workspace
#[tauri::command]
pub fn delete_chunk(workspace_paths: Vec<String>, chunk_id: String) -> Result<(), String> {
    for workspace in &workspace_paths {
        let dir = chunks_dir(workspace);
        let path = dir.join(format!("{}.zchunk", chunk_id));
        let path = if path.exists() { path } else { dir.join(format!("{}.json", chunk_id)) };
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete chunk: {}", e))?;
            return Ok(());
        }
    }
    Err(format!("Chunk '{}' not found in any workspace", chunk_id))
}

/// Get a single chunk by ID
#[tauri::command]
pub fn get_chunk(workspace_paths: Vec<String>, chunk_id: String) -> Result<FlowChunk, String> {
    for workspace in &workspace_paths {
        let dir = chunks_dir(workspace);
        let path = dir.join(format!("{}.zchunk", chunk_id));
        let path = if path.exists() { path } else { dir.join(format!("{}.json", chunk_id)) };
        if path.exists() {
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read chunk: {}", e))?;
            let chunk: FlowChunk = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse chunk: {}", e))?;
            return Ok(chunk);
        }
    }
    Err(format!("Chunk '{}' not found", chunk_id))
}
