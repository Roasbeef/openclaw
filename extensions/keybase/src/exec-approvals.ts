import { resolveApprovalApprovers } from "openclaw/plugin-sdk/approval-auth-runtime";
import {
  createChannelExecApprovalProfile,
  getExecApprovalReplyMetadata,
  isChannelExecApprovalClientEnabledFromConfig,
  isChannelExecApprovalTargetRecipient,
  matchesApprovalRequestFilters,
} from "openclaw/plugin-sdk/approval-client-runtime";
import { resolveApprovalRequestChannelAccountId } from "openclaw/plugin-sdk/approval-native-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { ExecApprovalRequest, PluginApprovalRequest } from "openclaw/plugin-sdk/infra-runtime";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-runtime";
import { normalizeAccountId } from "openclaw/plugin-sdk/routing";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/string-coerce-runtime";
import { listKeybaseAccountIds, resolveKeybaseAccount } from "./accounts.js";
import { normalizeKeybaseApproverId } from "./approval-ids.js";
import { parseKeybaseTarget } from "./targets.js";
import type { CoreConfig } from "./types.js";

type ApprovalRequest = ExecApprovalRequest | PluginApprovalRequest;
type ApprovalKind = "exec" | "plugin";

function resolveKeybaseExecApprovalConfig(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}) {
  const account = resolveKeybaseAccount({
    cfg: params.cfg as CoreConfig,
    accountId: params.accountId,
  });
  const config = account.config.execApprovals;
  if (!config) {
    return undefined;
  }
  return {
    ...config,
    enabled: account.enabled && account.configured ? config.enabled : false,
  };
}

function countKeybaseApprovalEligibleAccounts(params: {
  cfg: OpenClawConfig;
  request: ApprovalRequest;
  approvalKind: ApprovalKind;
}): number {
  return listKeybaseAccountIds(params.cfg as CoreConfig).filter((accountId) => {
    const account = resolveKeybaseAccount({ cfg: params.cfg as CoreConfig, accountId });
    if (!account.enabled || !account.configured) {
      return false;
    }
    const config = resolveKeybaseExecApprovalConfig({
      cfg: params.cfg,
      accountId,
    });
    const filters = config?.enabled
      ? {
          agentFilter: config.agentFilter,
          sessionFilter: config.sessionFilter,
        }
      : {
          agentFilter: undefined,
          sessionFilter: undefined,
        };
    return (
      isChannelExecApprovalClientEnabledFromConfig({
        enabled: config?.enabled,
        approverCount: getKeybaseApprovalApprovers({
          cfg: params.cfg,
          accountId,
          approvalKind: params.approvalKind,
        }).length,
      }) &&
      matchesApprovalRequestFilters({
        request: params.request.request,
        agentFilter: filters.agentFilter,
        sessionFilter: filters.sessionFilter,
      })
    );
  }).length;
}

function matchesKeybaseRequestAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  request: ApprovalRequest;
  approvalKind: ApprovalKind;
}): boolean {
  const turnSourceChannel = normalizeLowercaseStringOrEmpty(
    params.request.request.turnSourceChannel,
  );
  const boundAccountId = resolveApprovalRequestChannelAccountId({
    cfg: params.cfg,
    request: params.request,
    channel: "keybase",
  });
  if (turnSourceChannel && turnSourceChannel !== "keybase" && !boundAccountId) {
    return (
      countKeybaseApprovalEligibleAccounts({
        cfg: params.cfg,
        request: params.request,
        approvalKind: params.approvalKind,
      }) <= 1
    );
  }
  return (
    !boundAccountId ||
    !params.accountId ||
    normalizeAccountId(boundAccountId) === normalizeAccountId(params.accountId)
  );
}

export function getKeybaseExecApprovalApprovers(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): string[] {
  const account = resolveKeybaseAccount({ ...params, cfg: params.cfg as CoreConfig }).config;
  return resolveApprovalApprovers({
    explicit: account.execApprovals?.approvers,
    allowFrom: account.allowFrom,
    normalizeApprover: normalizeKeybaseApproverId,
  });
}

export function getKeybasePluginApprovalApprovers(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): string[] {
  const account = resolveKeybaseAccount({ ...params, cfg: params.cfg as CoreConfig }).config;
  return resolveApprovalApprovers({
    allowFrom: account.allowFrom,
    normalizeApprover: normalizeKeybaseApproverId,
  });
}

function resolveKeybaseApprovalKind(request: ApprovalRequest): ApprovalKind {
  return request.id.startsWith("plugin:") ? "plugin" : "exec";
}

