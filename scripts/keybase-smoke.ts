import path from "node:path";
import { parseArgs } from "node:util";
import {
  buildKeybaseDockerSmokeImage,
  runKeybaseDockerBlackboxSmoke,
  resolveDefaultKeybaseDockerOutputDir,
  writeKeybaseDockerSmokeFiles,
} from "../extensions/keybase/src/docker-smoke.js";

function usage() {
  process.stdout.write(`Usage:
  pnpm keybase:smoke:build [--image <name>] [--base-image <name>] [--platform <platform>]
  pnpm keybase:smoke:scaffold [--output-dir <path>] [--image <name>] [--platform <platform>] [--gateway-port <port>]
  pnpm keybase:smoke:blackbox --bot <username> [--team <team>] [--output-dir <path>] [--timeout-ms <ms>]
`);
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return value;
}

function parsePositiveInteger(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
  return value;
}

async function main() {
  const [command] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }

  const args = parseArgs({
    allowPositionals: true,
    args: process.argv.slice(3),
    options: {
      "base-image": { type: "string" },
      "gateway-port": { type: "string" },
      bot: { type: "string" },
      help: { type: "boolean", short: "h" },
      image: { type: "string" },
      message: { type: "string" },
      "output-dir": { type: "string" },
      platform: { type: "string" },
      team: { type: "string" },
      "timeout-ms": { type: "string" },
    },
  });
  if (args.values.help === true) {
    usage();
    return;
  }

  const repoRoot = process.cwd();

  switch (command) {
    case "build": {
      const result = await buildKeybaseDockerSmokeImage({
        baseImageName: args.values["base-image"],
        imageName: args.values.image,
        platform: args.values.platform,
        repoRoot,
      });
      process.stdout.write(
        `Built Keybase smoke images:\n- base: ${result.baseImageName}\n- final: ${result.imageName}\n- platform: ${result.platform}\n`,
      );
      return;
    }
    case "scaffold": {
      const outputDir = path.resolve(
        args.values["output-dir"] ?? resolveDefaultKeybaseDockerOutputDir(repoRoot),
      );
      const result = await writeKeybaseDockerSmokeFiles({
        gatewayPort: parsePort(args.values["gateway-port"]),
        imageName: args.values.image,
        outputDir,
        platform: args.values.platform,
      });
      process.stdout.write(
        `Wrote Keybase smoke scaffold:\n- output: ${result.outputDir}\n- compose: ${result.composeFile}\n- env example: ${result.envExampleFile}\n- readme: ${result.readmeFile}\n`,
      );
      return;
    }
    case "blackbox": {
      const outputDir = path.resolve(
        args.values["output-dir"] ?? resolveDefaultKeybaseDockerOutputDir(repoRoot),
      );
      const result = await runKeybaseDockerBlackboxSmoke({
        botUsername:
          args.values.bot ??
          process.env.KEYBASE_TEST_BOT_USERNAME ??
          process.env.KEYBASE_USERNAME ??
          "",
        message: args.values.message,
        outputDir,
        team: args.values.team ?? process.env.KEYBASE_TEST_TEAM ?? "lbottest",
        timeoutMs: parsePositiveInteger(args.values["timeout-ms"], "timeout-ms"),
      });
      process.stdout.write(
        `Keybase blackbox smoke passed:\n- team: ${result.team}\n- bot: ${result.botUsername}\n- sent message id: ${result.sentMessageId}\n- inboundAt: ${result.inboundAt}\n- outboundAt: ${result.outboundAt}\n- reply: ${result.replyPreview}\n`,
      );
      return;
    }
    default:
      usage();
      throw new Error(`Unknown command: ${command}`);
  }
}

await main();
