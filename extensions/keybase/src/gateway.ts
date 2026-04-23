import { isNormalizedSenderAllowed } from "openclaw/plugin-sdk/allow-from";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { EnvelopeFormatOptions } from "openclaw/plugin-sdk/channel-inbound";
import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-lifecycle";
import { createChannelPairingChallengeIssuer } from "openclaw/plugin-sdk/channel-pairing";
import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/direct-dm";
import { resolveInboundDirectDmAccessWithRuntime } from "openclaw/plugin-sdk/direct-dm-access";
import { runStoppablePassiveMonitor } from "openclaw/plugin-sdk/extension-shared";
import { startKeybaseApiListen } from "./client.js";
import type { KeybaseListenEvent } from "./listen.js";
import { ensureKeybaseAccountPrepared, sendKeybaseText } from "./runtime.js";
import { inferKeybaseInboundChatType, normalizeKeybaseUsername } from "./targets.js";
import type { ResolvedKeybaseAccount } from "./types.js";

type KeybaseChannelRuntime = {
  commands: {
    shouldComputeCommandAuthorized: (rawBody: string, cfg: ChannelGatewayContext["cfg"]) => boolean;
    resolveCommandAuthorizedFromAuthorizers: (params: {
      useAccessGroups: boolean;
      authorizers: Array<{ configured: boolean; allowed: boolean }>;
      modeWhenAccessGroupsOff?: "allow" | "deny" | "configured";
    }) => boolean;
  };
  pairing: {
    readAllowFromStore: (params: { channel: string; accountId: string }) => Promise<string[]>;
    upsertPairingRequest: (params: {
      channel: string;
      accountId: string;
      id: string;
      meta?: Record<string, string | undefined>;
    }) => Promise<{ code: string; created: boolean }>;
  };
  reply: {
    dispatchReplyWithBufferedBlockDispatcher: typeof import("openclaw/plugin-sdk/reply-runtime").dispatchReplyWithBufferedBlockDispatcher;
    finalizeInboundContext: typeof import("openclaw/plugin-sdk/reply-runtime").finalizeInboundContext;
    formatAgentEnvelope: (params: {
      channel: string;
      from?: string;
      body: string;
      envelope?: EnvelopeFormatOptions;
      previousTimestamp?: number | Date;
      timestamp?: number | Date;
    }) => string;
    resolveEnvelopeFormatOptions: (cfg: ChannelGatewayContext["cfg"]) => EnvelopeFormatOptions;
  };
  routing: {
    resolveAgentRoute: (params: {
      cfg: ChannelGatewayContext["cfg"];
      channel: string;
      accountId: string;
      peer: { kind: "direct"; id: string };
    }) => { agentId: string; accountId?: string; sessionKey: string };
  };
  session: {
    readSessionUpdatedAt: (params: { storePath: string; sessionKey: string }) => number | undefined;
    recordInboundSession: (params: Record<string, unknown>) => Promise<void>;
    resolveStorePath: (
      store?: string,
      params?: {
        agentId?: string;
        env?: NodeJS.ProcessEnv;
      },
    ) => string;
  };
};

function buildKeybaseCliOptions(account: ResolvedKeybaseAccount) {
  return {
    binary: account.binary,
    ...(account.homeDir ? { homeDir: account.homeDir } : {}),
  };
}

function buildConversationReplyTarget(conversationId: string): string {
  return `conv:${conversationId}`;
}

function resolveKeybaseChannelRuntime(
  ctx: ChannelGatewayContext<ResolvedKeybaseAccount>,
): KeybaseChannelRuntime {
  if (!ctx.channelRuntime) {
    throw new Error("Keybase inbound runtime is unavailable (missing channelRuntime)");
  }
  return ctx.channelRuntime as unknown as KeybaseChannelRuntime;
}

