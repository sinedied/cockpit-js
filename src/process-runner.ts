// Cross-platform process spawning with streamed output. Long-lived processes
// (the dev server) and one-shot lanes (build/lint/test) both go through here.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { ProcessHandle, RunResult } from "./types.ts";

interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface RunOptions extends SpawnOptions {
  onData?: (text: string) => void;
  onStart?: (child: ChildProcess) => void;
}

interface StartOptions extends SpawnOptions {
  onData?: (text: string) => void;
}

// Spawn argv cross-platform. On Windows, package-manager binaries are `.cmd`
// shims that must be run through the shell, so we route through cmd.exe with
// verbatim arguments; on POSIX we exec directly (no shell injection surface).
// `group` makes the POSIX child a process-group leader (detached) so the whole
// tree can be killed at once — long-lived servers (npm -> sh -> node) leave
// grandchildren that must die together; one-shot lanes don't need it.
function spawnArgv(
  argv: string[],
  { cwd, env, group }: SpawnOptions & { group?: boolean },
): ChildProcess {
  const [command, ...args] = argv;
  if (process.platform === "win32") {
    const line = [command, ...args]
      .map((a) => (/[\s"^&|<>()]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a))
      .join(" ");
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", line], {
      cwd,
      env,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(command, args, { cwd, env, detached: !!group });
}

// Run a command to completion, streaming each output chunk via onData.
// Returns { code, signal, output } where output is the full combined text.
export function run(
  argv: string[],
  { cwd, env = process.env, onData, onStart }: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnArgv(argv, { cwd, env });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const text = `Failed to launch ${argv.join(" ")}: ${message}\n`;
      onData?.(text);
      resolve({ code: -1, signal: null, output: text, error: message });
      return;
    }

    let output = "";
    let stdout = "";
    let stderr = "";
    onStart?.(child);

    const handle = (buf: Buffer) => {
      const text = buf.toString();
      output += text;
      onData?.(text);
    };
    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString();
      handle(buf);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString();
      handle(buf);
    });

    child.on("error", (err) => {
      const text = `\nProcess error: ${err.message}\n`;
      output += text;
      onData?.(text);
    });
    child.on("close", (code, signal) => {
      resolve({ code: code ?? -1, signal, output, stdout, stderr });
    });
  });
}

// Start a long-lived process. Returns the child plus a stop() helper.
export function start(
  argv: string[],
  { cwd, env = process.env, onData }: StartOptions = {},
): ProcessHandle {
  const child = spawnArgv(argv, { cwd, env, group: true });
  const handle = (buf: Buffer) => onData?.(buf.toString());
  child.stdout?.on("data", handle);
  child.stderr?.on("data", handle);

  function stop(): Promise<void> {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      // Resolve on either: `exit` fires when the process exits even if inherited
      // pipes are still held open by a grandchild; `close` is the belt-and-braces.
      child.once("exit", done);
      child.once("close", done);
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
        } else if (child.pid) {
          // The child is a process-group leader (detached); signal the whole
          // group (-pid) so grandchildren die too. Escalate to SIGKILL if the
          // group is still alive — gating on group existence (not the direct
          // child) so a stubborn grandchild that outlives npm still gets reaped.
          const pgid = child.pid;
          try {
            process.kill(-pgid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
          setTimeout(() => {
            try {
              process.kill(-pgid, 0); // throws if the group is gone
              process.kill(-pgid, "SIGKILL");
            } catch {}
          }, 4000).unref();
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        resolve();
      }
    });
  }

  return { child, stop };
}
