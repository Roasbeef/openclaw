import path from "node:path";
import {
  runKeybaseDockerBlackboxSuite,
  resolveDefaultKeybaseDockerOutputDir,
} from "./docker-smoke.js";
import type { KeybaseQaCommandOptions } from "./qa-cli.js";

function resolveOutputDir(repoRoot: string, outputDir: string | undefined): string {
  if (!outputDir?.trim()) {
    return resolveDefaultKeybaseDockerOutputDir(repoRoot);
  }
  return path.resolve(repoRoot, outputDir);
}

function resolveBotUsername(opts: KeybaseQaCommandOptions): string {
  return (
    opts.botUsername ??
    process.env.KEYBASE_TEST_BOT_USERNAME ??
    process.env.KEYBASE_USERNAME ??
    ""
  ).trim();
}

export async function runKeybaseQaCommand(opts: KeybaseQaCommandOptions) {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const result = await runKeybaseDockerBlackboxSuite({
    botUsername: resolveBotUsername(opts),
    negativeWaitMs: opts.negativeWaitMs,
    outputDir: resolveOutputDir(repoRoot, opts.outputDir),
    scenarioIds: opts.scenarioIds,
    team: opts.team ?? process.env.KEYBASE_TEST_TEAM ?? "lbottest",
    timeoutMs: opts.timeoutMs,
  });

  process.stdout.write(
    `Keybase QA finished:\n- team: ${result.team}\n- bot: ${result.botUsername}\n- passed: ${result.passed}\n- failed: ${result.failed}\n- report: ${result.reportPath}\n- summary: ${result.summaryPath}\n`,
  );

  if (result.failed > 0 && opts.allowFailures !== true) {
    throw new Error(`Keybase QA failed ${result.failed} scenario(s); see ${result.summaryPath}`);
  }
}
