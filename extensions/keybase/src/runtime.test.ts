import { afterEach, describe, expect, it, vi } from "vitest";
import { resetKeybasePreparedAccountCache, sendKeybaseMedia, sendKeybaseText } from "./runtime.js";
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
      },
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
