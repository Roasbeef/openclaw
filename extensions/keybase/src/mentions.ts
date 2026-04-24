import { normalizeKeybaseUsername } from "./targets.js";

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripKeybaseBotMention(text: string, botUsername?: string | null): string {
  const username = normalizeKeybaseUsername(botUsername ?? "");
  if (!username) {
    return text;
  }
  return text
    .replace(new RegExp(`(^|\\s)@?${escapeRegexLiteral(username)}[:,]?(?=\\s|$)`, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
}
