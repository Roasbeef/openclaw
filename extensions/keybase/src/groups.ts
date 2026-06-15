import { evaluateGroupRouteAccessForPolicy } from "openclaw/plugin-sdk/group-access";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import { isKeybaseImplicitTeamGroupKey, normalizeKeybaseGroupKey } from "./targets.js";
import type { ResolvedKeybaseGroupConfig } from "./types.js";

export type KeybaseGroupMatch = {
  allowed: boolean;
  groupConfig?: ResolvedKeybaseGroupConfig;
  wildcardConfig?: ResolvedKeybaseGroupConfig;
  hasConfiguredGroups: boolean;
  isImplicitTeam: boolean;
};

const KEYBASE_IMPLICIT_TEAM_WILDCARD = "impteam:*";

export function resolveKeybaseGroupMatch(params: {
  groups?: Record<string, ResolvedKeybaseGroupConfig>;
  groupId: string;
  aliasGroupIds?: readonly string[];
  isImplicitTeam?: boolean;
}): KeybaseGroupMatch {
  const groups = params.groups ?? {};
  const hasConfiguredGroups = Object.keys(groups).length > 0;
  const candidateIds = [
    params.groupId,
    ...(params.aliasGroupIds ?? []).filter((id) => id && id !== params.groupId),
  ];
  const normalizedCandidates = candidateIds
    .map((id) => normalizeKeybaseGroupKey(id))
    .filter((id): id is string => Boolean(id));
  const isImplicitTeam =
    params.isImplicitTeam ??
    (normalizedCandidates.some((id) => isKeybaseImplicitTeamGroupKey(id)) ||
      candidateIds.some((id) => isKeybaseImplicitTeamGroupKey(id)));
  const wildcardConfig = isImplicitTeam ? groups[KEYBASE_IMPLICIT_TEAM_WILDCARD] : groups["*"];

  for (const candidate of candidateIds) {
    const direct = groups[candidate];
    if (direct) {
      return {
        allowed: true,
        groupConfig: direct,
        wildcardConfig,
        hasConfiguredGroups,
        isImplicitTeam,
      };
    }
  }

  for (const candidate of candidateIds) {
    const normalizedGroupId = normalizeKeybaseGroupKey(candidate);
    if (!normalizedGroupId) {
      continue;
    }
    const matchedKey = Object.keys(groups).find(
      (key) =>
        key !== "*" &&
        key !== KEYBASE_IMPLICIT_TEAM_WILDCARD &&
        normalizeKeybaseGroupKey(key) === normalizedGroupId,
    );
    if (matchedKey) {
      const matched = groups[matchedKey];
      if (matched) {
        return {
          allowed: true,
          groupConfig: matched,
          wildcardConfig,
          hasConfiguredGroups,
          isImplicitTeam,
        };
      }
    }
  }

  if (wildcardConfig) {
    return {
      allowed: true,
      wildcardConfig,
      hasConfiguredGroups,
      isImplicitTeam,
    };
  }

  return {
    allowed: false,
    hasConfiguredGroups,
    isImplicitTeam,
  };
}

export function resolveKeybaseGroupAccess(params: {
  groupPolicy: "open" | "allowlist" | "disabled";
  groupMatch: KeybaseGroupMatch;
  multiPartyDmPolicy?: "allow" | "deny";
}): ReturnType<typeof evaluateGroupRouteAccessForPolicy> {
  if (params.groupMatch.isImplicitTeam) {
    const impteamPolicy = params.multiPartyDmPolicy ?? "deny";
    if (impteamPolicy === "deny" && !params.groupMatch.allowed) {
      return {
        allowed: false,
        groupPolicy: params.groupPolicy,
        reason: params.groupMatch.hasConfiguredGroups ? "route_not_allowlisted" : "empty_allowlist",
      };
    }
  }
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
  isImplicitTeam?: boolean;
  wildcardConfig?: ResolvedKeybaseGroupConfig;
}): boolean {
  if (params.isImplicitTeam) {
    return true;
  }
  if (params.groupConfig?.requireMention !== undefined) {
    return params.groupConfig.requireMention;
  }
  if (params.wildcardConfig?.requireMention !== undefined) {
    return params.wildcardConfig.requireMention;
  }
  return true;
}

export function resolveKeybaseGroupAllowFrom(params: {
  fallbackAllowFrom?: string[];
  groupConfig?: ResolvedKeybaseGroupConfig;
  isImplicitTeam?: boolean;
  wildcardConfig?: ResolvedKeybaseGroupConfig;
}): string[] {
  if ((params.groupConfig?.allowFrom?.length ?? 0) > 0) {
    return params.groupConfig?.allowFrom ?? [];
  }
  const wildcardAllowFrom = params.wildcardConfig?.allowFrom ?? [];
  if (wildcardAllowFrom.length > 0) {
    return wildcardAllowFrom;
  }
  return params.isImplicitTeam ? (params.fallbackAllowFrom ?? []) : [];
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
