import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyKeybaseContainerConfig,
  prepareKeybaseContainer,
  resolveKeybaseContainerConfig,
  runKeybaseContainerEntrypoint,
} from "./container-entrypoint.js";

type MockChildProcess = {
  emit: (eventName: string | symbol, ...args: unknown[]) => boolean;
  exitCode: number | null;
  kill: (signal?: string) => boolean;
  killed: boolean;
  once: (eventName: string | symbol, listener: (...args: unknown[]) => void) => MockChildProcess;
  pid: number;
  signalCode: string | null;
};

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
      pidFile: "/tmp/openclaw-keybase/keybased.pid",
      runtimeDir: "/tmp/openclaw-keybase",
      socketFile: "/tmp/openclaw-keybase/keybased.sock",
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
        OPENCLAW_KEYBASE_PID_FILE: " /srv/runtime/keybased.pid ",
        OPENCLAW_KEYBASE_RUNTIME_DIR: " /srv/runtime ",
        OPENCLAW_KEYBASE_SOCKET_FILE: " /srv/runtime/keybased.sock ",
        OPENCLAW_TMPDIR: " /srv/openclaw-tmp ",
      }),
    ).toEqual({
      autoOneshot: false,
      binary: "/usr/local/bin/keybase",
      configPath: "/tmp/openclaw.json",
      homeDir: "/srv/keybase",
      paperKey: "key words",
      paperKeyFile: undefined,
      pidFile: "/srv/runtime/keybased.pid",
      runtimeDir: "/srv/runtime",
      socketFile: "/srv/runtime/keybased.sock",
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
        pidFile: "/tmp/openclaw-keybase/keybased.pid",
        runtimeDir: "/tmp/openclaw-keybase",
        socketFile: "/tmp/openclaw-keybase/keybased.sock",
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
          pidFile: "/tmp/openclaw-keybase/keybased.pid",
          socketFile: "/tmp/openclaw-keybase/keybased.sock",
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
        pidFile: path.join(rootDir, "runtime", "keybased.pid"),
        runtimeDir: path.join(rootDir, "runtime"),
        socketFile: path.join(rootDir, "runtime", "keybased.sock"),
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
        pidFile: path.join(rootDir, "runtime", "keybased.pid"),
        socketFile: path.join(rootDir, "runtime", "keybased.sock"),
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
        pidFile: path.join(rootDir, "runtime", "keybased.pid"),
        socketFile: path.join(rootDir, "runtime", "keybased.sock"),
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
        pidFile: path.join(rootDir, "runtime", "keybased.pid"),
        runtimeDir: path.join(rootDir, "runtime"),
        socketFile: path.join(rootDir, "runtime", "keybased.sock"),
        tmpDir: path.join(rootDir, "openclaw-tmp"),
      },
      {
        oneshot: oneshotMock,
      },
    );

    expect(oneshotMock).not.toHaveBeenCalled();
  });
});

describe("runKeybaseContainerEntrypoint", () => {
  it("returns the managed child exit code", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "keybase-container-entrypoint-"));
    cleanups.push(async () => {
      await rm(rootDir, { recursive: true, force: true });
    });

    const previousEnv = {
      OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
      OPENCLAW_KEYBASE_HOME: process.env.OPENCLAW_KEYBASE_HOME,
      OPENCLAW_KEYBASE_RUNTIME_DIR: process.env.OPENCLAW_KEYBASE_RUNTIME_DIR,
      OPENCLAW_TMPDIR: process.env.OPENCLAW_TMPDIR,
    };
    process.env.OPENCLAW_CONFIG_PATH = path.join(rootDir, "openclaw.json");
    process.env.OPENCLAW_KEYBASE_HOME = path.join(rootDir, "keybase-home");
    process.env.OPENCLAW_KEYBASE_RUNTIME_DIR = path.join(rootDir, "runtime");
    process.env.OPENCLAW_TMPDIR = path.join(rootDir, "tmp");

    const child = new EventEmitter() as unknown as MockChildProcess;
    child.exitCode = null;
    child.killed = false;
    child.pid = process.pid;
    child.signalCode = null;
    child.kill = () => {
      child.killed = true;
      return true;
    };
    const spawnMock = vi.fn(() => {
      setImmediate(() => child.emit("close", 7, null));
      return child;
    });

    try {
      await expect(
        runKeybaseContainerEntrypoint(["node", "dist/index.js"], {
          spawn: spawnMock as never,
        }),
      ).resolves.toBe(7);
      const [command, args, options] = spawnMock.mock.calls[0] as unknown as [
        string,
        string[],
        { env: NodeJS.ProcessEnv; stdio: string },
      ];
      expect(command).toBe("node");
      expect(args).toEqual(["dist/index.js"]);
      expect(options).toMatchObject({ stdio: "inherit" });
      expect(options?.env).toMatchObject({ KEYBASE_SERVICE: "1" });
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
