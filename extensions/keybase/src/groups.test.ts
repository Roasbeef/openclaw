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
