import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
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
  runCommand?: KeybaseCommandRunner;
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

export function buildKeybaseBaseArgs(
  options: Pick<KeybaseCliTransportOptions, "homeDir"> = {},
): string[] {
  const homeDir =
    typeof options.homeDir === "string" && options.homeDir.trim().length > 0
      ? options.homeDir.trim()
      : undefined;
  return homeDir ? ["--home", homeDir] : [];
}

export function buildKeybaseApiArgs(
  request: KeybaseApiRequest,
  options: Pick<KeybaseCliTransportOptions, "homeDir"> = {},
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
  options: Pick<KeybaseCliTransportOptions, "homeDir"> = {},
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
  options: Pick<KeybaseCliTransportOptions, "homeDir"> = {},
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
    paperKey: string;
    username: string;
  },
  options: Pick<KeybaseCliTransportOptions, "homeDir"> = {},
): string[] {
  return [
    ...buildKeybaseBaseArgs(options),
    "oneshot",
    "--username",
    params.username,
    "--paperkey",
    params.paperKey,
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
  const runCommand = options.runCommand ?? defaultRunCommand;
  await runCommand(resolveBinary(options), buildKeybaseOneshotArgs(params, options), {
    env: options.env,
    maxBuffer: options.maxBuffer,
    timeoutMs: options.timeoutMs,
  });
}

export function startKeybaseApiListen(
  params: {
    listen?: KeybaseApiListenOptions;
    onError?: (error: Error) => void;
    onEvent: (event: KeybaseListenEvent) => void;
    onExit?: (info: KeybaseListenExitInfo) => void;
  } & KeybaseCliTransportOptions,
): KeybaseListenHandle {
  const spawnCommand = params.spawnCommand ?? spawn;
  const child = spawnCommand(
    resolveBinary(params),
    buildKeybaseApiListenArgs(params.listen, params),
    {
      env: params.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (!child.stdout || !child.stderr) {
    throw new Error("Keybase api-listen child process did not expose stdout/stderr");
  }

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string | Buffer) => {
    stderr += chunk.toString();
  });
  child.on("error", (error) => {
    params.onError?.(error);
  });

  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    try {
      params.onEvent(parseKeybaseListenEvent(line));
    } catch (error) {
      params.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });
  child.on("close", (code, signal) => {
    params.onExit?.({ code, signal, stderr });
  });

  return {
    child,
    stop() {
      reader.close();
      if (!child.killed) {
        child.kill();
      }
    },
  };
}
