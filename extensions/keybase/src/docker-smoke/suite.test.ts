import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeKeybaseDockerSmokeFiles } from "./scaffold.js";
import { runKeybaseDockerBlackboxSmoke, runKeybaseDockerBlackboxSuite } from "./suite.js";

const cleanups: Array<() => Promise<void>> = [];
const TEST_TIMINGS = {
  apiListenSettleMs: 0,
  channelSettleMs: 0,
  restartChannelSettleMs: 0,
  stopApiListenSettleMs: 0,
};

function isChannelStatusProbe(args: readonly string[]): boolean {
  return (
    (args.includes("channels") && args.includes("status")) ||
    args.join(" ").includes("channels.status")
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe("runKeybaseDockerBlackboxSmoke", () => {
  it("starts the sender profile, sends a test mention, and waits for a reply", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "keybase-blackbox-smoke-"));
    cleanups.push(async () => {
      await rm(outputDir, { recursive: true, force: true });
    });
    await writeKeybaseDockerSmokeFiles({
      outputDir,
    });
    const calls: string[] = [];
    const now = vi.spyOn(Date, "now").mockReturnValue(1_776_994_500_000);

    try {
      const result = await runKeybaseDockerBlackboxSmoke(
        {
          botUsername: "lbottestbot",
          outputDir,
          team: "lbottest",
          timings: TEST_TIMINGS,
        },
        {
          async runCommand(command, args, cwd) {
            calls.push([command, ...args, `@${cwd}`].join(" "));
            if (args.includes("whoami")) {
              return { stderr: "", stdout: "ok\n" };
            }
            if (args.join(" ").includes("chat api-listen")) {
              return { stderr: "", stdout: "" };
            }
            if (isChannelStatusProbe(args)) {
              return {
                stderr: "",
                stdout: JSON.stringify({
                  channelAccounts: {
                    keybase: [
                      {
                        running: true,
                        lastError: null,
                        lastInboundAt: 1_776_994_501_000,
                        lastOutboundAt: 1_776_994_502_000,
                        lastStartAt: 1_776_994_500_000,
                      },
                    ],
                  },
                }),
              };
            }
            const apiIndex = args.indexOf("-m");
            if (apiIndex >= 0) {
              const request = JSON.parse(args[apiIndex + 1]) as {
                method?: string;
              };
              if (request.method === "list") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      conversations: [
                        {
                          id: "conv-team",
                          is_default_conv: true,
                          channel: { name: "lbottest", members_type: "team" },
                        },
                      ],
                    },
                  }),
                };
              }
              if (request.method === "send") {
                return { stderr: "", stdout: JSON.stringify({ result: { id: 101 } }) };
              }
              if (request.method === "read") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      messages: [
                        {
                          msg: {
                            id: 103,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_501_500,
                            content: {
                              type: "reaction",
                              reaction: {
                                b: ":eyes:",
                                m: 101,
                              },
                            },
                          },
                        },
                        {
                          msg: {
                            id: 102,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_502_000,
                            content: {
                              type: "text",
                              text: {
                                replyTo: 101,
                                body: "keybase blackbox smoke ok keybase-blackbox-1776994500000",
                              },
                            },
                          },
                        },
                      ],
                    },
                  }),
                };
              }
            }
            return { stderr: "", stdout: "" };
          },
        },
      );

      expect(result).toMatchObject({
        ackReactionBody: ":eyes:",
        ackReactionMessageId: "103",
        botUsername: "lbottestbot",
        inboundAt: 1_776_994_501_000,
        outboundAt: 1_776_994_502_000,
        replyPreview: "keybase blackbox smoke ok keybase-blackbox-1776994500000",
        sentMessageId: "101",
        team: "lbottest",
      });
      expect(calls[0]).toContain(
        `docker compose --env-file ${outputDir}/.env -f ${outputDir}/docker-compose.keybase.yml --profile blackbox stop openclaw-keybase-gateway`,
      );
      expect(
        calls.some((call) =>
          call.includes(
            `docker compose --env-file ${outputDir}/.env -f ${outputDir}/docker-compose.keybase.yml --profile blackbox up -d openclaw-keybase-gateway openclaw-keybase-sender`,
          ),
        ),
      ).toBe(true);
      expect(calls.some((call) => call.includes("openclaw-keybase-sender keybase"))).toBe(true);
    } finally {
      now.mockRestore();
    }
  });

  it("runs a selected blackbox suite and writes report artifacts", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "keybase-blackbox-suite-"));
    cleanups.push(async () => {
      await rm(outputDir, { recursive: true, force: true });
    });
    await writeKeybaseDockerSmokeFiles({
      outputDir,
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_776_994_600_000);

    try {
      const result = await runKeybaseDockerBlackboxSuite(
        {
          botUsername: "lbottestbot",
          negativeWaitMs: 1,
          outputDir,
          scenarioIds: ["canary", "help-command"],
          team: "lbottest",
          timings: TEST_TIMINGS,
        },
        {
          async runCommand(_command, args) {
            if (args.includes("whoami")) {
              return { stderr: "", stdout: "ok\n" };
            }
            if (args.join(" ").includes("chat api-listen")) {
              return { stderr: "", stdout: "" };
            }
            if (isChannelStatusProbe(args)) {
              return {
                stderr: "",
                stdout: JSON.stringify({
                  channelAccounts: {
                    keybase: [
                      {
                        running: true,
                        lastError: null,
                        lastInboundAt: 1_776_994_601_000,
                        lastOutboundAt: 1_776_994_602_000,
                        lastStartAt: 1_776_994_600_000,
                      },
                    ],
                  },
                }),
              };
            }
            const apiIndex = args.indexOf("-m");
            if (apiIndex >= 0) {
              const request = JSON.parse(args[apiIndex + 1]) as {
                method?: string;
                params?: {
                  options?: {
                    message?: { body?: string };
                  };
                };
              };
              if (request.method === "list") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      conversations: [
                        {
                          id: "conv-team",
                          is_default_conv: true,
                          channel: { name: "lbottest", members_type: "team" },
                        },
                      ],
                    },
                  }),
                };
              }
              if (request.method === "send") {
                const body = request.params?.options?.message?.body ?? "";
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: { id: body.includes("/help") ? 301 : 201 },
                  }),
                };
              }
              if (request.method === "read") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      messages: [
                        {
                          msg: {
                            id: 203,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_601_500,
                            content: {
                              type: "reaction",
                              reaction: {
                                b: ":eyes:",
                                m: 201,
                              },
                            },
                          },
                        },
                        {
                          msg: {
                            id: 202,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_602_000,
                            content: {
                              type: "text",
                              text: {
                                replyTo: 201,
                                body: "keybase blackbox canary ok keybase-canary-1776994600000",
                              },
                            },
                          },
                        },
                        {
                          msg: {
                            id: 303,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_601_500,
                            content: {
                              type: "reaction",
                              reaction: {
                                b: ":eyes:",
                                m: 301,
                              },
                            },
                          },
                        },
                        {
                          msg: {
                            id: 302,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_602_000,
                            content: {
                              type: "text",
                              text: {
                                replyTo: 301,
                                body: "Help\n\nMore: /commands for full list, /tools for available capabilities",
                              },
                            },
                          },
                        },
                      ],
                    },
                  }),
                };
              }
            }
            return { stderr: "", stdout: "" };
          },
        },
      );

      expect(result.passed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.scenarios).toEqual([
        expect.objectContaining({
          id: "canary",
          status: "passed",
          details: expect.objectContaining({
            ackReactionBody: ":eyes:",
            replyPreview: "keybase blackbox canary ok keybase-canary-1776994600000",
            sentMessageId: "201",
          }),
        }),
        expect.objectContaining({
          id: "help-command",
          status: "passed",
          details: expect.objectContaining({
            ackReactionBody: ":eyes:",
            replyPreview:
              "Help\n\nMore: /commands for full list, /tools for available capabilities",
            sentMessageId: "301",
          }),
        }),
      ]);
      await expect(readFile(result.reportPath, "utf8")).resolves.toContain('"canary"');
      await expect(readFile(result.reportPath, "utf8")).resolves.toContain('"help-command"');
      await expect(readFile(result.summaryPath, "utf8")).resolves.toContain("Keybase Blackbox QA");
    } finally {
      now.mockRestore();
    }
  });

  it("runs command advertisement and chunked command scenarios", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "keybase-blackbox-phase2-suite-"));
    cleanups.push(async () => {
      await rm(outputDir, { recursive: true, force: true });
    });
    await writeKeybaseDockerSmokeFiles({
      outputDir,
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_776_994_800_000);

    try {
      const result = await runKeybaseDockerBlackboxSuite(
        {
          botUsername: "lbottestbot",
          outputDir,
          scenarioIds: ["command-advertisements", "chunked-commands"],
          team: "lbottest",
          timings: TEST_TIMINGS,
        },
        {
          async runCommand(_command, args) {
            if (args.includes("whoami")) {
              return {
                stderr: "",
                stdout: args.includes("openclaw-keybase-sender")
                  ? "lbottestuser2\n"
                  : "lbottestbot\n",
              };
            }
            if (args.join(" ").includes("chat api-listen")) {
              return { stderr: "", stdout: "" };
            }
            if (isChannelStatusProbe(args)) {
              return {
                stderr: "",
                stdout: JSON.stringify({
                  channelAccounts: {
                    keybase: [
                      {
                        running: true,
                        lastError: null,
                        lastInboundAt: 1_776_994_801_000,
                        lastOutboundAt: 1_776_994_802_000,
                        lastStartAt: 1_776_994_800_000,
                      },
                    ],
                  },
                }),
              };
            }
            const apiIndex = args.indexOf("-m");
            if (apiIndex >= 0) {
              const request = JSON.parse(args[apiIndex + 1]) as {
                method?: string;
                params?: {
                  options?: {
                    message?: { body?: string };
                  };
                };
              };
              if (request.method === "list") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      conversations: [
                        {
                          id: "conv-team",
                          is_default_conv: true,
                          channel: { name: "lbottest", members_type: "team" },
                        },
                      ],
                    },
                  }),
                };
              }
              if (request.method === "listcommands") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      commands: [
                        { name: "/help", description: "Show help." },
                        { name: "status", description: "Show status." },
                        { name: "/commands", description: "List commands." },
                        { name: "/subagents", description: "Manage subagents." },
                      ],
                    },
                  }),
                };
              }
              if (request.method === "send") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: { id: 501 },
                  }),
                };
              }
              if (request.method === "read") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      messages: [
                        {
                          msg: {
                            id: 503,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_801_500,
                            content: {
                              type: "reaction",
                              reaction: {
                                b: ":eyes:",
                                m: 501,
                              },
                            },
                          },
                        },
                        {
                          msg: {
                            id: 502,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_802_000,
                            content: {
                              type: "text",
                              text: {
                                replyTo: 501,
                                body: "Available commands include /help and /commands.",
                              },
                            },
                          },
                        },
                        {
                          msg: {
                            id: 504,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_802_001,
                            content: {
                              type: "text",
                              text: {
                                replyTo: 501,
                                body: "Status commands include /status.",
                              },
                            },
                          },
                        },
                      ],
                    },
                  }),
                };
              }
            }
            return { stderr: "", stdout: "" };
          },
        },
      );

      expect(result.passed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.scenarios).toEqual([
        expect.objectContaining({
          id: "command-advertisements",
          status: "passed",
          details: expect.objectContaining({
            observedCommands: ["/commands", "/help", "/status", "/subagents"],
          }),
        }),
        expect.objectContaining({
          id: "chunked-commands",
          status: "passed",
          details: expect.objectContaining({
            ackReactionBody: ":eyes:",
            chunkCount: 2,
            chunkMessageIds: ["502", "504"],
            sentMessageId: "501",
          }),
        }),
      ]);
    } finally {
      now.mockRestore();
    }
  });

  it("runs direct-message blackbox scenarios", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "keybase-blackbox-dm-suite-"));
    cleanups.push(async () => {
      await rm(outputDir, { recursive: true, force: true });
    });
    await writeKeybaseDockerSmokeFiles({
      outputDir,
    });
    const pairingStorePath = path.join(
      outputDir,
      "state",
      "home",
      ".openclaw",
      "credentials",
      "keybase-pairing.json",
    );
    await mkdir(path.dirname(pairingStorePath), { recursive: true });
    await writeFile(
      pairingStorePath,
      JSON.stringify({
        version: 1,
        requests: [{ code: "STALE", id: "lbottestuser2" }],
      }),
      "utf8",
    );
    const now = vi.spyOn(Date, "now").mockReturnValue(1_776_994_700_000);

    try {
      const result = await runKeybaseDockerBlackboxSuite(
        {
          botUsername: "lbottestbot",
          outputDir,
          scenarioIds: ["dm-canary", "dm-pairing"],
          team: "lbottest",
          timings: TEST_TIMINGS,
        },
        {
          async runCommand(_command, args) {
            if (args.includes("whoami")) {
              return {
                stderr: "",
                stdout: args.includes("openclaw-keybase-sender")
                  ? "lbottestuser2\n"
                  : "lbottestbot\n",
              };
            }
            if (args.join(" ").includes("chat api-listen")) {
              return { stderr: "", stdout: "" };
            }
            if (isChannelStatusProbe(args)) {
              return {
                stderr: "",
                stdout: JSON.stringify({
                  channelAccounts: {
                    keybase: [
                      {
                        running: true,
                        lastError: null,
                        lastInboundAt: 1_776_994_701_000,
                        lastOutboundAt: 1_776_994_702_000,
                        lastStartAt: 1_776_994_700_000,
                      },
                    ],
                  },
                }),
              };
            }
            const apiIndex = args.indexOf("-m");
            if (apiIndex >= 0) {
              const request = JSON.parse(args[apiIndex + 1]) as {
                method?: string;
                params?: {
                  options?: {
                    message?: { body?: string };
                  };
                };
              };
              if (request.method === "list") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      conversations: [
                        {
                          id: "conv-team",
                          is_default_conv: true,
                          channel: { name: "lbottest", members_type: "team" },
                        },
                      ],
                    },
                  }),
                };
              }
              if (request.method === "send") {
                const body = request.params?.options?.message?.body ?? "";
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: { id: body.includes("pairing challenge") ? 401 : 301 },
                  }),
                };
              }
              if (request.method === "read") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      messages: [
                        {
                          msg: {
                            id: 303,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_701_500,
                            content: {
                              type: "reaction",
                              reaction: {
                                b: ":eyes:",
                                m: 301,
                              },
                            },
                          },
                        },
                        {
                          msg: {
                            id: 302,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_702_000,
                            content: {
                              type: "text",
                              text: {
                                replyTo: 301,
                                body: "keybase dm canary ok keybase-dm-canary-1776994700000",
                              },
                            },
                          },
                        },
                        {
                          msg: {
                            id: 402,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_702_000,
                            content: {
                              type: "text",
                              text: {
                                replyTo: 401,
                                body: "Pairing code: 123456",
                              },
                            },
                          },
                        },
                      ],
                    },
                  }),
                };
              }
            }
            return { stderr: "", stdout: "" };
          },
        },
      );

      expect(result.passed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.scenarios).toEqual([
        expect.objectContaining({
          id: "dm-canary",
          status: "passed",
          details: expect.objectContaining({
            replyPreview: "keybase dm canary ok keybase-dm-canary-1776994700000",
            senderUsername: "lbottestuser2",
            sentMessageId: "301",
          }),
        }),
        expect.objectContaining({
          id: "dm-pairing",
          status: "passed",
          details: expect.objectContaining({
            replyMessageId: "402",
            replyPreview: "Pairing code: 123456",
            senderUsername: "lbottestuser2",
            sentMessageId: "401",
          }),
        }),
      ]);
      await expect(readFile(pairingStorePath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      now.mockRestore();
    }
  });

  it("runs the subagents list blackbox scenario", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "keybase-blackbox-subagents-suite-"));
    cleanups.push(async () => {
      await rm(outputDir, { recursive: true, force: true });
    });
    await writeKeybaseDockerSmokeFiles({
      outputDir,
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_776_994_900_000);
    let readAttempts = 0;

    try {
      const result = await runKeybaseDockerBlackboxSuite(
        {
          botUsername: "lbottestbot",
          outputDir,
          scenarioIds: ["subagents-list"],
          team: "lbottest",
          timings: TEST_TIMINGS,
        },
        {
          async runCommand(_command, args) {
            if (args.includes("whoami")) {
              return {
                stderr: "",
                stdout: args.includes("openclaw-keybase-sender")
                  ? "lbottestuser2\n"
                  : "lbottestbot\n",
              };
            }
            if (args.join(" ").includes("chat api-listen")) {
              return { stderr: "", stdout: "" };
            }
            if (isChannelStatusProbe(args)) {
              return {
                stderr: "",
                stdout: JSON.stringify({
                  channelAccounts: {
                    keybase: [
                      {
                        running: true,
                        lastError: null,
                        lastInboundAt: 1_776_994_901_000,
                        lastOutboundAt: 1_776_994_902_000,
                        lastStartAt: 1_776_994_900_000,
                      },
                    ],
                  },
                }),
              };
            }
            const apiIndex = args.indexOf("-m");
            if (apiIndex >= 0) {
              const request = JSON.parse(args[apiIndex + 1]) as {
                method?: string;
                params?: {
                  options?: {
                    message?: { body?: string };
                  };
                };
              };
              if (request.method === "list") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      conversations: [
                        {
                          id: "conv-team",
                          is_default_conv: true,
                          channel: { name: "lbottest", members_type: "team" },
                        },
                      ],
                    },
                  }),
                };
              }
              if (request.method === "send") {
                return { stderr: "", stdout: JSON.stringify({ result: { id: 601 } }) };
              }
              if (request.method === "read") {
                readAttempts += 1;
                if (readAttempts === 1) {
                  throw new Error(
                    "dial unix /tmp/openclaw-keybase/keybased.sock: connect: no such file or directory",
                  );
                }
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      messages: [
                        {
                          msg: {
                            id: 603,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_901_500,
                            content: {
                              type: "reaction",
                              reaction: {
                                b: ":eyes:",
                                m: 601,
                              },
                            },
                          },
                        },
                        {
                          msg: {
                            id: 602,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_994_902_000,
                            content: {
                              type: "text",
                              text: {
                                replyTo: 601,
                                body: "active subagents:\n-----\n(none)",
                              },
                            },
                          },
                        },
                      ],
                    },
                  }),
                };
              }
            }
            return { stderr: "", stdout: "" };
          },
        },
      );

      expect(result.passed).toBe(1);
      expect(result.failed).toBe(0);
      expect(readAttempts).toBe(2);
      expect(result.scenarios).toEqual([
        expect.objectContaining({
          id: "subagents-list",
          status: "passed",
          details: expect.objectContaining({
            ackReactionBody: ":eyes:",
            replyPreview: "active subagents:\n-----\n(none)",
            sentMessageId: "601",
          }),
        }),
      ]);
    } finally {
      now.mockRestore();
    }
  });

  it("runs the subagents spawn blackbox scenario", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "keybase-blackbox-subagents-spawn-"));
    cleanups.push(async () => {
      await rm(outputDir, { recursive: true, force: true });
    });
    await writeKeybaseDockerSmokeFiles({
      outputDir,
    });
    const staleSessionPath = path.join(
      outputDir,
      "state",
      "home",
      ".openclaw",
      "agents",
      "main",
      "sessions",
      "stale.jsonl",
    );
    await mkdir(path.dirname(staleSessionPath), { recursive: true });
    await writeFile(staleSessionPath, "NO_REPLY\n", "utf8");
    const now = vi.spyOn(Date, "now").mockReturnValue(1_776_995_000_000);
    let readAttempts = 0;

    try {
      const result = await runKeybaseDockerBlackboxSuite(
        {
          botUsername: "lbottestbot",
          outputDir,
          scenarioIds: ["subagents-spawn"],
          team: "lbottest",
          timings: TEST_TIMINGS,
        },
        {
          async runCommand(_command, args) {
            if (args.includes("whoami")) {
              return {
                stderr: "",
                stdout: args.includes("openclaw-keybase-sender")
                  ? "lbottestuser2\n"
                  : "lbottestbot\n",
              };
            }
            if (args.join(" ").includes("chat api-listen")) {
              return { stderr: "", stdout: "" };
            }
            if (isChannelStatusProbe(args)) {
              return {
                stderr: "",
                stdout: JSON.stringify({
                  channelAccounts: {
                    keybase: [
                      {
                        running: true,
                        lastError: null,
                        lastInboundAt: 1_776_995_001_000,
                        lastOutboundAt: 1_776_995_002_000,
                        lastStartAt: 1_776_995_000_000,
                      },
                    ],
                  },
                }),
              };
            }
            const apiIndex = args.indexOf("-m");
            if (apiIndex >= 0) {
              const request = JSON.parse(args[apiIndex + 1]) as {
                method?: string;
              };
              if (request.method === "list") {
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      conversations: [
                        {
                          id: "conv-team",
                          is_default_conv: true,
                          channel: { name: "lbottest", members_type: "team" },
                        },
                      ],
                    },
                  }),
                };
              }
              if (request.method === "send") {
                return { stderr: "", stdout: JSON.stringify({ result: { id: 701 } }) };
              }
              if (request.method === "read") {
                readAttempts += 1;
                return {
                  stderr: "",
                  stdout: JSON.stringify({
                    result: {
                      messages: [
                        {
                          msg: {
                            id: 703,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_995_001_500,
                            content: {
                              type: "reaction",
                              reaction: {
                                b: ":eyes:",
                                m: 701,
                              },
                            },
                          },
                        },
                        {
                          msg: {
                            id: 702,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_995_002_000,
                            content: {
                              type: "text",
                              text: {
                                replyTo: 701,
                                body: "Spawned subagent main (session agent:main:subagent:test, run run-spaw).",
                              },
                            },
                          },
                        },
                        {
                          msg: {
                            id: 704,
                            sender: { username: "lbottestbot" },
                            sent_at_ms: 1_776_995_003_000,
                            content: {
                              type: "text",
                              text: {
                                body: "keybase-subagents-spawn-1776995000000",
                              },
                            },
                          },
                        },
                      ],
                    },
                  }),
                };
              }
            }
            return { stderr: "", stdout: "" };
          },
        },
      );

      expect(result.passed).toBe(1);
      expect(result.failed).toBe(0);
      expect(await pathExists(staleSessionPath)).toBe(false);
      expect(readAttempts).toBeGreaterThanOrEqual(1);
      expect(result.scenarios).toEqual([
        expect.objectContaining({
          id: "subagents-spawn",
          status: "passed",
          details: expect.objectContaining({
            ackReactionBody: ":eyes:",
            completionMessageId: "704",
            completionPreview: "keybase-subagents-spawn-1776995000000",
            replyPreview: "Spawned subagent main (session agent:main:subagent:test, run run-spaw).",
            sentMessageId: "701",
          }),
        }),
      ]);
    } finally {
      now.mockRestore();
    }
  });
});
