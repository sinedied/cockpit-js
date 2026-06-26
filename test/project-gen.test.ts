// Guards that a slow auto-task / refresh started for one project can't publish
// stale results after the user switches projects (the `_projectGen` token).
// The process runner is mocked so a "switch" can be injected mid-run, fully
// deterministic and offline.
import { describe, expect, it, vi } from "vitest";
import type { Detection } from "../src/types.ts";

const h = vi.hoisted(() => ({
  result: { code: 0, signal: null, output: "", stdout: "", stderr: "" },
  onRun: null as null | (() => void),
}));

vi.mock("../src/process-runner.ts", () => ({
  run: vi.fn(async () => {
    h.onRun?.();
    return h.result;
  }),
}));

const { Controller } = await import("../src/controller.ts");

function projectController() {
  const c = new Controller("/tmp/np-gen", { autoRun: false, sendToChat: async () => {} });
  // Minimal detection so runAudit gets past its hasProject guard.
  c.detection = { hasProject: true, pm: "npm" } as unknown as Detection;
  return c;
}

const auditJson = JSON.stringify({
  vulnerabilities: {},
  metadata: { vulnerabilities: { total: 0 } },
});

describe("project generation guard", () => {
  it("publishes an audit result when the project is unchanged", async () => {
    const c = projectController();
    h.result = { code: 0, signal: null, output: auditJson, stdout: auditJson, stderr: "" };
    h.onRun = null;
    await c.runAudit();
    expect(c.deps.audit).not.toBeNull();
  });

  it("discards an audit result when the project switched mid-run", async () => {
    const c = projectController();
    h.result = { code: 0, signal: null, output: auditJson, stdout: auditJson, stderr: "" };
    // Simulate the user switching projects while `npm audit` is in flight: the
    // switch path bumps _projectGen (here we bump it directly to mimic that).
    h.onRun = () => {
      c._projectGen++;
    };
    await c.runAudit();
    expect(c.deps.audit).toBeNull();
  });
});
