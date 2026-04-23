import { describe, expect, it } from "vitest";
import {
  buildKeybaseAdvertiseCommandsRequest,
  buildKeybaseDirectChannel,
  buildKeybaseSendRequest,
  buildKeybaseTeamChannel,
  parseKeybaseApiResponse,
  serializeKeybaseApiRequest,
} from "./protocol.js";

describe("Keybase protocol builders", () => {
  it("normalizes direct-channel usernames deterministically", () => {
    expect(buildKeybaseDirectChannel(["Bob", "alice", "bob", "alice"])).toEqual({
      name: "alice,bob",
    });
  });

  it("builds send requests with team reply targets", () => {
    const request = buildKeybaseSendRequest({
      channel: buildKeybaseTeamChannel("lightninglabs", "ops"),
      body: "hello",
      replyTo: 42,
    });

    expect(request).toEqual({
      method: "send",
      params: {
        options: {
          channel: {
            members_type: "team",
            name: "lightninglabs",
            topic_name: "ops",
          },
          message: {
            body: "hello",
          },
          reply_to: 42,
        },
      },
    });
    expect(serializeKeybaseApiRequest(request)).toBe(
      '{"method":"send","params":{"options":{"channel":{"name":"lightninglabs","members_type":"team","topic_name":"ops"},"message":{"body":"hello"},"reply_to":42}}}',
    );
  });

  it("builds command advertisements with teamconv targeting", () => {
    expect(
      buildKeybaseAdvertiseCommandsRequest({
        alias: "openclaw",
        advertisements: [
          {
            type: "teamconvs",
            teamName: "lightninglabs",
            commands: [
              {
                name: "status",
                description: "Show current task state",
              },
            ],
          },
        ],
      }),
    ).toEqual({
      method: "advertisecommands",
      params: {
        options: {
          alias: "openclaw",
          advertisements: [
            {
              type: "teamconvs",
              team_name: "lightninglabs",
              commands: [
                {
                  name: "status",
                  description: "Show current task state",
                },
              ],
            },
          ],
        },
      },
    });
  });
});

describe("Keybase API response parsing", () => {
  it("parses successful responses", () => {
    expect(parseKeybaseApiResponse<{ id: string }>('{"result":{"id":"abc"}}')).toEqual({
      error: null,
      raw: {
        result: {
          id: "abc",
        },
      },
      result: {
        id: "abc",
      },
    });
  });

  it("normalizes error envelopes", () => {
    expect(parseKeybaseApiResponse('{"error":{"message":"denied","code":403}}')).toEqual({
      error: {
        code: 403,
        message: "denied",
        raw: {
          code: 403,
          message: "denied",
        },
      },
      raw: {
        error: {
          code: 403,
          message: "denied",
        },
      },
    });
  });
});
