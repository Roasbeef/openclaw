import {
  AllowFromListSchema,
  buildChannelConfigSchema,
  DmPolicySchema,
  GroupPolicySchema,
} from "openclaw/plugin-sdk/channel-config-primitives";
import { z } from "openclaw/plugin-sdk/zod";

const KeybaseCommandsConfigSchema = z
  .object({
    alias: z.string().optional(),
    native: z.union([z.boolean(), z.literal("auto")]).optional(),
    nativeSkills: z.union([z.boolean(), z.literal("auto")]).optional(),
  })
  .strict()
  .optional();

const KeybaseExecApprovalsConfigSchema = z
  .object({
    enabled: z.union([z.boolean(), z.literal("auto")]).optional(),
    approvers: AllowFromListSchema,
    agentFilter: z.array(z.string()).optional(),
    sessionFilter: z.array(z.string()).optional(),
    target: z.enum(["dm", "channel", "both"]).optional(),
  })
  .strict()
  .optional();

export const KeybaseGroupConfigSchema = z
  .object({
    allowFrom: AllowFromListSchema,
    enabled: z.boolean().optional(),
    requireMention: z.boolean().optional(),
    skills: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
  })
  .strict();

export const KeybaseAccountConfigSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    allowFrom: AllowFromListSchema,
    ackReaction: z.string().optional(),
    binary: z.string().optional(),
    dmPolicy: DmPolicySchema.optional(),
    homeDir: z.string().optional(),
    username: z.string().optional(),
    /**
     * @deprecated Inline `paperKey` is retained in the V8 heap and may show up
     * in heap dumps for the lifetime of the process. Prefer `paperKeyFile`,
     * which is read on demand and not held in long-lived strings.
     */
    paperKey: z.string().optional(),
    paperKeyFile: z.string().optional(),
    pidFile: z.string().optional(),
    socketFile: z.string().optional(),
    enableTyping: z.boolean().optional(),
    textChunkLimit: z.number().int().positive().optional(),
    commands: KeybaseCommandsConfigSchema,
    execApprovals: KeybaseExecApprovalsConfigSchema,
    defaultTo: z.string().optional(),
    groupPolicy: GroupPolicySchema.optional(),
    groups: z.record(z.string(), KeybaseGroupConfigSchema).optional(),
    multiPartyDmPolicy: z.enum(["allow", "deny"]).optional(),
  })
  .strict();

let paperKeyDeprecationWarned = false;

function warnPaperKeyDeprecation(): void {
  if (paperKeyDeprecationWarned) {
    return;
  }
  paperKeyDeprecationWarned = true;
  console.warn(
    "[keybase] paperKey in config is deprecated and exposes the key in heap dumps; use paperKeyFile instead",
  );
}

export const KeybaseConfigSchema = KeybaseAccountConfigSchema.extend({
  accounts: z.record(z.string(), KeybaseAccountConfigSchema.partial()).optional(),
  defaultAccount: z.string().optional(),
})
  .strict()
  .superRefine((data, _ctx) => {
    if (typeof data.paperKey === "string") {
      warnPaperKeyDeprecation();
      return;
    }
    if (data.accounts) {
      for (const account of Object.values(data.accounts)) {
        if (account && typeof (account as { paperKey?: unknown }).paperKey === "string") {
          warnPaperKeyDeprecation();
          return;
        }
      }
    }
  });

export const KeybaseChannelConfigSchema = buildChannelConfigSchema(KeybaseConfigSchema);
