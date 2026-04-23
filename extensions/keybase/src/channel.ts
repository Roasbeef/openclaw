import {
  buildChannelOutboundSessionRoute,
  createChatChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import {
  DEFAULT_ACCOUNT_ID,
  listKeybaseAccountIds,
  resolveDefaultKeybaseAccountId,
  resolveKeybaseAccount,
} from "./accounts.js";
import { KeybaseChannelConfigSchema } from "./config-schema.js";
import { sendKeybaseMedia, sendKeybaseText } from "./runtime.js";
import { applyKeybaseSetup } from "./setup.js";
import {
  inferKeybaseTargetChatType,
  looksLikeKeybaseTargetId,
  normalizeKeybaseTarget,
  parseKeybaseTarget,
} from "./targets.js";
import type { CoreConfig } from "./types.js";

const CHANNEL_ID = "keybase" as const;

const meta = {
  id: CHANNEL_ID,
  label: "Keybase",
  selectionLabel: "Keybase (CLI JSON API)",
  detailLabel: "Keybase",
  docsPath: "/channels/keybase",
  docsLabel: "keybase",
  blurb: "Keybase chat bot via the Keybase CLI JSON API.",
  order: 73,
  systemImage: "key.horizontal",
  markdownCapable: true,
  exposure: {
    configured: false,
    setup: false,
    docs: false,
  },
} as const;

export const keybasePlugin = createChatChannelPlugin({
  base: {
    id: CHANNEL_ID,
    meta,
    capabilities: {
      chatTypes: ["direct", "group"],
      media: true,
    },
    reload: { configPrefixes: ["channels.keybase"] },
    configSchema: KeybaseChannelConfigSchema,
    setup: {
      applyAccountConfig: ({ cfg, accountId, input }) =>
        applyKeybaseSetup({
          cfg,
          accountId,
          input: input as Record<string, unknown>,
        }),
    },
    config: {
      listAccountIds: (cfg) => listKeybaseAccountIds(cfg as CoreConfig),
      resolveAccount: (cfg, accountId) =>
        resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId }),
      defaultAccountId: (cfg) => resolveDefaultKeybaseAccountId(cfg as CoreConfig),
      isConfigured: (account) => account.configured,
      resolveDefaultTo: ({ cfg, accountId }) =>
        resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId }).defaultTo,
    },
    messaging: {
      normalizeTarget: normalizeKeybaseTarget,
      parseExplicitTarget: ({ raw }) => {
        const parsed = parseKeybaseTarget(raw);
        if (!parsed) {
          return null;
        }
        return {
          to: parsed.normalized,
          chatType: parsed.chatType,
        };
      },
      inferTargetChatType: ({ to }) => inferKeybaseTargetChatType(to),
      targetResolver: {
        looksLikeId: looksLikeKeybaseTargetId,
        hint: "<dm:user[,user]|team:team#topic|conv:id>",
      },
      resolveOutboundSessionRoute: ({ cfg, agentId, accountId, target }) => {
        const parsed = parseKeybaseTarget(target);
        if (!parsed) {
          return null;
        }
        return buildChannelOutboundSessionRoute({
          cfg,
          agentId,
          channel: CHANNEL_ID,
          accountId,
          peer: {
            kind: parsed.chatType === "direct" ? "direct" : "channel",
            id: parsed.normalized,
          },
          chatType: parsed.chatType,
          from: `keybase:${accountId ?? DEFAULT_ACCOUNT_ID}`,
          to: parsed.normalized,
        });
      },
    },
  },
  outbound: {
    deliveryMode: "direct",
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: async ({ cfg, to, text, accountId, replyToId }) =>
        await sendKeybaseText({
          account: resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId }),
          to,
          text,
          replyToId,
        }),
      sendMedia: async ({ cfg, to, text, mediaUrl, accountId, replyToId }) =>
        await sendKeybaseMedia({
          account: resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId }),
          to,
          text,
          mediaUrl,
          replyToId,
        }),
    },
  },
});
