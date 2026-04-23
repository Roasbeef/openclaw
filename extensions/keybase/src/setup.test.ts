import { describe, expect, it } from "vitest";
import { applyKeybaseSetup } from "./setup.js";

describe("applyKeybaseSetup", () => {
  it("writes settings onto the default account", () => {
    expect(
      applyKeybaseSetup({
        accountId: "default",
        cfg: {},
        input: {
          username: "openclaw-bot",
          paperKeyFile: "/tmp/paperkey.txt",
          defaultTo: "team:lightninglabs#ops",
          enableTyping: true,
        },
      }),
    ).toEqual({
      channels: {
        keybase: {
          username: "openclaw-bot",
          paperKeyFile: "/tmp/paperkey.txt",
          defaultTo: "team:lightninglabs#ops",
          enableTyping: true,
        },
      },
    });
  });

  it("writes non-default accounts under channels.keybase.accounts", () => {
    expect(
      applyKeybaseSetup({
        accountId: "ops",
        cfg: {},
        input: {
          homeDir: "/srv/keybase",
          binary: "/usr/local/bin/keybase",
        },
      }),
    ).toEqual({
      channels: {
        keybase: {
          accounts: {
            ops: {
              homeDir: "/srv/keybase",
              binary: "/usr/local/bin/keybase",
            },
          },
        },
      },
    });
  });
});
