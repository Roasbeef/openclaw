import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyKeybaseContainerConfig,
  prepareKeybaseContainer,
  resolveKeybaseContainerConfig,
} from "./container-entrypoint.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe("resolveKeybaseContainerConfig", () => {
  it("uses stable defaults", () => {
    expect(resolveKeybaseContainerConfig({})).toEqual({
      autoOneshot: true,
      binary: "keybase",
      configPath: "/home/node/.openclaw/openclaw.json",
      homeDir: "/home/node",
      paperKey: undefined,
      paperKeyFile: undefined,
      tmpDir: "/home/node/.openclaw/tmp",
      username: undefined,
    });
  });

  it("normalizes configured env overrides", () => {
    expect(
      resolveKeybaseContainerConfig({
        KEYBASE_PAPERKEY: "  key words  ",
        KEYBASE_USERNAME: "  claw_ll  ",
        OPENCLAW_CONFIG_PATH: " /tmp/openclaw.json ",
        OPENCLAW_KEYBASE_AUTO_ONESHOT: "off",
        OPENCLAW_KEYBASE_BINARY: " /usr/local/bin/keybase ",
        OPENCLAW_KEYBASE_HOME: " /srv/keybase ",
        OPENCLAW_TMPDIR: " /srv/openclaw-tmp ",
      }),
    ).toEqual({
      autoOneshot: false,
      binary: "/usr/local/bin/keybase",
      configPath: "/tmp/openclaw.json",
      homeDir: "/srv/keybase",
      paperKey: "key words",
      paperKeyFile: undefined,
      tmpDir: "/srv/openclaw-tmp",
      username: "claw_ll",
    });
  });
});

describe("applyKeybaseContainerConfig", () => {
  it("adds a safe local keybase baseline without dropping unrelated config", () => {
    const next = applyKeybaseContainerConfig(
      {
        agents: { defaults: { model: "gpt-5.4" } },
        channels: {
          keybase: {
            groups: {
              "team:lightninglabs#lbottest": {
                enabled: true,
              },
            },
          },
        },
        gateway: {
          auth: {
            allowInsecureAuth: true,
            token: "secret",
          },
        },
      },
      {
        autoOneshot: true,
        binary: "keybase",
        configPath: "/tmp/openclaw.json",
        homeDir: "/home/node",
        tmpDir: "/tmp/openclaw-tmp",
        username: "claw_ll",
      },
    );

    expect(next).toEqual({
      agents: { defaults: { model: "gpt-5.4" } },
      channels: {
        keybase: {
          binary: "keybase",
          dmPolicy: "pairing",
          enabled: true,
          groupPolicy: "allowlist",
          groups: {
            "team:lightninglabs#lbottest": {
              enabled: true,
            },
          },
          homeDir: "/home/node",
          username: "claw_ll",
        },
      },
      gateway: {
        auth: {
          token: "secret",
        },
        controlUi: {
          allowInsecureAuth: true,
        },
        bind: "lan",
      },
    });
  });
});

describe("prepareKeybaseContainer", () => {
  it("writes config and runs oneshot from a paper key file", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "keybase-container-entrypoint-"));
    cleanups.push(async () => {
      await rm(rootDir, { recursive: true, force: true });
    });

    const configPath = path.join(rootDir, "openclaw.json");
    const paperKeyPath = path.join(rootDir, "paper-key.txt");
    const oneshotMock = vi.fn(async () => undefined);
    await writeFile(paperKeyPath, "test paper key\n", "utf8");

    await prepareKeybaseContainer(
      {
        autoOneshot: true,
        binary: "keybase",
        configPath,
        homeDir: path.join(rootDir, "keybase-home"),
        paperKeyFile: paperKeyPath,
        tmpDir: path.join(rootDir, "openclaw-tmp"),
        username: "claw_ll",
      },
      {
        oneshot: oneshotMock,
      },
    );

    expect(oneshotMock).toHaveBeenCalledWith(
      {
        paperKey: "test paper key",
        username: "claw_ll",
      },
      {
        binary: "keybase",
        homeDir: path.join(rootDir, "keybase-home"),
      },
    );

    const written = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    expect(written.channels).toEqual({
      keybase: {
        binary: "keybase",
        dmPolicy: "pairing",
        enabled: true,
        groupPolicy: "allowlist",
        homeDir: path.join(rootDir, "keybase-home"),
        username: "claw_ll",
      },
    });
  });

  it("skips oneshot when credentials are absent", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "keybase-container-entrypoint-"));
    cleanups.push(async () => {
      await rm(rootDir, { recursive: true, force: true });
    });

    const oneshotMock = vi.fn(async () => undefined);

    await prepareKeybaseContainer(
      {
        autoOneshot: true,
        binary: "keybase",
        configPath: path.join(rootDir, "openclaw.json"),
        homeDir: path.join(rootDir, "keybase-home"),
        tmpDir: path.join(rootDir, "openclaw-tmp"),
      },
      {
        oneshot: oneshotMock,
      },
    );

    expect(oneshotMock).not.toHaveBeenCalled();
  });
});
