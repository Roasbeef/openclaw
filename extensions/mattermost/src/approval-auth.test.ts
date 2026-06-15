import { describe, expect, it } from "vitest";
import { mattermostApprovalAuth } from "./approval-auth.js";

describe("mattermostApprovalAuth", () => {
  it("authorizes stable Mattermost user ids and rejects username-only allowlists (H-2)", () => {
    expect(
      mattermostApprovalAuth.authorizeActorAction({
        cfg: {
          channels: { mattermost: { allowFrom: ["user:abcdefghijklmnopqrstuvwxyz"] } },
        },
        senderId: "abcdefghijklmnopqrstuvwxyz",
        action: "approve",
        approvalKind: "exec",
      }),
    ).toEqual({ authorized: true });

    const filtered = mattermostApprovalAuth.authorizeActorAction({
      cfg: {
        channels: { mattermost: { allowFrom: ["@owner"] } },
      },
      senderId: "attacker-user-id",
      action: "approve",
      approvalKind: "exec",
    });
    expect(filtered.authorized).toBe(false);
    expect(filtered.reason).toMatch(/No approvers configured/);
  });
});
