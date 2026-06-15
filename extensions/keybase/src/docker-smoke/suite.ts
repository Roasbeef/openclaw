import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BLACKBOX_ACK_REACTION, formatUnknownError, waitForBlackboxReply } from "./api.js";
import {
  prepareKeybaseBlackboxContext,
  restartKeybaseGateway,
  runAllowlistBlockProbe,
  runChunkedCommandsProbe,
  runCommandAdvertisementProbe,
  runDirectMessagePairingProbe,
  runDirectMessageReplyProbe,
  runHelpCommandProbe,
  runMentionGatingProbe,
  runMentionReplyProbe,
  runSubagentsListProbe,
  runSubagentsSpawnProbe,
  sendKeybaseBlackboxMessage,
  stopKeybaseApiListenChild,
} from "./blackbox-probes.js";
import type { RunCommand } from "./scaffold.js";

export interface KeybaseDockerBlackboxResult {
  ackReactionBody?: string;
  ackReactionMessageId?: string;
  botUsername: string;
  inboundAt: number;
  marker: string;
  outboundAt: number;
  replyPreview: string;
  sentMessageId: string;
  team: string;
}

export type KeybaseDockerBlackboxScenarioId =
  | "allowlist-block"
  | "canary"
  | "chunked-commands"
  | "command-advertisements"
  | "dm-canary"
  | "dm-pairing"
  | "help-command"
  | "listener-restart"
  | "mention-gating"
  | "restart-resume"
  | "subagents-list"
  | "subagents-spawn";

export interface KeybaseDockerBlackboxScenarioResult {
  details?: Record<string, unknown>;
  error?: string;
  finishedAt: number;
  id: KeybaseDockerBlackboxScenarioId;
  startedAt: number;
  status: "failed" | "passed";
}

export interface KeybaseDockerBlackboxSuiteResult {
  botUsername: string;
  failed: number;
  passed: number;
  reportPath: string;
  scenarios: KeybaseDockerBlackboxScenarioResult[];
  summaryPath: string;
  team: string;
}

const DEFAULT_BLACKBOX_SCENARIOS: readonly KeybaseDockerBlackboxScenarioId[] = [
  "canary",
  "help-command",
  "command-advertisements",
  "chunked-commands",
  "dm-pairing",
  "dm-canary",
  "subagents-list",
  "subagents-spawn",
  "mention-gating",
  "allowlist-block",
  "listener-restart",
  "restart-resume",
];

export async function runKeybaseDockerBlackboxSmoke(
  params: {
    botUsername: string;
    composeFile?: string;
    envFile?: string;
    expectedAckReaction?: string | false;
    message?: string;
    outputDir: string;
    team: string;
    timeoutMs?: number;
  },
  deps: {
    runCommand?: RunCommand;
  } = {},
): Promise<KeybaseDockerBlackboxResult> {
  const timeoutMs = params.timeoutMs ?? 180_000;
  const startedAt = Date.now();
  const marker = `keybase-blackbox-${startedAt}`;
  const context = await prepareKeybaseBlackboxContext({
    botUsername: params.botUsername,
    composeFile: params.composeFile,
    envFile: params.envFile,
    outputDir: params.outputDir,
    runCommand: deps.runCommand,
    team: params.team,
  });

  const body =
    params.message?.trim() ||
    `@${context.botUsername} reply exactly: keybase blackbox smoke ok ${marker}`;
  const sentMessageId = await sendKeybaseBlackboxMessage({
    body,
    context,
  });

  const reply = await waitForBlackboxReply({
    botUsername: context.botUsername,
    composeFile: context.composeFile,
    conversation: { conversation_id: context.conversationId },
    cwd: context.outputDir,
    envFile: context.envFile,
    expectedAckReaction: params.expectedAckReaction ?? DEFAULT_BLACKBOX_ACK_REACTION,
    runCommand: context.runCommand,
    sentMessageId,
    startedAt,
    timeoutMs,
  });

  return {
    ...(reply.ackReactionBody ? { ackReactionBody: reply.ackReactionBody } : {}),
    ...(reply.ackReactionMessageId ? { ackReactionMessageId: reply.ackReactionMessageId } : {}),
    botUsername: context.botUsername,
    inboundAt: reply.inboundAt,
    marker,
    outboundAt: reply.outboundAt,
    replyPreview: reply.replyPreview,
    sentMessageId,
    team: context.team,
  };
}

export function normalizeKeybaseBlackboxScenarioIds(
  scenarioIds?: readonly string[],
): KeybaseDockerBlackboxScenarioId[] {
  const normalized =
    scenarioIds && scenarioIds.length > 0 ? scenarioIds : DEFAULT_BLACKBOX_SCENARIOS;
  const allowed = new Set<KeybaseDockerBlackboxScenarioId>(DEFAULT_BLACKBOX_SCENARIOS);
  return normalized.map((id) => {
    if (!allowed.has(id as KeybaseDockerBlackboxScenarioId)) {
      throw new Error(
        `Unknown Keybase blackbox scenario "${id}". Supported scenarios: ${[
          ...DEFAULT_BLACKBOX_SCENARIOS,
        ].join(", ")}`,
      );
    }
    return id as KeybaseDockerBlackboxScenarioId;
  });
}

