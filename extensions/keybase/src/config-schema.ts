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
  })
  .strict();

export const KeybaseConfigSchema = KeybaseAccountConfigSchema.extend({
  accounts: z.record(z.string(), KeybaseAccountConfigSchema.partial()).optional(),
  defaultAccount: z.string().optional(),
}).strict();

export const KeybaseChannelConfigSchema = buildChannelConfigSchema(KeybaseConfigSchema);
