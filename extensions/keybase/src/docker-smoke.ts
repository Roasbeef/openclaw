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
const DEFAULT_BLACKBOX_ACK_REACTION = ":eyes:";
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
  "restart-resume",
];
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
9. Full QA runner:
   - \`pnpm openclaw qa keybase --output-dir . --team "$KEYBASE_TEST_TEAM" --bot "$KEYBASE_TEST_BOT_USERNAME"\`
   - covers team-channel canary reply, tagged help command, native command advertisements, chunked command delivery, DM canary reply, DM pairing challenge, mention gating, group allowlist block, restart resume, and ack reaction observation

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

type KeybaseBlackboxConversation =
  | { channel: { members_type?: string; name: string; topic_name?: string; topic_type?: string } }
  | { conversation_id: string };

type KeybaseMessageSummary = {
  msg?: {
    content?: {
      reaction?: {
        b?: string;
        body?: string;
        m?: number | string;
        message_id?: number | string;
        messageID?: number | string;
      };
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

function normalizeReactionBody(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "👀") {
    return ":eyes:";
  }
  return trimmed;
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function readTextReplyToId(message: KeybaseMessageSummary): string {
  return normalizeMessageId(message.msg?.content?.text?.replyTo);
}

function readReactionTargetId(message: KeybaseMessageSummary): string {
  const reaction = message.msg?.content?.reaction;
  return normalizeMessageId(reaction?.m ?? reaction?.messageID ?? reaction?.message_id);
}

function readReactionBody(message: KeybaseMessageSummary): string {
  const reaction = message.msg?.content?.reaction;
  return normalizeReactionBody(reaction?.b ?? reaction?.body ?? "");
}

function readMessageBody(message: KeybaseMessageSummary): string {
  return message.msg?.content?.text?.body?.trim() ?? "";
}

function readMessageSender(message: KeybaseMessageSummary): string {
  return normalizeUsername(message.msg?.sender?.username ?? "");
}

function findBotReplyToMessage(params: {
  botUsername: string;
  messages: readonly KeybaseMessageSummary[];
  sentMessageId: string;
  startedAt: number;
}): KeybaseMessageSummary | undefined {
  const normalizedBot = normalizeUsername(params.botUsername);
  const isBotText = (entry: KeybaseMessageSummary) => {
    const msg = entry.msg;
    return Boolean(
      msg && readMessageSender(entry) === normalizedBot && msg.content?.type === "text",
    );
  };
  const exactReply = params.messages.find(
    (entry) => isBotText(entry) && readTextReplyToId(entry) === params.sentMessageId,
  );
  if (exactReply) {
    return exactReply;
  }
  return params.messages.find(
    (entry) => isBotText(entry) && (entry.msg?.sent_at_ms ?? 0) >= params.startedAt,
  );
}

function findBotTextRepliesToMessage(params: {
  botUsername: string;
  messages: readonly KeybaseMessageSummary[];
  sentMessageId: string;
  startedAt: number;
}): KeybaseMessageSummary[] {
  const normalizedBot = normalizeUsername(params.botUsername);
  const exactReplies = params.messages.filter((entry) => {
    const msg = entry.msg;
    return Boolean(
      msg &&
      readMessageSender(entry) === normalizedBot &&
      msg.content?.type === "text" &&
      readTextReplyToId(entry) === params.sentMessageId,
    );
  });
  const replies =
    exactReplies.length > 0
      ? exactReplies
      : params.messages.filter((entry) => {
          const msg = entry.msg;
          return Boolean(
            msg &&
            readMessageSender(entry) === normalizedBot &&
            msg.content?.type === "text" &&
            (msg.sent_at_ms ?? 0) >= params.startedAt,
          );
        });
  return [...replies].toSorted((left, right) => {
    const sentDiff = (left.msg?.sent_at_ms ?? 0) - (right.msg?.sent_at_ms ?? 0);
    if (sentDiff !== 0) {
      return sentDiff;
    }
    return Number(normalizeMessageId(left.msg?.id)) - Number(normalizeMessageId(right.msg?.id));
  });
}

function findBotReactionToMessage(params: {
  botUsername: string;
  expectedBody?: string;
  messages: readonly KeybaseMessageSummary[];
  sentMessageId: string;
}): KeybaseMessageSummary | undefined {
  const normalizedBot = normalizeUsername(params.botUsername);
  const expectedBody = params.expectedBody ? normalizeReactionBody(params.expectedBody) : undefined;
  return params.messages.find((entry) => {
    if (
      readMessageSender(entry) !== normalizedBot ||
      entry.msg?.content?.type !== "reaction" ||
      readReactionTargetId(entry) !== params.sentMessageId
    ) {
      return false;
    }
    return !expectedBody || readReactionBody(entry) === expectedBody;
  });
}

function findBotResponseToMessage(params: {
  botUsername: string;
  messages: readonly KeybaseMessageSummary[];
  sentMessageId: string;
  startedAt: number;
}): KeybaseMessageSummary | undefined {
  return (
    findBotReplyToMessage(params) ??
    findBotReactionToMessage({
      botUsername: params.botUsername,
      messages: params.messages,
      sentMessageId: params.sentMessageId,
    })
  );
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

async function readKeybaseMessagesInSender(params: {
  conversation: KeybaseBlackboxConversation;
  composeFile: string;
  cwd: string;
  envFile: string;
  num?: number;
  runCommand: RunCommand;
}): Promise<KeybaseMessageSummary[]> {
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
          ...params.conversation,
          pagination: { num: params.num ?? 20 },
          peek: true,
        },
      },
    },
  });
  return readResult.messages ?? [];
}

function normalizeAdvertisedCommandName(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, "");
  return trimmed ? `/${trimmed.toLowerCase()}` : "";
}

function collectAdvertisedCommandNames(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectAdvertisedCommandNames(entry, names);
    }
    return names;
  }
  if (typeof value !== "object" || value === null) {
    return names;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") {
    const commandName = normalizeAdvertisedCommandName(record.name);
    if (commandName) {
      names.add(commandName);
    }
  }
  for (const nested of Object.values(record)) {
    collectAdvertisedCommandNames(nested, names);
  }
  return names;
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
  lastStartAt: number;
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
        lastStartAt?: number | null;
        running?: boolean;
      }>;
    };
  };
  const keybase = status.channelAccounts?.keybase?.[0];
  return {
    inboundAt: keybase?.lastInboundAt ?? 0,
    lastError: keybase?.lastError ?? null,
    lastStartAt: keybase?.lastStartAt ?? 0,
    outboundAt: keybase?.lastOutboundAt ?? 0,
    running: keybase?.running === true,
  };
}

async function waitForKeybaseChannelRunning(params: {
  composeFile: string;
  cwd: string;
  envFile: string;
  minLastStartAt?: number;
  runCommand: RunCommand;
  settleMs?: number;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + params.timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const status = await readChannelStatus(params);
      if (
        status.running &&
        (!params.minLastStartAt || status.lastStartAt >= params.minLastStartAt)
      ) {
        await sleep(params.settleMs ?? 500);
        return;
      }
      lastError = status.lastError ?? "channel is not running yet";
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for Keybase channel to run: ${String(lastError)}`);
}

