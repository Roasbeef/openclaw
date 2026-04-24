import type { NativeCommandSpec } from "openclaw/plugin-sdk/command-auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeKeybaseReactionBody,
  resolveKeybaseTextChunkLimit,
  resetKeybasePreparedAccountCache,
  sendKeybaseMedia,
  sendKeybaseReaction,
  sendKeybaseText,
  sendKeybaseTextChunks,
  syncKeybaseCommandAdvertisements,
} from "./runtime.js";
import type { ResolvedKeybaseAccount } from "./types.js";

const account: ResolvedKeybaseAccount = {
  accountId: "default",
  allowFrom: [],
  binary: "keybase",
  configured: true,
  config: {},
  defaultTo: "dm:alice",
  dmPolicy: "pairing",
  enableTyping: true,
  enabled: true,
  groupPolicy: "allowlist",
  groups: {},
  homeDir: "/tmp/keybase-home",
  pidFile: "/tmp/keybase.pid",
  socketFile: "/tmp/keybase.sock",
  username: "openclaw-bot",
  paperKey: "paper key words",
};

describe("Keybase runtime helpers", () => {
  afterEach(() => {
    resetKeybasePreparedAccountCache();
  });

  it("prepares the account and sends replies through the JSON API", async () => {
    const oneshot = vi.fn().mockResolvedValue(undefined);
    const configureNotificationSettings = vi.fn().mockResolvedValue(undefined);
    const apiRequest = vi.fn().mockResolvedValue({ id: 42 });

    const result = await sendKeybaseText({
      account,
      to: "team:lightninglabs#ops",
      text: "hello",
      replyToId: "41",
      deps: {
        apiRequest,
        configureNotificationSettings,
        oneshot,
      },
    });

    expect(result).toEqual({ messageId: "42" });
    expect(oneshot).toHaveBeenCalledTimes(1);
    expect(configureNotificationSettings).toHaveBeenCalledWith(
      { enableTyping: true },
      {
        binary: "keybase",
        homeDir: "/tmp/keybase-home",
        pidFile: "/tmp/keybase.pid",
        socketFile: "/tmp/keybase.sock",
      },
    );
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "send",
        params: {
          options: expect.objectContaining({
            reply_to: 41,
          }),
        },
      }),
      {
        binary: "keybase",
        homeDir: "/tmp/keybase-home",
        pidFile: "/tmp/keybase.pid",
        socketFile: "/tmp/keybase.sock",
      },
    );
  });

  it("normalizes common unicode ack reactions to Keybase shortcodes", () => {
    expect(normalizeKeybaseReactionBody("\u{1f440}")).toBe(":eyes:");
    expect(normalizeKeybaseReactionBody(":hourglass_flowing_sand:")).toBe(
      ":hourglass_flowing_sand:",
    );
  });

  it("chunks long text replies before sending through the JSON API", async () => {
    const apiRequest = vi
      .fn()
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 });

    const result = await sendKeybaseTextChunks({
      account: {
        ...account,
        textChunkLimit: 5,
      },
      to: "team:lightninglabs#ops",
      text: "alpha beta",
      replyToId: "41",
      deps: {
        apiRequest,
        chunkTextForOutbound: vi.fn(() => ["alpha", "beta"]),
        configureNotificationSettings: vi.fn().mockResolvedValue(undefined),
        oneshot: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(result).toEqual({ messageId: "102", sent: 2 });
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(apiRequest.mock.calls.map((call) => call[0].params.options.message.body)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(apiRequest.mock.calls.map((call) => call[0].params.options.reply_to)).toEqual([41, 41]);
  });

  it("uses the default Keybase chunk limit unless the account overrides it", () => {
    expect(resolveKeybaseTextChunkLimit(account)).toBe(4000);
    expect(resolveKeybaseTextChunkLimit({ ...account, textChunkLimit: 1234 })).toBe(1234);
  });

  it("sends reactions through the Keybase reaction API", async () => {
    const apiRequest = vi.fn().mockResolvedValue({ id: 43 });

    const result = await sendKeybaseReaction({
      account,
      to: "team:lightninglabs#ops",
      messageId: "41",
      emoji: "\u{1f440}",
      deps: {
        apiRequest,
        configureNotificationSettings: vi.fn().mockResolvedValue(undefined),
        oneshot: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(result).toEqual({ messageId: "43" });
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "reaction",
        params: {
          options: expect.objectContaining({
            message_id: 41,
            message: {
              body: ":eyes:",
            },
          }),
        },
      }),
      expect.any(Object),
    );
  });

  it("falls back to text delivery for remote media URLs", async () => {
    const apiRequest = vi.fn().mockResolvedValue({ id: 77 });

    const result = await sendKeybaseMedia({
      account,
      to: "dm:alice",
      text: "See this",
      mediaUrl: "https://example.com/image.png",
      deps: {
        apiRequest,
        configureNotificationSettings: vi.fn().mockResolvedValue(undefined),
        oneshot: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(result).toEqual({ messageId: "77" });
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "send",
        params: {
          options: expect.objectContaining({
            message: {
              body: "See this\n\nAttachment: https://example.com/image.png",
            },
          }),
        },
      }),
      expect.any(Object),
    );
  });

  it("sends local media as an attachment after any caption text", async () => {
    const apiRequest = vi.fn().mockResolvedValueOnce({ id: 11 }).mockResolvedValueOnce({ id: 12 });

    const result = await sendKeybaseMedia({
      account,
      to: "dm:alice",
      text: "log bundle",
      mediaUrl: "/tmp/logs.txt",
      deps: {
        apiRequest,
        configureNotificationSettings: vi.fn().mockResolvedValue(undefined),
        oneshot: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(result).toEqual({ messageId: "12" });
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "attach",
        params: {
          options: expect.objectContaining({
            filename: "/tmp/logs.txt",
            title: "logs.txt",
          }),
        },
      }),
      expect.any(Object),
    );
  });

  it("advertises OpenClaw slash commands through the Keybase command menu", async () => {
    const apiRequest = vi.fn().mockResolvedValue({});

    const result = await syncKeybaseCommandAdvertisements({
      account: {
        ...account,
        name: "Infra Claw",
        config: {
          commands: {
            alias: "infra-claw",
            native: true,
            nativeSkills: false,
          },
        },
      },
      cfg: {
        commands: {
          native: true,
          nativeSkills: false,
        },
      } as never,
      deps: {
        apiRequest,
        configureNotificationSettings: vi.fn().mockResolvedValue(undefined),
        listNativeCommandSpecsForConfig: vi.fn(
          () =>
            [
              {
                name: "status",
                description: "Show current status.",
                acceptsArgs: false,
              },
              {
                name: "model",
                description: "Show or set the model.",
                acceptsArgs: true,
                args: [
                  {
                    name: "name",
                    description: "Model name",
                    type: "string",
                    required: false,
                  },
                ],
              },
            ] satisfies NativeCommandSpec[],
        ),
        listProviderPluginCommandSpecs: vi.fn(() => [
          {
            name: "status",
            description: "Duplicate should be ignored.",
            acceptsArgs: false,
          },
          {
            name: "deploy",
            description: "Run deploy workflow.",
            acceptsArgs: true,
          },
        ]),
        listSkillCommandsForAgents: vi.fn(() => []),
        oneshot: vi.fn().mockResolvedValue(undefined),
        resolveNativeCommandsEnabled: vi.fn(() => true),
        resolveNativeSkillsEnabled: vi.fn(() => false),
      },
    });

    expect(result).toEqual({ advertised: 3, cleared: false });
    expect(apiRequest).toHaveBeenLastCalledWith(
      {
        method: "advertisecommands",
        params: {
          options: {
            alias: "infra-claw",
            advertisements: [
              {
                type: "public",
                commands: [
                  {
                    name: "/status",
                    description: "Show current status.",
                  },
                  {
                    name: "/model",
                    description: "Show or set the model.",
                    usage: "[name]",
                  },
                  {
                    name: "/deploy",
                    description: "Run deploy workflow.",
                    usage: "[args]",
                  },
                ],
              },
            ],
          },
        },
      },
      expect.any(Object),
    );
  });

  it("clears Keybase command advertisements when native commands are disabled", async () => {
    const apiRequest = vi.fn().mockResolvedValue({});

    const result = await syncKeybaseCommandAdvertisements({
      account: {
        ...account,
        config: {
          commands: {
            native: false,
          },
        },
      },
      cfg: {} as never,
      deps: {
        apiRequest,
        configureNotificationSettings: vi.fn().mockResolvedValue(undefined),
        listNativeCommandSpecsForConfig: vi.fn(() => []),
        listProviderPluginCommandSpecs: vi.fn(() => []),
        listSkillCommandsForAgents: vi.fn(() => []),
        oneshot: vi.fn().mockResolvedValue(undefined),
        resolveNativeCommandsEnabled: vi.fn(() => false),
        resolveNativeSkillsEnabled: vi.fn(() => false),
      },
    });

    expect(result).toEqual({ advertised: 0, cleared: true });
    expect(apiRequest).toHaveBeenLastCalledWith(
      {
        method: "clearcommands",
      },
      expect.any(Object),
    );
  });
});
