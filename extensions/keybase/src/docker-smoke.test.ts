import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildKeybaseDockerSmokeImage,
  runKeybaseDockerBlackboxSuite,
  runKeybaseDockerBlackboxSmoke,
  writeKeybaseDockerSmokeFiles,
} from "./docker-smoke.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe("writeKeybaseDockerSmokeFiles", () => {
  it("writes a standalone compose scaffold for local keybase smoke", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "keybase-docker-smoke-"));
    cleanups.push(async () => {
      await rm(outputDir, { recursive: true, force: true });
    });

    const result = await writeKeybaseDockerSmokeFiles({
      gatewayPort: 18889,
      imageName: "openclaw:keybase-test",
      outputDir,
      platform: "linux/amd64",
    });

    expect(result.files).toEqual(
      expect.arrayContaining([
        path.join(outputDir, ".env.example"),
        path.join(outputDir, "README.md"),
        path.join(outputDir, "docker-compose.keybase.yml"),
        path.join(outputDir, "state", "home", ".openclaw", "openclaw.json"),
        path.join(outputDir, "state", "home", ".openclaw", "secrets", "README.txt"),
        path.join(outputDir, "state", "sender-home", ".openclaw", "secrets", "README.txt"),
        path.join(outputDir, "state", "home", ".openclaw", "tmp"),
        path.join(outputDir, "state", "sender-home", ".openclaw", "tmp"),
      ]),
    );

    const compose = await readFile(path.join(outputDir, "docker-compose.keybase.yml"), "utf8");
    expect(compose).toContain("openclaw-keybase-gateway:");
    expect(compose).toContain("image: openclaw:keybase-test");
    expect(compose).toContain("platform: linux/amd64");
    expect(compose).toContain('      - "18889:18789"');
    expect(compose).toContain("/app/extensions/keybase/docker/container-entrypoint.mjs");
    expect(compose).toContain("CLAUDE_CODE_OAUTH_TOKEN: ${CLAUDE_CODE_OAUTH_TOKEN:-}");
    expect(compose).toContain("KEYBASE_USERNAME: ${KEYBASE_USERNAME:-}");
    expect(compose).toContain("KEYBASE_PAPERKEY_FILE: ${KEYBASE_PAPERKEY_FILE:-}");
    expect(compose).toContain("OPENCLAW_KEYBASE_HOME: /home/node");
    expect(compose).toContain("OPENCLAW_KEYBASE_SOCKET_FILE: /tmp/openclaw-keybase/keybased.sock");
    expect(compose).toContain("OPENCLAW_TMPDIR: /home/node/.openclaw/tmp");
    expect(compose).toContain("TMPDIR: /home/node/.openclaw/tmp");
    expect(compose).toContain("./state/home:/home/node");
    expect(compose).toContain("openclaw-keybase-cli:");
    expect(compose).toContain('network_mode: "service:openclaw-keybase-gateway"');
    expect(compose).toContain("openclaw-keybase-sender:");
    expect(compose).toContain("- blackbox");
    expect(compose).toContain("KEYBASE_USERNAME: ${KEYBASE_TEST_USERNAME:-}");
    expect(compose).toContain("./state/sender-home:/home/node");
    expect(compose).toContain("sleep");
    expect(compose).toContain("infinity");

    const envExample = await readFile(path.join(outputDir, ".env.example"), "utf8");
    expect(envExample).toContain("KEYBASE_USERNAME=claw_ll");
    expect(envExample).toContain("KEYBASE_PAPERKEY=");
    expect(envExample).toContain("CLAUDE_CODE_OAUTH_TOKEN=");
    expect(envExample).toContain(
      "KEYBASE_PAPERKEY_FILE=/home/node/.openclaw/secrets/keybase-paperkey",
    );
    expect(envExample).toContain("KEYBASE_TEST_USERNAME=");
    expect(envExample).toContain("KEYBASE_TEST_TEAM=lbottest");

    const config = await readFile(
      path.join(outputDir, "state", "home", ".openclaw", "openclaw.json"),
      "utf8",
    );
    expect(config).toContain('"claude-cli"');
    expect(config).toContain('"claude-cli/claude-sonnet-4-6"');
    expect(config).toContain('"CLAUDE_CODE_OAUTH_TOKEN": "${CLAUDE_CODE_OAUTH_TOKEN}"');
    expect(config).toContain('"keybase"');
    expect(config).toContain('"/tmp/openclaw-keybase/keybased.sock"');
    expect(config).toContain('":eyes:"');
    expect(config).toContain('"allowInsecureAuth": true');
    expect(config).toContain('"controlUi"');
    expect(config).toContain('"/home/node"');

    const readme = await readFile(path.join(outputDir, "README.md"), "utf8");
    expect(readme).toContain("pnpm keybase:smoke:build");
    expect(readme).toContain("docker compose --env-file .env -f docker-compose.keybase.yml up -d");
    expect(readme).toContain("--socket-file /tmp/openclaw-keybase/keybased.sock");
    expect(readme).toContain("openclaw-keybase-cli");
    expect(readme).toContain("pnpm keybase:smoke:blackbox");
    expect(readme).toContain("pnpm openclaw qa keybase");
  });
});

