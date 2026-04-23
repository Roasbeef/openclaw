import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildKeybaseDockerSmokeImage, writeKeybaseDockerSmokeFiles } from "./docker-smoke.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe("writeKeybaseDockerSmokeFiles", () => {
  it("writes a standalone compose scaffold for local keybase smoke", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "keybase-docker-smoke-"));
    cleanups.push(async () => {
      await rm(outputDir, { recursive: true, force: true });
    });

    const result = await writeKeybaseDockerSmokeFiles({
      gatewayPort: 18889,
      imageName: "openclaw:keybase-test",
      outputDir,
      platform: "linux/amd64",
    });

    expect(result.files).toEqual(
      expect.arrayContaining([
        path.join(outputDir, ".env.example"),
        path.join(outputDir, "README.md"),
        path.join(outputDir, "docker-compose.keybase.yml"),
        path.join(outputDir, "state", "home", ".openclaw", "openclaw.json"),
        path.join(outputDir, "state", "home", ".openclaw", "secrets", "README.txt"),
        path.join(outputDir, "state", "home", ".openclaw", "tmp"),
      ]),
    );

    const compose = await readFile(path.join(outputDir, "docker-compose.keybase.yml"), "utf8");
    expect(compose).toContain("openclaw-keybase-gateway:");
    expect(compose).toContain("image: openclaw:keybase-test");
    expect(compose).toContain("platform: linux/amd64");
    expect(compose).toContain('      - "18889:18789"');
    expect(compose).toContain("/app/extensions/keybase/docker/container-entrypoint.mjs");
    expect(compose).toContain("CLAUDE_CODE_OAUTH_TOKEN: ${CLAUDE_CODE_OAUTH_TOKEN:-}");
    expect(compose).toContain("KEYBASE_USERNAME: ${KEYBASE_USERNAME:-}");
    expect(compose).toContain("KEYBASE_PAPERKEY_FILE: ${KEYBASE_PAPERKEY_FILE:-}");
    expect(compose).toContain("OPENCLAW_KEYBASE_HOME: /home/node");
    expect(compose).toContain("OPENCLAW_TMPDIR: /home/node/.openclaw/tmp");
    expect(compose).toContain("TMPDIR: /home/node/.openclaw/tmp");
    expect(compose).toContain("./state/home:/home/node");
    expect(compose).toContain("openclaw-keybase-cli:");
    expect(compose).toContain('network_mode: "service:openclaw-keybase-gateway"');

    const envExample = await readFile(path.join(outputDir, ".env.example"), "utf8");
    expect(envExample).toContain("KEYBASE_USERNAME=claw_ll");
    expect(envExample).toContain("KEYBASE_PAPERKEY=");
    expect(envExample).toContain("CLAUDE_CODE_OAUTH_TOKEN=");
    expect(envExample).toContain(
      "KEYBASE_PAPERKEY_FILE=/home/node/.openclaw/secrets/keybase-paperkey",
    );

    const config = await readFile(
      path.join(outputDir, "state", "home", ".openclaw", "openclaw.json"),
      "utf8",
    );
    expect(config).toContain('"claude-cli"');
    expect(config).toContain('"claude-cli/claude-sonnet-4-6"');
    expect(config).toContain('"CLAUDE_CODE_OAUTH_TOKEN": "${CLAUDE_CODE_OAUTH_TOKEN}"');
    expect(config).toContain('"keybase"');
    expect(config).toContain('"allowInsecureAuth": true');
    expect(config).toContain('"controlUi"');
    expect(config).toContain('"/home/node"');

    const readme = await readFile(path.join(outputDir, "README.md"), "utf8");
    expect(readme).toContain("pnpm keybase:smoke:build");
    expect(readme).toContain("docker compose --env-file .env -f docker-compose.keybase.yml up -d");
    expect(readme).toContain("openclaw-keybase-cli");
  });
});

describe("buildKeybaseDockerSmokeImage", () => {
  it("builds the base openclaw image and the keybase overlay image", async () => {
    const calls: string[] = [];
    const result = await buildKeybaseDockerSmokeImage(
      {
        baseImageName: "openclaw:keybase-base",
        imageName: "openclaw:keybase-test",
        platform: "linux/amd64",
        repoRoot: "/repo/openclaw",
      },
      {
        async runCommand(command, args, cwd) {
          calls.push([command, ...args, `@${cwd}`].join(" "));
          return { stderr: "", stdout: "" };
        },
      },
    );

    expect(result).toEqual({
      baseImageName: "openclaw:keybase-base",
      imageName: "openclaw:keybase-test",
      platform: "linux/amd64",
    });
    expect(calls).toEqual([
      expect.stringContaining(
        "docker build --platform linux/amd64 -t openclaw:keybase-base --build-arg OPENCLAW_EXTENSIONS=keybase -f Dockerfile . @/repo/openclaw",
      ),
      expect.stringContaining(
        "docker build --platform linux/amd64 -t openclaw:keybase-test --build-arg OPENCLAW_BASE_IMAGE=openclaw:keybase-base -f extensions/keybase/docker/Dockerfile . @/repo/openclaw",
      ),
    ]);
  });
});
