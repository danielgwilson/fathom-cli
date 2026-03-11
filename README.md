# fathom-video-cli

Agent-first TypeScript CLI + skill for the official Fathom API.

This implementation is intentionally official-API-first:

- list/filter meetings
- fetch transcripts
- fetch summaries
- list teams
- list team members
- create/delete webhooks
- derived agent helpers on top of that official surface:
  - `meetings get`
  - `meetings grep`
  - `meetings export`

As of March 11, 2026, I do not see an official Fathom CLI. Fathom does publish an official API and official TypeScript SDK, but this CLI uses a thin typed REST client instead of the beta SDK so it can keep a stricter agent contract.

## Install

Global:

```bash
npm i -g fathom-video-cli
```

Local:

```bash
cd platform-adapters/fathom/fathom-cli
npm install
npm link
```

Skill install:

```bash
npx -y skills add -g danielgwilson/fathom-cli --skill fathom
```

Requirements:

- Node.js 22+

## Auth

Use an API key from the official Fathom developer settings.

Preferred ephemeral auth:

```bash
export FATHOM_API_KEY="..."
fathom auth status --json
```

Store locally for repeated use:

```bash
printf '%s' "$FATHOM_API_KEY" | fathom auth set --stdin
fathom auth status --json
```

The saved config lives at `~/.config/fathom/config.json` with `0600` permissions.

Tip: if you keep the key in a local `.env`, Node 22+ can load it without adding any CLI dependency:

```bash
node --env-file ../.env "$(command -v fathom)" doctor --json
```

## Main commands

Read-first workflow:

```bash
fathom doctor --json
fathom meetings list --limit 25 --json
fathom meetings get 123456789 --with summary,transcript --json
fathom recordings transcript 123456789 --json
fathom recordings summary 123456789 --json
```

Search/filter workflow:

```bash
fathom meetings list --team Operations --created-after 2026-03-01 --json
fathom meetings list --query "customer discovery" --all --limit 100 --json
fathom meetings grep "renewal timeline" --limit 25 --json
```

Export workflow:

```bash
fathom meetings export --all --zip
fathom meetings export --team Operations --format json,md,txt --out-dir ./fathom-export
```

Official admin surfaces:

```bash
fathom teams --json
fathom team-members --team Operations --json
fathom webhooks create \
  --destination-url https://example.com/fathom-webhook \
  --triggered-for my_recordings \
  --include transcript,summary
```

## Design notes

- `meetings get` is a derived helper. Fathom does not publish a single-meeting fetch endpoint.
- `meetings grep` is also derived. It uses the official meetings list with transcript/summary enrichment when needed.
- There is no official `whoami` endpoint, so this CLI does not pretend there is one.
- `recordings transcript` and `recordings summary` support Fathom’s async callback mode via `--destination-url`.

## Agent-first contract

See [docs/CONTRACT_V1.md](./docs/CONTRACT_V1.md).

## Publishing (maintainers)

This package is scaffolded for npm trusted publishing from GitHub Actions.

- CI workflow: `.github/workflows/ci.yml`
- publish workflow: `.github/workflows/publish.yml`
- maintainer notes: `fathom-trusted-publishing-notes.md`
