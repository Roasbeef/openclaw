---
title: Keybase Channel Master Plan
summary: Add Keybase as an official OpenClaw channel, starting with a direct CLI transport spike and ending with container and EKS rollout.
read_when:
  - Adding Keybase as an official OpenClaw channel
  - Planning Keybase transport, deployment, or multi-agent routing
  - Rolling a Keybase-backed OpenClaw fork into Lightning Labs infrastructure
---

# Keybase Channel Master Plan

## Status

- Phase 0 transport spike is complete in `extensions/keybase`.
- Phase 1 is mostly complete.
- Phase 2 is complete for command advertisements, chunking, text approvals, and
  opt-in reaction approvals.
- Phase 3 is underway: same-chat detached delivery targets and `/subagents`
  command QA are covered; reply-to-subagent targeting remains limited by
  Keybase's lack of durable child threads.
- Current Phase 3 coverage includes deterministic blackbox scenarios for
  `/subagents list` and `/subagents spawn`. The spawn scenario allowlists the
  sender before the probe, verifies the immediate spawn acknowledgement, then
  waits for same-chat completion text from the spawned subagent.
- Phase 4 has started: the Keybase Docker layer now has a production wrapper
  entrypoint that can source Vault Agent env scripts before Keybase bootstrap,
  while the lower-level Node entrypoint still owns config baseline repair,
  `keybase` oneshot, and process supervision.
- Ad hoc live probes showed that unauthorized tagged control commands could
  previously receive the ack reaction before command authorization rejected the
  command. Keybase now suppresses ack reactions for unauthorized group control
  commands so the reaction remains a handled-work signal.
- Current phase 1 baseline is implemented and live-blackbox validated locally:
  - bundled plugin scaffold
  - DM ingress
  - team/channel ingress
  - mention gating
  - route allowlists
  - per-group `systemPrompt`
  - per-group `skills`
  - directory and security warning wiring
  - official docs, channel index, setup visibility, and QA runner exposure
  - two-container live blackbox QA for group canary, tagged help command, command advertisements, chunking, DM canary, pairing, `/subagents list`, `/subagents spawn`, mention gating, allowlist blocking, restart resume, and ack reaction observation

## Goals

- Add Keybase as an official bundled OpenClaw channel plugin.
- Support DMs, team channels, mention-gated group chat, reply threading, reactions, edits, attachments, pins, and command advertisements.
- Preserve full OpenClaw channel behavior where Keybase can express it: pairing, allowlists, `status`, `cancel`, async subagent updates, and explicit agent targeting.
- Support both shared bot deployment and isolated per-user deployment.

## Non Goals

- Do not ship a permanent `lbot` bridge layer inside OpenClaw.
- Do not add Keybase-specific logic to core when the plugin contract can carry it.
- Do not scale a single Keybase identity horizontally; use one identity per running OpenClaw instance.

## Key Decisions

- Transport boundary: talk to Keybase directly through the Keybase CLI JSON API and `api-listen`, not through `lbot`.
- Runtime model: treat Keybase like other external-process channels. The plugin owns auth, startup, listen, send, edit, reaction, attachment, and status flows.
- Deployment model: one Keybase identity per running OpenClaw instance. Do not scale a single bot identity horizontally.
- Group safety model: start with mention-gated and allowlist-aware routing, matching restricted-bot expectations.
- Session model: use reply-bound continuation first. Do not assume Discord-style child threads exist.

## Reference Inputs

- OpenClaw channel/plugin contract:
  - `docs/plugins/sdk-channel-plugins.md`
  - `src/channels/plugins/types.plugin.ts`
  - `docs/tools/subagents.md`
- Bundled channel patterns:
  - `extensions/signal/**`
  - `extensions/telegram/**`
  - `extensions/googlechat/**`
- External operational references:
  - Lightning Labs `lbot`
  - Lightning Labs `lightning-infra/charts/lbot`

## Phase Plan

## Phase 0

Build a transport spike under `extensions/keybase` without exposing Keybase as a supported product channel yet.

