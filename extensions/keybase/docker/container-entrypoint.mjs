// Generated from extensions/keybase/src/container-entrypoint.ts. Do not edit by hand.
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const KEYBASE_SERVICE_MAX_ATTEMPTS = 5;
const KEYBASE_SERVICE_KILL_TIMEOUT_MS = 5e3;
const KEYBASE_SERVICE_SIGKILL_GRACE_MS = 1e3;
const KEYBASE_ENTRYPOINT_STDERR_RING_BYTES = 65536;
const KEYBASE_RUNTIME_PAPERKEY_FILE = "keybase-paperkey";
const KEYBASE_LINGERING_PID_TERM_GRACE_MS = 2e3;
const KEYBASE_LINGERING_PID_ANCESTOR_DEPTH = 8;
function appendKeybaseEntrypointStderr(buffer, chunk, maxBytes = KEYBASE_ENTRYPOINT_STDERR_RING_BYTES) {
  const combined = buffer + chunk;
  if (combined.length <= maxBytes) {
    return combined;
  }
  return combined.slice(combined.length - maxBytes);
}
async function awaitChildExit(child, timeoutMs = KEYBASE_SERVICE_KILL_TIMEOUT_MS) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let graceTimer = null;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (graceTimer) {
        clearTimeout(graceTimer);
      }
      resolve();
    };
    timer = setTimeout(() => {
      timer = null;
      try {
        child.kill("SIGKILL");
      } catch {
      }
      graceTimer = setTimeout(finish, KEYBASE_SERVICE_SIGKILL_GRACE_MS);
    }, timeoutMs);
    child.once("close", finish);
    child.once("exit", finish);
  });
}
const DEFAULT_KEYBASE_BINARY = "keybase";
const DEFAULT_KEYBASE_HOME = "/home/node";
const DEFAULT_KEYBASE_RUNTIME_DIR = "/tmp/openclaw-keybase";
const DEFAULT_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";
const defaultRuntimeDeps = {
  killProcess: (pid, signal) => {
    process.kill(pid, signal);
  },
  mkdir,
  readdir,
  readFile,
  readlink: (p) => readlink(p),
  rm,
  sleep: async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  },
  spawn,
  stat,
  writeFile
};
function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return void 0;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
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
  const runtimeDir = normalizeOptionalString(env.OPENCLAW_KEYBASE_RUNTIME_DIR) ?? DEFAULT_KEYBASE_RUNTIME_DIR;
  return {
    autoOneshot: isTruthy(env.OPENCLAW_KEYBASE_AUTO_ONESHOT, true),
    binary: normalizeOptionalString(env.OPENCLAW_KEYBASE_BINARY) ?? DEFAULT_KEYBASE_BINARY,
    configPath,
    homeDir: normalizeOptionalString(env.OPENCLAW_KEYBASE_HOME) ?? DEFAULT_KEYBASE_HOME,
    paperKey: normalizeOptionalString(env.KEYBASE_PAPERKEY),
    paperKeyFile: normalizeOptionalString(env.KEYBASE_PAPERKEY_FILE),
    pidFile: normalizeOptionalString(env.OPENCLAW_KEYBASE_PID_FILE) ?? path.join(runtimeDir, "keybased.pid"),
    runtimeDir,
    socketFile: normalizeOptionalString(env.OPENCLAW_KEYBASE_SOCKET_FILE) ?? path.join(runtimeDir, "keybased.sock"),
    tmpDir: normalizeOptionalString(env.OPENCLAW_TMPDIR) ?? normalizeOptionalString(env.TMPDIR) ?? path.join(path.dirname(configPath), "tmp"),
    username: normalizeOptionalString(env.KEYBASE_USERNAME)
  };
}
function applyKeybaseContainerConfig(existing, resolved) {
  const next = isRecord(existing) ? JSON.parse(JSON.stringify(existing)) : {};
  const channels = isRecord(next.channels) ? { ...next.channels } : {};
  const channel = isRecord(channels.keybase) ? { ...channels.keybase } : {};
  if (channel.enabled === void 0) {
    channel.enabled = true;
  }
  if (channel.dmPolicy === void 0) {
    channel.dmPolicy = "pairing";
  }
  if (channel.groupPolicy === void 0) {
    channel.groupPolicy = "allowlist";
  }
  channel.binary = resolved.binary;
  channel.homeDir = resolved.homeDir;
  channel.pidFile = resolved.pidFile;
  channel.socketFile = resolved.socketFile;
  if (resolved.username) {
    channel.username = resolved.username;
  }
  if (resolved.paperKeyFile) {
    channel.paperKeyFile = resolved.paperKeyFile;
  }
  if (resolved.paperKey) {
    delete channel.paperKey;
  }
  channels.keybase = channel;
  next.channels = channels;
  if (isRecord(next.gateway)) {
    const gateway = { ...next.gateway };
    const auth = isRecord(gateway.auth) ? { ...gateway.auth } : void 0;
    if (auth && "allowInsecureAuth" in auth) {
      delete auth.allowInsecureAuth;
      console.warn(
        "[keybase] container entrypoint stripping gateway.auth.allowInsecureAuth from openclaw.json before write"
      );
    }
    if (auth && Object.keys(auth).length > 0) {
      gateway.auth = auth;
    } else if ("auth" in gateway) {
      delete gateway.auth;
    }
    const controlUi = isRecord(gateway.controlUi) ? { ...gateway.controlUi } : void 0;
    if (controlUi && "allowInsecureAuth" in controlUi) {
      delete controlUi.allowInsecureAuth;
      console.warn(
        "[keybase] container entrypoint stripping gateway.controlUi.allowInsecureAuth from openclaw.json before write"
      );
    }
    if (controlUi && Object.keys(controlUi).length > 0) {
      gateway.controlUi = controlUi;
    } else if ("controlUi" in gateway) {
      delete gateway.controlUi;
    }
    next.gateway = gateway;
  }
  return next;
}
async function readExistingConfig(configPath, deps) {
  try {
    return JSON.parse(await deps.readFile(configPath, "utf8"));
  } catch (error) {
    const err = error;
    if (err?.code === "ENOENT") {
      return {};
    }
    throw new Error(`Could not read OpenClaw config at ${configPath}: ${String(error)}`, {
      cause: error
    });
  }
}
async function resolvePaperKey(resolved, deps) {
  if (resolved.paperKey) {
    return resolved.paperKey;
  }
  if (!resolved.paperKeyFile) {
    return void 0;
  }
  const contents = await deps.readFile(resolved.paperKeyFile, "utf8");
  const trimmed = contents.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}
