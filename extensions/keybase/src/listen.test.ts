import { describe, expect, it } from "vitest";
import { parseKeybaseListenEvent } from "./listen.js";

describe("parseKeybaseListenEvent", () => {
  it("parses text chat notifications with reply context", () => {
    const event = parseKeybaseListenEvent(
      JSON.stringify({
        type: "chat",
        source: "remote",
        msg: {
          id: 44,
          conversation_id: "conv-1",
          channel: {
            name: "lightninglabs",
            members_type: "team",
            topic_name: "ops",
          },
          sender: {
            username: "roasbeef",
            uid: "uid-1",
          },
          sent_at: 1700000000,
          sent_at_ms: 1700000000123,
          unread: true,
          at_mention_usernames: ["openclaw"],
          content: {
            type: "text",
            text: {
              body: "@openclaw status",
              replyTo: 41,
            },
          },
        },
      }),
    );

    expect(event).toEqual({
      type: "chat",
      source: "remote",
      raw: expect.any(Object),
      message: {
        id: 44,
        conversationId: "conv-1",
        channel: {
          name: "lightninglabs",
          membersType: "team",
          topicName: "ops",
        },
        sender: {
          uid: "uid-1",
          username: "roasbeef",
        },
        sentAt: 1700000000,
        sentAtMs: 1700000000123,
        unread: true,
        atMentionUsernames: ["openclaw"],
        raw: expect.any(Object),
        content: {
          type: "text",
          raw: expect.any(Object),
          text: {
            body: "@openclaw status",
            replyTo: 41,
          },
        },
      },
    });
  });

  it("parses reaction events with compact Keybase fields", () => {
    const event = parseKeybaseListenEvent(
      JSON.stringify({
        type: "chat",
        msg: {
          id: 55,
          conversation_id: "conv-2",
          channel: {
            name: "alice,bob",
          },
          sender: {
            username: "alice",
          },
          content: {
            type: "reaction",
            reaction: {
              m: 54,
              b: ":+1:",
              t: "uid-target",
            },
          },
        },
      }),
    );

    expect(event).toEqual({
      type: "chat",
      raw: expect.any(Object),
      message: {
        id: 55,
        conversationId: "conv-2",
        channel: {
          name: "alice,bob",
        },
        sender: {
          username: "alice",
        },
        atMentionUsernames: [],
        raw: expect.any(Object),
        content: {
          type: "reaction",
          raw: expect.any(Object),
          reaction: {
            body: ":+1:",
            messageId: 54,
            targetUid: "uid-target",
          },
        },
      },
    });
  });

  it("parses conversation notifications", () => {
    const event = parseKeybaseListenEvent(
      JSON.stringify({
        type: "chat_conv",
        conv: {
          id: "conv-3",
          unread: false,
          member_status: "active",
          channel: {
            name: "lightninglabs",
            members_type: "team",
            topic_name: "random",
          },
        },
      }),
    );

    expect(event).toEqual({
      type: "chat_conv",
      raw: expect.any(Object),
      conversation: {
        id: "conv-3",
        unread: false,
        memberStatus: "active",
        channel: {
          name: "lightninglabs",
          membersType: "team",
          topicName: "random",
        },
        raw: expect.any(Object),
      },
    });
  });

  it("keeps unknown notification types inspectable", () => {
    expect(parseKeybaseListenEvent('{"type":"mystery","payload":{"ok":true}}')).toEqual({
      type: "unknown",
      rawType: "mystery",
      raw: {
        type: "mystery",
        payload: {
          ok: true,
        },
      },
    });
  });
});
