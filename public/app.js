// Node Pilot UI controller. Talks to the per-instance loopback server over a
// small JSON API and an SSE event stream, and keeps the DOM in sync with the
// shared controller state.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s) => (s || "").replace(ANSI, "");

const state = {
  detection: null,
  lanes: {},
  test: { report: null },
  dev: { status: "stopped", url: null, output: "" },
  deps: { outdated: null, audit: null, update: null },
  settings: { theme: "auto", pinnedScripts: [] },
};

let activeConsoleLane = null;
const CONSOLE_LANES = new Set(["build", "lint", "format", "typecheck"]);
const isConsoleLane = (id) => CONSOLE_LANES.has(id) || id.startsWith("script:");

// ---- API ------------------------------------------------------------------

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

// ---- Theme ----------------------------------------------------------------
// The host doesn't expose its in-app theme, so we follow the OS appearance
// (prefers-color-scheme) by default and let the user force light/dark. The
// choice is persisted server-side and applied via a data-theme override.

const THEME_NEXT = { auto: "light", light: "dark", dark: "auto" };
const THEME_ICON = { auto: "device-desktop", light: "sun", dark: "moon" };

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  const btn = $("#theme-toggle");
  btn.querySelector("use").setAttribute("href", `#oct-${THEME_ICON[theme] || "device-desktop"}`);
  btn.title = `Theme: ${theme}`;
}

// ---- Tabs -----------------------------------------------------------------

function showTab(name) {
  for (const b of $$(".tabs button")) b.classList.toggle("active", b.dataset.tab === name);
  for (const p of $$(".tab-panel")) p.classList.toggle("active", p.id === `tab-${name}`);
}

$$(".tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    if (b.classList.contains("hidden")) return;
    showTab(b.dataset.tab);
  });
});

// ---- Header / detection ---------------------------------------------------

function badge(text, muted) {
  const s = document.createElement("span");
  s.className = muted ? "badge muted" : "badge";
  s.textContent = text;
  return s;
}

function setControlsEnabled(enabled) {
  $$(".lane-btn").forEach((b) => (b.disabled = !enabled));
  $("#scripts-toggle").disabled = !enabled;
  $$(".segmented button").forEach((b) => (b.disabled = !enabled));
}

function renderProject() {
  const d = state.detection;
  const wrap = $("#project");
  wrap.innerHTML = "";
  const notice = $("#notice");
  if (!d || !d.hasProject) {
    notice.textContent = d?.reason || "No Node.js project (package.json) found in this folder.";
    notice.classList.remove("hidden");
    setControlsEnabled(false);
    return;
  }
  notice.classList.add("hidden");
  setControlsEnabled(true);
  wrap.append(badge(`${d.name}${d.version ? " " + d.version : ""}`));
  wrap.append(badge(d.pm));
  wrap.append(badge(d.framework.label));
  if (d.typescript) wrap.append(badge("TypeScript"));
  if (d.testRunner) wrap.append(badge(d.testRunner));
  if (d.linter) wrap.append(badge(d.linter));
  if (d.workspaces) wrap.append(badge("workspaces", true));

  renderLanes();
  renderTabs();
  renderPinned();
}

// Show only the lane buttons that apply to this project.
function renderLanes() {
  const a = state.detection?.availability || {};
  const hasProject = !!state.detection?.hasProject;
  $$(".lane-btn[data-lane]").forEach((b) => {
    const hide = hasProject && a[b.dataset.lane] === false;
    b.classList.toggle("hidden", hide);
  });
}

// Hide the Tests / Dev tabs when the project has nothing to run there.
function renderTabs() {
  const a = state.detection?.availability || {};
  const hasProject = !!state.detection?.hasProject;
  $("#tabbtn-tests").classList.toggle("hidden", hasProject && a.test === false);
  $("#tabbtn-dev").classList.toggle("hidden", hasProject && a.dev === false);
  const active = $(".tabs button.active");
  if (active && active.classList.contains("hidden")) showTab("console");
}

// ---- Scripts (pinnable menu) ----------------------------------------------

function renderPinned() {
  const wrap = $("#pinned");
  wrap.innerHTML = "";
  const names = state.detection?.scriptNames || [];
  for (const name of state.settings.pinnedScripts || []) {
    if (!names.includes(name)) continue;
    const b = document.createElement("button");
    b.className = "lane-btn script";
    b.dataset.script = name;
    b.disabled = !state.detection?.hasProject;
    b.innerHTML = `<svg class="oi"><use href="#oct-terminal" /></svg>`;
    b.append(document.createTextNode(name));
    b.addEventListener("click", () => api("/api/script", { name }));
    wrap.append(b);
  }
}

