import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  buildComposeArgs,
  collectAdvertisedCommandNames,
  DEFAULT_BLACKBOX_ACK_REACTION,
  findBotReplyToMessage,
  findDefaultTeamConversationId,
  formatUnknownError,
  type KeybaseBlackboxConversation,
  type KeybaseConversationSummary,
  type KeybaseMessageSummary,
  normalizeAdvertisedCommandName,
  normalizeMessageId,
  normalizeUsername,
  readKeybaseMessagesInSender,
  readMessageBody,
  runCompose,
  runComposeExec,
  runKeybaseApiInService,
  waitForBlackboxReply,
  waitForBotTextContaining,
  waitForChunkedBotReply,
  waitForKeybaseChannelRunning,
  waitForNoAdditionalBotTextReply,
  waitForNoBotResponse,
  waitForServiceWhoami,
} from "./api.js";
import { defaultRunCommand } from "./build-image.js";
import { GATEWAY_SERVICE, type RunCommand, SENDER_SERVICE } from "./scaffold.js";

export type KeybaseBlackboxContext = {
  botUsername: string;
  composeFile: string;
  conversationId: string;
  envFile: string;
  outputDir: string;
  runCommand: RunCommand;
  senderUsername: string;
  team: string;
};

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOrCreateJsonObject(parent: JsonObject, key: string): JsonObject {
  const existing = parent[key];
  if (isJsonObject(existing)) {
    return existing;
  }
  const next: JsonObject = {};
  parent[key] = next;
  return next;
}

async function readJsonObjectFile(filePath: string): Promise<JsonObject> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  if (!isJsonObject(raw)) {
    throw new Error(`${filePath} did not contain a JSON object`);
  }
  return raw;
}

async function writeJsonObjectFile(filePath: string, value: JsonObject): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function keybaseConfigPath(outputDir: string): string {
  return path.join(outputDir, "state", "home", ".openclaw", "openclaw.json");
}

function keybasePairingStorePath(outputDir: string): string {
  return path.join(outputDir, "state", "home", ".openclaw", "credentials", "keybase-pairing.json");
}

function resolveKeybaseBlackboxPaths(params: {
  composeFile?: string;
  envFile?: string;
  outputDir: string;
  runCommand?: RunCommand;
}): Pick<KeybaseBlackboxContext, "composeFile" | "envFile" | "outputDir" | "runCommand"> {
  const outputDir = path.resolve(params.outputDir);
  const composeFile = path.resolve(outputDir, params.composeFile ?? "docker-compose.keybase.yml");
  const envFile = path.resolve(outputDir, params.envFile ?? ".env");
  const runCommand = params.runCommand ?? defaultRunCommand;
  return { composeFile, envFile, outputDir, runCommand };
}

async function ensureBaseQaConfig(params: { outputDir: string; team: string }): Promise<void> {
  const configFile = keybaseConfigPath(params.outputDir);
  await fs.rm(keybasePairingStorePath(params.outputDir), { force: true });
  const config = await readJsonObjectFile(configFile);
  const channels = getOrCreateJsonObject(config, "channels");
  const keybase = getOrCreateJsonObject(channels, "keybase");
  keybase.dmPolicy = "pairing";
  keybase.allowFrom = [];
  const groups = getOrCreateJsonObject(keybase, "groups");
  const groupKey = `team:${params.team.toLowerCase()}#general`;
  const current = isJsonObject(groups[groupKey]) ? { ...groups[groupKey] } : {};
  groups[groupKey] = {
    ...current,
    requireMention: true,
  };
  await writeJsonObjectFile(configFile, config);
}

