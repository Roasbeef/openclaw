import { afterEach, describe, expect, it } from "vitest";
import {
  buildKeybaseApprovalReactionHint,
  clearKeybaseApprovalReactionTargetsForTest,
  listKeybaseApprovalReactionBindings,
  registerKeybaseApprovalReactionTarget,
  resolveKeybaseApprovalReactionTarget,
  unregisterKeybaseApprovalReactionTarget,
} from "./approval-reactions.js";

afterEach(() => {
  clearKeybaseApprovalReactionTargetsForTest();
});

describe("keybase approval reactions", () => {
  it("lists reactions in stable decision order", () => {
    expect(listKeybaseApprovalReactionBindings(["allow-once", "deny", "allow-always"])).toEqual([
      {
        decision: "allow-once",
        emoji: "✅",
        label: "Allow once",
        reaction: ":white_check_mark:",
      },
      {
        decision: "allow-always",
        emoji: "♾️",
        label: "Allow always",
        reaction: ":infinity:",
      },
      { decision: "deny", emoji: "❌", label: "Deny", reaction: ":x:" },
    ]);
  });

  it("builds a compact reaction hint", () => {
    expect(buildKeybaseApprovalReactionHint(["allow-once", "deny"])).toBe(
      "React here: ✅ Allow once, ❌ Deny",
    );
  });

  it("resolves a registered approval message back to an approval decision", () => {
    registerKeybaseApprovalReactionTarget({
      accountId: "ops",
      targetKey: "team:LightningLabs#General",
      messageId: 42,
      approvalId: "req-123",
      allowedDecisions: ["allow-once", "allow-always", "deny"],
    });

    expect(
      resolveKeybaseApprovalReactionTarget({
        accountId: "ops",
        targetKeys: ["conv:ignored", "team:lightninglabs#general"],
        messageId: 42,
        reactionBody: ":white_check_mark:",
      }),
    ).toEqual({
      approvalId: "req-123",
      decision: "allow-once",
      targetKey: "team:lightninglabs#general",
    });
    expect(
      resolveKeybaseApprovalReactionTarget({
        accountId: "ops",
        targetKeys: ["team:lightninglabs#general"],
        messageId: "42",
        reactionBody: "♾️",
      }),
    ).toMatchObject({
      decision: "allow-always",
    });
    expect(
      resolveKeybaseApprovalReactionTarget({
        accountId: "ops",
        targetKeys: ["team:lightninglabs#general"],
        messageId: "42",
        reactionBody: ":x:",
      }),
    ).toMatchObject({
      decision: "deny",
    });
  });

  it("ignores reactions that are not allowed on the registered approval message", () => {
    registerKeybaseApprovalReactionTarget({
      targetKey: "conv:abc",
      messageId: "7",
      approvalId: "req-123",
      allowedDecisions: ["allow-once", "deny"],
    });

    expect(
      resolveKeybaseApprovalReactionTarget({
        targetKeys: ["conv:abc"],
        messageId: "7",
        reactionBody: ":infinity:",
      }),
    ).toBeNull();
  });

  it("stops resolving reactions after the approval message is unregistered", () => {
    registerKeybaseApprovalReactionTarget({
      targetKey: "conv:abc",
      messageId: "7",
      approvalId: "req-123",
      allowedDecisions: ["allow-once", "deny"],
    });
    unregisterKeybaseApprovalReactionTarget({
      targetKey: "conv:abc",
      messageId: "7",
    });

    expect(
      resolveKeybaseApprovalReactionTarget({
        targetKeys: ["conv:abc"],
        messageId: "7",
        reactionBody: "✅",
      }),
    ).toBeNull();
  });
});
