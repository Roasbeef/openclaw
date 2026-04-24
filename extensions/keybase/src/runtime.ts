import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listNativeCommandSpecsForConfig,
  listProviderPluginCommandSpecs,
  listSkillCommandsForAgents,
  type NativeCommandSpec,
} from "openclaw/plugin-sdk/command-auth";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import {
  resolveNativeCommandsEnabled,
  resolveNativeSkillsEnabled,
} from "openclaw/plugin-sdk/config-runtime";
import { chunkTextForOutbound } from "openclaw/plugin-sdk/text-chunking";
import {
  keybaseApiRequest,
  keybaseConfigureNotificationSettings,
  keybaseOneshot,
} from "./client.js";
import {
  buildKeybaseAttachRequest,
  buildKeybaseAdvertiseCommandsRequest,
  buildKeybaseClearCommandsRequest,
  buildKeybaseDeleteRequest,
  buildKeybaseEditRequest,
  buildKeybaseReactionRequest,
  buildKeybaseSendRequest,
  type KeybaseCommandDefinition,
} from "./protocol.js";
import { resolveKeybaseConversationRef } from "./targets.js";
import type { ResolvedKeybaseAccount } from "./types.js";

type SendResultPayload = {
  id?: number | string | null;
  outbox_id?: string | null;
};

type RuntimeDeps = {
  apiRequest: typeof keybaseApiRequest;
  configureNotificationSettings: typeof keybaseConfigureNotificationSettings;
  chunkTextForOutbound: typeof chunkTextForOutbound;
  listNativeCommandSpecsForConfig: typeof listNativeCommandSpecsForConfig;
  listProviderPluginCommandSpecs: typeof listProviderPluginCommandSpecs;
  listSkillCommandsForAgents: typeof listSkillCommandsForAgents;
  oneshot: typeof keybaseOneshot;
  readFile: typeof readFile;
  resolveNativeCommandsEnabled: typeof resolveNativeCommandsEnabled;
  resolveNativeSkillsEnabled: typeof resolveNativeSkillsEnabled;
};

const defaultRuntimeDeps: RuntimeDeps = {
  apiRequest: keybaseApiRequest,
  chunkTextForOutbound,
  configureNotificationSettings: keybaseConfigureNotificationSettings,
  listNativeCommandSpecsForConfig,
  listProviderPluginCommandSpecs,
  listSkillCommandsForAgents,
  oneshot: keybaseOneshot,
  readFile,
  resolveNativeCommandsEnabled,
  resolveNativeSkillsEnabled,
};

const preparedAccounts = new Map<string, Promise<void>>();

function buildPreparedAccountKey(account: ResolvedKeybaseAccount): string {
  return [
    account.binary,
    account.homeDir ?? "",
    account.socketFile ?? "",
    account.pidFile ?? "",
    account.username ?? "",
    account.paperKey ?? "",
    account.paperKeyFile ?? "",
    account.enableTyping ? "typing:1" : "typing:0",
  ].join("\u0000");
}

function resolveCliOptions(account: ResolvedKeybaseAccount) {
  return {
    binary: account.binary,
    ...(account.homeDir ? { homeDir: account.homeDir } : {}),
    ...(account.socketFile ? { socketFile: account.socketFile } : {}),
    ...(account.pidFile ? { pidFile: account.pidFile } : {}),
  };
}

function normalizeMessageId(value: number | string | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "";
}

function parseReplyToId(replyToId?: string | null): number | undefined {
  if (typeof replyToId !== "string" || !/^\d+$/.test(replyToId.trim())) {
    return undefined;
  }
  return Number.parseInt(replyToId.trim(), 10);
}

function parseMessageId(messageId: string): number {
  if (!/^\d+$/.test(messageId.trim())) {
    throw new Error(`Invalid Keybase message id: ${messageId}`);
  }
  return Number.parseInt(messageId.trim(), 10);
}

const KEYBASE_REACTION_SHORTCODES = new Map<string, string>([
  ["\u{1f440}", ":eyes:"],
  ["\u{2705}", ":white_check_mark:"],
]);
const DEFAULT_KEYBASE_TEXT_CHUNK_LIMIT = 4000;

