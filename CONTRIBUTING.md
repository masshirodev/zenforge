# Contributing to Zen Forge

Thanks for your interest in contributing to Zen Forge! This document covers how to get started.

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Run the dev server: `npm run dev` (frontend only) or `npm run tauri dev` (full app)

## Development

```bash
npm run dev          # Frontend dev server
npm run build        # Production build
npm run check        # Type checking
npm run lint         # Prettier + ESLint check
npm run format       # Auto-format
npm run test:unit    # Unit tests
```

For the Rust backend:

```bash
cd src-tauri && cargo check   # Type check
cd src-tauri && cargo build   # Build
```

## Code Style

- **TypeScript/Svelte**: Tabs, single quotes, no trailing commas, 100 char line width
- **Rust**: Standard rustfmt (4 spaces)
- Run `npm run format` before committing

## Helping with Translations (i18n)

Zen Forge uses [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs) for internationalization. We currently support **English** and **Brazilian Portuguese**, but welcome contributions for new languages and improvements to existing translations.

### Adding a new language

1. Open `project.inlang/settings.json` and add your locale code to the `locales` array:
   ```json
   "locales": ["en", "pt-br", "your-locale"]
   ```
2. Create a new message file at `messages/{your-locale}.json` by copying `messages/en.json` as a starting point
3. Translate all values (keys must stay the same)
4. Run the dev server (`npm run dev`) to compile the new messages

### Improving existing translations

Edit the relevant file in `messages/` directly. The English source of truth is `messages/en.json`.

### Message format

Keys are flat and prefixed by feature area (`common_`, `settings_`, `sidebar_`, `flow_`, etc.). Parameters use `{paramName}` syntax:

```json
{
  "feature_key": "Translated text",
  "feature_key_with_param": "Hello {name}!"
}
```

### Guidelines

- Keep translations concise — UI space is limited
- Preserve all `{paramName}` placeholders exactly as they appear in the English source
- Keep the `$schema` line at the top of the file unchanged
- Test your changes by running the app and switching languages

## Submitting Changes

1. Create a branch for your changes
2. Make sure `npm run check` and `npm run lint` pass
3. Open a pull request with a clear description of what you changed
