import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  KEYBASE_API_LISTEN_MAX_RESTART_ATTEMPTS,
  KEYBASE_READLINE_MAX_LINE_LENGTH,
  KEYBASE_STDERR_RING_BYTES,
  appendKeybaseStderr,
  buildKeybaseApiListenArgs,
  buildKeybaseOneshotArgs,
  buildKeybaseNotificationSettingsArgs,
  keybaseOneshot,
  keybaseApiRequest,
  startKeybaseApiListen,
} from "./client.js";
import { buildKeybaseSendRequest, buildKeybaseTeamChannel } from "./protocol.js";

class MockListenChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill() {
    this.killed = true;
    return true;
  }
}

function createListenChild() {
  return new MockListenChild() as unknown as ReturnType<typeof startKeybaseApiListen>["child"];
}

class MockOneshotChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill() {
    this.killed = true;
    return true;
  }
}

describe("Keybase CLI transport", () => {
  it("runs chat api requests without shell interpolation", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: '{"result":{"ok":true}}',
      stderr: "",
    });

    const result = await keybaseApiRequest<{ ok: boolean }>(
      buildKeybaseSendRequest({
        channel: buildKeybaseTeamChannel("lightninglabs", "ops"),
        body: "hello",
      }),
      {
        binary: "/usr/local/bin/keybase",
        homeDir: "/tmp/keybase-home",
        pidFile: "/tmp/keybase.pid",
        runCommand,
        socketFile: "/tmp/keybase.sock",
      },
    );

    expect(result).toEqual({ ok: true });
    expect(runCommand).toHaveBeenCalledWith(
      "/usr/local/bin/keybase",
      [
        "--home",
        "/tmp/keybase-home",
        "--socket-file",
        "/tmp/keybase.sock",
        "--pid-file",
        "/tmp/keybase.pid",
        "chat",
        "api",
        "-m",
        '{"method":"send","params":{"options":{"channel":{"name":"lightninglabs","members_type":"team","topic_name":"ops"},"message":{"body":"hello"}}}}',
      ],
      {
        env: undefined,
        maxBuffer: undefined,
        timeoutMs: undefined,
      },
    );
  });

  it("builds api-listen args with deterministic channel filters", () => {
    expect(
      buildKeybaseApiListenArgs(
        {
          local: true,
          convs: true,
          filterChannels: [buildKeybaseTeamChannel("lightninglabs", "ops"), { name: "alice,bob" }],
        },
        {
          homeDir: "/tmp/keybase-home",
          pidFile: "/tmp/keybase.pid",
          socketFile: "/tmp/keybase.sock",
        },
      ),
    ).toEqual([
      "--home",
      "/tmp/keybase-home",
      "--socket-file",
      "/tmp/keybase.sock",
      "--pid-file",
      "/tmp/keybase.pid",
      "chat",
      "api-listen",
      "--local",
      "--convs",
      "--filter-channels",
      '[{"name":"lightninglabs","members_type":"team","topic_name":"ops"},{"name":"alice,bob"}]',
    ]);
  });

  it("builds notification-settings args from typing preference", () => {
    expect(
      buildKeybaseNotificationSettingsArgs(
        {
          enableTyping: true,
        },
        {
          homeDir: "/tmp/keybase-home",
          pidFile: "/tmp/keybase.pid",
          socketFile: "/tmp/keybase.sock",
        },
      ),
    ).toEqual([
      "--home",
      "/tmp/keybase-home",
      "--socket-file",
      "/tmp/keybase.sock",
      "--pid-file",
      "/tmp/keybase.pid",
      "chat",
      "notification-settings",
      "-disable-typing=false",
    ]);
  });

  it("builds oneshot args without putting credentials on the command line", () => {
    expect(
      buildKeybaseOneshotArgs(
        { username: "lbottestbot" },
        {
          homeDir: "/tmp/keybase-home",
          pidFile: "/tmp/keybase.pid",
          socketFile: "/tmp/keybase.sock",
        },
      ),
    ).toEqual([
      "--home",
      "/tmp/keybase-home",
      "--socket-file",
      "/tmp/keybase.sock",
      "--pid-file",
      "/tmp/keybase.pid",
      "service",
      "--oneshot-username",
      "lbottestbot",
    ]);
  });

  it("runs oneshot with username on the command line and the paper key on stdin", async () => {
    const child = new MockOneshotChild();
    const spawnCommand = vi.fn().mockReturnValue(child);
    const runCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValue({ stdout: "", stderr: "" });
    const stdinChunks: string[] = [];
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", (chunk: string) => {
      stdinChunks.push(chunk);
    });

    const pending = keybaseOneshot(
      {
        paperKey: "paper key words",
        username: "lbottestbot",
      },
      {
        binary: "/usr/local/bin/keybase",
        env: {
          KEYBASE_SERVICE: "1",
        },
        homeDir: "/tmp/keybase-home",
        pidFile: "/tmp/keybase.pid",
        runCommand,
        socketFile: "/tmp/keybase.sock",
        spawnCommand,
      },
    );
    await pending;

    expect(spawnCommand).toHaveBeenCalledWith(
      "/usr/local/bin/keybase",
      [
        "--home",
        "/tmp/keybase-home",
        "--socket-file",
        "/tmp/keybase.sock",
        "--pid-file",
        "/tmp/keybase.pid",
        "service",
        "--oneshot-username",
        "lbottestbot",
      ],
      {
        env: expect.objectContaining({
          KEYBASE_SERVICE: "1",
        }),
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    expect(runCommand).toHaveBeenCalledWith(
      "/usr/local/bin/keybase",
      [
        "--home",
        "/tmp/keybase-home",
        "--socket-file",
        "/tmp/keybase.sock",
        "--pid-file",
        "/tmp/keybase.pid",
        "chat",
        "notification-settings",
        "-disable-typing=true",
      ],
      {
        env: expect.objectContaining({
          KEYBASE_SERVICE: "1",
        }),
        maxBuffer: undefined,
        timeoutMs: 1000,
      },
    );
    expect(stdinChunks.join("")).toBe("paper key words\n");
  });

  it("attaches oneshot error/close listeners before writing to stdin", async () => {
    const child = new MockOneshotChild();
    const onceSpy = vi.spyOn(child, "once");
    const endSpy = vi.spyOn(child.stdin, "end");
    const spawnCommand = vi.fn().mockReturnValue(child);
    const runCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValue({ stdout: "", stderr: "" });

    await keybaseOneshot(
      { paperKey: "paper key words", username: "lbottestbot" },
      {
        binary: "/usr/local/bin/keybase",
        runCommand,
        spawnCommand,
      },
    );

    const errorIdx = onceSpy.mock.calls.findIndex(([event]) => event === "error");
    const closeIdx = onceSpy.mock.calls.findIndex(([event]) => event === "close");
    expect(errorIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThanOrEqual(0);

    const errorOrder = onceSpy.mock.invocationCallOrder[errorIdx];
    const closeOrder = onceSpy.mock.invocationCallOrder[closeIdx];
    const endOrder = endSpy.mock.invocationCallOrder[0];
    expect(endOrder).toBeDefined();
    expect(errorOrder).toBeLessThan(endOrder);
    expect(closeOrder).toBeLessThan(endOrder);
  });

  it("skips oneshot when the Keybase service is already ready", async () => {
    const spawnCommand = vi.fn();
    const runCommand = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    await expect(
      keybaseOneshot(
        { paperKey: "paper key words", username: "lbottestbot" },
        {
          binary: "/usr/local/bin/keybase",
          runCommand,
          spawnCommand,
        },
      ),
    ).resolves.toBeUndefined();

    expect(spawnCommand).not.toHaveBeenCalled();
    expect(runCommand).toHaveBeenCalledWith(
      "/usr/local/bin/keybase",
      ["chat", "notification-settings", "-disable-typing=true"],
      expect.objectContaining({
        timeoutMs: 1000,
      }),
    );
  });

  it("retries api-listen when the keybase service socket is still booting", async () => {
    vi.useFakeTimers();
    try {
      const firstChild = createListenChild();
      const secondChild = createListenChild();
      const spawnCommand = vi.fn().mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

      const handle = startKeybaseApiListen({
        bootstrapRetryDelayMs: 250,
        bootstrapRetryMaxAttempts: 2,
        onEvent: vi.fn(),
        spawnCommand,
      });

      firstChild.stderr.emit(
        "data",
        "dial unix /home/node/.keybase/.config/keybase/keybased.sock: connect: no such file or directory",
      );
      firstChild.emit("close", 2, null);

      await vi.advanceTimersByTimeAsync(250);

      expect(spawnCommand).toHaveBeenCalledTimes(2);
      expect(handle.child).toBe(secondChild);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts api-listen after an unexpected post-startup exit", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const firstChild = createListenChild();
      const secondChild = createListenChild();
      const spawnCommand = vi.fn().mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
      const onExit = vi.fn();

      const handle = startKeybaseApiListen({
        onEvent: vi.fn(),
        onExit,
        restartDelayMs: 250,
        restartOnExit: true,
        spawnCommand,
      });

      firstChild.emit("close", 0, null);
      expect(onExit).toHaveBeenCalledWith({ code: 0, signal: null, stderr: "" });
      expect(spawnCommand).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(250);

      expect(spawnCommand).toHaveBeenCalledTimes(2);
      expect(handle.child).toBe(secondChild);

      handle.stop();
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("cancels a scheduled api-listen restart when stopped", async () => {
    vi.useFakeTimers();
    try {
      const firstChild = createListenChild();
      const secondChild = createListenChild();
      const spawnCommand = vi.fn().mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

      const handle = startKeybaseApiListen({
        onEvent: vi.fn(),
        restartDelayMs: 250,
        restartOnExit: true,
        spawnCommand,
      });

      firstChild.emit("close", 1, null);
      handle.stop();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(spawnCommand).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps api-listen restart attempts at the default ceiling", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const children: MockListenChild[] = [];
      const spawnCommand = vi.fn().mockImplementation(() => {
        const child = new MockListenChild();
        children.push(child);
        return child;
      });
      const onExit = vi.fn();

      const handle = startKeybaseApiListen({
        onEvent: vi.fn(),
        onExit,
        restartDelayMs: 1,
        restartOnExit: true,
        spawnCommand,
      });

      const totalCloses = KEYBASE_API_LISTEN_MAX_RESTART_ATTEMPTS + 1;
      for (let i = 0; i < totalCloses; i++) {
        if (i > 0) {
          // Fire the pending restart timer without advancing past the
          // 30s uptime-reset threshold — each child must look short-lived.
          await vi.runOnlyPendingTimersAsync();
        }
        const child = children[i];
        expect(child).toBeDefined();
        child.emit("close", 0, null);
      }

      // No further restart should be scheduled after the 101st close.
      await vi.runOnlyPendingTimersAsync();

      expect(spawnCommand).toHaveBeenCalledTimes(KEYBASE_API_LISTEN_MAX_RESTART_ATTEMPTS + 1);
      expect(onExit).toHaveBeenCalledTimes(totalCloses);

      handle.stop();
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("applies exponential backoff between restarts", async () => {
    vi.useFakeTimers();
    // jitter = 0.8 + 0.5 * 0.4 = 1.0 → delay equals currentRestartDelayMs.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const children: MockListenChild[] = [];
      const spawnCommand = vi.fn().mockImplementation(() => {
        const child = new MockListenChild();
        children.push(child);
        return child;
      });

      const handle = startKeybaseApiListen({
        onEvent: vi.fn(),
        restartDelayMs: 100,
        restartOnExit: true,
        spawnCommand,
      });

      const expectedDelays = [100, 200, 400];
      for (const delay of expectedDelays) {
        const child = children[children.length - 1];
        const spawnsBefore = spawnCommand.mock.calls.length;
        child.emit("close", 0, null);
        // One ms short of the scheduled delay should not yet trigger spawn.
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(spawnCommand).toHaveBeenCalledTimes(spawnsBefore);
        await vi.advanceTimersByTimeAsync(1);
        expect(spawnCommand).toHaveBeenCalledTimes(spawnsBefore + 1);
      }

      handle.stop();
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("resets restart attempts after a long-uptime child exits", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const children: MockListenChild[] = [];
      const spawnCommand = vi.fn().mockImplementation(() => {
        const child = new MockListenChild();
        children.push(child);
        return child;
      });

      const handle = startKeybaseApiListen({
        onEvent: vi.fn(),
        restartDelayMs: 100,
        restartMaxAttempts: 3,
        restartOnExit: true,
        spawnCommand,
      });

      // Burn through the budget with three short-lived closes.
      for (let i = 0; i < 3; i++) {
        if (i > 0) {
          await vi.runOnlyPendingTimersAsync();
        }
        children[i].emit("close", 0, null);
      }
      // Spawn the fourth child without a long uptime first.
      await vi.runOnlyPendingTimersAsync();
      expect(spawnCommand).toHaveBeenCalledTimes(4);

      // Fourth child stays alive past the uptime-reset threshold.
      await vi.advanceTimersByTimeAsync(31_000);
      children[3].emit("close", 0, null);
      await vi.runOnlyPendingTimersAsync();

      // Reset should have re-armed restart budget and produced a fifth spawn.
      expect(spawnCommand).toHaveBeenCalledTimes(5);

      handle.stop();
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("appendKeybaseStderr keeps only the last N bytes", () => {
    expect(appendKeybaseStderr("", "hello", 16)).toBe("hello");
    expect(appendKeybaseStderr("hello ", "world", 16)).toBe("hello world");
    expect(appendKeybaseStderr("hello ", "world", 5)).toBe("world");
    expect(appendKeybaseStderr("a".repeat(8), "b".repeat(8), 10)).toBe("aabbbbbbbb");
    // Default ring size keeps tails of pathological input.
    const massive = "x".repeat(KEYBASE_STDERR_RING_BYTES * 2);
    const trimmed = appendKeybaseStderr("", massive);
    expect(trimmed).toHaveLength(KEYBASE_STDERR_RING_BYTES);
  });

  it("drops overlong api-listen stdout lines before parsing events", () => {
    const child = createListenChild();
    const spawnCommand = vi.fn().mockReturnValueOnce(child);
    const onError = vi.fn();
    const onEvent = vi.fn();
    const stdout = child.stdout as unknown as PassThrough;

    const handle = startKeybaseApiListen({
      onError,
      onEvent,
      spawnCommand,
    });

    stdout.write("x".repeat(KEYBASE_READLINE_MAX_LINE_LENGTH + 1));
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("exceeded"),
      }),
    );
    expect(onEvent).not.toHaveBeenCalled();

    stdout.write("\n");
    stdout.write(
      `${JSON.stringify({
        type: "chat",
        msg: {
          id: 1,
          conversation_id: "conv-1",
          channel: {
            name: "lightninglabs",
            members_type: "team",
            topic_name: "general",
          },
          sender: {
            username: "roasbeef",
          },
          content: {
            type: "text",
            text: {
              body: "@openclaw status",
            },
          },
        },
      })}\n`,
    );

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          conversationId: "conv-1",
        }),
      }),
    );

    handle.stop();
  });
});
