import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_KEYBASE_BINARY = "keybase";
const DEFAULT_KEYBASE_HOME = "/home/node";
const DEFAULT_KEYBASE_RUNTIME_DIR = "/tmp/openclaw-keybase";
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

function buildKeybaseBaseArgs(resolved) {
  const args = [];
  const addPathFlag = (flag, value) => {
    const normalized = normalizeOptionalString(value);
    if (normalized) {
      args.push(flag, normalized);
    }
  };
  addPathFlag("--home", resolved.homeDir);
  addPathFlag("--socket-file", resolved.socketFile);
  addPathFlag("--pid-file", resolved.pidFile);
  return args;
}

function buildKeybaseCommandEnv(resolved) {
  return {
    ...process.env,
    KEYBASE_SERVICE: normalizeOptionalString(process.env.KEYBASE_SERVICE) ?? "1",
    TMPDIR: normalizeOptionalString(process.env.TMPDIR) ?? resolved.tmpDir,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForKeybaseSocket(resolved, getEarlyExitError) {
  const socketPath = resolved.socketFile;
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    const earlyExitError = getEarlyExitError();
    if (earlyExitError) {
      throw earlyExitError;
    }
    try {
      await stat(socketPath);
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(`Keybase service socket did not appear at ${socketPath}: ${String(lastError)}`);
}

async function runKeybaseCommand(command, args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Command ${command} exited with signal ${signal}: ${stderr}`));
        return;
      }
      if (typeof code === "number" && code !== 0) {
        reject(new Error(`Command ${command} exited with status ${code}: ${stderr}`));
        return;
      }
      resolve();
    });
  });
}

function isKeybaseServerAlreadyRunningError(stderr) {
  return (
    stderr.includes("server already running") ||
    stderr.includes("error locking") ||
    stderr.includes("resource temporarily unavailable")
  );
}

function isKeybaseLoginRequiredError(error) {
  return String(error).includes("Login required");
}

async function findLingeringKeybasePids() {
  let entries;
  try {
    entries = await readdir("/proc");
  } catch {
    return [];
  }

  const pids = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const pid = Number.parseInt(entry, 10);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
      continue;
    }
    let cmdline;
    try {
      cmdline = await readFile(path.join("/proc", entry, "cmdline"), "utf8");
    } catch {
      continue;
    }
    const parts = cmdline.split("\0").filter(Boolean);
    if (parts.some((part) => path.basename(part) === "keybase")) {
      pids.push(pid);
    }
  }
  return pids;
}

async function stopLingeringKeybaseProcesses() {
  const pids = await findLingeringKeybasePids();
  for (const pid of pids) {
    try {
      process.kill(pid, "TERM");
    } catch {
      // The process may already be gone.
    }
  }
  if (pids.length > 0) {
    await sleep(1000);
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      process.kill(pid, "KILL");
    } catch {
      // Process exited after TERM.
    }
  }
}

async function stopExistingKeybaseService(resolved) {
  try {
    const rawPid = await readFile(resolved.pidFile, "utf8");
    const pid = Number.parseInt(rawPid.trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, "TERM");
        await sleep(1000);
      } catch {
        // The process may already be gone; stale pid files are cleaned below.
      }
      try {
        process.kill(pid, 0);
        process.kill(pid, "KILL");
      } catch {
        // Process exited after TERM or the pid file was stale.
      }
    }
  } catch {
    // No pid file is fine; remove any stale socket/pid paths below.
  }
  await stopLingeringKeybaseProcesses();
  await Promise.all([
    rm(resolved.socketFile, { force: true }),
    rm(resolved.pidFile, { force: true }),
  ]);
}

async function startKeybaseService(resolved, paperKey, attempt = 0) {
  const env = buildKeybaseCommandEnv(resolved);
  const args = [
    ...buildKeybaseBaseArgs(resolved),
    "service",
    "--oneshot-username",
    resolved.username,
  ];
  const child = spawn(resolved.binary, args, {
    env,
    stdio: ["pipe", "ignore", "pipe"],
  });

  if (!child.stdin) {
    throw new Error("Keybase service child process did not expose stdin");
  }

  let stderr = "";
  let ready = false;
  let earlyExitError;
  let earlyExitAlreadyRunning = false;
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.once("exit", (code, signal) => {
    if (!ready) {
      if (isKeybaseServerAlreadyRunningError(stderr)) {
        earlyExitAlreadyRunning = true;
        return;
      }
      const reason = signal ? `signal ${signal}` : `status ${code}`;
      earlyExitError = new Error(`Keybase service exited before readiness (${reason}): ${stderr}`);
    }
  });
  child.stdin.end(`${paperKey.trim()}\n`);

  try {
    await waitForKeybaseSocket(resolved, () => earlyExitError);
  } catch (error) {
    if (attempt < 4) {
      if (!child.killed) {
        child.kill();
      }
      await stopExistingKeybaseService(resolved);
      return await startKeybaseService(resolved, paperKey, attempt + 1);
    }
    throw error;
  }

  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (earlyExitError) {
      throw earlyExitError;
    }
    try {
      await runKeybaseCommand(
        resolved.binary,
        [
          ...buildKeybaseBaseArgs(resolved),
          "chat",
          "notification-settings",
          "-disable-typing=true",
        ],
        env,
      );
      ready = true;
      return;
    } catch (error) {
      lastError = error;
      if (earlyExitError) {
        throw earlyExitError;
      }
      await sleep(250);
    }
  }

  if (!child.killed) {
    child.kill();
  }
  if (attempt < 4 && (earlyExitAlreadyRunning || isKeybaseLoginRequiredError(lastError))) {
    await stopExistingKeybaseService(resolved);
    return await startKeybaseService(resolved, paperKey, attempt + 1);
  }
  throw new Error(`Keybase service did not become ready: ${String(lastError)}`);
}

async function isExistingKeybaseServiceReady(resolved) {
  try {
    await stat(resolved.socketFile);
    await runKeybaseCommand(
      resolved.binary,
      [...buildKeybaseBaseArgs(resolved), "whoami"],
      buildKeybaseCommandEnv(resolved),
    );
    return true;
  } catch {
    return false;
  }
}

async function prepareKeybaseContainer(resolved) {
  await mkdir(path.dirname(resolved.configPath), { recursive: true });
  await mkdir(resolved.homeDir, { recursive: true });
  await mkdir(resolved.runtimeDir, { recursive: true });
  await mkdir(path.dirname(resolved.pidFile), { recursive: true });
  await mkdir(path.dirname(resolved.socketFile), { recursive: true });
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
  if (await isExistingKeybaseServiceReady(resolved)) {
    return;
  }

  await stopExistingKeybaseService(resolved);
  await startKeybaseService(resolved, paperKey);
}

function childExitCode(code, signal) {
  if (signal) {
    return 1;
  }
  return typeof code === "number" ? code : 1;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateChild(child, signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

async function waitForManagedChild(child) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    let shutdownTimer;
    const finish = (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(livenessTimer);
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
      }
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      resolve(exitCode);
    };
    const handleExit = (code, signal) => {
      finish(childExitCode(code, signal));
    };
    const handleError = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(livenessTimer);
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
      }
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      reject(error);
    };
    const forwardSignal = (signal) => {
      terminateChild(child, signal);
      shutdownTimer = setTimeout(() => {
        terminateChild(child, "SIGKILL");
        finish(1);
      }, 15_000);
    };
    const onSigint = () => forwardSignal("SIGINT");
    const onSigterm = () => forwardSignal("SIGTERM");
    const livenessTimer = setInterval(() => {
      if (typeof child.exitCode === "number" || child.signalCode) {
        finish(childExitCode(child.exitCode, child.signalCode));
        return;
      }
      if (typeof child.pid === "number" && child.pid > 0 && !isProcessAlive(child.pid)) {
        finish(1);
      }
    }, 1_000);

    child.once("error", handleError);
    child.once("exit", handleExit);
    child.once("close", handleExit);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    throw new Error("Missing container command.");
  }

  const resolved = resolveKeybaseContainerConfig();
  await prepareKeybaseContainer(resolved);

  const child = spawn(argv[0], argv.slice(1), {
    env: {
      ...process.env,
      KEYBASE_SERVICE: normalizeOptionalString(process.env.KEYBASE_SERVICE) ?? "1",
      TMPDIR: normalizeOptionalString(process.env.TMPDIR) ?? resolved.tmpDir,
    },
    stdio: "inherit",
  });

  const exitCode = await waitForManagedChild(child);
  process.exit(exitCode);
}

await main();