Scope:

- Typed builders for Keybase CLI JSON API requests.
- Typed normalization for `keybase chat api-listen` events.
- Thin Node transport helpers for:
  - `chat api`
  - `chat api-listen`
  - `chat notification-settings`
  - `oneshot`
- Tests around request shapes, event parsing, and CLI argument construction.

Exit criteria:

- We can represent the Keybase transport primitives OpenClaw needs without using Go.
- We have deterministic request serialization and inbound parsing.
- We have enough transport confidence to start a real bundled channel plugin.

## Phase 1

Create `extensions/keybase` as a bundled channel plugin.

Scope:

- `package.json`
- `openclaw.plugin.json`
- `index.ts`
- `setup-entry.ts`
- `src/channel.ts`
- `src/runtime.ts`
- config schema and setup surface
- docs at `docs/channels/keybase.md`
- `.github/labeler.yml` and matching GitHub label

Initial supported behavior:

- DMs
- team channels
- mention-gated group routing
- pairing and allowlists
- send
- reply
- edit
- react
- attach
- status and doctor

Current state:

- Done:
  - bundled plugin package surface
  - Keybase account resolution and config schema
  - DM gateway flow with pairing and allowlist handling
  - team-channel inbound routing with mention gating and route allowlists
  - per-group `requireMention`, `systemPrompt`, and `skills`
  - initial directory + security warning surfaces
- Remaining:
  - setup UX polish
  - richer doctor coverage
  - outbound edits/reactions/attachments/pins wired through the full channel contract
  - deeper live QA for attachments and long-running async/subagent workflows

## Phase 2

Match fully featured OpenClaw channel flows where Keybase has a clean mapping.

Scope:

- bot command advertisements (implemented: startup syncs slash command catalog through
  Keybase `advertisecommands`; `commands.native=false` clears published commands)
- native or text-fallback approvals (implemented: shared `/approve` text
  fallback works in authorized Keybase DMs and tagged team chats; opt-in native
  approval delivery binds reaction shortcuts to bot-authored approval prompt
  message ids and configured approvers)
- better outbound formatting and chunking (implemented: default markdown-aware
  text chunking with `textChunkLimit`)
- richer directory and resolver behavior
- stable message and conversation identity mapping

## Phase 3

Bring multi-agent UX to parity.

Scope:

- same-chat async subagent updates
- explicit agent targeting through `/subagents send` and `/subagents steer`
- `status`, `cancel`, and `/subagents list`
- reply-to-bot as session continuation
- reply-to-subagent as targeted continuation where possible

Known risk:

- Keybase does not give us Discord-style child threads. Persistent per-subagent
  reply targeting likely needs a reply-bound session seam in OpenClaw core
  instead of a plugin-only workaround.

## Phase 4

Containerize the Keybase-backed fork for Lightning Labs infrastructure.

Scope:

- OpenClaw image with Keybase installed
- entrypoint that resolves secrets and runs `keybase oneshot` (started:
  `extensions/keybase/docker/keybase-entrypoint.sh` sources `/vault/secrets/*.sh`
  before delegating to `container-entrypoint.mjs`)
- persistent state for OpenClaw and Keybase home
- optional shared repo volume for coding agents

Implementation notes:

- OpenClaw already ships a multi-stage Docker build in `Dockerfile`.
- The base image can already install extra apt packages through `OPENCLAW_DOCKER_APT_PACKAGES`.
- Bundled plugin dependency pre-install is already supported through `OPENCLAW_EXTENSIONS`.
- For a Keybase-capable image we should prefer a small additive layer over a separate bespoke Docker build unless Keybase packaging forces a different base image.
- The lbot startup pattern maps cleanly:
  - source secrets
  - run `keybase oneshot`
  - start the long-running bot process
- Vault Agent deployments should write shell env files under `/vault/secrets`.
  The wrapper entrypoint sources those files before the Node entrypoint reads
  `KEYBASE_USERNAME`, `KEYBASE_PAPERKEY`, `KEYBASE_PAPERKEY_FILE`, and
  `CLAUDE_CODE_OAUTH_TOKEN`.
