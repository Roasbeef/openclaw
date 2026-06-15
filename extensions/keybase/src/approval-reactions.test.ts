import { afterEach, describe, expect, it } from "vitest";
import {
  buildKeybaseApprovalReactionHint,
  clearKeybaseApprovalReactionTargetsForTest,
  KEYBASE_APPROVAL_REACTION_MAX_ENTRIES_FOR_TEST,
  KEYBASE_APPROVAL_REACTION_TTL_MS_FOR_TEST,
  listKeybaseApprovalReactionBindings,
  registerKeybaseApprovalReactionTarget,
  resolveKeybaseApprovalReactionTarget,
  setKeybaseApprovalReactionNowMsForTest,
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

  it("does not let an impteam alias hijack a conv-bound approval", () => {
    registerKeybaseApprovalReactionTarget({
      accountId: "ops",
      targetKey: "conv:original-conv",
      messageId: "42",
      approvalId: "req-original",
      allowedDecisions: ["allow-once", "deny"],
    });

    expect(
      resolveKeybaseApprovalReactionTarget({
        accountId: "ops",
        targetKeys: ["conv:other-conv", "impteam:alice,bob,carol"],
        messageId: "42",
        reactionBody: ":white_check_mark:",
      }),
    ).toBeNull();
  });

  it("ignores impteam alias candidates when a conv: candidate is also present", () => {
    registerKeybaseApprovalReactionTarget({
      accountId: "ops",
      targetKey: "impteam:alice,bob,carol",
      messageId: "42",
      approvalId: "req-legacy",
      allowedDecisions: ["allow-once", "deny"],
    });

    expect(
      resolveKeybaseApprovalReactionTarget({
        accountId: "ops",
        targetKeys: ["conv:new-conv", "impteam:alice,bob,carol"],
        messageId: "42",
        reactionBody: ":white_check_mark:",
      }),
    ).toBeNull();
  });

  it("falls back to impteam alias only when no conv: candidate is supplied", () => {
    registerKeybaseApprovalReactionTarget({
      accountId: "ops",
      targetKey: "impteam:alice,bob,carol",
      messageId: "42",
      approvalId: "req-legacy",
      allowedDecisions: ["allow-once", "deny"],
    });

    expect(
      resolveKeybaseApprovalReactionTarget({
        accountId: "ops",
        targetKeys: ["impteam:alice,bob,carol"],
        messageId: "42",
        reactionBody: ":white_check_mark:",
      }),
    ).toMatchObject({ approvalId: "req-legacy", decision: "allow-once" });
  });

  it("expires registered reaction targets after the TTL elapses", () => {
    let nowMs = 1_000_000;
    setKeybaseApprovalReactionNowMsForTest(() => nowMs);
    registerKeybaseApprovalReactionTarget({
      accountId: "ops",
      targetKey: "conv:abc",
      messageId: "9",
      approvalId: "req-ttl",
      allowedDecisions: ["allow-once", "deny"],
    });
    expect(
      resolveKeybaseApprovalReactionTarget({
        accountId: "ops",
        targetKeys: ["conv:abc"],
        messageId: "9",
        reactionBody: ":white_check_mark:",
      }),
    ).toMatchObject({ approvalId: "req-ttl", decision: "allow-once" });

    nowMs += KEYBASE_APPROVAL_REACTION_TTL_MS_FOR_TEST + 1;
    expect(
      resolveKeybaseApprovalReactionTarget({
        accountId: "ops",
        targetKeys: ["conv:abc"],
        messageId: "9",
        reactionBody: ":white_check_mark:",
      }),
    ).toBeNull();
  });

  it("evicts least-recently-used reaction targets once the cap is reached", () => {
    setKeybaseApprovalReactionNowMsForTest(() => 1_000);
    const total = KEYBASE_APPROVAL_REACTION_MAX_ENTRIES_FOR_TEST + 5;
    for (let i = 0; i < total; i += 1) {
      registerKeybaseApprovalReactionTarget({
        accountId: "ops",
        targetKey: `conv:room-${i}`,
        messageId: String(i),
        approvalId: `req-${i}`,
        allowedDecisions: ["allow-once", "deny"],
      });
    }

    // The oldest 5 entries should have been evicted to keep within the cap.
    for (let i = 0; i < 5; i += 1) {
      expect(
        resolveKeybaseApprovalReactionTarget({
          accountId: "ops",
          targetKeys: [`conv:room-${i}`],
          messageId: String(i),
          reactionBody: ":white_check_mark:",
        }),
      ).toBeNull();
    }

    // The most-recent entry must still resolve.
    expect(
      resolveKeybaseApprovalReactionTarget({
        accountId: "ops",
        targetKeys: [`conv:room-${total - 1}`],
        messageId: String(total - 1),
        reactionBody: ":white_check_mark:",
      }),
    ).toMatchObject({ approvalId: `req-${total - 1}`, decision: "allow-once" });
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
