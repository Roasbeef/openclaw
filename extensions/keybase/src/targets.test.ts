import { describe, expect, it } from "vitest";
import {
  buildKeybaseDmTarget,
  buildKeybaseGroupTarget,
  buildKeybaseInboundGroupId,
  inferKeybaseInboundChatType,
  inferKeybaseTargetChatType,
  normalizeKeybaseAllowEntry,
  normalizeKeybaseGroupKey,
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
    expect(parseKeybaseTarget("team:lbottest")).toEqual({
      raw: "team:lbottest",
      teamName: "lbottest",
      topicName: "general",
      chatType: "group",
      normalized: "team:lbottest#general",
    });
    expect(inferKeybaseTargetChatType("lightninglabs#ops")).toBe("group");
  });

  // M-8: an opaque conv:<id> target may refer to a 1:1 DM or to a team
  // channel; the ID alone doesn't distinguish them. Hard-coding chatType
  // to "direct" misroutes team conversations as DMs and weakens
  // DM-policy / approver checks downstream. Leave chatType unset so
  // callers fall back to the inbound envelope or an API lookup.
  it("does not assert chatType for opaque conv: targets", () => {
    const parsed = parseKeybaseTarget("conv:abcd1234");
    expect(parsed).toEqual({
      raw: "conv:abcd1234",
      conversationId: "abcd1234",
      normalized: "conv:abcd1234",
    });
    expect(parsed?.chatType).toBeUndefined();
    expect(inferKeybaseTargetChatType("conv:abcd1234")).toBeUndefined();
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
    expect(resolveKeybaseConversationRef("team:lbottest#general")).toEqual({
      channel: {
        name: "lbottest",
        membersType: "team",
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

  it("treats multi-party implicit teams as group chat", () => {
    expect(
      inferKeybaseInboundChatType({
        channel: {
          membersType: "impteamnative",
          name: "openclaw,sender",
        },
      }),
    ).toBe("direct");
    expect(
      inferKeybaseInboundChatType({
        channel: {
          membersType: "impteamnative",
          name: "third,openclaw,sender",
        },
      }),
    ).toBe("group");
    expect(
      buildKeybaseInboundGroupId({
        channel: {
          membersType: "impteamnative",
          name: "third,openclaw,sender",
        },
      }),
    ).toBe("impteam:openclaw,sender,third");
    expect(normalizeKeybaseGroupKey("impteam:Third,openclaw,sender")).toBe(
      "impteam:openclaw,sender,third",
    );
  });

  it("prefers conv:<id> over impteam alias when conversationId is known", () => {
    expect(
      buildKeybaseInboundGroupId({
        channel: {
          membersType: "impteamnative",
          name: "third,openclaw,sender",
        },
        conversationId: "0001abcd",
      }),
    ).toBe("conv:0001abcd");
    expect(
      buildKeybaseInboundGroupId({
        channel: {
          membersType: "impteamnative",
          name: "third,openclaw,sender",
        },
      }),
    ).toBe("impteam:openclaw,sender,third");
    expect(normalizeKeybaseGroupKey("conv:Foo123")).toBe("conv:Foo123");
  });

  it("canonicalizes group routing keys separately from outbound targets", () => {
    expect(buildKeybaseGroupTarget("LightningLabs", "Ops")).toBe("team:LightningLabs#Ops");
    expect(normalizeKeybaseGroupKey("team:LightningLabs#Ops")).toBe("team:lightninglabs#ops");
    expect(normalizeKeybaseGroupKey("team:LightningLabs")).toBe("team:lightninglabs#general");
    expect(
      buildKeybaseInboundGroupId({
        channel: {
          name: "LightningLabs",
          topicName: "Ops",
        },
      }),
    ).toBe("team:LightningLabs#Ops");
    expect(
      buildKeybaseInboundGroupId({
        channel: {
          membersType: "team",
          name: "LightningLabs",
        },
      }),
    ).toBe("team:LightningLabs#general");
  });
});
