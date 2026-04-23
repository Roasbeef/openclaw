import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import { formatNormalizedAllowFromEntries } from "openclaw/plugin-sdk/allow-from";
import {
  adaptScopedAccountAccessor,
  createScopedChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "openclaw/plugin-sdk/channel-config-helpers";
import {
  buildChannelOutboundSessionRoute,
  createChatChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import {
  buildPassiveChannelStatusSummary,
  buildTrafficStatusSummary,
} from "openclaw/plugin-sdk/extension-shared";
import {
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
  collectStatusIssuesFromLastError,
} from "openclaw/plugin-sdk/status-helpers";
import {
  DEFAULT_ACCOUNT_ID,
  listKeybaseAccountIds,
  resolveDefaultKeybaseAccountId,
  resolveKeybaseAccount,
} from "./accounts.js";
import { KeybaseChannelConfigSchema } from "./config-schema.js";
import { keybaseGatewayAdapter } from "./gateway.js";
import { sendKeybaseMedia, sendKeybaseText } from "./runtime.js";
import { applyKeybaseSetup } from "./setup.js";
import {
  buildKeybaseDmTarget,
  inferKeybaseTargetChatType,
  looksLikeKeybaseTargetId,
  normalizeKeybaseAllowEntry,
  normalizeKeybaseTarget,
  parseKeybaseTarget,
} from "./targets.js";
import type { CoreConfig, ResolvedKeybaseAccount } from "./types.js";

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

const keybaseConfigAdapter = createScopedChannelConfigAdapter<
  ResolvedKeybaseAccount,
  ResolvedKeybaseAccount,
  CoreConfig
>({
  sectionKey: CHANNEL_ID,
  listAccountIds: listKeybaseAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveKeybaseAccount),
  defaultAccountId: resolveDefaultKeybaseAccountId,
  clearBaseFields: [
    "name",
    "binary",
    "homeDir",
    "username",
    "paperKey",
    "paperKeyFile",
    "enableTyping",
    "defaultTo",
    "allowFrom",
    "dmPolicy",
  ],
  resolveAllowFrom: (account) => account.allowFrom,
  formatAllowFrom: (allowFrom) =>
    formatNormalizedAllowFromEntries({
      allowFrom,
      normalizeEntry: normalizeKeybaseAllowEntry,
    }),
  resolveDefaultTo: (account) => account.defaultTo,
});

const keybaseStatusAdapter = createComputedAccountStatusAdapter<ResolvedKeybaseAccount>({
  defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
  collectStatusIssues: (accounts) => collectStatusIssuesFromLastError(CHANNEL_ID, accounts),
  buildChannelSummary: ({ snapshot }) =>
    buildPassiveChannelStatusSummary(snapshot, buildTrafficStatusSummary(snapshot)),
  resolveAccountSnapshot: ({ account, runtime }) => ({
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    extra: {
      binary: account.binary,
      dmPolicy: account.dmPolicy,
      username: account.username,
      homeDir: account.homeDir,
      ...buildTrafficStatusSummary(runtime),
    },
  }),
});

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
      ...keybaseConfigAdapter,
      isConfigured: (account) => account.configured,
      describeAccount: (account) =>
        describeAccountSnapshot({
          account,
          configured: account.configured,
          extra: {
            binary: account.binary,
            username: account.username,
            homeDir: account.homeDir,
            dmPolicy: account.dmPolicy,
          },
        }),
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
    status: keybaseStatusAdapter,
    gateway: keybaseGatewayAdapter,
  },
  pairing: {
    text: {
      idLabel: "keybaseUsername",
      message: "Your pairing request has been approved!",
      normalizeAllowEntry: (raw) => normalizeKeybaseAllowEntry(raw) ?? raw.trim().toLowerCase(),
      notify: async ({ cfg, accountId, id, message }) => {
        const account = resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId });
        const target = buildKeybaseDmTarget(id);
        if (!target) {
          throw new Error(`Invalid Keybase username for pairing notify: ${id}`);
        }
        await sendKeybaseText({
          account,
          to: target,
          text: message,
        });
      },
    },
  },
  security: {
    resolveDmPolicy: createScopedDmSecurityResolver({
      channelKey: CHANNEL_ID,
      resolvePolicy: (account) => account.dmPolicy,
      resolveAllowFrom: (account) => account.allowFrom,
      policyPathSuffix: "dmPolicy",
      approveHint: "openclaw pairing approve keybase <username>",
      normalizeEntry: (raw) => normalizeKeybaseAllowEntry(raw) ?? raw.trim().toLowerCase(),
    }),
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
