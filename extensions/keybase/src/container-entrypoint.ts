import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { keybaseOneshot } from "./client.js";

const DEFAULT_KEYBASE_BINARY = "keybase";
const DEFAULT_KEYBASE_HOME = "/home/node";
const DEFAULT_KEYBASE_RUNTIME_DIR = "/tmp/openclaw-keybase";
const DEFAULT_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";

type ReadFileLike = typeof readFile;
type WriteFileLike = typeof writeFile;
type MkdirLike = typeof mkdir;

type OneshotLike = typeof keybaseOneshot;

type SpawnLike = typeof spawn;

type RuntimeDeps = {
  mkdir: MkdirLike;
  oneshot: OneshotLike;
  readFile: ReadFileLike;
  spawn: SpawnLike;
  writeFile: WriteFileLike;
};

type JsonRecord = Record<string, unknown>;

export interface ResolvedKeybaseContainerConfig {
  autoOneshot: boolean;
  binary: string;
  configPath: string;
  homeDir: string;
  paperKey?: string;
  paperKeyFile?: string;
  pidFile: string;
  runtimeDir: string;
  socketFile: string;
  tmpDir: string;
  username?: string;
}

const defaultRuntimeDeps: RuntimeDeps = {
  mkdir,
  oneshot: keybaseOneshot,
  readFile,
  spawn,
  writeFile,
};

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isTruthy(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  switch (normalized) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return defaultValue;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveKeybaseContainerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedKeybaseContainerConfig {
  const configPath = normalizeOptionalString(env.OPENCLAW_CONFIG_PATH) ?? DEFAULT_CONFIG_PATH;
  const runtimeDir =
    normalizeOptionalString(env.OPENCLAW_KEYBASE_RUNTIME_DIR) ?? DEFAULT_KEYBASE_RUNTIME_DIR;
  return {
    autoOneshot: isTruthy(env.OPENCLAW_KEYBASE_AUTO_ONESHOT, true),
    binary: normalizeOptionalString(env.OPENCLAW_KEYBASE_BINARY) ?? DEFAULT_KEYBASE_BINARY,
    configPath,
    homeDir: normalizeOptionalString(env.OPENCLAW_KEYBASE_HOME) ?? DEFAULT_KEYBASE_HOME,
    paperKey: normalizeOptionalString(env.KEYBASE_PAPERKEY),
    paperKeyFile: normalizeOptionalString(env.KEYBASE_PAPERKEY_FILE),
    pidFile:
      normalizeOptionalString(env.OPENCLAW_KEYBASE_PID_FILE) ??
      path.join(runtimeDir, "keybased.pid"),
    runtimeDir,
    socketFile:
      normalizeOptionalString(env.OPENCLAW_KEYBASE_SOCKET_FILE) ??
      path.join(runtimeDir, "keybased.sock"),
    tmpDir:
      normalizeOptionalString(env.OPENCLAW_TMPDIR) ??
      normalizeOptionalString(env.TMPDIR) ??
      path.join(path.dirname(configPath), "tmp"),
    username: normalizeOptionalString(env.KEYBASE_USERNAME),
  };
}

export function applyKeybaseContainerConfig(
  existing: unknown,
  resolved: ResolvedKeybaseContainerConfig,
): JsonRecord {
  const next = isRecord(existing) ? JSON.parse(JSON.stringify(existing)) : {};

  const channels = isRecord(next.channels) ? { ...next.channels } : {};
  const channel = isRecord(channels.keybase) ? { ...channels.keybase } : {};
  if (channel.enabled === undefined) {
    channel.enabled = true;
  }
  if (channel.dmPolicy === undefined) {
    channel.dmPolicy = "pairing";
  }
  if (channel.groupPolicy === undefined) {
    channel.groupPolicy = "allowlist";
  }
  channel.binary = resolved.binary;
  channel.homeDir = resolved.homeDir;
  channel.pidFile = resolved.pidFile;
  channel.socketFile = resolved.socketFile;
  if (resolved.username) {
    channel.username = resolved.username;
  }
  channels.keybase = channel;
  next.channels = channels;

  const gateway = isRecord(next.gateway) ? { ...next.gateway } : {};
  if (gateway.bind === undefined) {
    gateway.bind = "lan";
  }
  const auth = isRecord(gateway.auth) ? { ...gateway.auth } : undefined;
  if (auth && "allowInsecureAuth" in auth) {
    delete auth.allowInsecureAuth;
  }
  if (auth && Object.keys(auth).length > 0) {
    gateway.auth = auth;
  } else if ("auth" in gateway) {
    delete gateway.auth;
  }
  const controlUi = isRecord(gateway.controlUi) ? { ...gateway.controlUi } : {};
  if (controlUi.allowInsecureAuth === undefined) {
    controlUi.allowInsecureAuth = true;
  }
  gateway.controlUi = controlUi;
  next.gateway = gateway;

  return next;
}

async function readExistingConfig(
  configPath: string,
  deps: Pick<RuntimeDeps, "readFile">,
): Promise<unknown> {
  try {
    return JSON.parse(await deps.readFile(configPath, "utf8")) as unknown;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return {};
    }
    throw new Error(`Could not read OpenClaw config at ${configPath}: ${String(error)}`, {
      cause: error,
    });
  }
}