async function handleDirectMessage(params: {
  account: ResolvedKeybaseAccount;
  ctx: ChannelGatewayContext<ResolvedKeybaseAccount>;
  event: Extract<KeybaseListenEvent, { type: "chat" }>;
  statusSink: ReturnType<typeof createAccountStatusSink>;
}) {
  const message = params.event.message;
  if (!message || message.content.type !== "text") {
    return;
  }

  const senderId = normalizeKeybaseUsername(message.sender.username ?? "");
  if (!senderId) {
    params.ctx.log?.debug?.(
      `[${params.account.accountId}] dropping Keybase DM without sender username`,
    );
    return;
  }

  const accountUsername = normalizeKeybaseUsername(params.account.username ?? "");
  if (accountUsername && senderId === accountUsername) {
    return;
  }

  const rawBody = message.content.text?.body ?? "";
  const replyTarget = buildConversationReplyTarget(message.conversationId);
  const channelRuntime = resolveKeybaseChannelRuntime(params.ctx);
  const issuePairingChallenge = createChannelPairingChallengeIssuer({
    channel: "keybase",
    upsertPairingRequest: ({ id, meta }) =>
      channelRuntime.pairing.upsertPairingRequest({
        channel: "keybase",
        accountId: params.account.accountId,
        id,
        meta,
      }),
  });

  const resolvedAccess = await resolveInboundDirectDmAccessWithRuntime({
    cfg: params.ctx.cfg,
    channel: "keybase",
    accountId: params.account.accountId,
    dmPolicy: params.account.dmPolicy,
    allowFrom: params.account.allowFrom,
    senderId,
    rawBody,
    isSenderAllowed: (candidate, allowFrom) =>
      isNormalizedSenderAllowed({
        senderId: candidate,
        allowFrom,
      }),
    runtime: {
      shouldComputeCommandAuthorized: channelRuntime.commands.shouldComputeCommandAuthorized,
      resolveCommandAuthorizedFromAuthorizers:
        channelRuntime.commands.resolveCommandAuthorizedFromAuthorizers,
    },
    modeWhenAccessGroupsOff: "configured",
    readStoreAllowFrom: async (channel, accountId) =>
      await channelRuntime.pairing.readAllowFromStore({ channel, accountId }),
  });

  if (resolvedAccess.access.decision === "pairing") {
    await issuePairingChallenge({
      senderId,
      senderIdLine: `Your Keybase username: ${senderId}`,
      sendPairingReply: async (text) => {
        await sendKeybaseText({
          account: params.account,
          to: replyTarget,
          text,
        });
        params.statusSink({ lastOutboundAt: Date.now() });
      },
      onCreated: () => {
        params.ctx.log?.debug?.(
          `[${params.account.accountId}] keybase pairing request sender=${senderId}`,
        );
      },
      onReplyError: (error) => {
        params.ctx.log?.warn?.(
          `[${params.account.accountId}] keybase pairing reply failed for ${senderId}: ${String(error)}`,
        );
      },
    });
    return;
  }

  if (resolvedAccess.access.decision !== "allow") {
    params.ctx.log?.debug?.(
      `[${params.account.accountId}] blocked Keybase DM from ${senderId} (${resolvedAccess.access.reason})`,
    );
    return;
  }

  params.statusSink({ lastInboundAt: Date.now() });
  await dispatchInboundDirectDmWithRuntime({
    cfg: params.ctx.cfg,
    runtime: { channel: channelRuntime },
    channel: "keybase",
    channelLabel: "Keybase",
    accountId: params.account.accountId,
    peer: {
      kind: "direct",
      id: senderId,
    },
    senderId,
    senderAddress: `keybase:${senderId}`,
    recipientAddress: params.account.username ? `keybase:${params.account.username}` : replyTarget,
    conversationLabel: senderId,
    rawBody,
    messageId: String(message.id),
    timestamp: message.sentAtMs ?? (message.sentAt ? message.sentAt * 1000 : undefined),
    commandAuthorized: resolvedAccess.commandAuthorized,
    deliver: async (payload) => {
      const text =
        payload && typeof payload === "object" && "text" in payload
          ? ((payload as { text?: string }).text ?? "")
          : "";
      if (!text.trim()) {
        return;
      }
      await sendKeybaseText({
        account: params.account,
        to: replyTarget,
        text,
        replyToId: String(message.id),
      });
      params.statusSink({ lastOutboundAt: Date.now() });
    },
    onRecordError: (error) => {
      params.ctx.log?.error?.(
        `[${params.account.accountId}] keybase session record failed for ${senderId}: ${String(error)}`,
      );
    },
    onDispatchError: (error, info) => {
      params.ctx.log?.error?.(
        `[${params.account.accountId}] keybase ${info.kind} reply failed for ${senderId}: ${String(error)}`,
      );
    },
  });
}

async function handleKeybaseListenEvent(params: {
  account: ResolvedKeybaseAccount;
  ctx: ChannelGatewayContext<ResolvedKeybaseAccount>;
  event: KeybaseListenEvent;
  statusSink: ReturnType<typeof createAccountStatusSink>;
}) {
  if (params.event.type !== "chat" || !params.event.message) {
    return;
  }
  if (params.event.message.content.type !== "text") {
    return;
  }
  if (inferKeybaseInboundChatType({ channel: params.event.message.channel }) !== "direct") {
    params.ctx.log?.debug?.(
      `[${params.account.accountId}] skipping Keybase group message until group inbound routing is wired`,
    );
    return;
  }
  await handleDirectMessage({
    account: params.account,
    ctx: params.ctx,
    event: params.event,
    statusSink: params.statusSink,
  });
}

export const keybaseGatewayAdapter: NonNullable<ChannelPlugin<ResolvedKeybaseAccount>["gateway"]> =
  {
    startAccount: async (ctx: ChannelGatewayContext<ResolvedKeybaseAccount>) => {
      const account = ctx.account;
      const statusSink = createAccountStatusSink({
        accountId: account.accountId,
        setStatus: ctx.setStatus,
      });

      statusSink({
        configured: account.configured,
        enabled: account.enabled,
        dmPolicy: account.dmPolicy,
      });

      await ensureKeybaseAccountPrepared(account);

      await runStoppablePassiveMonitor({
        abortSignal: ctx.abortSignal,
        start: async () =>
          startKeybaseApiListen({
            ...buildKeybaseCliOptions(account),
            listen: {
              hideExploding: true,
            },
            onEvent: (event) => {
              void handleKeybaseListenEvent({ account, ctx, event, statusSink }).catch((error) => {
                ctx.log?.error?.(
                  `[${account.accountId}] keybase inbound handler failed: ${String(error)}`,
                );
                statusSink({ lastError: String(error) });
              });
            },
            onError: (error) => {
              ctx.log?.error?.(
                `[${account.accountId}] keybase api-listen failed: ${String(error)}`,
              );
              statusSink({ lastError: String(error) });
            },
            onExit: ({ code, signal, stderr }) => {
              if (ctx.abortSignal.aborted) {
                return;
              }
              const details = [`code=${code ?? "null"}`, `signal=${signal ?? "null"}`];
              const trimmedStderr = stderr.trim();
              if (trimmedStderr) {
                details.push(trimmedStderr);
              }
              statusSink({ lastError: `keybase api-listen exited (${details.join(", ")})` });
            },
          }),
      });
    },
  };
