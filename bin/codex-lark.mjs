#!/usr/bin/env node
const [major, minor] = process.versions.node.split('.').map(Number);
if ((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22) {
  await import('../dist/cli.cjs');
} else {
  console.error(`codex-lark requires Node.js 20.19+ (20.x), or 22.12 and later. Current version: ${process.versions.node}. Please update Node.js and run codex-lark again.`);
  process.exitCode = 1;
}
