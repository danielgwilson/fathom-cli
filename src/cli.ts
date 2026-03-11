#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { clearConfig, readConfig, redactApiKey, resolveApiKey } from "./config.js";
import { saveAndValidateApiKey, validateApiKey } from "./auth.js";
import {
  collectCursorPages,
  FathomApiClient,
  FathomApiError,
  type CalendarInviteesDomainsType,
  type CreateWebhookInput,
  type Meeting,
  type MeetingsListOptions,
  type Team,
  type TeamMember,
  type TriggeredFor,
} from "./fathom-api.js";
import { exportMeetings } from "./export.js";
import {
  defaultExportDir,
  defaultZipPath,
  metadataMatchesQuery,
  renderMeetingText,
  searchMeeting,
  splitCsv,
  transcriptToText,
} from "./format.js";
import { fail, makeError, ok, printJson } from "./output.js";

type CommonJsonOptions = { json?: boolean };

type IncludeFlags = {
  transcript: boolean;
  summary: boolean;
  action_items: boolean;
  crm_matches: boolean;
};

function getCliVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: unknown };
    return typeof pkg?.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive number, got ${value}`);
  return parsed;
}

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.round(elapsedMs / 100) / 10;
  return `${seconds.toFixed(1)}s`;
}

function createStatusRenderer(label = "fathom") {
  const startedAt = Date.now();
  const spinnerFrames = ["|", "/", "-", "\\"] as const;
  let frame = 0;
  let lastLineLen = 0;
  let currentMsg = "";
  let interval: NodeJS.Timeout | null = null;

  const render = () => {
    const elapsedMs = Date.now() - startedAt;
    const spin = spinnerFrames[frame % spinnerFrames.length];
    frame += 1;
    const msg = currentMsg || "Working";
    const line = `[${label}] ${spin} ${msg} (${formatElapsed(elapsedMs)})`;
    const pad = lastLineLen > line.length ? " ".repeat(lastLineLen - line.length) : "";
    lastLineLen = line.length;
    process.stderr.write(`\r${line}${pad}`);
  };

  return {
    start(msg: string) {
      currentMsg = msg;
      if (interval) return;
      render();
      interval = setInterval(render, 120);
    },
    update(msg: string) {
      currentMsg = msg;
      if (!interval) render();
    },
    done(finalMsg?: string) {
      if (interval) clearInterval(interval);
      interval = null;
      if (finalMsg) process.stderr.write(`\r[${label}] ${finalMsg}\n`);
      else process.stderr.write("\n");
    },
  };
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => splitCsv(item));
  return splitCsv(value);
}

function parseIncludes(value: unknown, defaults: Partial<IncludeFlags> = {}): IncludeFlags {
  const set = new Set(asArray(value));
  return {
    transcript: defaults.transcript ?? set.has("transcript"),
    summary: defaults.summary ?? set.has("summary"),
    action_items: defaults.action_items ?? set.has("action_items"),
    crm_matches: defaults.crm_matches ?? set.has("crm_matches"),
  };
}

function buildMeetingsListOptions(opts: {
  createdAfter?: string;
  createdBefore?: string;
  cursor?: string;
  domains?: string[] | string;
  domainsType?: CalendarInviteesDomainsType;
  includes?: IncludeFlags;
  pageSize?: number;
  recordedBy?: string[] | string;
  teams?: string[] | string;
}): MeetingsListOptions {
  return {
    calendarInviteesDomains: asArray(opts.domains),
    calendarInviteesDomainsType: opts.domainsType,
    createdAfter: opts.createdAfter,
    createdBefore: opts.createdBefore,
    cursor: opts.cursor,
    includeActionItems: opts.includes?.action_items,
    includeCrmMatches: opts.includes?.crm_matches,
    includeSummary: opts.includes?.summary,
    includeTranscript: opts.includes?.transcript,
    pageSize: opts.pageSize,
    recordedBy: asArray(opts.recordedBy),
    teams: asArray(opts.teams),
  };
}

function pickPageSize(limit?: number, pageSize?: number): number | undefined {
  if (typeof pageSize === "number") return pageSize;
  if (typeof limit === "number") return Math.min(limit, 100);
  return 25;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function requireApiKey({ json }: CommonJsonOptions): Promise<string> {
  const apiKey = await resolveApiKey();
  if (apiKey) return apiKey;

  const error = makeError(null, { code: "AUTH_MISSING", message: "No API key. Run `fathom auth set --stdin`." });
  if (json) printJson(fail(error));
  else process.stderr.write("No API key. Use `fathom auth set --stdin` or export `FATHOM_API_KEY`.\n");
  process.exitCode = 2;
  return "";
}

function createClient(apiKey: string): FathomApiClient {
  return new FathomApiClient({ apiKey, userAgent: `fathom-video-cli/${getCliVersion()}` });
}

function printMeetingsHuman(items: Meeting[]): void {
  for (const meeting of items) {
    // eslint-disable-next-line no-console
    console.log(`${meeting.recording_id}\t${meeting.created_at}\t${meeting.title}\t${meeting.recorded_by.email}`);
  }
}

function printTeamsHuman(items: Team[]): void {
  for (const team of items) {
    // eslint-disable-next-line no-console
    console.log(`${team.created_at}\t${team.name}`);
  }
}

function printTeamMembersHuman(items: TeamMember[]): void {
  for (const member of items) {
    // eslint-disable-next-line no-console
    console.log(`${member.created_at}\t${member.email}\t${member.name}`);
  }
}

async function collectMeetings(
  client: FathomApiClient,
  opts: MeetingsListOptions & { all?: boolean; initialCursor?: string; limit?: number; query?: string },
  onPage?: (event: { pages: number; collected: number; nextCursor: string | null }) => void,
): Promise<{ items: Meeting[]; nextCursor: string | null; pages: number; scanned: number }> {
  const collected = await collectCursorPages<Awaited<ReturnType<FathomApiClient["listMeetings"]>>, Meeting>({
    all: opts.all,
    initialCursor: opts.initialCursor || opts.cursor,
    maxItems: opts.limit,
    pageSize: opts.pageSize,
    fetchPage: (cursor, pageSize) => client.listMeetings({ ...opts, cursor, pageSize }),
    onPage,
  });

  if (!opts.query) return collected;
  const items = collected.items.filter((meeting) => metadataMatchesQuery(meeting, opts.query!));
  return { ...collected, items };
}

async function findMeetingByIdentifier(
  client: FathomApiClient,
  identifier: string,
  options: MeetingsListOptions & { scanLimit?: number; all?: boolean },
): Promise<Meeting | null> {
  const numeric = Number(identifier);
  const wantsRecordingId = Number.isFinite(numeric) ? numeric : null;
  const scanLimit = options.scanLimit || 500;
  const pageSize = options.pageSize || 100;
  let cursor = options.cursor;
  let scanned = 0;

  while (scanned < scanLimit) {
    const page = await client.listMeetings({
      ...options,
      cursor,
      pageSize: Math.min(pageSize, scanLimit - scanned),
    });
    scanned += page.items.length;
    const match =
      page.items.find((meeting) => {
        if (wantsRecordingId && meeting.recording_id === wantsRecordingId) return true;
        return meeting.url === identifier || meeting.share_url === identifier;
      }) || null;
    if (match) return match;
    if (!page.next_cursor || options.all === false) break;
    cursor = page.next_cursor;
  }

  return null;
}

function normalizeTriggeredFor(value: unknown): TriggeredFor[] {
  return asArray(value) as TriggeredFor[];
}

function serializeWebhookInput(opts: {
  destinationUrl: string;
  include?: string | string[];
  triggeredFor?: string | string[];
}): CreateWebhookInput {
  const include = new Set(asArray(opts.include));
  return {
    destination_url: opts.destinationUrl,
    include_action_items: include.has("action_items"),
    include_crm_matches: include.has("crm_matches"),
    include_summary: include.has("summary"),
    include_transcript: include.has("transcript"),
    triggered_for: normalizeTriggeredFor(opts.triggeredFor),
  };
}

const program = new Command();
program.name("fathom").description("Agent-first CLI for Fathom's official API").version(getCliVersion());

program
  .command("auth")
  .description("Manage the Fathom API key")
  .addCommand(
    new Command("show")
      .description("Show API key source (redacted)")
      .option("--json", "Print JSON")
      .action(async (opts: CommonJsonOptions) => {
        const config = await readConfig();
        const env = process.env.FATHOM_API_KEY?.trim();
        const apiKey = env || config?.apiKey || "";
        if (!apiKey) {
          if (opts.json) printJson(fail(makeError(null, { code: "AUTH_MISSING", message: "No API key set" }), { hasApiKey: false }));
          else process.stderr.write("No API key set. Use `fathom auth set --stdin` or export `FATHOM_API_KEY`.\n");
          process.exitCode = 2;
          return;
        }
        const source = env ? "env:FATHOM_API_KEY" : "config";
        if (opts.json) {
          printJson(ok({ hasApiKey: true, source, apiKeyRedacted: redactApiKey(apiKey) }));
          return;
        }
        // eslint-disable-next-line no-console
        console.log(`${source}: ${redactApiKey(apiKey)}`);
      }),
  )
  .addCommand(
    new Command("status")
      .description("Validate the configured API key")
      .option("--json", "Print JSON")
      .action(async (opts: CommonJsonOptions) => {
        const env = process.env.FATHOM_API_KEY?.trim();
        const config = await readConfig();
        const apiKey = await resolveApiKey();
        const source = env ? "env:FATHOM_API_KEY" : config?.apiKey ? "config" : null;
        if (!apiKey) {
          if (opts.json) printJson(fail(makeError(null, { code: "AUTH_MISSING", message: "No API key set" }), { hasApiKey: false, source }));
          else process.stderr.write("No API key set. Run `fathom auth set --stdin`.\n");
          process.exitCode = 2;
          return;
        }

        const validation = await validateApiKey(apiKey);
        if (opts.json) {
          printJson(ok({ hasApiKey: true, source, apiKeyRedacted: redactApiKey(apiKey), validation }));
          if (!validation.ok) process.exitCode = 1;
        } else if (validation.ok) {
          // eslint-disable-next-line no-console
          console.log(`API key valid (${source || "unknown source"})`);
        } else {
          process.stderr.write(`API key invalid: ${validation.reason}\n`);
          process.exitCode = 1;
        }
      }),
  )
  .addCommand(
    new Command("set")
      .description("Save an API key from stdin")
      .option("--stdin", "Read the API key from stdin")
      .option("--json", "Print JSON")
      .action(async (opts: { stdin?: boolean; json?: boolean }) => {
        const shouldReadStdin = !!opts.stdin || !process.stdin.isTTY;
        if (!shouldReadStdin) {
          const error = makeError(null, { code: "VALIDATION", message: "Use `--stdin` or pipe the API key in." });
          if (opts.json) printJson(fail(error));
          else process.stderr.write(`${error.message}\n`);
          process.exitCode = 2;
          return;
        }

        const raw = (await readStdin()).trim();
        if (!raw) {
          const error = makeError(null, { code: "VALIDATION", message: "No API key received on stdin" });
          if (opts.json) printJson(fail(error));
          else process.stderr.write(`${error.message}\n`);
          process.exitCode = 2;
          return;
        }

        const result = await saveAndValidateApiKey(raw);
        if (opts.json) {
          printJson(ok({ saved: true, apiKeyRedacted: redactApiKey(result.apiKey), validation: result.validation }));
          if (!result.validation.ok) process.exitCode = 1;
          return;
        }
        process.stderr.write(`Saved Fathom API key (${redactApiKey(result.apiKey)}) to ~/.config/fathom/config.json.\n`);
        if (!result.validation.ok) process.exitCode = 1;
      }),
  )
  .addCommand(
    new Command("clear")
      .description("Clear the saved API key from local config")
      .option("--json", "Print JSON")
      .action(async (opts: CommonJsonOptions) => {
        await clearConfig();
        if (opts.json) {
          printJson(ok({ cleared: true }));
          return;
        }
        // eslint-disable-next-line no-console
        console.log("Cleared saved Fathom config.");
      }),
  );

program
  .command("doctor")
  .description("Run read-only connectivity checks")
  .option("--json", "Print JSON")
  .action(async (opts: CommonJsonOptions) => {
    const apiKey = await requireApiKey(opts);
    if (!apiKey) return;
    const client = createClient(apiKey);
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

    checks.push({ name: "auth.present", ok: true });

    try {
      await client.listTeams({ pageSize: 1 });
      checks.push({ name: "api.teams.list", ok: true });
    } catch (error: any) {
      checks.push({ name: "api.teams.list", ok: false, detail: error?.message || "Failed" });
    }

    try {
      await client.listTeamMembers({ pageSize: 1 });
      checks.push({ name: "api.team_members.list", ok: true });
    } catch (error: any) {
      checks.push({ name: "api.team_members.list", ok: false, detail: error?.message || "Failed" });
    }

    try {
      const meetings = await client.listMeetings({ pageSize: 1 });
      checks.push({ name: "api.meetings.list", ok: true });
      if (meetings.items[0]) {
        const recordingId = meetings.items[0].recording_id;
        try {
          await client.getRecordingTranscript(recordingId);
          checks.push({ name: "api.recordings.transcript", ok: true });
        } catch (error: any) {
          checks.push({ name: "api.recordings.transcript", ok: false, detail: error?.message || "Failed" });
        }
        try {
          await client.getRecordingSummary(recordingId);
          checks.push({ name: "api.recordings.summary", ok: true });
        } catch (error: any) {
          checks.push({ name: "api.recordings.summary", ok: false, detail: error?.message || "Failed" });
        }
      }
    } catch (error: any) {
      checks.push({ name: "api.meetings.list", ok: false, detail: error?.message || "Failed" });
    }

    const allOk = checks.every((check) => check.ok);
    if (opts.json) {
      const envelope = allOk ? ok({ checks }) : fail(makeError(null, { code: "CHECK_FAILED", message: "One or more checks failed" }), { checks });
      printJson(envelope);
      if (!allOk) process.exitCode = 1;
      return;
    }

    for (const check of checks) {
      process.stderr.write(`${check.ok ? "OK" : "FAIL"}\t${check.name}${check.detail ? `\t${check.detail}` : ""}\n`);
    }
    if (!allOk) process.exitCode = 1;
  });

const meetingsCommand = new Command("meetings").alias("calls").description("List, search, and export meetings");

meetingsCommand
  .command("list")
  .description("List meetings with official filters and optional local metadata query")
  .option("--all", "Paginate until exhaustion")
  .option("--limit <n>", "Maximum meetings to return", parseInteger)
  .option("--page-size <n>", "API page size", parseInteger)
  .option("--cursor <cursor>", "Start from this cursor")
  .option("--created-after <iso>", "Filter by created_at > timestamp")
  .option("--created-before <iso>", "Filter by created_at < timestamp")
  .option("--team <name>", "Filter by team (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--recorded-by <email>", "Filter by recorder email (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--domain <domain>", "Filter by invitee domain (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--domains-type <type>", "all | only_internal | one_or_more_external")
  .option("--with <items>", "Include transcript,summary,action_items,crm_matches")
  .option("--query <text>", "Local metadata query over listed meetings")
  .option("--json", "Print JSON")
  .action(async (opts: any) => {
    const apiKey = await requireApiKey(opts);
    if (!apiKey) return;
    const client = createClient(apiKey);
    const includes = parseIncludes(opts.with);
    const listOptions = buildMeetingsListOptions({
      createdAfter: opts.createdAfter,
      createdBefore: opts.createdBefore,
      cursor: opts.cursor,
      domains: opts.domain,
      domainsType: opts.domainsType,
      includes,
      pageSize: pickPageSize(opts.limit, opts.pageSize),
      recordedBy: opts.recordedBy,
      teams: opts.team,
    });

    const collected = await collectMeetings(
      client,
      {
        ...listOptions,
        all: !!opts.all,
        limit: opts.limit,
        query: opts.query,
      },
      () => undefined,
    );

    if (opts.json) {
      printJson(
        ok({
          count: collected.items.length,
          items: collected.items,
          page: {
            pages: collected.pages,
            scanned: collected.scanned,
            nextCursor: collected.nextCursor,
          },
          filter: {
            created_after: opts.createdAfter || null,
            created_before: opts.createdBefore || null,
            teams: asArray(opts.team),
            recorded_by: asArray(opts.recordedBy),
            calendar_invitees_domains: asArray(opts.domain),
            calendar_invitees_domains_type: opts.domainsType || null,
            query: opts.query || null,
          },
          include: includes,
        }),
      );
      return;
    }

    printMeetingsHuman(collected.items);
  });

meetingsCommand
  .command("get")
  .description("Get a single meeting by recording_id, call URL, or share URL")
  .argument("<identifier>", "recording_id, call URL, or share URL")
  .option("--scan-limit <n>", "Maximum meetings to scan while resolving", parseInteger, 500)
  .option("--page-size <n>", "API page size while resolving", parseInteger, 100)
  .option("--created-after <iso>", "Filter by created_at > timestamp")
  .option("--created-before <iso>", "Filter by created_at < timestamp")
  .option("--team <name>", "Filter by team (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--recorded-by <email>", "Filter by recorder email (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--domain <domain>", "Filter by invitee domain (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--domains-type <type>", "all | only_internal | one_or_more_external")
  .option("--with <items>", "Include transcript,summary,action_items,crm_matches")
  .option("--json", "Print JSON")
  .action(async (identifier: string, opts: any) => {
    const apiKey = await requireApiKey(opts);
    if (!apiKey) return;
    const client = createClient(apiKey);
    const includes = parseIncludes(opts.with, { summary: true });
    const meeting = await findMeetingByIdentifier(client, identifier, {
      ...buildMeetingsListOptions({
        createdAfter: opts.createdAfter,
        createdBefore: opts.createdBefore,
        domains: opts.domain,
        domainsType: opts.domainsType,
        includes,
        pageSize: opts.pageSize,
        recordedBy: opts.recordedBy,
        teams: opts.team,
      }),
      scanLimit: opts.scanLimit,
    });

    if (!meeting) {
      const error = makeError(null, { code: "NOT_FOUND", message: "Meeting not found" });
      if (opts.json) printJson(fail(error));
      else process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }

    if (opts.json) {
      printJson(ok({ meeting, include: includes }));
      return;
    }

    // eslint-disable-next-line no-console
    console.log(renderMeetingText(meeting));
  });

meetingsCommand
  .command("grep")
  .description("Search across meeting metadata, summaries, action items, and transcripts")
  .argument("<query>", "Search text")
  .option("--all", "Paginate until exhaustion")
  .option("--limit <n>", "Maximum meetings to scan", parseInteger)
  .option("--page-size <n>", "API page size", parseInteger)
  .option("--cursor <cursor>", "Start from this cursor")
  .option("--created-after <iso>", "Filter by created_at > timestamp")
  .option("--created-before <iso>", "Filter by created_at < timestamp")
  .option("--team <name>", "Filter by team (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--recorded-by <email>", "Filter by recorder email (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--domain <domain>", "Filter by invitee domain (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--domains-type <type>", "all | only_internal | one_or_more_external")
  .option("--json", "Print JSON")
  .action(async (query: string, opts: any) => {
    const apiKey = await requireApiKey(opts);
    if (!apiKey) return;
    const client = createClient(apiKey);
    const status = opts.json ? null : createStatusRenderer();
    status?.start("Scanning meetings");
    const collected = await collectMeetings(
      client,
      {
        ...buildMeetingsListOptions({
          createdAfter: opts.createdAfter,
          createdBefore: opts.createdBefore,
          cursor: opts.cursor,
          domains: opts.domain,
          domainsType: opts.domainsType,
          includes: { transcript: true, summary: true, action_items: true, crm_matches: false },
          pageSize: pickPageSize(opts.limit, opts.pageSize),
          recordedBy: opts.recordedBy,
          teams: opts.team,
        }),
        all: !!opts.all,
        limit: opts.limit,
      },
      ({ collected }) => status?.update(`Scanned ${collected} meetings`),
    );

    const matches = collected.items.flatMap((meeting) => searchMeeting(meeting, query));
    status?.done(`Search complete (${matches.length} matches)`);

    if (opts.json) {
      printJson(ok({ query, count: matches.length, matches, scanned: collected.scanned, pages: collected.pages, nextCursor: collected.nextCursor }));
      return;
    }

    for (const match of matches) {
      // eslint-disable-next-line no-console
      console.log(`${match.recording_id}\t${match.source}\t${match.timestamp || ""}\t${match.title}\t${match.snippet}`);
    }
  });

meetingsCommand
  .command("export")
  .description("Export filtered meetings into json/md/txt bundles")
  .option("--all", "Paginate until exhaustion")
  .option("--limit <n>", "Maximum meetings to export", parseInteger)
  .option("--page-size <n>", "API page size", parseInteger)
  .option("--cursor <cursor>", "Start from this cursor")
  .option("--created-after <iso>", "Filter by created_at > timestamp")
  .option("--created-before <iso>", "Filter by created_at < timestamp")
  .option("--team <name>", "Filter by team (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--recorded-by <email>", "Filter by recorder email (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--domain <domain>", "Filter by invitee domain (repeat or comma separate)", (value, list: string[] = []) => [...list, value], [])
  .option("--domains-type <type>", "all | only_internal | one_or_more_external")
  .option("--query <text>", "Local metadata query")
  .option("--format <items>", "json,md,txt", "json,md,txt")
  .option("--out-dir <path>", "Output directory", defaultExportDir())
  .option("--zip", "Create a zip archive")
  .option("--zip-path <path>", "Zip output path", defaultZipPath())
  .option("--json", "Print JSON")
  .action(async (opts: any) => {
    const apiKey = await requireApiKey(opts);
    if (!apiKey) return;
    const client = createClient(apiKey);
    const status = opts.json ? null : createStatusRenderer();
    status?.start("Preparing export");
    const result = await exportMeetings(client, {
      ...buildMeetingsListOptions({
        createdAfter: opts.createdAfter,
        createdBefore: opts.createdBefore,
        cursor: opts.cursor,
        domains: opts.domain,
        domainsType: opts.domainsType,
        includes: { transcript: true, summary: true, action_items: true, crm_matches: true },
        pageSize: pickPageSize(opts.limit, opts.pageSize),
        recordedBy: opts.recordedBy,
        teams: opts.team,
      }),
      all: !!opts.all,
      formats: splitCsv(opts.format) as Array<"json" | "md" | "txt">,
      maxItems: opts.limit,
      outDir: opts.outDir,
      query: opts.query,
      zip: !!opts.zip,
      zipPath: opts.zip ? opts.zipPath : undefined,
      onStatus: ({ msg }) => status?.update(msg),
    });
    status?.done("Export complete");

    printJson(ok(result));
  });

program.addCommand(meetingsCommand);

const recordingsCommand = new Command("recordings").description("Transcript and summary retrieval by recording_id");

recordingsCommand
  .command("transcript")
  .description("Fetch the transcript for a recording_id")
  .argument("<recording-id>", "Numeric recording_id", parseInteger)
  .option("--destination-url <url>", "Send transcript to a callback URL instead of returning it directly")
  .option("--json", "Print JSON")
  .action(async (recordingId: number, opts: any) => {
    const apiKey = await requireApiKey(opts);
    if (!apiKey) return;
    const client = createClient(apiKey);
    const result = await client.getRecordingTranscript(recordingId, opts.destinationUrl);
    if (opts.destinationUrl || opts.json) {
      printJson(ok({ recording_id: recordingId, result }));
      return;
    }
    // eslint-disable-next-line no-console
    console.log(transcriptToText("transcript" in result ? result.transcript : []));
  });

recordingsCommand
  .command("summary")
  .description("Fetch the summary for a recording_id")
  .argument("<recording-id>", "Numeric recording_id", parseInteger)
  .option("--destination-url <url>", "Send summary to a callback URL instead of returning it directly")
  .option("--json", "Print JSON")
  .action(async (recordingId: number, opts: any) => {
    const apiKey = await requireApiKey(opts);
    if (!apiKey) return;
    const client = createClient(apiKey);
    const result = await client.getRecordingSummary(recordingId, opts.destinationUrl);
    if (opts.destinationUrl || opts.json) {
      printJson(ok({ recording_id: recordingId, result }));
      return;
    }
    if ("summary" in result) {
      // eslint-disable-next-line no-console
      console.log(result.summary.markdown_formatted || "");
      return;
    }
    // eslint-disable-next-line no-console
    console.log(result.destination_url);
  });

program.addCommand(recordingsCommand);

program
  .command("teams")
  .description("List teams visible to the API key")
  .option("--all", "Paginate until exhaustion")
  .option("--limit <n>", "Maximum teams to return", parseInteger)
  .option("--page-size <n>", "API page size", parseInteger)
  .option("--cursor <cursor>", "Start from this cursor")
  .option("--json", "Print JSON")
  .action(async (opts: any) => {
    const apiKey = await requireApiKey(opts);
    if (!apiKey) return;
    const client = createClient(apiKey);
    const collected = await collectCursorPages<Awaited<ReturnType<FathomApiClient["listTeams"]>>, Team>({
      all: !!opts.all,
      initialCursor: opts.cursor,
      maxItems: opts.limit,
      pageSize: pickPageSize(opts.limit, opts.pageSize),
      fetchPage: (cursor, pageSize) => client.listTeams({ cursor, pageSize }),
    });

    if (opts.json) {
      printJson(ok({ count: collected.items.length, items: collected.items, page: { pages: collected.pages, scanned: collected.scanned, nextCursor: collected.nextCursor } }));
      return;
    }

    printTeamsHuman(collected.items);
  });

program
  .command("team-members")
  .description("List team members visible to the API key")
  .option("--all", "Paginate until exhaustion")
  .option("--limit <n>", "Maximum team members to return", parseInteger)
  .option("--page-size <n>", "API page size", parseInteger)
  .option("--cursor <cursor>", "Start from this cursor")
  .option("--team <name>", "Filter by team name")
  .option("--query <text>", "Local text query over name/email")
  .option("--json", "Print JSON")
  .action(async (opts: any) => {
    const apiKey = await requireApiKey(opts);
    if (!apiKey) return;
    const client = createClient(apiKey);
    const collected = await collectCursorPages<Awaited<ReturnType<FathomApiClient["listTeamMembers"]>>, TeamMember>({
      all: !!opts.all,
      initialCursor: opts.cursor,
      maxItems: opts.limit,
      pageSize: pickPageSize(opts.limit, opts.pageSize),
      fetchPage: (cursor, pageSize) => client.listTeamMembers({ cursor, pageSize, team: opts.team }),
    });

    const items = opts.query
      ? collected.items.filter((member) => `${member.name}\n${member.email}`.toLowerCase().includes(String(opts.query).toLowerCase()))
      : collected.items;

    if (opts.json) {
      printJson(ok({ count: items.length, items, page: { pages: collected.pages, scanned: collected.scanned, nextCursor: collected.nextCursor }, team: opts.team || null, query: opts.query || null }));
      return;
    }

    printTeamMembersHuman(items);
  });

const webhooksCommand = new Command("webhooks").description("Create and delete official Fathom webhooks");

webhooksCommand
  .command("create")
  .description("Create a webhook")
  .requiredOption("--destination-url <url>", "Webhook destination URL")
  .requiredOption("--triggered-for <items>", "Triggered-for values")
  .requiredOption("--include <items>", "At least one of transcript,summary,action_items,crm_matches")
  .option("--json", "Print JSON")
  .action(async (opts: any) => {
    const apiKey = await requireApiKey(opts);
    if (!apiKey) return;
    const input = serializeWebhookInput(opts);
    const includeCount = [
      input.include_action_items,
      input.include_crm_matches,
      input.include_summary,
      input.include_transcript,
    ].filter(Boolean).length;
    if (includeCount === 0) {
      const error = makeError(null, { code: "VALIDATION", message: "At least one include value is required" });
      printJson(fail(error));
      process.exitCode = 2;
      return;
    }
    if (!input.triggered_for.length) {
      const error = makeError(null, { code: "VALIDATION", message: "At least one triggered_for value is required" });
      printJson(fail(error));
      process.exitCode = 2;
      return;
    }
    const client = createClient(apiKey);
    const webhook = await client.createWebhook(input);
    printJson(ok({ webhook }));
  });

webhooksCommand
  .command("delete")
  .description("Delete a webhook")
  .argument("<id>", "Webhook id")
  .option("--json", "Print JSON")
  .action(async (id: string, opts: any) => {
    const apiKey = await requireApiKey(opts);
    if (!apiKey) return;
    const client = createClient(apiKey);
    await client.deleteWebhook(id);
    printJson(ok({ deleted: true, id }));
  });

program.addCommand(webhooksCommand);

program.showHelpAfterError();

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error: any) {
    const cliError = error instanceof FathomApiError ? makeError(error) : makeError(error);
    printJson(fail(cliError));
    process.exitCode = cliError.code === "AUTH_MISSING" || cliError.code === "VALIDATION" ? 2 : 1;
  }
}

void main();
