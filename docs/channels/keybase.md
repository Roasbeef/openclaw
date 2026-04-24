---
summary: "Keybase support via the Keybase CLI JSON API"
read_when:
  - Working on Keybase channel support
  - Running OpenClaw against Keybase locally or in containers
  - Planning Keybase DM or team-channel routing
title: "Keybase"
---

# Keybase

Keybase is an official bundled channel plugin backed by the Keybase CLI JSON API.
It supports DMs, team chats, mention-gated group routing, pairing, route allowlists, per-group prompts, per-group skill filters, and best-effort ack reactions on handled messages.

<CardGroup cols={3}>
  <Card title="Pairing" icon="link" href="/channels/pairing">
    Unknown DM senders use the normal OpenClaw pairing flow.
  </Card>
  <Card title="Groups" icon="users" href="/channels/groups">
    Group safety follows the standard `groupPolicy` and `requireMention` model.
  </Card>
  <Card title="Master Plan" icon="list-check" href="/plan/keybase-channel">
    Phase plan, deployment notes, and local smoke path.
  </Card>
</CardGroup>

## Prerequisites

- The `keybase` CLI must be installed on the same host where the gateway runs.
- The Keybase service must be available to that CLI.
- The OpenClaw instance should use one Keybase identity only.
- For containers, prefer an entrypoint that runs the verified service bootstrap before `openclaw gateway run`, for example `keybase service --oneshot-username <bot> < paper_key.txt`.
- On Docker Desktop/macOS, keep `socketFile` and `pidFile` on a container-local filesystem such as `/tmp/openclaw-keybase`; Unix sockets under bind-mounted host volumes may not be visible to later CLI calls.

## Minimal config

```json5
{
  channels: {
    keybase: {
      enabled: true,
      username: "openclaw-bot",
      paperKeyFile: "/run/secrets/keybase-paperkey",
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      groups: {
        "team:example#lbottest": {
          requireMention: true,
        },
      },
    },
  },
}
```

Useful fields:

| Field                       | Meaning                                      |
| --------------------------- | -------------------------------------------- |
| `username`                  | Keybase bot username                         |
| `paperKey` / `paperKeyFile` | Paper key for the Keybase service bootstrap  |
| `ackReaction`               | Optional ack reaction emoji or shortcode     |
| `homeDir`                   | Optional Keybase home override               |
| `socketFile`                | Optional `keybased` socket path              |
| `pidFile`                   | Optional `keybased` pid file path            |
| `binary`                    | Optional `keybase` binary path               |
| `textChunkLimit`            | Optional outbound text chunk size            |
| `execApprovals`             | Optional native approval delivery settings   |
| `dmPolicy`                  | DM access policy (`pairing` recommended)     |
| `allowFrom`                 | DM allowlist                                 |
| `groupPolicy`               | Group route policy (`allowlist` recommended) |
| `groups`                    | Team/topic allowlist and per-route overrides |
| `commands`                  | Native command advertisement settings        |
| `defaultTo`                 | Optional default outbound target             |

## Group routing

Keybase team chats use the standard OpenClaw group model:

- `groupPolicy: "allowlist"` blocks team chats until `groups` is configured.
- `requireMention` defaults to `true`.
- `groups["*"]` works as a wildcard default.
- Per-group `allowFrom` restricts which senders inside an allowed team chat can trigger replies.
- Per-group `systemPrompt` and `skills` apply to that route only.

Example:

```json5
{
  channels: {
    keybase: {
      groupPolicy: "allowlist",
      groups: {
        "team:example#lbottest": {
          requireMention: true,
          systemPrompt: "Keep replies focused on infrastructure operations.",
          skills: ["infra"],
        },
        "*": {
          enabled: false,
        },
      },
    },
  },
}
```

## Targets

Current target forms:

- `dm:alice`
- `dm:alice,bob`
- `team:example#lbottest`
- `conv:<conversation-id>`

## Delivery and chunking

Keybase outbound text uses OpenClaw's markdown-aware chunker with a default
`textChunkLimit` of `4000` characters. Set `channels.keybase.textChunkLimit` or
`channels.keybase.accounts.<id>.textChunkLimit` to lower the limit for a
particular deployment. Agent replies preserve the same Keybase `reply_to`
target on each text chunk.

## Native command advertisements

Keybase supports bot command advertisements through the CLI JSON API. OpenClaw
syncs the standard slash command catalog into that menu at gateway startup when
native commands are enabled.

```json5
{
  commands: {
    native: "auto",
    nativeSkills: "auto",
  },
  channels: {
    keybase: {
      commands: {
        native: "auto",
        nativeSkills: "auto",
        alias: "OpenClaw",
      },
    },
  },
}
```

Notes:

