import type { ExecApprovalReplyDecision } from "openclaw/plugin-sdk/approval-runtime";
import { normalizeAccountId } from "openclaw/plugin-sdk/routing";
import {
  isKeybaseConversationGroupKey,
  isKeybaseImplicitTeamGroupKey,
  normalizeKeybaseGroupKey,
  normalizeKeybaseTarget,
} from "./targets.js";

const KEYBASE_APPROVAL_REACTION_META = {
  "allow-once": {
    aliases: ["\u2705", ":white_check_mark:", ":heavy_check_mark:"],
    emoji: "\u2705",
    reaction: ":white_check_mark:",
    label: "Allow once",
  },
  "allow-always": {
    aliases: ["\u267e", "\u267e\ufe0f", ":infinity:"],
    emoji: "\u267e\ufe0f",
    reaction: ":infinity:",
    label: "Allow always",
  },
  deny: {
    aliases: ["\u274c", "\u2716", "\u2716\ufe0f", ":x:", ":negative_squared_cross_mark:"],
    emoji: "\u274c",
    reaction: ":x:",
    label: "Deny",
  },
} satisfies Record<
  ExecApprovalReplyDecision,
  { aliases: readonly string[]; emoji: string; reaction: string; label: string }
>;

const KEYBASE_APPROVAL_REACTION_ORDER = [
  "allow-once",
  "allow-always",
  "deny",
] as const satisfies readonly ExecApprovalReplyDecision[];

export type KeybaseApprovalReactionBinding = {
  decision: ExecApprovalReplyDecision;
  emoji: string;
  label: string;
  reaction: string;
};

export type KeybaseApprovalReactionResolution = {
  approvalId: string;
  decision: ExecApprovalReplyDecision;
  targetKey: string;
};

type KeybaseApprovalReactionTarget = {
  approvalId: string;
  allowedDecisions: readonly ExecApprovalReplyDecision[];
  expiresAtMs: number;
};

// M-2: bound the registry. A real approval window is short — a one-hour TTL
// is comfortably above any reasonable approval expiry, and a 1024-entry cap
// is well above any plausible concurrent-approval load while still preventing
// monotonic growth from gateway crashes or pathological reaction spam.
const KEYBASE_APPROVAL_REACTION_TTL_MS = 60 * 60 * 1000;
const KEYBASE_APPROVAL_REACTION_MAX_ENTRIES = 1024;

// JS Map iteration order is insertion order. We exploit that for cheap LRU:
// every read/write deletes-then-sets the entry, so the oldest entry is the
// first one returned by keys().next().
const keybaseApprovalReactionTargets = new Map<string, KeybaseApprovalReactionTarget>();

let keybaseApprovalReactionNowMs: () => number = () => Date.now();

function pruneExpiredKeybaseApprovalReactionTargets(nowMs: number): void {
  for (const [key, target] of keybaseApprovalReactionTargets) {
    if (target.expiresAtMs <= nowMs) {
      keybaseApprovalReactionTargets.delete(key);
    }
  }
}

function evictKeybaseApprovalReactionTargetsToCap(): void {
  while (keybaseApprovalReactionTargets.size > KEYBASE_APPROVAL_REACTION_MAX_ENTRIES) {
    const oldestKey = keybaseApprovalReactionTargets.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    keybaseApprovalReactionTargets.delete(oldestKey);
  }
}

function normalizeTargetKey(target: string): string | null {
  const groupKey = normalizeKeybaseGroupKey(target);
  if (groupKey) {
    return groupKey;
  }
  return normalizeKeybaseTarget(target) ?? null;
}

function normalizeMessageId(value: string | number | null | undefined): string {
  const trimmed = value == null ? "" : String(value).trim();
  return trimmed || "";
}

function buildReactionTargetKey(params: {
  accountId?: string | null;
  messageId: string | number | null | undefined;
  targetKey: string;
}): string | null {
  const accountId = normalizeAccountId(params.accountId);
  const messageId = normalizeMessageId(params.messageId);
  const targetKey = normalizeTargetKey(params.targetKey);
  if (!messageId || !targetKey) {
    return null;
  }
  return `${accountId}:${targetKey}:${messageId}`;
}

function normalizeReactionKey(value: string): string {
  return value.trim().toLowerCase().replaceAll("\ufe0f", "");
}

export function listKeybaseApprovalReactionBindings(
  allowedDecisions: readonly ExecApprovalReplyDecision[],
): KeybaseApprovalReactionBinding[] {
  const allowed = new Set(allowedDecisions);
  return KEYBASE_APPROVAL_REACTION_ORDER.filter((decision) => allowed.has(decision)).map(
    (decision) => ({
      decision,
      emoji: KEYBASE_APPROVAL_REACTION_META[decision].emoji,
      label: KEYBASE_APPROVAL_REACTION_META[decision].label,
      reaction: KEYBASE_APPROVAL_REACTION_META[decision].reaction,
    }),
  );
}

