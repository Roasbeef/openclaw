import { z } from "openclaw/plugin-sdk/zod";
import { KeybaseConfigSchema } from "./config-schema.js";

export type KeybaseAccountConfig = z.infer<typeof KeybaseConfigSchema>;

export type KeybaseResolvedAccountConfig = Omit<
  KeybaseAccountConfig,
  "accounts" | "defaultAccount"
>;

export type CoreConfig = {
  channels?: {
    keybase?: KeybaseAccountConfig;
  };
};

export interface ResolvedKeybaseGroupConfig {
  allowFrom: string[];
  enabled?: boolean;
  requireMention?: boolean;
  skills?: string[];
  systemPrompt?: string;
}

export interface ResolvedKeybaseAccount {
  accountId: string;
  allowFrom: string[];
  binary: string;
  configured: boolean;
  config: KeybaseResolvedAccountConfig;
  defaultTo?: string;
  dmPolicy: "open" | "allowlist" | "pairing" | "disabled";
  enableTyping: boolean;
  enabled: boolean;
  groupPolicy: "open" | "allowlist" | "disabled";
  groups: Record<string, ResolvedKeybaseGroupConfig>;
  homeDir?: string;
  name?: string;
  paperKey?: string;
  paperKeyFile?: string;
  username?: string;
}
