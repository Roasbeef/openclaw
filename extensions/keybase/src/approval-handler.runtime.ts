import type {
  PendingApprovalView,
  ResolvedApprovalView,
} from "openclaw/plugin-sdk/approval-handler-runtime";
import { createChannelApprovalNativeRuntimeAdapter } from "openclaw/plugin-sdk/approval-handler-runtime";
import { buildChannelApprovalNativeTargetKey } from "openclaw/plugin-sdk/approval-native-runtime";
import {
  buildExecApprovalPendingReplyPayload,
  buildPluginApprovalPendingReplyPayload,
  type ExecApprovalReplyDecision,
} from "openclaw/plugin-sdk/approval-reply-runtime";
import { buildPluginApprovalResolvedReplyPayload } from "openclaw/plugin-sdk/approval-runtime";
import type { ExecApprovalRequest, PluginApprovalRequest } from "openclaw/plugin-sdk/infra-runtime";
import { resolveKeybaseAccount } from "./accounts.js";
import {
  buildKeybaseApprovalReactionHint,
  listKeybaseApprovalReactionBindings,
  registerKeybaseApprovalReactionTarget,
  unregisterKeybaseApprovalReactionTarget,
} from "./approval-reactions.js";
import {
  isKeybaseAnyApprovalClientEnabled,
  shouldHandleKeybaseApprovalRequest,
} from "./exec-approvals.js";
import {
  deleteKeybaseMessage,
  editKeybaseText,
  sendKeybaseReaction,
  sendKeybaseText,
  sendKeybaseTextChunks,
} from "./runtime.js";
import { normalizeKeybaseGroupKey, normalizeKeybaseTarget } from "./targets.js";
import type { CoreConfig } from "./types.js";

type PendingMessage = {
  targetKey: string;
  messageId: string;
};
type PreparedKeybaseTarget = {
  to: string;
  targetKey: string;
};
type PendingApprovalContent = {
  approvalId: string;
  text: string;
  allowedDecisions: readonly ExecApprovalReplyDecision[];
};
type ReactionTargetRef = {
  targetKey: string;
  messageId: string;
};
type KeybaseRawApprovalTarget = {
  to: string;
};

const DEFAULT_KEYBASE_APPROVAL_PROMPT_LIMIT = 3_800;
const MIN_KEYBASE_APPROVAL_PROMPT_LIMIT = 512;
const KEYBASE_APPROVAL_TRUNCATION_NOTICE =
  "\n\n[Approval details are too long for one Keybase message. React here; full details follow.]";

function normalizeKeybaseApprovalTarget(raw: string): string | null {
  return normalizeKeybaseTarget(raw) ?? null;
}

function normalizeKeybaseApprovalTargetKey(raw: string): string | null {
  return normalizeKeybaseGroupKey(raw) ?? normalizeKeybaseApprovalTarget(raw);
}

function prepareTarget(rawTarget: KeybaseRawApprovalTarget): PreparedKeybaseTarget | null {
  const to = normalizeKeybaseApprovalTarget(rawTarget.to);
  if (!to) {
    return null;
  }
  const targetKey = normalizeKeybaseApprovalTargetKey(to);
  if (!targetKey) {
    return null;
  }
  return { to, targetKey };
}

function buildPendingApprovalContent(params: {
  view: PendingApprovalView;
  nowMs: number;
}): PendingApprovalContent {
  const allowedDecisions = params.view.actions.map((action) => action.decision);
  const payload =
    params.view.approvalKind === "plugin"
      ? buildPluginApprovalPendingReplyPayload({
          request: {
            id: params.view.approvalId,
            request: {
              title: params.view.title,
              description: params.view.description ?? "",
              severity: params.view.severity,
              toolName: params.view.toolName ?? undefined,
              pluginId: params.view.pluginId ?? undefined,
              agentId: params.view.agentId ?? undefined,
            },
            createdAtMs: 0,
            expiresAtMs: params.view.expiresAtMs,
          } satisfies PluginApprovalRequest,
          nowMs: params.nowMs,
          allowedDecisions,
        })
      : buildExecApprovalPendingReplyPayload({
          approvalId: params.view.approvalId,
          approvalSlug: params.view.approvalId.slice(0, 8),
          approvalCommandId: params.view.approvalId,
          ask: params.view.ask ?? undefined,
          agentId: params.view.agentId ?? undefined,
          allowedDecisions,
          command: params.view.commandText,
          cwd: params.view.cwd ?? undefined,
          host: params.view.host === "node" ? "node" : "gateway",
          nodeId: params.view.nodeId ?? undefined,
          sessionKey: params.view.sessionKey ?? undefined,
          expiresAtMs: params.view.expiresAtMs,
          nowMs: params.nowMs,
        });
  const hint = buildKeybaseApprovalReactionHint(allowedDecisions);
  const text = payload.text ?? "";
  return {
    approvalId: params.view.approvalId,
    text: hint ? (text ? `${hint}\n\n${text}` : hint) : text,
    allowedDecisions,
  };
}

