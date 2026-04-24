import { isNormalizedSenderAllowed } from "openclaw/plugin-sdk/allow-from";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { resolveAckReaction, shouldAckReaction } from "openclaw/plugin-sdk/channel-feedback";
import {
  buildMentionRegexes,
  matchesMentionPatterns,
  resolveInboundMentionDecision,
  type EnvelopeFormatOptions,
} from "openclaw/plugin-sdk/channel-inbound";
import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-lifecycle";
import { createChannelPairingChallengeIssuer } from "openclaw/plugin-sdk/channel-pairing";
import {
  hasControlCommand,
  resolveSenderCommandAuthorizationWithRuntime,
  shouldHandleTextCommands,
} from "openclaw/plugin-sdk/command-auth";
import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/direct-dm";
import { resolveInboundDirectDmAccessWithRuntime } from "openclaw/plugin-sdk/direct-dm-access";
import { runStoppablePassiveMonitor } from "openclaw/plugin-sdk/extension-shared";
import { resolveOpenProviderRuntimeGroupPolicy } from "openclaw/plugin-sdk/group-access";
import { dispatchInboundReplyWithBase } from "openclaw/plugin-sdk/inbound-reply-dispatch";
import { startKeybaseApiListen } from "./client.js";
import {
  resolveKeybaseGroupAccess,
  resolveKeybaseGroupAllowFrom,
  resolveKeybaseGroupMatch,
  resolveKeybaseGroupRequireMention,
  resolveKeybaseGroupSkillFilter,
  resolveKeybaseGroupSystemPrompt,
} from "./groups.js";
import type { KeybaseListenEvent } from "./listen.js";
import { stripKeybaseBotMention } from "./mentions.js";
import {
  ensureKeybaseAccountPrepared,
  sendKeybaseReaction,
  sendKeybaseText,
  sendKeybaseTextChunks,
  syncKeybaseCommandAdvertisements,
} from "./runtime.js";
import {
  buildKeybaseInboundGroupId,
  inferKeybaseInboundChatType,
  normalizeKeybaseGroupKey,
  normalizeKeybaseUsername,
} from "./targets.js";
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
      peer: { kind: "direct" | "channel"; id: string };
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
    ...(account.socketFile ? { socketFile: account.socketFile } : {}),
    ...(account.pidFile ? { pidFile: account.pidFile } : {}),
  };
}

function buildConversationReplyTarget(conversationId: string): string {
  return `conv:${conversationId}`;
}

function maybeSendKeybaseAckReaction(params: {
  account: ResolvedKeybaseAccount;
  ctx: ChannelGatewayContext<ResolvedKeybaseAccount>;
  effectiveWasMentioned: boolean;
  isDirect: boolean;
  isGroup: boolean;
  isMentionableGroup: boolean;
  messageId: string;
  requireMention: boolean;
  routeAgentId: string;
  target: string;
  canDetectMention?: boolean;
  shouldBypassMention?: boolean;
}) {
  const emoji = resolveAckReaction(params.ctx.cfg, params.routeAgentId, {
    channel: "keybase",
    accountId: params.account.accountId,
  });
  if (!emoji) {
    return;
  }
  const shouldSend = shouldAckReaction({
    scope: params.ctx.cfg.messages?.ackReactionScope,
    isDirect: params.isDirect,
    isGroup: params.isGroup,
    isMentionableGroup: params.isMentionableGroup,
    requireMention: params.requireMention,
    canDetectMention: params.canDetectMention ?? true,
    effectiveWasMentioned: params.effectiveWasMentioned,
    shouldBypassMention: params.shouldBypassMention,
  });
  if (!shouldSend) {
    return;
  }
  void sendKeybaseReaction({
    account: params.account,
    to: params.target,
    messageId: params.messageId,
    emoji,
  }).catch((error) => {
    params.ctx.log?.debug?.(
      `[${params.account.accountId}] keybase ack reaction failed for ${params.target}/${params.messageId}: ${String(error)}`,
    );
  });
}

