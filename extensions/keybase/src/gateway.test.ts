import { afterEach, describe, expect, it, vi } from "vitest";
import { createStartAccountContext } from "../../../test/helpers/plugins/start-account-context.js";
import type { KeybaseListenEvent } from "./client.js";
import type { ResolvedKeybaseAccount } from "./types.js";

const mocks = vi.hoisted(() => ({
  startKeybaseApiListen: vi.fn(),
  ensureKeybaseAccountPrepared: vi.fn(async () => {}),
  sendKeybaseText: vi.fn(async () => ({ messageId: "sent-1" })),
}));

vi.mock("./client.js", async () => {
  const actual = await vi.importActual<typeof import("./client.js")>("./client.js");
  return {
    ...actual,
    startKeybaseApiListen: mocks.startKeybaseApiListen,
  };
});

vi.mock("./runtime.js", async () => {
  const actual = await vi.importActual<typeof import("./runtime.js")>("./runtime.js");
  return {
    ...actual,
    ensureKeybaseAccountPrepared: mocks.ensureKeybaseAccountPrepared,
    sendKeybaseText: mocks.sendKeybaseText,
  };
});

const { keybaseGatewayAdapter } = await import("./gateway.js");

function buildAccount(overrides: Partial<ResolvedKeybaseAccount> = {}): ResolvedKeybaseAccount {
  return {
    accountId: "default",
    allowFrom: [],
    binary: "keybase",
    configured: true,
    config: {},
    defaultTo: undefined,
    dmPolicy: "pairing",
    enableTyping: false,
    enabled: true,
    homeDir: undefined,
    name: undefined,
    paperKey: undefined,
    paperKeyFile: undefined,
    username: "openclaw",
    ...overrides,
  };
}

function createRuntimeHarness() {
  const recordInboundSession = vi.fn(async () => {});
  const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async ({ dispatcherOptions }) => {
    await dispatcherOptions.deliver({ text: "reply from agent" });
  });
  return {
    channelRuntime: {
      commands: {
        shouldComputeCommandAuthorized: vi.fn(() => true),
        resolveCommandAuthorizedFromAuthorizers: vi.fn(() => true),
      },
      routing: {
        resolveAgentRoute: vi.fn(({ accountId, peer }) => ({
          agentId: "agent-keybase",
          accountId,
          sessionKey: `keybase:${peer.id}`,
        })),
      },
      session: {
        resolveStorePath: vi.fn(() => "/tmp/keybase-session-store"),
        readSessionUpdatedAt: vi.fn(() => undefined),
        recordInboundSession,
      },
      reply: {
        formatAgentEnvelope: vi.fn(({ body }) => `envelope:${body}`),
        resolveEnvelopeFormatOptions: vi.fn(() => ({ mode: "agent" })),
        finalizeInboundContext: vi.fn((ctx) => ctx),
        dispatchReplyWithBufferedBlockDispatcher,
      },
      pairing: {
        readAllowFromStore: vi.fn(async () => []),
        upsertPairingRequest: vi.fn(async () => ({ code: "PAIR1234", created: true })),
      },
    } as never,
    recordInboundSession,
    dispatchReplyWithBufferedBlockDispatcher,
  };
}

function buildTextEvent(params: {
  body: string;
  conversationId?: string;
  id?: number;
  senderUsername?: string;
}): KeybaseListenEvent {
  return {
    type: "chat",
    raw: {},
    message: {
      id: params.id ?? 44,
      raw: {},
      conversationId: params.conversationId ?? "conv-1",
      atMentionUsernames: [],
      channel: {
        name: "openclaw,sender",
      },
      sender: {
        username: params.senderUsername ?? "sender",
      },
      content: {
        type: "text",
        raw: {},
        text: {
          body: params.body,
        },
      },
    },
  };
}

describe("keybaseGatewayAdapter.startAccount", () => {
  afterEach(() => {
    mocks.startKeybaseApiListen.mockReset();
    mocks.ensureKeybaseAccountPrepared.mockClear();
    mocks.sendKeybaseText.mockClear();
  });

  it("issues a pairing challenge for unknown DM senders", async () => {
    const stop = vi.fn();
    mocks.startKeybaseApiListen.mockReturnValue({
      child: {} as never,
      stop,
    });
    const harness = createRuntimeHarness();
    const abort = new AbortController();
    const ctx = createStartAccountContext({
      account: buildAccount({ dmPolicy: "pairing", allowFrom: [] }),
      abortSignal: abort.signal,
    });
    Object.assign(ctx, { channelRuntime: harness.channelRuntime });

    const task = keybaseGatewayAdapter.startAccount!(ctx);

    await vi.waitFor(() => expect(mocks.startKeybaseApiListen).toHaveBeenCalledOnce());
    const args = mocks.startKeybaseApiListen.mock.calls[0]?.[0] as {
      onEvent: (event: KeybaseListenEvent) => void;
    };
    args.onEvent(buildTextEvent({ body: "hello" }));

    await vi.waitFor(() => {
      const firstCall = (mocks.sendKeybaseText.mock.calls as Array<Array<unknown>>)[0]?.[0] as
        | { to?: string; text?: string }
        | undefined;
      expect(mocks.sendKeybaseText).toHaveBeenCalledTimes(1);
      expect(firstCall).toMatchObject({
        to: "conv:conv-1",
      });
      expect(String(firstCall?.text)).toContain("Pairing code:");
    });

    abort.abort();
    await task;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("routes allowed DMs through the standard reply pipeline", async () => {
    const stop = vi.fn();
    mocks.startKeybaseApiListen.mockReturnValue({
      child: {} as never,
      stop,
    });
    const harness = createRuntimeHarness();
    const abort = new AbortController();
    const ctx = createStartAccountContext({
      account: buildAccount({
        dmPolicy: "allowlist",
        allowFrom: ["sender"],
      }),
      abortSignal: abort.signal,
      cfg: {
        session: { store: { type: "jsonl" } },
        commands: { useAccessGroups: true },
      } as never,
    });
    Object.assign(ctx, { channelRuntime: harness.channelRuntime });

    const task = keybaseGatewayAdapter.startAccount!(ctx);

    await vi.waitFor(() => expect(mocks.startKeybaseApiListen).toHaveBeenCalledOnce());
    const args = mocks.startKeybaseApiListen.mock.calls[0]?.[0] as {
      onEvent: (event: KeybaseListenEvent) => void;
    };
    args.onEvent(
      buildTextEvent({
        body: "hello from keybase",
        conversationId: "conv-2",
        id: 88,
      }),
    );

    await vi.waitFor(() => {
      expect(harness.recordInboundSession).toHaveBeenCalledTimes(1);
      expect(harness.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
      expect(mocks.sendKeybaseText).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "conv:conv-2",
          text: "reply from agent",
          replyToId: "88",
        }),
      );
    });

    abort.abort();
    await task;
    expect(stop).toHaveBeenCalledOnce();
  });
});
