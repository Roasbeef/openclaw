import { normalizeKeybaseAllowEntry } from "./targets.js";

export function normalizeKeybaseApproverId(value: string | number): string | undefined {
  const normalized = normalizeKeybaseAllowEntry(String(value));
  return normalized === "*" ? undefined : normalized;
}
