import { setTimeout as sleep } from "node:timers/promises";
import {
  DEFAULT_KEYBASE_HOME,
  DEFAULT_KEYBASE_PID_FILE,
  DEFAULT_KEYBASE_SOCKET_FILE,
  GATEWAY_SERVICE,
  SENDER_SERVICE,
  type RunCommand,
  type RunCommandResult,
} from "./scaffold.js";

export const DEFAULT_BLACKBOX_ACK_REACTION = ":eyes:";

export type KeybaseApiEnvelope<TResult> = {
  error?: { message?: string } | null;
  result?: TResult;
};

export type KeybaseConversationSummary = {
  channel?: {
    members_type?: string;
    name?: string;
  };
  id?: string;
  is_default_conv?: boolean;
};

export type KeybaseBlackboxConversation =
  | { channel: { members_type?: string; name: string; topic_name?: string; topic_type?: string } }
  | { conversation_id: string };

export type KeybaseMessageSummary = {
  msg?: {
    content?: {
      reaction?: {
        b?: string;
        body?: string;
        m?: number | string;
        message_id?: number | string;
        messageID?: number | string;
      };
      text?: {
        body?: string;
        replyTo?: number;
      };
      type?: string;
    };
    id?: number;
    sender?: {
      username?: string;
    };
    sent_at_ms?: number;
  };
};

