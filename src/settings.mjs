// Per-project UI settings (pinned scripts + theme preference), persisted to
// ~/.node-pilot/settings.json. We persist server-side rather than in the iframe's
// localStorage because the loopback server gets a fresh ephemeral port on every
// canvas open, which changes the page origin and wipes localStorage.
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const DIR = path.join(os.homedir(), ".node-pilot");
const FILE = path.join(DIR, "settings.json");

const DEFAULTS = { pinnedScripts: null, theme: "auto" };

// Scripts already represented by a dedicated lane or tab, excluded from the
// auto-pin default so the toolbar isn't redundant.
const COVERED = new Set([
  "build",
  "lint",
  "format",
  "format:check",
  "typecheck",
  "type-check",
  "tsc",
  "check-types",
  "test",
  "dev",
  "start",
  "serve",
]);

export function defaultPinnedScripts(detection, cap = 6) {
  const names = detection?.scriptNames || [];
  return names.filter((n) => !COVERED.has(n)).slice(0, cap);
}

async function readAll() {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) || {};
  } catch {
    return {};
  }
}

async function writeAll(obj) {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(obj, null, 2));
}

export async function loadSettings(projectKey) {
  const all = await readAll();
  return { ...DEFAULTS, ...(all[projectKey] || {}) };
}

export async function saveSettings(projectKey, patch) {
  const all = await readAll();
  const next = { ...DEFAULTS, ...(all[projectKey] || {}), ...patch };
  all[projectKey] = next;
  await writeAll(all);
  return next;
}