export async function prepareKeybaseBlackboxContext(params: {
  botUsername: string;
  composeFile?: string;
  envFile?: string;
  outputDir: string;
  runCommand?: RunCommand;
  team: string;
}): Promise<KeybaseBlackboxContext> {
  const paths = resolveKeybaseBlackboxPaths(params);
  const botUsername = params.botUsername.trim();
  if (!botUsername) {
    throw new Error("Keybase blackbox bot username is required");
  }
  const team = params.team.trim();
  if (!team) {
    throw new Error("Keybase blackbox team is required");
  }
  await ensureBaseQaConfig({
    outputDir: paths.outputDir,
    team,
  });

  await runCompose({
    cwd: paths.outputDir,
    runCommand: paths.runCommand,
    args: [
      ...buildComposeArgs({
        composeFile: paths.composeFile,
        envFile: paths.envFile,
        profile: "blackbox",
      }),
      "up",
      "-d",
      GATEWAY_SERVICE,
      SENDER_SERVICE,
    ],
  });
  await waitForServiceWhoami({
    composeFile: paths.composeFile,
    cwd: paths.outputDir,
    envFile: paths.envFile,
    runCommand: paths.runCommand,
    service: GATEWAY_SERVICE,
    timeoutMs: 150_000,
  });
  const senderUsername = await waitForServiceWhoami({
    composeFile: paths.composeFile,
    cwd: paths.outputDir,
    envFile: paths.envFile,
    runCommand: paths.runCommand,
    service: SENDER_SERVICE,
    timeoutMs: 90_000,
  });
  await waitForKeybaseChannelRunning({
    composeFile: paths.composeFile,
    cwd: paths.outputDir,
    envFile: paths.envFile,
    runCommand: paths.runCommand,
    timeoutMs: 90_000,
  });

  const listResult = await runKeybaseApiInService<{
    conversations?: KeybaseConversationSummary[];
  }>({
    composeFile: paths.composeFile,
    cwd: paths.outputDir,
    envFile: paths.envFile,
    runCommand: paths.runCommand,
    service: SENDER_SERVICE,
    request: {
      method: "list",
      params: { options: { topic_type: "CHAT" } },
    },
  });
  const conversationId = findDefaultTeamConversationId({
    conversations: listResult.conversations ?? [],
    team,
  });
  return {
    ...paths,
    botUsername,
    conversationId,
    senderUsername: normalizeUsername(senderUsername),
    team,
  };
}

export async function sendKeybaseBlackboxMessage(params: {
  body: string;
  conversation?: KeybaseBlackboxConversation;
  context: KeybaseBlackboxContext;
}): Promise<string> {
  const sendResult = await runKeybaseApiInService<{
    id?: number | string | null;
    outbox_id?: string | null;
  }>({
    composeFile: params.context.composeFile,
    cwd: params.context.outputDir,
    envFile: params.context.envFile,
    runCommand: params.context.runCommand,
    service: SENDER_SERVICE,
    request: {
      method: "send",
      params: {
        options: {
          ...(params.conversation ?? { conversation_id: params.context.conversationId }),
          message: {
            body: params.body,
          },
        },
      },
    },
  });
  const sentMessageId = normalizeMessageId(sendResult.id ?? sendResult.outbox_id);
  if (!sentMessageId) {
    throw new Error("Keybase sender did not return a message id");
  }
  return sentMessageId;
}

async function installBlockedGroupAllowlist(
  context: KeybaseBlackboxContext,
): Promise<() => Promise<void>> {
  const configFile = keybaseConfigPath(context.outputDir);
  const config = await readJsonObjectFile(configFile);
  const channels = getOrCreateJsonObject(config, "channels");
  const keybase = getOrCreateJsonObject(channels, "keybase");
  const groups = getOrCreateJsonObject(keybase, "groups");
  const groupKey = `team:${context.team.toLowerCase()}#general`;
  const hadPrevious = Object.hasOwn(groups, groupKey);
  const previous = groups[groupKey];
  const current = isJsonObject(previous) ? { ...previous } : {};
  groups[groupKey] = {
    ...current,
    allowFrom: ["__openclaw_qa_blocked_sender__"],
    requireMention: true,
  };
  await writeJsonObjectFile(configFile, config);

  return async () => {
    const next = await readJsonObjectFile(configFile);
    const nextChannels = getOrCreateJsonObject(next, "channels");
    const nextKeybase = getOrCreateJsonObject(nextChannels, "keybase");
    const nextGroups = getOrCreateJsonObject(nextKeybase, "groups");
    if (hadPrevious) {
      nextGroups[groupKey] = previous;
    } else {
      delete nextGroups[groupKey];
    }
    await writeJsonObjectFile(configFile, next);
  };
}

