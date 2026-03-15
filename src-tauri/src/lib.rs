mod commands;
mod lsp;
mod models;
mod pipeline;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::lsp::LspState::default())
        .manage(commands::watcher::WatcherState::default())
        .manage(commands::watcher::WorkspaceWatcherState::default())
        .manage(commands::runner::RunnerState::default())
        .manage(commands::server::FileServerState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Disable browser back/forward navigation from mouse buttons 4/5
            // This is a desktop app, not a browser — navigation should only happen via the UI
            use tauri::Manager;
            let webview = app.get_webview_window("main").unwrap();
            webview.eval(
                "window.addEventListener('mouseup', function(e) { \
                    if (e.button === 3 || e.button === 4) { e.preventDefault(); } \
                }, true);"
            ).ok();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::game::list_games,
            commands::game::get_game_config,
            commands::game::get_app_root,
            commands::game::import_files,
            commands::game::delete_game,
            commands::game::save_game_meta,
            commands::game::load_game_meta,
            commands::game::export_game_zip,
            commands::game::import_game_zip,
            commands::game::run_task,
            commands::module::list_modules,
            commands::module::list_available_modules,
            commands::module::get_module,
            commands::module::validate_module_selection,
            commands::module::save_user_module,
            commands::module::delete_user_module,
            commands::module::export_module_toml,
            commands::module::import_module_toml,
            commands::wizard::create_game,
            commands::build::build_game_cmd,
            commands::build::get_build_output_path,
            commands::config::save_game_config,
            commands::config::read_file,
            commands::config::write_file,
            commands::config::read_bytes,
            commands::config::write_bytes,
            commands::config::read_file_tree,
            commands::config::create_standalone_file,
            commands::config::delete_file,
            commands::lsp::lsp_start,
            commands::lsp::lsp_stop,
            commands::lsp::lsp_send,
            commands::lsp::lsp_status,
            commands::watcher::watch_directory,
            commands::watcher::unwatch_directory,
            commands::watcher::watch_workspaces,
            commands::workspace::pick_workspace_directory,
            commands::workspace::get_default_workspace,
            commands::templates::list_templates,
            commands::templates::read_template,
            commands::templates::import_template,
            commands::templates::save_project_template,
            commands::templates::list_project_templates,
            commands::templates::create_game_from_template,
            commands::templates::delete_project_template,
            commands::search::search_in_files,
            commands::search::replace_in_file,
            commands::plugins::list_plugins,
            commands::plugins::toggle_plugin,
            commands::plugins::read_plugin_file,
            commands::plugins::create_plugin,
            commands::plugins::delete_plugin,
            commands::history::create_snapshot,
            commands::history::list_snapshots,
            commands::history::get_snapshot,
            commands::history::rollback_snapshot,
            commands::history::delete_snapshot,
            commands::history::rename_snapshot,
            commands::obfuscate::obfuscate_gpc,
            commands::flow::save_flow_project,
            commands::flow::load_flow_project,
            commands::flow::save_flow_graph,
            commands::flow::load_flow_graph,
            commands::flow::delete_flow_graph,
            commands::flow::list_chunks,
            commands::flow::save_chunk,
            commands::flow::delete_chunk,
            commands::flow::get_chunk,
            commands::git::git_is_repo,
            commands::git::git_status,
            commands::git::git_diff_file,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_commit,
            commands::git::git_status_detailed,
            commands::git::git_init,
            commands::git::git_remote_list,
            commands::git::git_remote_add,
            commands::git::git_remote_remove,
            commands::git::git_current_branch,
            commands::git::git_push,
            commands::git::git_pull,
            commands::runner::run_command,
            commands::runner::kill_command,
            commands::sprites::list_sprite_collections,
            commands::sprites::read_sprite_collection,
            commands::sprites::save_sprite_collection,
            commands::sprites::delete_sprite_collection,
            commands::server::start_file_server,
            commands::server::stop_file_server,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
