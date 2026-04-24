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
      const result = await sendKeybaseText({
        account,
        to: preparedTarget.to,
        text: pendingPayload.text,
      });
      await Promise.allSettled(
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
