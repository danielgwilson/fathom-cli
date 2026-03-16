import path from "node:path";
import type { ActionItem, Meeting, MeetingSummary, SharedMeeting, TranscriptItem } from "./fathom-api.js";

export type SearchSource = "metadata" | "summary" | "transcript" | "action_item";

export type SearchMatch = {
  source: SearchSource;
  recording_id: number;
  title: string;
  snippet: string;
  timestamp?: string;
  speaker?: string;
  url: string;
  share_url: string;
};

export function splitCsv(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function safeMeetingStem(meeting: Meeting): string {
  const title = meeting.meeting_title || meeting.title || `meeting-${meeting.recording_id}`;
  return `${meeting.recording_id}-${slugify(title) || "meeting"}`;
}

export function defaultExportDir(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(process.cwd(), `fathom-export-${date}`);
}

export function defaultZipPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(process.cwd(), `fathom-export-${date}.zip`);
}

export function transcriptToText(items: TranscriptItem[] | null | undefined): string {
  if (!items?.length) return "";
  return items
    .map((item) => {
      const speaker = item.speaker?.display_name || "Unknown speaker";
      return `[${item.timestamp}] ${speaker}: ${item.text}`;
    })
    .join("\n");
}

export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[ \t]*[-*+]\s+/gm, "- ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function actionItemsToText(actionItems: ActionItem[] | null | undefined): string {
  if (!actionItems?.length) return "";
  return actionItems
    .map((item) => {
      const assignee = item.assignee?.email || item.assignee?.name || "unassigned";
      return `- [${item.completed ? "x" : " "}] ${item.description} (${assignee}${item.recording_timestamp ? ` @ ${item.recording_timestamp}` : ""})`;
    })
    .join("\n");
}

export function summaryToText(summary: MeetingSummary | null | undefined): string {
  const markdown = summary?.markdown_formatted?.trim();
  return markdown ? stripMarkdown(markdown) : "";
}

export function renderMeetingMarkdown(meeting: Meeting): string {
  const sections: string[] = [];
  sections.push(`# ${meeting.title}`);
  sections.push([
    `- Recording ID: ${meeting.recording_id}`,
    `- Meeting Title: ${meeting.meeting_title || ""}`,
    `- URL: ${meeting.url}`,
    `- Share URL: ${meeting.share_url}`,
    `- Created At: ${meeting.created_at}`,
    `- Scheduled: ${meeting.scheduled_start_time} -> ${meeting.scheduled_end_time}`,
    `- Recording: ${meeting.recording_start_time} -> ${meeting.recording_end_time}`,
    `- Recorded By: ${meeting.recorded_by.name} <${meeting.recorded_by.email}>`,
    `- Team: ${meeting.recorded_by.team || ""}`,
    `- Transcript Language: ${meeting.transcript_language}`,
  ].join("\n"));

  if (meeting.calendar_invitees.length) {
    sections.push("## Invitees");
    sections.push(
      meeting.calendar_invitees
        .map((invitee) => `- ${invitee.name || ""} <${invitee.email || ""}>${invitee.is_external ? " (external)" : ""}`)
        .join("\n"),
    );
  }

  if (meeting.default_summary?.markdown_formatted) {
    sections.push("## Summary");
    sections.push(meeting.default_summary.markdown_formatted.trim());
  }

  if (meeting.action_items?.length) {
    sections.push("## Action Items");
    sections.push(actionItemsToText(meeting.action_items));
  }

  if (meeting.transcript?.length) {
    sections.push("## Transcript");
    sections.push(transcriptToText(meeting.transcript));
  }

  return sections.filter(Boolean).join("\n\n").trim();
}

