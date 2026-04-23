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
  homeDir?: string;
  name?: string;
  paperKey?: string;
  paperKeyFile?: string;
  username?: string;
}
