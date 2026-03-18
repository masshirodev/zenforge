use crate::models::config::GameConfig;
use crate::models::game_meta::GameMeta;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Strip the Windows `\\?\` extended-length path prefix for cleaner display.
fn display_path(path: &Path) -> String {
    let s = path.display().to_string();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

/// Result of a build operation
#[derive(Debug, Clone, serde::Serialize)]
pub struct BuildResult {
    pub output_path: String,
    pub success: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Build log entry emitted during preprocessing
#[derive(Debug, Clone, serde::Serialize)]
pub struct BuildLogEntry {
    pub level: String, // "info", "warn", "error"
    pub message: String,
}

/// Preprocess a GPC file by recursively expanding import directives.
///
/// Returns (processed_content, log_entries, success).
pub fn preprocess(
    file_path: &Path,
    verbose: bool,
) -> (String, Vec<BuildLogEntry>, bool) {
    let mut processed_files: HashSet<PathBuf> = HashSet::new();
    let mut logs = Vec::new();
    let mut success = true;

    let content = preprocess_recursive(
        file_path,
        &mut processed_files,
        &mut Vec::new(),
        &mut logs,
        &mut success,
        verbose,
    );

    (content, logs, success)
}

fn preprocess_recursive(
    file_path: &Path,
    processed_files: &mut HashSet<PathBuf>,
    include_stack: &mut Vec<PathBuf>,
    logs: &mut Vec<BuildLogEntry>,
    success: &mut bool,
    verbose: bool,
) -> String {
    let abs_path = match file_path.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            // File doesn't exist - try the raw absolute path for error reporting
            let abs = if file_path.is_absolute() {
                file_path.to_path_buf()
            } else {
                std::env::current_dir()
                    .unwrap_or_default()
                    .join(file_path)
            };
            logs.push(BuildLogEntry {
                level: "error".to_string(),
                message: format!("File not found: {}", display_path(&abs)),
            });
            *success = false;
            return format!("// Error: Missing file {}\n", file_path.display());
        }
    };

    // Skip already processed files (prevents double-inclusion)
    if processed_files.contains(&abs_path) || include_stack.contains(&abs_path) {
        if verbose {
            logs.push(BuildLogEntry {
                level: "info".to_string(),
                message: format!("Skipping (already included): {}", file_path.display()),
            });
        }
        return String::new();
    }

    if verbose {
        let indent = "  ".repeat(include_stack.len());
        logs.push(BuildLogEntry {
            level: "info".to_string(),
            message: format!("{}Processing: {}", indent, file_path.display()),
        });
    }

    processed_files.insert(abs_path.clone());
    include_stack.push(abs_path.clone());

    let content = match std::fs::read_to_string(&abs_path) {
        Ok(c) => c,
        Err(e) => {
            logs.push(BuildLogEntry {
                level: "error".to_string(),
                message: format!("Could not read {}: {}", display_path(&abs_path), e),
            });
            *success = false;
            include_stack.pop();
            return format!("// Error: Could not read {}\n", file_path.display());
        }
    };

    let base_dir = abs_path.parent().unwrap_or(Path::new("."));
    let mut output = String::with_capacity(content.len() * 2);

    for (line_num, line) in content.lines().enumerate() {
        let line_num = line_num + 1; // 1-indexed

        // Skip commented lines - don't process their import directives
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") {
            output.push_str(line);
            output.push('\n');
            continue;
        }

        // Check for import directive
        if let Some(import_path) = parse_import(trimmed) {
            let full_import_path = normalize_path(&base_dir.join(&import_path));

            let included_content = preprocess_recursive(
                &full_import_path,
                processed_files,
                include_stack,
                logs,
                success,
                verbose,
            );

            if !*success {
                logs.push(BuildLogEntry {
                    level: "error".to_string(),
                    message: format!("  Referenced from: {}:{}", display_path(&abs_path), line_num),
                });
            }

            output.push_str(&included_content);
        } else {
            output.push_str(line);
            output.push('\n');
        }
    }

    include_stack.pop();
    output
}

/// Parse an import directive and return the resolved filename.
///
/// Supports:
///   import common/helper;          -> common/helper.gpc
///   import "common/helper.gpc";    -> common/helper.gpc
///   import "common/helper";        -> common/helper.gpc
///   #include "common/helper.gpc"   -> common/helper.gpc  (legacy)
fn parse_import(line: &str) -> Option<String> {
    let trimmed = line.trim();

    // New syntax: import path; or import "path";
    if trimmed.starts_with("import") && !trimmed.starts_with("import!") {
        let rest = trimmed["import".len()..].trim();

        // Must end with semicolon
        if !rest.ends_with(';') {
            return None;
        }
        let path_part = rest[..rest.len() - 1].trim();

        let path = if path_part.starts_with('"') && path_part.ends_with('"') && path_part.len() > 2
        {
            // Quoted: import "common/helper.gpc";
            &path_part[1..path_part.len() - 1]
        } else if !path_part.is_empty() {
            // Unquoted: import common/helper;
            path_part
        } else {
            return None;
        };

        let full_path = if path.ends_with(".gpc") {
            path.to_string()
        } else {
            format!("{}.gpc", path)
        };
        return Some(full_path);
    }

    // Legacy syntax: #include "filename"
    if trimmed.starts_with("#include") {
        let rest = trimmed["#include".len()..].trim();
        if rest.starts_with('"') && rest.ends_with('"') && rest.len() > 2 {
            return Some(rest[1..rest.len() - 1].to_string());
        }
    }

    None
}

/// Normalize a path (resolve ../ and ./ components) without requiring the file to exist.
fn normalize_path(path: &Path) -> PathBuf {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                components.pop();
            }
            std::path::Component::CurDir => {}
            _ => {
                components.push(component);
            }
        }
    }
    components.iter().collect()
}

// ============================================================
// Macro expansion
// ============================================================

/// A parsed macro definition from `define! name(params) { body }`.
#[derive(Debug, Clone)]
struct MacroDef {
    name: String,
    params: Vec<String>,
    body: String,
    has_placeholder: bool,
    /// Byte range of the entire `define! ... { ... }` block in the source.
    byte_range: std::ops::Range<usize>,
}

/// Return the byte length of the UTF-8 character starting at the given byte.
fn utf8_char_len(b: u8) -> usize {
    if b < 0x80 {
        1
    } else if b < 0xE0 {
        2
    } else if b < 0xF0 {
        3
    } else {
        4
    }
}

/// Extract all `define!` macro definitions from fully-preprocessed source.
fn extract_macro_definitions(source: &str) -> Vec<MacroDef> {
    let mut macros = Vec::new();
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        // Skip to potential "define!" keyword (only ASCII, safe to check byte)
        if bytes[i] > 0x7F || !source[i..].starts_with("define!") {
            i += utf8_char_len(bytes[i]);
            continue;
        }

        // Make sure this isn't inside a comment
        let line_start = source[..i].rfind('\n').map(|p| p + 1).unwrap_or(0);
        let before = source[line_start..i].trim_start();
        if before.starts_with("//") {
            i += 7;
            continue;
        }

        let block_start = i;
        i += 7; // skip "define!"

        // Skip whitespace to get name
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }

        // Parse name (ASCII identifiers only)
        let name_start = i;
        while i < len && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
            i += 1;
        }
        if i == name_start {
            continue;
        }
        let name = source[name_start..i].to_string();

        // Skip whitespace to opening paren
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= len || bytes[i] != b'(' {
            continue;
        }
        i += 1; // skip '('

        // Parse params until ')'
        let mut params = Vec::new();
        loop {
            while i < len && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i >= len {
                break;
            }
            if bytes[i] == b')' {
                i += 1;
                break;
            }
            if bytes[i] == b',' {
                i += 1;
                continue;
            }
            // Skip optional type keyword (e.g., "int")
            let token_start = i;
            while i < len && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                i += 1;
            }
            let token = &source[token_start..i];

            // Peek ahead: if there's another identifier after whitespace before , or ),
            // this token is a type and the next is the param name
            let saved = i;
            while i < len && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < len && (bytes[i].is_ascii_alphabetic() || bytes[i] == b'_') {
                // Next token is the real param name
                let pname_start = i;
                while i < len && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                    i += 1;
                }
                params.push(source[pname_start..i].to_string());
            } else {
                // This token is the param name (no type prefix)
                i = saved;
                params.push(token.to_string());
            }
        }

        // Skip whitespace to opening brace
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= len || bytes[i] != b'{' {
            continue;
        }

        // Find matching closing brace (braces are ASCII, safe to scan bytes)
        let body_start = i + 1;
        let mut depth = 1;
        i += 1;
        while i < len && depth > 0 {
            match bytes[i] {
                b'{' => depth += 1,
                b'}' => depth -= 1,
                b'/' if i + 1 < len && bytes[i + 1] == b'/' => {
                    // Skip line comment
                    while i < len && bytes[i] != b'\n' {
                        i += 1;
                    }
                    continue;
                }
                _ => {}
            }
            i += 1;
        }

        if depth != 0 {
            continue;
        }

        let body_end = i - 1; // before the closing '}'
        let body = source[body_start..body_end].to_string();
        let has_placeholder = body.contains("%0");

        macros.push(MacroDef {
            name,
            params,
            body,
            has_placeholder,
            byte_range: block_start..i,
        });
    }

    macros
}

/// Strip macro definitions from the source, returning content without `define!` blocks.
fn strip_macro_definitions(source: &str, macros: &[MacroDef]) -> String {
    if macros.is_empty() {
        return source.to_string();
    }

    let mut result = String::with_capacity(source.len());
    let mut pos = 0;
    for mac in macros {
        result.push_str(&source[pos..mac.byte_range.start]);
        pos = mac.byte_range.end;
        // Skip trailing newline if present
        if pos < source.len() && source.as_bytes()[pos] == b'\n' {
            pos += 1;
        }
    }
    result.push_str(&source[pos..]);
    result
}

/// Expand macro calls in the source. Returns the expanded content and any errors.
///
/// Handles `name(args)!` and `name(args)! { body }` call syntax.
fn expand_macro_calls(
    source: &str,
    macros: &[MacroDef],
    errors: &mut Vec<String>,
) -> String {
    if macros.is_empty() {
        return source.to_string();
    }

    let mut result = source.to_string();

    // Iterate expansion passes (macros may produce other macro calls)
    for _pass in 0..16 {
        let mut any_expanded = false;
        let mut new_result = String::with_capacity(result.len());
        let bytes = result.as_bytes();
        let len = bytes.len();
        let mut i = 0;

        while i < len {
            // Non-ASCII byte: copy full UTF-8 character and continue
            if bytes[i] > 0x7F {
                let clen = utf8_char_len(bytes[i]);
                new_result.push_str(&result[i..i + clen.min(len - i)]);
                i += clen;
                continue;
            }

            // Check if we're in a comment
            if bytes[i] == b'/' && i + 1 < len && bytes[i + 1] == b'/' {
                // Copy rest of line (line content may have non-ASCII)
                let line_end = result[i..].find('\n').map(|p| i + p).unwrap_or(len);
                new_result.push_str(&result[i..line_end]);
                i = line_end;
                continue;
            }

            // Look for identifier followed by ( ... )!
            if bytes[i].is_ascii_alphabetic() || bytes[i] == b'_' {
                let ident_start = i;
                while i < len && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                    i += 1;
                }
                let ident = &result[ident_start..i];

                // Check if this identifier matches a macro name
                let mac = macros.iter().find(|m| m.name == ident);
                if mac.is_none() {
                    new_result.push_str(ident);
                    continue;
                }
                let mac = mac.unwrap();

                // Skip whitespace
                let saved_i = i;
                while i < len && bytes[i].is_ascii_whitespace() && bytes[i] != b'\n' {
                    i += 1;
                }

                // Expect '('
                if i >= len || bytes[i] != b'(' {
                    new_result.push_str(ident);
                    i = saved_i;
                    continue;
                }

                // Parse arguments inside ( ... )
                i += 1; // skip '('
                let args = match parse_balanced_args(&result, &mut i) {
                    Some(a) => a,
                    None => {
                        new_result.push_str(ident);
                        i = saved_i;
                        continue;
                    }
                };

                // Skip whitespace
                while i < len && bytes[i].is_ascii_whitespace() && bytes[i] != b'\n' {
                    i += 1;
                }

                // Expect '!'
                if i >= len || bytes[i] != b'!' {
                    // Not a macro call, just a regular function call
                    new_result.push_str(ident);
                    new_result.push('(');
                    new_result.push_str(&args.join(", "));
                    new_result.push(')');
                    continue;
                }
                i += 1; // skip '!'

                // Optional body block { ... }
                let mut caller_body = String::new();
                let saved_after_bang = i;
                // Skip whitespace (including newlines) to find optional body
                while i < len && bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
                if i < len && bytes[i] == b'{' {
                    i += 1; // skip '{'
                    let body_start = i;
                    let mut depth = 1;
                    while i < len && depth > 0 {
                        match bytes[i] {
                            b'{' => depth += 1,
                            b'}' => depth -= 1,
                            _ => {}
                        }
                        i += 1;
                    }
                    if depth == 0 {
                        caller_body = result[body_start..i - 1].trim().to_string();
                    }
                } else {
                    // No body block
                    i = saved_after_bang;
                }

                // Validate: if macro has %0 placeholder, caller must provide a body
                if mac.has_placeholder && caller_body.is_empty() {
                    errors.push(format!(
                        "Macro '{}' requires a body block because it contains a %0 placeholder",
                        mac.name
                    ));
                    new_result.push_str(&format!("/* Error: macro '{}' requires body */", mac.name));
                    any_expanded = true;
                    continue;
                }

                // Validate argument count
                if args.len() != mac.params.len() && !(args.len() == 1 && args[0].is_empty() && mac.params.is_empty()) {
                    errors.push(format!(
                        "Macro '{}' expects {} arguments but got {}",
                        mac.name,
                        mac.params.len(),
                        args.len()
                    ));
                }

                // Expand: substitute params and %0
                let mut expanded = mac.body.clone();

                // Substitute parameters (word-boundary aware)
                for (idx, param) in mac.params.iter().enumerate() {
                    if let Some(arg) = args.get(idx) {
                        expanded = replace_word(&expanded, param, arg.trim());
                    }
                }

                // Substitute %0 placeholder with caller body
                if mac.has_placeholder {
                    expanded = expanded.replace("%0", &caller_body);
                }

                new_result.push_str(expanded.trim());
                any_expanded = true;
            } else {
                // ASCII non-identifier character
                new_result.push(bytes[i] as char);
                i += 1;
            }
        }

        result = new_result;
        if !any_expanded {
            break;
        }
    }

    result
}

/// Replace all whole-word occurrences of `word` with `replacement`.
/// Word boundaries are ASCII identifier chars (alphanumeric + underscore).
/// Safe for UTF-8: non-ASCII bytes are never word chars, so multi-byte
/// sequences pass through without being split.
fn replace_word(source: &str, word: &str, replacement: &str) -> String {
    let bytes = source.as_bytes();
    let word_bytes = word.as_bytes();
    let len = bytes.len();
    let wlen = word_bytes.len();

    if wlen == 0 || wlen > len {
        return source.to_string();
    }

    let mut result = String::with_capacity(len);
    let mut i = 0;

    fn is_word_char(b: u8) -> bool {
        b.is_ascii_alphanumeric() || b == b'_'
    }

    while i <= len - wlen {
        if &bytes[i..i + wlen] == word_bytes {
            let before_ok = i == 0 || !is_word_char(bytes[i - 1]);
            let after_ok = i + wlen >= len || !is_word_char(bytes[i + wlen]);
            if before_ok && after_ok {
                result.push_str(replacement);
                i += wlen;
                continue;
            }
        }
        // Advance by full UTF-8 character
        let clen = utf8_char_len(bytes[i]);
        result.push_str(&source[i..i + clen.min(len - i)]);
        i += clen;
    }
    // Push remaining chars
    if i < len {
        result.push_str(&source[i..]);
    }

    result
}

/// Parse comma-separated arguments inside parentheses, handling nested parens.
/// `pos` should point to the first char after the opening '('.
/// Returns the args and advances `pos` past the closing ')'.
fn parse_balanced_args(source: &str, pos: &mut usize) -> Option<Vec<String>> {
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut args = Vec::new();
    let mut current = String::new();
    let mut depth = 1;

    while *pos < len && depth > 0 {
        match bytes[*pos] {
            b'(' => {
                depth += 1;
                current.push('(');
            }
            b')' => {
                depth -= 1;
                if depth > 0 {
                    current.push(')');
                }
            }
            b',' if depth == 1 => {
                args.push(current.trim().to_string());
                current = String::new();
            }
            c => {
                current.push(c as char);
            }
        }
        *pos += 1;
    }

    if depth != 0 {
        return None;
    }

    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() || !args.is_empty() {
        args.push(trimmed);
    }

    Some(args)
}

/// Build a game: preprocess main.gpc and write the output to dist/.
///
/// - `game_dir`: path to the game directory (e.g., Games/Shooter/R6S)
/// - `project_root`: path to the project root (for resolving bundled resources)
/// - `dist_base`: base directory for dist/ output (typically workspace path)
/// - `verbose`: enable verbose logging
pub fn build_game(
    game_dir: &Path,
    project_root: &Path,
    dist_base: &Path,
    verbose: bool,
) -> BuildResult {
    build_game_impl(game_dir, project_root, dist_base, verbose, None)
}

/// Build a game with plugin support from the given workspace path.
pub fn build_game_with_plugins(
    game_dir: &Path,
    project_root: &Path,
    dist_base: &Path,
    verbose: bool,
    workspace_path: &str,
) -> BuildResult {
    build_game_impl(game_dir, project_root, dist_base, verbose, Some(workspace_path))
}

fn build_game_impl(
    game_dir: &Path,
    _project_root: &Path,
    dist_base: &Path,
    verbose: bool,
    workspace_path: Option<&str>,
) -> BuildResult {
    let main_path = game_dir.join("main.gpc");

    // Resolve output filename: try game.json first, fall back to config.toml
    let output_filename = match resolve_output_filename(game_dir) {
        Ok(f) => f,
        Err(e) => {
            return BuildResult {
                output_path: String::new(),
                success: false,
                errors: vec![e],
                warnings: Vec::new(),
            };
        }
    };
    let dist_dir = dist_base.join("dist");

    // Ensure dist directory exists
    if let Err(e) = std::fs::create_dir_all(&dist_dir) {
        return BuildResult {
            output_path: String::new(),
            success: false,
            errors: vec![format!("Could not create dist directory: {}", e)],
            warnings: Vec::new(),
        };
    }

    let output_path = dist_dir.join(&output_filename);

    // Check main.gpc exists
    if !main_path.exists() {
        return BuildResult {
            output_path: output_path.to_string_lossy().to_string(),
            success: false,
            errors: vec![format!(
                "main.gpc not found at {}",
                main_path.display()
            )],
            warnings: Vec::new(),
        };
    }

    // Collect plugin hooks if workspace path is provided
    let plugin_hooks = workspace_path
        .map(crate::commands::plugins::collect_enabled_hooks)
        .unwrap_or_default();

    // Build source with plugin injections (pre_build, defines, vars, includes)
    let mut source = std::fs::read_to_string(&main_path)
        .unwrap_or_default();

    let mut plugin_prefix = String::new();
    if let Some(ref defines) = plugin_hooks.extra_defines {
        for (name, value) in defines {
            plugin_prefix.push_str(&format!("define {} = {};\n", name, value));
        }
    }
    if let Some(ref vars) = plugin_hooks.extra_vars {
        for (name, var_type) in vars {
            plugin_prefix.push_str(&format!("{} {};\n", var_type, name));
        }
    }
    if let Some(ref includes) = plugin_hooks.includes {
        for inc_path in includes {
            plugin_prefix.push_str(&format!("import {};\n", inc_path));
        }
    }
    if let Some(ref pre) = plugin_hooks.pre_build {
        plugin_prefix.push_str(pre);
        plugin_prefix.push('\n');
    }
    if !plugin_prefix.is_empty() {
        source = format!("{}\n{}", plugin_prefix, source);
    }

    // Write augmented source to a temp file for preprocessing
    let temp_main = game_dir.join(".main_build.gpc");
    if let Err(e) = std::fs::write(&temp_main, &source) {
        return BuildResult {
            output_path: output_path.to_string_lossy().to_string(),
            success: false,
            errors: vec![format!("Could not write temp build file: {}", e)],
            warnings: Vec::new(),
        };
    }

    // Run preprocessor (import expansion)
    let (processed, logs, preprocess_success) = preprocess(&temp_main, verbose);

    // Clean up temp file
    let _ = std::fs::remove_file(&temp_main);

    let mut errors: Vec<String> = logs
        .iter()
        .filter(|l| l.level == "error")
        .map(|l| l.message.clone())
        .collect();
    let warnings: Vec<String> = logs
        .iter()
        .filter(|l| l.level == "warn")
        .map(|l| l.message.clone())
        .collect();

    // Macro expansion pass
    let macro_defs = extract_macro_definitions(&processed);
    let stripped = strip_macro_definitions(&processed, &macro_defs);
    let mut macro_errors = Vec::new();
    let mut expanded = expand_macro_calls(&stripped, &macro_defs, &mut macro_errors);
    errors.extend(macro_errors);

    // Append post_build plugin code after all processing
    if let Some(ref post) = plugin_hooks.post_build {
        expanded.push('\n');
        expanded.push_str(post);
        expanded.push('\n');
    }

    // Read optional header comments from game.json
    let game_meta = {
        let meta_path = game_dir.join("game.json");
        if meta_path.exists() {
            std::fs::read_to_string(&meta_path)
                .ok()
                .and_then(|content| serde_json::from_str::<GameMeta>(&content).ok())
        } else {
            None
        }
    };
    let header_comments = game_meta.as_ref().and_then(|m| m.header_comments.clone());

    // Write output
    let mut header = "".to_string();
    if let Some(ref comments) = header_comments {
        let substituted = substitute_header_vars(comments, game_meta.as_ref());
        for line in substituted.lines() {
            header.push_str(&format!("// {}\n", line));
        }
    }
    header.push('\n');
    let final_content = format!("{}{}", header, expanded);

    if let Err(e) = std::fs::write(&output_path, &final_content) {
        errors.push(format!("Could not write output file: {}", e));
        return BuildResult {
            output_path: output_path.to_string_lossy().to_string(),
            success: false,
            errors,
            warnings,
        };
    }

    BuildResult {
        output_path: output_path.to_string_lossy().to_string(),
        success: preprocess_success && errors.is_empty(),
        errors,
        warnings,
    }
}

/// Resolve the output filename for a game build.
/// Tries game.json first (flow-based), then falls back to config.toml (legacy).
/// Substitute template variables in header comments.
/// Supports: {name}, {filename}, {version}, {game_type}, {console}, {username}
fn substitute_header_vars(template: &str, meta: Option<&GameMeta>) -> String {
    match meta {
        Some(m) => {
            let gameabbr = normalize_for_filename(&m.name);
            template
                .replace("{name}", &m.name)
                .replace("{filename}", &m.filename)
                .replace("{version}", &m.version.to_string())
                .replace("{game_type}", &m.game_type)
                .replace("{console}", &m.console_type)
                .replace("{username}", m.username.as_deref().unwrap_or(""))
                .replace("{gameabbr}", &gameabbr)
        }
        None => template.to_string(),
    }
}

fn resolve_output_filename(game_dir: &Path) -> Result<String, String> {
    let meta_path = game_dir.join("game.json");
    if meta_path.exists() {
        let content = std::fs::read_to_string(&meta_path)
            .map_err(|e| format!("Could not read game.json: {}", e))?;
        let meta: GameMeta = serde_json::from_str(&content)
            .map_err(|e| format!("Could not parse game.json: {}", e))?;
        let resolved = resolve_filename_template(&meta.filename, &meta);
        return Ok(format!("{}.gpc", resolved));
    }

    let config_path = game_dir.join("config.toml");
    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Could not read config.toml: {}", e))?;
        let config: GameConfig = toml::from_str(&content)
            .map_err(|e| format!("Could not parse config.toml: {}", e))?;
        let resolved = resolve_config_filename_template(&config.filename, &config);
        return Ok(format!("{}.gpc", resolved));
    }

    Err("No game.json or config.toml found in game directory".to_string())
}

/// Resolve template variables in a filename string using GameMeta.
/// Supports: {version}, {game}, {gameabbr}, {username}, {type}
fn resolve_filename_template(template: &str, meta: &GameMeta) -> String {
    let gameabbr = normalize_for_filename(&meta.name);
    let username = meta.username.as_deref().unwrap_or("");

    template
        .replace("{version}", &meta.version.to_string())
        .replace("{game}", &meta.name)
        .replace("{gameabbr}", &gameabbr)
        .replace("{username}", username)
        .replace("{type}", &meta.game_type)
}

/// Resolve template variables in a filename string using legacy GameConfig.
fn resolve_config_filename_template(template: &str, config: &GameConfig) -> String {
    let game_name = config.name.as_deref().unwrap_or("");
    let gameabbr = normalize_for_filename(game_name);
    let username = config.username.as_deref().unwrap_or("");

    template
        .replace("{version}", &config.version.to_string())
        .replace("{game}", game_name)
        .replace("{gameabbr}", &gameabbr)
        .replace("{username}", username)
        .replace("{type}", config.r#type.as_deref().unwrap_or("fps"))
}

fn normalize_for_filename(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_import() {
        // New syntax: import path;
        assert_eq!(parse_import("import foo;"), Some("foo.gpc".to_string()));
        assert_eq!(parse_import("import common/helper;"), Some("common/helper.gpc".to_string()));
        assert_eq!(parse_import("  import modules/core;"), Some("modules/core.gpc".to_string()));

        // New syntax: import "path";
        assert_eq!(parse_import("import \"foo.gpc\";"), Some("foo.gpc".to_string()));
        assert_eq!(parse_import("import \"common/helper\";"), Some("common/helper.gpc".to_string()));

        // Legacy syntax: #include "path"
        assert_eq!(parse_import("#include \"foo.gpc\""), Some("foo.gpc".to_string()));
        assert_eq!(parse_import("  #include \"bar.gpc\""), Some("bar.gpc".to_string()));
        assert_eq!(parse_import("#include \"../Common/helper.gpc\""), Some("../Common/helper.gpc".to_string()));

        // Negative cases
        assert_eq!(parse_import("// import foo;"), None);
        assert_eq!(parse_import("int x = 5;"), None);
        assert_eq!(parse_import("import;"), None);
        assert_eq!(parse_import("#include"), None);
    }

    #[test]
    fn test_normalize_path() {
        let p = normalize_path(Path::new("/a/b/../c/./d"));
        assert_eq!(p, PathBuf::from("/a/c/d"));
    }

    #[test]
    fn test_preprocess_simple() {
        let dir = tempfile::tempdir().unwrap();
        let main_path = dir.path().join("main.gpc");
        let helper_path = dir.path().join("helper.gpc");

        std::fs::write(&helper_path, "int helper_var;\n").unwrap();
        std::fs::write(&main_path, "import helper;\nint main_var;\n").unwrap();

        let (content, _logs, success) = preprocess(&main_path, false);
        assert!(success);
        assert!(content.contains("int helper_var;"));
        assert!(content.contains("int main_var;"));
    }

    #[test]
    fn test_preprocess_legacy_include() {
        let dir = tempfile::tempdir().unwrap();
        let main_path = dir.path().join("main.gpc");
        let helper_path = dir.path().join("helper.gpc");

        std::fs::write(&helper_path, "int helper_var;\n").unwrap();
        std::fs::write(&main_path, "#include \"helper.gpc\"\nint main_var;\n").unwrap();

        let (content, _logs, success) = preprocess(&main_path, false);
        assert!(success);
        assert!(content.contains("int helper_var;"));
        assert!(content.contains("int main_var;"));
    }

    #[test]
    fn test_preprocess_no_double_import() {
        let dir = tempfile::tempdir().unwrap();
        let main_path = dir.path().join("main.gpc");
        let shared_path = dir.path().join("shared.gpc");

        std::fs::write(&shared_path, "int shared;\n").unwrap();
        std::fs::write(
            &main_path,
            "import shared;\nimport shared;\nint main;\n",
        )
        .unwrap();

        let (content, _logs, success) = preprocess(&main_path, false);
        assert!(success);
        // "int shared;" should appear only once
        assert_eq!(content.matches("int shared;").count(), 1);
    }

    #[test]
    fn test_preprocess_commented_import_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let main_path = dir.path().join("main.gpc");

        // commented import should NOT be expanded (file doesn't even exist)
        std::fs::write(&main_path, "// import nonexistent;\nint x;\n").unwrap();

        let (content, _logs, success) = preprocess(&main_path, false);
        assert!(success);
        assert!(content.contains("// import nonexistent;"));
        assert!(content.contains("int x;"));
    }

    #[test]
    fn test_preprocess_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let main_path = dir.path().join("main.gpc");

        std::fs::write(&main_path, "import missing;\nint x;\n").unwrap();

        let (_content, _logs, success) = preprocess(&main_path, false);
        assert!(!success);
    }

    #[test]
    fn test_extract_macro_definitions() {
        let source = r#"
int x = 1;
define! myMacro(a, b) {
    set_val(a, b);
}
int y = 2;
"#;
        let macros = extract_macro_definitions(source);
        assert_eq!(macros.len(), 1);
        assert_eq!(macros[0].name, "myMacro");
        assert_eq!(macros[0].params, vec!["a", "b"]);
        assert!(macros[0].body.contains("set_val(a, b)"));
        assert!(!macros[0].has_placeholder);
    }

    #[test]
    fn test_extract_macro_with_placeholder() {
        let source = r#"
define! wrapper() {
    set_val(TRACE_1, 0x6B);
    %0
    set_val(TRACE_3, 0x39);
}
"#;
        let macros = extract_macro_definitions(source);
        assert_eq!(macros.len(), 1);
        assert_eq!(macros[0].name, "wrapper");
        assert!(macros[0].params.is_empty());
        assert!(macros[0].has_placeholder);
    }

    #[test]
    fn test_expand_macro_basic() {
        let source = "myMacro(TRACE_1, 0x49)!";
        let macros = vec![MacroDef {
            name: "myMacro".to_string(),
            params: vec!["a".to_string(), "b".to_string()],
            body: "\n    set_val(a, b);\n".to_string(),
            has_placeholder: false,
            byte_range: 0..0,
        }];
        let mut errors = Vec::new();
        let result = expand_macro_calls(source, &macros, &mut errors);
        assert!(errors.is_empty());
        assert!(result.contains("set_val(TRACE_1, 0x49)"));
    }

    #[test]
    fn test_expand_macro_with_placeholder() {
        let source = "wrapper()! { set_val(TRACE_2, 0x49); }";
        let macros = vec![MacroDef {
            name: "wrapper".to_string(),
            params: vec![],
            body: "\n    set_val(TRACE_1, 0x6B);\n    %0\n    set_val(TRACE_3, 0x39);\n"
                .to_string(),
            has_placeholder: true,
            byte_range: 0..0,
        }];
        let mut errors = Vec::new();
        let result = expand_macro_calls(source, &macros, &mut errors);
        assert!(errors.is_empty());
        assert!(result.contains("set_val(TRACE_1, 0x6B)"));
        assert!(result.contains("set_val(TRACE_2, 0x49)"));
        assert!(result.contains("set_val(TRACE_3, 0x39)"));
    }

    #[test]
    fn test_expand_macro_no_body_when_no_placeholder() {
        let source = "simple(5)!";
        let macros = vec![MacroDef {
            name: "simple".to_string(),
            params: vec!["x".to_string()],
            body: "\n    set_val(TRACE_1, x);\n".to_string(),
            has_placeholder: false,
            byte_range: 0..0,
        }];
        let mut errors = Vec::new();
        let result = expand_macro_calls(source, &macros, &mut errors);
        assert!(errors.is_empty());
        assert!(result.contains("set_val(TRACE_1, 5)"));
    }

    #[test]
    fn test_strip_macro_definitions() {
        let source = "int x = 1;\ndefine! myMacro(a) {\n    set_val(a, 0);\n}\nint y = 2;\n";
        let macros = extract_macro_definitions(source);
        let stripped = strip_macro_definitions(source, &macros);
        assert!(stripped.contains("int x = 1;"));
        assert!(stripped.contains("int y = 2;"));
        assert!(!stripped.contains("define!"));
    }

    #[test]
    fn test_full_macro_pipeline() {
        let source = r#"define! trace(val) {
    set_val(TRACE_1, val);
}

trace(0x49)!
int x = 1;
"#;
        let macros = extract_macro_definitions(source);
        let stripped = strip_macro_definitions(source, &macros);
        let mut errors = Vec::new();
        let result = expand_macro_calls(&stripped, &macros, &mut errors);
        assert!(errors.is_empty());
        assert!(result.contains("set_val(TRACE_1, 0x49)"));
        assert!(result.contains("int x = 1;"));
        assert!(!result.contains("define!"));
    }

    #[test]
    fn test_build_real_game() {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let r6s_dir = project_root.join("Games/Shooter/R6S");

        if !r6s_dir.exists() {
            eprintln!("Skipping real game build test - R6S not found");
            return;
        }

        let result = build_game(&r6s_dir, &project_root, &project_root, false);
        eprintln!("Build result: success={}, output={}", result.success, result.output_path);
        for e in &result.errors {
            eprintln!("  Error: {}", e);
        }

        assert!(result.success, "Build failed: {:?}", result.errors);
        assert!(result.output_path.contains("Mash-R6S-v2.gpc"));

        // Verify output file exists and contains expected content
        let output_content = std::fs::read_to_string(&result.output_path).unwrap();
        assert!(output_content.contains("GENERATED FILE"));
        assert!(output_content.contains("function _CoreMainMenu()"));
        assert!(output_content.contains("function _CoreSave()"));
    }
}
