import { afterEach, describe, expect, it, vi } from "vitest";
import { createStartAccountContext } from "../../../test/helpers/plugins/start-account-context.js";
import type { KeybaseListenEvent } from "./client.js";
import type { ResolvedKeybaseAccount } from "./types.js";

const mocks = vi.hoisted(() => ({
  startKeybaseApiListen: vi.fn(),
  ensureKeybaseAccountPrepared: vi.fn(async () => {}),
  sendKeybaseReaction: vi.fn(async () => ({ messageId: "reaction-1" })),
  sendKeybaseText: vi.fn(async () => ({ messageId: "sent-1" })),
  sendKeybaseTextChunks: vi.fn(async () => ({ messageId: "sent-1", sent: 1 })),
  syncKeybaseCommandAdvertisements: vi.fn(async () => ({ advertised: 1, cleared: false })),
  resolveKeybaseApproval: vi.fn(async () => {}),
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
    sendKeybaseReaction: mocks.sendKeybaseReaction,
    sendKeybaseText: mocks.sendKeybaseText,
    sendKeybaseTextChunks: mocks.sendKeybaseTextChunks,
    syncKeybaseCommandAdvertisements: mocks.syncKeybaseCommandAdvertisements,
  };
});

vi.mock("./exec-approval-resolver.js", async () => {
  const actual = await vi.importActual<typeof import("./exec-approval-resolver.js")>(
    "./exec-approval-resolver.js",
  );
  return {
    ...actual,
    resolveKeybaseApproval: mocks.resolveKeybaseApproval,
  };
});

const { keybaseGatewayAdapter } = await import("./gateway.js");
const { registerKeybaseApprovalReactionTarget, clearKeybaseApprovalReactionTargetsForTest } =
  await import("./approval-reactions.js");

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
    groupPolicy: "allowlist",
    groups: {},
    homeDir: undefined,
    name: undefined,
    paperKey: undefined,
    paperKeyFile: undefined,
    username: "openclaw",
    ...overrides,
  };
}