export function renderKeybaseBlackboxSummary(
  result: Omit<KeybaseDockerBlackboxSuiteResult, "summaryPath">,
) {
  const lines = [
    "# Keybase Blackbox QA",
    "",
    `- team: ${result.team}`,
    `- bot: ${result.botUsername}`,
    `- passed: ${result.passed}`,
    `- failed: ${result.failed}`,
    "",
    "| Scenario | Status | Details |",
    "| --- | --- | --- |",
  ];
  for (const scenario of result.scenarios) {
    const details = scenario.error ?? JSON.stringify(scenario.details ?? {});
    lines.push(`| ${scenario.id} | ${scenario.status} | ${details.replaceAll("|", "\\|")} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function runKeybaseDockerBlackboxSuite(
  params: {
    botUsername: string;
    composeFile?: string;
    envFile?: string;
    negativeWaitMs?: number;
    outputDir: string;
    scenarioIds?: readonly string[];
    team: string;
    timeoutMs?: number;
  },
  deps: {
    runCommand?: RunCommand;
  } = {},
): Promise<KeybaseDockerBlackboxSuiteResult> {
  const timeoutMs = params.timeoutMs ?? 180_000;
  const quietMs = params.negativeWaitMs ?? 20_000;
  const scenarioIds = normalizeKeybaseBlackboxScenarioIds(params.scenarioIds);
  const context = await prepareKeybaseBlackboxContext({
    botUsername: params.botUsername,
    composeFile: params.composeFile,
    envFile: params.envFile,
    outputDir: params.outputDir,
    runCommand: deps.runCommand,
    team: params.team,
  });
  const scenarios: KeybaseDockerBlackboxScenarioResult[] = [];

  for (const id of scenarioIds) {
    const startedAt = Date.now();
    try {
      const marker = `keybase-${id}-${startedAt}`;
      let details: Record<string, unknown>;
      switch (id) {
        case "canary":
          details = await runMentionReplyProbe({
            context,
            marker,
            prefix: "keybase blackbox canary ok",
            timeoutMs,
          });
          break;
        case "command-advertisements":
          details = await runCommandAdvertisementProbe({
            context,
            timeoutMs,
          });
          break;
        case "chunked-commands":
          details = await runChunkedCommandsProbe({
            context,
            timeoutMs,
          });
          break;
        case "dm-canary":
          details = await runDirectMessageReplyProbe({
            context,
            marker,
            timeoutMs,
          });
          break;
        case "dm-pairing":
          details = await runDirectMessagePairingProbe({
            context,
            marker,
            timeoutMs,
          });
          break;
        case "help-command":
          details = await runHelpCommandProbe({
            context,
            quietMs,
            timeoutMs,
          });
          break;
        case "mention-gating":
          details = await runMentionGatingProbe({
            context,
            marker,
            quietMs,
          });
          break;
        case "allowlist-block":
          details = await runAllowlistBlockProbe({
            context,
            marker,
            quietMs,
          });
          break;
        case "listener-restart":
          await stopKeybaseApiListenChild(context);
          details = await runMentionReplyProbe({
            context,
            marker,
            prefix: "keybase listener restart ok",
            timeoutMs,
          });
          break;
        case "restart-resume":
          await restartKeybaseGateway(context);
          details = await runMentionReplyProbe({
            context,
            marker,
            prefix: "keybase restart resume ok",
            timeoutMs,
          });
          break;
        case "subagents-list":
          details = await runSubagentsListProbe({
            context,
            timeoutMs,
          });
          break;
        case "subagents-spawn":
          details = await runSubagentsSpawnProbe({
            context,
            marker,
            timeoutMs,
          });
          break;
      }
      scenarios.push({
        details,
        finishedAt: Date.now(),
        id,
        startedAt,
        status: "passed",
      });
    } catch (error) {
      scenarios.push({
        error: formatUnknownError(error),
        finishedAt: Date.now(),
        id,
        startedAt,
        status: "failed",
      });
    }
  }

  const reportPath = path.join(context.outputDir, "keybase-blackbox-report.json");
  const summaryPath = path.join(context.outputDir, "keybase-blackbox-summary.md");
  const passed = scenarios.filter((scenario) => scenario.status === "passed").length;
  const failed = scenarios.length - passed;
  const resultWithoutSummaryPath = {
    botUsername: context.botUsername,
    failed,
    passed,
    reportPath,
    scenarios,
    team: context.team,
  };
  const result: KeybaseDockerBlackboxSuiteResult = {
    ...resultWithoutSummaryPath,
    summaryPath,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fs.writeFile(summaryPath, renderKeybaseBlackboxSummary(resultWithoutSummaryPath), "utf8");
  return result;
}
