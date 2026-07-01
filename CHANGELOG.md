# Change Log

All notable changes to the "gg-plugin" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

When cutting a release, move the contents of `[Unreleased]` under a new `## [x.y.z]` heading (matching the pushed git tag, without the `v` prefix) before tagging.

## [Unreleased]

### Added

- Run `.http` files against built-in or custom `gg` profiles, with RPS/duration overrides and snapshot capture
- Run `.gg.yaml` config files directly
- Live run dashboard (status, RPS chart, stage timeline, latency/error metrics) docked in a bottom panel
- Snapshot browser tree view with view/diff/assert/prune workflows
- `.gg.yaml` schema validation and Ctrl+Click navigation to referenced `.http` files
- Scaffolding commands to generate a `.gg.yaml` config or a new `.http` test file
- Auto-managed `gg` binary with status bar indicator, update checks, and manual path override
- CodeLens, editor title button, and context menu run entry points