export function parseJsonFromCommand(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) {
    throw new Error(`Command output did not include JSON: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw.slice(start));
}

export function normalizeMessageId(value: number | string | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "";
}

export function normalizeReactionBody(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "👀") {
    return ":eyes:";
  }
  return trimmed;
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function readTextReplyToId(message: KeybaseMessageSummary): string {
  return normalizeMessageId(message.msg?.content?.text?.replyTo);
}

export function readReactionTargetId(message: KeybaseMessageSummary): string {
  const reaction = message.msg?.content?.reaction;
  return normalizeMessageId(reaction?.m ?? reaction?.messageID ?? reaction?.message_id);
}

export function readReactionBody(message: KeybaseMessageSummary): string {
  const reaction = message.msg?.content?.reaction;
  return normalizeReactionBody(reaction?.b ?? reaction?.body ?? "");
}

export function readMessageBody(message: KeybaseMessageSummary): string {
  return message.msg?.content?.text?.body?.trim() ?? "";
}

export function readMessageSender(message: KeybaseMessageSummary): string {
  return normalizeUsername(message.msg?.sender?.username ?? "");
}

export function findBotReplyToMessage(params: {
  botUsername: string;
  messages: readonly KeybaseMessageSummary[];
  sentMessageId: string;
  startedAt: number;
}): KeybaseMessageSummary | undefined {
  const normalizedBot = normalizeUsername(params.botUsername);
  const isBotText = (entry: KeybaseMessageSummary) => {
    const msg = entry.msg;
    return Boolean(
      msg && readMessageSender(entry) === normalizedBot && msg.content?.type === "text",
    );
  };
  const exactReply = params.messages.find(
    (entry) => isBotText(entry) && readTextReplyToId(entry) === params.sentMessageId,
  );
  if (exactReply) {
    return exactReply;
  }
  return params.messages.find(
    (entry) => isBotText(entry) && (entry.msg?.sent_at_ms ?? 0) >= params.startedAt,
  );
}

export function findBotTextRepliesToMessage(params: {
  botUsername: string;
  messages: readonly KeybaseMessageSummary[];
  sentMessageId: string;
  startedAt: number;
}): KeybaseMessageSummary[] {
  const normalizedBot = normalizeUsername(params.botUsername);
  const exactReplies = params.messages.filter((entry) => {
    const msg = entry.msg;
    return Boolean(
      msg &&
      readMessageSender(entry) === normalizedBot &&
      msg.content?.type === "text" &&
      readTextReplyToId(entry) === params.sentMessageId,
    );
  });
  const replies =
    exactReplies.length > 0
      ? exactReplies
      : params.messages.filter((entry) => {
          const msg = entry.msg;
          return Boolean(
            msg &&
            readMessageSender(entry) === normalizedBot &&
            msg.content?.type === "text" &&
            (msg.sent_at_ms ?? 0) >= params.startedAt,
          );
        });
  return [...replies].toSorted((left, right) => {
    const sentDiff = (left.msg?.sent_at_ms ?? 0) - (right.msg?.sent_at_ms ?? 0);
    if (sentDiff !== 0) {
      return sentDiff;
    }
    return Number(normalizeMessageId(left.msg?.id)) - Number(normalizeMessageId(right.msg?.id));
  });
}

export function findBotReactionToMessage(params: {
  botUsername: string;
  expectedBody?: string;
  messages: readonly KeybaseMessageSummary[];
  sentMessageId: string;
}): KeybaseMessageSummary | undefined {
  const normalizedBot = normalizeUsername(params.botUsername);
  const expectedBody = params.expectedBody ? normalizeReactionBody(params.expectedBody) : undefined;
  return params.messages.find((entry) => {
    if (
      readMessageSender(entry) !== normalizedBot ||
      entry.msg?.content?.type !== "reaction" ||
      readReactionTargetId(entry) !== params.sentMessageId
    ) {
      return false;
    }
    return !expectedBody || readReactionBody(entry) === expectedBody;
  });
}

export function findBotResponseToMessage(params: {
  botUsername: string;
  messages: readonly KeybaseMessageSummary[];
  sentMessageId: string;
  startedAt: number;
}): KeybaseMessageSummary | undefined {
  return (
    findBotReplyToMessage(params) ??
    findBotReactionToMessage({
      botUsername: params.botUsername,
      messages: params.messages,
      sentMessageId: params.sentMessageId,
    })
  );
}

export function buildComposeArgs(params: {
  composeFile: string;
  envFile: string;
  profile?: string;
}): string[] {
  return [
    "compose",
    "--env-file",
    params.envFile,
    "-f",
    params.composeFile,
    ...(params.profile ? ["--profile", params.profile] : []),
  ];
}

export async function runCompose(params: {
  args: readonly string[];
  cwd: string;
  runCommand: RunCommand;
}): Promise<RunCommandResult> {
  return await params.runCommand("docker", [...params.args], params.cwd);
}

export async function runComposeExec(params: {
  command: readonly string[];
  composeFile: string;
  cwd: string;
  envFile: string;
  runCommand: RunCommand;
  service: string;
}): Promise<RunCommandResult> {
  return await runCompose({
    cwd: params.cwd,
    runCommand: params.runCommand,
    args: [
      ...buildComposeArgs({
        composeFile: params.composeFile,
        envFile: params.envFile,
      }),
      "exec",
      "-T",
      params.service,
      ...params.command,
    ],
  });
}

export async function runKeybaseApiInService<TResult>(params: {
  composeFile: string;
  cwd: string;
  envFile: string;
  request: Record<string, unknown>;
  runCommand: RunCommand;
  service: string;
}): Promise<TResult> {
  const result = await runComposeExec({
    composeFile: params.composeFile,
    cwd: params.cwd,
    envFile: params.envFile,
    runCommand: params.runCommand,
    service: params.service,
    command: [
      "keybase",
      "--home",
      DEFAULT_KEYBASE_HOME,
      "--socket-file",
      DEFAULT_KEYBASE_SOCKET_FILE,
      "--pid-file",
      DEFAULT_KEYBASE_PID_FILE,
      "chat",
      "api",
      "-m",
      JSON.stringify(params.request),
    ],
  });
  const envelope = parseJsonFromCommand(result.stdout) as KeybaseApiEnvelope<TResult>;
  if (envelope.error) {
    throw new Error(envelope.error.message ?? "Keybase API request failed");
  }
  if (envelope.result === undefined) {
    throw new Error("Keybase API response did not include a result");
  }
  return envelope.result;
}

export async function readKeybaseMessagesInSender(params: {
  conversation: KeybaseBlackboxConversation;
  composeFile: string;
  cwd: string;
  envFile: string;
  num?: number;
  runCommand: RunCommand;
}): Promise<KeybaseMessageSummary[]> {
  const readResult = await runKeybaseApiInService<{ messages?: KeybaseMessageSummary[] }>({
    composeFile: params.composeFile,
    cwd: params.cwd,
    envFile: params.envFile,
    runCommand: params.runCommand,
    service: SENDER_SERVICE,
    request: {
      method: "read",
      params: {
        options: {
          ...params.conversation,
          pagination: { num: params.num ?? 20 },
          peek: true,
        },
      },
    },
  });
  return readResult.messages ?? [];
}

export function normalizeAdvertisedCommandName(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, "");
  return trimmed ? `/${trimmed.toLowerCase()}` : "";
}

export function collectAdvertisedCommandNames(
  value: unknown,
  names = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectAdvertisedCommandNames(entry, names);
    }
    return names;
  }
  if (typeof value !== "object" || value === null) {
    return names;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") {
    const commandName = normalizeAdvertisedCommandName(record.name);
    if (commandName) {
      names.add(commandName);
    }
  }
  for (const nested of Object.values(record)) {
    collectAdvertisedCommandNames(nested, names);
  }
  return names;
}

export function findDefaultTeamConversationId(params: {
  conversations: readonly KeybaseConversationSummary[];
  team: string;
}): string {
  const normalizedTeam = params.team.trim().toLowerCase();
  const match = params.conversations.find(
    (conversation) =>
      conversation.channel?.name?.toLowerCase() === normalizedTeam &&
      conversation.channel?.members_type === "team" &&
      conversation.is_default_conv === true &&
      typeof conversation.id === "string" &&
      conversation.id.trim().length > 0,
  );
  if (!match?.id) {
    throw new Error(
      `Sender identity cannot see default Keybase team conversation ${params.team}; invite it to the team/channel first`,
    );
  }
  return match.id;
}

export async function readChannelStatus(params: {
  composeFile: string;
  cwd: string;
  envFile: string;
  runCommand: RunCommand;
}): Promise<{
  inboundAt: number;
  lastError: string | null;
  lastStartAt: number;
  outboundAt: number;
  running: boolean;
}> {
  const result = await runComposeExec({
    composeFile: params.composeFile,
    cwd: params.cwd,
    envFile: params.envFile,
    runCommand: params.runCommand,
    service: GATEWAY_SERVICE,
    command: [
      "node",
      "--input-type=module",
      "-e",
      [
        'import fs from "node:fs";',
        'const cfg = JSON.parse(fs.readFileSync("/home/node/.openclaw/openclaw.json", "utf8"));',
        "const token = cfg?.gateway?.auth?.token;",
        'if (!token) throw new Error("missing gateway token");',
        'const ws = new WebSocket("ws://127.0.0.1:18789");',
        "const waitFrame = (predicate, label) => new Promise((resolve, reject) => {",
        "  const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), 10000);",
        "  const cleanup = () => { clearTimeout(timer); ws.removeEventListener('message', onMessage); ws.removeEventListener('error', onError); };",
        "  const onError = (event) => { cleanup(); reject(event.error ?? new Error(`websocket ${label} error`)); };",
        "  const onMessage = (event) => {",
        "    const frame = JSON.parse(String(event.data));",
        "    if (!predicate(frame)) return;",
        "    cleanup();",
        "    resolve(frame);",
        "  };",
        "  ws.addEventListener('message', onMessage);",
        "  ws.addEventListener('error', onError);",
        "});",
        "await new Promise((resolve, reject) => {",
        "  const timer = setTimeout(() => reject(new Error('timeout waiting for websocket open')), 10000);",
        "  ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });",
        "  ws.addEventListener('error', (event) => { clearTimeout(timer); reject(event.error ?? new Error('websocket open error')); }, { once: true });",
        "});",
        "const challenge = await waitFrame((frame) => frame?.type === 'event' && frame.event === 'connect.challenge', 'connect challenge');",
        "ws.send(JSON.stringify({",
        "  type: 'req',",
        "  id: 'connect-1',",
        "  method: 'connect',",
        "  params: {",
        "    minProtocol: 3,",
        "    maxProtocol: 3,",
        "    client: { id: 'gateway-client', displayName: 'keybase-smoke', version: 'smoke', platform: process.platform, mode: 'backend' },",
        "    caps: [],",
        "    auth: { token },",
        "    role: 'operator',",
        "    scopes: ['operator.read'],",
        "  },",
        "}));",
        "const connected = await waitFrame((frame) => frame?.type === 'res' && frame.id === 'connect-1', 'connect response');",
        "if (!connected.ok) throw new Error(`gateway connect failed: ${JSON.stringify(connected.error)}`);",
        "ws.send(JSON.stringify({ type: 'req', id: 'status-1', method: 'channels.status', params: { probe: false, timeoutMs: 10000 } }));",
        "const status = await waitFrame((frame) => frame?.type === 'res' && frame.id === 'status-1', 'channels.status');",
        "if (!status.ok) throw new Error(`channels.status failed: ${JSON.stringify(status.error)}`);",
        "ws.close();",
        "process.stdout.write(JSON.stringify(status.payload));",
      ].join("\n"),
    ],
  });
  const status = parseJsonFromCommand(result.stdout) as {
    channelAccounts?: {
      keybase?: Array<{
        lastError?: string | null;
        lastInboundAt?: number | null;
        lastOutboundAt?: number | null;
        lastStartAt?: number | null;
        running?: boolean;
      }>;
    };
  };
  const keybase = status.channelAccounts?.keybase?.[0];
  return {
    inboundAt: keybase?.lastInboundAt ?? 0,
    lastError: keybase?.lastError ?? null,
    lastStartAt: keybase?.lastStartAt ?? 0,
    outboundAt: keybase?.lastOutboundAt ?? 0,
    running: keybase?.running === true,
  };
}

export async function waitForKeybaseChannelRunning(params: {
  composeFile: string;
  cwd: string;
  envFile: string;
  minLastStartAt?: number;
  runCommand: RunCommand;
  settleMs?: number;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + params.timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const status = await readChannelStatus(params);
      if (
        status.running &&
        (!params.minLastStartAt || status.lastStartAt >= params.minLastStartAt)
      ) {
        await sleep(params.settleMs ?? 500);
        return;
      }
      lastError = status.lastError ?? "channel is not running yet";
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for Keybase channel to run: ${String(lastError)}`);
}

