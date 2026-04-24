import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeKeybaseReactionBody,
  resetKeybasePreparedAccountCache,
  sendKeybaseMedia,
  sendKeybaseReaction,
  sendKeybaseText,
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
});
