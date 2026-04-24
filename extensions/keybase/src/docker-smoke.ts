import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export interface RunCommandResult {
  stderr: string;
  stdout: string;
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<RunCommandResult>;

export interface KeybaseDockerSmokeFilesResult {
  composeFile: string;
  envExampleFile: string;
  files: string[];
  outputDir: string;
  readmeFile: string;
}

export interface KeybaseDockerSmokeImageResult {
  baseImageName: string;
  imageName: string;
  platform: string;
}

export interface KeybaseDockerBlackboxResult {
  botUsername: string;
  inboundAt: number;
  marker: string;
  outboundAt: number;
  replyPreview: string;
  sentMessageId: string;
  team: string;
}

const DEFAULT_GATEWAY_PORT = 18789;
const DEFAULT_IMAGE_NAME = "openclaw:keybase-local";
const DEFAULT_BASE_IMAGE_NAME = "openclaw:keybase-base-local";
const DEFAULT_KEYBASE_HOME = "/home/node";
const DEFAULT_KEYBASE_RUNTIME_DIR = "/tmp/openclaw-keybase";
const DEFAULT_KEYBASE_PID_FILE = `${DEFAULT_KEYBASE_RUNTIME_DIR}/keybased.pid`;
const DEFAULT_KEYBASE_SOCKET_FILE = `${DEFAULT_KEYBASE_RUNTIME_DIR}/keybased.sock`;
const DEFAULT_OPENCLAW_HOME = "/home/node/.openclaw";
const DEFAULT_OPENCLAW_TMPDIR = `${DEFAULT_OPENCLAW_HOME}/tmp`;
const DEFAULT_PLATFORM = "linux/amd64";
const GATEWAY_SERVICE = "openclaw-keybase-gateway";
const SENDER_SERVICE = "openclaw-keybase-sender";

function renderCompose(params: { gatewayPort: number; imageName: string; platform: string }) {
  return `services:
  ${GATEWAY_SERVICE}:
    image: ${params.imageName}
    pull_policy: never
    platform: ${params.platform}
    ports:
      - "${params.gatewayPort}:18789"
    environment:
      HOME: /home/node
      TERM: xterm-256color
      CLAUDE_CODE_OAUTH_TOKEN: \${CLAUDE_CODE_OAUTH_TOKEN:-}
      KEYBASE_PAPERKEY: \${KEYBASE_PAPERKEY:-}
      KEYBASE_PAPERKEY_FILE: \${KEYBASE_PAPERKEY_FILE:-}
      KEYBASE_SERVICE: "1"
      KEYBASE_USERNAME: \${KEYBASE_USERNAME:-}
      OPENCLAW_CONFIG_PATH: ${DEFAULT_OPENCLAW_HOME}/openclaw.json
      OPENCLAW_KEYBASE_AUTO_ONESHOT: \${OPENCLAW_KEYBASE_AUTO_ONESHOT:-1}
      OPENCLAW_KEYBASE_BINARY: keybase
      OPENCLAW_KEYBASE_HOME: ${DEFAULT_KEYBASE_HOME}
      OPENCLAW_KEYBASE_PID_FILE: ${DEFAULT_KEYBASE_PID_FILE}
      OPENCLAW_KEYBASE_RUNTIME_DIR: ${DEFAULT_KEYBASE_RUNTIME_DIR}
      OPENCLAW_KEYBASE_SOCKET_FILE: ${DEFAULT_KEYBASE_SOCKET_FILE}
      OPENCLAW_TMPDIR: ${DEFAULT_OPENCLAW_TMPDIR}
      OPENCLAW_TZ: \${OPENCLAW_TZ:-UTC}
      TMPDIR: ${DEFAULT_OPENCLAW_TMPDIR}
      TZ: \${OPENCLAW_TZ:-UTC}
    volumes:
      - ./state/home:/home/node
    init: true
    restart: unless-stopped
    entrypoint:
      - node
      - /app/extensions/keybase/docker/container-entrypoint.mjs
    command:
      - node
      - dist/index.js
      - gateway
      - run
      - --bind
      - lan
      - --port
      - "18789"
      - --allow-unconfigured
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - fetch("http://127.0.0.1:18789/healthz").then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s

  openclaw-keybase-cli:
    image: ${params.imageName}
    pull_policy: never
    platform: ${params.platform}
    network_mode: "service:openclaw-keybase-gateway"
    environment:
      HOME: /home/node
      TERM: xterm-256color
      BROWSER: echo
      CLAUDE_CODE_OAUTH_TOKEN: \${CLAUDE_CODE_OAUTH_TOKEN:-}
      KEYBASE_PAPERKEY: \${KEYBASE_PAPERKEY:-}
      KEYBASE_PAPERKEY_FILE: \${KEYBASE_PAPERKEY_FILE:-}
      KEYBASE_SERVICE: "1"
      KEYBASE_USERNAME: \${KEYBASE_USERNAME:-}
      OPENCLAW_CONFIG_PATH: ${DEFAULT_OPENCLAW_HOME}/openclaw.json
      OPENCLAW_KEYBASE_BINARY: keybase
      OPENCLAW_KEYBASE_HOME: ${DEFAULT_KEYBASE_HOME}
      OPENCLAW_KEYBASE_PID_FILE: ${DEFAULT_KEYBASE_PID_FILE}
      OPENCLAW_KEYBASE_RUNTIME_DIR: ${DEFAULT_KEYBASE_RUNTIME_DIR}
      OPENCLAW_KEYBASE_SOCKET_FILE: ${DEFAULT_KEYBASE_SOCKET_FILE}
      OPENCLAW_TMPDIR: ${DEFAULT_OPENCLAW_TMPDIR}
      OPENCLAW_TZ: \${OPENCLAW_TZ:-UTC}
      TMPDIR: ${DEFAULT_OPENCLAW_TMPDIR}
      TZ: \${OPENCLAW_TZ:-UTC}
    volumes:
      - ./state/home:/home/node
    stdin_open: true
    tty: true
    init: true
    entrypoint:
      - node
      - dist/index.js
    depends_on:
      - ${GATEWAY_SERVICE}

  ${SENDER_SERVICE}:
    image: ${params.imageName}
    pull_policy: never
    platform: ${params.platform}
    profiles:
      - blackbox
    environment:
      HOME: /home/node
      TERM: xterm-256color
      KEYBASE_PAPERKEY: \${KEYBASE_TEST_PAPERKEY:-}
      KEYBASE_PAPERKEY_FILE: \${KEYBASE_TEST_PAPERKEY_FILE:-}
      KEYBASE_SERVICE: "1"
      KEYBASE_USERNAME: \${KEYBASE_TEST_USERNAME:-}
      OPENCLAW_CONFIG_PATH: ${DEFAULT_OPENCLAW_HOME}/openclaw.json
      OPENCLAW_KEYBASE_AUTO_ONESHOT: \${OPENCLAW_KEYBASE_TEST_AUTO_ONESHOT:-1}
      OPENCLAW_KEYBASE_BINARY: keybase
      OPENCLAW_KEYBASE_HOME: ${DEFAULT_KEYBASE_HOME}
      OPENCLAW_KEYBASE_PID_FILE: ${DEFAULT_KEYBASE_PID_FILE}
      OPENCLAW_KEYBASE_RUNTIME_DIR: ${DEFAULT_KEYBASE_RUNTIME_DIR}
      OPENCLAW_KEYBASE_SOCKET_FILE: ${DEFAULT_KEYBASE_SOCKET_FILE}
      OPENCLAW_TMPDIR: ${DEFAULT_OPENCLAW_TMPDIR}
      OPENCLAW_TZ: \${OPENCLAW_TZ:-UTC}
      TMPDIR: ${DEFAULT_OPENCLAW_TMPDIR}
      TZ: \${OPENCLAW_TZ:-UTC}
    volumes:
      - ./state/sender-home:/home/node
    init: true
    entrypoint:
      - node
      - /app/extensions/keybase/docker/container-entrypoint.mjs
    command:
      - sleep
      - infinity
    depends_on:
      - ${GATEWAY_SERVICE}
`;
}

function renderEnvExample(params: { gatewayPort: number; imageName: string; platform: string }) {
  return `# Keybase Docker smoke example env
# Build first: pnpm keybase:smoke:build --image ${params.imageName} --platform ${params.platform}

KEYBASE_USERNAME=claw_ll
# Option A: export KEYBASE_PAPERKEY directly from a local paper key file.
KEYBASE_PAPERKEY=
# Option B: leave KEYBASE_PAPERKEY empty and point at a file inside ./state/home/.openclaw.
KEYBASE_PAPERKEY_FILE=${DEFAULT_OPENCLAW_HOME}/secrets/keybase-paperkey

# Optional blackbox sender identity. This must be a different Keybase account
# that is already a member of the target test team.
KEYBASE_TEST_USERNAME=
KEYBASE_TEST_PAPERKEY=
KEYBASE_TEST_PAPERKEY_FILE=${DEFAULT_OPENCLAW_HOME}/secrets/keybase-test-paperkey
KEYBASE_TEST_TEAM=lbottest
KEYBASE_TEST_BOT_USERNAME=claw_ll

CLAUDE_CODE_OAUTH_TOKEN=
OPENCLAW_KEYBASE_AUTO_ONESHOT=1
OPENCLAW_KEYBASE_TEST_AUTO_ONESHOT=1
OPENCLAW_TZ=UTC

# Gateway will be available at http://127.0.0.1:${params.gatewayPort}/
`;
}

function renderReadme(params: {
  composeFileName: string;
  envExampleFileName: string;
  gatewayPort: number;
  imageName: string;
  platform: string;
}) {
  return `# Keybase Docker Smoke

Generated scaffold for a local Keybase-backed OpenClaw smoke run.

## Suggested flow

1. Build the image:
   - \`pnpm keybase:smoke:build --image ${params.imageName} --platform ${params.platform}\`
2. Copy the env example and fill in the bot identity:
   - \`cp ${params.envExampleFileName} .env\`
3. Provide the paper key in one of two ways:
   - export \`KEYBASE_PAPERKEY="$(< /path/to/paper_key.txt)"\`
   - or place it at \`state/home/.openclaw/secrets/keybase-paperkey\` and keep \`KEYBASE_PAPERKEY_FILE=/home/node/.openclaw/secrets/keybase-paperkey\`
4. Export the Claude Code subscription token from \`claude setup-token\`:
   - \`export CLAUDE_CODE_OAUTH_TOKEN=...\`
5. Start the stack:
   - \`docker compose --env-file .env -f ${params.composeFileName} up -d\`
6. Open the Control UI:
   - \`http://127.0.0.1:${params.gatewayPort}/\`
7. Use the CLI sidecar for follow-up config or inspection:
   - \`docker compose --env-file .env -f ${params.composeFileName} up -d openclaw-keybase-cli\`
   - \`docker compose --env-file .env -f ${params.composeFileName} exec openclaw-keybase-cli channels status\`
   - \`docker compose --env-file .env -f ${params.composeFileName} exec openclaw-keybase-gateway keybase --home /home/node --socket-file ${DEFAULT_KEYBASE_SOCKET_FILE} whoami\`
8. Optional blackbox run with a second Keybase identity:
   - fill \`KEYBASE_TEST_USERNAME\` and either \`KEYBASE_TEST_PAPERKEY\` or \`KEYBASE_TEST_PAPERKEY_FILE\`
   - ensure that test identity is already a member of \`KEYBASE_TEST_TEAM\`
   - \`pnpm keybase:smoke:blackbox --output-dir . --team "$KEYBASE_TEST_TEAM" --bot "$KEYBASE_TEST_BOT_USERNAME"\`

## Notes

- The smoke image defaults to \`${params.platform}\` because the official Keybase Linux package is amd64-focused.
- The generated \`state/home/.openclaw/openclaw.json\` sets the default model to \`claude-cli/claude-sonnet-4-6\` and preserves \`CLAUDE_CODE_OAUTH_TOKEN\` for the Claude child process.
- Keybase persists its home under the shared \`state/home\` mount, but the service socket and pid file stay on container-local \`${DEFAULT_KEYBASE_RUNTIME_DIR}\` so Docker Desktop shared volumes do not need to carry Unix sockets.
- Start with one bot container and a real external sender. Add a second sender identity/container after the bot-side path is stable.
- The optional \`${SENDER_SERVICE}\` profile uses \`state/sender-home\`, so the test sender cannot accidentally share the bot's Keybase home.
`;
}

function renderOpenClawConfig() {
  return `${JSON.stringify(
    {
      agents: {
        defaults: {
          cliBackends: {
            "claude-cli": {
              command: "claude",
              env: {
                CLAUDE_CODE_OAUTH_TOKEN: "${CLAUDE_CODE_OAUTH_TOKEN}",
              },
            },
          },
          model: {
            primary: "claude-cli/claude-sonnet-4-6",
          },
          models: {
            "claude-cli/claude-sonnet-4-6": {
              alias: "Sonnet",
            },
          },
        },
      },
      channels: {
        keybase: {
          binary: "keybase",
          dmPolicy: "pairing",
          enabled: true,
          groupPolicy: "allowlist",
          homeDir: DEFAULT_KEYBASE_HOME,
          pidFile: DEFAULT_KEYBASE_PID_FILE,
          socketFile: DEFAULT_KEYBASE_SOCKET_FILE,
          ackReaction: ":eyes:",
        },
      },
      gateway: {
        controlUi: {
          allowInsecureAuth: true,
        },
        bind: "lan",
      },
    },
    null,
    2,
  )}\n`;
}

async function defaultRunCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<RunCommandResult> {
  return await new Promise<RunCommandResult>((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd,
        encoding: "utf8",
        env:
          command === "docker"
            ? {
                ...process.env,
                DOCKER_BUILDKIT: process.env.DOCKER_BUILDKIT?.trim() || "1",
              }
            : process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

export function resolveDefaultKeybaseDockerOutputDir(repoRoot: string) {
  return path.resolve(repoRoot, ".artifacts/keybase-docker");
}

export async function writeKeybaseDockerSmokeFiles(params: {
  gatewayPort?: number;
  imageName?: string;
  outputDir: string;
  platform?: string;
}): Promise<KeybaseDockerSmokeFilesResult> {
  const outputDir = path.resolve(params.outputDir);
  const gatewayPort = params.gatewayPort ?? DEFAULT_GATEWAY_PORT;
  const imageName = params.imageName ?? DEFAULT_IMAGE_NAME;
  const platform = params.platform ?? DEFAULT_PLATFORM;
  const stateDir = path.join(outputDir, "state");
  const homeStateDir = path.join(stateDir, "home");
  const senderHomeStateDir = path.join(stateDir, "sender-home");
  const openclawStateDir = path.join(homeStateDir, ".openclaw");
  const secretsDir = path.join(openclawStateDir, "secrets");
  const senderSecretsDir = path.join(senderHomeStateDir, ".openclaw", "secrets");
  const openclawTmpDir = path.join(openclawStateDir, "tmp");
  const senderTmpDir = path.join(senderHomeStateDir, ".openclaw", "tmp");
  const composeFile = path.join(outputDir, "docker-compose.keybase.yml");
  const envExampleFile = path.join(outputDir, ".env.example");
  const readmeFile = path.join(outputDir, "README.md");
  const configFile = path.join(openclawStateDir, "openclaw.json");
  const secretsReadmeFile = path.join(secretsDir, "README.txt");
  const senderSecretsReadmeFile = path.join(senderSecretsDir, "README.txt");

  await fs.mkdir(secretsDir, { recursive: true });
  await fs.mkdir(senderSecretsDir, { recursive: true });
  await fs.mkdir(openclawTmpDir, { recursive: true });
  await fs.mkdir(senderTmpDir, { recursive: true });
  await fs.mkdir(homeStateDir, { recursive: true });

  await fs.writeFile(composeFile, renderCompose({ gatewayPort, imageName, platform }), "utf8");
  await fs.writeFile(
    envExampleFile,
    renderEnvExample({ gatewayPort, imageName, platform }),
    "utf8",
  );
  await fs.writeFile(
    readmeFile,
    renderReadme({
      composeFileName: path.basename(composeFile),
      envExampleFileName: path.basename(envExampleFile),
      gatewayPort,
      imageName,
      platform,
    }),
    "utf8",
  );
  await fs.writeFile(configFile, renderOpenClawConfig(), "utf8");
  await fs.writeFile(
    secretsReadmeFile,
    "Place a local paper key file here and point KEYBASE_PAPERKEY_FILE at /home/node/.openclaw/secrets/keybase-paperkey.\n",
    "utf8",
  );
  await fs.writeFile(
    senderSecretsReadmeFile,
    "Place a sender paper key file here and point KEYBASE_TEST_PAPERKEY_FILE at /home/node/.openclaw/secrets/keybase-test-paperkey.\n",
    "utf8",
  );

  return {
    composeFile,
    envExampleFile,
    files: [
      composeFile,
      envExampleFile,
      readmeFile,
      configFile,
      secretsReadmeFile,
      senderSecretsReadmeFile,
      openclawTmpDir,
      senderTmpDir,
    ],
    outputDir,
    readmeFile,
  };
}

export async function buildKeybaseDockerSmokeImage(
  params: {
    baseImageName?: string;
    imageName?: string;
    platform?: string;
    repoRoot: string;
  },
  deps: {
    runCommand?: RunCommand;
  } = {},
): Promise<KeybaseDockerSmokeImageResult> {
  const repoRoot = path.resolve(params.repoRoot);
  const baseImageName = params.baseImageName ?? DEFAULT_BASE_IMAGE_NAME;
  const imageName = params.imageName ?? DEFAULT_IMAGE_NAME;
  const platform = params.platform ?? DEFAULT_PLATFORM;
  const runCommand = deps.runCommand ?? defaultRunCommand;

  await runCommand(
    "docker",
    [
      "build",
      "--platform",
      platform,
      "-t",
      baseImageName,
      "--build-arg",
      "OPENCLAW_EXTENSIONS=keybase",
      "-f",
      "Dockerfile",
      ".",
    ],
    repoRoot,
  );

  await runCommand(
    "docker",
    [
      "build",
      "--platform",
      platform,
      "-t",
      imageName,
      "--build-arg",
      `OPENCLAW_BASE_IMAGE=${baseImageName}`,
      "-f",
      "extensions/keybase/docker/Dockerfile",
      ".",
    ],
    repoRoot,
  );

  return {
    baseImageName,
    imageName,
    platform,
  };
}

type KeybaseApiEnvelope<TResult> = {
  error?: { message?: string } | null;
  result?: TResult;
};

type KeybaseConversationSummary = {
  channel?: {
    members_type?: string;
    name?: string;
  };
  id?: string;
  is_default_conv?: boolean;
};

type KeybaseMessageSummary = {
  msg?: {
    content?: {
      text?: {
        body?: string;
        replyTo?: number;
      };
      type?: string;
    };
    id?: number;
    sender?: {
      username?: string;
    };
    sent_at_ms?: number;
  };
};

function parseJsonFromCommand(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) {
    throw new Error(`Command output did not include JSON: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw.slice(start));
}

function normalizeMessageId(value: number | string | null | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return "";
}

function buildComposeArgs(params: {
  composeFile: string;
  envFile: string;
  profile?: string;
}): string[] {
  return [
    "compose",
    "--env-file",
    params.envFile,
    "-f",
    params.composeFile,
    ...(params.profile ? ["--profile", params.profile] : []),
  ];
}

async function runCompose(params: {
  args: readonly string[];
  cwd: string;
  runCommand: RunCommand;
}): Promise<RunCommandResult> {
  return await params.runCommand("docker", [...params.args], params.cwd);
}

async function runComposeExec(params: {
  command: readonly string[];
  composeFile: string;
  cwd: string;
  envFile: string;
  runCommand: RunCommand;
  service: string;
}): Promise<RunCommandResult> {
  return await runCompose({
    cwd: params.cwd,
    runCommand: params.runCommand,
    args: [
      ...buildComposeArgs({
        composeFile: params.composeFile,
        envFile: params.envFile,
      }),
      "exec",
      "-T",
      params.service,
      ...params.command,
    ],
  });
}

async function runKeybaseApiInService<TResult>(params: {
  composeFile: string;
  cwd: string;
  envFile: string;
  request: Record<string, unknown>;
  runCommand: RunCommand;
  service: string;
}): Promise<TResult> {
  const result = await runComposeExec({
    composeFile: params.composeFile,
    cwd: params.cwd,
    envFile: params.envFile,
    runCommand: params.runCommand,
    service: params.service,
    command: [
      "keybase",
      "--home",
      DEFAULT_KEYBASE_HOME,
      "--socket-file",
      DEFAULT_KEYBASE_SOCKET_FILE,
      "--pid-file",
      DEFAULT_KEYBASE_PID_FILE,
      "chat",
      "api",
      "-m",
      JSON.stringify(params.request),
    ],
  });
  const envelope = parseJsonFromCommand(result.stdout) as KeybaseApiEnvelope<TResult>;
  if (envelope.error) {
    throw new Error(envelope.error.message ?? "Keybase API request failed");
  }
  if (envelope.result === undefined) {
    throw new Error("Keybase API response did not include a result");
  }
  return envelope.result;
}

function findDefaultTeamConversationId(params: {
  conversations: readonly KeybaseConversationSummary[];
  team: string;
}): string {
  const normalizedTeam = params.team.trim().toLowerCase();
  const match = params.conversations.find(
    (conversation) =>
      conversation.channel?.name?.toLowerCase() === normalizedTeam &&
      conversation.channel?.members_type === "team" &&
      conversation.is_default_conv === true &&
      typeof conversation.id === "string" &&
      conversation.id.trim().length > 0,
  );
  if (!match?.id) {
    throw new Error(
      `Sender identity cannot see default Keybase team conversation ${params.team}; invite it to the team/channel first`,
    );
  }
  return match.id;
}

async function readChannelStatus(params: {
  composeFile: string;
  cwd: string;
  envFile: string;
  runCommand: RunCommand;
}): Promise<{
  inboundAt: number;
  lastError: string | null;
  outboundAt: number;
  running: boolean;
}> {
  const result = await runComposeExec({
    composeFile: params.composeFile,
    cwd: params.cwd,
    envFile: params.envFile,
    runCommand: params.runCommand,
    service: GATEWAY_SERVICE,
    command: ["node", "dist/index.js", "channels", "status", "--json"],
  });
  const status = parseJsonFromCommand(result.stdout) as {
    channelAccounts?: {
      keybase?: Array<{
        lastError?: string | null;
        lastInboundAt?: number | null;
        lastOutboundAt?: number | null;
        running?: boolean;
      }>;
    };
  };
  const keybase = status.channelAccounts?.keybase?.[0];
  return {
    inboundAt: keybase?.lastInboundAt ?? 0,
    lastError: keybase?.lastError ?? null,
    outboundAt: keybase?.lastOutboundAt ?? 0,
    running: keybase?.running === true,
  };
}

async function waitForServiceWhoami(params: {
  composeFile: string;
  cwd: string;
  envFile: string;
  runCommand: RunCommand;
  service: string;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + params.timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await runComposeExec({
        composeFile: params.composeFile,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
        service: params.service,
        command: [
          "keybase",
          "--home",
          DEFAULT_KEYBASE_HOME,
          "--socket-file",
          DEFAULT_KEYBASE_SOCKET_FILE,
          "--pid-file",
          DEFAULT_KEYBASE_PID_FILE,
          "whoami",
        ],
      });
      return;
    } catch (error) {
      lastError = error;
      await sleep(2000);
    }
  }
  throw new Error(`Timed out waiting for ${params.service} Keybase login: ${String(lastError)}`);
}

async function waitForBlackboxReply(params: {
  botUsername: string;
  composeFile: string;
  conversationId: string;
  cwd: string;
  envFile: string;
  runCommand: RunCommand;
  sentMessageId: string;
  startedAt: number;
  timeoutMs: number;
}): Promise<{ inboundAt: number; outboundAt: number; replyPreview: string }> {
  const deadline = Date.now() + params.timeoutMs;
  let lastStatusError: string | null = null;
  while (Date.now() < deadline) {
    let hasFreshStatus = false;
    let inboundAt = 0;
    let outboundAt = 0;
    try {
      const status = await readChannelStatus(params);
      lastStatusError = status.lastError;
      inboundAt = status.inboundAt;
      outboundAt = status.outboundAt;
      hasFreshStatus =
        status.running &&
        status.inboundAt >= params.startedAt &&
        status.outboundAt >= params.startedAt;
    } catch (error) {
      lastStatusError = String(error);
    }

    const readResult = await runKeybaseApiInService<{ messages?: KeybaseMessageSummary[] }>({
      composeFile: params.composeFile,
      cwd: params.cwd,
      envFile: params.envFile,
      runCommand: params.runCommand,
      service: SENDER_SERVICE,
      request: {
        method: "read",
        params: {
          options: {
            conversation_id: params.conversationId,
            pagination: { num: 10 },
            peek: true,
          },
        },
      },
    });
    const reply = (readResult.messages ?? []).find((entry) => {
      const msg = entry.msg;
      if (!msg) {
        return false;
      }
      const sender = msg.sender?.username?.trim().toLowerCase();
      const replyTo = msg.content?.text?.replyTo;
      return (
        sender === params.botUsername.trim().toLowerCase() &&
        (String(replyTo ?? "") === params.sentMessageId ||
          (msg.sent_at_ms ?? 0) >= params.startedAt)
      );
    });
    const replyBody = reply?.msg?.content?.text?.body?.trim();
    if (hasFreshStatus && replyBody) {
      return {
        inboundAt,
        outboundAt,
        replyPreview: replyBody.slice(0, 240),
      };
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for Keybase blackbox reply; last channel error: ${lastStatusError ?? "none"}`,
  );
}

export async function runKeybaseDockerBlackboxSmoke(
  params: {
    botUsername: string;
    composeFile?: string;
    envFile?: string;
    message?: string;
    outputDir: string;
    team: string;
    timeoutMs?: number;
  },
  deps: {
    runCommand?: RunCommand;
  } = {},
): Promise<KeybaseDockerBlackboxResult> {
  const outputDir = path.resolve(params.outputDir);
  const composeFile = path.resolve(outputDir, params.composeFile ?? "docker-compose.keybase.yml");
  const envFile = path.resolve(outputDir, params.envFile ?? ".env");
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const timeoutMs = params.timeoutMs ?? 180_000;
  const startedAt = Date.now();
  const marker = `keybase-blackbox-${startedAt}`;
  const botUsername = params.botUsername.trim();
  if (!botUsername) {
    throw new Error("Keybase blackbox bot username is required");
  }
  const team = params.team.trim();
  if (!team) {
    throw new Error("Keybase blackbox team is required");
  }

  await runCompose({
    cwd: outputDir,
    runCommand,
    args: [
      ...buildComposeArgs({ composeFile, envFile, profile: "blackbox" }),
      "up",
      "-d",
      GATEWAY_SERVICE,
      SENDER_SERVICE,
    ],
  });
  await waitForServiceWhoami({
    composeFile,
    cwd: outputDir,
    envFile,
    runCommand,
    service: GATEWAY_SERVICE,
    timeoutMs: 60_000,
  });
  await waitForServiceWhoami({
    composeFile,
    cwd: outputDir,
    envFile,
    runCommand,
    service: SENDER_SERVICE,
    timeoutMs: 60_000,
  });

  const listResult = await runKeybaseApiInService<{
    conversations?: KeybaseConversationSummary[];
  }>({
    composeFile,
    cwd: outputDir,
    envFile,
    runCommand,
    service: SENDER_SERVICE,
    request: {
      method: "list",
      params: { options: { topic_type: "CHAT" } },
    },
  });
  const conversationId = findDefaultTeamConversationId({
    conversations: listResult.conversations ?? [],
    team,
  });

  const body =
    params.message?.trim() || `@${botUsername} reply exactly: keybase blackbox smoke ok ${marker}`;
  const sendResult = await runKeybaseApiInService<{
    id?: number | string | null;
    outbox_id?: string | null;
  }>({
    composeFile,
    cwd: outputDir,
    envFile,
    runCommand,
    service: SENDER_SERVICE,
    request: {
      method: "send",
      params: {
        options: {
          conversation_id: conversationId,
          message: {
            body,
          },
        },
      },
    },
  });
  const sentMessageId = normalizeMessageId(sendResult.id ?? sendResult.outbox_id);
  if (!sentMessageId) {
    throw new Error("Keybase sender did not return a message id");
  }

  const reply = await waitForBlackboxReply({
    botUsername,
    composeFile,
    conversationId,
    cwd: outputDir,
    envFile,
    runCommand,
    sentMessageId,
    startedAt,
    timeoutMs,
  });

  return {
    botUsername,
    inboundAt: reply.inboundAt,
    marker,
    outboundAt: reply.outboundAt,
    replyPreview: reply.replyPreview,
    sentMessageId,
    team,
  };
}
