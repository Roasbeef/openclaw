import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import os from "node:os";
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
  realpath: typeof realpath;
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
  realpath,
  resolveNativeCommandsEnabled,
  resolveNativeSkillsEnabled,
};

const preparedAccounts = new Map<string, Promise<void>>();

function hashSecretForKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function buildPreparedAccountKey(account: ResolvedKeybaseAccount): string {
  return [
    account.binary,
    account.homeDir ?? "",
    account.socketFile ?? "",
    account.pidFile ?? "",
    account.username ?? "",
    account.paperKey ? hashSecretForKey(account.paperKey) : "",
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

// Default-deny prefixes for resolved media paths. Even if an operator has
// opted into local-file attachments via OPENCLAW_KEYBASE_MEDIA_ALLOW_DIRS,
// we refuse anything under these roots because they routinely contain
// credentials, secrets, or kernel state the bot should never exfiltrate.
const KEYBASE_MEDIA_DENY_PREFIXES = [
  "/etc",
  "/proc",
  "/sys",
  "/root",
  "/boot",
  "/dev",
  "/var/run/secrets",
  "/run/secrets",
  "/vault",
];

// Path basenames that are always forbidden anywhere in the resolved path.
// Catches dotdirs that hold secrets even when nested under an allow-listed
// root (e.g. /shared/.ssh/id_rsa).
const KEYBASE_MEDIA_DENY_PATH_SEGMENTS = new Set([
  ".ssh",
  ".keybase",
  ".gnupg",
  ".aws",
  ".docker",
  ".kube",
  ".openclaw",
  ".git-credentials",
  ".npmrc",
  ".pypirc",
]);

function resolveKeybaseMediaAllowDirs(): string[] {
  const raw = process.env.OPENCLAW_KEYBASE_MEDIA_ALLOW_DIRS ?? "";
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && path.isAbsolute(entry))
    .map((entry) => path.resolve(entry));
}

async function resolveLocalMediaPath(
  mediaUrl: string,
  deps: Pick<RuntimeDeps, "realpath">,
): Promise<string | null> {
  // Only accept file:// URLs. Bare absolute paths (the easiest vector for an
  // LLM-generated tool call to exfiltrate /etc/shadow or ~/.openclaw/openclaw.json)
  // are rejected outright.
  if (!mediaUrl.startsWith("file://")) {
    return null;
  }

  let candidate: string;
  try {
    candidate = fileURLToPath(mediaUrl);
  } catch {
    return null;
  }
  if (!path.isAbsolute(candidate)) {
    return null;
  }

  // Resolve symlinks so that an attacker can't smuggle a denylisted path
  // through a benign-looking symlink under an allow-listed root.
  let resolved: string;
  try {
    resolved = await deps.realpath(candidate);
  } catch {
    return null;
  }

  const segments = resolved.split(path.sep);
  for (const seg of segments) {
    if (KEYBASE_MEDIA_DENY_PATH_SEGMENTS.has(seg)) {
      return null;
    }
  }

  for (const prefix of KEYBASE_MEDIA_DENY_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(`${prefix}${path.sep}`)) {
      return null;
    }
  }

  // Refuse anything under the bot's home directory by default — that's where
  // openclaw.json (paper key, tokens), .ssh, .keybase live.
  const home = os.homedir();
  if (home && (resolved === home || resolved.startsWith(`${home}${path.sep}`))) {
    return null;
  }

  // Default deny unless the operator opted into one or more allow-listed
  // roots via OPENCLAW_KEYBASE_MEDIA_ALLOW_DIRS.
  const allowDirs = resolveKeybaseMediaAllowDirs();
  if (allowDirs.length === 0) {
    return null;
  }
  const inAllowedRoot = allowDirs.some(
    (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
  );
  if (!inAllowedRoot) {
    return null;
  }

  return resolved;
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

  const runtimeDeps = { ...defaultRuntimeDeps, ...params.deps };
  const localPath = await resolveLocalMediaPath(mediaUrl, runtimeDeps);
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