function resolveKeybaseChannelRuntime(
  ctx: ChannelGatewayContext<ResolvedKeybaseAccount>,
): KeybaseChannelRuntime {
  if (!ctx.channelRuntime) {
    throw new Error("Keybase inbound runtime is unavailable (missing channelRuntime)");
  }
  return ctx.channelRuntime as unknown as KeybaseChannelRuntime;
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveKeybaseGroupMentionState(params: {
  account: ResolvedKeybaseAccount;
  cfg: ChannelGatewayContext["cfg"];
  message: NonNullable<Extract<KeybaseListenEvent, { type: "chat" }>["message"]>;
  rawBody: string;
}): {
  canDetectMention: boolean;
  hasAnyMention: boolean;
  wasMentioned: boolean;
} {
  const mentionRegexes = buildMentionRegexes(params.cfg);
  const normalizedMentions = params.message.atMentionUsernames
    .map((entry) => normalizeKeybaseUsername(entry ?? ""))
    .filter((entry): entry is string => Boolean(entry));
  const accountUsername = normalizeKeybaseUsername(params.account.username ?? "");
  const botUsername = normalizeKeybaseUsername(params.message.botUsername ?? "");
  const explicitUsernames = [accountUsername, botUsername].filter((entry): entry is string =>
    Boolean(entry),
  );
  const explicitMention = explicitUsernames.some((username) =>
    new RegExp(`(^|\\W)@?${escapeRegexLiteral(username)}(?=\\W|$)`, "i").test(params.rawBody),
  );
  const nativeMention = explicitUsernames.some((username) => normalizedMentions.includes(username));
  const patternMention = matchesMentionPatterns(params.rawBody, mentionRegexes);
  const hasAnyMention =
    normalizedMentions.length > 0 ||
    explicitMention ||
    patternMention ||
    Boolean(params.message.channelMention?.trim());

  return {
    canDetectMention: true,
    hasAnyMention,
    wasMentioned:
      nativeMention || explicitMention || patternMention || Boolean(params.message.channelMention),
  };
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
  const commandBody = stripKeybaseBotMention(rawBody, params.account.username ?? undefined);
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

  const route = channelRuntime.routing.resolveAgentRoute({
    cfg: params.ctx.cfg,
    channel: "keybase",
    accountId: params.account.accountId,
    peer: {
      kind: "direct",
      id: senderId,
    },
  });
  maybeSendKeybaseAckReaction({
    account: params.account,
    ctx: params.ctx,
    effectiveWasMentioned: false,
    isDirect: true,
    isGroup: false,
    isMentionableGroup: false,
    messageId: String(message.id),
    requireMention: false,
    routeAgentId: route.agentId,
    target: replyTarget,
  });
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
    commandBody,
    messageId: String(message.id),
    timestamp: message.sentAtMs ?? (message.sentAt ? message.sentAt * 1000 : undefined),
    commandAuthorized: resolvedAccess.commandAuthorized,
    extraContext: {
      BotUsername: params.account.username ?? undefined,
    },
    deliver: async (payload) => {
      const text =
        payload && typeof payload === "object" && "text" in payload
          ? ((payload as { text?: string }).text ?? "")
          : "";
      if (!text.trim()) {
        return;
      }
      await sendKeybaseTextChunks({
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

async function handleGroupMessage(params: {
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
      `[${params.account.accountId}] dropping Keybase group message without sender username`,
    );
    return;
  }

  const accountUsername = normalizeKeybaseUsername(params.account.username ?? "");
  if (accountUsername && senderId === accountUsername) {
    return;
  }

  const rawBody = message.content.text?.body ?? "";
  const groupId =
    normalizeKeybaseGroupKey(buildKeybaseInboundGroupId({ channel: message.channel }) ?? "") ??
    undefined;
  if (!groupId) {
    params.ctx.log?.debug?.(
      `[${params.account.accountId}] dropping Keybase group message without team/topic route`,
    );
    return;
  }

  const { groupPolicy } = resolveOpenProviderRuntimeGroupPolicy({
    providerConfigPresent: params.ctx.cfg.channels?.keybase !== undefined,
    groupPolicy: params.account.groupPolicy,
    defaultGroupPolicy: params.ctx.cfg.channels?.defaults?.groupPolicy,
  });
  const groupMatch = resolveKeybaseGroupMatch({
    groups: params.account.groups,
    groupId,
  });
  const groupAccess = resolveKeybaseGroupAccess({
    groupPolicy,
    groupMatch,
  });
  if (!groupAccess.allowed) {
    params.ctx.log?.debug?.(
      `[${params.account.accountId}] blocked Keybase group ${groupId} (${groupAccess.reason})`,
    );
    return;
  }

  const groupAllowFrom = resolveKeybaseGroupAllowFrom(groupMatch);
  if (
    groupAllowFrom.length > 0 &&
    !isNormalizedSenderAllowed({
      senderId,
      allowFrom: groupAllowFrom,
    })
  ) {
    params.ctx.log?.debug?.(
      `[${params.account.accountId}] blocked Keybase group sender ${senderId} for ${groupId}`,
    );
    return;
  }

  const channelRuntime = resolveKeybaseChannelRuntime(params.ctx);
  const botUsername = params.account.username ?? message.botUsername ?? undefined;
  const commandCheckText = stripKeybaseBotMention(rawBody, botUsername);
  const allowTextCommands = shouldHandleTextCommands({
    cfg: params.ctx.cfg,
    surface: "keybase",
  });
  const hasControlCommandInMessage = hasControlCommand(commandCheckText, params.ctx.cfg, {
    botUsername,
  });
  const commandBodyText = hasControlCommandInMessage ? commandCheckText : rawBody;
  const commandAccess = await resolveSenderCommandAuthorizationWithRuntime({
    cfg: params.ctx.cfg,
    rawBody,
    isGroup: true,
    dmPolicy: params.account.dmPolicy,
    configuredAllowFrom: params.account.allowFrom,
    configuredGroupAllowFrom: groupAllowFrom,
    senderId,
    isSenderAllowed: (candidate, allowFrom) =>
      isNormalizedSenderAllowed({
        senderId: candidate,
        allowFrom,
      }),
    readAllowFromStore: async () =>
      await channelRuntime.pairing.readAllowFromStore({
        channel: "keybase",
        accountId: params.account.accountId,
      }),
    runtime: {
      shouldComputeCommandAuthorized: channelRuntime.commands.shouldComputeCommandAuthorized,
      resolveCommandAuthorizedFromAuthorizers:
        channelRuntime.commands.resolveCommandAuthorizedFromAuthorizers,
    },
  });

  const requireMention = resolveKeybaseGroupRequireMention(groupMatch);
  const mentionState = resolveKeybaseGroupMentionState({
    account: params.account,
    cfg: params.ctx.cfg,
    message,
    rawBody,
  });
  const mentionDecision = resolveInboundMentionDecision({
    facts: mentionState,
    policy: {
      isGroup: true,
      requireMention,
      allowTextCommands,
      hasControlCommand: hasControlCommandInMessage,
      commandAuthorized: commandAccess.commandAuthorized === true,
    },
  });
  if (mentionDecision.shouldSkip) {
    params.ctx.log?.debug?.(
      `[${params.account.accountId}] skipped Keybase group ${groupId} (missing mention)`,
    );
    return;
  }

  const route = channelRuntime.routing.resolveAgentRoute({
    cfg: params.ctx.cfg,
    channel: "keybase",
    accountId: params.account.accountId,
    peer: {
      kind: "channel",
      id: groupId,
    },
  });
  const storePath = channelRuntime.session.resolveStorePath(params.ctx.cfg.session?.store, {
    agentId: route.agentId,
  });
  const previousTimestamp = channelRuntime.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const envelopeOptions = channelRuntime.reply.resolveEnvelopeFormatOptions(params.ctx.cfg);
  const groupLabel = message.channel.topicName
    ? `${message.channel.name}#${message.channel.topicName}`
    : message.channel.name;
  const body = channelRuntime.reply.formatAgentEnvelope({
    channel: "Keybase",
    from: groupLabel,
    body: rawBody,
    envelope: envelopeOptions,
    previousTimestamp,
    timestamp: message.sentAtMs ?? (message.sentAt ? message.sentAt * 1000 : undefined),
  });
  const ctxPayload = channelRuntime.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: commandBodyText,
    BodyForCommands: commandBodyText,
    From: `keybase:group:${groupId}`,
    To: `keybase:${groupId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "group",
    ConversationLabel: groupLabel,
    SenderName: message.sender.username ?? undefined,
    SenderId: senderId,
    BotUsername: botUsername,
    GroupSubject: groupLabel,
    GroupChannel: message.channel.topicName ?? undefined,
    GroupSpace: message.channel.name,
    GroupSystemPrompt: resolveKeybaseGroupSystemPrompt(groupMatch),
    Provider: "keybase",
    Surface: "keybase",
    WasMentioned: mentionDecision.effectiveWasMentioned,
    MessageSid: String(message.id),
    Timestamp: message.sentAtMs ?? (message.sentAt ? message.sentAt * 1000 : undefined),
    OriginatingChannel: "keybase",
    OriginatingTo: `keybase:${groupId}`,
    CommandAuthorized: commandAccess.commandAuthorized,
  });

  maybeSendKeybaseAckReaction({
    account: params.account,
    ctx: params.ctx,
    effectiveWasMentioned: mentionDecision.effectiveWasMentioned,
    isDirect: false,
    isGroup: true,
    isMentionableGroup: true,
    messageId: String(message.id),
    requireMention,
    routeAgentId: route.agentId,
    target: buildConversationReplyTarget(message.conversationId),
    canDetectMention: mentionState.canDetectMention,
    shouldBypassMention: mentionDecision.shouldBypassMention,
  });
  params.statusSink({ lastInboundAt: Date.now() });
  await dispatchInboundReplyWithBase({
    cfg: params.ctx.cfg,
    channel: "keybase",
    accountId: params.account.accountId,
    route,
    storePath,
    ctxPayload,
    core: {
      channel: {
        session: {
          recordInboundSession: channelRuntime.session.recordInboundSession as never,
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher:
            channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher,
        },
      },
    },
    deliver: async (payload) => {
      const text =
        payload && typeof payload === "object" && "text" in payload
          ? ((payload as { text?: string }).text ?? "")
          : "";
      if (!text.trim()) {
        return;
      }
      await sendKeybaseTextChunks({
        account: params.account,
        to: buildConversationReplyTarget(message.conversationId),
        text,
        replyToId: String(message.id),
      });
      params.statusSink({ lastOutboundAt: Date.now() });
    },
    onRecordError: (error) => {
      params.ctx.log?.error?.(
        `[${params.account.accountId}] keybase session record failed for group ${groupId}: ${String(error)}`,
      );
    },
    onDispatchError: (error, info) => {
      params.ctx.log?.error?.(
        `[${params.account.accountId}] keybase ${info.kind} reply failed for group ${groupId}: ${String(error)}`,
      );
    },
    replyOptions: {
      skillFilter: resolveKeybaseGroupSkillFilter(groupMatch),
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
  if (inferKeybaseInboundChatType({ channel: params.event.message.channel }) === "direct") {
    await handleDirectMessage({
      account: params.account,
      ctx: params.ctx,
      event: params.event,
      statusSink: params.statusSink,
    });
    return;
  }
  await handleGroupMessage({
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
      await syncKeybaseCommandAdvertisements({ account, cfg: ctx.cfg }).catch((error) => {
        ctx.log?.warn?.(
          `[${account.accountId}] keybase command advertisement sync failed: ${String(error)}`,
        );
      });

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