export async function waitForServiceWhoami(params: {
  composeFile: string;
  cwd: string;
  envFile: string;
  runCommand: RunCommand;
  service: string;
  timeoutMs: number;
}): Promise<string> {
  const deadline = Date.now() + params.timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await runComposeExec({
        composeFile: params.composeFile,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
        service: params.service,
        command: ["test", "-S", DEFAULT_KEYBASE_SOCKET_FILE],
      });
      const result = await runComposeExec({
        composeFile: params.composeFile,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
        service: params.service,
        command: [
          "keybase",
          "--home",
          DEFAULT_KEYBASE_HOME,
          "--socket-file",
          DEFAULT_KEYBASE_SOCKET_FILE,
          "--pid-file",
          DEFAULT_KEYBASE_PID_FILE,
          "whoami",
        ],
      });
      const username = result.stdout
        .split(/\r?\n/)
        .toReversed()
        .find((line) => line.trim().length > 0)
        ?.trim();
      if (!username) {
        throw new Error("keybase whoami did not return a username");
      }
      return username;
    } catch (error) {
      lastError = error;
      await sleep(2000);
    }
  }
  throw new Error(`Timed out waiting for ${params.service} Keybase login: ${String(lastError)}`);
}

export async function waitForBlackboxReply(params: {
  botUsername: string;
  conversation: KeybaseBlackboxConversation;
  composeFile: string;
  cwd: string;
  envFile: string;
  expectedAckReaction?: string | false;
  expectedReplyText?: string;
  runCommand: RunCommand;
  sentMessageId: string;
  startedAt: number;
  timeoutMs: number;
}): Promise<{
  ackReactionBody?: string;
  ackReactionMessageId?: string;
  inboundAt: number;
  outboundAt: number;
  replyBody: string;
  replyMessageId: string;
  replyPreview: string;
}> {
  const deadline = Date.now() + params.timeoutMs;
  let lastStatusError: string | null = null;
  let lastReadError: string | null = null;
  const expectedAckReaction =
    params.expectedAckReaction === false
      ? undefined
      : normalizeReactionBody(params.expectedAckReaction ?? DEFAULT_BLACKBOX_ACK_REACTION);
  while (Date.now() < deadline) {
    let hasFreshStatus = false;
    let inboundAt = 0;
    let outboundAt = 0;
    try {
      const status = await readChannelStatus(params);
      lastStatusError = status.lastError;
      inboundAt = status.inboundAt;
      outboundAt = status.outboundAt;
      hasFreshStatus =
        status.running &&
        status.inboundAt >= params.startedAt &&
        status.outboundAt >= params.startedAt;
    } catch (error) {
      lastStatusError = String(error);
    }

    let messages: KeybaseMessageSummary[];
    try {
      messages = await readKeybaseMessagesInSender({
        composeFile: params.composeFile,
        conversation: params.conversation,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
      });
      lastReadError = null;
    } catch (error) {
      lastReadError = formatUnknownError(error);
      await sleep(3000);
      continue;
    }
    const reply = findBotReplyToMessage({
      botUsername: params.botUsername,
      messages,
      sentMessageId: params.sentMessageId,
      startedAt: params.startedAt,
    });
    const reaction = expectedAckReaction
      ? findBotReactionToMessage({
          botUsername: params.botUsername,
          expectedBody: expectedAckReaction,
          messages,
          sentMessageId: params.sentMessageId,
        })
      : undefined;
    const replyBody = reply ? readMessageBody(reply) : "";
    const hasExpectedReplyText =
      !params.expectedReplyText || replyBody.includes(params.expectedReplyText);
    if (
      reply &&
      hasFreshStatus &&
      replyBody &&
      hasExpectedReplyText &&
      (!expectedAckReaction || reaction)
    ) {
      const reactionBody = reaction ? readReactionBody(reaction) : undefined;
      const reactionMessageId = normalizeMessageId(reaction?.msg?.id);
      return {
        ...(reactionBody ? { ackReactionBody: reactionBody } : {}),
        ...(reactionMessageId ? { ackReactionMessageId: reactionMessageId } : {}),
        inboundAt,
        outboundAt,
        replyBody,
        replyMessageId: normalizeMessageId(reply.msg?.id),
        replyPreview: replyBody.slice(0, 240),
      };
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for Keybase blackbox reply; last channel error: ${
      lastStatusError ?? "none"
    }; last sender read error: ${lastReadError ?? "none"}`,
  );
}

export async function waitForBotTextContaining(params: {
  botUsername: string;
  conversation: KeybaseBlackboxConversation;
  composeFile: string;
  cwd: string;
  envFile: string;
  excludeMessageIds?: readonly string[];
  runCommand: RunCommand;
  startedAt: number;
  text: string;
  timeoutMs: number;
}): Promise<{
  replyBody: string;
  replyMessageId: string;
  replyPreview: string;
}> {
  const deadline = Date.now() + params.timeoutMs;
  const normalizedBot = normalizeUsername(params.botUsername);
  const excluded = new Set((params.excludeMessageIds ?? []).map(normalizeMessageId));
  let lastReadError: string | null = null;
  while (Date.now() < deadline) {
    let messages: KeybaseMessageSummary[];
    try {
      messages = await readKeybaseMessagesInSender({
        composeFile: params.composeFile,
        conversation: params.conversation,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
      });
      lastReadError = null;
    } catch (error) {
      lastReadError = formatUnknownError(error);
      await sleep(3000);
      continue;
    }
    const match = messages.find((entry) => {
      const msg = entry.msg;
      const messageId = normalizeMessageId(msg?.id);
      return Boolean(
        msg &&
        readMessageSender(entry) === normalizedBot &&
        msg.content?.type === "text" &&
        !excluded.has(messageId) &&
        (msg.sent_at_ms ?? 0) >= params.startedAt &&
        readMessageBody(entry).includes(params.text),
      );
    });
    if (match) {
      const replyBody = readMessageBody(match);
      return {
        replyBody,
        replyMessageId: normalizeMessageId(match.msg?.id),
        replyPreview: replyBody.slice(0, 240),
      };
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for Keybase bot text containing "${params.text}"; last sender read error: ${
      lastReadError ?? "none"
    }`,
  );
}

export async function waitForChunkedBotReply(params: {
  botUsername: string;
  composeFile: string;
  conversation: KeybaseBlackboxConversation;
  cwd: string;
  envFile: string;
  expectedAckReaction?: string | false;
  expectedFragments: readonly string[];
  minChunks: number;
  runCommand: RunCommand;
  sentMessageId: string;
  startedAt: number;
  timeoutMs: number;
}): Promise<{
  ackReactionBody?: string;
  ackReactionMessageId?: string;
  chunkCount: number;
  chunkMessageIds: string[];
  combinedPreview: string;
  inboundAt: number;
  outboundAt: number;
}> {
  const deadline = Date.now() + params.timeoutMs;
  let lastStatusError: string | null = null;
  let lastReadError: string | null = null;
  const expectedAckReaction =
    params.expectedAckReaction === false
      ? undefined
      : normalizeReactionBody(params.expectedAckReaction ?? DEFAULT_BLACKBOX_ACK_REACTION);
  while (Date.now() < deadline) {
    let hasFreshStatus = false;
    let inboundAt = 0;
    let outboundAt = 0;
    try {
      const status = await readChannelStatus(params);
      lastStatusError = status.lastError;
      inboundAt = status.inboundAt;
      outboundAt = status.outboundAt;
      hasFreshStatus =
        status.running &&
        status.inboundAt >= params.startedAt &&
        status.outboundAt >= params.startedAt;
    } catch (error) {
      lastStatusError = String(error);
    }

    let messages: KeybaseMessageSummary[];
    try {
      messages = await readKeybaseMessagesInSender({
        composeFile: params.composeFile,
        conversation: params.conversation,
        cwd: params.cwd,
        envFile: params.envFile,
        num: 50,
        runCommand: params.runCommand,
      });
      lastReadError = null;
    } catch (error) {
      lastReadError = formatUnknownError(error);
      await sleep(3000);
      continue;
    }
    const replies = findBotTextRepliesToMessage({
      botUsername: params.botUsername,
      messages,
      sentMessageId: params.sentMessageId,
      startedAt: params.startedAt,
    });
    const reaction = expectedAckReaction
      ? findBotReactionToMessage({
          botUsername: params.botUsername,
          expectedBody: expectedAckReaction,
          messages,
          sentMessageId: params.sentMessageId,
        })
      : undefined;
    const combined = replies.map((reply) => readMessageBody(reply)).join("\n");
    const includesExpectedFragments = params.expectedFragments.every((fragment) =>
      combined.includes(fragment),
    );
    if (
      hasFreshStatus &&
      replies.length >= params.minChunks &&
      includesExpectedFragments &&
      (!expectedAckReaction || reaction)
    ) {
      const reactionBody = reaction ? readReactionBody(reaction) : undefined;
      const reactionMessageId = normalizeMessageId(reaction?.msg?.id);
      return {
        ...(reactionBody ? { ackReactionBody: reactionBody } : {}),
        ...(reactionMessageId ? { ackReactionMessageId: reactionMessageId } : {}),
        chunkCount: replies.length,
        chunkMessageIds: replies.map((reply) => normalizeMessageId(reply.msg?.id)).filter(Boolean),
        combinedPreview: combined.slice(0, 240),
        inboundAt,
        outboundAt,
      };
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for chunked Keybase bot reply; last channel error: ${
      lastStatusError ?? "none"
    }; last sender read error: ${lastReadError ?? "none"}`,
  );
}

export async function waitForNoAdditionalBotTextReply(params: {
  allowedReplyMessageId: string;
  botUsername: string;
  conversation: KeybaseBlackboxConversation;
  composeFile: string;
  cwd: string;
  envFile: string;
  quietMs: number;
  runCommand: RunCommand;
  sentMessageId: string;
  startedAt: number;
}): Promise<void> {
  await sleep(Math.max(0, params.quietMs));
  let messages: KeybaseMessageSummary[] = [];
  let lastReadError: string | null = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      messages = await readKeybaseMessagesInSender({
        composeFile: params.composeFile,
        conversation: params.conversation,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
      });
      lastReadError = null;
      break;
    } catch (error) {
      lastReadError = formatUnknownError(error);
      await sleep(3000);
    }
  }
  if (lastReadError) {
    throw new Error(
      `Timed out checking for extra Keybase bot replies; last sender read error: ${lastReadError}`,
    );
  }
  const normalizedBot = normalizeUsername(params.botUsername);
  const extraReply = messages.find((entry) => {
    const msg = entry.msg;
    return Boolean(
      msg &&
      readMessageSender(entry) === normalizedBot &&
      msg.content?.type === "text" &&
      readTextReplyToId(entry) === params.sentMessageId &&
      normalizeMessageId(msg.id) !== params.allowedReplyMessageId &&
      (msg.sent_at_ms ?? 0) >= params.startedAt,
    );
  });
  if (extraReply) {
    throw new Error(
      `Expected only one Keybase bot text reply to ${params.sentMessageId}, but observed extra message ${normalizeMessageId(extraReply.msg?.id)}`,
    );
  }
}

export async function waitForNoBotResponse(params: {
  botUsername: string;
  conversation: KeybaseBlackboxConversation;
  composeFile: string;
  cwd: string;
  envFile: string;
  quietMs: number;
  runCommand: RunCommand;
  sentMessageId: string;
  startedAt: number;
}): Promise<void> {
  const deadline = Date.now() + params.quietMs;
  let sawSuccessfulRead = false;
  let sawFreshInbound = false;
  let lastStatusError: string | null = null;
  let lastReadError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const status = await readChannelStatus(params);
      lastStatusError = status.lastError;
      sawFreshInbound = sawFreshInbound || (status.running && status.inboundAt >= params.startedAt);
    } catch (error) {
      lastStatusError = formatUnknownError(error);
    }

    let messages: KeybaseMessageSummary[];
    try {
      messages = await readKeybaseMessagesInSender({
        composeFile: params.composeFile,
        conversation: params.conversation,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
      });
      sawSuccessfulRead = true;
      lastReadError = null;
    } catch (error) {
      lastReadError = formatUnknownError(error);
      await sleep(Math.min(3000, Math.max(250, params.quietMs)));
      continue;
    }
    const response = findBotResponseToMessage({
      botUsername: params.botUsername,
      messages,
      sentMessageId: params.sentMessageId,
      startedAt: params.startedAt,
    });
    if (response) {
      throw new Error(
        `Expected no Keybase bot response to ${params.sentMessageId}, but observed message ${normalizeMessageId(response.msg?.id)}`,
      );
    }
    await sleep(Math.min(3000, Math.max(250, params.quietMs)));
  }
  if (!sawSuccessfulRead && lastReadError) {
    throw new Error(
      `Timed out checking for absent Keybase bot response; last sender read error: ${lastReadError}`,
    );
  }
  if (!sawFreshInbound) {
    throw new Error(
      `Timed out waiting for Keybase channel to process blocked message ${params.sentMessageId}; last channel error: ${
        lastStatusError ?? "none"
      }`,
    );
  }
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}
