export type KeybaseMembersType = "impteamnative" | "impteamupgrade" | "team";

export type KeybaseTopicType = "CHAT" | "DEV" | "chat" | "dev";

export interface KeybaseChatChannel {
  name: string;
  public?: boolean;
  membersType?: string;
  topicType?: string;
  topicName?: string;
}

export type KeybaseConversationRef =
  | {
      channel: KeybaseChatChannel;
      conversationId?: never;
    }
  | {
      channel?: never;
      conversationId: string;
    };

export interface KeybasePaginationCursor {
  next?: string;
  num?: number;
  previous?: string;
}

export interface KeybaseApiRequest<
  TOptions extends Record<string, unknown> = Record<string, unknown>,
> {
  method: string;
  params?: {
    options: TOptions;
  };
}

export interface KeybaseApiError {
  code?: number;
  details?: unknown;
  message: string;
  raw: unknown;
}

export interface KeybaseApiResponse<TResult = unknown> {
  error: KeybaseApiError | null;
  raw: unknown;
  result?: TResult;
}

export interface KeybaseCommandDefinition {
  description: string;
  name: string;
  usage?: string;
}

export type KeybaseCommandAdvertisementType = "conv" | "public" | "teamconvs" | "teammembers";

export interface KeybaseCommandAdvertisement {
  commands: readonly KeybaseCommandDefinition[];
  convId?: string;
  teamName?: string;
  type: KeybaseCommandAdvertisementType;
}

type KeybaseSerializedChannel = {
  members_type?: string;
  name: string;
  public?: boolean;
  topic_name?: string;
  topic_type?: string;
};

