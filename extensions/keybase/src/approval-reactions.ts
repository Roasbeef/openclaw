import type { ExecApprovalReplyDecision } from "openclaw/plugin-sdk/approval-runtime";
import { normalizeAccountId } from "openclaw/plugin-sdk/routing";
import { normalizeKeybaseGroupKey, normalizeKeybaseTarget } from "./targets.js";

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
};

const keybaseApprovalReactionTargets = new Map<string, KeybaseApprovalReactionTarget>();

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
  keybaseApprovalReactionTargets.set(key, {
    approvalId,
    allowedDecisions,
  });
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
  for (const targetKey of params.targetKeys) {
    const key = buildReactionTargetKey({
      accountId: params.accountId,
      targetKey,
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
      targetKey,
    };
  }
  return null;
}

export function clearKeybaseApprovalReactionTargetsForTest(): void {
  keybaseApprovalReactionTargets.clear();
}
