import type { Command } from "commander";
import type { QaRunnerCliRegistration } from "openclaw/plugin-sdk/qa-runner-runtime";

export type KeybaseQaCommandOptions = {
  allowFailures?: boolean;
  botUsername?: string;
  negativeWaitMs?: number;
  outputDir?: string;
  repoRoot?: string;
  scenarioIds?: string[];
  team?: string;
  timeoutMs?: number;
};

type KeybaseQaCommanderOptions = {
  allowFailures?: boolean;
  bot?: string;
  negativeWaitMs?: string;
  outputDir?: string;
  repoRoot?: string;
  scenario?: string[];
  team?: string;
  timeoutMs?: string;
};

type KeybaseQaCliRuntime = typeof import("./qa-cli.runtime.js");

let runtimePromise: Promise<KeybaseQaCliRuntime> | null = null;

async function loadKeybaseQaCliRuntime(): Promise<KeybaseQaCliRuntime> {
  runtimePromise ??= import("./qa-cli.runtime.js");
  return await runtimePromise;
}

function collectString(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parsePositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function mapCommanderOptions(opts: KeybaseQaCommanderOptions): KeybaseQaCommandOptions {
  return {
    allowFailures: opts.allowFailures,
    botUsername: opts.bot,
    negativeWaitMs: parsePositiveInteger(opts.negativeWaitMs, "negative-wait-ms"),
    outputDir: opts.outputDir,
    repoRoot: opts.repoRoot,
    scenarioIds: opts.scenario,
    team: opts.team,
    timeoutMs: parsePositiveInteger(opts.timeoutMs, "timeout-ms"),
  };
}

async function runKeybaseQa(opts: KeybaseQaCommandOptions) {
  const runtime = await loadKeybaseQaCliRuntime();
  await runtime.runKeybaseQaCommand(opts);
}

export const keybaseQaCliRegistration: QaRunnerCliRegistration = {
  commandName: "keybase",
  register(qa: Command) {
    qa.command("keybase")
      .description(
        "Run the Docker-backed Keybase live QA lane against local bot and sender containers",
      )
      .option("--repo-root <path>", "Repository root to target when running from a neutral cwd")
      .option("--output-dir <path>", "Keybase QA artifact directory")
      .option("--team <team>", "Keybase team used for the group-channel tests", "lbottest")
      .option("--bot <username>", "Keybase bot username under test")
      .option(
        "--scenario <id>",
        "Run only the named Keybase QA scenario (repeatable)",
        collectString,
        [],
      )
      .option("--timeout-ms <ms>", "Positive scenario timeout in milliseconds")
      .option("--negative-wait-ms <ms>", "No-response assertion window in milliseconds")
      .option(
        "--allow-failures",
        "Write artifacts but do not fail the command when scenarios fail",
        false,
      )
      .action(async (opts: KeybaseQaCommanderOptions) => {
        await runKeybaseQa(mapCommanderOptions(opts));
      });
  },
};

export const qaRunnerCliRegistrations = [keybaseQaCliRegistration] as const;

export function registerKeybaseQaCli(qa: Command) {
  keybaseQaCliRegistration.register(qa);
}