- `commands.native: "auto"` enables Keybase command advertisements.
- `channels.keybase.commands.native=false` clears previously published Keybase
  command advertisements on startup.
- Advertised command names keep OpenClaw's normal slash form, such as `/help`
  and `/status`; the regular text-command dispatcher still handles execution.
- `commands.nativeSkills` controls whether user-invocable skill commands are
  included in the advertised catalog.

## Approvals

Keybase supports the shared text-command approval fallback. When an exec or
plugin approval prompt includes a command such as `/approve <id> allow-once`,
send that command in the same authorized DM or tagged team chat. In team chats,
tagging the bot also works, for example `@openclaw /approve <id> allow-once`;
OpenClaw strips the bot mention before dispatching the shared `/approve`
command.

Keybase can also act as a native approval client when
`channels.keybase.execApprovals` is configured. Native prompts can be sent to
approver DMs, the originating Keybase chat, or both. OpenClaw binds reaction
shortcuts only to the bot-authored approval prompt message, and only configured
approvers can resolve them.

```json5
{
  channels: {
    keybase: {
      execApprovals: {
        enabled: true,
        approvers: ["roasbeef"],
        target: "dm", // "dm" | "channel" | "both"
      },
    },
  },
}
```

Reaction shortcuts:

- `✅` or `:white_check_mark:` submits `allow-once`.
- `♾️` or `:infinity:` submits `allow-always`.
- `❌` or `:x:` submits `deny`.

The text `/approve` path remains available as a fallback. If no Keybase
approvers are configured, same-chat text approval behavior stays governed by the
normal channel command authorization.

## Subagents and async delivery

Keybase supports the shared `/subagents` command surface. Since Keybase does not
have Discord-style child threads, subagent completion updates route back to the
same Keybase DM or team topic that launched the work. Keybase stores DMs as
`conv:<conversation-id>` targets so detached completion delivery does not
accidentally route back to the bot account itself.

Useful commands:

- `/subagents list`
- `/subagents spawn <agentId> <task>`
- `/subagents info <id|#>`
- `/subagents log <id|#>`
- `/subagents send <id|#> <message>`
- `/subagents steer <id|#> <message>`
- `/subagents kill <id|#|all>`

Reply-to-subagent targeting is limited by Keybase's lack of durable per-subagent
threads. Use `/subagents send` or `/subagents steer` for explicit targeting.

## Ack reactions

Keybase exposes reactions through the `chat api` `reaction` method. OpenClaw uses
that surface for acknowledgement reactions while a reply is being processed.

```json5
{
  messages: {
    ackReaction: ":eyes:",
    ackReactionScope: "group-mentions",
  },
  channels: {
    keybase: {
      ackReaction: ":eyes:",
    },
  },
}
```

Notes:

- `channels.keybase.ackReaction` overrides the global message ack reaction for Keybase.
- Account-level overrides are available at `channels.keybase.accounts.<id>.ackReaction`.
- The Unicode default eye reaction is normalized to the Keybase `:eyes:` shortcode.
- Group control commands only receive the ack reaction after command
  authorization succeeds. Unauthorized tagged commands stay quiet so the ack
  remains a handled-work signal.
- Reaction cleanup/removal is not enabled yet; this first pass leaves the ack reaction on the inbound message.

## Pairing flow

DMs default to pairing:

```bash
openclaw pairing list keybase
openclaw pairing approve keybase <CODE>
```

Pairing approval grants DM access only. Group authorization still comes from explicit Keybase group config.

## Container note

For a containerized Keybase bot, keep the startup model simple:

1. Mount OpenClaw state.
2. Mount Keybase home or service state.
3. Inject `KEYBASE_USERNAME` and paper key.
4. Run the Keybase service bootstrap, for example `keybase service --oneshot-username <bot> < paper_key.txt`.
5. Start `openclaw gateway run`.

If the Keybase home is bind-mounted from macOS into Docker, configure
`socketFile` and `pidFile` under a container-local path and pass the same
`--socket-file`/`--pid-file` flags to the service bootstrap. The local smoke
harness defaults to `/tmp/openclaw-keybase/keybased.sock`.

Do not run one Keybase identity behind multiple replicas.

## Kubernetes and Vault

The Keybase Docker layer includes
`/app/extensions/keybase/docker/keybase-entrypoint.sh` for production-style
deployments. It sources shell env files before running the normal Keybase
bootstrap entrypoint, so Vault Agent Injector templates can write files like
`/vault/secrets/keybase.sh` and `/vault/secrets/claude.sh`.

Example injected env:

```sh
export KEYBASE_USERNAME="openclaw-bot"
export KEYBASE_PAPERKEY="..."
export CLAUDE_CODE_OAUTH_TOKEN="..."
```