async function waitForServiceWhoami(params: {
  composeFile: string;
  cwd: string;
  envFile: string;
  runCommand: RunCommand;
  service: string;
  timeoutMs: number;
}): Promise<string> {
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
        command: ["test", "-S", DEFAULT_KEYBASE_SOCKET_FILE],
      });
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
          "whoami",
        ],
      });
      const username = result.stdout
        .split(/\r?\n/)
        .toReversed()
        .find((line) => line.trim().length > 0)
        ?.trim();
      if (!username) {
        throw new Error("keybase whoami did not return a username");
      }
      return username;
    } catch (error) {
      lastError = error;
      await sleep(2000);
    }
  }
  throw new Error(`Timed out waiting for ${params.service} Keybase login: ${String(lastError)}`);
}

async function waitForBlackboxReply(params: {
  botUsername: string;
  conversation: KeybaseBlackboxConversation;
  composeFile: string;
  cwd: string;
  envFile: string;
  expectedAckReaction?: string | false;
  runCommand: RunCommand;
  sentMessageId: string;
  startedAt: number;
  timeoutMs: number;
}): Promise<{
  ackReactionBody?: string;
  ackReactionMessageId?: string;
  inboundAt: number;
  outboundAt: number;
  replyBody: string;
  replyMessageId: string;
  replyPreview: string;
}> {
  const deadline = Date.now() + params.timeoutMs;
  let lastStatusError: string | null = null;
  let lastReadError: string | null = null;
  const expectedAckReaction =
    params.expectedAckReaction === false
      ? undefined
      : normalizeReactionBody(params.expectedAckReaction ?? DEFAULT_BLACKBOX_ACK_REACTION);
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

    let messages: KeybaseMessageSummary[];
    try {
      messages = await readKeybaseMessagesInSender({
        composeFile: params.composeFile,
        conversation: params.conversation,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
      });
      lastReadError = null;
    } catch (error) {
      lastReadError = formatUnknownError(error);
      await sleep(3000);
      continue;
    }
    const reply = findBotReplyToMessage({
      botUsername: params.botUsername,
      messages,
      sentMessageId: params.sentMessageId,
      startedAt: params.startedAt,
    });
    const reaction = expectedAckReaction
      ? findBotReactionToMessage({
          botUsername: params.botUsername,
          expectedBody: expectedAckReaction,
          messages,
          sentMessageId: params.sentMessageId,
        })
      : undefined;
    const replyBody = reply ? readMessageBody(reply) : "";
    if (reply && hasFreshStatus && replyBody && (!expectedAckReaction || reaction)) {
      const reactionBody = reaction ? readReactionBody(reaction) : undefined;
      const reactionMessageId = normalizeMessageId(reaction?.msg?.id);
      return {
        ...(reactionBody ? { ackReactionBody: reactionBody } : {}),
        ...(reactionMessageId ? { ackReactionMessageId: reactionMessageId } : {}),
        inboundAt,
        outboundAt,
        replyBody,
        replyMessageId: normalizeMessageId(reply.msg?.id),
        replyPreview: replyBody.slice(0, 240),
      };
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for Keybase blackbox reply; last channel error: ${
      lastStatusError ?? "none"
    }; last sender read error: ${lastReadError ?? "none"}`,
  );
}

async function waitForBotTextContaining(params: {
  botUsername: string;
  conversation: KeybaseBlackboxConversation;
  composeFile: string;
  cwd: string;
  envFile: string;
  excludeMessageIds?: readonly string[];
  runCommand: RunCommand;
  startedAt: number;
  text: string;
  timeoutMs: number;
}): Promise<{
  replyBody: string;
  replyMessageId: string;
  replyPreview: string;
}> {
  const deadline = Date.now() + params.timeoutMs;
  const normalizedBot = normalizeUsername(params.botUsername);
  const excluded = new Set((params.excludeMessageIds ?? []).map(normalizeMessageId));
  let lastReadError: string | null = null;
  while (Date.now() < deadline) {
    let messages: KeybaseMessageSummary[];
    try {
      messages = await readKeybaseMessagesInSender({
        composeFile: params.composeFile,
        conversation: params.conversation,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
      });
      lastReadError = null;
    } catch (error) {
      lastReadError = formatUnknownError(error);
      await sleep(3000);
      continue;
    }
    const match = messages.find((entry) => {
      const msg = entry.msg;
      const messageId = normalizeMessageId(msg?.id);
      return Boolean(
        msg &&
        readMessageSender(entry) === normalizedBot &&
        msg.content?.type === "text" &&
        !excluded.has(messageId) &&
        (msg.sent_at_ms ?? 0) >= params.startedAt &&
        readMessageBody(entry).includes(params.text),
      );
    });
    if (match) {
      const replyBody = readMessageBody(match);
      return {
        replyBody,
        replyMessageId: normalizeMessageId(match.msg?.id),
        replyPreview: replyBody.slice(0, 240),
      };
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for Keybase bot text containing "${params.text}"; last sender read error: ${
      lastReadError ?? "none"
    }`,
  );
}

