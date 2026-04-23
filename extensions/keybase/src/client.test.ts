import { describe, expect, it, vi } from "vitest";
import {
  buildKeybaseApiListenArgs,
  buildKeybaseNotificationSettingsArgs,
  keybaseApiRequest,
} from "./client.js";
import { buildKeybaseSendRequest, buildKeybaseTeamChannel } from "./protocol.js";

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
});