async function installAllowedGroupSender(
  context: KeybaseBlackboxContext,
): Promise<() => Promise<void>> {
  const configFile = keybaseConfigPath(context.outputDir);
  const config = await readJsonObjectFile(configFile);
  const channels = getOrCreateJsonObject(config, "channels");
  const keybase = getOrCreateJsonObject(channels, "keybase");
  const groups = getOrCreateJsonObject(keybase, "groups");
  const groupKey = `team:${context.team.toLowerCase()}#general`;
  const hadPrevious = Object.hasOwn(groups, groupKey);
  const previous = groups[groupKey];
  const current = isJsonObject(previous) ? { ...previous } : {};
  groups[groupKey] = {
    ...current,
    allowFrom: [context.senderUsername],
    requireMention: true,
  };
  await writeJsonObjectFile(configFile, config);

  return async () => {
    const next = await readJsonObjectFile(configFile);
    const nextChannels = getOrCreateJsonObject(next, "channels");
    const nextKeybase = getOrCreateJsonObject(nextChannels, "keybase");
    const nextGroups = getOrCreateJsonObject(nextKeybase, "groups");
    if (hadPrevious) {
      nextGroups[groupKey] = previous;
    } else {
      delete nextGroups[groupKey];
    }
    await writeJsonObjectFile(configFile, next);
  };
}

async function installTextChunkLimit(
  context: KeybaseBlackboxContext,
  limit: number,
): Promise<() => Promise<void>> {
  const configFile = keybaseConfigPath(context.outputDir);
  const config = await readJsonObjectFile(configFile);
  const channels = getOrCreateJsonObject(config, "channels");
  const keybase = getOrCreateJsonObject(channels, "keybase");
  const hadPrevious = Object.hasOwn(keybase, "textChunkLimit");
  const previous = keybase.textChunkLimit;
  keybase.textChunkLimit = limit;
  await writeJsonObjectFile(configFile, config);

  return async () => {
    const next = await readJsonObjectFile(configFile);
    const nextChannels = getOrCreateJsonObject(next, "channels");
    const nextKeybase = getOrCreateJsonObject(nextChannels, "keybase");
    if (hadPrevious) {
      nextKeybase.textChunkLimit = previous;
    } else {
      delete nextKeybase.textChunkLimit;
    }
    await writeJsonObjectFile(configFile, next);
  };
}

async function installDmPolicy(
  context: KeybaseBlackboxContext,
  params: {
    allowFrom?: string[];
    dmPolicy: "allowlist" | "pairing";
  },
): Promise<() => Promise<void>> {
  const configFile = keybaseConfigPath(context.outputDir);
  const config = await readJsonObjectFile(configFile);
  const channels = getOrCreateJsonObject(config, "channels");
  const keybase = getOrCreateJsonObject(channels, "keybase");
  const hadDmPolicy = Object.hasOwn(keybase, "dmPolicy");
  const previousDmPolicy = keybase.dmPolicy;
  const hadAllowFrom = Object.hasOwn(keybase, "allowFrom");
  const previousAllowFrom = keybase.allowFrom;
  keybase.dmPolicy = params.dmPolicy;
  keybase.allowFrom = params.allowFrom ?? [];
  await writeJsonObjectFile(configFile, config);

  return async () => {
    const next = await readJsonObjectFile(configFile);
    const nextChannels = getOrCreateJsonObject(next, "channels");
    const nextKeybase = getOrCreateJsonObject(nextChannels, "keybase");
    if (hadDmPolicy) {
      nextKeybase.dmPolicy = previousDmPolicy;
    } else {
      delete nextKeybase.dmPolicy;
    }
    if (hadAllowFrom) {
      nextKeybase.allowFrom = previousAllowFrom;
    } else {
      delete nextKeybase.allowFrom;
    }
    await writeJsonObjectFile(configFile, next);
  };
}

export async function restartKeybaseGateway(context: KeybaseBlackboxContext): Promise<void> {
  const restartedAt = Date.now();
  const composeArgs = buildComposeArgs({
    composeFile: context.composeFile,
    envFile: context.envFile,
    profile: "blackbox",
  });
  await runCompose({
    cwd: context.outputDir,
    runCommand: context.runCommand,
    args: [...composeArgs, "stop", GATEWAY_SERVICE],
  });
  await runCompose({
    cwd: context.outputDir,
    runCommand: context.runCommand,
    args: [...composeArgs, "rm", "-f", GATEWAY_SERVICE],
  });
  await runCompose({
    cwd: context.outputDir,
    runCommand: context.runCommand,
    args: [...composeArgs, "up", "-d", GATEWAY_SERVICE],
  });
  await waitForServiceWhoami({
    composeFile: context.composeFile,
    cwd: context.outputDir,
    envFile: context.envFile,
    runCommand: context.runCommand,
    service: GATEWAY_SERVICE,
    timeoutMs: 150_000,
  });
  await waitForKeybaseChannelRunning({
    composeFile: context.composeFile,
    cwd: context.outputDir,
    envFile: context.envFile,
    minLastStartAt: restartedAt,
    runCommand: context.runCommand,
    settleMs: 5_000,
    timeoutMs: 90_000,
  });
}