export function buildKeybaseApprovalReactionHint(
  allowedDecisions: readonly ExecApprovalReplyDecision[],
): string | null {
  const bindings = listKeybaseApprovalReactionBindings(allowedDecisions);
  if (bindings.length === 0) {
    return null;
  }
  return `React here: ${bindings.map((binding) => `${binding.emoji} ${binding.label}`).join(", ")}`;
}

export function resolveKeybaseApprovalReactionDecision(
  reactionBody: string,
  allowedDecisions: readonly ExecApprovalReplyDecision[],
): ExecApprovalReplyDecision | null {
  const normalizedReaction = normalizeReactionKey(reactionBody);
  if (!normalizedReaction) {
    return null;
  }
  const allowed = new Set(allowedDecisions);
  for (const decision of KEYBASE_APPROVAL_REACTION_ORDER) {
    if (!allowed.has(decision)) {
      continue;
    }
    const aliases = KEYBASE_APPROVAL_REACTION_META[decision].aliases.map(normalizeReactionKey);
    if (aliases.includes(normalizedReaction)) {
      return decision;
    }
  }
  return null;
}

export function registerKeybaseApprovalReactionTarget(params: {
  accountId?: string | null;
  targetKey: string;
  messageId: string | number | null | undefined;
  approvalId: string;
  allowedDecisions: readonly ExecApprovalReplyDecision[];
}): void {
  const key = buildReactionTargetKey(params);
  const approvalId = params.approvalId.trim();
  const allowedDecisions = Array.from(
    new Set(
      params.allowedDecisions.filter(
        (decision): decision is ExecApprovalReplyDecision =>
          decision === "allow-once" || decision === "allow-always" || decision === "deny",
      ),
    ),
  );
  if (!key || !approvalId || allowedDecisions.length === 0) {
    return;
  }
  const nowMs = keybaseApprovalReactionNowMs();
  pruneExpiredKeybaseApprovalReactionTargets(nowMs);
  // Re-insert to refresh insertion order so this entry becomes the most
  // recently used and won't be the first evicted.
  keybaseApprovalReactionTargets.delete(key);
  keybaseApprovalReactionTargets.set(key, {
    approvalId,
    allowedDecisions,
    expiresAtMs: nowMs + KEYBASE_APPROVAL_REACTION_TTL_MS,
  });
  evictKeybaseApprovalReactionTargetsToCap();
}

export function unregisterKeybaseApprovalReactionTarget(params: {
  accountId?: string | null;
  targetKey: string;
  messageId: string | number | null | undefined;
}): void {
  const key = buildReactionTargetKey(params);
  if (!key) {
    return;
  }
  keybaseApprovalReactionTargets.delete(key);
}

export function resolveKeybaseApprovalReactionTarget(params: {
  accountId?: string | null;
  targetKeys: readonly string[];
  messageId: string | number | null | undefined;
  reactionBody: string;
}): KeybaseApprovalReactionResolution | null {
  const normalized = params.targetKeys
    .map((raw) => {
      const normalizedKey = normalizeTargetKey(raw) ?? raw;
      return {
        raw,
        normalized: normalizedKey,
        isConv: isKeybaseConversationGroupKey(normalizedKey),
        isImplicitTeam: isKeybaseImplicitTeamGroupKey(normalizedKey),
      };
    })
    .filter((entry) => entry.normalized);
  const hasConvCandidate = normalized.some((entry) => entry.isConv);
  const ordered = [
    ...normalized.filter((entry) => entry.isConv),
    ...normalized.filter((entry) => !entry.isConv && !entry.isImplicitTeam),
    ...(hasConvCandidate ? [] : normalized.filter((entry) => entry.isImplicitTeam)),
  ];
  const nowMs = keybaseApprovalReactionNowMs();
  pruneExpiredKeybaseApprovalReactionTargets(nowMs);
  for (const entry of ordered) {
    const key = buildReactionTargetKey({
      accountId: params.accountId,
      targetKey: entry.raw,
      messageId: params.messageId,
    });
    if (!key) {
      continue;
    }
    const target = keybaseApprovalReactionTargets.get(key);
    if (!target) {
      continue;
    }
    const decision = resolveKeybaseApprovalReactionDecision(
      params.reactionBody,
      target.allowedDecisions,
    );
    if (!decision) {
      continue;
    }
    return {
      approvalId: target.approvalId,
      decision,
      targetKey: entry.raw,
    };
  }
  return null;
}

export function clearKeybaseApprovalReactionTargetsForTest(): void {
  keybaseApprovalReactionTargets.clear();
  keybaseApprovalReactionNowMs = () => Date.now();
}

export function setKeybaseApprovalReactionNowMsForTest(now: () => number): void {
  keybaseApprovalReactionNowMs = now;
}

export const KEYBASE_APPROVAL_REACTION_TTL_MS_FOR_TEST = KEYBASE_APPROVAL_REACTION_TTL_MS;
export const KEYBASE_APPROVAL_REACTION_MAX_ENTRIES_FOR_TEST = KEYBASE_APPROVAL_REACTION_MAX_ENTRIES;
