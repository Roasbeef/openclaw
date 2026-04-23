import { describe, expect, it } from "vitest";
import {
  inferKeybaseTargetChatType,
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
});
