import { describe, expect, it } from "vitest";
import {
  resolveKeybaseGroupAccess,
  resolveKeybaseGroupAllowFrom,
  resolveKeybaseGroupMatch,
  resolveKeybaseGroupRequireMention,
  resolveKeybaseGroupSkillFilter,
  resolveKeybaseGroupSystemPrompt,
} from "./groups.js";

describe("Keybase group policy helpers", () => {
  it("matches configured groups case-insensitively", () => {
    const match = resolveKeybaseGroupMatch({
      groups: {
        "team:lightninglabs#ops": {
          allowFrom: [],
          requireMention: false,
        },
      },
      groupId: "team:LightningLabs#Ops",
    });

    expect(match.allowed).toBe(true);
    expect(match.groupConfig?.requireMention).toBe(false);
  });

  it("blocks unconfigured groups in allowlist mode", () => {
    const match = resolveKeybaseGroupMatch({
      groups: {},
      groupId: "team:lightninglabs#ops",
    });

    expect(
      resolveKeybaseGroupAccess({
        groupPolicy: "allowlist",
        groupMatch: match,
      }),
    ).toEqual({
      allowed: false,
      groupPolicy: "allowlist",
      reason: "empty_allowlist",
    });
  });

  it("default-denies impteam groups when no allowlist matches", () => {
    const match = resolveKeybaseGroupMatch({
      groups: { "*": { allowFrom: [] } },
      groupId: "conv:abc123",
      aliasGroupIds: ["impteam:alice,bob,carol"],
      isImplicitTeam: true,
    });

    expect(match.isImplicitTeam).toBe(true);
    expect(
      resolveKeybaseGroupAccess({
        groupPolicy: "open",
        groupMatch: match,
      }),
    ).toEqual({
      allowed: false,
      groupPolicy: "open",
      reason: "route_not_allowlisted",
    });
  });

  it("admits impteam groups when multiPartyDmPolicy=allow under groupPolicy=open", () => {
    const match = resolveKeybaseGroupMatch({
      groups: {},
      groupId: "conv:abc123",
      aliasGroupIds: ["impteam:alice,bob,carol"],
      isImplicitTeam: true,
    });

    expect(
      resolveKeybaseGroupAccess({
        groupPolicy: "open",
        groupMatch: match,
        multiPartyDmPolicy: "allow",
      }).allowed,
    ).toBe(true);
  });

  it("matches impteam configs against alias keys when primary id is conv:<id>", () => {
    const match = resolveKeybaseGroupMatch({
      groups: {
        "impteam:*": { allowFrom: ["alice"] },
      },
      groupId: "conv:abc123",
      aliasGroupIds: ["impteam:alice,bob,carol"],
      isImplicitTeam: true,
    });

    expect(match.allowed).toBe(true);
    expect(match.wildcardConfig?.allowFrom).toEqual(["alice"]);
    expect(resolveKeybaseGroupAllowFrom(match)).toEqual(["alice"]);
  });

  it("forces requireMention=true for impteam groups regardless of config", () => {
    expect(
      resolveKeybaseGroupRequireMention({
        groupConfig: { allowFrom: [], requireMention: false },
        isImplicitTeam: true,
      }),
    ).toBe(true);
  });

  it("falls back to account allowFrom for impteam groups when no group/wildcard allowFrom is set", () => {
    expect(
      resolveKeybaseGroupAllowFrom({
        isImplicitTeam: true,
        fallbackAllowFrom: ["alice", "bob"],
      }),
    ).toEqual(["alice", "bob"]);
  });

  it("prefers direct group overrides over wildcard defaults", () => {
    const match = resolveKeybaseGroupMatch({
      groups: {
        "*": {
          allowFrom: ["fallback"],
          requireMention: true,
          skills: ["fallback-skill"],
          systemPrompt: "fallback",
        },
        "team:lightninglabs#ops": {
          allowFrom: ["alice"],
          requireMention: false,
          skills: ["ops-skill"],
          systemPrompt: "ops only",
        },
      },
      groupId: "team:lightninglabs#ops",
    });

    expect(resolveKeybaseGroupRequireMention(match)).toBe(false);
    expect(resolveKeybaseGroupAllowFrom(match)).toEqual(["alice"]);
    expect(resolveKeybaseGroupSkillFilter(match)).toEqual(["ops-skill"]);
    expect(resolveKeybaseGroupSystemPrompt(match)).toBe("ops only");
  });
});
