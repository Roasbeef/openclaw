import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_KEYBASE_BINARY = "keybase";
const DEFAULT_KEYBASE_HOME = "/home/node";
const DEFAULT_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isTruthy(value, defaultValue) {
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveKeybaseContainerConfig(env = process.env) {
  const configPath = normalizeOptionalString(env.OPENCLAW_CONFIG_PATH) ?? DEFAULT_CONFIG_PATH;
  return {
    autoOneshot: isTruthy(env.OPENCLAW_KEYBASE_AUTO_ONESHOT, true),
    binary: normalizeOptionalString(env.OPENCLAW_KEYBASE_BINARY) ?? DEFAULT_KEYBASE_BINARY,
    configPath,
    homeDir: normalizeOptionalString(env.OPENCLAW_KEYBASE_HOME) ?? DEFAULT_KEYBASE_HOME,
    paperKey: normalizeOptionalString(env.KEYBASE_PAPERKEY),
    paperKeyFile: normalizeOptionalString(env.KEYBASE_PAPERKEY_FILE),
    tmpDir:
      normalizeOptionalString(env.OPENCLAW_TMPDIR) ??
      normalizeOptionalString(env.TMPDIR) ??
      path.join(path.dirname(configPath), "tmp"),
    username: normalizeOptionalString(env.KEYBASE_USERNAME),
  };
}

function applyKeybaseContainerConfig(existing, resolved) {
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

async function readExistingConfig(configPath) {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function resolvePaperKey(resolved) {
  if (resolved.paperKey) {
    return resolved.paperKey;
  }
  if (!resolved.paperKeyFile) {
    return undefined;
  }
  const contents = await readFile(resolved.paperKeyFile, "utf8");
  const trimmed = contents.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function runCommand(command, args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Command ${command} exited with signal ${signal}`));
        return;
      }
      if (typeof code === "number" && code !== 0) {
        reject(new Error(`Command ${command} exited with status ${code}`));
        return;
      }
      resolve();
    });
  });
}

function buildKeybaseBaseArgs(resolved) {
  return resolved.homeDir ? ["--home", resolved.homeDir] : [];
}

async function prepareKeybaseContainer(resolved) {
  await mkdir(path.dirname(resolved.configPath), { recursive: true });
  await mkdir(resolved.homeDir, { recursive: true });
  await mkdir(resolved.tmpDir, { recursive: true });

  const nextConfig = applyKeybaseContainerConfig(
    await readExistingConfig(resolved.configPath),
    resolved,
  );
  await writeFile(resolved.configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  const paperKey = await resolvePaperKey(resolved);
  if (!resolved.autoOneshot || !resolved.username || !paperKey) {
    return;
  }

  await runCommand(resolved.binary, [...buildKeybaseBaseArgs(resolved), "oneshot"], {
    ...process.env,
    KEYBASE_PAPERKEY: paperKey,
    KEYBASE_SERVICE: normalizeOptionalString(process.env.KEYBASE_SERVICE) ?? "1",
    KEYBASE_USERNAME: resolved.username,
    TMPDIR: normalizeOptionalString(process.env.TMPDIR) ?? resolved.tmpDir,
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    throw new Error("Missing container command.");
  }

  const resolved = resolveKeybaseContainerConfig();
  await prepareKeybaseContainer(resolved);

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      env: {
        ...process.env,
        KEYBASE_SERVICE: normalizeOptionalString(process.env.KEYBASE_SERVICE) ?? "1",
        TMPDIR: normalizeOptionalString(process.env.TMPDIR) ?? resolved.tmpDir,
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(typeof code === "number" ? code : 1);
    });
  });

  process.exit(exitCode);
}

await main();
