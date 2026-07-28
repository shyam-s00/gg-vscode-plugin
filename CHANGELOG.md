# Change Log

## [2.0.0] - 2026-07-27

### Added

- Run `.http` files against built-in or custom `gg` profiles, with RPS/duration overrides and snapshot capture
- Run `.gg.yaml` config files directly
- Live run dashboard (status, RPS chart, stage timeline, latency/error metrics) docked in a bottom panel
- Snapshot browser tree view with view/diff/assert/prune workflows
- `.gg.yaml` schema validation and Ctrl+Click navigation to referenced `.http` files
- Scaffolding commands to generate a `.gg.yaml` config or a new `.http` test file
- Auto-managed `gg` binary with status bar indicator, update checks, and manual path override
- CodeLens, editor title button, and context menu run entry points

### Changed

- Redesigned the snapshot view and diff panels with a new split-pane layout: a resizable, sortable endpoint table on the left and a detail pane on the right with an expandable inferred-schema tree and status-code distribution charts. Added per-column visibility toggles and endpoint search/filtering.
- Reorganized the webview panel codebase internally to separate view markup, styles, and client-side logic from panel logic (no additional user-facing change)