async function waitForChunkedBotReply(params: {
  botUsername: string;
  composeFile: string;
  conversation: KeybaseBlackboxConversation;
  cwd: string;
  envFile: string;
  expectedAckReaction?: string | false;
  expectedFragments: readonly string[];
  minChunks: number;
  runCommand: RunCommand;
  sentMessageId: string;
  startedAt: number;
  timeoutMs: number;
}): Promise<{
  ackReactionBody?: string;
  ackReactionMessageId?: string;
  chunkCount: number;
  chunkMessageIds: string[];
  combinedPreview: string;
  inboundAt: number;
  outboundAt: number;
}> {
  const deadline = Date.now() + params.timeoutMs;
  let lastStatusError: string | null = null;
  let lastReadError: string | null = null;
  const expectedAckReaction =
    params.expectedAckReaction === false
      ? undefined
      : normalizeReactionBody(params.expectedAckReaction ?? DEFAULT_BLACKBOX_ACK_REACTION);
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

    let messages: KeybaseMessageSummary[];
    try {
      messages = await readKeybaseMessagesInSender({
        composeFile: params.composeFile,
        conversation: params.conversation,
        cwd: params.cwd,
        envFile: params.envFile,
        num: 50,
        runCommand: params.runCommand,
      });
      lastReadError = null;
    } catch (error) {
      lastReadError = formatUnknownError(error);
      await sleep(3000);
      continue;
    }
    const replies = findBotTextRepliesToMessage({
      botUsername: params.botUsername,
      messages,
      sentMessageId: params.sentMessageId,
      startedAt: params.startedAt,
    });
    const reaction = expectedAckReaction
      ? findBotReactionToMessage({
          botUsername: params.botUsername,
          expectedBody: expectedAckReaction,
          messages,
          sentMessageId: params.sentMessageId,
        })
      : undefined;
    const combined = replies.map((reply) => readMessageBody(reply)).join("\n");
    const includesExpectedFragments = params.expectedFragments.every((fragment) =>
      combined.includes(fragment),
    );
    if (
      hasFreshStatus &&
      replies.length >= params.minChunks &&
      includesExpectedFragments &&
      (!expectedAckReaction || reaction)
    ) {
      const reactionBody = reaction ? readReactionBody(reaction) : undefined;
      const reactionMessageId = normalizeMessageId(reaction?.msg?.id);
      return {
        ...(reactionBody ? { ackReactionBody: reactionBody } : {}),
        ...(reactionMessageId ? { ackReactionMessageId: reactionMessageId } : {}),
        chunkCount: replies.length,
        chunkMessageIds: replies.map((reply) => normalizeMessageId(reply.msg?.id)).filter(Boolean),
        combinedPreview: combined.slice(0, 240),
        inboundAt,
        outboundAt,
      };
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for chunked Keybase bot reply; last channel error: ${
      lastStatusError ?? "none"
    }; last sender read error: ${lastReadError ?? "none"}`,
  );
}

async function waitForNoAdditionalBotTextReply(params: {
  allowedReplyMessageId: string;
  botUsername: string;
  conversation: KeybaseBlackboxConversation;
  composeFile: string;
  cwd: string;
  envFile: string;
  quietMs: number;
  runCommand: RunCommand;
  sentMessageId: string;
  startedAt: number;
}): Promise<void> {
  await sleep(Math.max(0, params.quietMs));
  let messages: KeybaseMessageSummary[] = [];
  let lastReadError: string | null = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      messages = await readKeybaseMessagesInSender({
        composeFile: params.composeFile,
        conversation: params.conversation,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
      });
      lastReadError = null;
      break;
    } catch (error) {
      lastReadError = formatUnknownError(error);
      await sleep(3000);
    }
  }
  if (lastReadError) {
    throw new Error(
      `Timed out checking for extra Keybase bot replies; last sender read error: ${lastReadError}`,
    );
  }
  const normalizedBot = normalizeUsername(params.botUsername);
  const extraReply = messages.find((entry) => {
    const msg = entry.msg;
    return Boolean(
      msg &&
      readMessageSender(entry) === normalizedBot &&
      msg.content?.type === "text" &&
      readTextReplyToId(entry) === params.sentMessageId &&
      normalizeMessageId(msg.id) !== params.allowedReplyMessageId &&
      (msg.sent_at_ms ?? 0) >= params.startedAt,
    );
  });
  if (extraReply) {
    throw new Error(
      `Expected only one Keybase bot text reply to ${params.sentMessageId}, but observed extra message ${normalizeMessageId(extraReply.msg?.id)}`,
    );
  }
}

async function waitForNoBotResponse(params: {
  botUsername: string;
  conversation: KeybaseBlackboxConversation;
  composeFile: string;
  cwd: string;
  envFile: string;
  quietMs: number;
  runCommand: RunCommand;
  sentMessageId: string;
  startedAt: number;
}): Promise<void> {
  const deadline = Date.now() + params.quietMs;
  let sawSuccessfulRead = false;
  let lastReadError: string | null = null;
  while (Date.now() < deadline) {
    let messages: KeybaseMessageSummary[];
    try {
      messages = await readKeybaseMessagesInSender({
        composeFile: params.composeFile,
        conversation: params.conversation,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
      });
      sawSuccessfulRead = true;
      lastReadError = null;
    } catch (error) {
      lastReadError = formatUnknownError(error);
      await sleep(Math.min(3000, Math.max(250, params.quietMs)));
      continue;
    }
    const response = findBotResponseToMessage({
      botUsername: params.botUsername,
      messages,
      sentMessageId: params.sentMessageId,
      startedAt: params.startedAt,
    });
    if (response) {
      throw new Error(
        `Expected no Keybase bot response to ${params.sentMessageId}, but observed message ${normalizeMessageId(response.msg?.id)}`,
      );
    }
    await sleep(Math.min(3000, Math.max(250, params.quietMs)));
  }
  if (!sawSuccessfulRead && lastReadError) {
    throw new Error(
      `Timed out checking for absent Keybase bot response; last sender read error: ${lastReadError}`,
    );
  }
}

type KeybaseBlackboxContext = {
  botUsername: string;
  composeFile: string;
  conversationId: string;
  envFile: string;
  outputDir: string;
  runCommand: RunCommand;
  senderUsername: string;
  team: string;
};

function resolveKeybaseBlackboxPaths(params: {
  composeFile?: string;
  envFile?: string;
  outputDir: string;
  runCommand?: RunCommand;
}): Pick<KeybaseBlackboxContext, "composeFile" | "envFile" | "outputDir" | "runCommand"> {
  const outputDir = path.resolve(params.outputDir);
  const composeFile = path.resolve(outputDir, params.composeFile ?? "docker-compose.keybase.yml");
  const envFile = path.resolve(outputDir, params.envFile ?? ".env");
  const runCommand = params.runCommand ?? defaultRunCommand;
  return { composeFile, envFile, outputDir, runCommand };
}

async function prepareKeybaseBlackboxContext(params: {
  botUsername: string;
  composeFile?: string;
  envFile?: string;
  outputDir: string;
  runCommand?: RunCommand;
  team: string;
}): Promise<KeybaseBlackboxContext> {
  const paths = resolveKeybaseBlackboxPaths(params);
  const botUsername = params.botUsername.trim();
  if (!botUsername) {
    throw new Error("Keybase blackbox bot username is required");
  }
  const team = params.team.trim();
  if (!team) {
    throw new Error("Keybase blackbox team is required");
  }
  await ensureBaseQaConfig({
    outputDir: paths.outputDir,
    team,
  });

  await runCompose({
    cwd: paths.outputDir,
    runCommand: paths.runCommand,
    args: [
      ...buildComposeArgs({
        composeFile: paths.composeFile,
        envFile: paths.envFile,
        profile: "blackbox",
      }),
      "up",
      "-d",
      GATEWAY_SERVICE,
      SENDER_SERVICE,
    ],
  });
  await waitForServiceWhoami({
    composeFile: paths.composeFile,
    cwd: paths.outputDir,
    envFile: paths.envFile,
    runCommand: paths.runCommand,
    service: GATEWAY_SERVICE,
    timeoutMs: 150_000,
  });
  const senderUsername = await waitForServiceWhoami({
    composeFile: paths.composeFile,
    cwd: paths.outputDir,
    envFile: paths.envFile,
    runCommand: paths.runCommand,
    service: SENDER_SERVICE,
    timeoutMs: 90_000,
  });
  await waitForKeybaseChannelRunning({
    composeFile: paths.composeFile,
    cwd: paths.outputDir,
    envFile: paths.envFile,
    runCommand: paths.runCommand,
    timeoutMs: 90_000,
  });

  const listResult = await runKeybaseApiInService<{
    conversations?: KeybaseConversationSummary[];
  }>({
    composeFile: paths.composeFile,
    cwd: paths.outputDir,
    envFile: paths.envFile,
    runCommand: paths.runCommand,
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
  return {
    ...paths,
    botUsername,
    conversationId,
    senderUsername: normalizeUsername(senderUsername),
    team,
  };
}

async function sendKeybaseBlackboxMessage(params: {
  body: string;
  conversation?: KeybaseBlackboxConversation;
  context: KeybaseBlackboxContext;
}): Promise<string> {
  const sendResult = await runKeybaseApiInService<{
    id?: number | string | null;
    outbox_id?: string | null;
  }>({
    composeFile: params.context.composeFile,
    cwd: params.context.outputDir,
    envFile: params.context.envFile,
    runCommand: params.context.runCommand,
    service: SENDER_SERVICE,
    request: {
      method: "send",
      params: {
        options: {
          ...(params.conversation ?? { conversation_id: params.context.conversationId }),
          message: {
            body: params.body,
          },
        },
      },
    },
  });
  const sentMessageId = normalizeMessageId(sendResult.id ?? sendResult.outbox_id);
  if (!sentMessageId) {
    throw new Error("Keybase sender did not return a message id");
  }
  return sentMessageId;
}

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

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOrCreateJsonObject(parent: JsonObject, key: string): JsonObject {
  const existing = parent[key];
  if (isJsonObject(existing)) {
    return existing;
  }
  const next: JsonObject = {};
  parent[key] = next;
  return next;
}

async function readJsonObjectFile(filePath: string): Promise<JsonObject> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  if (!isJsonObject(raw)) {
    throw new Error(`${filePath} did not contain a JSON object`);
  }
  return raw;
}

async function writeJsonObjectFile(filePath: string, value: JsonObject): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function keybaseConfigPath(outputDir: string): string {
  return path.join(outputDir, "state", "home", ".openclaw", "openclaw.json");
}

function keybasePairingStorePath(outputDir: string): string {
  return path.join(outputDir, "state", "home", ".openclaw", "credentials", "keybase-pairing.json");
}

async function installBlockedGroupAllowlist(
  context: KeybaseBlackboxContext,
): Promise<() => Promise<void>> {
  const configFile = keybaseConfigPath(context.outputDir);
  const config = await readJsonObjectFile(configFile);
  const channels = getOrCreateJsonObject(config, "channels");
  const keybase = getOrCreateJsonObject(channels, "keybase");
  const groups = getOrCreateJsonObject(keybase, "groups");
  const groupKey = `team:${context.team.toLowerCase()}#general`;
  const hadPrevious = Object.hasOwn(groups, groupKey);
  const previous = groups[groupKey];
  const current = isJsonObject(previous) ? { ...previous } : {};
  groups[groupKey] = {
    ...current,
    allowFrom: ["__openclaw_qa_blocked_sender__"],
    requireMention: true,
  };
  await writeJsonObjectFile(configFile, config);

  return async () => {
    const next = await readJsonObjectFile(configFile);
    const nextChannels = getOrCreateJsonObject(next, "channels");
    const nextKeybase = getOrCreateJsonObject(nextChannels, "keybase");
    const nextGroups = getOrCreateJsonObject(nextKeybase, "groups");
    if (hadPrevious) {
      nextGroups[groupKey] = previous;
    } else {
      delete nextGroups[groupKey];
    }
    await writeJsonObjectFile(configFile, next);
  };
}

async function installAllowedGroupSender(
  context: KeybaseBlackboxContext,
): Promise<() => Promise<void>> {
  const configFile = keybaseConfigPath(context.outputDir);
  const config = await readJsonObjectFile(configFile);
  const channels = getOrCreateJsonObject(config, "channels");
  const keybase = getOrCreateJsonObject(channels, "keybase");
  const groups = getOrCreateJsonObject(keybase, "groups");
  const groupKey = `team:${context.team.toLowerCase()}#general`;
  const hadPrevious = Object.hasOwn(groups, groupKey);
  const previous = groups[groupKey];
  const current = isJsonObject(previous) ? { ...previous } : {};
  groups[groupKey] = {
    ...current,
    allowFrom: [context.senderUsername],
    requireMention: true,
  };
  await writeJsonObjectFile(configFile, config);

  return async () => {
    const next = await readJsonObjectFile(configFile);
    const nextChannels = getOrCreateJsonObject(next, "channels");
    const nextKeybase = getOrCreateJsonObject(nextChannels, "keybase");
    const nextGroups = getOrCreateJsonObject(nextKeybase, "groups");
    if (hadPrevious) {
      nextGroups[groupKey] = previous;
    } else {
      delete nextGroups[groupKey];
    }
    await writeJsonObjectFile(configFile, next);
  };
}

async function installTextChunkLimit(
  context: KeybaseBlackboxContext,
  limit: number,
): Promise<() => Promise<void>> {
  const configFile = keybaseConfigPath(context.outputDir);
  const config = await readJsonObjectFile(configFile);
  const channels = getOrCreateJsonObject(config, "channels");
  const keybase = getOrCreateJsonObject(channels, "keybase");
  const hadPrevious = Object.hasOwn(keybase, "textChunkLimit");
  const previous = keybase.textChunkLimit;
  keybase.textChunkLimit = limit;
  await writeJsonObjectFile(configFile, config);

  return async () => {
    const next = await readJsonObjectFile(configFile);
    const nextChannels = getOrCreateJsonObject(next, "channels");
    const nextKeybase = getOrCreateJsonObject(nextChannels, "keybase");
    if (hadPrevious) {
      nextKeybase.textChunkLimit = previous;
    } else {
      delete nextKeybase.textChunkLimit;
    }
    await writeJsonObjectFile(configFile, next);
  };
}

async function ensureBaseQaConfig(params: { outputDir: string; team: string }): Promise<void> {
  const configFile = keybaseConfigPath(params.outputDir);
  await fs.rm(keybasePairingStorePath(params.outputDir), { force: true });
  const config = await readJsonObjectFile(configFile);
  const channels = getOrCreateJsonObject(config, "channels");
  const keybase = getOrCreateJsonObject(channels, "keybase");
  keybase.dmPolicy = "pairing";
  keybase.allowFrom = [];
  const groups = getOrCreateJsonObject(keybase, "groups");
  const groupKey = `team:${params.team.toLowerCase()}#general`;
  const current = isJsonObject(groups[groupKey]) ? { ...groups[groupKey] } : {};
  groups[groupKey] = {
    ...current,
    requireMention: true,
  };
  await writeJsonObjectFile(configFile, config);
}

async function installDmPolicy(
  context: KeybaseBlackboxContext,
  params: {
    allowFrom?: string[];
    dmPolicy: "allowlist" | "pairing";
  },
): Promise<() => Promise<void>> {
  const configFile = keybaseConfigPath(context.outputDir);
  const config = await readJsonObjectFile(configFile);
  const channels = getOrCreateJsonObject(config, "channels");
  const keybase = getOrCreateJsonObject(channels, "keybase");
  const hadDmPolicy = Object.hasOwn(keybase, "dmPolicy");
  const previousDmPolicy = keybase.dmPolicy;
  const hadAllowFrom = Object.hasOwn(keybase, "allowFrom");
  const previousAllowFrom = keybase.allowFrom;
  keybase.dmPolicy = params.dmPolicy;
  keybase.allowFrom = params.allowFrom ?? [];
  await writeJsonObjectFile(configFile, config);

  return async () => {
    const next = await readJsonObjectFile(configFile);
    const nextChannels = getOrCreateJsonObject(next, "channels");
    const nextKeybase = getOrCreateJsonObject(nextChannels, "keybase");
    if (hadDmPolicy) {
      nextKeybase.dmPolicy = previousDmPolicy;
    } else {
      delete nextKeybase.dmPolicy;
    }
    if (hadAllowFrom) {
      nextKeybase.allowFrom = previousAllowFrom;
    } else {
      delete nextKeybase.allowFrom;
    }
    await writeJsonObjectFile(configFile, next);
  };
}

async function restartKeybaseGateway(context: KeybaseBlackboxContext): Promise<void> {
  const restartedAt = Date.now();
  const composeArgs = buildComposeArgs({
    composeFile: context.composeFile,
    envFile: context.envFile,
    profile: "blackbox",
  });
  await runCompose({
    cwd: context.outputDir,
    runCommand: context.runCommand,
    args: [...composeArgs, "stop", GATEWAY_SERVICE],
  });
  await runCompose({
    cwd: context.outputDir,
    runCommand: context.runCommand,
    args: [...composeArgs, "rm", "-f", GATEWAY_SERVICE],
  });
  await runCompose({
    cwd: context.outputDir,
    runCommand: context.runCommand,
    args: [...composeArgs, "up", "-d", GATEWAY_SERVICE],
  });
  await waitForServiceWhoami({
    composeFile: context.composeFile,
    cwd: context.outputDir,
    envFile: context.envFile,
    runCommand: context.runCommand,
    service: GATEWAY_SERVICE,
    timeoutMs: 150_000,
  });
  await waitForKeybaseChannelRunning({
    composeFile: context.composeFile,
    cwd: context.outputDir,
    envFile: context.envFile,
    minLastStartAt: restartedAt,
    runCommand: context.runCommand,
    settleMs: 5_000,
    timeoutMs: 90_000,
  });
}

function buildDirectConversation(botUsername: string): KeybaseBlackboxConversation {
  return {
    channel: {
      name: normalizeUsername(botUsername),
    },
  };
}

async function runMentionReplyProbe(params: {
  context: KeybaseBlackboxContext;
  expectedAckReaction?: string | false;
  marker: string;
  prefix: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const body = `@${params.context.botUsername} reply exactly: ${params.prefix} ${params.marker}`;
  const sentMessageId = await sendKeybaseBlackboxMessage({
    body,
    context: params.context,
  });
  const reply = await waitForBlackboxReply({
    botUsername: params.context.botUsername,
    composeFile: params.context.composeFile,
    conversation: { conversation_id: params.context.conversationId },
    cwd: params.context.outputDir,
    envFile: params.context.envFile,
    expectedAckReaction: params.expectedAckReaction ?? DEFAULT_BLACKBOX_ACK_REACTION,
    runCommand: params.context.runCommand,
    sentMessageId,
    startedAt,
    timeoutMs: params.timeoutMs,
  });
  return {
    ...(reply.ackReactionBody ? { ackReactionBody: reply.ackReactionBody } : {}),
    ...(reply.ackReactionMessageId ? { ackReactionMessageId: reply.ackReactionMessageId } : {}),
    inboundAt: reply.inboundAt,
    outboundAt: reply.outboundAt,
    replyPreview: reply.replyPreview,
    sentMessageId,
  };
}

async function runMentionGatingProbe(params: {
  context: KeybaseBlackboxContext;
  marker: string;
  quietMs: number;
}): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const sentMessageId = await sendKeybaseBlackboxMessage({
    body: `keybase mention gate should not reply ${params.marker}`,
    context: params.context,
  });
  await waitForNoBotResponse({
    botUsername: params.context.botUsername,
    composeFile: params.context.composeFile,
    conversation: { conversation_id: params.context.conversationId },
    cwd: params.context.outputDir,
    envFile: params.context.envFile,
    quietMs: params.quietMs,
    runCommand: params.context.runCommand,
    sentMessageId,
    startedAt,
  });
  return {
    quietMs: params.quietMs,
    sentMessageId,
  };
}

async function runHelpCommandProbe(params: {
  context: KeybaseBlackboxContext;
  quietMs: number;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const restoreConfig = await installAllowedGroupSender(params.context);
  try {
    await restartKeybaseGateway(params.context);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `@${params.context.botUsername} /help`,
      context: params.context,
    });
    const reply = await waitForBlackboxReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      expectedAckReaction: DEFAULT_BLACKBOX_ACK_REACTION,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    });
    if (!reply.replyBody.includes("/commands for full list")) {
      throw new Error(`Unexpected /help reply: ${reply.replyBody}`);
    }
    await waitForNoAdditionalBotTextReply({
      allowedReplyMessageId: reply.replyMessageId,
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      quietMs: params.quietMs,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
    });
    return {
      ...(reply.ackReactionBody ? { ackReactionBody: reply.ackReactionBody } : {}),
      ...(reply.ackReactionMessageId ? { ackReactionMessageId: reply.ackReactionMessageId } : {}),
      inboundAt: reply.inboundAt,
      outboundAt: reply.outboundAt,
      replyPreview: reply.replyPreview,
      sentMessageId,
    };
  } finally {
    await restoreConfig();
    await restartKeybaseGateway(params.context);
  }
}