export function renderMeetingText(meeting: Meeting | SharedMeeting): string {
  const sections: string[] = [];
  sections.push(meeting.title);
  if ("share_call_id" in meeting) {
    sections.push([
      `Source: public share page`,
      `Official Recording ID: unavailable`,
      `Share Call ID: ${meeting.share_call_id}`,
      `Meeting Title: ${meeting.meeting_title || ""}`,
      `URL: ${meeting.url}`,
      `Share URL: ${meeting.share_url}`,
      `Access: ${meeting.share_access || ""}`,
      `Created At: ${meeting.created_at}`,
      `Scheduled: ${meeting.scheduled_start_time} -> ${meeting.scheduled_end_time}`,
      `Recording: ${meeting.recording_start_time} -> ${meeting.recording_end_time}`,
      `Recorded By: ${meeting.recorded_by.name} <${meeting.recorded_by.email}>`,
      `Team: ${meeting.recorded_by.team || ""}`,
    ].join("\n"));
  } else {
    sections.push([
      `Recording ID: ${meeting.recording_id}`,
      `Meeting Title: ${meeting.meeting_title || ""}`,
      `URL: ${meeting.url}`,
      `Share URL: ${meeting.share_url}`,
      `Created At: ${meeting.created_at}`,
      `Scheduled: ${meeting.scheduled_start_time} -> ${meeting.scheduled_end_time}`,
      `Recording: ${meeting.recording_start_time} -> ${meeting.recording_end_time}`,
      `Recorded By: ${meeting.recorded_by.name} <${meeting.recorded_by.email}>`,
      `Team: ${meeting.recorded_by.team || ""}`,
    ].join("\n"));
  }

  const summaryText = summaryToText(meeting.default_summary);
  if (summaryText) {
    sections.push("Summary");
    sections.push(summaryText);
  }

  const actionText = actionItemsToText(meeting.action_items);
  if (actionText) {
    sections.push("Action Items");
    sections.push(actionText);
  }

  const transcriptText = transcriptToText(meeting.transcript);
  if (transcriptText) {
    sections.push("Transcript");
    sections.push(transcriptText);
  }

  return sections.filter(Boolean).join("\n\n").trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function makeSnippet(haystack: string, needle: string): string {
  const lower = normalizeText(haystack);
  const index = lower.indexOf(normalizeText(needle));
  if (index === -1) return haystack.slice(0, 240);
  const start = Math.max(0, index - 80);
  const end = Math.min(haystack.length, index + needle.length + 160);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < haystack.length ? "..." : "";
  return `${prefix}${haystack.slice(start, end).trim()}${suffix}`;
}

export function buildMetadataSearchText(meeting: Meeting): string {
  const values = [
    meeting.title,
    meeting.meeting_title || "",
    String(meeting.recording_id),
    meeting.url,
    meeting.share_url,
    meeting.recorded_by.name,
    meeting.recorded_by.email,
    meeting.recorded_by.team || "",
    meeting.transcript_language,
    ...meeting.calendar_invitees.flatMap((invitee) => [
      invitee.name || "",
      invitee.email || "",
      invitee.email_domain || "",
      invitee.matched_speaker_display_name || "",
    ]),
  ];
  return values.filter(Boolean).join("\n");
}

export function metadataMatchesQuery(meeting: Meeting, query: string): boolean {
  return normalizeText(buildMetadataSearchText(meeting)).includes(normalizeText(query));
}

export function searchMeeting(meeting: Meeting, query: string): SearchMatch[] {
  const needle = normalizeText(query);
  const matches: SearchMatch[] = [];

  const metadata = buildMetadataSearchText(meeting);
  if (normalizeText(metadata).includes(needle)) {
    matches.push({
      source: "metadata",
      recording_id: meeting.recording_id,
      title: meeting.title,
      snippet: makeSnippet(metadata.replace(/\n+/g, " | "), query),
      url: meeting.url,
      share_url: meeting.share_url,
    });
  }

  const summaryText = meeting.default_summary?.markdown_formatted || "";
  if (normalizeText(summaryText).includes(needle)) {
    matches.push({
      source: "summary",
      recording_id: meeting.recording_id,
      title: meeting.title,
      snippet: makeSnippet(stripMarkdown(summaryText), query),
      url: meeting.url,
      share_url: meeting.share_url,
    });
  }

  for (const item of meeting.action_items || []) {
    if (!normalizeText(item.description).includes(needle)) continue;
    matches.push({
      source: "action_item",
      recording_id: meeting.recording_id,
      title: meeting.title,
      snippet: makeSnippet(item.description, query),
      timestamp: item.recording_timestamp,
      url: meeting.url,
      share_url: meeting.share_url,
    });
  }

  for (const item of meeting.transcript || []) {
    if (!normalizeText(item.text).includes(needle)) continue;
    matches.push({
      source: "transcript",
      recording_id: meeting.recording_id,
      title: meeting.title,
      snippet: makeSnippet(item.text, query),
      timestamp: item.timestamp,
      speaker: item.speaker?.display_name || undefined,
      url: meeting.url,
      share_url: meeting.share_url,
    });
  }

  return matches;
}