export function getKeybaseApprovalApprovers(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  approvalKind: ApprovalKind;
}): string[] {
  return params.approvalKind === "plugin"
    ? getKeybasePluginApprovalApprovers(params)
    : getKeybaseExecApprovalApprovers(params);
}

export function isKeybaseExecApprovalTargetRecipient(params: {
  cfg: OpenClawConfig;
  senderId?: string | null;
  accountId?: string | null;
}): boolean {
  return isChannelExecApprovalTargetRecipient({
    ...params,
    channel: "keybase",
    normalizeSenderId: normalizeKeybaseApproverId,
    matchTarget: ({ target, normalizedSenderId }) => {
      const parsed = parseKeybaseTarget(target.to);
      return (
        parsed?.chatType === "direct" &&
        parsed.usernames?.length === 1 &&
        parsed.usernames[0] === normalizedSenderId
      );
    },
  });
}

const keybaseExecApprovalProfile = createChannelExecApprovalProfile({
  resolveConfig: resolveKeybaseExecApprovalConfig,
  resolveApprovers: getKeybaseExecApprovalApprovers,
  normalizeSenderId: normalizeKeybaseApproverId,
  isTargetRecipient: isKeybaseExecApprovalTargetRecipient,
  matchesRequestAccount: (params) =>
    matchesKeybaseRequestAccount({
      ...params,
      approvalKind: "exec",
    }),
});

export const isKeybaseExecApprovalClientEnabled = keybaseExecApprovalProfile.isClientEnabled;
export const isKeybaseExecApprovalApprover = keybaseExecApprovalProfile.isApprover;
export const isKeybaseExecApprovalAuthorizedSender = keybaseExecApprovalProfile.isAuthorizedSender;
export const resolveKeybaseExecApprovalTarget = keybaseExecApprovalProfile.resolveTarget;

export function isKeybaseApprovalClientEnabled(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  approvalKind: ApprovalKind;
}): boolean {
  if (params.approvalKind === "exec") {
    return isKeybaseExecApprovalClientEnabled(params);
  }
  const config = resolveKeybaseExecApprovalConfig(params);
  return isChannelExecApprovalClientEnabledFromConfig({
    enabled: config?.enabled,
    approverCount: getKeybaseApprovalApprovers(params).length,
  });
}

export function isKeybaseAnyApprovalClientEnabled(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): boolean {
  return (
    isKeybaseApprovalClientEnabled({
      ...params,
      approvalKind: "exec",
    }) ||
    isKeybaseApprovalClientEnabled({
      ...params,
      approvalKind: "plugin",
    })
  );
}

export function shouldHandleKeybaseApprovalRequest(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  request: ApprovalRequest;
}): boolean {
  const approvalKind = resolveKeybaseApprovalKind(params.request);
  if (
    !matchesKeybaseRequestAccount({
      ...params,
      approvalKind,
    })
  ) {
    return false;
  }
  const config = resolveKeybaseExecApprovalConfig(params);
  if (
    !isChannelExecApprovalClientEnabledFromConfig({
      enabled: config?.enabled,
      approverCount: getKeybaseApprovalApprovers({
        ...params,
        approvalKind,
      }).length,
    })
  ) {
    return false;
  }
  return matchesApprovalRequestFilters({
    request: params.request.request,
    agentFilter: config?.agentFilter,
    sessionFilter: config?.sessionFilter,
  });
}

function buildFilterCheckRequest(params: {
  metadata: NonNullable<ReturnType<typeof getExecApprovalReplyMetadata>>;
}): ApprovalRequest {
  if (params.metadata.approvalKind === "plugin") {
    return {
      id: params.metadata.approvalId,
      request: {
        title: "Plugin Approval Required",
        description: "",
        agentId: params.metadata.agentId ?? null,
        sessionKey: params.metadata.sessionKey ?? null,
      },
      createdAtMs: 0,
      expiresAtMs: 0,
    };
  }
  return {
    id: params.metadata.approvalId,
    request: {
      command: "",
      agentId: params.metadata.agentId ?? null,
      sessionKey: params.metadata.sessionKey ?? null,
    },
    createdAtMs: 0,
    expiresAtMs: 0,
  };
}

export function shouldSuppressLocalKeybaseExecApprovalPrompt(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  payload: ReplyPayload;
}): boolean {
  if (!keybaseExecApprovalProfile.shouldSuppressLocalPrompt(params)) {
    return false;
  }
  const metadata = getExecApprovalReplyMetadata(params.payload);
  if (!metadata) {
    return false;
  }
  return shouldHandleKeybaseApprovalRequest({
    cfg: params.cfg,
    accountId: params.accountId,
    request: buildFilterCheckRequest({
      metadata,
    }),
  });
}