Recommended Kubernetes shape:

- Use `strategy.type: Recreate`.
- Set `replicas: 1` for each Keybase identity.
- Mount persistent OpenClaw and Keybase state at `/home/node`.
- Keep `OPENCLAW_KEYBASE_SOCKET_FILE` and `OPENCLAW_KEYBASE_PID_FILE` under
  container-local `/tmp/openclaw-keybase`.
- Set the model to `claude-cli/claude-sonnet-4-6` and pass
  `CLAUDE_CODE_OAUTH_TOKEN` to the Claude child process through the
  `cliBackends.claude-cli.env` config.
- Source provider and Keybase secrets from files or env; do not commit paper
  keys or OAuth tokens into images or Helm values.

Optional GitHub setup:

- Set `OPENCLAW_CONFIGURE_GITHUB_TOKEN=1` when `GITHUB_TOKEN` is present and you
  want the entrypoint to configure `git` HTTPS credentials.
- If the image includes the GitHub CLI, the same flag best-effort logs `gh` in
  with that token.

## Local Docker smoke

The repo now includes an isolated local smoke harness for Keybase:

```bash
pnpm keybase:smoke:build
pnpm keybase:smoke:scaffold
cd .artifacts/keybase-docker
cp .env.example .env
docker compose --env-file .env -f docker-compose.keybase.yml up -d
```

Notes:

- The smoke image layers Keybase on top of a normal OpenClaw image with the
  `keybase` plugin bundled and installs the Claude Code CLI for
  `claude -p` runs.
- The generated smoke config defaults the agent model to
  `claude-cli/claude-sonnet-4-6` only. It does not use normal Anthropic
  provider auth.
- The gateway container starts with
  `/app/extensions/keybase/docker/keybase-entrypoint.sh`, which sources optional
  secret env files and delegates to `container-entrypoint.mjs` to sync the local
  Keybase baseline into `state/home/.openclaw/openclaw.json`, run the verified
  service bootstrap with the mounted paper key, and then start the gateway.
- The smoke harness persists the Keybase home under `state/home`, but keeps the
  service socket and pid file under container-local `/tmp/openclaw-keybase` to
  avoid Docker Desktop shared-volume Unix socket issues.
- Set `CLAUDE_CODE_OAUTH_TOKEN` in `.env` from `claude setup-token` so the
  Claude child process can authenticate inside the container.
- For local paper key reuse, either export `KEYBASE_PAPERKEY="$(< /path/to/paper_key.txt)"`
  before `docker compose up`, or place the secret under
  `state/home/.openclaw/secrets/keybase-paperkey` and point
  `KEYBASE_PAPERKEY_FILE=/home/node/.openclaw/secrets/keybase-paperkey`.
- The smoke path currently defaults to `linux/amd64` because the official
  Keybase Linux package is amd64-oriented.

### Blackbox sender container

For a full local blackbox run, use a second Keybase identity as the sender:

```bash
pnpm keybase:smoke:scaffold
cd .artifacts/keybase-docker
cp .env.example .env
# Fill KEYBASE_USERNAME/KEYBASE_PAPERKEY_FILE for the bot.
# Fill KEYBASE_TEST_USERNAME/KEYBASE_TEST_PAPERKEY_FILE for the sender.
# Ensure KEYBASE_TEST_USERNAME is already in KEYBASE_TEST_TEAM.
cd ../..
pnpm keybase:smoke:blackbox --output-dir .artifacts/keybase-docker \
  --team lbottest \
  --bot lbottestbot
```

The blackbox command starts the gateway and sender containers, sends a mention
from the sender identity, then waits until OpenClaw records fresh inbound and
outbound Keybase timestamps, the sender can read the bot reply, and the sender
can observe the configured ack reaction.

For the production live transport lane, use the QA runner:

```bash
pnpm openclaw qa keybase --output-dir .artifacts/keybase-docker \
  --team lbottest \
  --bot lbottestbot
```

The QA lane reuses the same two-container scaffold and writes
`keybase-blackbox-report.json` plus `keybase-blackbox-summary.md`. It currently
covers team-channel canary replies, tagged help commands, native command
advertisement discovery, chunked command delivery, DM canary replies, DM pairing
challenges, `/subagents list`, `/subagents spawn` with same-chat completion,
mention gating, group allowlist block, restart resume, and ack reaction
observation. The runner installs the requested
`team#general` test route in the local smoke config before it starts assertions. Use repeated
`--scenario <id>` flags to run a subset: `canary`, `help-command`,
`command-advertisements`, `chunked-commands`, `dm-canary`, `dm-pairing`,
`subagents-list`, `subagents-spawn`, `mention-gating`, `allowlist-block`, or
`restart-resume`.
