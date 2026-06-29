<!-- prettier-ignore -->
<div align="center">

<img src="./docs/images/logo.png" alt="Cockpit.js logo" width="180" />

# Cockpit.js

**Your JavaScript / Node.js / web project cockpit for the GitHub Copilot app.**

[![Build status](https://img.shields.io/github/actions/workflow/status/sinedied/cockpit-js/ci.yml?branch=main&style=flat-square)](https://github.com/sinedied/cockpit-js/actions/workflows/ci.yml)
![Node.js version](https://img.shields.io/badge/Node.js->=22.18-3c873a?style=flat-square&logo=node.js&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](./LICENSE)
![GitHub Copilot canvas extension](https://img.shields.io/badge/GitHub%20Copilot-canvas%20extension-8957e5?style=flat-square&logo=githubcopilot&logoColor=white)

⭐ If you find this project useful, star it on GitHub — it helps a lot!

[Features](#features) • [Supported tooling](#supported-tooling) • [Install](#install) • [Usage](#usage) • [How it works](#how-it-works) • [Development](#development)

</div>

Cockpit.js is a [GitHub Copilot **canvas** extension](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions)
that puts your project's entire inner loop in the Copilot side panel: run scripts,
build, lint, format, type-check and test; start the dev server and preview the app;
debug with breakpoints; and keep dependencies current **without breaking the build**.
Any failure can be handed straight to the agent with one click — **Fix with Copilot**.

It is **zero-config**: Cockpit.js auto-detects your package manager, scripts, framework,
test runner, linter, formatter and TypeScript setup, and degrades gracefully when a
capability is missing — there is nothing to wire up.

> [!TIP]
> Everything the UI does is also exposed as Copilot **agent actions**, so you can ask
> Copilot to "build the app", "run the tests", or "safely update all minor dependencies"
> and it drives the exact same operations.

## Features

- **Zero-config detection & status** — package manager, framework, test runner, linter,
  formatter, TypeScript and workspaces are detected automatically and shown in the header,
  with a one-click **Refresh**.
- **Multi-project / monorepo selector** — npm/yarn/pnpm workspaces and standalone
  packages are discovered and switchable from a header dropdown; each project gets its
  own detection, lanes and settings.
- **Console lanes** — every `package.json` script as a button, plus first-class
  **Build / Lint / Format / Type-check** lanes with streamed output, error parsing and a
  one-click **Fix with Copilot** on failure.
- **Live Problems panel** — an always-on, project-wide diagnostics view that merges your
  project's **TypeScript language server** (`tsserver`) **and linter** (Biome / ESLint /
  oxlint) findings, grouped by file, refreshed automatically as files change — each with a
  **Fix with Copilot** action (and a Fix-all).
- **Structured Tests** — runs **Vitest / Jest / `node:test` / Bun** and renders a
  pass/fail report (summary chips, per-suite grouping, expandable stack traces), with an
  optional **native watch mode**.
- **Dev server & live Preview** — start/stop the dev server, auto-detect the served URL,
  and **preview the app embedded** in the panel. Because the preview is proxied
  same-origin, you can capture a screenshot of just your app, draw a region, and send it
  to Copilot with a prompt — **Fix with Copilot**, visually.
- **Safe dependency management** — outdated packages and a security audit in one tab, with
  a **safe-update loop** that verifies every change (build + lint + test) and
  **automatically rolls back** anything that breaks the app. Security fixes try
  `audit fix` first, then escalate only what remains to Copilot.
- **Node.js debugger** — set breakpoints, step, inspect the stack, scopes and variables,
  and evaluate expressions, driven over the Chrome DevTools Protocol with zero
  dependencies. Fully exposed as agent actions for agentic step-through debugging.
- **Microsoft Rayfin dashboard** — when a [Rayfin](https://github.com/microsoft/rayfin)
  project is detected, an offline dashboard shows config, deployments and the data model
  (list **+** graph view) and runs allow-listed `rayfin` CLI commands.
- **Customizable & themed** — a Settings panel lets you reorder/hide tabs, toggle on-load
  auto-runs, and pick an Auto / Light / Dark theme (GitHub Primer styling). Preferences
  persist per project.
- **Self-updating** — Cockpit.js checks GitHub Releases for newer versions and offers a
  one-click, Copilot-assisted update.
- **Fix with Copilot, everywhere** — every lane failure, diagnostic, failed test, vulnerable
  dependency or preview glitch can push a context-rich prompt (command, exit code, parsed
  errors, file paths, screenshot) straight into the chat.

## Supported tooling

| Capability       | Detected from                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Package manager  | `bun.lockb` · `pnpm-lock.yaml` · `yarn.lock` · `package-lock.json` · `packageManager` field (default `npm`) |
| Framework / dev  | Vite · Next.js · Nuxt · Astro · SvelteKit · Remix (config + dependency)                                      |
| TypeScript       | `tsconfig.json` / `typescript` dependency                                                                    |
| Test runner      | Vitest · Jest · `node:test` · Bun                                                                            |
| Linter / format  | Biome · ESLint · oxlint · Prettier                                                                           |
| Monorepo         | npm / yarn / pnpm `workspaces` · standalone packages                                                         |

Missing a capability simply hides the matching lane or tab — there is nothing to configure.

## Install

> [!IMPORTANT]
> Cockpit.js requires **Node.js ≥ 22.18** — the backend runs TypeScript directly via
> native type-stripping, with no build step.

### Try it on this repo (dog-food)

This repository dog-foods itself through a tiny wrapper at
`.github/extensions/cockpit/extension.mjs`. Open the repo in the GitHub Copilot app and
the **Cockpit.js** canvas becomes available — open it from the canvas catalog or ask
Copilot to "open Cockpit.js".

```sh
git clone https://github.com/sinedied/cockpit-js
# open the folder in the GitHub Copilot app, then open the Cockpit.js canvas
```

### Use it in another project

Copy the extension into the target project under `.github/extensions/cockpit/` (the root
`extension.mjs`, `src/`, `public/` and `copilot-extension.json`), or install it through
the Copilot app's "install extension" flow. The canvas then drives that project's inner
loop.

There is **no bundler and no runtime dependencies**: the TypeScript backend runs directly
on Node ≥ 22.18 and the UI is plain HTML/CSS/JS.

## Usage

### In the canvas

Open the **Cockpit.js** canvas in the side panel. The header shows the detected setup (and
a project selector in monorepos); the tabs cover the whole inner loop:

- **Info** — project overview: stack, platform, and dependency/size metrics.
- **Preview** — dev server controls + embedded app preview with visual Fix-with-Copilot.
- **Rayfin** — Microsoft Rayfin dashboard (shown only for Rayfin projects).
- **Tests** — structured test report with optional native watch.
- **Problems** — live TypeScript + linter diagnostics.
- **Dependencies** — outdated updates + security audit with safe, verified updates.
- **Debugger** — Node.js breakpoints, stepping and inspection.
- **Console** — scripts and the Build / Lint / Format / Type-check lanes.

A gear icon opens **Settings** to reorder/hide tabs, toggle on-load auto-runs, and switch
theme. Every failing run offers **Fix with Copilot**.

### From the agent

Copilot can drive the same operations through canvas actions, e.g. _"build the app"_,
_"run the tests"_, _"start the dev server"_, _"safely update all minor dependencies"_, or
_"set a breakpoint and step into the failing function"_. Available actions:

- **Status & project** — `get_status` · `get_project_info` · `refresh` · `fix_issue`
- **Scripts & lanes** — `run_script` · `build_app` · `lint` · `format` · `typecheck` · `run_tests`
- **Diagnostics** — `get_diagnostics`
- **Dev server** — `start_dev` · `stop_dev` · `get_dev_url` · `get_logs`
- **Dependencies** — `list_outdated` · `audit` · `update_dependencies` · `rollback_last_update`
- **Debugger** — `debug_start` · `debug_attach` · `debug_stop` · `debug_set_breakpoint` ·
  `debug_remove_breakpoint` · `debug_list_breakpoints` · `debug_continue` · `debug_pause` ·
  `debug_step_over` · `debug_step_into` · `debug_step_out` · `debug_wait_for_pause` ·
  `debug_get_stack` · `debug_get_variables` · `debug_get_properties` · `debug_evaluate` ·
  `debug_get_state`
- **Rayfin** — `rayfin_new_project`

### Safe dependency updates

`update_dependencies` (or the **Dependencies** tab) takes a scope (`patch` / `minor` /
`major`) or an explicit package list. For each batch it snapshots `package.json` and the
lockfile, applies the updates, runs the **verify suite** (build + lint + test by default),
keeps the change if everything is green, and **rolls back** anything that breaks —
isolating the culprit so the rest of the updates still land. `rollback_last_update`
restores the state from just before the last update.

Security fixes follow an **`audit fix`-first** strategy: when the package manager supports
it, Cockpit.js runs a semver-safe `audit fix` (never `--force`), verifies it, rolls back on
breakage, and only escalates the **remaining** advisories to Copilot.

### Keeping Cockpit.js up to date

Cockpit.js periodically checks GitHub Releases for a newer version. When one is available,
an update indicator appears in **Settings → About**; clicking **Update Cockpit.js** hands
Copilot a ready-made prompt to fetch and apply the update.

## How it works

Cockpit.js follows the canvas-extension model: a per-instance loopback HTTP server (bound
to `127.0.0.1` on an ephemeral port) serves the UI and exposes JSON action endpoints plus a
Server-Sent-Events stream for live console / test / status updates. A single in-process
`Controller` is the source of truth shared by both the UI and the agent actions, so they
always drive the exact same operations.

```text
extension.mjs            thin entry (required filename) → imports src/extension.ts
src/
  extension.ts           canvas declaration + per-instance server wiring (the only SDK importer)
  types.ts               shared domain types
  detect.ts              package manager / scripts / framework / TS / runners
  projects.ts            monorepo / multi-project discovery
  pm.ts                  package-manager command abstraction
  process-runner.ts      cross-platform spawn (one-shot + long-lived)
  lanes.ts               build / lint / format / type-check / dev / test commands
  test-report.ts         parse Vitest / Jest / node:test / Bun output
  deps.ts                outdated / audit + safe-update loop + rollback
  info.ts                lazy Info-tab metrics (transitive deps + sizes)
  ts-server.ts           SDK-free tsserver client (live diagnostics)
  lint-report.ts         linter JSON → diagnostics (merged into Problems)
  cdp.ts / debug.ts      zero-dep Chrome DevTools Protocol client + debug session
  rayfin.ts              Microsoft Rayfin detection + offline dashboard state
  update.ts              SDK-free self-update check (GitHub Releases)
  controller.ts          central state + orchestration (+ SSE events)
  server.ts              http + SSE + static + /api endpoints
  actions.ts             agent-callable canvas actions
  fix.ts                 "Fix with Copilot" prompt builders
  settings.ts            per-project tabs / theme / auto-run persistence
public/                  index.html · app.js · style.css (Primer-styled vanilla UI)
docs/site/               Astro + Starlight docs site (dogfoods the Dev / web Build lanes)
test/                    Vitest specs · scripts/smoke.mjs (type-stripping load)
.github/workflows/       ci.yml (lint → build → smoke → test) · release.yml (semantic-release)
```

The backend is **TypeScript with no build step** — Node ≥ 22.18 runs the `.ts` sources
directly via native type-stripping, so there is nothing to compile or bundle at load.
Everything in `src/` is SDK-free and independently runnable with plain Node; only
`src/extension.ts` imports the Copilot SDK. Settings persist per project in
`~/.cockpit/settings.json` (not in your repository, and not in iframe `localStorage`,
which is unreliable here because each canvas open gets a fresh loopback port).

## Development

Requires **Node.js ≥ 22.18** (for native TypeScript type-stripping).

```sh
npm install
npm run check          # everything CI runs: biome (lint + format) + build + smoke + test

npm run build          # tsc type-check (Node + browser configs); alias: npm run typecheck
npm run smoke          # load every SDK-free module via native type-stripping
npm test               # Vitest unit tests (npm run test:watch / npm run coverage)
npm run lint           # Biome lint (npm run lint:fix to autofix)
npm run format         # format with Biome (npm run format:check to verify)
```

This repo also dogfoods Cockpit's **Dev** and web **Build** lanes with an Astro + Starlight
docs site under `docs/site/`: `npm run dev` starts it (auto-detected, served at
`http://localhost:4321/`) and `npm run docs:build` builds it.

After editing the extension, reload it in the Copilot app (the runtime rediscovers
`.github/extensions/`) to pick up changes.

## Known limitations

- State is in-memory and single-lane (one build lane + one dev server at a time); it resets
  on extension reload.
- The structured test report covers the known runners (Vitest / Jest / `node:test` / Bun);
  other runners fall back to raw output.
- Outdated/audit JSON is parsed reliably for npm and pnpm; yarn / bun degrade to a
  best-effort summary.
- The **Problems panel reflects saved files**, not unsaved editor buffers — the canvas is
  not an editor, so diagnostics analyze what's on disk.
- **Theme** follows your OS appearance (`prefers-color-scheme`), repainted with GitHub Primer
  colors, plus a manual Auto / Light / Dark toggle — the host does not expose its own in-app
  theme to canvas extensions.
- The embedded preview proxy targets standard HTTP dev servers; servers that hard-code an
  absolute origin or use exotic auth may not round-trip (the URL bar and open-external still
  work).

## Roadmap

Run-affected-tests, bundle-size analysis, coverage view, Node process metrics, env/engine
doctors, Lighthouse audit, richer embedded preview, semantic code navigation, monorepo
orchestration and codemod runners. See [`PLAN.md`](./PLAN.md) for the full design and
roadmap.

## Related projects

- [coffilot](https://github.com/jdubois/coffilot) — the Java equivalent that inspired
  Cockpit.js, reimagined here for the JavaScript / Node / web ecosystem and agentic-first
  development.

## License

[MIT](./LICENSE) © Yohan Lasorsa
