import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { describe, expect, it } from "vitest";
import {
  getKeybaseExecApprovalApprovers,
  getKeybasePluginApprovalApprovers,
  isKeybaseExecApprovalApprover,
  isKeybaseExecApprovalAuthorizedSender,
  isKeybaseExecApprovalClientEnabled,
  isKeybaseExecApprovalTargetRecipient,
  resolveKeybaseExecApprovalTarget,
  shouldHandleKeybaseApprovalRequest,
} from "./exec-approvals.js";

function buildConfig(
  execApprovals?: NonNullable<NonNullable<OpenClawConfig["channels"]>["keybase"]>["execApprovals"],
  channelOverrides?: Partial<NonNullable<NonNullable<OpenClawConfig["channels"]>["keybase"]>>,
): OpenClawConfig {
  return {
    channels: {
      keybase: {
        username: "lbottestbot",
        paperKey: "paper key",
        ...channelOverrides,
        execApprovals,
      },
    },
  } as OpenClawConfig;
}

describe("keybase exec approvals", () => {
  it("requires enablement and approvers before enabling the client", () => {
    expect(isKeybaseExecApprovalClientEnabled({ cfg: buildConfig() })).toBe(false);
    expect(
      isKeybaseExecApprovalClientEnabled({
        cfg: buildConfig(undefined, { allowFrom: ["roasbeef"] }),
      }),
    ).toBe(false);
    expect(isKeybaseExecApprovalClientEnabled({ cfg: buildConfig({ enabled: true }) })).toBe(false);
    expect(
      isKeybaseExecApprovalClientEnabled({
        cfg: buildConfig({ enabled: true, approvers: ["roasbeef"] }),
      }),
    ).toBe(true);
  });

  it("prefers explicit approvers and ignores wildcard allowlists", () => {
    const cfg = buildConfig(
      { enabled: true, approvers: ["keybase:alice"] },
      { allowFrom: ["*", "roasbeef"] },
    );

    expect(getKeybaseExecApprovalApprovers({ cfg })).toEqual(["alice"]);
    expect(isKeybaseExecApprovalApprover({ cfg, senderId: "alice" })).toBe(true);
    expect(isKeybaseExecApprovalApprover({ cfg, senderId: "roasbeef" })).toBe(false);
  });

  it("defaults target to dm", () => {
    expect(
      resolveKeybaseExecApprovalTarget({
        cfg: buildConfig({ enabled: true, approvers: ["roasbeef"] }),
      }),
    ).toBe("dm");
  });

  it("matches keybase target recipients from generic approval forwarding targets", () => {
    const cfg = {
      channels: {
        keybase: {
          username: "lbottestbot",
          paperKey: "paper key",
        },
      },
      approvals: {
        exec: {
          enabled: true,
          mode: "targets",
          targets: [{ channel: "keybase", to: "dm:roasbeef" }],
        },
      },
    } as OpenClawConfig;

    expect(isKeybaseExecApprovalTargetRecipient({ cfg, senderId: "roasbeef" })).toBe(true);
    expect(isKeybaseExecApprovalTargetRecipient({ cfg, senderId: "other" })).toBe(false);
    expect(isKeybaseExecApprovalAuthorizedSender({ cfg, senderId: "roasbeef" })).toBe(true);
  });

  it("plugin approvals honor execApprovals.approvers and fall back to allowFrom", () => {
    // Explicit approvers -> use them, ignore allowFrom.
    const explicit = buildConfig(
      { enabled: true, approvers: ["keybase:alice"] },
      { allowFrom: ["roasbeef"] },
    );
    expect(getKeybasePluginApprovalApprovers({ cfg: explicit })).toEqual(["alice"]);
    expect(getKeybaseExecApprovalApprovers({ cfg: explicit })).toEqual(["alice"]);

    // No execApprovals.approvers -> fall back to allowFrom.
    const fallback = buildConfig(
      { enabled: true, approvers: [] },
      { allowFrom: ["roasbeef", "keybase:carol"] },
    );
    expect(getKeybasePluginApprovalApprovers({ cfg: fallback })).toEqual(["roasbeef", "carol"]);
    expect(getKeybaseExecApprovalApprovers({ cfg: fallback })).toEqual(["roasbeef", "carol"]);

    // No execApprovals at all -> still falls back to allowFrom.
    const noExec = buildConfig(undefined, { allowFrom: ["roasbeef"] });
    expect(getKeybasePluginApprovalApprovers({ cfg: noExec })).toEqual(["roasbeef"]);
  });

  it("applies agent and session filters to request handling", () => {
    const cfg = buildConfig({
      enabled: true,
      approvers: ["roasbeef"],
      agentFilter: ["ops-agent"],
      sessionFilter: ["keybase:channel:", "ops$"],
    });

    expect(
      shouldHandleKeybaseApprovalRequest({
        cfg,
        request: {
          id: "req-1",
          request: {
            command: "echo hi",
            agentId: "ops-agent",
            sessionKey: "agent:ops-agent:keybase:channel:lbottest:ops",
          },
          createdAtMs: 0,
          expiresAtMs: 1000,
        },
      }),
    ).toBe(true);

    expect(
      shouldHandleKeybaseApprovalRequest({
        cfg,
        request: {
          id: "req-2",
          request: {
            command: "echo hi",
            agentId: "other-agent",
            sessionKey: "agent:other-agent:keybase:channel:lbottest:ops",
          },
          createdAtMs: 0,
          expiresAtMs: 1000,
        },
      }),
    ).toBe(false);
  });
});
