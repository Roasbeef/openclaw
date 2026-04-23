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
import { createOpenProviderConfiguredRouteWarningCollector } from "openclaw/plugin-sdk/channel-policy";
import { createResolvedDirectoryEntriesLister } from "openclaw/plugin-sdk/directory-runtime";
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
import { resolveKeybaseGroupMatch, resolveKeybaseGroupRequireMention } from "./groups.js";
import { sendKeybaseMedia, sendKeybaseText } from "./runtime.js";
import { applyKeybaseSetup } from "./setup.js";
import {
  buildKeybaseDmTarget,
  inferKeybaseTargetChatType,
  looksLikeKeybaseTargetId,
  normalizeKeybaseAllowEntry,
  normalizeKeybaseGroupKey,
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
    "groupPolicy",
    "groups",
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

const listKeybaseDirectoryPeersFromConfig =
  createResolvedDirectoryEntriesLister<ResolvedKeybaseAccount>({
    kind: "user",
    resolveAccount: (cfg, accountId) =>
      resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId }),
    resolveSources: (account) => [
      account.allowFrom,
      ...Object.values(account.groups).map((group) => group.allowFrom),
    ],
    normalizeId: (entry) => normalizeKeybaseAllowEntry(entry) ?? null,
  });

const listKeybaseDirectoryGroupsFromConfig =
  createResolvedDirectoryEntriesLister<ResolvedKeybaseAccount>({
    kind: "group",
    resolveAccount: (cfg, accountId) =>
      resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId }),
    resolveSources: (account) => [Object.keys(account.groups)],
    normalizeId: (entry) => normalizeKeybaseGroupKey(entry) ?? null,
  });

const collectKeybaseGroupPolicyWarnings =
  createOpenProviderConfiguredRouteWarningCollector<ResolvedKeybaseAccount>({
    providerConfigPresent: (cfg) => cfg.channels?.keybase !== undefined,
    resolveGroupPolicy: (account) => account.groupPolicy,
    resolveRouteAllowlistConfigured: (account) => Object.keys(account.groups).length > 0,
    configureRouteAllowlist: {
      surface: "Keybase team chats",
      openScope: "any team chat not explicitly denied",
      groupPolicyPath: "channels.keybase.groupPolicy",
      routeAllowlistPath: "channels.keybase.groups",
    },
    missingRouteAllowlist: {
      surface: "Keybase team chats",
      openBehavior: "with no team/topic allowlist; any team chat can trigger (mention-gated)",
      remediation:
        'Set channels.keybase.groupPolicy="allowlist" and configure channels.keybase.groups',
    },
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
            groupPolicy: account.groupPolicy,
          },
        }),
    },
    groups: {
      resolveRequireMention: ({ cfg, groupId, groupSpace, groupChannel, accountId }) => {
        const account = resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId });
        const resolvedGroupId =
          normalizeKeybaseGroupKey(groupId ?? "") ??
          normalizeKeybaseGroupKey(
            groupSpace && groupChannel ? `team:${groupSpace}#${groupChannel}` : "",
          );
        if (!resolvedGroupId) {
          return undefined;
        }
        const groupMatch = resolveKeybaseGroupMatch({
          groups: account.groups,
          groupId: resolvedGroupId,
        });
        return resolveKeybaseGroupRequireMention(groupMatch);
      },
    },
    directory: {
      self: async ({ cfg, accountId }) => {
        const account = resolveKeybaseAccount({ cfg: cfg as CoreConfig, accountId });
        if (!account.username) {
          return null;
        }
        return {
          kind: "user",
          id: account.username,
          name: account.name,
        };
      },
      listPeers: async (params) => listKeybaseDirectoryPeersFromConfig(params),
      listGroups: async (params) => listKeybaseDirectoryGroupsFromConfig(params),
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
            id:
              parsed.chatType === "group"
                ? (normalizeKeybaseGroupKey(parsed.normalized) ?? parsed.normalized)
                : parsed.normalized,
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
    collectWarnings: collectKeybaseGroupPolicyWarnings,
  },
  outbound: {
    base: {
      deliveryMode: "direct",
    },
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
