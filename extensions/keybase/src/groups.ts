import { evaluateGroupRouteAccessForPolicy } from "openclaw/plugin-sdk/group-access";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import { normalizeKeybaseGroupKey } from "./targets.js";
import type { ResolvedKeybaseGroupConfig } from "./types.js";

export type KeybaseGroupMatch = {
  allowed: boolean;
  groupConfig?: ResolvedKeybaseGroupConfig;
  wildcardConfig?: ResolvedKeybaseGroupConfig;
  hasConfiguredGroups: boolean;
};

export function resolveKeybaseGroupMatch(params: {
  groups?: Record<string, ResolvedKeybaseGroupConfig>;
  groupId: string;
}): KeybaseGroupMatch {
  const groups = params.groups ?? {};
  const hasConfiguredGroups = Object.keys(groups).length > 0;
  const direct = groups[params.groupId];
  if (direct) {
    return {
      allowed: true,
      groupConfig: direct,
      wildcardConfig: groups["*"],
      hasConfiguredGroups,
    };
  }

  const normalizedGroupId = normalizeKeybaseGroupKey(params.groupId);
  const directKey =
    normalizedGroupId &&
    Object.keys(groups).find(
      (key) => key !== "*" && normalizeKeybaseGroupKey(key) === normalizedGroupId,
    );
  if (directKey) {
    const matched = groups[directKey];
    if (matched) {
      return {
        allowed: true,
        groupConfig: matched,
        wildcardConfig: groups["*"],
        hasConfiguredGroups,
      };
    }
  }

  const wildcard = groups["*"];
  if (wildcard) {
    return {
      allowed: true,
      wildcardConfig: wildcard,
      hasConfiguredGroups,
    };
  }

  return {
    allowed: false,
    hasConfiguredGroups,
  };
}

export function resolveKeybaseGroupAccess(params: {
  groupPolicy: "open" | "allowlist" | "disabled";
  groupMatch: KeybaseGroupMatch;
}): ReturnType<typeof evaluateGroupRouteAccessForPolicy> {
  return evaluateGroupRouteAccessForPolicy({
    groupPolicy: params.groupPolicy,
    routeAllowlistConfigured: params.groupMatch.hasConfiguredGroups,
    routeMatched: params.groupMatch.allowed,
    routeEnabled:
      params.groupMatch.groupConfig?.enabled ?? params.groupMatch.wildcardConfig?.enabled,
  });
}

export function resolveKeybaseGroupRequireMention(params: {
  groupConfig?: ResolvedKeybaseGroupConfig;
  wildcardConfig?: ResolvedKeybaseGroupConfig;
}): boolean {
  if (params.groupConfig?.requireMention !== undefined) {
    return params.groupConfig.requireMention;
  }
  if (params.wildcardConfig?.requireMention !== undefined) {
    return params.wildcardConfig.requireMention;
  }
  return true;
}

export function resolveKeybaseGroupAllowFrom(params: {
  groupConfig?: ResolvedKeybaseGroupConfig;
  wildcardConfig?: ResolvedKeybaseGroupConfig;
}): string[] {
  if ((params.groupConfig?.allowFrom?.length ?? 0) > 0) {
    return params.groupConfig?.allowFrom ?? [];
  }
  return params.wildcardConfig?.allowFrom ?? [];
}

export function resolveKeybaseGroupSystemPrompt(params: {
  groupConfig?: ResolvedKeybaseGroupConfig;
  wildcardConfig?: ResolvedKeybaseGroupConfig;
}): string | undefined {
  const direct = normalizeOptionalString(params.groupConfig?.systemPrompt);
  if (direct) {
    return direct;
  }
  return normalizeOptionalString(params.wildcardConfig?.systemPrompt);
}

export function resolveKeybaseGroupSkillFilter(params: {
  groupConfig?: ResolvedKeybaseGroupConfig;
  wildcardConfig?: ResolvedKeybaseGroupConfig;
}): string[] | undefined {
  const direct = params.groupConfig?.skills?.filter(Boolean);
  if (direct && direct.length > 0) {
    return direct;
  }
  const wildcard = params.wildcardConfig?.skills?.filter(Boolean);
  return wildcard && wildcard.length > 0 ? wildcard : undefined;
}
