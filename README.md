# Gopher-Glide for VS Code

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/gopherglide.gg-plugin?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=gopherglide.gg-plugin)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/gopherglide.gg-plugin)](https://marketplace.visualstudio.com/items?itemName=gopherglide.gg-plugin)
[![Open VSX Version](https://img.shields.io/open-vsx/v/gopherglide/gg-plugin?label=Open%20VSX)](https://open-vsx.org/extension/gopherglide/gg-plugin)
[![CI](https://github.com/shyam-s00/gg-vscode-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/shyam-s00/gg-vscode-plugin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Gopher Glide (`gg`)** is a modern, zero-scripting API traffic simulation and performance benchmarking CLI built in Go — a lightweight alternative to tools like k6, Gatling, or Locust that runs straight from standard `.http` files. No agents, no servers to stand up, no boilerplate code.

This extension brings `gg`'s traffic-simulation workflow directly into VS Code:

- **One-click runs** — execute a traffic simulation, or scaffold a new run config, straight from any `.http` file or `.gg.yaml` config via CodeLens, the editor title bar, or the right-click menu, with a built-in profile picker (smoke, load, stress, soak, spike, and 16 more) for zero-config runs.
- **Native run dashboard** — a dedicated Gopher-Glide panel shows a live stage timeline, RPS chart, error rate, and latency percentiles while a simulation runs — no terminal TUI involved.
- **Native snapshot workflow** — browse, view, and diff `gg`'s semantic JSON snapshots (latency, status distribution, inferred response schemas), run `gg snap assert` to gate regressions, and prune old snapshots by ID, tag, or age — entirely inside the panel, no terminal involved.
- **Schema-validated config** — JSON Schema completion and validation for `.gg.yaml` files, covering stages, snapshot tuning, and built-in profiles.
- **Zero manual setup** — the extension downloads and manages the `gg` binary for you, with update checks and diagnostics built into Settings → Gopher-Glide.

Learn more and read the full docs at [gopherglide.dev](https://gopherglide.dev).

## Features

- **Run `.http` files against a profile** — pick from 21 built-in profiles (flash-sale, soak, chaos, ddos, etc.) or a custom one, with RPS/duration overrides and optional snapshot capture.
- **Run `.gg.yaml` config files directly** — the config is the single source of truth, no profile picker needed.
- **Live run dashboard** — status, elapsed time, target/actual RPS, error rate, latency percentiles (p50/p95/p99), an RPS chart, and a stage timeline, updated in real time from `gg`'s headless heartbeat stream.
- **Snapshot workflows** — browse captured snapshots in a tree view, then view endpoint detail, diff two snapshots, run `gg snap assert` as a CI-style gate, or prune old snapshots.
- **`.gg.yaml` language support** — schema-driven autocomplete/validation, plus Ctrl+Click navigation from `httpFile:` to the referenced `.http` file.
- **Scaffolding** — generate a `.gg.yaml` config next to an existing `.http` file, or create a new `.http` test file pre-filled with the profile list.
- **Auto-managed `gg` binary** — detects, downloads, and updates the `gg` CLI for you, with a status bar indicator and manual override via `gg.binaryPath`.
- CodeLens, editor title button, and right-click context menu entry points on `.http`/`.rest`/`.gg.yaml` files.

## Requirements

This extension drives the [`gg` CLI](https://github.com/shyam-s00/gopher-glide). By default it downloads and manages the right binary for your platform automatically on first use — no manual install needed. See [gopherglide.dev](https://gopherglide.dev) for CLI documentation and `.http`/`.gg.yaml` file format details.

## Extension Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `gg.binaryPath` | string | `""` | Absolute path to the `gg` binary. Leave empty to use the auto-managed binary (or `$PATH`). |
| `gg.autoUpdateCheck` | boolean | `true` | Automatically check for a newer `gg` CLI version on activation. |
| `gg.installationMode` | string | `"auto"` | `auto` downloads/updates automatically, `manual` prompts first, `pathOnly` never downloads. |
| `gg.defaultProfile` | string | `""` | Profile to pre-select in the Quick Pick (e.g. `flash-sale`). Leave empty to always prompt. |
| `gg.snapshotsDir` | string | `""` | Override directory for snapshot storage (`--snap-dir`). Leave empty for `gg`'s platform default. |
| `gg.heartbeatIntervalSeconds` | number | `0` | Heartbeat cadence for headless runs (`--heartbeat-interval`). `0` uses `gg`'s own default (5s). |

## Commands

| Command | Title |
|---|---|
| `gg.run` | Run |
| `gg.runConfig` | Run (Config) |
| `gg.copyCommand` | Copy Command |
| `gg.generateConfig` | Generate Config |
| `gg.newHttpTest` | New HTTP Test File |
| `gg.refreshSnaps` | Refresh Snapshots |
| `gg.viewSnap` | View Snapshot |
| `gg.diffSnaps` | Diff Snapshots |
| `gg.assertSnaps` | Assert Snapshots |
| `gg.pruneSnaps` | Prune Snapshots |
| `gg.selectBinaryPath` | Select Binary Path |
| `gg.checkForUpdates` | Check for Updates / Install |
| `gg.openSettings` | Open Settings |

All commands are grouped under the `gg` category in the Command Palette.

## Known Issues

None currently tracked. Please [open an issue](https://github.com/shyam-s00/gg-vscode-plugin/issues) if you run into one.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

## License

[MIT](LICENSE)
