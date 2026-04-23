---
summary: "Experimental Keybase support via the Keybase CLI JSON API"
read_when:
  - Working on Keybase channel support
  - Running OpenClaw against Keybase locally or in containers
  - Planning Keybase DM or team-channel routing
title: "Keybase"
---

# Keybase

Status: experimental bundled plugin in progress. The current implementation supports DMs, team chats, mention-gated group routing, pairing, route allowlists, per-group prompts, and per-group skill filters.

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
- For containers, prefer an entrypoint that runs `keybase oneshot` before `openclaw gateway run`.

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
| `paperKey` / `paperKeyFile` | Paper key for `keybase oneshot`              |
| `homeDir`                   | Optional Keybase home override               |
| `binary`                    | Optional `keybase` binary path               |
| `dmPolicy`                  | DM access policy (`pairing` recommended)     |
| `allowFrom`                 | DM allowlist                                 |
| `groupPolicy`               | Group route policy (`allowlist` recommended) |
| `groups`                    | Team/topic allowlist and per-route overrides |
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
4. Run `keybase oneshot`.
5. Start `openclaw gateway run`.

Do not run one Keybase identity behind multiple replicas.

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
  `keybase` plugin bundled.
- The gateway container uses `/app/extensions/keybase/docker/container-entrypoint.mjs`
  to sync the local Keybase baseline into `state/openclaw/openclaw.json`, run
  `keybase oneshot`, and then start the gateway.
- For local paper key reuse, either export `KEYBASE_PAPERKEY="$(< /path/to/paper_key.txt)"`
  before `docker compose up`, or place the secret under
  `state/openclaw/secrets/keybase-paperkey` and point
  `KEYBASE_PAPERKEY_FILE=/home/node/.openclaw/secrets/keybase-paperkey`.
- The smoke path currently defaults to `linux/amd64` because the official
  Keybase Linux package is amd64-oriented.
