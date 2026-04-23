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
        runCommand,
      },
    );

    expect(result).toEqual({ ok: true });
    expect(runCommand).toHaveBeenCalledWith(
      "/usr/local/bin/keybase",
      [
        "--home",
        "/tmp/keybase-home",
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
        { homeDir: "/tmp/keybase-home" },
      ),
    ).toEqual([
      "--home",
      "/tmp/keybase-home",
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
        { homeDir: "/tmp/keybase-home" },
      ),
    ).toEqual([
      "--home",
      "/tmp/keybase-home",
      "chat",
      "notification-settings",
      "-disable-typing=false",
    ]);
  });

  it("builds oneshot args without putting credentials on the command line", () => {
    expect(buildKeybaseOneshotArgs({ homeDir: "/tmp/keybase-home" })).toEqual([
      "--home",
      "/tmp/keybase-home",
      "oneshot",
    ]);
  });

  it("runs oneshot with username and paper key in the environment", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
    });

    await keybaseOneshot(
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
        runCommand,
      },
    );

    expect(runCommand).toHaveBeenCalledWith(
      "/usr/local/bin/keybase",
      ["--home", "/tmp/keybase-home", "oneshot"],
      {
        env: {
          KEYBASE_PAPERKEY: "paper key words",
          KEYBASE_SERVICE: "1",
          KEYBASE_USERNAME: "lbottestbot",
        },
        maxBuffer: undefined,
        timeoutMs: undefined,
      },
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
});
