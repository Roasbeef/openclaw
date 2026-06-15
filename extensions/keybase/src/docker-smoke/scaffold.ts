import fs from "node:fs/promises";
import path from "node:path";

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

export const DEFAULT_GATEWAY_PORT = 18789;
export const DEFAULT_IMAGE_NAME = "openclaw:keybase-local";
export const DEFAULT_BASE_IMAGE_NAME = "openclaw:keybase-base-local";
export const DEFAULT_KEYBASE_HOME = "/home/node";
export const DEFAULT_KEYBASE_RUNTIME_DIR = "/tmp/openclaw-keybase";
export const DEFAULT_KEYBASE_PID_FILE = `${DEFAULT_KEYBASE_RUNTIME_DIR}/keybased.pid`;
export const DEFAULT_KEYBASE_SOCKET_FILE = `${DEFAULT_KEYBASE_RUNTIME_DIR}/keybased.sock`;
export const DEFAULT_OPENCLAW_HOME = "/home/node/.openclaw";
export const DEFAULT_OPENCLAW_TMPDIR = `${DEFAULT_OPENCLAW_HOME}/tmp`;
export const DEFAULT_PLATFORM = "linux/amd64";
export const GATEWAY_SERVICE = "openclaw-keybase-gateway";
export const SENDER_SERVICE = "openclaw-keybase-sender";

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
      - /app/extensions/keybase/docker/keybase-entrypoint.sh
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
      - /app/extensions/keybase/docker/keybase-entrypoint.sh
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
   - covers team-channel canary reply, tagged help command, native command advertisements, chunked command delivery, DM canary reply, DM pairing challenge, mention gating, group allowlist block, listener-child restart, gateway restart resume, and ack reaction observation

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
