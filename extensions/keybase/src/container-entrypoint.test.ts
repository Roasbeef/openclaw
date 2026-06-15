import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyKeybaseContainerConfig,
  buildKeybaseCommandEnv,
  buildSpawnEnv,
  findLingeringKeybasePids,
  prepareKeybaseContainer,
  resolveKeybaseContainerConfig,
  runKeybaseContainerEntrypoint,
} from "./container-entrypoint.js";

const execFileAsync = promisify(execFile);

type MockChildProcess = {
  emit: (eventName: string | symbol, ...args: unknown[]) => boolean;
  exitCode: number | null;
  kill: (signal?: string) => boolean;
  killed: boolean;
  once: (eventName: string | symbol, listener: (...args: unknown[]) => void) => MockChildProcess;
  pid: number;
  signalCode: string | null;
};

function createMockChildProcess() {
  const child = new EventEmitter() as unknown as MockChildProcess & {
    stdin: PassThrough;
    stderr: PassThrough;
  };
  child.exitCode = null;
  child.killed = false;
  child.pid = process.pid;
  child.signalCode = null;
  child.stdin = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

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

describe("paper-key env hygiene", () => {
  const resolved = { tmpDir: "/tmp/openclaw-keybase" } as const;

  it("buildSpawnEnv strips KEYBASE_PAPERKEY and KEYBASE_PAPERKEY_FILE", () => {
    const baseEnv = {
      ...process.env,
      KEYBASE_PAPERKEY: "secret",
      KEYBASE_PAPERKEY_FILE: "/tmp/p",
    };
    const before = process.env.KEYBASE_PAPERKEY;
    const beforeFile = process.env.KEYBASE_PAPERKEY_FILE;

    const next = buildSpawnEnv(resolved, baseEnv);

    expect(next.KEYBASE_PAPERKEY).toBeUndefined();
    expect(next.KEYBASE_PAPERKEY_FILE).toBeUndefined();
    expect("KEYBASE_PAPERKEY" in next).toBe(false);
    expect("KEYBASE_PAPERKEY_FILE" in next).toBe(false);
    expect(process.env.KEYBASE_PAPERKEY).toBe(before);
    expect(process.env.KEYBASE_PAPERKEY_FILE).toBe(beforeFile);
  });

  it("buildKeybaseCommandEnv strips KEYBASE_PAPERKEY and KEYBASE_PAPERKEY_FILE", () => {
    const baseEnv = {
      ...process.env,
      KEYBASE_PAPERKEY: "secret",
      KEYBASE_PAPERKEY_FILE: "/tmp/p",
    };
    const before = process.env.KEYBASE_PAPERKEY;
    const beforeFile = process.env.KEYBASE_PAPERKEY_FILE;

    const next = buildKeybaseCommandEnv(resolved, baseEnv);

    expect(next.KEYBASE_PAPERKEY).toBeUndefined();
    expect(next.KEYBASE_PAPERKEY_FILE).toBeUndefined();
    expect("KEYBASE_PAPERKEY" in next).toBe(false);
    expect("KEYBASE_PAPERKEY_FILE" in next).toBe(false);
    expect(process.env.KEYBASE_PAPERKEY).toBe(before);
    expect(process.env.KEYBASE_PAPERKEY_FILE).toBe(beforeFile);
  });
});

describe("generated Docker entrypoint", () => {
  it("matches the TypeScript source", async () => {
    await expect(
      execFileAsync(
        process.execPath,
        ["scripts/generate-keybase-container-entrypoint.mjs", "--check"],
        {
          cwd: process.cwd(),
        },
      ),
    ).resolves.toMatchObject({
      stderr: "",
    });
  });

  it("executes far enough to validate generated imports", async () => {
    await expect(
      execFileAsync(process.execPath, ["extensions/keybase/docker/container-entrypoint.mjs"], {
        cwd: process.cwd(),
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Missing container command"),
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
      },
    });
  });

  it("strips gateway.controlUi.allowInsecureAuth alongside gateway.auth.allowInsecureAuth", () => {
    const next = applyKeybaseContainerConfig(
      {
        gateway: {
          auth: {
            allowInsecureAuth: true,
          },
          bind: "lan",
          controlUi: {
            allowInsecureAuth: true,
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

    expect(next.gateway).toEqual({
      bind: "lan",
    });
  });

  it("preserves a non-empty gateway.controlUi block when only allowInsecureAuth is stripped", () => {
    const next = applyKeybaseContainerConfig(
      {
        gateway: {
          controlUi: {
            allowInsecureAuth: true,
            sessionMaxAgeMs: 3600000,
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

    expect(next.gateway).toEqual({
      controlUi: {
        sessionMaxAgeMs: 3600000,
      },
    });
  });
});

describe("prepareKeybaseContainer", () => {
  it("writes config and starts the Keybase service from a paper key file", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "keybase-container-entrypoint-"));
    cleanups.push(async () => {
      await rm(rootDir, { recursive: true, force: true });
    });

    const configPath = path.join(rootDir, "openclaw.json");
    const paperKeyPath = path.join(rootDir, "paper-key.txt");
    await writeFile(paperKeyPath, "test paper key\n", "utf8");
    const serviceChild = createMockChildProcess();
    const stdinChunks: string[] = [];
    serviceChild.stdin.setEncoding("utf8");
    serviceChild.stdin.on("data", (chunk: string) => {
      stdinChunks.push(chunk);
    });
    const statMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket missing"))
      .mockResolvedValue({});
    const spawnMock = vi.fn((_: string, args: string[]) => {
      if (args.includes("service")) {
        return serviceChild;
      }
      const commandChild = createMockChildProcess();
      setImmediate(() => {
        commandChild.emit("exit", 0, null);
      });
      return commandChild;
    });

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
        readdir: vi.fn(async () => []),
        sleep: vi.fn(async () => undefined),
        spawn: spawnMock as never,
        stat: statMock,
      },
    );

    expect(stdinChunks.join("")).toBe("test paper key\n");
    expect(spawnMock).toHaveBeenCalledWith(
      "keybase",
      [
        "--home",
        path.join(rootDir, "keybase-home"),
        "--socket-file",
        path.join(rootDir, "runtime", "keybased.sock"),
        "--pid-file",
        path.join(rootDir, "runtime", "keybased.pid"),
        "service",
        "--oneshot-username",
        "claw_ll",
      ],
      expect.objectContaining({
        env: expect.objectContaining({ KEYBASE_SERVICE: "1" }),
        stdio: ["pipe", "ignore", "pipe"],
      }),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      "keybase",
      [
        "--home",
        path.join(rootDir, "keybase-home"),
        "--socket-file",
        path.join(rootDir, "runtime", "keybased.sock"),
        "--pid-file",
        path.join(rootDir, "runtime", "keybased.pid"),
        "chat",
        "notification-settings",
        "-disable-typing=true",
      ],
      expect.objectContaining({
        env: expect.objectContaining({ KEYBASE_SERVICE: "1" }),
        stdio: ["ignore", "ignore", "pipe"],
      }),
    );

    const written = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    expect(written.channels).toEqual({
      keybase: {
        binary: "keybase",
        dmPolicy: "pairing",
        enabled: true,
        groupPolicy: "allowlist",
        homeDir: path.join(rootDir, "keybase-home"),
        paperKeyFile: paperKeyPath,
        pidFile: path.join(rootDir, "runtime", "keybased.pid"),
        socketFile: path.join(rootDir, "runtime", "keybased.sock"),
        username: "claw_ll",
      },
    });
  });

  it("materializes direct paper key env into a runtime paper key file", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "keybase-container-entrypoint-"));
    cleanups.push(async () => {
      await rm(rootDir, { recursive: true, force: true });
    });

    const runtimeDir = path.join(rootDir, "runtime");
    const configPath = path.join(rootDir, "openclaw.json");
    const spawnMock = vi.fn();

    await prepareKeybaseContainer(
      {
        autoOneshot: false,
        binary: "keybase",
        configPath,
        homeDir: path.join(rootDir, "keybase-home"),
        paperKey: "direct paper key",
        pidFile: path.join(runtimeDir, "keybased.pid"),
        runtimeDir,
        socketFile: path.join(runtimeDir, "keybased.sock"),
        tmpDir: path.join(rootDir, "openclaw-tmp"),
        username: "claw_ll",
      },
      {
        spawn: spawnMock as never,
      },
    );

    const runtimePaperKeyFile = path.join(runtimeDir, "keybase-paperkey");
    const written = JSON.parse(await readFile(configPath, "utf8")) as {
      channels?: { keybase?: Record<string, unknown> };
    };
    expect(written.channels?.keybase?.paperKey).toBeUndefined();
    expect(written.channels?.keybase?.paperKeyFile).toBe(runtimePaperKeyFile);
    expect(await readFile(runtimePaperKeyFile, "utf8")).toBe("direct paper key\n");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("skips service bootstrap when credentials are absent", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "keybase-container-entrypoint-"));
    cleanups.push(async () => {
      await rm(rootDir, { recursive: true, force: true });
    });

    const spawnMock = vi.fn();

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
        spawn: spawnMock as never,
      },
    );

    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("startKeybaseService", () => {
  it("awaits child exit between startKeybaseService retries", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "keybase-container-entrypoint-"));
    cleanups.push(async () => {
      await rm(rootDir, { recursive: true, force: true });
    });
    const paperKeyPath = path.join(rootDir, "paper-key.txt");
    await writeFile(paperKeyPath, "test paper key\n", "utf8");

    const events: string[] = [];
    const serviceChildren: ReturnType<typeof createMockChildProcess>[] = [];

    const spawnMock = vi.fn((_command: string, args: string[]) => {
      const child = createMockChildProcess();
      if (args.includes("service")) {
        const idx = serviceChildren.length;
        serviceChildren.push(child);
        events.push(`spawn:${idx}`);
        // kill() does not emit close synchronously — schedules it 25ms later.
        // awaitChildExit must await that close before the loop respawns.
        child.kill = ((signal?: string) => {
          events.push(`kill:${idx}:${signal ?? "default"}`);
          child.killed = true;
          setTimeout(() => {
            events.push(`close:${idx}`);
            child.exitCode = 0;
            child.emit("close", 0, null);
          }, 25);
          return true;
        }) as MockChildProcess["kill"];
        // earlyExitError on the first stat poll so the catch path runs fast.
        void Promise.resolve().then(() => {
          child.stderr.emit("data", "boom\n");
          child.emit("exit", 1, null);
        });
      }
      return child;
    });

    const sleep = vi.fn(async () => undefined);
    const stat = vi.fn().mockRejectedValue(new Error("socket missing"));

    await expect(
      prepareKeybaseContainer(
        {
          autoOneshot: true,
          binary: "keybase",
          configPath: path.join(rootDir, "openclaw.json"),
          homeDir: path.join(rootDir, "keybase-home"),
          paperKeyFile: paperKeyPath,
          pidFile: path.join(rootDir, "runtime", "keybased.pid"),
          runtimeDir: path.join(rootDir, "runtime"),
          socketFile: path.join(rootDir, "runtime", "keybased.sock"),
          tmpDir: path.join(rootDir, "openclaw-tmp"),
          username: "claw_ll",
        },
        {
          readdir: vi.fn(async () => []),
          sleep,
          spawn: spawnMock as never,
          stat,
        },
      ),
    ).rejects.toThrow();

    expect(serviceChildren.length).toBe(5);
    // Every retry must close before the next spawn.
    for (let i = 0; i < 4; i++) {
      const closeIdx = events.indexOf(`close:${i}`);
      const nextSpawnIdx = events.indexOf(`spawn:${i + 1}`);
      expect(closeIdx).toBeGreaterThanOrEqual(0);
      expect(nextSpawnIdx).toBeGreaterThan(closeIdx);
    }
  });

  it("caps startKeybaseService at 5 attempts", async () => {
    vi.useFakeTimers();
    try {
      const rootDir = await mkdtemp(path.join(os.tmpdir(), "keybase-container-entrypoint-"));
      cleanups.push(async () => {
        await rm(rootDir, { recursive: true, force: true });
      });
      const paperKeyPath = path.join(rootDir, "paper-key.txt");
      await writeFile(paperKeyPath, "test paper key\n", "utf8");

      let serviceSpawns = 0;
      const spawnMock = vi.fn((_command: string, args: string[]) => {
        const child = createMockChildProcess();
        if (args.includes("service")) {
          serviceSpawns += 1;
          // Service child immediately exits with the "already running" stderr.
          // Set exitCode so awaitChildExit fast-paths instead of waiting 5s.
          void Promise.resolve().then(() => {
            child.stderr.emit("data", "server already running\n");
            child.exitCode = 1;
            child.emit("exit", 1, null);
          });
        } else {
          // runKeybaseCommand probe child — exits non-zero so the call rejects.
          void Promise.resolve().then(() => {
            child.stderr.emit("data", "Login required\n");
            child.exitCode = 1;
            child.emit("exit", 1, null);
          });
        }
        return child;
      });

      const sleep = vi.fn(async (ms: number) => {
        vi.advanceTimersByTime(ms);
      });
      // Pretend the keybase socket exists so waitForKeybaseSocket returns.
      const stat = vi.fn().mockResolvedValue({});

      const promise = prepareKeybaseContainer(
        {
          autoOneshot: true,
          binary: "keybase",
          configPath: path.join(rootDir, "openclaw.json"),
          homeDir: path.join(rootDir, "keybase-home"),
          paperKeyFile: paperKeyPath,
          pidFile: path.join(rootDir, "runtime", "keybased.pid"),
          runtimeDir: path.join(rootDir, "runtime"),
          socketFile: path.join(rootDir, "runtime", "keybased.sock"),
          tmpDir: path.join(rootDir, "openclaw-tmp"),
          username: "claw_ll",
        },
        {
          readdir: vi.fn(async () => []),
          sleep,
          spawn: spawnMock as never,
          stat,
        },
      ).catch((error: unknown) => error);

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/Keybase service did not become ready/);
      expect(serviceSpawns).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("findLingeringKeybasePids (H-8)", () => {
  type FakeProcEntry = {
    ppid: number;
    exe?: string;
    cmdline?: string;
    environ?: string;
  };

  function procFs(pids: Record<number, FakeProcEntry>) {
    const numericKeys = () => Object.keys(pids).filter((k) => /^\d+$/.test(k));
    return {
      readdir: vi.fn(async (p: string) => {
        if (p === "/proc") {
          return numericKeys();
        }
        return [];
      }),
      readFile: vi.fn(async (p: string, _enc?: BufferEncoding) => {
        const m = /^\/proc\/(\d+)\/(stat|cmdline|environ)$/.exec(p);
        if (!m) {
          const err: NodeJS.ErrnoException = new Error("ENOENT");
          err.code = "ENOENT";
          throw err;
        }
        const entry = pids[Number(m[1])];
        if (!entry) {
          const err: NodeJS.ErrnoException = new Error("ENOENT");
          err.code = "ENOENT";
          throw err;
        }
        if (m[2] === "cmdline") {
          return entry.cmdline ?? "";
        }
        if (m[2] === "environ") {
          return entry.environ ?? "";
        }
        // stat: pid (comm) S ppid pgrp ...
        return `${m[1]} (node) S ${entry.ppid} 0 0 0 0 0`;
      }),
      readlink: vi.fn(async (p: string) => {
        const m = /^\/proc\/(\d+)\/exe$/.exec(p);
        if (!m) {
          const err: NodeJS.ErrnoException = new Error("ENOENT");
          err.code = "ENOENT";
          throw err;
        }
        const entry = pids[Number(m[1])];
        if (!entry?.exe) {
          const err: NodeJS.ErrnoException = new Error("ENOENT");
          err.code = "ENOENT";
          throw err;
        }
        return entry.exe;
      }),
    };
  }

  function spyPid(pid: number) {
    const spy = vi.spyOn(process, "pid", "get").mockReturnValue(pid);
    cleanups.push(async () => {
      spy.mockRestore();
    });
  }

  it("skips processes outside the descendant chain", async () => {
    spyPid(100);
    const fs = procFs({
      100: { ppid: 0, exe: process.execPath },
      200: {
        ppid: 100,
        exe: "/usr/bin/keybase",
        cmdline: "/usr/bin/keybase\0service\0",
        environ: "KEYBASE_HOME=/home/node\0OTHER=1\0",
      },
      300: {
        ppid: 1,
        exe: "/usr/bin/keybase",
        cmdline: "/usr/bin/keybase\0chat\0",
        environ: "KEYBASE_HOME=/home/node\0",
      },
    });

    const pids = await findLingeringKeybasePids("/usr/bin/keybase", "/home/node", fs as never);
    expect(pids).toEqual([200]);
  });

  it("matches descendant processes when the configured binary is relative", async () => {
    spyPid(100);
    const fs = procFs({
      100: { ppid: 0, exe: process.execPath },
      200: {
        ppid: 100,
        exe: "/usr/bin/keybase",
        cmdline: "/usr/bin/keybase\0service\0",
        environ: "KEYBASE_HOME=/home/node\0OTHER=1\0",
      },
    });

    const pids = await findLingeringKeybasePids("keybase", "/home/node", fs as never);
    expect(pids).toEqual([200]);
  });

  it("skips processes whose exe does not match resolved binary", async () => {
    spyPid(100);
    const fs = procFs({
      100: { ppid: 0 },
      200: {
        ppid: 100,
        exe: "/usr/bin/cat",
        cmdline: "cat\0keybase\0",
        environ: "KEYBASE_HOME=/home/node\0",
      },
    });

    const pids = await findLingeringKeybasePids("/usr/bin/keybase", "/home/node", fs as never);
    expect(pids).toEqual([]);
  });

  it("skips processes without matching KEYBASE_HOME env", async () => {
    spyPid(100);
    const fs = procFs({
      100: { ppid: 0 },
      200: {
        ppid: 100,
        exe: "/usr/bin/keybase",
        cmdline: "/usr/bin/keybase\0",
        environ: "FOO=bar\0",
      },
    });

    const pids = await findLingeringKeybasePids("/usr/bin/keybase", "/home/node", fs as never);
    expect(pids).toEqual([]);
  });

  it("skips when readlink throws (default-deny)", async () => {
    spyPid(100);
    const fs = procFs({
      100: { ppid: 0 },
      200: {
        ppid: 100,
        cmdline: "/usr/bin/keybase\0",
        environ: "KEYBASE_HOME=/home/node\0",
      },
    });
    fs.readlink = vi.fn(async (p: string) => {
      const m = /^\/proc\/(\d+)\/exe$/.exec(p);
      if (m && m[1] === "200") {
        const err: NodeJS.ErrnoException = new Error("EACCES");
        err.code = "EACCES";
        throw err;
      }
      const err: NodeJS.ErrnoException = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    });

    const pids = await findLingeringKeybasePids("/usr/bin/keybase", "/home/node", fs as never);
    expect(pids).toEqual([]);
  });

  it("returns [] when running as PID 1 with non-matching /proc/1/exe", async () => {
    spyPid(1);
    const fs = procFs({
      1: { ppid: 0, exe: "/sbin/init" },
      200: {
        ppid: 1,
        exe: "/usr/bin/keybase",
        cmdline: "/usr/bin/keybase\0",
        environ: "KEYBASE_HOME=/home/node\0",
      },
    });

    const pids = await findLingeringKeybasePids("/usr/bin/keybase", "/home/node", fs as never);
    expect(pids).toEqual([]);
    // readdir must not have been consulted because the guard short-circuits.
    expect(fs.readdir).not.toHaveBeenCalled();
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
