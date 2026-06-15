import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { parseKeybaseListenEvent, type KeybaseListenEvent } from "./listen.js";
import {
  expectKeybaseApiResult,
  parseKeybaseApiResponse,
  serializeKeybaseApiRequest,
  type KeybaseApiRequest,
  type KeybaseChatChannel,
} from "./protocol.js";

export interface KeybaseCommandOutput {
  stderr: string;
  stdout: string;
}

export type { KeybaseListenEvent } from "./listen.js";

export const KEYBASE_API_LISTEN_MAX_RESTART_ATTEMPTS = 100;
export const KEYBASE_API_LISTEN_MAX_BACKOFF_MS = 30_000;
export const KEYBASE_API_LISTEN_UPTIME_RESET_MS = 30_000;
export const KEYBASE_STDERR_RING_BYTES = 65_536;
export const KEYBASE_READLINE_MAX_LINE_LENGTH = 1_048_576;

export function appendKeybaseStderr(
  buffer: string,
  chunk: string,
  maxBytes: number = KEYBASE_STDERR_RING_BYTES,
): string {
  const combined = buffer + chunk;
  if (combined.length <= maxBytes) {
    return combined;
  }
  return combined.slice(combined.length - maxBytes);
}

export interface KeybaseCommandRunOptions {
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  timeoutMs?: number;
}

export type KeybaseCommandRunner = (
  command: string,
  args: readonly string[],
  options: KeybaseCommandRunOptions,
) => Promise<KeybaseCommandOutput>;

export interface KeybaseCliTransportOptions {
  binary?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  maxBuffer?: number;
  pidFile?: string;
  runCommand?: KeybaseCommandRunner;
  socketFile?: string;
  spawnCommand?: typeof spawn;
  timeoutMs?: number;
}

export interface KeybaseApiListenOptions {
  convs?: boolean;
  dev?: boolean;
  filterChannel?: KeybaseChatChannel;
  filterChannels?: readonly KeybaseChatChannel[];
  hideExploding?: boolean;
  local?: boolean;
  wallet?: boolean;
}

export interface KeybaseListenExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

export interface KeybaseListenHandle {
  child: ChildProcessByStdio<null, Readable, Readable>;
  stop(): void;
}

type KeybaseApiListenLineReader = {
  close(): void;
};

export class KeybaseCliCommandError extends Error {
  readonly args: readonly string[];
  readonly command: string;
  readonly stderr?: string;
  readonly stdout?: string;

  constructor(params: {
    args: readonly string[];
    cause?: unknown;
    command: string;
    message: string;
    stderr?: string;
    stdout?: string;
  }) {
    super(params.message, params.cause !== undefined ? { cause: params.cause } : undefined);
    this.name = "KeybaseCliCommandError";
    this.command = params.command;
    this.args = params.args;
    this.stdout = params.stdout;
    this.stderr = params.stderr;
  }
}

