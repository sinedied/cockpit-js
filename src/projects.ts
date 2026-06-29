// Monorepo / multi-project discovery. Given a session root, enumerate the
// projects a user can focus Cockpit on: the root itself, any declared workspace
// members (npm/yarn `workspaces` + pnpm-workspace.yaml), and other independent
// package.json directories found by a bounded subfolder scan. Detection reads
// files only (no install, no CLI), so it stays cheap and works offline.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJson, readText, existsSyncSafe } from "./util.ts";
import type { ProjectInfo } from "./types.ts";

interface PackageJson {
  name?: string;
  workspaces?: unknown;
}

// Directory names that never contain a user-selectable project (build output,
// vendored deps, VCS, caches, and conventional example/fixture trees).
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "output",
  "coverage",
  ".next",
  ".nuxt",
  ".astro",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".vercel",
  ".netlify",
  ".output",
  "tmp",
  "temp",
  "vendor",
  "examples",
  "example",
  "fixtures",
  "fixture",
  "__fixtures__",
  "__mocks__",
  "__snapshots__",
]);

// How deep the standalone-package scan walks below the session root.
const SCAN_DEPTH = 2;

const OTHER_GROUP = "Other projects";

function pkgName(pkg: PackageJson | null, dir: string): string {
  return (typeof pkg?.name === "string" && pkg.name.trim()) || path.basename(dir);
}

function isWorkspaceRootPkg(dir: string, pkg: PackageJson | null): boolean {
  return (
    Boolean(pkg?.workspaces) ||
    existsSyncSafe(path.join(dir, "pnpm-workspace.yaml")) ||
    existsSyncSafe(path.join(dir, "rush.json"))
  );
}

// Strip JSON-with-comments (// line and /* block */) so JSONC configs like
// rush.json parse with JSON.parse. Quote-aware so a comment marker inside a
// string isn't stripped.
function stripJsonComments(text: string): string {
  let out = "";
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += n;
        i++;
      } else if (c === '"') quote = false;
      continue;
    }
    if (c === '"') {
      quote = true;
      out += c;
    } else if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return out;
}

// Rush lists members explicitly in rush.json `projects: [{ projectFolder }]`,
// independent of any npm/pnpm `workspaces` field. Read those folders.
async function rushMembers(root: string): Promise<string[]> {
  const file = path.join(root, "rush.json");
  if (!existsSyncSafe(file)) return [];
  const text = await readText(file);
  if (!text) return [];
  try {
    const parsed = JSON.parse(stripJsonComments(text)) as {
      projects?: { projectFolder?: string }[];
    };
    const out: string[] = [];
    for (const p of Array.isArray(parsed.projects) ? parsed.projects : []) {
      if (typeof p?.projectFolder === "string") out.push(path.resolve(root, p.projectFolder));
    }
    return out;
  } catch {
    return [];
  }
}

// Collect the workspace member glob patterns from package.json `workspaces`
// (array form or `{ packages: [...] }`) and from pnpm-workspace.yaml.
async function workspacePatterns(dir: string, pkg: PackageJson | null): Promise<string[]> {
  const out: string[] = [];
  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) {
    for (const p of ws) if (typeof p === "string") out.push(p);
  } else if (ws && typeof ws === "object") {
    const pkgs = (ws as { packages?: unknown }).packages;
    if (Array.isArray(pkgs)) for (const p of pkgs) if (typeof p === "string") out.push(p);
  }
  const yamlPath = path.join(dir, "pnpm-workspace.yaml");
  if (existsSyncSafe(yamlPath)) {
    const yaml = await readText(yamlPath);
    if (yaml) out.push(...parsePnpmPackages(yaml));
  }
  return out;
}

// Strip a YAML line comment, honouring quotes so a `#` inside a quoted glob
// (e.g. "packages/#internal") isn't truncated.
function stripYamlComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

// Parse a YAML flow sequence (`["a", "b"]`) into its string items.
function parseFlowSeq(s: string): string[] {
  const inner = s.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  return inner
    .split(",")
    .map((p) => unquote(p))
    .filter((p) => p.length > 0);
}

// Minimal pnpm-workspace.yaml reader: pull the string entries under the
// top-level `packages:` key, supporting both the block-list form and the inline
// flow-array form. We only need the glob strings, so a dependency-free scan is
// enough (avoids pulling in a YAML lib).
function parsePnpmPackages(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const out: string[] = [];
  let inPackages = false;
  for (const raw of lines) {
    const line = stripYamlComment(raw);
    const head = /^packages\s*:(.*)$/.exec(line);
    if (head) {
      const inline = head[1].trim();
      if (inline.startsWith("[")) {
        out.push(...parseFlowSeq(inline));
        inPackages = false;
      } else {
        inPackages = true;
      }
      continue;
    }
    if (inPackages) {
      const m = /^\s*-\s*(.+?)\s*$/.exec(line);
      if (m) {
        out.push(unquote(m[1]));
        continue;
      }
      // A non-list, non-blank line at indent 0 ends the packages block.
      if (line.trim() && !/^\s/.test(line)) inPackages = false;
    }
  }
  return out;
}

