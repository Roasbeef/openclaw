import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  keybaseApiRequest,
  keybaseConfigureNotificationSettings,
  keybaseOneshot,
} from "./client.js";
import { buildKeybaseAttachRequest, buildKeybaseSendRequest } from "./protocol.js";
import { resolveKeybaseConversationRef } from "./targets.js";
import type { ResolvedKeybaseAccount } from "./types.js";

type SendResultPayload = {
  id?: number | string | null;
  outbox_id?: string | null;
};

type RuntimeDeps = {
  apiRequest: typeof keybaseApiRequest;
  configureNotificationSettings: typeof keybaseConfigureNotificationSettings;
  oneshot: typeof keybaseOneshot;
  readFile: typeof readFile;
};

const defaultRuntimeDeps: RuntimeDeps = {
  apiRequest: keybaseApiRequest,
  configureNotificationSettings: keybaseConfigureNotificationSettings,
  oneshot: keybaseOneshot,
  readFile,
};

const preparedAccounts = new Map<string, Promise<void>>();

function buildPreparedAccountKey(account: ResolvedKeybaseAccount): string {
  return [
    account.binary,
    account.homeDir ?? "",
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