function readNonEmptyString(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function serializeChannel(channel: KeybaseChatChannel) {
  return {
    name: channel.name,
    ...(channel.public === true ? { public: true } : {}),
    ...(channel.membersType ? { members_type: channel.membersType } : {}),
    ...(channel.topicName ? { topic_name: channel.topicName } : {}),
    ...(channel.topicType ? { topic_type: channel.topicType } : {}),
  };
}

async function defaultRunCommand(
  command: string,
  args: readonly string[],
  options: KeybaseCommandRunOptions,
): Promise<KeybaseCommandOutput> {
  return await new Promise<KeybaseCommandOutput>((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        env: options.env,
        encoding: "utf8",
        maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
        timeout: options.timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new KeybaseCliCommandError({
              args,
              cause: error,
              command,
              message: `Keybase command failed: ${command} ${args.join(" ")}`,
              stderr,
              stdout,
            }),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function resolveBinary(options?: KeybaseCliTransportOptions): string {
  return readNonEmptyString(options?.binary, "keybase");
}

function isKeybaseSocketBootstrapError(stderr: string): boolean {
  const normalized = stderr.toLowerCase();
  return normalized.includes("keybased.sock") && normalized.includes("no such file or directory");
}

function createKeybaseApiListenLineReader(params: {
  input: Readable;
  maxLineLength?: number;
  onError?: (error: Error) => void;
  onLine: (line: string) => void;
}): KeybaseApiListenLineReader {
  const maxLineLength = Math.max(1, params.maxLineLength ?? KEYBASE_READLINE_MAX_LINE_LENGTH);
  let buffer = "";
  let discardingOverlongLine = false;

  const reportOverlongLine = () => {
    params.onError?.(
      new Error(`Keybase api-listen stdout line exceeded ${maxLineLength} characters`),
    );
  };

  const emitLine = (line: string) => {
    params.onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  };

  const onData = (chunk: string | Buffer) => {
    let text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    while (text.length > 0) {
      const newlineIndex = text.indexOf("\n");
      const hasNewline = newlineIndex >= 0;
      const segment = hasNewline ? text.slice(0, newlineIndex) : text;
      text = hasNewline ? text.slice(newlineIndex + 1) : "";

      if (discardingOverlongLine) {
        if (hasNewline) {
          discardingOverlongLine = false;
        }
        continue;
      }

      if (buffer.length + segment.length > maxLineLength) {
        buffer = "";
        discardingOverlongLine = !hasNewline;
        reportOverlongLine();
        continue;
      }

      if (hasNewline) {
        emitLine(`${buffer}${segment}`);
        buffer = "";
      } else {
        buffer += segment;
      }
    }
  };

  const onEnd = () => {
    if (!discardingOverlongLine && buffer.length > 0) {
      emitLine(buffer);
    }
    buffer = "";
    discardingOverlongLine = false;
  };

  params.input.setEncoding("utf8");
  params.input.on("data", onData);
  params.input.on("end", onEnd);

  return {
    close() {
      params.input.off("data", onData);
      params.input.off("end", onEnd);
      buffer = "";
      discardingOverlongLine = false;
    },
  };
}

export function buildKeybaseBaseArgs(
  options: Pick<KeybaseCliTransportOptions, "homeDir" | "pidFile" | "socketFile"> = {},
): string[] {
  const args: string[] = [];
  const addPathFlag = (flag: string, value: string | undefined) => {
    const normalized = typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
    if (normalized) {
      args.push(flag, normalized);
    }
  };

  const homeDir =
    typeof options.homeDir === "string" && options.homeDir.trim().length > 0
      ? options.homeDir.trim()
      : undefined;
  addPathFlag("--home", homeDir);
  addPathFlag("--socket-file", options.socketFile);
  addPathFlag("--pid-file", options.pidFile);
  return args;
}

export function buildKeybaseApiArgs(
  request: KeybaseApiRequest,
  options: Pick<KeybaseCliTransportOptions, "homeDir" | "pidFile" | "socketFile"> = {},
): string[] {
  return [
    ...buildKeybaseBaseArgs(options),
    "chat",
    "api",
    "-m",
    serializeKeybaseApiRequest(request),
  ];
}

export function buildKeybaseApiListenArgs(
  listen: KeybaseApiListenOptions = {},
  options: Pick<KeybaseCliTransportOptions, "homeDir" | "pidFile" | "socketFile"> = {},
): string[] {
  const args = [...buildKeybaseBaseArgs(options), "chat", "api-listen"];
  if (listen.local) {
    args.push("--local");
  }
  if (listen.hideExploding) {
    args.push("--hide-exploding");
  }
  if (listen.convs) {
    args.push("--convs");
  }
  if (listen.dev) {
    args.push("--dev");
  }
  if (listen.wallet) {
    args.push("--wallet");
  }
  if (listen.filterChannel) {
    args.push("--filter-channel", JSON.stringify(serializeChannel(listen.filterChannel)));
  }
  if (listen.filterChannels && listen.filterChannels.length > 0) {
    args.push(
      "--filter-channels",
      JSON.stringify(listen.filterChannels.map((channel) => serializeChannel(channel))),
    );
  }
  return args;
}

export function buildKeybaseNotificationSettingsArgs(
  params: {
    enableTyping: boolean;
  },
  options: Pick<KeybaseCliTransportOptions, "homeDir" | "pidFile" | "socketFile"> = {},
): string[] {
  return [
    ...buildKeybaseBaseArgs(options),
    "chat",
    "notification-settings",
    `-disable-typing=${String(!params.enableTyping)}`,
  ];
}

export function buildKeybaseOneshotArgs(
  params: {
    username: string;
  },
  options: Pick<KeybaseCliTransportOptions, "homeDir" | "pidFile" | "socketFile"> = {},
): string[] {
  return [
    ...buildKeybaseBaseArgs(options),
    "service",
    "--oneshot-username",
    params.username.trim(),
  ];
}

export async function keybaseApiRequest<TResult>(
  request: KeybaseApiRequest,
  options: KeybaseCliTransportOptions = {},
): Promise<TResult> {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const { stdout } = await runCommand(
    resolveBinary(options),
    buildKeybaseApiArgs(request, options),
    {
      env: options.env,
      maxBuffer: options.maxBuffer,
      timeoutMs: options.timeoutMs,
    },
  );
  return expectKeybaseApiResult(parseKeybaseApiResponse<TResult>(stdout));
}

export async function keybaseConfigureNotificationSettings(
  params: {
    enableTyping: boolean;
  },
  options: KeybaseCliTransportOptions = {},
): Promise<void> {
  const runCommand = options.runCommand ?? defaultRunCommand;
  await runCommand(resolveBinary(options), buildKeybaseNotificationSettingsArgs(params, options), {
    env: options.env,
    maxBuffer: options.maxBuffer,
    timeoutMs: options.timeoutMs,
  });
}

export async function keybaseOneshot(
  params: {
    paperKey: string;
    username: string;
  },
  options: KeybaseCliTransportOptions = {},
): Promise<void> {
  const spawnCommand = options.spawnCommand ?? spawn;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const command = resolveBinary(options);
  const args = buildKeybaseOneshotArgs(params, options);
  const commandEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    KEYBASE_SERVICE: options.env?.KEYBASE_SERVICE ?? process.env.KEYBASE_SERVICE ?? "1",
  };
  const startupTimeoutMs = options.timeoutMs ?? 30_000;
  const checkReadyOnce = async (): Promise<boolean> => {
    try {
      await runCommand(
        command,
        buildKeybaseNotificationSettingsArgs({ enableTyping: false }, options),
        {
          env: commandEnv,
          maxBuffer: options.maxBuffer,
          timeoutMs: Math.min(startupTimeoutMs, 1_000),
        },
      );
      return true;
    } catch {
      return false;
    }
  };

  if (await checkReadyOnce()) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawnCommand(command, args, {
      env: commandEnv,
      stdio: ["pipe", "ignore", "pipe"],
    });

    if (!child.stdin || !child.stderr) {
      reject(new Error("Keybase oneshot child process did not expose stdio"));
      return;
    }

    let stderr = "";
    let settled = false;
    let ready = false;
    let retryTimer: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    // Attach error/close listeners immediately after the stdio guard so a
    // synchronous spawn failure (e.g., ENOENT delivered on the next tick) is
    // never lost between spawn and stdin.end.
    child.once("error", (error) => {
      finish(
        new KeybaseCliCommandError({
          args,
          cause: error,
          command,
          message: `Keybase command failed: ${command} ${args.join(" ")}`,
          stderr,
        }),
      );
    });
    const buildCloseError = (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal) {
        return new KeybaseCliCommandError({
          args,
          command,
          message: `Keybase command failed: ${command} ${args.join(" ")} (signal ${signal})`,
          stderr,
        });
      }
      return new KeybaseCliCommandError({
        args,
        command,
        message: `Keybase command exited before the service became ready: ${command} ${args.join(" ")}`,
        stderr,
        stdout: typeof code === "number" ? `exit=${code}` : undefined,
      });
    };

    const finishIfReady = async (): Promise<boolean> => {
      if (settled) {
        return true;
      }
      if (await checkReadyOnce()) {
        ready = true;
        finish();
        return true;
      }
      return false;
    };

    child.once("close", (code, signal) => {
      if (ready) {
        return;
      }
      void finishIfReady().then((isReady) => {
        if (!isReady) {
          finish(buildCloseError(code, signal));
        }
      });
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string | Buffer) => {
      stderr = appendKeybaseStderr(stderr, chunk.toString());
    });

    const scheduleReadinessCheck = () => {
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void checkReady();
      }, 250);
    };

    const checkReady = async () => {
      if (settled) {
        return;
      }
      if (!(await finishIfReady())) {
        scheduleReadinessCheck();
      }
    };

    timeout = setTimeout(() => {
      if (!child.killed) {
        child.kill();
      }
      finish(
        new KeybaseCliCommandError({
          args,
          command,
          message: `Keybase command timed out before the service became ready: ${command} ${args.join(" ")}`,
          stderr,
        }),
      );
    }, startupTimeoutMs);

    child.stdin.end(`${params.paperKey.trim()}\n`);
    void checkReady();
  });
}

