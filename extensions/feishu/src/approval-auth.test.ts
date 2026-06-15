import { describe, expect, it } from "vitest";
import { feishuApprovalAuth } from "./approval-auth.js";

describe("feishuApprovalAuth", () => {
  it("authorizes open_id approvers and rejects user_id-only allowlists (H-2)", () => {
    expect(
      feishuApprovalAuth.authorizeActorAction({
        cfg: { channels: { feishu: { allowFrom: ["ou_owner"] } } },
        senderId: "ou_owner",
        action: "approve",
        approvalKind: "exec",
      }),
    ).toEqual({ authorized: true });

    const filtered = feishuApprovalAuth.authorizeActorAction({
      cfg: { channels: { feishu: { allowFrom: ["user_123"] } } },
      senderId: "ou_attacker",
      action: "approve",
      approvalKind: "exec",
    });
    expect(filtered.authorized).toBe(false);
    expect(filtered.reason).toMatch(/No approvers configured/);
  });
});