function renderScriptsMenu() {
  const menu = $("#scripts-menu");
  const names = state.detection?.scriptNames || [];
  const pinned = new Set(state.settings.pinnedScripts || []);
  menu.innerHTML = "";
  if (!names.length) {
    menu.innerHTML = '<div class="menu-empty">No scripts in package.json.</div>';
    return;
  }
  const head = document.createElement("div");
  head.className = "menu-head";
  head.textContent = "Pin to toolbar · click a name to run";
  menu.append(head);
  for (const name of names) {
    const item = document.createElement("div");
    item.className = "menu-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = pinned.has(name);
    cb.title = "Pin to toolbar";
    cb.addEventListener("change", () => togglePin(name, cb.checked));
    const label = document.createElement("span");
    label.className = "menu-name";
    label.textContent = name;
    label.title = "Run script";
    label.addEventListener("click", () => {
      api("/api/script", { name });
      closeScriptsMenu();
    });
    item.append(cb, label);
    menu.append(item);
  }
}

async function togglePin(name, pin) {
  const set = new Set(state.settings.pinnedScripts || []);
  if (pin) set.add(name);
  else set.delete(name);
  const names = state.detection?.scriptNames || [];
  const pinnedScripts = names.filter((n) => set.has(n));
  state.settings.pinnedScripts = pinnedScripts;
  renderPinned();
  const res = await api("/api/settings", { pinnedScripts });
  if (res && Array.isArray(res.pinnedScripts)) {
    state.settings.pinnedScripts = res.pinnedScripts;
    renderPinned();
  }
}

function openScriptsMenu() {
  renderScriptsMenu();
  $("#scripts-menu").classList.remove("hidden");
  $("#scripts-toggle").setAttribute("aria-expanded", "true");
}

function closeScriptsMenu() {
  $("#scripts-menu").classList.add("hidden");
  $("#scripts-toggle").setAttribute("aria-expanded", "false");
}

// ---- Console --------------------------------------------------------------

function laneStatus(id) {
  return state.lanes[id]?.status || "idle";
}

function setConsoleLane(id) {
  activeConsoleLane = id;
  const lane = state.lanes[id] || {};
  $("#console-label").textContent = lane.label || id;
  $("#console").textContent = strip(lane.output || "");
  $("#console").scrollTop = $("#console").scrollHeight;
  renderConsoleStatus();
}

const STATUS_ICON = { running: "dot-fill", passed: "check-circle-fill", failed: "x-circle-fill" };

function statusChip(chip, status) {
  const icon = STATUS_ICON[status];
  chip.className = `status-chip ${status}`;
  chip.innerHTML = icon ? `<svg class="oi"><use href="#oct-${icon}" /></svg>` : "";
  chip.append(document.createTextNode(status));
}

function renderConsoleStatus() {
  const id = activeConsoleLane;
  const chip = $("#console-status");
  const fix = $("#console-fix");
  if (!id) {
    chip.textContent = "";
    chip.className = "status-chip";
    fix.classList.add("hidden");
    return;
  }
  const st = laneStatus(id);
  statusChip(chip, st);
  fix.classList.toggle("hidden", st !== "failed");
  fix.dataset.lane = id;
}

// ---- Tests ----------------------------------------------------------------

const TEST_ICON = {
  passed: "check-circle-fill",
  failed: "x-circle-fill",
  skipped: "dot-fill",
  pending: "dot-fill",
  todo: "dot-fill",
};

