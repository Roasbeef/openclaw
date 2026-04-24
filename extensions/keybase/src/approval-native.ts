import {
  createApproverRestrictedNativeApprovalCapability,
  createChannelApprovalCapability,
  splitChannelApprovalCapability,
} from "openclaw/plugin-sdk/approval-delivery-runtime";
import { createLazyChannelApprovalNativeRuntimeAdapter } from "openclaw/plugin-sdk/approval-handler-adapter-runtime";
import type { ChannelApprovalNativeRuntimeAdapter } from "openclaw/plugin-sdk/approval-handler-runtime";
import {
  createChannelNativeOriginTargetResolver,
  resolveApprovalRequestSessionConversation,
} from "openclaw/plugin-sdk/approval-native-runtime";
import type { ChannelApprovalCapability } from "openclaw/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { ExecApprovalRequest, PluginApprovalRequest } from "openclaw/plugin-sdk/infra-runtime";
import { listKeybaseAccountIds } from "./accounts.js";
import { authorizeKeybaseApprovalActor } from "./approval-auth.js";
import {
  getKeybaseApprovalApprovers,
  getKeybaseExecApprovalApprovers,
  getKeybasePluginApprovalApprovers,
  isKeybaseAnyApprovalClientEnabled,
  isKeybaseApprovalClientEnabled,
  isKeybaseExecApprovalAuthorizedSender,
  resolveKeybaseExecApprovalTarget,
  shouldHandleKeybaseApprovalRequest,
} from "./exec-approvals.js";
import {
  buildKeybaseDmTarget,
  normalizeKeybaseGroupKey,
  normalizeKeybaseTarget,
  parseKeybaseTarget,
} from "./targets.js";
import type { CoreConfig } from "./types.js";

type ApprovalRequest = ExecApprovalRequest | PluginApprovalRequest;
type ApprovalKind = "exec" | "plugin";
type KeybaseOriginTarget = { to: string };

function normalizeComparableTarget(value: string): string {
  return normalizeKeybaseGroupKey(value) ?? normalizeKeybaseTarget(value) ?? value.trim();
}

function resolveKeybaseNativeTarget(raw: string): string | null {
  return normalizeKeybaseTarget(raw) ?? null;
}

function resolveTurnSourceKeybaseOriginTarget(
  request: ApprovalRequest,
): KeybaseOriginTarget | null {
  const turnSourceChannel = request.request.turnSourceChannel?.trim().toLowerCase() ?? "";
  const turnSourceTo = request.request.turnSourceTo?.trim() || "";
  const target = resolveKeybaseNativeTarget(turnSourceTo);
  if (turnSourceChannel !== "keybase" || !target) {
    return null;
  }
  return { to: target };
}

function resolveSessionKeybaseOriginTarget(sessionTarget: {
  to: string;
  threadId?: string | number | null;
}): KeybaseOriginTarget | null {
  const target = resolveKeybaseNativeTarget(sessionTarget.to);
  return target ? { to: target } : null;
}

function keybaseTargetsMatch(a: KeybaseOriginTarget, b: KeybaseOriginTarget): boolean {
  return normalizeComparableTarget(a.to) === normalizeComparableTarget(b.to);
}

function hasKeybaseApprovalApprovers(params: {
  cfg: CoreConfig;
  accountId?: string | null;
  approvalKind: ApprovalKind;
}): boolean {
  return getKeybaseApprovalApprovers(params).length > 0;
}

function hasAnyKeybaseApprovalApprovers(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): boolean {
  return (
    getKeybaseExecApprovalApprovers(params).length > 0 ||
    getKeybasePluginApprovalApprovers(params).length > 0
  );
}

function availabilityState(enabled: boolean) {
  return enabled ? ({ kind: "enabled" } as const) : ({ kind: "disabled" } as const);
}

function resolveSuppressionAccountId(params: {
  target: { accountId?: string | null };
  request: { request: { turnSourceAccountId?: string | null } };
}): string | undefined {
  return (
    params.target.accountId?.trim() ||
    params.request.request.turnSourceAccountId?.trim() ||
    undefined
  );
}