async function resolvePaperKey(
  resolved: ResolvedKeybaseContainerConfig,
  deps: Pick<RuntimeDeps, "readFile">,
): Promise<string | undefined> {
  if (resolved.paperKey) {
    return resolved.paperKey;
  }
  if (!resolved.paperKeyFile) {
    return undefined;
  }
  const contents = await deps.readFile(resolved.paperKeyFile, "utf8");
  const trimmed = contents.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function prepareKeybaseContainer(
  resolved: ResolvedKeybaseContainerConfig,
  deps: Partial<RuntimeDeps> = {},
): Promise<void> {
  const runtimeDeps = { ...defaultRuntimeDeps, ...deps };
  await runtimeDeps.mkdir(path.dirname(resolved.configPath), { recursive: true });
  await runtimeDeps.mkdir(resolved.homeDir, { recursive: true });
  await runtimeDeps.mkdir(resolved.runtimeDir, { recursive: true });
  await runtimeDeps.mkdir(path.dirname(resolved.pidFile), { recursive: true });
  await runtimeDeps.mkdir(path.dirname(resolved.socketFile), { recursive: true });
  await runtimeDeps.mkdir(resolved.tmpDir, { recursive: true });

  const nextConfig = applyKeybaseContainerConfig(
    await readExistingConfig(resolved.configPath, runtimeDeps),
    resolved,
  );
  await runtimeDeps.writeFile(
    resolved.configPath,
    `${JSON.stringify(nextConfig, null, 2)}\n`,
    "utf8",
  );

  const paperKey = await resolvePaperKey(resolved, runtimeDeps);
  if (!resolved.autoOneshot || !resolved.username || !paperKey) {
    return;
  }

  await runtimeDeps.oneshot(
    {
      paperKey,
      username: resolved.username,
    },
    {
      binary: resolved.binary,
      homeDir: resolved.homeDir,
      pidFile: resolved.pidFile,
      socketFile: resolved.socketFile,
    },
  );
}

function buildSpawnEnv(
  resolved: Pick<ResolvedKeybaseContainerConfig, "tmpDir">,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    KEYBASE_SERVICE: normalizeOptionalString(env.KEYBASE_SERVICE) ?? "1",
    TMPDIR: normalizeOptionalString(env.TMPDIR) ?? resolved.tmpDir,
  };
}

export async function runKeybaseContainerEntrypoint(
  argv: readonly string[],
  deps: Partial<RuntimeDeps> = {},
): Promise<number> {
  if (argv.length === 0) {
    throw new Error("Missing container command.");
  }

  const runtimeDeps = { ...defaultRuntimeDeps, ...deps };
  const resolved = resolveKeybaseContainerConfig();
  await prepareKeybaseContainer(resolved, runtimeDeps);

  return await new Promise<number>((resolve, reject) => {
    const child = runtimeDeps.spawn(argv[0], argv.slice(1), {
      env: buildSpawnEnv(resolved),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

export async function main(argv: readonly string[] = process.argv.slice(2)) {
  const exitCode = await runKeybaseContainerEntrypoint(argv);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

const isMainModule =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  await main().catch((error) => {
    process.stderr.write(`Keybase container entrypoint failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
