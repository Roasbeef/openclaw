import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { DEFAULT_ACCOUNT_ID } from "./accounts.js";
import type { CoreConfig, KeybaseResolvedAccountConfig } from "./types.js";

export function applyKeybaseSetup(params: {
  accountId: string;
  cfg: OpenClawConfig;
  input: Record<string, unknown>;
}): OpenClawConfig {
  const nextCfg = structuredClone(params.cfg) as CoreConfig;
  const section = nextCfg.channels?.keybase ?? {};
  const accounts = { ...section.accounts };
  const target: Partial<KeybaseResolvedAccountConfig> =
    params.accountId === DEFAULT_ACCOUNT_ID ? { ...section } : { ...accounts[params.accountId] };

  const assignString = (
    key: "binary" | "defaultTo" | "homeDir" | "paperKey" | "paperKeyFile" | "username",
    inputKey: string,
  ) => {
    const value = params.input[inputKey];
    if (typeof value === "string" && value.trim().length > 0) {
      target[key] = value.trim();
    }
  };

  assignString("binary", "binary");
  assignString("homeDir", "homeDir");
  assignString("username", "username");
  assignString("paperKey", "paperKey");
  assignString("paperKeyFile", "paperKeyFile");
  assignString("defaultTo", "defaultTo");

  if (typeof params.input.enableTyping === "boolean") {
    target.enableTyping = params.input.enableTyping;
  }

  nextCfg.channels ??= {};
  if (params.accountId === DEFAULT_ACCOUNT_ID) {
    nextCfg.channels.keybase = {
      ...section,
      ...target,
    };
  } else {
    accounts[params.accountId] = target;
    nextCfg.channels.keybase = {
      ...section,
      accounts,
    };
  }

  return nextCfg as OpenClawConfig;
}
