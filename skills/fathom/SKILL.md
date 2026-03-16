---
name: fathom
description: Use this skill whenever you need to list, filter, search, export, or retrieve transcripts and summaries from Fathom via the official API using the agent-first `fathom` CLI.
---

# Fathom (agent-first CLI)

Use this skill when the task is about Fathom meetings, transcripts, summaries, teams, team members, or official webhooks.

Default stance:

- Prefer the official API-backed CLI, not browser automation.
- Prefer `--json` for machine use.
- Prefer filtering before exporting.
- Use `meetings grep` when you need content search across summaries/transcripts.
- If `fathom` is missing from `PATH`, install the published CLI with `npm i -g fathom-video-cli`, or prefix one-shot commands with `npx -y fathom-video-cli`.

## Default workflow

- Sanity check: `fathom doctor --json`
- Browse recent meetings: `fathom meetings list --limit 25 --json`
- Narrow by metadata: `fathom meetings list --team Operations --created-after 2026-03-01 --query "customer discovery" --json`
- Resolve one meeting: `fathom meetings get <recording_id_or_url> --with summary,transcript --json`
- Resolve a public share link: `fathom meetings get 'https://fathom.video/share/...' --with transcript --json`
- Pull exact transcript or summary: `fathom recordings transcript <recording_id> --json` and `fathom recordings summary <recording_id> --json`

## Common tasks

- Search meeting content: `fathom meetings grep "renewal timeline" --limit 50 --json`
- Export a bundle: `fathom meetings export --all --zip`
- Export a filtered slice: `fathom meetings export --team Operations --created-after 2026-03-01 --format json,md,txt --json`
- Inspect teams: `fathom teams --json`
- Inspect team members: `fathom team-members --team Operations --json`
- Create a webhook: `fathom webhooks create --destination-url https://example.com/fathom-webhook --triggered-for my_recordings --include transcript,summary`

## Auth

If `fathom doctor --json` reports missing auth:

- Best ephemeral path: `FATHOM_API_KEY=... fathom doctor --json`
- If `fathom` is not installed globally: `FATHOM_API_KEY=... npx -y fathom-video-cli doctor --json`
- Saved local config: `fathom auth set`
- Non-interactive automation: `printf '%s' "$FATHOM_API_KEY" | fathom auth set --stdin`

Avoid pasting full keys into logs or chat.

Public share URLs are the exception: `fathom meetings get <share_url> --with transcript --json` can resolve through Fathom's public share page even when no API key is configured.

## Important constraints

- There is no official `whoami` endpoint.
- `meetings get` is a derived helper, because Fathom does not publish a single-meeting fetch endpoint.
- `meetings get` may resolve a public share URL through the public share page instead of the official API. In that case the result can include `source: "public_share_page"` and `official_recording_id: null`.
- `recordings transcript` and `recordings summary` switch into callback mode when `--destination-url` is supplied.
- Webhook secrets only appear on creation. Capture them immediately if you need signature verification.

## Contract essentials

- Prefer `--json` for agent work.
- With `--json`, stdout should contain exactly one JSON object.
- Progress and status belong on stderr.
- Exit codes:
  - `0` success
  - `1` request failure, upstream failure, or failed checks
  - `2` auth/user action required or invalid input
- Common error codes:
  - `AUTH_MISSING`
  - `NOT_FOUND`
  - `RATE_LIMITED`
  - `UPSTREAM_5XX`
  - `TIMEOUT`
  - `VALIDATION`
  - `CHECK_FAILED`