const resolveKeybaseOriginTarget = createChannelNativeOriginTargetResolver({
  channel: "keybase",
  shouldHandleRequest: ({ cfg, accountId, request }) =>
    shouldHandleKeybaseApprovalRequest({
      cfg,
      accountId,
      request,
    }),
  resolveTurnSourceTarget: resolveTurnSourceKeybaseOriginTarget,
  resolveSessionTarget: resolveSessionKeybaseOriginTarget,
  targetsMatch: keybaseTargetsMatch,
  resolveFallbackTarget: (request) => {
    const sessionConversation = resolveApprovalRequestSessionConversation({
      request,
      channel: "keybase",
    });
    if (!sessionConversation) {
      return null;
    }
    const target = resolveKeybaseNativeTarget(sessionConversation.id);
    return target ? { to: target } : null;
  },
});

function resolveKeybaseApproverDmTargets(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  approvalKind: ApprovalKind;
  request: ApprovalRequest;
}): { to: string }[] {
  if (!shouldHandleKeybaseApprovalRequest(params)) {
    return [];
  }
  return getKeybaseApprovalApprovers(params)
    .map((approver) => buildKeybaseDmTarget(approver))
    .filter((target): target is string => Boolean(target))
    .map((to) => ({ to }));
}

const keybaseNativeApprovalCapability = createApproverRestrictedNativeApprovalCapability({
  channel: "keybase",
  channelLabel: "Keybase",
  describeExecApprovalSetup: ({
    accountId,
  }: Parameters<NonNullable<ChannelApprovalCapability["describeExecApprovalSetup"]>>[0]) => {
    const prefix =
      accountId && accountId !== "default"
        ? `channels.keybase.accounts.${accountId}`
        : "channels.keybase";
    return `Approve it from the Web UI or terminal UI for now. Keybase supports native exec approvals for this account. Configure \`${prefix}.execApprovals.approvers\`; set \`${prefix}.execApprovals.enabled\` to \`true\` or \`"auto"\`.`;
  },
  listAccountIds: listKeybaseAccountIds,
  hasApprovers: ({ cfg, accountId }) =>
    hasAnyKeybaseApprovalApprovers({
      cfg: cfg as CoreConfig,
      accountId,
    }),
  isExecAuthorizedSender: ({ cfg, accountId, senderId }) =>
    isKeybaseExecApprovalAuthorizedSender({ cfg, accountId, senderId }),
  isPluginAuthorizedSender: ({ cfg, accountId, senderId }) =>
    authorizeKeybaseApprovalActor({
      cfg: cfg as CoreConfig,
      accountId,
      senderId,
      action: "approve",
      approvalKind: "plugin",
    }).authorized,
  isNativeDeliveryEnabled: ({ cfg, accountId }) =>
    isKeybaseAnyApprovalClientEnabled({ cfg, accountId }),
  resolveNativeDeliveryMode: ({ cfg, accountId }) =>
    resolveKeybaseExecApprovalTarget({ cfg, accountId }),
  requireMatchingTurnSourceChannel: true,
  resolveSuppressionAccountId,
  resolveOriginTarget: resolveKeybaseOriginTarget,
  resolveApproverDmTargets: resolveKeybaseApproverDmTargets,
  notifyOriginWhenDmOnly: true,
  nativeRuntime: createLazyChannelApprovalNativeRuntimeAdapter({
    eventKinds: ["exec", "plugin"],
    isConfigured: ({ cfg, accountId }) =>
      isKeybaseAnyApprovalClientEnabled({
        cfg,
        accountId,
      }),
    shouldHandle: ({ cfg, accountId, request }) =>
      shouldHandleKeybaseApprovalRequest({
        cfg,
        accountId,
        request,
      }),
    load: async () =>
      (await import("./approval-handler.runtime.js"))
        .keybaseApprovalNativeRuntime as unknown as ChannelApprovalNativeRuntimeAdapter,
  }),
});

const splitKeybaseApprovalCapability = splitChannelApprovalCapability(
  keybaseNativeApprovalCapability,
);
const keybaseBaseNativeApprovalAdapter = splitKeybaseApprovalCapability.native;
const keybaseBaseDeliveryAdapter = splitKeybaseApprovalCapability.delivery;

type KeybaseForwardingSuppressionParams = Parameters<
  NonNullable<NonNullable<typeof keybaseBaseDeliveryAdapter>["shouldSuppressForwardingFallback"]>
>[0];

