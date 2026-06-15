import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const KEYBASE_SERVICE_MAX_ATTEMPTS = 5;
const KEYBASE_SERVICE_KILL_TIMEOUT_MS = 5_000;
const KEYBASE_SERVICE_SIGKILL_GRACE_MS = 1_000;
const KEYBASE_ENTRYPOINT_STDERR_RING_BYTES = 65_536;
const KEYBASE_RUNTIME_PAPERKEY_FILE = "keybase-paperkey";
// H-8: bumped from 1s so well-behaved descendants get a real chance to exit on SIGTERM.
const KEYBASE_LINGERING_PID_TERM_GRACE_MS = 2_000;
const KEYBASE_LINGERING_PID_ANCESTOR_DEPTH = 8;

function appendKeybaseEntrypointStderr(
  buffer: string,
  chunk: string,
  maxBytes: number = KEYBASE_ENTRYPOINT_STDERR_RING_BYTES,
): string {
  const combined = buffer + chunk;
  if (combined.length <= maxBytes) {
    return combined;
  }
  return combined.slice(combined.length - maxBytes);
}

async function awaitChildExit(
  child: ChildProcess,
  timeoutMs: number = KEYBASE_SERVICE_KILL_TIMEOUT_MS,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
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
        // Process is already gone — fall through and resolve after the grace.
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

type ReadFileLike = typeof readFile;
type ReadlinkLike = (path: string) => Promise<string>;
type WriteFileLike = typeof writeFile;
type MkdirLike = typeof mkdir;
type ReaddirLike = typeof readdir;
type RmLike = typeof rm;
type StatLike = typeof stat;

type KillProcessLike = (pid: number, signal?: NodeJS.Signals | 0) => void;
type SleepLike = (ms: number) => Promise<void>;

type SpawnLike = typeof spawn;

type RuntimeDeps = {
  killProcess: KillProcessLike;
  mkdir: MkdirLike;
  readdir: ReaddirLike;
  readFile: ReadFileLike;
  readlink: ReadlinkLike;
  rm: RmLike;
  sleep: SleepLike;
  spawn: SpawnLike;
  stat: StatLike;
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
    // M-4: strip insecure-auth flags consistently from BOTH gateway.auth and
    // gateway.controlUi. The container always boots Keybase under whatever
    // auth was configured by the operator; an inherited `allowInsecureAuth`
    // (e.g. left over from the docker-smoke scaffold) must not silently
    // disable transport hardening here.
    const auth = isRecord(gateway.auth) ? { ...gateway.auth } : undefined;
    if (auth && "allowInsecureAuth" in auth) {
      delete auth.allowInsecureAuth;
      console.warn(
        "[keybase] container entrypoint stripping gateway.auth.allowInsecureAuth from openclaw.json before write",
      );
    }
    if (auth && Object.keys(auth).length > 0) {
      gateway.auth = auth;
    } else if ("auth" in gateway) {
      delete gateway.auth;
    }
    const controlUi = isRecord(gateway.controlUi) ? { ...gateway.controlUi } : undefined;
    if (controlUi && "allowInsecureAuth" in controlUi) {
      delete controlUi.allowInsecureAuth;
      console.warn(
        "[keybase] container entrypoint stripping gateway.controlUi.allowInsecureAuth from openclaw.json before write",
      );
    }
    if (controlUi && Object.keys(controlUi).length > 0) {
      gateway.controlUi = controlUi;
    } else if ("controlUi" in gateway) {
      delete gateway.controlUi;
    }
    next.gateway = gateway;
  }

  // NOTE: pre-write Zod validation against KeybaseChannelConfigSchema is
  // intentionally deferred. The full openclaw config schema lives outside this
  // extension boundary and pulling it in here would create a heavyweight
  // import cycle through plugin-sdk; keep the JSON-clone shape coercion until
  // the schema is exposed as a thin runtime dep.
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

async function materializeRuntimePaperKeyFile(
  resolved: ResolvedKeybaseContainerConfig,
  deps: Pick<RuntimeDeps, "writeFile">,
): Promise<ResolvedKeybaseContainerConfig> {
  if (!resolved.paperKey || resolved.paperKeyFile) {
    return resolved;
  }
  const paperKeyFile = path.join(resolved.runtimeDir, KEYBASE_RUNTIME_PAPERKEY_FILE);
  await deps.writeFile(paperKeyFile, `${resolved.paperKey.trim()}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return {
    ...resolved,
    paperKey: undefined,
    paperKeyFile,
  };
}

function buildKeybaseBaseArgs(resolved: ResolvedKeybaseContainerConfig): string[] {
  const args: string[] = [];
  const addPathFlag = (flag: string, value: string | undefined) => {
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

export function buildKeybaseCommandEnv(
  resolved: Pick<ResolvedKeybaseContainerConfig, "tmpDir">,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {
    ...env,
    KEYBASE_SERVICE: normalizeOptionalString(env.KEYBASE_SERVICE) ?? "1",
    TMPDIR: normalizeOptionalString(env.TMPDIR) ?? resolved.tmpDir,
  };
  // H-5: avoid leaking paper-key material to the wrapped workload
  delete next.KEYBASE_PAPERKEY;
  // H-5: avoid leaking paper-key material to the wrapped workload
  delete next.KEYBASE_PAPERKEY_FILE;
  return next;
}

async function waitForKeybaseSocket(
  resolved: ResolvedKeybaseContainerConfig,
  getEarlyExitError: () => Error | undefined,
  deps: Pick<RuntimeDeps, "sleep" | "stat">,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
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
    `Keybase service socket did not appear at ${resolved.socketFile}: ${String(lastError)}`,
  );
}

async function runKeybaseCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  deps: Pick<RuntimeDeps, "spawn">,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = deps.spawn(command, [...args], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string | Buffer) => {
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

function isKeybaseServerAlreadyRunningError(stderr: string): boolean {
  return (
    stderr.includes("server already running") ||
    stderr.includes("error locking") ||
    stderr.includes("resource temporarily unavailable")
  );
}

function isKeybaseLoginRequiredError(error: unknown): boolean {
  return String(error).includes("Login required");
}

function parseStatPpid(raw: string): number | null {
  // /proc/<pid>/stat is "pid (comm) state ppid pgrp ..." where comm may
  // contain spaces and parens. Anchor on the LAST `)` and parse from there.
  const lastParen = raw.lastIndexOf(")");
  if (lastParen < 0) {
    return null;
  }
  const tail = raw
    .slice(lastParen + 1)
    .trim()
    .split(/\s+/);
  if (tail.length < 2) {
    return null;
  }
  const ppid = Number.parseInt(tail[1], 10);
  return Number.isInteger(ppid) && ppid >= 0 ? ppid : null;
}

async function buildPpidMap(
  entries: readonly string[],
  deps: Pick<RuntimeDeps, "readFile">,
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const pid = Number.parseInt(entry, 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    let raw: string;
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

function isDescendantOf(
  pid: number,
  ancestor: number,
  ppidMap: Map<number, number>,
  maxDepth: number = KEYBASE_LINGERING_PID_ANCESTOR_DEPTH,
): boolean {
  let current = pid;
  for (let i = 0; i < maxDepth; i++) {
    const parent = ppidMap.get(current);
    if (parent === undefined) {
      return false;
    }
    if (parent === ancestor) {
      return true;
    }
    if (parent <= 1) {
      // Reached init/kernel without crossing ancestor.
      return false;
    }
    current = parent;
  }
  return false;
}

async function isHostPidNamespace(deps: Pick<RuntimeDeps, "readlink">): Promise<boolean> {
  // We only run as PID 1 inside the keybase container. If we are not PID 1
  // we are necessarily not the namespace root, so we skip this guard and
  // rely on the descendant check for safety.
  if (process.pid !== 1) {
    return false;
  }
  try {
    const link = await deps.readlink("/proc/1/exe");
    // /proc/<pid>/exe magic-symlink resolves to the absolute path of the
    // running executable. If we are PID 1 in our own namespace, that is us.
    return link !== process.execPath;
  } catch {
    // Default-deny: if we cannot verify, assume we share the host namespace.
    return true;
  }
}

export async function findLingeringKeybasePids(
  resolvedBinary: string,
  keybaseHome: string,
  deps: Pick<RuntimeDeps, "readFile" | "readdir" | "readlink">,
): Promise<number[]> {
  if (await isHostPidNamespace(deps)) {
    process.stderr.write(
      "[keybase] skipping lingering-pid scan: appears to share PID namespace with host\n",
    );
    return [];
  }

  let entries: string[];
  try {
    entries = await deps.readdir("/proc");
  } catch {
    return [];
  }

  const ppidMap = await buildPpidMap(entries, deps);
  const expectedExeBasename = path.basename(resolvedBinary);
  const expectedExePath = path.isAbsolute(resolvedBinary) ? resolvedBinary : undefined;
  const expectedEnvToken = `KEYBASE_HOME=${keybaseHome}`;

  const pids: number[] = [];
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

    let exeLink: string;
    try {
      exeLink = await deps.readlink(path.join("/proc", entry, "exe"));
    } catch {
      // Default-deny on EACCES/ENOENT or any other readlink failure.
      continue;
    }
    if (path.basename(exeLink) !== expectedExeBasename) {
      continue;
    }
    if (expectedExePath && exeLink !== expectedExePath) {
      continue;
    }

    let environRaw: string;
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

async function stopLingeringKeybaseProcesses(
  resolved: Pick<ResolvedKeybaseContainerConfig, "binary" | "homeDir">,
  deps: Pick<RuntimeDeps, "killProcess" | "readFile" | "readdir" | "readlink" | "sleep">,
): Promise<void> {
  const pids = await findLingeringKeybasePids(resolved.binary, resolved.homeDir, deps);
  for (const pid of pids) {
    try {
      deps.killProcess(pid, "SIGTERM");
    } catch {
      // The process may already be gone.
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
      // Process exited after SIGTERM.
    }
  }
}

async function stopExistingKeybaseService(
  resolved: ResolvedKeybaseContainerConfig,
  deps: Pick<RuntimeDeps, "killProcess" | "readFile" | "readdir" | "readlink" | "rm" | "sleep">,
): Promise<void> {
  try {
    const rawPid = await deps.readFile(resolved.pidFile, "utf8");
    const pid = Number.parseInt(rawPid.trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        deps.killProcess(pid, "SIGTERM");
        await deps.sleep(1_000);
      } catch {
        // The process may already be gone; stale pid files are cleaned below.
      }
      try {
        deps.killProcess(pid, 0);
        deps.killProcess(pid, "SIGKILL");
      } catch {
        // Process exited after SIGTERM or the pid file was stale.
      }
    }
  } catch {
    // No pid file is fine; remove any stale socket/pid paths below.
  }
  await stopLingeringKeybaseProcesses(resolved, deps);
  await Promise.all([
    deps.rm(resolved.socketFile, { force: true }),
    deps.rm(resolved.pidFile, { force: true }),
  ]);
}

async function startKeybaseService(
  resolved: ResolvedKeybaseContainerConfig,
  paperKey: string,
  deps: Pick<
    RuntimeDeps,
    "killProcess" | "readFile" | "readdir" | "readlink" | "rm" | "sleep" | "spawn" | "stat"
  >,
): Promise<void> {
  const username = normalizeOptionalString(resolved.username);
  if (!username) {
    throw new Error("KEYBASE_USERNAME is required to start the Keybase service.");
  }
  const env = buildKeybaseCommandEnv(resolved);
  const args = [...buildKeybaseBaseArgs(resolved), "service", "--oneshot-username", username];

  let lastError: unknown;
  for (let attempt = 0; attempt < KEYBASE_SERVICE_MAX_ATTEMPTS; attempt++) {
    const child = deps.spawn(resolved.binary, args, {
      env,
      stdio: ["pipe", "ignore", "pipe"],
    });

    if (!child.stdin) {
      throw new Error("Keybase service child process did not expose stdin");
    }

    let stderr = "";
    let ready = false;
    let earlyExitError: Error | undefined;
    let earlyExitAlreadyRunning = false;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string | Buffer) => {
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
    child.stdin.end(`${paperKey.trim()}\n`);

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

    const deadline = Date.now() + 30_000;
    lastError = undefined;
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
            "-disable-typing=true",
          ],
          env,
          deps,
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
    if (
      attempt < KEYBASE_SERVICE_MAX_ATTEMPTS - 1 &&
      (earlyExitAlreadyRunning || isKeybaseLoginRequiredError(lastError))
    ) {
      await stopExistingKeybaseService(resolved, deps);
      continue;
    }
    throw new Error(`Keybase service did not become ready: ${String(lastError)}`);
  }

  throw new Error(`Keybase service did not become ready: ${String(lastError)}`);
}

async function isExistingKeybaseServiceReady(
  resolved: ResolvedKeybaseContainerConfig,
  deps: Pick<RuntimeDeps, "spawn" | "stat">,
): Promise<boolean> {
  try {
    await deps.stat(resolved.socketFile);
    await runKeybaseCommand(
      resolved.binary,
      [...buildKeybaseBaseArgs(resolved), "whoami"],
      buildKeybaseCommandEnv(resolved),
      deps,
    );
    return true;
  } catch {
    return false;
  }
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
  const runtimeResolved = await materializeRuntimePaperKeyFile(resolved, runtimeDeps);

  const nextConfig = applyKeybaseContainerConfig(
    await readExistingConfig(resolved.configPath, runtimeDeps),
    runtimeResolved,
  );
  // M-5: openclaw.json may carry tokens, paper-key paths, and other
  // identity-binding state. Default 0644 is too loose for a multi-user host;
  // pin to 0600 (owner read/write) so it stays out of "world readable" mode
  // even on permissive umasks.
  await runtimeDeps.writeFile(resolved.configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
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

export function buildSpawnEnv(
  resolved: Pick<ResolvedKeybaseContainerConfig, "tmpDir">,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {
    ...env,
    KEYBASE_SERVICE: normalizeOptionalString(env.KEYBASE_SERVICE) ?? "1",
    TMPDIR: normalizeOptionalString(env.TMPDIR) ?? resolved.tmpDir,
  };
  // H-5: avoid leaking paper-key material to the wrapped workload
  delete next.KEYBASE_PAPERKEY;
  // H-5: avoid leaking paper-key material to the wrapped workload
  delete next.KEYBASE_PAPERKEY_FILE;
  return next;
}

function childExitCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (signal) {
    return 1;
  }
  return typeof code === "number" ? code : 1;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.killed) {
    child.kill(signal);
  }
}

async function waitForManagedChild(child: ChildProcess): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    let settled = false;
    let shutdownTimer: NodeJS.Timeout | undefined;
    const finish = (exitCode: number) => {
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
    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(childExitCode(code, signal));
    };
    const handleError = (error: Error) => {
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
    const forwardSignal = (signal: NodeJS.Signals) => {
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

  const child = runtimeDeps.spawn(argv[0], argv.slice(1), {
    env: buildSpawnEnv(resolved),
    stdio: "inherit",
  });

  return await waitForManagedChild(child);
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
