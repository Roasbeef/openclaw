#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "extensions/keybase/src/container-entrypoint.ts");
const outputPath = path.join(repoRoot, "extensions/keybase/docker/container-entrypoint.mjs");
const banner =
  "// Generated from extensions/keybase/src/container-entrypoint.ts. Do not edit by hand.";

function parseMode(argv) {
  if (argv.includes("--write")) {
    return "write";
  }
  if (argv.includes("--check")) {
    return "check";
  }
  throw new Error("Usage: node scripts/generate-keybase-container-entrypoint.mjs --write|--check");
}

async function buildEntrypoint() {
  const result = await esbuild.build({
    absWorkingDir: repoRoot,
    banner: {
      js: banner,
    },
    bundle: false,
    entryPoints: [sourcePath],
    format: "esm",
    legalComments: "none",
    logLevel: "silent",
    platform: "node",
    target: "node22",
    write: false,
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) {
    throw new Error("esbuild did not return generated output.");
  }
  return output;
}

const mode = parseMode(process.argv.slice(2));
const next = await buildEntrypoint();

if (mode === "write") {
  await writeFile(outputPath, next, "utf8");
} else {
  const current = await readFile(outputPath, "utf8");
  if (current !== next) {
    process.stderr.write(
      "extensions/keybase/docker/container-entrypoint.mjs is stale. Run `pnpm keybase:entrypoint:gen`.\n",
    );
    process.exitCode = 1;
  }
}
