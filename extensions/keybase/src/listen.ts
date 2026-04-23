import type { KeybaseChatChannel } from "./protocol.js";

export interface KeybaseListenMessageSender {
  deviceId?: string;
  deviceName?: string;
  uid?: string;
  username?: string;
}

export interface KeybaseListenTextContent {
  body: string;
  replyTo?: number;
  replyToUid?: string;
}

export interface KeybaseListenEditContent {
  body?: string;
  messageId?: number;
}

export interface KeybaseListenReactionContent {
  body?: string;
  messageId?: number;
  targetUid?: string;
}

export interface KeybaseListenDeleteContent {
  messageIds: number[];
}

export interface KeybaseListenAttachmentUploadedContent {
  messageId?: number;
}

export interface KeybaseListenMessageContent {
  attachmentUploaded?: KeybaseListenAttachmentUploadedContent;
  delete?: KeybaseListenDeleteContent;
  edit?: KeybaseListenEditContent;
  raw: Record<string, unknown>;
  reaction?: KeybaseListenReactionContent;
  text?: KeybaseListenTextContent;
  type: string;
}

export interface KeybaseListenMessage {
  atMentionUsernames: string[];
  botUsername?: string;
  channel: KeybaseChatChannel;
  channelMention?: string;
  content: KeybaseListenMessageContent;
  conversationId: string;
  id: number;
  raw: Record<string, unknown>;
  sender: KeybaseListenMessageSender;
  sentAt?: number;
  sentAtMs?: number;
  unread?: boolean;
}

export interface KeybaseListenConversation {
  activeAt?: number;
  activeAtMs?: number;
  channel: KeybaseChatChannel;
  id: string;
  memberStatus?: string;
  raw: Record<string, unknown>;
  unread?: boolean;
}

export interface KeybaseChatListenEvent {
  error?: string;
  message?: KeybaseListenMessage;
  raw: Record<string, unknown>;
  source?: string;
  type: "chat";
}

export interface KeybaseConversationListenEvent {
  conversation?: KeybaseListenConversation;
  error?: string;
  raw: Record<string, unknown>;
  type: "chat_conv";
}

export interface KeybaseWalletListenEvent {
  raw: Record<string, unknown>;
  type: "wallet";
}

export interface KeybaseUnknownListenEvent {
  raw: Record<string, unknown>;
  rawType: string;
  type: "unknown";
}

export type KeybaseListenEvent =
  | KeybaseChatListenEvent
  | KeybaseConversationListenEvent
  | KeybaseWalletListenEvent
  | KeybaseUnknownListenEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalRecord(
  record: Record<string, unknown>,
  ...keys: readonly string[]
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) {
      return value;
    }
  }
  return undefined;
}

