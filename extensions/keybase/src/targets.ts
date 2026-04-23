import type { KeybaseConversationRef } from "./protocol.js";

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
  const normalizedTopic = topicName.trim();
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

  const teamCandidate = /^team:/i.test(withoutPrefix)
    ? withoutPrefix.replace(/^team:/i, "").trim()
    : withoutPrefix;
  const topicSeparator = teamCandidate.indexOf("#");
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
  if (raw.trim() === "*") {
    return "*";
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
    return {
      channel: {
        name: parsed.teamName,
        membersType: "team",
        topicName: parsed.topicName,
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
    topicName?: string;
  };
}): "direct" | "group" {
  if (params.channel.membersType?.toLowerCase() === "team" || params.channel.topicName) {
    return "group";
  }
  return "direct";
}

export function buildKeybaseInboundGroupId(params: {
  channel: {
    name: string;
    topicName?: string;
  };
}): string | undefined {
  if (!params.channel.name || !params.channel.topicName) {
    return undefined;
  }
  return buildKeybaseGroupTarget(params.channel.name, params.channel.topicName) ?? undefined;
}