describe("buildKeybaseDockerSmokeImage", () => {
  it("builds the base openclaw image and the keybase overlay image", async () => {
    const calls: string[] = [];
    const result = await buildKeybaseDockerSmokeImage(
      {
        baseImageName: "openclaw:keybase-base",
        imageName: "openclaw:keybase-test",
        platform: "linux/amd64",
        repoRoot: "/repo/openclaw",
      },
      {
        async runCommand(command, args, cwd) {
          calls.push([command, ...args, `@${cwd}`].join(" "));
          return { stderr: "", stdout: "" };
        },
      },
    );

    expect(result).toEqual({
      baseImageName: "openclaw:keybase-base",
      imageName: "openclaw:keybase-test",
      platform: "linux/amd64",
    });
    expect(calls).toEqual([
      expect.stringContaining(
        "docker build --platform linux/amd64 -t openclaw:keybase-base --build-arg OPENCLAW_EXTENSIONS=keybase -f Dockerfile . @/repo/openclaw",
      ),
      expect.stringContaining(
        "docker build --platform linux/amd64 -t openclaw:keybase-test --build-arg OPENCLAW_BASE_IMAGE=openclaw:keybase-base -f extensions/keybase/docker/Dockerfile . @/repo/openclaw",
      ),
    ]);
  });
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
        },
        {
          async runCommand(command, args, cwd) {
            calls.push([command, ...args, `@${cwd}`].join(" "));
            if (args.includes("whoami")) {
              return { stderr: "", stdout: "ok\n" };
            }
            if (args.includes("channels") && args.includes("status")) {
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
                                body: "keybase blackbox smoke ok",
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
        replyPreview: "keybase blackbox smoke ok",
        sentMessageId: "101",
        team: "lbottest",
      });
      expect(calls[0]).toContain(
        `docker compose --env-file ${outputDir}/.env -f ${outputDir}/docker-compose.keybase.yml --profile blackbox up -d openclaw-keybase-gateway openclaw-keybase-sender`,
      );
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
        },
        {
          async runCommand(_command, args) {
            if (args.includes("whoami")) {
              return { stderr: "", stdout: "ok\n" };
            }
            if (args.includes("channels") && args.includes("status")) {
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
                                body: "keybase blackbox canary ok",
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
            replyPreview: "keybase blackbox canary ok",
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
            if (args.includes("channels") && args.includes("status")) {
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
            observedCommands: ["/commands", "/help", "/status"],
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
            if (args.includes("channels") && args.includes("status")) {
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
                                body: "keybase dm canary ok",
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
            replyPreview: "keybase dm canary ok",
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
});