function readOptionalString(
  record: Record<string, unknown>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function readOptionalNumber(
  record: Record<string, unknown>,
  ...keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && /^-?\d+$/.test(value)) {
      return Number.parseInt(value, 10);
    }
  }
  return undefined;
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  ...keys: readonly string[]
): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function readStringArray(record: Record<string, unknown>, ...keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
  }
  return [];
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  containerName: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${containerName}.${key} must be a non-empty string`);
  }
  return value;
}

function parseChannel(record: Record<string, unknown>): KeybaseChatChannel {
  return {
    name: readRequiredString(record, "name", "Keybase channel"),
    ...(readOptionalBoolean(record, "public") !== undefined
      ? { public: readOptionalBoolean(record, "public") }
      : {}),
    ...(readOptionalString(record, "members_type", "membersType")
      ? { membersType: readOptionalString(record, "members_type", "membersType") }
      : {}),
    ...(readOptionalString(record, "topic_type", "topicType")
      ? { topicType: readOptionalString(record, "topic_type", "topicType") }
      : {}),
    ...(readOptionalString(record, "topic_name", "topicName")
      ? { topicName: readOptionalString(record, "topic_name", "topicName") }
      : {}),
  };
}

function parseSender(record: Record<string, unknown>): KeybaseListenMessageSender {
  return {
    ...(readOptionalString(record, "uid") ? { uid: readOptionalString(record, "uid") } : {}),
    ...(readOptionalString(record, "username")
      ? { username: readOptionalString(record, "username") }
      : {}),
    ...(readOptionalString(record, "device_id", "deviceID")
      ? { deviceId: readOptionalString(record, "device_id", "deviceID") }
      : {}),
    ...(readOptionalString(record, "device_name", "deviceName")
      ? { deviceName: readOptionalString(record, "device_name", "deviceName") }
      : {}),
  };
}

function parseContent(record: Record<string, unknown>): KeybaseListenMessageContent {
  const type = readRequiredString(record, "type", "Keybase message content");
  const text = readOptionalRecord(record, "text");
  const edit = readOptionalRecord(record, "edit");
  const reaction = readOptionalRecord(record, "reaction");
  const deleteRecord = readOptionalRecord(record, "delete");
  const attachmentUploaded = readOptionalRecord(
    record,
    "attachment_uploaded",
    "attachmentUploaded",
  );
  const textReplyTo = text ? readOptionalNumber(text, "replyTo") : undefined;
  const textReplyToUid = text ? readOptionalString(text, "replyToUID", "reply_to_uid") : undefined;
  const editBody = edit ? readOptionalString(edit, "body") : undefined;
  const editMessageId = edit ? readOptionalNumber(edit, "messageID", "message_id") : undefined;
  const reactionBody = reaction ? readOptionalString(reaction, "b", "body") : undefined;
  const reactionMessageId = reaction
    ? readOptionalNumber(reaction, "m", "messageID", "message_id")
    : undefined;
  const reactionTargetUid = reaction
    ? readOptionalString(reaction, "t", "targetUID", "target_uid")
    : undefined;
  const attachmentUploadedMessageId = attachmentUploaded
    ? readOptionalNumber(attachmentUploaded, "messageID", "message_id")
    : undefined;

  return {
    type,
    raw: record,
    ...(text
      ? {
          text: {
            body: readOptionalString(text, "body") ?? "",
            ...(textReplyTo !== undefined ? { replyTo: textReplyTo } : {}),
            ...(textReplyToUid ? { replyToUid: textReplyToUid } : {}),
          },
        }
      : {}),
    ...(edit
      ? {
          edit: {
            ...(editBody ? { body: editBody } : {}),
            ...(editMessageId !== undefined ? { messageId: editMessageId } : {}),
          },
        }
      : {}),
    ...(reaction
      ? {
          reaction: {
            ...(reactionBody ? { body: reactionBody } : {}),
            ...(reactionMessageId !== undefined ? { messageId: reactionMessageId } : {}),
            ...(reactionTargetUid ? { targetUid: reactionTargetUid } : {}),
          },
        }
      : {}),
    ...(deleteRecord
      ? {
          delete: {
            messageIds: (() => {
              const value = deleteRecord.messageIDs;
              if (!Array.isArray(value)) {
                return [];
              }
              return value
                .map((entry) => {
                  if (typeof entry === "number" && Number.isFinite(entry)) {
                    return entry;
                  }
                  if (typeof entry === "string" && /^-?\d+$/.test(entry)) {
                    return Number.parseInt(entry, 10);
                  }
                  return undefined;
                })
                .filter((entry): entry is number => entry !== undefined);
            })(),
          },
        }
      : {}),
    ...(attachmentUploaded
      ? {
          attachmentUploaded:
            attachmentUploadedMessageId !== undefined
              ? { messageId: attachmentUploadedMessageId }
              : {},
        }
      : {}),
  };
}

function parseMessage(record: Record<string, unknown>): KeybaseListenMessage {
  const channel = readOptionalRecord(record, "channel");
  const sender = readOptionalRecord(record, "sender");
  const content = readOptionalRecord(record, "content");
  if (!channel || !sender || !content) {
    throw new Error("Keybase listen message must include channel, sender, and content");
  }

  return {
    id: readOptionalNumber(record, "id") ?? 0,
    conversationId: readRequiredString(record, "conversation_id", "Keybase listen message"),
    channel: parseChannel(channel),
    sender: parseSender(sender),
    content: parseContent(content),
    raw: record,
    atMentionUsernames: readStringArray(record, "at_mention_usernames", "atMentionUsernames"),
    ...(readOptionalString(record, "channel_mention", "channelMention")
      ? { channelMention: readOptionalString(record, "channel_mention", "channelMention") }
      : {}),
    ...(readOptionalRecord(record, "bot_info", "botInfo")
      ? {
          botUsername: readOptionalString(
            readOptionalRecord(record, "bot_info", "botInfo") as Record<string, unknown>,
            "bot_username",
            "botUsername",
          ),
        }
      : {}),
    ...(readOptionalNumber(record, "sent_at") !== undefined
      ? { sentAt: readOptionalNumber(record, "sent_at") }
      : {}),
    ...(readOptionalNumber(record, "sent_at_ms") !== undefined
      ? { sentAtMs: readOptionalNumber(record, "sent_at_ms") }
      : {}),
    ...(readOptionalBoolean(record, "unread") !== undefined
      ? { unread: readOptionalBoolean(record, "unread") }
      : {}),
  };
}

function parseConversation(record: Record<string, unknown>): KeybaseListenConversation {
  const channel = readOptionalRecord(record, "channel");
  if (!channel) {
    throw new Error("Keybase listen conversation must include channel");
  }

  return {
    id: readRequiredString(record, "id", "Keybase listen conversation"),
    channel: parseChannel(channel),
    raw: record,
    ...(readOptionalNumber(record, "active_at") !== undefined
      ? { activeAt: readOptionalNumber(record, "active_at") }
      : {}),
    ...(readOptionalNumber(record, "active_at_ms") !== undefined
      ? { activeAtMs: readOptionalNumber(record, "active_at_ms") }
      : {}),
    ...(readOptionalString(record, "member_status")
      ? { memberStatus: readOptionalString(record, "member_status") }
      : {}),
    ...(readOptionalBoolean(record, "unread") !== undefined
      ? { unread: readOptionalBoolean(record, "unread") }
      : {}),
  };
}

export function parseKeybaseListenEvent(line: string): KeybaseListenEvent {
  const parsed = JSON.parse(line) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Keybase listen event must be a JSON object");
  }
  const rawType = readRequiredString(parsed, "type", "Keybase listen event");

  switch (rawType) {
    case "chat":
      return {
        type: "chat",
        raw: parsed,
        ...(readOptionalString(parsed, "source")
          ? { source: readOptionalString(parsed, "source") }
          : {}),
        ...(readOptionalString(parsed, "error")
          ? { error: readOptionalString(parsed, "error") }
          : {}),
        ...(readOptionalRecord(parsed, "msg")
          ? { message: parseMessage(readOptionalRecord(parsed, "msg") as Record<string, unknown>) }
          : {}),
      };
    case "chat_conv":
      return {
        type: "chat_conv",
        raw: parsed,
        ...(readOptionalString(parsed, "error")
          ? { error: readOptionalString(parsed, "error") }
          : {}),
        ...(readOptionalRecord(parsed, "conv")
          ? {
              conversation: parseConversation(
                readOptionalRecord(parsed, "conv") as Record<string, unknown>,
              ),
            }
          : {}),
      };
    case "wallet":
      return {
        type: "wallet",
        raw: parsed,
      };
    default:
      return {
        type: "unknown",
        rawType,
        raw: parsed,
      };
  }
}