type KeybaseConversationOptions =
  | {
      channel: KeybaseSerializedChannel;
      conversation_id?: never;
    }
  | {
      channel?: never;
      conversation_id: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function serializeChannel(channel: KeybaseChatChannel): KeybaseSerializedChannel {
  const name = readNonEmptyString(channel.name, "Keybase channel name");
  const topicName =
    typeof channel.topicName === "string" && channel.topicName.trim().length > 0
      ? channel.topicName.trim()
      : undefined;
  const membersType =
    typeof channel.membersType === "string" && channel.membersType.trim().length > 0
      ? channel.membersType.trim()
      : undefined;
  const topicType =
    typeof channel.topicType === "string" && channel.topicType.trim().length > 0
      ? channel.topicType.trim()
      : undefined;

  return {
    name,
    ...(channel.public === true ? { public: true } : {}),
    ...(membersType ? { members_type: membersType } : {}),
    ...(topicName ? { topic_name: topicName } : {}),
    ...(topicType ? { topic_type: topicType } : {}),
  };
}

function serializeConversationRef(ref: KeybaseConversationRef): KeybaseConversationOptions {
  if ("conversationId" in ref) {
    return {
      conversation_id: readNonEmptyString(ref.conversationId, "Keybase conversationId"),
    };
  }

  return {
    channel: serializeChannel(ref.channel),
  };
}

function buildRequest<TOptions extends Record<string, unknown>>(
  method: string,
  options?: TOptions,
): KeybaseApiRequest<TOptions> {
  return options === undefined
    ? { method }
    : {
        method,
        params: {
          options,
        },
      };
}

export class KeybaseApiResponseError extends Error {
  readonly response: KeybaseApiResponse;

  constructor(response: KeybaseApiResponse) {
    super(response.error?.message ?? "Keybase API response did not include a result");
    this.name = "KeybaseApiResponseError";
    this.response = response;
  }
}

export function buildKeybaseDirectChannel(usernames: readonly string[]): KeybaseChatChannel {
  const normalized = [
    ...new Set(usernames.map((value) => readNonEmptyString(value, "username").toLowerCase())),
  ].toSorted((left, right) => left.localeCompare(right));
  if (normalized.length === 0) {
    throw new Error("Keybase direct channels require at least one username");
  }
  return {
    name: normalized.join(","),
  };
}

export function buildKeybaseTeamChannel(
  teamName: string,
  topicName: string,
  options: {
    membersType?: KeybaseMembersType;
    public?: boolean;
    topicType?: KeybaseTopicType;
  } = {},
): KeybaseChatChannel {
  return {
    name: readNonEmptyString(teamName, "Keybase teamName"),
    topicName: readNonEmptyString(topicName, "Keybase topicName"),
    membersType: options.membersType ?? "team",
    ...(options.public === true ? { public: true } : {}),
    ...(options.topicType ? { topicType: options.topicType } : {}),
  };
}

export function buildKeybaseSendRequest(
  params: KeybaseConversationRef & {
    body: string;
    replyTo?: number;
  },
): KeybaseApiRequest {
  const options = {
    ...serializeConversationRef(params),
    message: {
      body: readNonEmptyString(params.body, "Keybase send body"),
    },
    ...(params.replyTo !== undefined ? { reply_to: params.replyTo } : {}),
  };
  return buildRequest("send", options);
}

export function buildKeybaseEditRequest(
  params: KeybaseConversationRef & {
    body: string;
    messageId: number;
  },
): KeybaseApiRequest {
  return buildRequest("edit", {
    ...serializeConversationRef(params),
    message: {
      body: readNonEmptyString(params.body, "Keybase edit body"),
    },
    message_id: params.messageId,
  });
}

export function buildKeybaseReactionRequest(
  params: KeybaseConversationRef & {
    body: string;
    messageId: number;
  },
): KeybaseApiRequest {
  return buildRequest("reaction", {
    ...serializeConversationRef(params),
    message: {
      body: readNonEmptyString(params.body, "Keybase reaction body"),
    },
    message_id: params.messageId,
  });
}

export function buildKeybaseDeleteRequest(
  params: KeybaseConversationRef & {
    messageId: number;
  },
): KeybaseApiRequest {
  return buildRequest("delete", {
    ...serializeConversationRef(params),
    message_id: params.messageId,
  });
}

export function buildKeybaseAttachRequest(
  params: KeybaseConversationRef & {
    filename: string;
    title?: string;
  },
): KeybaseApiRequest {
  return buildRequest("attach", {
    ...serializeConversationRef(params),
    filename: readNonEmptyString(params.filename, "Keybase attachment filename"),
    ...(typeof params.title === "string" && params.title.trim().length > 0
      ? { title: params.title.trim() }
      : {}),
  });
}

export function buildKeybasePinRequest(
  params: KeybaseConversationRef & {
    messageId: number;
  },
): KeybaseApiRequest {
  return buildRequest("pin", {
    ...serializeConversationRef(params),
    message_id: params.messageId,
  });
}

export function buildKeybaseUnpinRequest(params: KeybaseConversationRef): KeybaseApiRequest {
  return buildRequest("unpin", serializeConversationRef(params));
}

export function buildKeybaseReadRequest(
  params: KeybaseConversationRef & {
    pagination?: KeybasePaginationCursor;
    peek?: boolean;
    unreadOnly?: boolean;
  },
): KeybaseApiRequest {
  return buildRequest("read", {
    ...serializeConversationRef(params),
    ...(params.peek === true ? { peek: true } : {}),
    ...(params.unreadOnly === true ? { unread_only: true } : {}),
    ...(params.pagination ? { pagination: params.pagination } : {}),
  });
}

export function buildKeybaseListTeamChannelsRequest(params: {
  membersType?: KeybaseMembersType;
  teamName: string;
  topicType?: KeybaseTopicType;
}): KeybaseApiRequest {
  return buildRequest("listconvsonname", {
    members_type: params.membersType ?? "team",
    name: readNonEmptyString(params.teamName, "Keybase teamName"),
    topic_type: params.topicType ?? "CHAT",
  });
}

export function buildKeybaseJoinChannelRequest(params: {
  channel: KeybaseChatChannel;
}): KeybaseApiRequest {
  return buildRequest("join", {
    channel: serializeChannel(params.channel),
  });
}

export function buildKeybaseLeaveChannelRequest(params: {
  channel: KeybaseChatChannel;
}): KeybaseApiRequest {
  return buildRequest("leave", {
    channel: serializeChannel(params.channel),
  });
}

export function buildKeybaseListCommandsRequest(params: KeybaseConversationRef): KeybaseApiRequest {
  return buildRequest("listcommands", serializeConversationRef(params));
}

export function buildKeybaseClearCommandsRequest(): KeybaseApiRequest {
  return buildRequest("clearcommands");
}

export function buildKeybaseAdvertiseCommandsRequest(params: {
  advertisements: readonly KeybaseCommandAdvertisement[];
  alias?: string;
}): KeybaseApiRequest {
  return buildRequest("advertisecommands", {
    ...(typeof params.alias === "string" && params.alias.trim().length > 0
      ? { alias: params.alias.trim() }
      : {}),
    advertisements: params.advertisements.map((advertisement) => ({
      type: advertisement.type,
      ...(advertisement.teamName
        ? { team_name: readNonEmptyString(advertisement.teamName, "Keybase teamName") }
        : {}),
      ...(advertisement.convId
        ? { conv_id: readNonEmptyString(advertisement.convId, "Keybase convId") }
        : {}),
      commands: advertisement.commands.map((command) => ({
        name: readNonEmptyString(command.name, "Keybase command name"),
        description: readNonEmptyString(command.description, "Keybase command description"),
        ...(typeof command.usage === "string" && command.usage.trim().length > 0
          ? { usage: command.usage.trim() }
          : {}),
      })),
    })),
  });
}

export function serializeKeybaseApiRequest(request: KeybaseApiRequest): string {
  return JSON.stringify(request);
}

function parseKeybaseApiError(error: unknown): KeybaseApiError | null {
  if (error === null || error === undefined) {
    return null;
  }
  if (typeof error === "string") {
    return {
      message: error,
      raw: error,
    };
  }
  if (isRecord(error)) {
    const message =
      typeof error.message === "string"
        ? error.message
        : typeof error.error === "string"
          ? error.error
          : typeof error.desc === "string"
            ? error.desc
            : JSON.stringify(error);
    return {
      ...(typeof error.code === "number" ? { code: error.code } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
      message,
      raw: error,
    };
  }
  let fallbackMessage = "Unknown Keybase API error";
  try {
    fallbackMessage = JSON.stringify(error);
  } catch {
    fallbackMessage = Object.prototype.toString.call(error);
  }
  return {
    message: fallbackMessage,
    raw: error,
  };
}

export function parseKeybaseApiResponse<TResult = unknown>(
  raw: string,
): KeybaseApiResponse<TResult> {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Keybase API response must be a JSON object");
  }
  return {
    error: parseKeybaseApiError(parsed.error),
    raw: parsed,
    ...(parsed.result !== undefined ? { result: parsed.result as TResult } : {}),
  };
}

export function expectKeybaseApiResult<TResult>(response: KeybaseApiResponse<TResult>): TResult {
  if (response.error) {
    throw new KeybaseApiResponseError(response);
  }
  if (!("result" in response)) {
    throw new KeybaseApiResponseError(response);
  }
  return response.result as TResult;
}