type KeybaseCommandSpec = Pick<NativeCommandSpec, "acceptsArgs" | "description" | "name">;

function normalizeKeybaseAdvertisedCommandName(name: string): string {
  const trimmed = name.trim().replace(/^\/+/, "");
  return trimmed ? `/${trimmed}` : "";
}

function buildKeybaseCommandUsage(command: KeybaseCommandSpec): string | undefined {
  if (!command.acceptsArgs) {
    return undefined;
  }
  const args = "args" in command ? (command as NativeCommandSpec).args : undefined;
  if (!args?.length) {
    return "[args]";
  }
  const rendered = args.map((arg) => {
    const name = arg.captureRemaining ? `${arg.name}...` : arg.name;
    return arg.required ? `<${name}>` : `[${name}]`;
  });
  return rendered.join(" ");
}

function buildKeybaseCommandDefinitions(
  commands: readonly KeybaseCommandSpec[],
): KeybaseCommandDefinition[] {
  const seen = new Set<string>();
  const definitions: KeybaseCommandDefinition[] = [];
  for (const command of commands) {
    const name = normalizeKeybaseAdvertisedCommandName(command.name);
    const dedupeKey = name.toLowerCase();
    if (!name || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    definitions.push({
      name,
      description: command.description,
      ...(buildKeybaseCommandUsage(command) ? { usage: buildKeybaseCommandUsage(command) } : {}),
    });
  }
  return definitions;
}

function resolveKeybaseCommandAlias(account: ResolvedKeybaseAccount): string {
  return account.config.commands?.alias?.trim() || account.name?.trim() || "OpenClaw";
}

export function resolveKeybaseTextChunkLimit(account: ResolvedKeybaseAccount): number {
  return account.textChunkLimit ?? DEFAULT_KEYBASE_TEXT_CHUNK_LIMIT;
}

function resolveKeybaseTextChunks(params: {
  account: ResolvedKeybaseAccount;
  deps: RuntimeDeps;
  text: string;
}): string[] {
  const limit = resolveKeybaseTextChunkLimit(params.account);
  const chunks = params.deps.chunkTextForOutbound(params.text, limit).filter((chunk) => chunk);
  return chunks.length > 0 ? chunks : params.text ? [params.text] : [];
}

export function normalizeKeybaseReactionBody(reaction: string): string {
  const trimmed = reaction.trim();
  return KEYBASE_REACTION_SHORTCODES.get(trimmed) ?? trimmed;
}

async function resolvePaperKey(
  account: ResolvedKeybaseAccount,
  deps: RuntimeDeps,
): Promise<string | undefined> {
  if (account.paperKey) {
    return account.paperKey;
  }
  if (!account.paperKeyFile) {
    return undefined;
  }
  return (await deps.readFile(account.paperKeyFile, "utf8")).trim() || undefined;
}

export function resetKeybasePreparedAccountCache() {
  preparedAccounts.clear();
}

export async function ensureKeybaseAccountPrepared(
  account: ResolvedKeybaseAccount,
  deps: Partial<RuntimeDeps> = {},
): Promise<void> {
  const runtimeDeps = { ...defaultRuntimeDeps, ...deps };
  const cacheKey = buildPreparedAccountKey(account);
  const existing = preparedAccounts.get(cacheKey);
  if (existing) {
    await existing;
    return;
  }

  const pending = (async () => {
    const paperKey = await resolvePaperKey(account, runtimeDeps);
    if (account.username && paperKey) {
      await runtimeDeps.oneshot(
        { username: account.username, paperKey },
        resolveCliOptions(account),
      );
    }
    await runtimeDeps.configureNotificationSettings(
      { enableTyping: account.enableTyping },
      resolveCliOptions(account),
    );
  })();

  preparedAccounts.set(cacheKey, pending);
  try {
    await pending;
  } catch (error) {
    preparedAccounts.delete(cacheKey);
    throw error;
  }
}

export async function syncKeybaseCommandAdvertisements(params: {
  account: ResolvedKeybaseAccount;
  cfg: OpenClawConfig;
  deps?: Partial<RuntimeDeps>;
}): Promise<{ advertised: number; cleared: boolean }> {
  const runtimeDeps = { ...defaultRuntimeDeps, ...params.deps };
  await ensureKeybaseAccountPrepared(params.account, runtimeDeps);

  const nativeEnabled = runtimeDeps.resolveNativeCommandsEnabled({
    providerId: "keybase",
    providerSetting: params.account.config.commands?.native,
    globalSetting: params.cfg.commands?.native,
  });
  const cliOptions = resolveCliOptions(params.account);
  if (!nativeEnabled) {
    await runtimeDeps.apiRequest(buildKeybaseClearCommandsRequest(), cliOptions);
    return { advertised: 0, cleared: true };
  }

  const nativeSkillsEnabled = runtimeDeps.resolveNativeSkillsEnabled({
    providerId: "keybase",
    providerSetting: params.account.config.commands?.nativeSkills,
    globalSetting: params.cfg.commands?.nativeSkills,
  });
  const skillCommands = nativeSkillsEnabled
    ? runtimeDeps.listSkillCommandsForAgents({ cfg: params.cfg })
    : [];
  const nativeCommands = runtimeDeps.listNativeCommandSpecsForConfig(params.cfg, {
    skillCommands,
    provider: "keybase",
  });
  const pluginCommands = runtimeDeps.listProviderPluginCommandSpecs("keybase");
  const commands = buildKeybaseCommandDefinitions([...nativeCommands, ...pluginCommands]);
  if (commands.length === 0) {
    await runtimeDeps.apiRequest(buildKeybaseClearCommandsRequest(), cliOptions);
    return { advertised: 0, cleared: true };
  }

  await runtimeDeps.apiRequest(
    buildKeybaseAdvertiseCommandsRequest({
      alias: resolveKeybaseCommandAlias(params.account),
      advertisements: [
        {
          type: "public",
          commands,
        },
      ],
    }),
    cliOptions,
  );
  return { advertised: commands.length, cleared: false };
}

export async function sendKeybaseText(params: {
  account: ResolvedKeybaseAccount;
  replyToId?: string | null;
  text: string;
  to: string;
  deps?: Partial<RuntimeDeps>;
}): Promise<{ messageId: string }> {
  const conversationRef = resolveKeybaseConversationRef(params.to);
  if (!conversationRef) {
    throw new Error(`Invalid Keybase target: ${params.to}`);
  }
  const runtimeDeps = { ...defaultRuntimeDeps, ...params.deps };
  await ensureKeybaseAccountPrepared(params.account, runtimeDeps);
  const result = await runtimeDeps.apiRequest<SendResultPayload>(
    buildKeybaseSendRequest({
      ...conversationRef,
      body: params.text,
      ...(parseReplyToId(params.replyToId) !== undefined
        ? { replyTo: parseReplyToId(params.replyToId) }
        : {}),
    }),
    resolveCliOptions(params.account),
  );
  return {
    messageId: normalizeMessageId(result.id ?? result.outbox_id),
  };
}

export async function sendKeybaseTextChunks(params: {
  account: ResolvedKeybaseAccount;
  replyToId?: string | null;
  text: string;
  to: string;
  deps?: Partial<RuntimeDeps>;
}): Promise<{ messageId: string; sent: number }> {
  const runtimeDeps = { ...defaultRuntimeDeps, ...params.deps };
  const chunks = resolveKeybaseTextChunks({
    account: params.account,
    deps: runtimeDeps,
    text: params.text,
  });
  let messageId = "";
  let sent = 0;
  for (const chunk of chunks) {
    const result = await sendKeybaseText({
      ...params,
      text: chunk,
      deps: runtimeDeps,
    });
    messageId = result.messageId || messageId;
    sent += 1;
  }
  return { messageId, sent };
}

export async function sendKeybaseReaction(params: {
  account: ResolvedKeybaseAccount;
  emoji: string;
  messageId: string;
  to: string;
  deps?: Partial<RuntimeDeps>;
}): Promise<{ messageId: string }> {
  const conversationRef = resolveKeybaseConversationRef(params.to);
  if (!conversationRef) {
    throw new Error(`Invalid Keybase target: ${params.to}`);
  }
  const runtimeDeps = { ...defaultRuntimeDeps, ...params.deps };
  await ensureKeybaseAccountPrepared(params.account, runtimeDeps);
  const result = await runtimeDeps.apiRequest<SendResultPayload>(
    buildKeybaseReactionRequest({
      ...conversationRef,
      body: normalizeKeybaseReactionBody(params.emoji),
      messageId: parseMessageId(params.messageId),
    }),
    resolveCliOptions(params.account),
  );
  return {
    messageId: normalizeMessageId(result.id ?? result.outbox_id),
  };
}

export async function editKeybaseText(params: {
  account: ResolvedKeybaseAccount;
  messageId: string;
  text: string;
  to: string;
  deps?: Partial<RuntimeDeps>;
}): Promise<void> {
  const conversationRef = resolveKeybaseConversationRef(params.to);
  if (!conversationRef) {
    throw new Error(`Invalid Keybase target: ${params.to}`);
  }
  const runtimeDeps = { ...defaultRuntimeDeps, ...params.deps };
  await ensureKeybaseAccountPrepared(params.account, runtimeDeps);
  await runtimeDeps.apiRequest(
    buildKeybaseEditRequest({
      ...conversationRef,
      body: params.text,
      messageId: parseMessageId(params.messageId),
    }),
    resolveCliOptions(params.account),
  );
}

export async function deleteKeybaseMessage(params: {
  account: ResolvedKeybaseAccount;
  messageId: string;
  to: string;
  deps?: Partial<RuntimeDeps>;
}): Promise<void> {
  const conversationRef = resolveKeybaseConversationRef(params.to);
  if (!conversationRef) {
    throw new Error(`Invalid Keybase target: ${params.to}`);
  }
  const runtimeDeps = { ...defaultRuntimeDeps, ...params.deps };
  await ensureKeybaseAccountPrepared(params.account, runtimeDeps);
  await runtimeDeps.apiRequest(
    buildKeybaseDeleteRequest({
      ...conversationRef,
      messageId: parseMessageId(params.messageId),
    }),
    resolveCliOptions(params.account),
  );
}

function resolveLocalMediaPath(mediaUrl: string): string | null {
  if (mediaUrl.startsWith("file://")) {
    try {
      return fileURLToPath(mediaUrl);
    } catch {
      return null;
    }
  }
  return path.isAbsolute(mediaUrl) ? mediaUrl : null;
}

export async function sendKeybaseMedia(params: {
  account: ResolvedKeybaseAccount;
  mediaUrl?: string | null;
  replyToId?: string | null;
  text: string;
  to: string;
  deps?: Partial<RuntimeDeps>;
}): Promise<{ messageId: string }> {
  const mediaUrl = params.mediaUrl?.trim();
  if (!mediaUrl) {
    return await sendKeybaseText(params);
  }

  const localPath = resolveLocalMediaPath(mediaUrl);
  if (!localPath) {
    const combinedText = params.text
      ? `${params.text}\n\nAttachment: ${mediaUrl}`
      : `Attachment: ${mediaUrl}`;
    return await sendKeybaseText({ ...params, text: combinedText });
  }

  const conversationRef = resolveKeybaseConversationRef(params.to);
  if (!conversationRef) {
    throw new Error(`Invalid Keybase target: ${params.to}`);
  }
  const runtimeDeps = { ...defaultRuntimeDeps, ...params.deps };
  await ensureKeybaseAccountPrepared(params.account, runtimeDeps);

  let lastMessageId = "";
  if (params.text.trim().length > 0) {
    lastMessageId = (await sendKeybaseText({ ...params, deps: runtimeDeps })).messageId;
  }

  const attachResult = await runtimeDeps.apiRequest<SendResultPayload>(
    buildKeybaseAttachRequest({
      ...conversationRef,
      filename: localPath,
      title: path.basename(localPath),
    }),
    resolveCliOptions(params.account),
  );

  return {
    messageId: normalizeMessageId(attachResult.id ?? attachResult.outbox_id) || lastMessageId,
  };
}
