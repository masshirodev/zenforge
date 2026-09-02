# Zen Forge — Feature Roadmap

## Deferred (Requires GPC Runtime)

These features require executing GPC code outside Cronus Zen hardware. Since we cannot build a GPC compiler/interpreter, these are parked for now. Revisit if a runtime becomes available.

- [ ] **Script Debugger** — Step-through execution with breakpoints, variable watch, call stack. Needs a GPC interpreter to trace execution.
- [ ] **Input Replay** — Record controller input sequences, replay against a script to test behavior. Needs a GPC runtime to simulate script reactions.
- [ ] **Performance Profiler** — Timing analysis of main loop iterations, combo execution cycles. Needs a GPC runtime to measure execution.
- [ ] **Unit Test Framework** — Define input/output test cases, validate against script behavior. Needs a GPC runtime to execute scripts.

## Deferred

- [ ] Add actual url to Swizzy's IDE. We won't know until it's finished. Remember to unhide (hide -> flex) the button on the build page.

## Future Ideas (Not Yet Planned)

- [ ] **Module Marketplace** — Community module browser. Publish/download modules from a curated source (GitHub repo or API). In-app browsing, install, and update.
- [ ] **Script Sharing** — One-click export of scripts/modules/combos as shareable files or links that others can import.
- [ ] **Config Profiles** — Per-game profiles (e.g., "aggressive", "stealth") that swap modules, recoil tables, and settings in one click. Extends existing profile-aware flow system to full config.

--- 

- [ ] Write tests.

- [ ] GPC variable data types — Swizzy noted GPC only has one variable type (data types are only for const arrays); may need to audit any type annotations in generated code

- [ ] Device Monitor-like UI for input/output visualization. The one we have on ZenStudio.
- [ ] Controller support for the emulator.

- [ ] Move Git tab to a tool, lets make the git repo workspace wise and not script wise


# Commit message so far

- Delete key now deletes subnodes
- Group label renders at top of subnode list
- Node snap-to-alignment guides
- Node/Subnode copy paste
- VariableSelect uses module label instead of names now
- Auto Run module remake
- Combo simulator stick visualization
- Git is now per workspace
- Minor changes