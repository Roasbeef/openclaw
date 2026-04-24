import { execFile } from "node:child_process";
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

export interface KeybaseDockerSmokeImageResult {
  baseImageName: string;
  imageName: string;
  platform: string;
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

function renderCompose(params: { gatewayPort: number; imageName: string; platform: string }) {
  return `services:
  openclaw-keybase-gateway:
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
      - openclaw-keybase-gateway
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
CLAUDE_CODE_OAUTH_TOKEN=
OPENCLAW_KEYBASE_AUTO_ONESHOT=1
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

## Notes

- The smoke image defaults to \`${params.platform}\` because the official Keybase Linux package is amd64-focused.
- The generated \`state/home/.openclaw/openclaw.json\` sets the default model to \`claude-cli/claude-sonnet-4-6\` and preserves \`CLAUDE_CODE_OAUTH_TOKEN\` for the Claude child process.
- Keybase persists its home under the shared \`state/home\` mount, but the service socket and pid file stay on container-local \`${DEFAULT_KEYBASE_RUNTIME_DIR}\` so Docker Desktop shared volumes do not need to carry Unix sockets.
- Start with one bot container and a real external sender. Add a second sender identity/container after the bot-side path is stable.
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
  const openclawStateDir = path.join(homeStateDir, ".openclaw");
  const secretsDir = path.join(openclawStateDir, "secrets");
  const openclawTmpDir = path.join(openclawStateDir, "tmp");
  const composeFile = path.join(outputDir, "docker-compose.keybase.yml");
  const envExampleFile = path.join(outputDir, ".env.example");
  const readmeFile = path.join(outputDir, "README.md");
  const configFile = path.join(openclawStateDir, "openclaw.json");
  const secretsReadmeFile = path.join(secretsDir, "README.txt");

  await fs.mkdir(secretsDir, { recursive: true });
  await fs.mkdir(openclawTmpDir, { recursive: true });
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

  return {
    composeFile,
    envExampleFile,
    files: [composeFile, envExampleFile, readmeFile, configFile, secretsReadmeFile, openclawTmpDir],
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
