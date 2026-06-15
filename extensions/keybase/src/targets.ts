import type { KeybaseConversationRef } from "./protocol.js";

const DEFAULT_KEYBASE_TEAM_TOPIC = "general";
const KEYBASE_IMPLICIT_TEAM_GROUP_PREFIX = "impteam:";

export interface ParsedKeybaseTarget {
  conversationId?: string;
  normalized: string;
  chatType: "direct" | "group";
  raw: string;
  teamName?: string;
  topicName?: string;
  usernames?: string[];
}

function normalizeDelimitedUsernames(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].toSorted((left, right) => left.localeCompare(right));
}

function normalizeKeybaseImplicitTeamGroupKey(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.toLowerCase().startsWith(KEYBASE_IMPLICIT_TEAM_GROUP_PREFIX)) {
    return undefined;
  }
  const usernames = normalizeDelimitedUsernames(
    trimmed.slice(KEYBASE_IMPLICIT_TEAM_GROUP_PREFIX.length),
  );
  return usernames.length > 2
    ? `${KEYBASE_IMPLICIT_TEAM_GROUP_PREFIX}${usernames.join(",")}`
    : undefined;
}

export function isKeybaseImplicitTeamGroupKey(raw: string): boolean {
  return normalizeKeybaseImplicitTeamGroupKey(raw) !== undefined;
}

function normalizeKeybaseImplicitTeamChannelName(name: string): string | undefined {
  return normalizeKeybaseImplicitTeamGroupKey(`${KEYBASE_IMPLICIT_TEAM_GROUP_PREFIX}${name}`);
}

export function normalizeKeybaseUsername(value: string): string | undefined {
  const trimmed = value
    .trim()
    .replace(/^keybase:/i, "")
    .replace(/^dm:/i, "")
    .trim()
    .toLowerCase();
  return trimmed || undefined;
}

export function normalizeKeybaseAllowEntry(value: string): string | undefined {
  if (value.trim() === "*") {
    return "*";
  }
  return normalizeKeybaseUsername(value);
}

export function buildKeybaseDmTarget(username: string): string | null {
  const normalized = normalizeKeybaseUsername(username);
  return normalized ? `dm:${normalized}` : null;
}

export function buildKeybaseGroupTarget(teamName: string, topicName: string): string | null {
  const normalizedTeam = teamName.trim();
  const normalizedTopic = topicName.trim() || DEFAULT_KEYBASE_TEAM_TOPIC;
  if (!normalizedTeam || !normalizedTopic) {
    return null;
  }
  return `team:${normalizedTeam}#${normalizedTopic}`;
}

export function parseKeybaseTarget(raw: string): ParsedKeybaseTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const withoutPrefix = /^keybase:/i.test(trimmed)
    ? trimmed.replace(/^keybase:/i, "").trim()
    : trimmed;
  if (!withoutPrefix) {
    return null;
  }

  if (/^conv:/i.test(withoutPrefix)) {
    const conversationId = withoutPrefix.replace(/^conv:/i, "").trim();
    if (!conversationId) {
      return null;
    }
    return {
      raw,
      conversationId,
      chatType: "direct",
      normalized: `conv:${conversationId}`,
    };
  }

  const hasTeamPrefix = /^team:/i.test(withoutPrefix);
  const teamCandidate = hasTeamPrefix ? withoutPrefix.replace(/^team:/i, "").trim() : withoutPrefix;
  const topicSeparator = teamCandidate.indexOf("#");
  if (hasTeamPrefix && topicSeparator < 0) {
    const teamName = teamCandidate.trim();
    if (!teamName) {
      return null;
    }
    return {
      raw,
      teamName,
      topicName: DEFAULT_KEYBASE_TEAM_TOPIC,
      chatType: "group",
      normalized: `team:${teamName}#${DEFAULT_KEYBASE_TEAM_TOPIC}`,
    };
  }
  if (topicSeparator > 0) {
    const teamName = teamCandidate.slice(0, topicSeparator).trim();
    const topicName = teamCandidate.slice(topicSeparator + 1).trim();
    if (!teamName || !topicName) {
      return null;
    }
    return {
      raw,
      teamName,
      topicName,
      chatType: "group",
      normalized: `team:${teamName}#${topicName}`,
    };
  }

  const dmCandidate = /^dm:/i.test(withoutPrefix)
    ? withoutPrefix.replace(/^dm:/i, "").trim()
    : withoutPrefix;
  const usernames = normalizeDelimitedUsernames(dmCandidate);
  if (usernames.length === 0) {
    return null;
  }
  return {
    raw,
    usernames,
    chatType: "direct",
    normalized: `dm:${usernames.join(",")}`,
  };
}

