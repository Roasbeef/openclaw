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

- Planned.
- Phase 0 transport spike is in progress in `extensions/keybase`.
- Public channel docs and product wiring should wait for phase 1.

## Goals

- Add Keybase as an official bundled OpenClaw channel plugin.
- Support DMs, team channels, mention-gated group chat, reply threading, reactions, edits, attachments, pins, and command advertisements.
- Preserve full OpenClaw channel behavior where Keybase can express it: pairing, allowlists, `status`, `cancel`, async subagent updates, and explicit agent targeting.
- Support both shared bot deployment and isolated per-user deployment.

## Non Goals

- Do not ship a permanent `lbot` bridge layer inside OpenClaw.
- Do not add Keybase-specific logic to core when the plugin contract can carry it.
- Do not claim Keybase is supported in public docs or channel pickers until phase 1 is complete.

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

## Phase 2

Match fully featured OpenClaw channel flows where Keybase has a clean mapping.

Scope:

- bot command advertisements
- native or text-fallback approvals
- better outbound formatting and chunking
- richer directory and resolver behavior
- stable message and conversation identity mapping

## Phase 3

Bring multi-agent UX to parity.

Scope:

- same-chat async subagent updates
- explicit agent targeting
- `status` and `cancel`
- reply-to-bot as session continuation
- reply-to-subagent as targeted continuation where possible

Known risk:

- Keybase does not obviously give us Discord-style child threads. If persistent per-subagent thread routing is required, we likely need a reply-bound session seam in OpenClaw core instead of a plugin-only workaround.

## Phase 4

Containerize the Keybase-backed fork for Lightning Labs infrastructure.

Scope:

- OpenClaw image with Keybase installed
- entrypoint that resolves secrets and runs `keybase oneshot`
- persistent state for OpenClaw and Keybase home
- optional shared repo volume for coding agents

## Phase 5

Roll the image into EKS and Helm.

Scope:

- adapt the existing `lbot` chart pattern
- publish image to ECR
- inject secrets cleanly
- enforce single replica per Keybase identity
- separate shared-bot and per-user release values

## Phase 6

Add profile and policy layers for production use.

Scope:

- different agent profiles by Keybase conversation or team channel
- model and tool policy defaults per profile
- routing between shared global bot and per-user instances
- operational docs for rollouts, upgrades, and disaster recovery

## Open Questions

- How much native approval UX can Keybase express, and where do we need text or reaction fallback?
- Which Keybase event types should mutate transcript state for edits, deletes, pins, and reactions?
- Whether per-user instances should always use distinct bot identities, or whether some managed shared identity mode is acceptable for limited cases.
- Whether a future phase should expose a dedicated Keybase CLI doctor command for service, login, and restricted-bot checks.