async function waitForKeybaseCommandAdvertisements(params: {
  context: KeybaseBlackboxContext;
  expectedCommands: readonly string[];
  timeoutMs: number;
}): Promise<{ commandCount: number; commands: string[] }> {
  const expected = params.expectedCommands.map(normalizeAdvertisedCommandName);
  const deadline = Date.now() + params.timeoutMs;
  let observed: string[] = [];
  while (Date.now() < deadline) {
    const result = await runKeybaseApiInService<unknown>({
      composeFile: params.context.composeFile,
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      runCommand: params.context.runCommand,
      service: SENDER_SERVICE,
      request: {
        method: "listcommands",
        params: {
          options: {
            conversation_id: params.context.conversationId,
          },
        },
      },
    });
    observed = [...collectAdvertisedCommandNames(result)].toSorted();
    if (expected.every((command) => observed.includes(command))) {
      return {
        commandCount: observed.length,
        commands: observed,
      };
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for Keybase command advertisements; observed: ${observed.join(", ") || "none"}`,
  );
}

async function runCommandAdvertisementProbe(params: {
  context: KeybaseBlackboxContext;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const result = await waitForKeybaseCommandAdvertisements({
    context: params.context,
    expectedCommands: ["/help", "/status", "/commands", "/subagents"],
    timeoutMs: params.timeoutMs,
  });
  return {
    commandCount: result.commandCount,
    observedCommands: result.commands.filter((command) =>
      ["/commands", "/help", "/status", "/subagents"].includes(command),
    ),
  };
}

async function runSubagentsListProbe(params: {
  context: KeybaseBlackboxContext;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const restoreConfig = await installAllowedGroupSender(params.context);
  try {
    await restartKeybaseGateway(params.context);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `@${params.context.botUsername} /subagents list`,
      context: params.context,
    });
    const reply = await waitForBlackboxReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      expectedAckReaction: DEFAULT_BLACKBOX_ACK_REACTION,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    });
    if (!reply.replyBody.includes("active subagents:")) {
      throw new Error(`Unexpected /subagents list reply: ${reply.replyBody}`);
    }
    return {
      ...(reply.ackReactionBody ? { ackReactionBody: reply.ackReactionBody } : {}),
      ...(reply.ackReactionMessageId ? { ackReactionMessageId: reply.ackReactionMessageId } : {}),
      inboundAt: reply.inboundAt,
      outboundAt: reply.outboundAt,
      replyPreview: reply.replyPreview,
      sentMessageId,
    };
  } finally {
    await restoreConfig();
    await restartKeybaseGateway(params.context);
  }
}

async function runSubagentsSpawnProbe(params: {
  context: KeybaseBlackboxContext;
  marker: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const restoreConfig = await installAllowedGroupSender(params.context);
  try {
    await restartKeybaseGateway(params.context);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `@${params.context.botUsername} /subagents spawn main reply exactly: ${params.marker}`,
      context: params.context,
    });
    const ackReply = await waitForBlackboxReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      expectedAckReaction: DEFAULT_BLACKBOX_ACK_REACTION,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    });
    if (!ackReply.replyBody.includes("Spawned subagent main")) {
      throw new Error(`Unexpected /subagents spawn reply: ${ackReply.replyBody}`);
    }
    const completionReply = await waitForBotTextContaining({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      excludeMessageIds: [ackReply.replyMessageId],
      runCommand: params.context.runCommand,
      startedAt,
      text: params.marker,
      timeoutMs: params.timeoutMs,
    });
    return {
      ...(ackReply.ackReactionBody ? { ackReactionBody: ackReply.ackReactionBody } : {}),
      ...(ackReply.ackReactionMessageId
        ? { ackReactionMessageId: ackReply.ackReactionMessageId }
        : {}),
      completionMessageId: completionReply.replyMessageId,
      completionPreview: completionReply.replyPreview,
      inboundAt: ackReply.inboundAt,
      outboundAt: ackReply.outboundAt,
      replyPreview: ackReply.replyPreview,
      sentMessageId,
    };
  } finally {
    await restoreConfig();
    await restartKeybaseGateway(params.context);
  }
}

async function runChunkedCommandsProbe(params: {
  context: KeybaseBlackboxContext;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const restoreSender = await installAllowedGroupSender(params.context);
  const restoreChunkLimit = await installTextChunkLimit(params.context, 160);
  try {
    await restartKeybaseGateway(params.context);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `@${params.context.botUsername} /commands`,
      context: params.context,
    });
    const reply = await waitForChunkedBotReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      expectedAckReaction: DEFAULT_BLACKBOX_ACK_REACTION,
      expectedFragments: ["/help", "/status"],
      minChunks: 2,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    });
    return {
      ...(reply.ackReactionBody ? { ackReactionBody: reply.ackReactionBody } : {}),
      ...(reply.ackReactionMessageId ? { ackReactionMessageId: reply.ackReactionMessageId } : {}),
      chunkCount: reply.chunkCount,
      chunkMessageIds: reply.chunkMessageIds,
      inboundAt: reply.inboundAt,
      outboundAt: reply.outboundAt,
      replyPreview: reply.combinedPreview,
      sentMessageId,
    };
  } finally {
    await restoreChunkLimit();
    await restoreSender();
    await restartKeybaseGateway(params.context);
  }
}

async function runAllowlistBlockProbe(params: {
  context: KeybaseBlackboxContext;
  marker: string;
  quietMs: number;
}): Promise<Record<string, unknown>> {
  const restoreConfig = await installBlockedGroupAllowlist(params.context);
  try {
    await restartKeybaseGateway(params.context);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `@${params.context.botUsername} keybase allowlist block should not reply ${params.marker}`,
      context: params.context,
    });
    await waitForNoBotResponse({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation: { conversation_id: params.context.conversationId },
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      quietMs: params.quietMs,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
    });
    return {
      quietMs: params.quietMs,
      sentMessageId,
    };
  } finally {
    await restoreConfig();
    await restartKeybaseGateway(params.context);
  }
}

async function runDirectMessageReplyProbe(params: {
  context: KeybaseBlackboxContext;
  marker: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const restoreConfig = await installDmPolicy(params.context, {
    dmPolicy: "allowlist",
    allowFrom: [params.context.senderUsername],
  });
  try {
    await restartKeybaseGateway(params.context);
    const conversation = buildDirectConversation(params.context.botUsername);
    const startedAt = Date.now();
    const sentMessageId = await sendKeybaseBlackboxMessage({
      body: `reply exactly: keybase dm canary ok ${params.marker}`,
      context: params.context,
      conversation,
    });
    const reply = await waitForBlackboxReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation,
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      expectedAckReaction: false,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    });
    return {
      ...(reply.ackReactionBody ? { ackReactionBody: reply.ackReactionBody } : {}),
      ...(reply.ackReactionMessageId ? { ackReactionMessageId: reply.ackReactionMessageId } : {}),
      inboundAt: reply.inboundAt,
      outboundAt: reply.outboundAt,
      replyPreview: reply.replyPreview,
      senderUsername: params.context.senderUsername,
      sentMessageId,
    };
  } finally {
    await restoreConfig();
  }
}

async function waitForPairingChallengeReply(params: {
  botUsername: string;
  composeFile: string;
  conversation: KeybaseBlackboxConversation;
  cwd: string;
  envFile: string;
  runCommand: RunCommand;
  sentMessageId: string;
  startedAt: number;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const deadline = Date.now() + params.timeoutMs;
  let lastReadError: string | null = null;
  while (Date.now() < deadline) {
    let messages: KeybaseMessageSummary[];
    try {
      messages = await readKeybaseMessagesInSender({
        composeFile: params.composeFile,
        conversation: params.conversation,
        cwd: params.cwd,
        envFile: params.envFile,
        runCommand: params.runCommand,
      });
      lastReadError = null;
    } catch (error) {
      lastReadError = formatUnknownError(error);
      await sleep(3000);
      continue;
    }
    const reply = findBotReplyToMessage({
      botUsername: params.botUsername,
      messages,
      sentMessageId: params.sentMessageId,
      startedAt: params.startedAt,
    });
    const replyBody = reply ? readMessageBody(reply) : "";
    if (/pairing code:/i.test(replyBody)) {
      return {
        replyMessageId: normalizeMessageId(reply?.msg?.id),
        replyPreview: replyBody.slice(0, 240),
        sentMessageId: params.sentMessageId,
      };
    }
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for Keybase DM pairing challenge reply; last sender read error: ${
      lastReadError ?? "none"
    }`,
  );
}

async function runDirectMessagePairingProbe(params: {
  context: KeybaseBlackboxContext;
  marker: string;
  timeoutMs: number;
}): Promise<Record<string, unknown>> {
  const conversation = buildDirectConversation(params.context.botUsername);
  const startedAt = Date.now();
  const sentMessageId = await sendKeybaseBlackboxMessage({
    body: `keybase dm pairing challenge ${params.marker}`,
    context: params.context,
    conversation,
  });
  return {
    ...(await waitForPairingChallengeReply({
      botUsername: params.context.botUsername,
      composeFile: params.context.composeFile,
      conversation,
      cwd: params.context.outputDir,
      envFile: params.context.envFile,
      runCommand: params.context.runCommand,
      sentMessageId,
      startedAt,
      timeoutMs: params.timeoutMs,
    })),
    senderUsername: params.context.senderUsername,
  };
}

function normalizeKeybaseBlackboxScenarioIds(
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

function renderKeybaseBlackboxSummary(
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
