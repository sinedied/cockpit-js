// Smoke test: dynamically import every SDK-free TypeScript module so Node's
// native type-stripping (>= 22.18) is exercised end to end — the same path the
// Copilot runtime uses to load the extension. `src/extension.ts` is excluded
// because it imports the Copilot SDK, which is only present inside the app.
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "..", "src");

const entries = await readdir(srcDir);
const modules = entries.filter((f) => f.endsWith(".ts") && f !== "extension.ts").sort();

let failures = 0;
for (const mod of modules) {
  const url = pathToFileURL(path.join(srcDir, mod)).href;
  try {
    await import(url);
    console.log(`ok    ${mod}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${mod}: ${err?.message || err}`);
  }
}

// Basic behavioural smoke beyond "it imports".
const { Controller } = await import(pathToFileURL(path.join(srcDir, "controller.ts")).href);
const controller = new Controller(process.cwd(), { sendToChat: async () => {} });
if (typeof controller.runLane !== "function") {
  failures++;
  console.error("FAIL  Controller is missing expected methods");
} else {
  console.log("ok    Controller instantiates");
}

if (failures) {
  console.error(`\n${failures} smoke failure(s).`);
  process.exit(1);
}
console.log(`\nAll ${modules.length} modules loaded via native type-stripping.`);
