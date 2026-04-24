import { createAccountListHelpers } from "openclaw/plugin-sdk/account-helpers";
import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveMergedAccountConfig } from "openclaw/plugin-sdk/account-resolution";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import { normalizeKeybaseAllowEntry, normalizeKeybaseGroupKey } from "./targets.js";
import type {
  CoreConfig,
  KeybaseResolvedAccountConfig,
  ResolvedKeybaseAccount,
  ResolvedKeybaseGroupConfig,
} from "./types.js";

export const DEFAULT_ACCOUNT_ID = "default";

const {
  listAccountIds: listKeybaseAccountIds,
  resolveDefaultAccountId: resolveDefaultKeybaseAccountId,
} = createAccountListHelpers("keybase", { normalizeAccountId });

export { listKeybaseAccountIds, resolveDefaultKeybaseAccountId };

function normalizeKeybaseAllowFrom(allowFrom: Array<string | number> | undefined): string[] {
  return [
    ...new Set(
      (allowFrom ?? [])
        .map((entry) => normalizeKeybaseAllowEntry(String(entry)))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ];
}

function normalizeKeybaseSkills(skills: string[] | undefined): string[] | undefined {
  const normalized = [...new Set((skills ?? []).map((entry) => entry.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeKeybaseGroups(
  groups: KeybaseResolvedAccountConfig["groups"],
): Record<string, ResolvedKeybaseGroupConfig> {
  const normalized: Record<string, ResolvedKeybaseGroupConfig> = {};
  for (const [rawKey, rawGroup] of Object.entries(groups ?? {})) {
    const key = rawKey === "*" ? "*" : normalizeKeybaseGroupKey(rawKey);
    if (!key) {
      continue;
    }
    normalized[key] = {
      allowFrom: normalizeKeybaseAllowFrom(rawGroup?.allowFrom),
      ...(rawGroup?.enabled !== undefined ? { enabled: rawGroup.enabled } : {}),
      ...(rawGroup?.requireMention !== undefined
        ? { requireMention: rawGroup.requireMention }
        : {}),
      ...(normalizeOptionalString(rawGroup?.systemPrompt)
        ? { systemPrompt: normalizeOptionalString(rawGroup?.systemPrompt) }
        : {}),
      ...(normalizeKeybaseSkills(rawGroup?.skills)
        ? { skills: normalizeKeybaseSkills(rawGroup?.skills) }
        : {}),
    };
  }
  return normalized;
}

function resolveMergedKeybaseAccountConfig(
  cfg: CoreConfig,
  accountId: string,
): KeybaseResolvedAccountConfig {
  return resolveMergedAccountConfig<KeybaseResolvedAccountConfig>({
    channelConfig: cfg.channels?.keybase as KeybaseResolvedAccountConfig | undefined,
    accounts: cfg.channels?.keybase?.accounts,
    accountId,
    nestedObjectKeys: ["execApprovals"],
    omitKeys: ["defaultAccount"],
    normalizeAccountId,
  });
}

function hasConfiguration(config: KeybaseResolvedAccountConfig): boolean {
  return Boolean(
    config.defaultTo?.trim() ||
    config.homeDir?.trim() ||
    config.pidFile?.trim() ||
    config.username?.trim() ||
    config.paperKey?.trim() ||
    config.paperKeyFile?.trim() ||
    config.socketFile?.trim(),
  );
}

export function resolveKeybaseAccount(params: {
  accountId?: string | null;
  cfg: CoreConfig;
}): ResolvedKeybaseAccount {
  const accountId = normalizeAccountId(params.accountId);
  const merged = resolveMergedKeybaseAccountConfig(params.cfg, accountId);
  const baseEnabled = params.cfg.channels?.keybase?.enabled !== false;
  const enabled = baseEnabled && merged.enabled !== false;

  return {
    accountId,
    enabled,
    allowFrom: normalizeKeybaseAllowFrom(merged.allowFrom),
    configured: hasConfiguration(merged),
    binary: merged.binary?.trim() || "keybase",
    enableTyping: merged.enableTyping === true,
    config: merged,
    dmPolicy: merged.dmPolicy ?? "pairing",
    groupPolicy: merged.groupPolicy ?? "allowlist",
    groups: normalizeKeybaseGroups(merged.groups),
    ...(normalizeOptionalString(merged.defaultTo)
      ? { defaultTo: normalizeOptionalString(merged.defaultTo) }
      : {}),
    ...(normalizeOptionalString(merged.homeDir)
      ? { homeDir: normalizeOptionalString(merged.homeDir) }
      : {}),
    ...(normalizeOptionalString(merged.name) ? { name: normalizeOptionalString(merged.name) } : {}),
    ...(normalizeOptionalString(merged.paperKey)
      ? { paperKey: normalizeOptionalString(merged.paperKey) }
      : {}),
    ...(normalizeOptionalString(merged.paperKeyFile)
      ? { paperKeyFile: normalizeOptionalString(merged.paperKeyFile) }
      : {}),
    ...(normalizeOptionalString(merged.pidFile)
      ? { pidFile: normalizeOptionalString(merged.pidFile) }
      : {}),
    ...(normalizeOptionalString(merged.socketFile)
      ? { socketFile: normalizeOptionalString(merged.socketFile) }
      : {}),
    ...(merged.textChunkLimit ? { textChunkLimit: merged.textChunkLimit } : {}),
    ...(normalizeOptionalString(merged.username)
      ? { username: normalizeOptionalString(merged.username) }
      : {}),
  };
}
