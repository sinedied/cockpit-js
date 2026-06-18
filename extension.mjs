// Node Pilot entry point. The Copilot runtime discovers an extension by its
// `extension.mjs` file, so this thin wrapper loads the TypeScript implementation,
// run directly via Node's native type-stripping (Node >= 22.18). The version
// guard turns an otherwise opaque "unknown .ts extension" crash on older runtimes
// into a clear, actionable error.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  throw new Error(
    `Node Pilot requires Node >= 22.18 for native TypeScript loading; got ${process.versions.node}.`,
  );
}

await import("./src/extension.ts");
