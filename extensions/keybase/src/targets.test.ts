import { describe, expect, it } from "vitest";
import {
  buildKeybaseDmTarget,
  inferKeybaseInboundChatType,
  inferKeybaseTargetChatType,
  normalizeKeybaseAllowEntry,
  normalizeKeybaseUsername,
  normalizeKeybaseTarget,
  parseKeybaseTarget,
  resolveKeybaseConversationRef,
} from "./targets.js";

describe("Keybase target parsing", () => {
  it("normalizes direct-message targets deterministically", () => {
    expect(normalizeKeybaseTarget("dm:Bob,alice,bob")).toBe("dm:alice,bob");
    expect(normalizeKeybaseTarget("alice")).toBe("dm:alice");
  });

  it("parses team-channel targets", () => {
    expect(parseKeybaseTarget("team:lightninglabs#ops")).toEqual({
      raw: "team:lightninglabs#ops",
      teamName: "lightninglabs",
      topicName: "ops",
      chatType: "group",
      normalized: "team:lightninglabs#ops",
    });
    expect(inferKeybaseTargetChatType("lightninglabs#ops")).toBe("group");
  });

  it("normalizes allowlist entries and DM targets", () => {
    expect(normalizeKeybaseUsername("Keybase:Alice")).toBe("alice");
    expect(normalizeKeybaseAllowEntry("dm:Alice")).toBe("alice");
    expect(normalizeKeybaseAllowEntry("*")).toBe("*");
    expect(buildKeybaseDmTarget("Alice")).toBe("dm:alice");
  });

  it("resolves conversation references from normalized targets", () => {
    expect(resolveKeybaseConversationRef("conv:abcd1234")).toEqual({
      conversationId: "abcd1234",
    });
    expect(resolveKeybaseConversationRef("team:lightninglabs#ops")).toEqual({
      channel: {
        name: "lightninglabs",
        membersType: "team",
        topicName: "ops",
      },
    });
    expect(resolveKeybaseConversationRef("dm:alice,bob")).toEqual({
      channel: {
        name: "alice,bob",
      },
    });
  });

  it("classifies inbound team traffic as group chat", () => {
    expect(inferKeybaseInboundChatType({ channel: {} })).toBe("direct");
    expect(
      inferKeybaseInboundChatType({
        channel: { membersType: "team", topicName: "ops" },
      }),
    ).toBe("group");
  });
});
