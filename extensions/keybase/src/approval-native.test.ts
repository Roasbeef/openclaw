import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { describe, expect, it } from "vitest";
import {
  keybaseApprovalCapability,
  resolveKeybaseApprovalReactionTargetKeys,
} from "./approval-native.js";

function buildConfig(): OpenClawConfig {
  return {
    channels: {
      keybase: {
        username: "lbottestbot",
        paperKey: "paper key",
        execApprovals: {
          enabled: true,
          approvers: ["roasbeef"],
          target: "both",
        },
      },
    },
  } as OpenClawConfig;
}

describe("keybase native approvals", () => {
  it("exposes native delivery only when approvers and client config are enabled", () => {
    const capabilities = keybaseApprovalCapability.native?.describeDeliveryCapabilities({
      cfg: buildConfig(),
      accountId: "default",
      approvalKind: "exec",
      request: {
        id: "approval-1",
        request: {
          command: "echo hi",
          turnSourceChannel: "keybase",
          turnSourceTo: "team:lbottest#general",
        },
        createdAtMs: 0,
        expiresAtMs: 1,
      },
    });

    expect(capabilities).toMatchObject({
      enabled: true,
      preferredSurface: "both",
      supportsApproverDmSurface: true,
      supportsOriginSurface: true,
    });
  });

  it("uses implicit same-chat text authorization when approvers are not configured", () => {
    const result = keybaseApprovalCapability.authorizeActorAction?.({
      cfg: {
        channels: {
          keybase: {
            username: "lbottestbot",
            paperKey: "paper key",
          },
        },
      } as OpenClawConfig,
      accountId: "default",
      senderId: "roasbeef",
      action: "approve",
      approvalKind: "exec",
    });

    expect(result).toMatchObject({ authorized: true });
    expect(
      keybaseApprovalCapability.getActionAvailabilityState?.({
        cfg: buildConfig(),
        accountId: "default",
        action: "approve",
        approvalKind: "exec",
      }),
    ).toEqual({ kind: "enabled" });
  });

  it("derives group reaction target keys from Keybase conversation metadata", () => {
    expect(
      resolveKeybaseApprovalReactionTargetKeys({
        conversationId: "conv-1",
        senderUsername: "Roasbeef",
        channel: {
          name: "LightningLabs",
          membersType: "team",
          topicName: "General",
        },
      }),
    ).toEqual(["conv:conv-1", "team:lightninglabs#general"]);
  });

  it("derives direct-message reaction target keys from the reacting sender", () => {
    expect(
      resolveKeybaseApprovalReactionTargetKeys({
        conversationId: "conv-1",
        senderUsername: "Roasbeef",
        channel: {
          name: "lbottestbot",
        },
      }),
    ).toEqual(["conv:conv-1", "dm:roasbeef"]);
  });
});