- Persist at least:
  - `~/.openclaw`
  - Keybase home/service state
- If the deployment also needs repo-local coding tasks, mount a separate shared workspace volume instead of putting repo state inside the Keybase home volume.

## Phase 5

Roll the image into EKS and Helm.

Scope:

- adapt the existing `lbot` chart pattern
- publish image to ECR
- inject secrets cleanly
- enforce single replica per Keybase identity
- separate shared-bot and per-user release values

Implementation notes:

- The Lightning Labs `lbot` chart is the right reference shape:
  - `Recreate` deployment strategy
  - `replicas: 1`
  - persistent `/data`
  - optional shared repo volume for coding mode
  - custom entrypoint/command flags per deployment flavor
- Vault-injected secret files and entrypoint sourcing already exist in the `lbot` pattern and should be reused for Keybase paper key plus OpenClaw provider credentials.
- Do not run a single Keybase identity behind multiple replicas or a rolling multi-pod deployment.

## Phase 6

Add profile and policy layers for production use.

Scope:

- different agent profiles by Keybase conversation or team channel
- model and tool policy defaults per profile
- routing between shared global bot and per-user instances
- operational docs for rollouts, upgrades, and disaster recovery

## Validation Ladder

Use a staged validation path instead of jumping straight to a live Keybase bot:

1. Unit and contract tests in `extensions/keybase`.
2. Repo-native QA planning:
   - `docs/concepts/qa-e2e-automation.md`
   - `docs/help/testing.md`
   - `qa/README.md`
3. Docker-backed local OpenClaw image smoke.
   - Current scaffold:
     - `extensions/keybase/docker/Dockerfile`
     - `extensions/keybase/src/container-entrypoint.ts`
     - `extensions/keybase/src/docker-smoke.ts`
     - `scripts/keybase-smoke.ts`
4. Live Keybase smoke against a restricted bot and a dedicated test team/channel.
   - Repeatable lane: `pnpm openclaw qa keybase --output-dir .artifacts/keybase-docker --team lbottest --bot lbottestbot`
   - The runner installs the requested `team#general` route into the local smoke config before assertions.
   - Covered contract: team-channel canary reply, tagged help command, native command advertisement discovery, chunked command delivery, DM canary reply, DM pairing challenge, `/subagents list`, `/subagents spawn` with same-chat completion, mention gating, group allowlist block, restart resume, and ack reaction observation.
5. Helm and EKS rollout.

## Local Smoke Plan

Before touching EKS:

1. Build the local smoke image:
   - `pnpm keybase:smoke:build`
2. Write the isolated compose scaffold:
   - `pnpm keybase:smoke:scaffold`
3. Start a single local bot container with mounted OpenClaw state and Keybase home.
4. Point it at a dedicated restricted bot identity and test team/channel such as `lbottest`.
5. Exercise the minimum live contract:
   - DM canary
   - team mention canary
   - unmentioned team message ignored
   - unallowlisted team route ignored
   - follow-up reply lands in the same conversation
6. After the single-bot path is stable, add a second test identity/container for black-box send/receive validation.
7. Promote the smoke into the repo QA runner:
   - `pnpm openclaw qa keybase`
   - `pnpm keybase:smoke:suite` for the lower-level harness entry point

The operator-friendly live transport coverage is now a real transport QA lane
modeled after `openclaw qa matrix` and `openclaw qa telegram`, not a permanent
one-off shell script.

## Open Questions

- How much native approval UX can Keybase express, and where do we need text or reaction fallback?
- Which Keybase event types should mutate transcript state for edits, deletes, pins, and reactions?
- Whether per-user instances should always use distinct bot identities, or whether some managed shared identity mode is acceptable for limited cases.
- Whether a future phase should expose a dedicated Keybase CLI doctor command for service, login, and restricted-bot checks.