export async function stopKeybaseApiListenChild(context: KeybaseBlackboxContext): Promise<void> {
  await runComposeExec({
    composeFile: context.composeFile,
    cwd: context.outputDir,
    envFile: context.envFile,
    runCommand: context.runCommand,
    service: GATEWAY_SERVICE,
    command: [
      "sh",
      "-lc",
      [
        "pids=\"$(ps ax -o pid= -o args= | awk '/[k]eybase .*chat api-listen/ {print $1}')\"",
        'test -n "$pids"',
        "kill $pids",
      ].join("; "),
    ],
  });
  await sleep(3_000);
}

function buildDirectConversation(botUsername: string): KeybaseBlackboxConversation {
  return {
    channel: {
      name: normalizeUsername(botUsername),
    },
  };
}

export async function runMentionReplyProbe(params: {
  context: KeybaseBlackboxContext;
  expectedAckReaction?: string | false;
  marker: string;
  prefix: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const body = `@${params.context.botUsername} reply exactly: ${params.prefix} ${params.marker}`;
  const sentMessageId = await sendKeybaseBlackboxMessage({
    body,
    context: params.context,
  });
  const reply = await waitForBlackboxReply({
    botUsername: params.context.botUsername,
    composeFile: params.context.composeFile,
    conversation: { conversation_id: params.context.conversationId },
    cwd: params.context.outputDir,
    envFile: params.context.envFile,
    expectedAckReaction: params.expectedAckReaction ?? DEFAULT_BLACKBOX_ACK_REACTION,
    runCommand: params.context.runCommand,
    sentMessageId,
    startedAt,
    timeoutMs: params.timeoutMs,
  });
  return {
    ...(reply.ackReactionBody ? { ackReactionBody: reply.ackReactionBody } : {}),
    ...(reply.ackReactionMessageId ? { ackReactionMessageId: reply.ackReactionMessageId } : {}),
    inboundAt: reply.inboundAt,
    outboundAt: reply.outboundAt,
    replyPreview: reply.replyPreview,
    sentMessageId,
  };
}

export async function runMentionGatingProbe(params: {
  context: KeybaseBlackboxContext;
  marker: string;
  quietMs: number;
}): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const sentMessageId = await sendKeybaseBlackboxMessage({
    body: `keybase mention gate should not reply ${params.marker}`,
    context: params.context,
  });
  await waitForNoBotResponse({
    botUsername: params.context.botUsername,
    composeFile: params.context.composeFile,
    conversation: { conversation_id: params.context.conversationId },
    cwd: params.context.outputDir,
    envFile: params.context.envFile,
    quietMs: params.quietMs,
    runCommand: params.context.runCommand,
    sentMessageId,
    startedAt,
  });
  return {
    quietMs: params.quietMs,
    sentMessageId,
  };
}

export async function runHelpCommandProbe(params: {
  context: KeybaseBlackboxContext;
  quietMs: number;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const restoreConfig = await installAllowedGroupSender(params.context);
  try {
    await restartKeybaseGateway(params.context);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `@${params.context.botUsername} /help`,
      context: params.context,
    });
    const reply = await waitForBlackboxReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      expectedAckReaction: DEFAULT_BLACKBOX_ACK_REACTION,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    });
    if (!reply.replyBody.includes("/commands for full list")) {
      throw new Error(`Unexpected /help reply: ${reply.replyBody}`);
    }
    await waitForNoAdditionalBotTextReply({
      allowedReplyMessageId: reply.replyMessageId,
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      quietMs: params.quietMs,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
    });
    return {
      ...(reply.ackReactionBody ? { ackReactionBody: reply.ackReactionBody } : {}),
      ...(reply.ackReactionMessageId ? { ackReactionMessageId: reply.ackReactionMessageId } : {}),
      inboundAt: reply.inboundAt,
      outboundAt: reply.outboundAt,
      replyPreview: reply.replyPreview,
      sentMessageId,
    };
  } finally {
    await restoreConfig();
    await restartKeybaseGateway(params.context);
  }
}

