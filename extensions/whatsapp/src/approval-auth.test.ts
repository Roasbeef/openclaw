import { describe, expect, it } from "vitest";
import { whatsappApprovalAuth } from "./approval-auth.js";

describe("whatsappApprovalAuth", () => {
  it("authorizes direct WhatsApp recipients and rejects group-only allowlists (H-2)", () => {
    expect(
      whatsappApprovalAuth.authorizeActorAction({
        cfg: { channels: { whatsapp: { allowFrom: ["+1 (555) 123-0000"] } } },
        senderId: "15551230000@s.whatsapp.net",
        action: "approve",
        approvalKind: "exec",
      }),
    ).toEqual({ authorized: true });

    const filtered = whatsappApprovalAuth.authorizeActorAction({
      cfg: { channels: { whatsapp: { allowFrom: ["12345-67890@g.us"] } } },
      senderId: "+15551239999",
      action: "approve",
      approvalKind: "exec",
    });
    expect(filtered.authorized).toBe(false);
    expect(filtered.reason).toMatch(/No approvers configured/);
  });
});