// True when `dir` is the root itself or a descendant of it. Rejects `..`-escaping
// workspace globs (e.g. "../sibling") that would anchor Cockpit outside the
// host session root.
function within(root: string, dir: string): boolean {
  const rel = path.relative(root, dir);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function relPosix(root: string, dir: string): string {
  return path.relative(root, dir).split(path.sep).join("/");
}

// Compile a workspace glob (POSIX-style, relative to root) to an anchored
// RegExp. Supports `**` (any descendants), `*` (one path segment) and `?`.
function globToRegExp(glob: string): RegExp {
  const norm = glob.replace(/\\/g, "/").replace(/\/+$/, "");
  let re = "";
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    if (c === "*") {
      if (norm[i + 1] === "*") {
        re += ".*";
        i++;
        if (norm[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$+.()|{}[]".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

// Resolve one workspace glob pattern to concrete directories. Supports the
// shapes that appear in real configs: explicit paths (`apps/web`), a single
// trailing wildcard (`packages/*`), a bare `*`, and `**` ("any descendant with
// a package.json"). Negations (`!…`) are skipped conservatively.
async function resolvePattern(root: string, pattern: string): Promise<string[]> {
  const pat = pattern.replace(/\/+$/, "");
  if (!pat || pat.startsWith("!")) return [];

  if (pat.includes("**")) {
    const base = pat.split("**")[0].replace(/\/+$/, "");
    const start = base ? path.join(root, base) : root;
    return scanForPackages(start, SCAN_DEPTH);
  }

  const star = pat.indexOf("*");
  if (star === -1) {
    const dir = path.join(root, pat);
    return existsSyncSafe(path.join(dir, "package.json")) ? [dir] : [];
  }

  // Single wildcard segment: expand the directory just before the `*`.
  const prefix = pat.slice(0, star).replace(/\/+$/, "");
  const parent = prefix ? path.join(root, prefix) : root;
  const entries = await safeReaddir(parent);
  const dirs: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
    const dir = path.join(parent, e.name);
    if (existsSyncSafe(path.join(dir, "package.json"))) dirs.push(dir);
  }
  return dirs;
}

async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Walk subdirectories (up to `depth` levels) collecting every directory that
// holds a package.json, skipping noise directories. Used both for the
// standalone-package scan and for `**` workspace patterns.
async function scanForPackages(start: string, depth: number): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, left: number): Promise<void> {
    if (left < 0) return;
    const entries = await safeReaddir(dir);
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const child = path.join(dir, e.name);
      if (existsSyncSafe(path.join(child, "package.json"))) found.push(child);
      await walk(child, left - 1);
    }
  }
  await walk(start, depth - 1);
  return found;
}

// Enumerate the selectable projects under `root`, ordered for the selector menu:
// the root first, then its workspace members (grouped under the root's name),
// then any standalone scanned packages (grouped under "Other projects").
export async function enumerateProjects(root: string): Promise<ProjectInfo[]> {
  const rootPkg = await readJson<PackageJson>(path.join(root, "package.json"));
  const rootName = pkgName(rootPkg, root);
  const seen = new Set<string>([root]);
  const out: ProjectInfo[] = [];

  // The root is always selectable (when it is itself a project).
  if (rootPkg) {
    out.push({
      dir: root,
      rel: ".",
      name: rootName,
      group: rootName,
      isWorkspaceRoot: isWorkspaceRootPkg(root, rootPkg),
    });
  }

  // Declared workspace members, grouped under the root's name. Negation patterns
  // (`!…`) are collected and applied as exclusions; everything stays under root.
  const patterns = await workspacePatterns(root, rootPkg);
  const positives = patterns.filter((p) => !p.startsWith("!"));
  const excludes = patterns
    .filter((p) => p.startsWith("!"))
    .map((p) => globToRegExp(p.slice(1).replace(/\/+$/, "")));
  const isExcluded = (dir: string): boolean => {
    const rel = relPosix(root, dir);
    return excludes.some((re) => re.test(rel));
  };
  const members: string[] = [];
  for (const pat of positives) {
    for (const dir of await resolvePattern(root, pat)) {
      if (!seen.has(dir) && within(root, dir) && !isExcluded(dir)) {
        seen.add(dir);
        members.push(dir);
      }
    }
  }
  for (const dir of await rushMembers(root)) {
    if (
      !seen.has(dir) &&
      within(root, dir) &&
      !isExcluded(dir) &&
      existsSyncSafe(path.join(dir, "package.json"))
    ) {
      seen.add(dir);
      members.push(dir);
    }
  }
  members.sort();
  for (const dir of members) {
    const pkg = await readJson<PackageJson>(path.join(dir, "package.json"));
    out.push({
      dir,
      rel: path.relative(root, dir) || ".",
      name: pkgName(pkg, dir),
      group: rootName,
      isWorkspaceRoot: isWorkspaceRootPkg(dir, pkg),
    });
  }

  // Standalone packages found by scanning, that aren't already workspace members
  // and aren't explicitly excluded. When the root is itself a project they go
  // under "Other projects"; when the root is just a container (no package.json)
  // they head up under its name.
  const scannedGroup = rootPkg ? OTHER_GROUP : rootName;
  const scanned = (await scanForPackages(root, SCAN_DEPTH))
    .filter((d) => !seen.has(d) && within(root, d) && !isExcluded(d))
    .sort();
  for (const dir of scanned) {
    seen.add(dir);
    const pkg = await readJson<PackageJson>(path.join(dir, "package.json"));
    out.push({
      dir,
      rel: path.relative(root, dir) || ".",
      name: pkgName(pkg, dir),
      group: scannedGroup,
      isWorkspaceRoot: isWorkspaceRootPkg(dir, pkg),
    });
  }

  return out;
}