async function waitForKeybaseCommandAdvertisements(params: {
  context: KeybaseBlackboxContext;
  expectedCommands: readonly string[];
  timeoutMs: number;
}): Promise<{ commandCount: number; commands: string[] }> {
  const expected = params.expectedCommands.map(normalizeAdvertisedCommandName);
  const deadline = Date.now() + params.timeoutMs;
  let observed: string[] = [];
  while (Date.now() < deadline) {
    const result = await runKeybaseApiInService<unknown>({
      composeFile: params.context.composeFile,
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      runCommand: params.context.runCommand,
      service: SENDER_SERVICE,
      request: {
        method: "listcommands",
        params: {
          options: {
            conversation_id: params.context.conversationId,
          },
        },
      },
    });
    observed = [...collectAdvertisedCommandNames(result)].toSorted();
    if (expected.every((command) => observed.includes(command))) {
      return {
        commandCount: observed.length,
        commands: observed,
      };
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for Keybase command advertisements; observed: ${observed.join(", ") || "none"}`,
  );
}

export async function runCommandAdvertisementProbe(params: {
  context: KeybaseBlackboxContext;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const result = await waitForKeybaseCommandAdvertisements({
    context: params.context,
    expectedCommands: ["/help", "/status", "/commands", "/subagents"],
    timeoutMs: params.timeoutMs,
  });
  return {
    commandCount: result.commandCount,
    observedCommands: result.commands.filter((command) =>
      ["/commands", "/help", "/status", "/subagents"].includes(command),
    ),
  };
}

export async function runSubagentsListProbe(params: {
  context: KeybaseBlackboxContext;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const restoreConfig = await installAllowedGroupSender(params.context);
  try {
    await restartKeybaseGateway(params.context);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `@${params.context.botUsername} /subagents list`,
      context: params.context,
    });
    const reply = await waitForBlackboxReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      expectedAckReaction: DEFAULT_BLACKBOX_ACK_REACTION,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    });
    if (!reply.replyBody.includes("active subagents:")) {
      throw new Error(`Unexpected /subagents list reply: ${reply.replyBody}`);
    }
    return {
      ...(reply.ackReactionBody ? { ackReactionBody: reply.ackReactionBody } : {}),
      ...(reply.ackReactionMessageId ? { ackReactionMessageId: reply.ackReactionMessageId } : {}),
      inboundAt: reply.inboundAt,
      outboundAt: reply.outboundAt,
      replyPreview: reply.replyPreview,
      sentMessageId,
    };
  } finally {
    await restoreConfig();
    await restartKeybaseGateway(params.context);
  }
}

export async function runSubagentsSpawnProbe(params: {
  context: KeybaseBlackboxContext;
  marker: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const restoreConfig = await installAllowedGroupSender(params.context);
  try {
    await restartKeybaseGateway(params.context);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `@${params.context.botUsername} /subagents spawn main reply exactly: ${params.marker}`,
      context: params.context,
    });
    const ackReply = await waitForBlackboxReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      expectedAckReaction: DEFAULT_BLACKBOX_ACK_REACTION,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    });
    if (!ackReply.replyBody.includes("Spawned subagent main")) {
      throw new Error(`Unexpected /subagents spawn reply: ${ackReply.replyBody}`);
    }
    const completionReply = await waitForBotTextContaining({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      excludeMessageIds: [ackReply.replyMessageId],
      runCommand: params.context.runCommand,
      startedAt,
      text: params.marker,
      timeoutMs: params.timeoutMs,
    });
    return {
      ...(ackReply.ackReactionBody ? { ackReactionBody: ackReply.ackReactionBody } : {}),
      ...(ackReply.ackReactionMessageId
        ? { ackReactionMessageId: ackReply.ackReactionMessageId }
        : {}),
      completionMessageId: completionReply.replyMessageId,
      completionPreview: completionReply.replyPreview,
      inboundAt: ackReply.inboundAt,
      outboundAt: ackReply.outboundAt,
      replyPreview: ackReply.replyPreview,
      sentMessageId,
    };
  } finally {
    await restoreConfig();
    await restartKeybaseGateway(params.context);
  }
}

export async function runChunkedCommandsProbe(params: {
  context: KeybaseBlackboxContext;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const restoreSender = await installAllowedGroupSender(params.context);
  const restoreChunkLimit = await installTextChunkLimit(params.context, 160);
  try {
    await restartKeybaseGateway(params.context);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `@${params.context.botUsername} /commands`,
      context: params.context,
    });
    const reply = await waitForChunkedBotReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      expectedAckReaction: DEFAULT_BLACKBOX_ACK_REACTION,
      expectedFragments: ["/help", "/status"],
      minChunks: 2,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    });
    return {
      ...(reply.ackReactionBody ? { ackReactionBody: reply.ackReactionBody } : {}),
      ...(reply.ackReactionMessageId ? { ackReactionMessageId: reply.ackReactionMessageId } : {}),
      chunkCount: reply.chunkCount,
      chunkMessageIds: reply.chunkMessageIds,
      inboundAt: reply.inboundAt,
      outboundAt: reply.outboundAt,
      replyPreview: reply.combinedPreview,
      sentMessageId,
    };
  } finally {
    await restoreChunkLimit();
    await restoreSender();
    await restartKeybaseGateway(params.context);
  }
}

export async function runAllowlistBlockProbe(params: {
  context: KeybaseBlackboxContext;
  marker: string;
  quietMs: number;
}): Promise<Record<string, unknown>> {
  const restoreConfig = await installBlockedGroupAllowlist(params.context);
  try {
    await restartKeybaseGateway(params.context);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `@${params.context.botUsername} keybase allowlist block should not reply ${params.marker}`,
      context: params.context,
    });
    await waitForNoBotResponse({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      quietMs: params.quietMs,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
    });
    return {
      quietMs: params.quietMs,
      sentMessageId,
    };
  } finally {
    await restoreConfig();
    await restartKeybaseGateway(params.context);
  }
}

export async function runDirectMessageReplyProbe(params: {
  context: KeybaseBlackboxContext;
  marker: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const restoreConfig = await installDmPolicy(params.context, {
    dmPolicy: "allowlist",
    allowFrom: [params.context.senderUsername],
  });
  try {
    await restartKeybaseGateway(params.context);
    const conversation = buildDirectConversation(params.context.botUsername);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `reply exactly: keybase dm canary ok ${params.marker}`,
      context: params.context,
      conversation,
    });
    const reply = await waitForBlackboxReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation,
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      expectedAckReaction: false,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    });
    return {
      ...(reply.ackReactionBody ? { ackReactionBody: reply.ackReactionBody } : {}),
      ...(reply.ackReactionMessageId ? { ackReactionMessageId: reply.ackReactionMessageId } : {}),
      inboundAt: reply.inboundAt,
      outboundAt: reply.outboundAt,
      replyPreview: reply.replyPreview,
      senderUsername: params.context.senderUsername,
      sentMessageId,
    };
  } finally {
    await restoreConfig();
  }
}

async function waitForPairingChallengeReply(params: {
  botUsername: string;
  composeFile: string;
  conversation: KeybaseBlackboxConversation;
  cwd: string;
  envFile: string;
  runCommand: RunCommand;
  sentMessageId: string;
  startedAt: number;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const deadline = Date.now() + params.timeoutMs;
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
    const reply = findBotReplyToMessage({
      botUsername: params.botUsername,
      messages,
      sentMessageId: params.sentMessageId,
      startedAt: params.startedAt,
    });
    const replyBody = reply ? readMessageBody(reply) : "";
    if (/pairing code:/i.test(replyBody)) {
      return {
        replyMessageId: normalizeMessageId(reply?.msg?.id),
        replyPreview: replyBody.slice(0, 240),
        sentMessageId: params.sentMessageId,
      };
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for Keybase DM pairing challenge reply; last sender read error: ${
      lastReadError ?? "none"
    }`,
  );
}

export async function runDirectMessagePairingProbe(params: {
  context: KeybaseBlackboxContext;
  marker: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const conversation = buildDirectConversation(params.context.botUsername);
  const startedAt = Date.now();
  const sentMessageId = await sendKeybaseBlackboxMessage({
    body: `keybase dm pairing challenge ${params.marker}`,
    context: params.context,
    conversation,
  });
  return {
    ...(await waitForPairingChallengeReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation,
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    })),
    senderUsername: params.context.senderUsername,
  };
}
