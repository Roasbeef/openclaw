import { createResolvedApproverActionAuthAdapter } from "openclaw/plugin-sdk/approval-auth-runtime";
import { normalizeKeybaseApproverId } from "./approval-ids.js";
import {
  getKeybaseExecApprovalApprovers,
  getKeybasePluginApprovalApprovers,
} from "./exec-approvals.js";
import type { CoreConfig } from "./types.js";

type KeybaseApprovalKind = "exec" | "plugin";

const keybaseExecApprovalAuth = createResolvedApproverActionAuthAdapter({
  channelLabel: "Keybase",
  resolveApprovers: ({ cfg, accountId }) =>
    getKeybaseExecApprovalApprovers({ cfg: cfg as CoreConfig, accountId }),
  normalizeSenderId: normalizeKeybaseApproverId,
});

const keybasePluginApprovalAuth = createResolvedApproverActionAuthAdapter({
  channelLabel: "Keybase",
  resolveApprovers: ({ cfg, accountId }) =>
    getKeybasePluginApprovalApprovers({ cfg: cfg as CoreConfig, accountId }),
  normalizeSenderId: normalizeKeybaseApproverId,
});

export function authorizeKeybaseApprovalActor(params: {
  cfg: CoreConfig;
  accountId?: string | null;
  senderId?: string | null;
  action: "approve";
  approvalKind: KeybaseApprovalKind;
}) {
  return params.approvalKind === "plugin"
    ? keybasePluginApprovalAuth.authorizeActorAction(params)
    : keybaseExecApprovalAuth.authorizeActorAction(params);
}

export function isKeybaseApprovalReactionAuthorizedSender(params: {
  cfg: CoreConfig;
  accountId?: string | null;
  senderId?: string | null;
  approvalKind: KeybaseApprovalKind;
}): boolean {
  const normalizedSenderId = params.senderId
    ? normalizeKeybaseApproverId(params.senderId)
    : undefined;
  if (!normalizedSenderId) {
    return false;
  }
  const approvers =
    params.approvalKind === "plugin"
      ? getKeybasePluginApprovalApprovers(params)
      : getKeybaseExecApprovalApprovers(params);
  return approvers.includes(normalizedSenderId);
}
