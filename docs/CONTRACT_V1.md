# Fathom CLI v1 contract (agent-first)

This document defines stable machine-readable behavior for the official-API-first Fathom CLI.

## Output rules

- When you pass `--json`, the command prints exactly one JSON object to stdout.
- Progress and status logs go to stderr.
- Mutation-style commands always print JSON to stdout:
  - `fathom meetings export`
  - `fathom webhooks create`
  - `fathom webhooks delete`
- Async callback mode also prints JSON even without `--json`:
  - `fathom recordings transcript --destination-url ...`
  - `fathom recordings summary --destination-url ...`

## JSON envelope

Success:

```json
{
  "ok": true,
  "data": {},
  "meta": {}
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_MISSING",
    "message": "No API key. Run `fathom auth set` to save one locally, `fathom auth set --stdin` to pipe one in, or export `FATHOM_API_KEY`.",
    "retryable": false,
    "http": { "status": 401 }
  },
  "meta": {}
}
```

`meta` and `error.http` are optional.

## Exit codes

- `0`: success
- `1`: request failure, upstream failure, failed checks, or not found
- `2`: user action required or invalid input

## Error codes

- `AUTH_MISSING`
- `AUTH_INVALID`
- `NOT_FOUND`
- `RATE_LIMITED`
- `UPSTREAM_5XX`
- `TIMEOUT`
- `VALIDATION`
- `CHECK_FAILED`
- `UNKNOWN`

## Coverage boundary

Direct official API coverage:

- `meetings list`
- `recordings transcript`
- `recordings summary`
- `teams`
- `team-members`
- `webhooks create`
- `webhooks delete`

Derived agent helpers built on top of the official API:

- `meetings get`
- `meetings grep`
- `meetings export`

## Command examples

### `fathom auth status --json`

```json
{
  "ok": true,
  "data": {
    "hasApiKey": true,
    "source": "env:FATHOM_API_KEY",
    "apiKeyRedacted": "PbXI…_WTw",
    "validation": { "ok": true }
  }
}
```

### `fathom doctor --json`

```json
{
  "ok": true,
  "data": {
    "checks": [
      { "name": "auth.present", "ok": true },
      { "name": "api.meetings.list", "ok": true }
    ]
  }
}
```

Failed checks:

```json
{
  "ok": false,
  "error": {
    "code": "CHECK_FAILED",
    "message": "One or more checks failed",
    "retryable": false
  },
  "meta": {
    "checks": [
      { "name": "api.teams.list", "ok": false, "detail": "..." }
    ]
  }
}
```

### `fathom meetings list --json`

```json
{
  "ok": true,
  "data": {
    "count": 2,
    "items": [{ "recording_id": 123456789, "title": "..." }],
    "page": {
      "pages": 1,
      "scanned": 10,
      "nextCursor": "..."
    },
    "filter": {
      "created_after": null,
      "created_before": null,
      "teams": [],
      "recorded_by": [],
      "calendar_invitees_domains": [],
      "calendar_invitees_domains_type": null,
      "query": null
    },
    "include": {
      "transcript": false,
      "summary": false,
      "action_items": false,
      "crm_matches": false
    }
  }
}
```

Notes:

- `scanned` may be larger than `count` because the API pages in chunks and the CLI applies its own output cap.
- The CLI uses the official meeting object shape directly, including snake_case fields.

### `fathom meetings get <identifier> --json`

```json
{
  "ok": true,
  "data": {
    "meeting": {
      "recording_id": 123456789,
      "title": "...",
      "url": "https://fathom.video/calls/..."
    },
    "include": {
      "transcript": true,
      "summary": true,
      "action_items": false,
      "crm_matches": false
    }
  }
}
```

Notes:

- `<identifier>` can be a numeric `recording_id`, a call URL, or a share URL.
- This is a derived helper because the official API does not publish `GET /meetings/{id}`.
- Public share URLs are resolved through Fathom's public share page instead of the official API list surface.
- Public share-url results may return `source: "public_share_page"`, `official_recording_id: null`, and transcript-only coverage when summary data is not exposed publicly.

### `fathom meetings grep <query> --json`

```json
{
  "ok": true,
  "data": {
    "query": "patient",
    "count": 3,
    "matches": [
      {
        "source": "summary",
        "recording_id": 123456789,
        "title": "...",
        "snippet": "...",
        "timestamp": "00:10:00",
        "speaker": "Alice",
        "url": "https://fathom.video/calls/...",
        "share_url": "https://fathom.video/share/..."
      }
    ]
  }
}
```

### `fathom recordings transcript <recording_id> --json`

```json
{
  "ok": true,
  "data": {
    "recording_id": 123456789,
    "result": {
      "transcript": [
        {
          "speaker": { "display_name": "Alice" },
          "text": "Hello",
          "timestamp": "00:00:01"
        }
      ]
    }
  }
}
```

### `fathom recordings transcript <recording_id> --destination-url ...`

```json
{
  "ok": true,
  "data": {
    "recording_id": 123456789,
    "result": {
      "destination_url": "https://example.com/webhook"
    }
  }
}
```

### `fathom recordings summary <recording_id> --json`

```json
{
  "ok": true,
  "data": {
    "recording_id": 123456789,
    "result": {
      "summary": {
        "template_name": "General",
        "markdown_formatted": "## Summary ..."
      }
    }
  }
}
```

### `fathom teams --json`

```json
{
  "ok": true,
  "data": {
    "count": 3,
    "items": [{ "name": "Operations", "created_at": "..." }]
  }
}
```

### `fathom team-members --json`

```json
{
  "ok": true,
  "data": {
    "count": 3,
    "items": [{ "name": "Alex Example", "email": "alex@example.com", "created_at": "..." }],
    "team": null,
    "query": null
  }
}
```

### `fathom webhooks create`

```json
{
  "ok": true,
  "data": {
    "webhook": {
      "id": "ikEoQ4bVoq4JYUmc",
      "url": "https://example.com/webhook",
      "secret": "whsec_...",
      "include_transcript": true,
      "triggered_for": ["my_recordings"]
    }
  }
}
```

### `fathom webhooks delete`

```json
{
  "ok": true,
  "data": {
    "deleted": true,
    "id": "ikEoQ4bVoq4JYUmc"
  }
}
```