function renderTests() {
  const report = state.test.report;
  const empty = $("#tests-empty");
  const body = $("#tests-body");
  if (!report) {
    empty.classList.remove("hidden");
    body.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  body.classList.remove("hidden");

  const chips = $("#test-chips");
  chips.innerHTML = "";
  const mk = (cls, label) => {
    const c = document.createElement("span");
    c.className = `chip ${cls}`;
    c.textContent = label;
    return c;
  };
  chips.append(mk("total", `${report.total} total`));
  chips.append(mk("pass", `${report.passed} passed`));
  if (report.failed) chips.append(mk("fail", `${report.failed} failed`));
  if (report.skipped) chips.append(mk("skip", `${report.skipped} skipped`));

  $("#test-fix").classList.toggle("hidden", report.failed === 0);

  const suites = $("#test-suites");
  suites.innerHTML = "";
  for (const s of report.suites || []) {
    const div = document.createElement("div");
    div.className = "suite";
    const head = document.createElement("div");
    head.className = "suite-name";
    head.textContent = s.name;
    div.append(head);
    for (const t of s.tests || []) {
      const row = document.createElement("div");
      row.className = `test-row ${t.status}`;
      const icon = TEST_ICON[t.status] || "dot-fill";
      row.innerHTML = `<svg class="oi"><use href="#oct-${icon}" /></svg><span class="name"></span>`;
      row.querySelector(".name").textContent = t.name || "(unnamed)";
      div.append(row);
      if (t.status === "failed" && t.message) {
        const msg = document.createElement("pre");
        msg.className = "test-msg";
        msg.textContent = strip(t.message);
        div.append(msg);
      }
    }
    suites.append(div);
  }
  $("#test-raw").textContent = strip(state.lanes.test?.output || "");
}

// ---- Dev ------------------------------------------------------------------

function renderDev() {
  const dev = state.dev;
  const running = dev.status === "running";
  $("#dev-start").classList.toggle("hidden", running);
  $("#dev-stop").classList.toggle("hidden", !running);
  statusChip($("#dev-status"), running ? "running" : "stopped");

  const urlWrap = $("#dev-url-wrap");
  const preview = $("#dev-preview");
  if (dev.url) {
    urlWrap.classList.remove("hidden");
    const a = $("#dev-url");
    a.textContent = dev.url;
    a.href = dev.url;
    if (preview.src !== dev.url) preview.src = dev.url;
    preview.classList.remove("hidden");
  } else {
    urlWrap.classList.add("hidden");
    preview.classList.add("hidden");
  }
  const c = $("#dev-console");
  c.textContent = strip(dev.output || "");
  c.scrollTop = c.scrollHeight;
}

// ---- Dependencies ---------------------------------------------------------

function renderOutdated() {
  const wrap = $("#outdated");
  const od = state.deps.outdated;
  if (!od) {
    wrap.innerHTML = '<div class="empty">Press <b>Check outdated</b>.</div>';
    return;
  }
  if (!od.list.length) {
    wrap.innerHTML = '<div class="empty">All dependencies are up to date.</div>';
    return;
  }
  const rows = od.list
    .map(
      (o) => `<tr>
        <td>${o.name}</td>
        <td class="ver">${o.current ?? "—"}</td>
        <td class="ver">${o.wanted ?? o.latest ?? "—"}</td>
        <td class="ver">${o.latest ?? "—"}</td>
        <td><span class="bump ${o.bump}">${o.bump}</span></td>
      </tr>`,
    )
    .join("");
  wrap.innerHTML = `<table class="dep-table">
    <thead><tr><th>Package</th><th>Current</th><th>Wanted</th><th>Latest</th><th>Bump</th></tr></thead>
    <tbody>${rows}</tbody></table>
    ${od.supported ? "" : '<div class="empty">JSON output unavailable for this package manager — values are best-effort.</div>'}`;
}

function renderAudit() {
  const a = state.deps.audit;
  const el = $("#audit-summary");
  if (!a) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  el.innerHTML = "";
  const m = a.metadata;
  if (m && (m.total ?? 0) === 0) {
    const s = document.createElement("span");
    s.className = "sev clean";
    s.textContent = "No known vulnerabilities";
    el.append(s);
    return;
  }
  for (const sev of ["critical", "high", "moderate", "low", "info"]) {
    const n = m?.[sev] || 0;
    if (!n) continue;
    const s = document.createElement("span");
    s.className = `sev ${sev}`;
    s.textContent = `${n} ${sev}`;
    el.append(s);
  }
}

function renderUpdate() {
  const u = state.deps.update;
  const log = $("#deps-log");
  if (!u) {
    log.classList.add("hidden");
    return;
  }
  log.classList.remove("hidden");
  log.textContent = strip((u.log || []).join(""));
  log.scrollTop = log.scrollHeight;
  $("#deps-fix").classList.toggle("hidden", !(u.status === "done" && u.fixAvailable));
}

// ---- SSE ------------------------------------------------------------------

async function refreshSettings() {
  const s = await api("/api/settings");
  state.settings = { theme: s.theme || "auto", pinnedScripts: s.pinnedScripts || [] };
  applyTheme(state.settings.theme);
  renderPinned();
}

function applyEvent(e) {
  switch (e.type) {
    case "snapshot":
      Object.assign(state, e.state);
      state.lanes = e.state.lanes || {};
      renderProject();
      renderTests();
      renderDev();
      renderOutdated();
      renderAudit();
      renderUpdate();
      if (activeConsoleLane) setConsoleLane(activeConsoleLane);
      break;
    case "detection":
      state.detection = e.detection;
      renderProject();
      refreshSettings();
      break;
    case "lane:start": {
      state.lanes[e.lane] = { id: e.lane, label: e.label, status: "running", output: "" };
      if (isConsoleLane(e.lane)) {
        setConsoleLane(e.lane);
        showTab("console");
      } else if (e.lane === "test") {
        showTab("tests");
      }
      renderConsoleStatus();
      break;
    }
    case "lane:data": {
      const lane = (state.lanes[e.lane] = state.lanes[e.lane] || { id: e.lane, output: "" });
      lane.output = (lane.output || "") + e.chunk;
      if (e.lane === activeConsoleLane) {
        const c = $("#console");
        c.textContent += strip(e.chunk);
        c.scrollTop = c.scrollHeight;
      }
      break;
    }
    case "lane:end": {
      const lane = (state.lanes[e.lane] = state.lanes[e.lane] || { id: e.lane });
      lane.status = e.status;
      lane.exitCode = e.exitCode;
      if (e.lane === activeConsoleLane) renderConsoleStatus();
      if (e.lane === "test") renderTests();
      break;
    }
    case "test:report":
      state.test.report = e.report;
      renderTests();
      break;
    case "dev:start":
      state.dev = { status: "running", url: null, output: "", label: e.label };
      renderDev();
      break;
    case "dev:data":
      state.dev.output = (state.dev.output || "") + e.chunk;
      $("#dev-console").textContent += strip(e.chunk);
      $("#dev-console").scrollTop = $("#dev-console").scrollHeight;
      break;
    case "dev:url":
      state.dev.url = e.url;
      renderDev();
      break;
    case "dev:exit":
      state.dev.status = "stopped";
      renderDev();
      break;
    case "deps:outdated":
      state.deps.outdated = e.outdated;
      renderOutdated();
      break;
    case "deps:audit":
      state.deps.audit = e.audit;
      renderAudit();
      break;
    case "deps:update-start":
      state.deps.update = { status: "running", log: [], scope: e.scope };
      renderUpdate();
      break;
    case "deps:update-log":
      (state.deps.update = state.deps.update || { log: [] }).log.push(e.chunk);
      renderUpdate();
      break;
    case "deps:update-done":
      Object.assign((state.deps.update = state.deps.update || { log: [] }), {
        status: "done",
        kept: e.kept,
        failed: e.failed,
        fixAvailable: e.fixAvailable,
      });
      renderUpdate();
      break;
    case "deps:rollback-done":
      break;
  }
}

function connect() {
  const es = new EventSource("/events");
  es.onmessage = (m) => {
    try {
      applyEvent(JSON.parse(m.data));
    } catch {}
  };
  es.onerror = () => {
    /* EventSource auto-reconnects */
  };
}

// ---- Wiring ---------------------------------------------------------------

$$(".lane-btn[data-lane]").forEach((b) => {
  b.addEventListener("click", () => api("/api/lane", { id: b.dataset.lane }));
});
$("#test-btn").addEventListener("click", () => api("/api/test", {}));
$("#refresh").addEventListener("click", () => api("/api/refresh", {}));

$("#theme-toggle").addEventListener("click", () => {
  const next = THEME_NEXT[state.settings.theme] || "auto";
  state.settings.theme = next;
  applyTheme(next);
  api("/api/settings", { theme: next });
});

$("#scripts-toggle").addEventListener("click", (e) => {
  e.stopPropagation();
  if ($("#scripts-menu").classList.contains("hidden")) openScriptsMenu();
  else closeScriptsMenu();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu-wrap")) closeScriptsMenu();
});

$("#console-fix").addEventListener("click", (e) =>
  api("/api/fix", { lane: e.currentTarget.dataset.lane }),
);
$("#test-fix").addEventListener("click", () => api("/api/fix", { lane: "test" }));
$("#test-raw-toggle").addEventListener("click", () => $("#test-raw").classList.toggle("hidden"));

$("#dev-start").addEventListener("click", () => api("/api/dev/start", {}));
$("#dev-stop").addEventListener("click", () => api("/api/dev/stop", {}));
$("#dev-reload").addEventListener("click", () => {
  const p = $("#dev-preview");
  if (p.src) p.src = p.src;
});

$("#deps-check").addEventListener("click", () => api("/api/deps/outdated", {}));
$("#deps-audit").addEventListener("click", () => api("/api/deps/audit", {}));
$$("#deps-scope button").forEach((b) => {
  b.addEventListener("click", () => {
    $$("#deps-scope button").forEach((x) => x.classList.toggle("on", x === b));
  });
});
$("#deps-update").addEventListener("click", () =>
  api("/api/deps/update", { scope: $("#deps-scope button.on")?.dataset.scope || "minor" }),
);
$("#deps-fix").addEventListener("click", () => api("/api/deps/fix", {}));

refreshSettings();
connect();
