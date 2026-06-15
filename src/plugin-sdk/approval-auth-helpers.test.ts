import { describe, expect, it } from "vitest";
import { createResolvedApproverActionAuthAdapter } from "./approval-auth-helpers.js";

describe("createResolvedApproverActionAuthAdapter", () => {
  it.each([
    {
      name: "fails closed when no approvers resolve (H-2)",
      channelLabel: "Slack",
      resolveApprovers: () => [],
      normalizeSenderId: undefined,
      cases: [
        {
          senderId: "U_OWNER",
          approvalKind: "exec" as const,
          expected: {
            authorized: false,
            reason:
              "❌ No approvers configured for Slack. Set execApprovals.approvers (or the channel's plugin equivalent) to authorize.",
          },
        },
      ],
    },
    {
      name: "allows matching normalized approvers and rejects others",
      channelLabel: "Signal",
      resolveApprovers: () => ["uuid:owner"],
      normalizeSenderId: (value: string) => value.trim().toLowerCase(),
      cases: [
        {
          senderId: " UUID:OWNER ",
          approvalKind: "plugin" as const,
          expected: { authorized: true },
        },
        {
          senderId: "uuid:attacker",
          approvalKind: "plugin" as const,
          expected: {
            authorized: false,
            reason: "❌ You are not authorized to approve plugin requests on Signal.",
          },
        },
      ],
    },
  ])("$name", ({ channelLabel, resolveApprovers, normalizeSenderId, cases }) => {
    const auth = createResolvedApproverActionAuthAdapter({
      channelLabel,
      resolveApprovers,
      normalizeSenderId,
    });

    for (const testCase of cases) {
      expect(
        auth.authorizeActorAction({
          cfg: {},
          senderId: testCase.senderId,
          action: "approve",
          approvalKind: testCase.approvalKind,
        }),
      ).toEqual(testCase.expected);
    }
  });

  it("fails closed for any sender when approver list is empty (H-2)", () => {
    const auth = createResolvedApproverActionAuthAdapter({
      channelLabel: "Signal",
      resolveApprovers: () => [],
    });
    const result = auth.authorizeActorAction({
      cfg: {},
      senderId: "uuid:attacker",
      action: "approve",
      approvalKind: "exec",
    });

    expect(result.authorized).toBe(false);
    expect(result.reason).toMatch(/No approvers configured/);
  });

  it("authorizes a configured approver", () => {
    const auth = createResolvedApproverActionAuthAdapter({
      channelLabel: "Signal",
      resolveApprovers: () => ["uuid:owner"],
    });
    const result = auth.authorizeActorAction({
      cfg: {},
      senderId: "uuid:owner",
      action: "approve",
      approvalKind: "exec",
    });

    expect(result).toEqual({ authorized: true });
  });
});