function createRuntimeHarness(options?: { commandAuthorized?: boolean }) {
  const recordInboundSession = vi.fn(async () => {});
  const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async ({ dispatcherOptions }) => {
    await dispatcherOptions.deliver({ text: "reply from agent" });
  });
  const commandAuthorized = options?.commandAuthorized ?? true;
  return {
    channelRuntime: {
      commands: {
        shouldComputeCommandAuthorized: vi.fn(() => true),
        resolveCommandAuthorizedFromAuthorizers: vi.fn(() => commandAuthorized),
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
  atMentionUsernames?: string[];
  body: string;
  conversationId?: string;
  id?: number;
  senderUsername?: string;
  teamName?: string;
  topicName?: string;
}): KeybaseListenEvent {
  return {
    type: "chat",
    raw: {},
    message: {
      id: params.id ?? 44,
      raw: {},
      conversationId: params.conversationId ?? "conv-1",
      atMentionUsernames: params.atMentionUsernames ?? [],
      channel: {
        name: params.teamName ?? "openclaw,sender",
        ...(params.topicName ? { membersType: "team", topicName: params.topicName } : {}),
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

function buildReactionEvent(params: {
  conversationId?: string;
  id?: number;
  messageId: number;
  reactionBody: string;
  senderUsername?: string;
  teamName?: string;
  topicName?: string;
}): KeybaseListenEvent {
  return {
    type: "chat",
    raw: {},
    message: {
      id: params.id ?? 45,
      raw: {},
      conversationId: params.conversationId ?? "conv-1",
      atMentionUsernames: [],
      channel: {
        name: params.teamName ?? "openclaw,sender",
        ...(params.topicName ? { membersType: "team", topicName: params.topicName } : {}),
      },
      sender: {
        username: params.senderUsername ?? "sender",
      },
      content: {
        type: "reaction",
        raw: {},
        reaction: {
          body: params.reactionBody,
          messageId: params.messageId,
        },
      },
    },
  };
}

describe("keybaseGatewayAdapter.startAccount", () => {
  afterEach(() => {
    mocks.startKeybaseApiListen.mockReset();
    mocks.ensureKeybaseAccountPrepared.mockClear();
    mocks.sendKeybaseReaction.mockClear();
    mocks.sendKeybaseText.mockClear();
    mocks.sendKeybaseTextChunks.mockClear();
    mocks.syncKeybaseCommandAdvertisements.mockClear();
    mocks.resolveKeybaseApproval.mockClear();
    clearKeybaseApprovalReactionTargetsForTest();
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
        messages: { ackReaction: "", ackReactionScope: "none" },
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
      expect(mocks.sendKeybaseTextChunks).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "conv:conv-2",
          text: "reply from agent",
          replyToId: "88",
        }),
      );
    });
    const dispatchCall = harness.dispatchReplyWithBufferedBlockDispatcher.mock.calls[0]?.[0] as
      | { ctx?: Record<string, unknown> }
      | undefined;
    expect(dispatchCall?.ctx?.OriginatingChannel).toBe("keybase");
    expect(dispatchCall?.ctx?.OriginatingTo).toBe("conv:conv-2");

    abort.abort();
    await task;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("blocks team messages that are not allowlisted", async () => {
    const stop = vi.fn();
    mocks.startKeybaseApiListen.mockReturnValue({
      child: {} as never,
      stop,
    });
    const harness = createRuntimeHarness();
    const abort = new AbortController();
    const ctx = createStartAccountContext({
      account: buildAccount({
        groupPolicy: "allowlist",
        groups: {},
      }),
      abortSignal: abort.signal,
    });
    Object.assign(ctx, { channelRuntime: harness.channelRuntime });

    const task = keybaseGatewayAdapter.startAccount!(ctx);

    await vi.waitFor(() => expect(mocks.startKeybaseApiListen).toHaveBeenCalledOnce());
    const args = mocks.startKeybaseApiListen.mock.calls[0]?.[0] as {
      onEvent: (event: KeybaseListenEvent) => void;
    };
    args.onEvent(
      buildTextEvent({
        body: "@openclaw hello",
        teamName: "lightninglabs",
        topicName: "lbottest",
      }),
    );

    await vi.waitFor(() => {
      expect(harness.recordInboundSession).not.toHaveBeenCalled();
      expect(harness.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    });

    abort.abort();
    await task;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("skips allowlisted team messages that do not mention the bot", async () => {
    const stop = vi.fn();
    mocks.startKeybaseApiListen.mockReturnValue({
      child: {} as never,
      stop,
    });
    const harness = createRuntimeHarness();
    const abort = new AbortController();
    const ctx = createStartAccountContext({
      account: buildAccount({
        groupPolicy: "allowlist",
        groups: {
          "team:lightninglabs#lbottest": {
            allowFrom: [],
          },
        },
      }),
      abortSignal: abort.signal,
    });
    Object.assign(ctx, { channelRuntime: harness.channelRuntime });

    const task = keybaseGatewayAdapter.startAccount!(ctx);

    await vi.waitFor(() => expect(mocks.startKeybaseApiListen).toHaveBeenCalledOnce());
    const args = mocks.startKeybaseApiListen.mock.calls[0]?.[0] as {
      onEvent: (event: KeybaseListenEvent) => void;
    };
    args.onEvent(
      buildTextEvent({
        body: "hello from the team chat",
        teamName: "lightninglabs",
        topicName: "lbottest",
      }),
    );

    await vi.waitFor(() => {
      expect(harness.recordInboundSession).not.toHaveBeenCalled();
      expect(harness.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    });

    abort.abort();
    await task;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("routes mentioned allowlisted team messages through the standard reply pipeline", async () => {
    const stop = vi.fn();
    mocks.startKeybaseApiListen.mockReturnValue({
      child: {} as never,
      stop,
    });
    const harness = createRuntimeHarness();
    const abort = new AbortController();
    const ctx = createStartAccountContext({
      account: buildAccount({
        groupPolicy: "allowlist",
        groups: {
          "team:lightninglabs#lbottest": {
            allowFrom: [],
            requireMention: true,
            systemPrompt: "Stay focused on infra tasks.",
            skills: ["infra"],
          },
        },
      }),
      abortSignal: abort.signal,
      cfg: {
        messages: { ackReaction: ":eyes:", ackReactionScope: "group-mentions" },
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
        body: "@openclaw hello from keybase",
        conversationId: "conv-team-1",
        id: 99,
        teamName: "lightninglabs",
        topicName: "lbottest",
        atMentionUsernames: ["openclaw"],
      }),
    );

    await vi.waitFor(() => {
      expect(harness.recordInboundSession).toHaveBeenCalledTimes(1);
      expect(harness.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
      expect(mocks.sendKeybaseTextChunks).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "conv:conv-team-1",
          text: "reply from agent",
          replyToId: "99",
        }),
      );
      expect(mocks.sendKeybaseReaction).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "conv:conv-team-1",
          messageId: "99",
          emoji: ":eyes:",
        }),
      );
    });

    const dispatchCall = harness.dispatchReplyWithBufferedBlockDispatcher.mock.calls[0]?.[0] as
      | { ctx?: Record<string, unknown>; replyOptions?: Record<string, unknown> }
      | undefined;
    expect(dispatchCall?.ctx?.ChatType).toBe("group");
    expect(dispatchCall?.ctx?.To).toBe("conv:conv-team-1");
    expect(dispatchCall?.ctx?.OriginatingTo).toBe("conv:conv-team-1");
    expect(dispatchCall?.ctx?.BotUsername).toBe("openclaw");
    expect(dispatchCall?.ctx?.WasMentioned).toBe(true);
    expect(dispatchCall?.ctx?.GroupSystemPrompt).toBe("Stay focused on infra tasks.");
    expect(dispatchCall?.replyOptions).toMatchObject({
      skillFilter: ["infra"],
    });

    abort.abort();
    await task;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("strips the bot mention from tagged group approval command bodies", async () => {
    const stop = vi.fn();
    mocks.startKeybaseApiListen.mockReturnValue({
      child: {} as never,
      stop,
    });
    const harness = createRuntimeHarness();
    const abort = new AbortController();
    const ctx = createStartAccountContext({
      account: buildAccount({
        groupPolicy: "allowlist",
        groups: {
          "team:lightninglabs#lbottest": {
            allowFrom: [],
            requireMention: true,
          },
        },
      }),
      abortSignal: abort.signal,
      cfg: {
        messages: { ackReaction: "", ackReactionScope: "none" },
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
        body: "@openclaw /approve abc12345 allow-once",
        conversationId: "conv-team-command",
        id: 100,
        teamName: "lightninglabs",
        topicName: "lbottest",
        atMentionUsernames: ["openclaw"],
      }),
    );

    await vi.waitFor(() => {
      expect(harness.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    });

    const dispatchCall = harness.dispatchReplyWithBufferedBlockDispatcher.mock.calls[0]?.[0] as
      | { ctx?: Record<string, unknown> }
      | undefined;
    expect(dispatchCall?.ctx?.RawBody).toBe("@openclaw /approve abc12345 allow-once");
    expect(dispatchCall?.ctx?.CommandBody).toBe("/approve abc12345 allow-once");
    expect(dispatchCall?.ctx?.BodyForCommands).toBe("/approve abc12345 allow-once");
    expect(dispatchCall?.ctx?.BotUsername).toBe("openclaw");

    abort.abort();
    await task;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("does not ack unauthorized tagged group control commands", async () => {
    const stop = vi.fn();
    mocks.startKeybaseApiListen.mockReturnValue({
      child: {} as never,
      stop,
    });
    const harness = createRuntimeHarness({ commandAuthorized: false });
    const abort = new AbortController();
    const ctx = createStartAccountContext({
      account: buildAccount({
        groupPolicy: "allowlist",
        groups: {
          "team:lightninglabs#lbottest": {
            allowFrom: [],
            requireMention: true,
          },
        },
      }),
      abortSignal: abort.signal,
      cfg: {
        messages: { ackReaction: ":eyes:", ackReactionScope: "group-mentions" },
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
        body: "@openclaw /subagents list",
        conversationId: "conv-team-unauthorized-command",
        id: 101,
        teamName: "lightninglabs",
        topicName: "lbottest",
        atMentionUsernames: ["openclaw"],
      }),
    );

    await vi.waitFor(() => {
      expect(harness.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    });
    expect(mocks.sendKeybaseReaction).not.toHaveBeenCalled();

    abort.abort();
    await task;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("resolves registered approval reactions from authorized Keybase senders", async () => {
    const stop = vi.fn();
    mocks.startKeybaseApiListen.mockReturnValue({
      child: {} as never,
      stop,
    });
    const harness = createRuntimeHarness();
    const abort = new AbortController();
    const ctx = createStartAccountContext({
      account: buildAccount({
        groupPolicy: "allowlist",
        groups: {
          "team:lightninglabs#lbottest": {
            allowFrom: [],
            requireMention: true,
          },
        },
        config: {
          execApprovals: {
            enabled: true,
            approvers: ["sender"],
          },
        },
      }),
      abortSignal: abort.signal,
      cfg: {
        channels: {
          keybase: {
            username: "openclaw",
            paperKey: "paper key",
            execApprovals: {
              enabled: true,
              approvers: ["sender"],
            },
          },
        },
      } as never,
    });
    Object.assign(ctx, { channelRuntime: harness.channelRuntime });
    registerKeybaseApprovalReactionTarget({
      accountId: "default",
      targetKey: "team:lightninglabs#lbottest",
      messageId: 700,
      approvalId: "approval-123",
      allowedDecisions: ["allow-once", "deny"],
    });

    const task = keybaseGatewayAdapter.startAccount!(ctx);

    await vi.waitFor(() => expect(mocks.startKeybaseApiListen).toHaveBeenCalledOnce());
    const args = mocks.startKeybaseApiListen.mock.calls[0]?.[0] as {
      onEvent: (event: KeybaseListenEvent) => void;
    };
    args.onEvent(
      buildReactionEvent({
        conversationId: "conv-team-command",
        messageId: 700,
        reactionBody: ":white_check_mark:",
        teamName: "LightningLabs",
        topicName: "lbottest",
      }),
    );

    await vi.waitFor(() => {
      expect(mocks.resolveKeybaseApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalId: "approval-123",
          decision: "allow-once",
          senderId: "sender",
        }),
      );
    });
    expect(harness.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();

    abort.abort();
    await task;
    expect(stop).toHaveBeenCalledOnce();
  });
});
