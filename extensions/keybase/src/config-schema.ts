import {
  AllowFromListSchema,
  buildChannelConfigSchema,
  DmPolicySchema,
} from "openclaw/plugin-sdk/channel-config-primitives";
import { z } from "openclaw/plugin-sdk/zod";

export const KeybaseAccountConfigSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    allowFrom: AllowFromListSchema,
    binary: z.string().optional(),
    dmPolicy: DmPolicySchema.optional(),
    homeDir: z.string().optional(),
    username: z.string().optional(),
    paperKey: z.string().optional(),
    paperKeyFile: z.string().optional(),
    enableTyping: z.boolean().optional(),
    defaultTo: z.string().optional(),
  })
  .strict();

export const KeybaseConfigSchema = KeybaseAccountConfigSchema.extend({
  accounts: z.record(z.string(), KeybaseAccountConfigSchema.partial()).optional(),
  defaultAccount: z.string().optional(),
}).strict();

export const KeybaseChannelConfigSchema = buildChannelConfigSchema(KeybaseConfigSchema);