async function materializeRuntimePaperKeyFile(resolved, deps) {
  if (!resolved.paperKey || resolved.paperKeyFile) {
    return resolved;
  }
  const paperKeyFile = path.join(resolved.runtimeDir, KEYBASE_RUNTIME_PAPERKEY_FILE);
  await deps.writeFile(paperKeyFile, `${resolved.paperKey.trim()}
`, {
    encoding: "utf8",
    mode: 384
  });
  return {
    ...resolved,
    paperKey: void 0,
    paperKeyFile
  };
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
function buildKeybaseCommandEnv(resolved, env = process.env) {
  const next = {
    ...env,
    KEYBASE_SERVICE: normalizeOptionalString(env.KEYBASE_SERVICE) ?? "1",
    TMPDIR: normalizeOptionalString(env.TMPDIR) ?? resolved.tmpDir
  };
  delete next.KEYBASE_PAPERKEY;
  delete next.KEYBASE_PAPERKEY_FILE;
  return next;
}
async function waitForKeybaseSocket(resolved, getEarlyExitError, deps) {
  const deadline = Date.now() + 6e4;
  let lastError;
  while (Date.now() < deadline) {
    const earlyExitError = getEarlyExitError();
    if (earlyExitError) {
      throw earlyExitError;
    }
    try {
      await deps.stat(resolved.socketFile);
      return;
    } catch (error) {
      lastError = error;
      await deps.sleep(250);
    }
  }
  throw new Error(
    `Keybase service socket did not appear at ${resolved.socketFile}: ${String(lastError)}`
  );
}
async function runKeybaseCommand(command, args, env, deps) {
  await new Promise((resolve, reject) => {
    const child = deps.spawn(command, [...args], {
      env,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr = appendKeybaseEntrypointStderr(stderr, chunk.toString());
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
  return stderr.includes("server already running") || stderr.includes("error locking") || stderr.includes("resource temporarily unavailable");
}
function isKeybaseLoginRequiredError(error) {
  return String(error).includes("Login required");
}
function parseStatPpid(raw) {
  const lastParen = raw.lastIndexOf(")");
  if (lastParen < 0) {
    return null;
  }
  const tail = raw.slice(lastParen + 1).trim().split(/\s+/);
  if (tail.length < 2) {
    return null;
  }
  const ppid = Number.parseInt(tail[1], 10);
  return Number.isInteger(ppid) && ppid >= 0 ? ppid : null;
}
async function buildPpidMap(entries, deps) {
  const map = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const pid = Number.parseInt(entry, 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    let raw;
    try {
      raw = await deps.readFile(path.join("/proc", entry, "stat"), "utf8");
    } catch {
      continue;
    }
    const ppid = parseStatPpid(raw);
    if (ppid !== null) {
      map.set(pid, ppid);
    }
  }
  return map;
}
function isDescendantOf(pid, ancestor, ppidMap, maxDepth = KEYBASE_LINGERING_PID_ANCESTOR_DEPTH) {
  let current = pid;
  for (let i = 0; i < maxDepth; i++) {
    const parent = ppidMap.get(current);
    if (parent === void 0) {
      return false;
    }
    if (parent === ancestor) {
      return true;
    }
    if (parent <= 1) {
      return false;
    }
    current = parent;
  }
  return false;
}
async function isHostPidNamespace(deps) {
  if (process.pid !== 1) {
    return false;
  }
  try {
    const link = await deps.readlink("/proc/1/exe");
    return link !== process.execPath;
  } catch {
    return true;
  }
}
async function findLingeringKeybasePids(resolvedBinary, keybaseHome, deps) {
  if (await isHostPidNamespace(deps)) {
    process.stderr.write(
      "[keybase] skipping lingering-pid scan: appears to share PID namespace with host\n"
    );
    return [];
  }
  let entries;
  try {
    entries = await deps.readdir("/proc");
  } catch {
    return [];
  }
  const ppidMap = await buildPpidMap(entries, deps);
  const expectedExeBasename = path.basename(resolvedBinary);
  const expectedExePath = path.isAbsolute(resolvedBinary) ? resolvedBinary : void 0;
  const expectedEnvToken = `KEYBASE_HOME=${keybaseHome}`;
  const pids = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const pid = Number.parseInt(entry, 10);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
      continue;
    }
    if (!isDescendantOf(pid, process.pid, ppidMap)) {
      continue;
    }
    let exeLink;
    try {
      exeLink = await deps.readlink(path.join("/proc", entry, "exe"));
    } catch {
      continue;
    }
    if (path.basename(exeLink) !== expectedExeBasename) {
      continue;
    }
    if (expectedExePath && exeLink !== expectedExePath) {
      continue;
    }
    let environRaw;
    try {
      environRaw = await deps.readFile(path.join("/proc", entry, "environ"), "utf8");
    } catch {
      continue;
    }
    const envTokens = environRaw.split("\0").filter(Boolean);
    if (!envTokens.includes(expectedEnvToken)) {
      continue;
    }
    pids.push(pid);
  }
  return pids;
}
async function stopLingeringKeybaseProcesses(resolved, deps) {
  const pids = await findLingeringKeybasePids(resolved.binary, resolved.homeDir, deps);
  for (const pid of pids) {
    try {
      deps.killProcess(pid, "SIGTERM");
    } catch {
    }
  }
  if (pids.length > 0) {
    await deps.sleep(KEYBASE_LINGERING_PID_TERM_GRACE_MS);
  }
  for (const pid of pids) {
    try {
      deps.killProcess(pid, 0);
      deps.killProcess(pid, "SIGKILL");
    } catch {
    }
  }
}
async function stopExistingKeybaseService(resolved, deps) {
  try {
    const rawPid = await deps.readFile(resolved.pidFile, "utf8");
    const pid = Number.parseInt(rawPid.trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        deps.killProcess(pid, "SIGTERM");
        await deps.sleep(1e3);
      } catch {
      }
      try {
        deps.killProcess(pid, 0);
        deps.killProcess(pid, "SIGKILL");
      } catch {
      }
    }
  } catch {
  }
  await stopLingeringKeybaseProcesses(resolved, deps);
  await Promise.all([
    deps.rm(resolved.socketFile, { force: true }),
    deps.rm(resolved.pidFile, { force: true })
  ]);
}
async function startKeybaseService(resolved, paperKey, deps) {
  const username = normalizeOptionalString(resolved.username);
  if (!username) {
    throw new Error("KEYBASE_USERNAME is required to start the Keybase service.");
  }
  const env = buildKeybaseCommandEnv(resolved);
  const args = [...buildKeybaseBaseArgs(resolved), "service", "--oneshot-username", username];
  let lastError;
  for (let attempt = 0; attempt < KEYBASE_SERVICE_MAX_ATTEMPTS; attempt++) {
    const child = deps.spawn(resolved.binary, args, {
      env,
      stdio: ["pipe", "ignore", "pipe"]
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
      stderr = appendKeybaseEntrypointStderr(stderr, chunk.toString());
    });
    child.once("exit", (code, signal) => {
      if (ready) {
        return;
      }
      if (isKeybaseServerAlreadyRunningError(stderr)) {
        earlyExitAlreadyRunning = true;
        return;
      }
      const reason = signal ? `signal ${signal}` : `status ${code}`;
      earlyExitError = new Error(`Keybase service exited before readiness (${reason}): ${stderr}`);
    });
    child.stdin.end(`${paperKey.trim()}
`);
    try {
      await waitForKeybaseSocket(resolved, () => earlyExitError, deps);
    } catch (error) {
      if (!child.killed) {
        child.kill();
      }
      await awaitChildExit(child);
      if (attempt < KEYBASE_SERVICE_MAX_ATTEMPTS - 1) {
        await stopExistingKeybaseService(resolved, deps);
        continue;
      }
      throw error;
    }
    const deadline = Date.now() + 3e4;
    lastError = void 0;
    let readinessReached = false;
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
            "-disable-typing=true"
          ],
          env,
          deps
        );
        ready = true;
        readinessReached = true;
        break;
      } catch (error) {
        lastError = error;
        if (earlyExitError) {
          throw earlyExitError;
        }
        await deps.sleep(250);
      }
    }
    if (readinessReached) {
      return;
    }
    if (!child.killed) {
      child.kill();
    }
    await awaitChildExit(child);
    if (attempt < KEYBASE_SERVICE_MAX_ATTEMPTS - 1 && (earlyExitAlreadyRunning || isKeybaseLoginRequiredError(lastError))) {
      await stopExistingKeybaseService(resolved, deps);
      continue;
    }
    throw new Error(`Keybase service did not become ready: ${String(lastError)}`);
  }
  throw new Error(`Keybase service did not become ready: ${String(lastError)}`);
}
async function isExistingKeybaseServiceReady(resolved, deps) {
  try {
    await deps.stat(resolved.socketFile);
    await runKeybaseCommand(
      resolved.binary,
      [...buildKeybaseBaseArgs(resolved), "whoami"],
      buildKeybaseCommandEnv(resolved),
      deps
    );
    return true;
  } catch {
    return false;
  }
}
async function prepareKeybaseContainer(resolved, deps = {}) {
  const runtimeDeps = { ...defaultRuntimeDeps, ...deps };
  await runtimeDeps.mkdir(path.dirname(resolved.configPath), { recursive: true });
  await runtimeDeps.mkdir(resolved.homeDir, { recursive: true });
  await runtimeDeps.mkdir(resolved.runtimeDir, { recursive: true });
  await runtimeDeps.mkdir(path.dirname(resolved.pidFile), { recursive: true });
  await runtimeDeps.mkdir(path.dirname(resolved.socketFile), { recursive: true });
  await runtimeDeps.mkdir(resolved.tmpDir, { recursive: true });
  const runtimeResolved = await materializeRuntimePaperKeyFile(resolved, runtimeDeps);
  const nextConfig = applyKeybaseContainerConfig(
    await readExistingConfig(resolved.configPath, runtimeDeps),
    runtimeResolved
  );
  await runtimeDeps.writeFile(resolved.configPath, `${JSON.stringify(nextConfig, null, 2)}
`, {
    encoding: "utf8",
    mode: 384
  });
  const paperKey = await resolvePaperKey(runtimeResolved, runtimeDeps);
  if (!runtimeResolved.autoOneshot || !runtimeResolved.username || !paperKey) {
    return;
  }
  if (await isExistingKeybaseServiceReady(runtimeResolved, runtimeDeps)) {
    return;
  }
  await stopExistingKeybaseService(runtimeResolved, runtimeDeps);
  await startKeybaseService(runtimeResolved, paperKey, runtimeDeps);
}
function buildSpawnEnv(resolved, env = process.env) {
  const next = {
    ...env,
    KEYBASE_SERVICE: normalizeOptionalString(env.KEYBASE_SERVICE) ?? "1",
    TMPDIR: normalizeOptionalString(env.TMPDIR) ?? resolved.tmpDir
  };
  delete next.KEYBASE_PAPERKEY;
  delete next.KEYBASE_PAPERKEY_FILE;
  return next;
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
      }, 15e3);
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
    }, 1e3);
    child.once("error", handleError);
    child.once("exit", handleExit);
    child.once("close", handleExit);
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  });
}
async function runKeybaseContainerEntrypoint(argv, deps = {}) {
  if (argv.length === 0) {
    throw new Error("Missing container command.");
  }
  const runtimeDeps = { ...defaultRuntimeDeps, ...deps };
  const resolved = resolveKeybaseContainerConfig();
  await prepareKeybaseContainer(resolved, runtimeDeps);
  const child = runtimeDeps.spawn(argv[0], argv.slice(1), {
    env: buildSpawnEnv(resolved),
    stdio: "inherit"
  });
  return await waitForManagedChild(child);
}
async function main(argv = process.argv.slice(2)) {
  const exitCode = await runKeybaseContainerEntrypoint(argv);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
const isMainModule = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  await main().catch((error) => {
    process.stderr.write(`Keybase container entrypoint failed: ${String(error)}
`);
    process.exitCode = 1;
  });
}
export {
  applyKeybaseContainerConfig,
  buildKeybaseCommandEnv,
  buildSpawnEnv,
  findLingeringKeybasePids,
  main,
  prepareKeybaseContainer,
  resolveKeybaseContainerConfig,
  runKeybaseContainerEntrypoint
};