export function normalizeKeybaseTarget(raw: string): string | undefined {
  return parseKeybaseTarget(raw)?.normalized;
}

export function normalizeKeybaseGroupKey(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "*") {
    return "*";
  }
  if (/^conv:/i.test(trimmed)) {
    const convId = trimmed.replace(/^conv:/i, "").trim();
    return convId ? `conv:${convId}` : undefined;
  }
  const implicitTeamKey = normalizeKeybaseImplicitTeamGroupKey(raw);
  if (implicitTeamKey) {
    return implicitTeamKey;
  }
  const parsed = parseKeybaseTarget(raw);
  if (!parsed || parsed.chatType !== "group" || !parsed.teamName || !parsed.topicName) {
    return undefined;
  }
  return `team:${parsed.teamName.trim().toLowerCase()}#${parsed.topicName.trim().toLowerCase()}`;
}

export function inferKeybaseTargetChatType(raw: string): "direct" | "group" | undefined {
  return parseKeybaseTarget(raw)?.chatType;
}

export function looksLikeKeybaseTargetId(raw: string): boolean {
  return parseKeybaseTarget(raw) !== null;
}

export function resolveKeybaseConversationRef(
  normalizedTarget: string,
): KeybaseConversationRef | null {
  const parsed = parseKeybaseTarget(normalizedTarget);
  if (!parsed) {
    return null;
  }
  if (parsed.conversationId) {
    return { conversationId: parsed.conversationId };
  }
  if (parsed.teamName && parsed.topicName) {
    const topicName = parsed.topicName.trim();
    return {
      channel: {
        name: parsed.teamName,
        membersType: "team",
        ...(topicName.toLowerCase() === DEFAULT_KEYBASE_TEAM_TOPIC
          ? {}
          : { topicName: parsed.topicName }),
      },
    };
  }
  if (parsed.usernames) {
    return {
      channel: {
        name: parsed.usernames.join(","),
      },
    };
  }
  return null;
}

export function inferKeybaseInboundChatType(params: {
  channel: {
    membersType?: string;
    name?: string;
    topicName?: string;
  };
}): "direct" | "group" {
  if (params.channel.membersType?.toLowerCase() === "team" || params.channel.topicName) {
    return "group";
  }
  if (params.channel.name && normalizeKeybaseImplicitTeamChannelName(params.channel.name)) {
    return "group";
  }
  return "direct";
}

export function buildKeybaseInboundGroupId(params: {
  channel: {
    membersType?: string;
    name: string;
    topicName?: string;
  };
  conversationId?: string;
}): string | undefined {
  if (!params.channel.name) {
    return undefined;
  }
  if (params.channel.membersType?.toLowerCase() !== "team" && !params.channel.topicName) {
    const aliasKey = normalizeKeybaseImplicitTeamChannelName(params.channel.name);
    if (!aliasKey) {
      return undefined;
    }
    return buildKeybaseConversationGroupKey(params.conversationId) ?? aliasKey;
  }
  const topicName =
    params.channel.topicName ??
    (params.channel.membersType?.toLowerCase() === "team" ? DEFAULT_KEYBASE_TEAM_TOPIC : "");
  return buildKeybaseGroupTarget(params.channel.name, topicName) ?? undefined;
}

export function buildKeybaseImplicitTeamAliasGroupKey(
  channelName: string | undefined | null,
): string | undefined {
  if (!channelName) {
    return undefined;
  }
  return normalizeKeybaseImplicitTeamChannelName(channelName);
}

function buildKeybaseConversationGroupKey(conversationId: string | undefined): string | undefined {
  const trimmed = conversationId?.trim();
  return trimmed ? `conv:${trimmed}` : undefined;
}

export function isKeybaseConversationGroupKey(raw: string): boolean {
  return /^conv:/i.test(raw.trim());
}