const keybaseDeliveryAdapter = keybaseBaseDeliveryAdapter && {
  ...keybaseBaseDeliveryAdapter,
  shouldSuppressForwardingFallback: (params: KeybaseForwardingSuppressionParams) => {
    const accountId = resolveSuppressionAccountId(params);
    if (
      !hasKeybaseApprovalApprovers({
        cfg: params.cfg as CoreConfig,
        accountId,
        approvalKind: params.approvalKind,
      })
    ) {
      return false;
    }
    return keybaseBaseDeliveryAdapter.shouldSuppressForwardingFallback?.(params) ?? false;
  },
};

const keybaseNativeAdapter = keybaseBaseNativeApprovalAdapter && {
  describeDeliveryCapabilities: (
    params: Parameters<typeof keybaseBaseNativeApprovalAdapter.describeDeliveryCapabilities>[0],
  ) => {
    const capabilities = keybaseBaseNativeApprovalAdapter.describeDeliveryCapabilities(params);
    const approvalKind = params.approvalKind ?? "exec";
    const hasApprovers = hasKeybaseApprovalApprovers({
      cfg: params.cfg as CoreConfig,
      accountId: params.accountId,
      approvalKind,
    });
    const clientEnabled = isKeybaseApprovalClientEnabled({
      cfg: params.cfg,
      accountId: params.accountId,
      approvalKind,
    });
    return {
      ...capabilities,
      enabled: capabilities.enabled && hasApprovers && clientEnabled,
    };
  },
  resolveOriginTarget: keybaseBaseNativeApprovalAdapter.resolveOriginTarget,
  resolveApproverDmTargets: keybaseBaseNativeApprovalAdapter.resolveApproverDmTargets,
};

export const keybaseApprovalCapability = createChannelApprovalCapability({
  authorizeActorAction: (
    params: Parameters<NonNullable<ChannelApprovalCapability["authorizeActorAction"]>>[0],
  ) =>
    authorizeKeybaseApprovalActor({
      cfg: params.cfg as CoreConfig,
      accountId: params.accountId,
      senderId: params.senderId,
      action: params.action,
      approvalKind: params.approvalKind,
    }),
  getActionAvailabilityState: (
    params: Parameters<NonNullable<ChannelApprovalCapability["getActionAvailabilityState"]>>[0],
  ) =>
    availabilityState(
      hasKeybaseApprovalApprovers({
        cfg: params.cfg as CoreConfig,
        accountId: params.accountId,
        approvalKind: params.approvalKind ?? "exec",
      }),
    ),
  getExecInitiatingSurfaceState: (
    params: Parameters<NonNullable<ChannelApprovalCapability["getExecInitiatingSurfaceState"]>>[0],
  ) =>
    keybaseNativeApprovalCapability.getExecInitiatingSurfaceState?.(params) ??
    ({ kind: "disabled" } as const),
  describeExecApprovalSetup: keybaseNativeApprovalCapability.describeExecApprovalSetup,
  delivery: keybaseDeliveryAdapter,
  nativeRuntime: keybaseNativeApprovalCapability.nativeRuntime,
  native: keybaseNativeAdapter,
  render: keybaseNativeApprovalCapability.render,
});

export function resolveKeybaseApprovalReactionTargetKeys(params: {
  conversationId?: string | null;
  senderUsername?: string | null;
  channel?: { membersType?: string; name?: string; topicName?: string } | null;
}): string[] {
  const keys = new Set<string>();
  const conversationId = params.conversationId?.trim();
  if (conversationId) {
    keys.add(`conv:${conversationId}`);
  }
  const channel = params.channel;
  let matchedGroup = false;
  if (channel?.name) {
    const isTeam = Boolean(channel.topicName) || channel.membersType?.toLowerCase() === "team";
    const parsed = parseKeybaseTarget(
      isTeam ? `team:${channel.name}#${channel.topicName || "general"}` : channel.name,
    );
    if (parsed?.chatType === "group") {
      const groupKey = normalizeKeybaseGroupKey(parsed.normalized);
      if (groupKey) {
        keys.add(groupKey);
        matchedGroup = true;
      }
    }
  }
  if (!matchedGroup) {
    const senderDm = params.senderUsername ? buildKeybaseDmTarget(params.senderUsername) : null;
    if (senderDm) {
      keys.add(senderDm);
    }
  }
  return [...keys];
}
