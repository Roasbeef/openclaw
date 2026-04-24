import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
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
    const runCommand = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
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
});