function buildMarkdownCodeBlock(text: string): string {
  const longestFence = Math.max(...Array.from(text.matchAll(/`+/g), (match) => match[0].length), 0);
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return [fence, text, fence].join("\n");
}

function buildResolvedApprovalText(view: ResolvedApprovalView): string {
  if (view.approvalKind === "plugin") {
    return (
      buildPluginApprovalResolvedReplyPayload({
        resolved: {
          id: view.approvalId,
          decision: view.decision,
          resolvedBy: view.resolvedBy ?? undefined,
          ts: 0,
        },
      }).text ?? ""
    );
  }
  const decisionLabel =
    view.decision === "allow-once"
      ? "Allowed once"
      : view.decision === "allow-always"
        ? "Allowed always"
        : "Denied";
  return [
    `Exec approval: ${decisionLabel}`,
    "",
    "Command",
    buildMarkdownCodeBlock(view.commandText),
  ].join("\n");
}

function normalizeReactionTargetRef(params: ReactionTargetRef): ReactionTargetRef | null {
  const targetKey = normalizeKeybaseApprovalTargetKey(params.targetKey);
  const messageId = params.messageId.trim();
  if (!targetKey || !messageId) {
    return null;
  }
  return { targetKey, messageId };
}

function sliceByCodePointUtf16Limit(text: string, limit: number): string {
  let output = "";
  for (const char of text) {
    if (output.length + char.length > limit) {
      break;
    }
    output += char;
  }
  return output;
}

export function buildKeybaseApprovalPendingMessages(params: { limit?: number; text: string }): {
  detailText?: string;
  promptText: string;
} {
  const limit = Math.max(
    MIN_KEYBASE_APPROVAL_PROMPT_LIMIT,
    Math.min(
      params.limit ?? DEFAULT_KEYBASE_APPROVAL_PROMPT_LIMIT,
      DEFAULT_KEYBASE_APPROVAL_PROMPT_LIMIT,
    ),
  );
  if (params.text.length <= limit) {
    return { promptText: params.text };
  }

  const headLimit = Math.max(1, limit - KEYBASE_APPROVAL_TRUNCATION_NOTICE.length);
  // M-7(b): UTF-16 `.slice(headLimit)` can split a non-BMP emoji surrogate
  // pair, producing a lone surrogate that breaks strict JSON parsers
  // (Keybase server, downstream relays). Iterate code points, but keep the
  // public limit measured in UTF-16 units because Keybase send bounds use
  // JavaScript string lengths elsewhere in this plugin.
  const headText = sliceByCodePointUtf16Limit(params.text, headLimit);
  const promptText = `${headText.trimEnd()}${KEYBASE_APPROVAL_TRUNCATION_NOTICE}`;
  return {
    promptText,
    detailText: params.text,
  };
}

export const keybaseApprovalNativeRuntime = createChannelApprovalNativeRuntimeAdapter<
  PendingApprovalContent,
  PreparedKeybaseTarget,
  PendingMessage,
  ReactionTargetRef,
  string
>({
  eventKinds: ["exec", "plugin"],
  availability: {
    isConfigured: ({ cfg, accountId }) =>
      isKeybaseAnyApprovalClientEnabled({
        cfg,
        accountId,
      }),
    shouldHandle: ({ cfg, accountId, request }) =>
      shouldHandleKeybaseApprovalRequest({
        cfg,
        accountId,
        request: request as ExecApprovalRequest | PluginApprovalRequest,
      }),
  },
  presentation: {
    buildPendingPayload: ({ view, nowMs }) =>
      buildPendingApprovalContent({
        view,
        nowMs,
      }),
    buildResolvedResult: ({ view }) => ({
      kind: "update",
      payload: buildResolvedApprovalText(view),
    }),
    buildExpiredResult: () => ({ kind: "delete" }),
  },
  transport: {
    prepareTarget: ({ plannedTarget }) => {
      const preparedTarget = prepareTarget(plannedTarget.target as KeybaseRawApprovalTarget);
      return preparedTarget
        ? {
            dedupeKey: buildChannelApprovalNativeTargetKey({
              to: preparedTarget.targetKey,
            }),
            target: preparedTarget,
          }
        : null;
    },
    deliverPending: async ({ cfg, accountId, preparedTarget, pendingPayload }) => {
      const account = resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId });
      const messages = buildKeybaseApprovalPendingMessages({
        limit: account.textChunkLimit,
        text: pendingPayload.text,
      });
      const result = await sendKeybaseText({
        account,
        to: preparedTarget.to,
        text: messages.promptText,
      });
      // M-1: register the reaction target as soon as we have the prompt
      // messageId so an approver who reacts before bindPending fires (e.g.
      // before reactions/detail-text chunks finish posting) is not silently
      // dropped against an empty registry. bindPending remains the canonical
      // path; calling register here is idempotent (same key in the Map).
      registerKeybaseApprovalReactionTarget({
        accountId,
        targetKey: preparedTarget.targetKey,
        messageId: result.messageId,
        approvalId: pendingPayload.approvalId,
        allowedDecisions: pendingPayload.allowedDecisions,
      });
      const reactionResults = await Promise.allSettled(
        listKeybaseApprovalReactionBindings(pendingPayload.allowedDecisions).map(
          async ({ reaction }) => {
            await sendKeybaseReaction({
              account,
              to: preparedTarget.to,
              messageId: result.messageId,
              emoji: reaction,
            });
          },
        ),
      );
      // M-3: keep allSettled (each reaction failure is independent) but
      // surface rejections so a prompt that lands without any clickable
      // emoji is observable in operator logs instead of vanishing.
      for (const settled of reactionResults) {
        if (settled.status === "rejected") {
          console.warn(
            `[keybase] approval reaction send failed approval=${pendingPayload.approvalId} target=${preparedTarget.targetKey} message=${result.messageId}: ${String(settled.reason)}`,
          );
        }
      }
      if (messages.detailText) {
        await sendKeybaseTextChunks({
          account,
          to: preparedTarget.to,
          text: messages.detailText,
          replyToId: result.messageId,
        }).catch(() => undefined);
      }
      return {
        targetKey: preparedTarget.targetKey,
        messageId: result.messageId,
      };
    },
    updateEntry: async ({ cfg, accountId, entry, payload }) => {
      const account = resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId });
      await editKeybaseText({
        account,
        to: entry.targetKey,
        messageId: entry.messageId,
        text: payload,
      });
    },
    deleteEntry: async ({ cfg, accountId, entry }) => {
      const account = resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId });
      await deleteKeybaseMessage({
        account,
        to: entry.targetKey,
        messageId: entry.messageId,
      });
    },
  },
  interactions: {
    bindPending: ({ accountId, entry, pendingPayload }) => {
      const target = normalizeReactionTargetRef(entry);
      if (!target) {
        return null;
      }
      registerKeybaseApprovalReactionTarget({
        accountId,
        targetKey: target.targetKey,
        messageId: target.messageId,
        approvalId: pendingPayload.approvalId,
        allowedDecisions: pendingPayload.allowedDecisions,
      });
      return target;
    },
    unbindPending: ({ accountId, binding }) => {
      const target = normalizeReactionTargetRef(binding);
      if (!target) {
        return;
      }
      unregisterKeybaseApprovalReactionTarget({
        accountId,
        targetKey: target.targetKey,
        messageId: target.messageId,
      });
    },
  },
});