export function startKeybaseApiListen(
  params: {
    bootstrapRetryDelayMs?: number;
    bootstrapRetryMaxAttempts?: number;
    listen?: KeybaseApiListenOptions;
    onError?: (error: Error) => void;
    onEvent: (event: KeybaseListenEvent) => void;
    onExit?: (info: KeybaseListenExitInfo) => void;
    restartDelayMs?: number;
    restartMaxAttempts?: number;
    restartOnExit?: boolean;
  } & KeybaseCliTransportOptions,
): KeybaseListenHandle {
  const spawnCommand = params.spawnCommand ?? spawn;
  const maxBootstrapRetries = params.bootstrapRetryMaxAttempts ?? 8;
  const bootstrapRetryDelayMs = params.bootstrapRetryDelayMs ?? 750;
  const restartDelayMs = params.restartDelayMs ?? 2_000;
  const maxRestartAttempts = params.restartMaxAttempts ?? KEYBASE_API_LISTEN_MAX_RESTART_ATTEMPTS;
  let activeChild: ChildProcessByStdio<null, Readable, Readable> | null = null;
  let activeReader: KeybaseApiListenLineReader | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let retryAttempts = 0;
  let restartAttempts = 0;
  let currentRestartDelayMs = restartDelayMs;
  let childStartTime: number | null = null;
  let stopped = false;

  const clearRetryTimer = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const stopActiveChild = () => {
    activeReader?.close();
    activeReader = null;
    if (activeChild && !activeChild.killed) {
      activeChild.kill();
    }
  };

  function scheduleLaunch(delayMs: number) {
    clearRetryTimer();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!stopped) {
        launch();
      }
    }, delayMs);
  }

  function launch() {
    const child = spawnCommand(
      resolveBinary(params),
      buildKeybaseApiListenArgs(params.listen, params),
      {
        env: params.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    activeChild = child;
    childStartTime = Date.now();

    if (!child.stdout || !child.stderr) {
      throw new Error("Keybase api-listen child process did not expose stdout/stderr");
    }

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string | Buffer) => {
      stderr = appendKeybaseStderr(stderr, chunk.toString());
    });
    child.on("error", (error) => {
      if (!stopped) {
        params.onError?.(error);
      }
    });

    const reader = createKeybaseApiListenLineReader({
      input: child.stdout,
      maxLineLength: KEYBASE_READLINE_MAX_LINE_LENGTH,
      onError: params.onError,
      onLine(line) {
        try {
          params.onEvent(parseKeybaseListenEvent(line));
        } catch (error) {
          params.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
    activeReader = reader;

    child.on("close", (code, signal) => {
      const startedAt = childStartTime;
      childStartTime = null;
      if (activeReader === reader) {
        reader.close();
        activeReader = null;
      }
      if (activeChild === child) {
        activeChild = null;
      }
      if (
        !stopped &&
        signal === null &&
        isKeybaseSocketBootstrapError(stderr) &&
        retryAttempts < maxBootstrapRetries
      ) {
        retryAttempts += 1;
        scheduleLaunch(bootstrapRetryDelayMs);
        return;
      }
      if (startedAt !== null && Date.now() - startedAt >= KEYBASE_API_LISTEN_UPTIME_RESET_MS) {
        restartAttempts = 0;
        currentRestartDelayMs = restartDelayMs;
      }
      params.onExit?.({ code, signal, stderr });
      if (!stopped && params.restartOnExit && restartAttempts < maxRestartAttempts) {
        restartAttempts += 1;
        const jitter = 0.8 + Math.random() * 0.4;
        const delay = currentRestartDelayMs * jitter;
        currentRestartDelayMs = Math.min(
          currentRestartDelayMs * 2,
          KEYBASE_API_LISTEN_MAX_BACKOFF_MS,
        );
        scheduleLaunch(delay);
      }
    });
  }

  launch();

  return {
    get child() {
      if (!activeChild) {
        throw new Error("Keybase api-listen child is not running");
      }
      return activeChild;
    },
    stop() {
      stopped = true;
      clearRetryTimer();
      stopActiveChild();
    },
  };
}
