import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

// docker-smoke.ts is now a thin re-export shim. Per-module unit tests live
// under ./docker-smoke/. This file retains the keybase-entrypoint.sh
// integration test, which exercises the docker entrypoint shell wrapper
// rather than any docker-smoke.ts symbol.

const cleanups: Array<() => Promise<void>> = [];
const execFile = promisify(execFileCallback);

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe("keybase-entrypoint.sh", () => {
  it("sources Vault-style secret env scripts before delegating to the Node entrypoint", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "keybase-entrypoint-"));
    cleanups.push(async () => {
      await rm(outputDir, { recursive: true, force: true });
    });
    const secretsDir = path.join(outputDir, "vault");
    await mkdir(secretsDir, { recursive: true });
    await writeFile(
      path.join(secretsDir, "keybase.sh"),
      [
        'export KEYBASE_USERNAME="wrapperbot"',
        'export CLAUDE_CODE_OAUTH_TOKEN="wrapped-token"',
        'PLAIN_SECRET="exported-by-set-a"',
      ].join("\n"),
      "utf8",
    );

    // The wrapper enforces that any OPENCLAW_KEYBASE_CONTAINER_ENTRYPOINT
    // override lives under its own directory, so write the probe alongside
    // the wrapper with a unique name and clean it up afterwards.
    const wrapperDir = path.resolve("extensions/keybase/docker");
    const probePath = path.join(wrapperDir, `probe-${process.pid}-${Date.now()}.mjs`);
    cleanups.push(async () => {
      await rm(probePath, { force: true });
    });
    const probeOutputPath = path.join(outputDir, "probe-output.json");
    await writeFile(
      probePath,
      [
        'import { writeFileSync } from "node:fs";',
        "const [outputPath, ...args] = process.argv.slice(2);",
        "writeFileSync(outputPath, JSON.stringify({",
        "  args,",
        "  username: process.env.KEYBASE_USERNAME,",
        "  token: process.env.CLAUDE_CODE_OAUTH_TOKEN,",
        "  plainSecret: process.env.PLAIN_SECRET,",
        "}));",
      ].join("\n"),
      "utf8",
    );

    await execFile(
      "sh",
      [
        path.resolve("extensions/keybase/docker/keybase-entrypoint.sh"),
        probeOutputPath,
        "forwarded-arg",
      ],
      {
        env: {
          ...process.env,
          OPENCLAW_CONFIGURE_GITHUB_TOKEN: "0",
          OPENCLAW_KEYBASE_CONTAINER_ENTRYPOINT: probePath,
          OPENCLAW_KEYBASE_TESTING: "1",
          OPENCLAW_SECRET_ENV_DIR: secretsDir,
        },
      },
    );

    await expect(readFile(probeOutputPath, "utf8").then((raw) => JSON.parse(raw))).resolves.toEqual(
      {
        args: ["forwarded-arg"],
        plainSecret: "exported-by-set-a",
        token: "wrapped-token",
        username: "wrapperbot",
      },
    );
  });
});
