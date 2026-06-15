import { describe, expect, it } from "vitest";
import { googleChatApprovalAuth } from "./approval-auth.js";

describe("googleChatApprovalAuth", () => {
  it("authorizes stable users/* ids and rejects email-style allowlists (H-2)", () => {
    expect(
      googleChatApprovalAuth.authorizeActorAction({
        cfg: { channels: { googlechat: { dm: { allowFrom: ["users/123"] } } } },
        senderId: "users/123",
        action: "approve",
        approvalKind: "exec",
      }),
    ).toEqual({ authorized: true });

    const filtered = googleChatApprovalAuth.authorizeActorAction({
      cfg: { channels: { googlechat: { dm: { allowFrom: ["owner@example.com"] } } } },
      senderId: "users/attacker",
      action: "approve",
      approvalKind: "exec",
    });
    expect(filtered.authorized).toBe(false);
    expect(filtered.reason).toMatch(/No approvers configured/);
  });
});
