import test from "node:test";
import assert from "node:assert/strict";
import { metadataMatchesQuery, searchMeeting, stripMarkdown, transcriptToText } from "../src/format.js";
import type { Meeting } from "../src/fathom-api.js";

const sampleMeeting: Meeting = {
  title: "Customer Discovery Interview",
  meeting_title: "Customer Discovery Interview",
  recording_id: 123456789,
  url: "https://fathom.video/calls/123456789",
  share_url: "https://fathom.video/share/example-share-id",
  created_at: "2026-03-10T21:48:27Z",
  scheduled_start_time: "2026-03-10T21:30:00Z",
  scheduled_end_time: "2026-03-10T21:55:00Z",
  recording_start_time: "2026-03-10T21:29:05Z",
  recording_end_time: "2026-03-10T21:46:39Z",
  calendar_invitees_domains_type: "one_or_more_external",
  transcript_language: "en",
  transcript: [
    {
      speaker: {
        display_name: "Alex Example",
        matched_calendar_invitee_email: "alex@example.com",
      },
      text: "We can support a broader customer onboarding flow next quarter.",
      timestamp: "00:04:26",
    },
  ],
  default_summary: {
    template_name: "General",
    markdown_formatted: "## Summary\n\nCustomer requested a broader onboarding workflow with clearer renewal milestones.",
  },
  action_items: [
    {
      description: "Send follow-up proposal",
      user_generated: false,
      completed: false,
      recording_timestamp: "00:16:24",
      recording_playback_url: "https://fathom.video/share/example?timestamp=984",
      assignee: {
        name: "Taylor Example",
        email: "taylor@example.com",
        team: "Operations",
      },
    },
  ],
  calendar_invitees: [
    {
      name: "Alex Example",
      matched_speaker_display_name: "Alex Example",
      email: "alex@example.com",
      email_domain: "example.com",
      is_external: true,
    },
  ],
  recorded_by: {
    name: "Taylor Example",
    email: "taylor@example.com",
    email_domain: "example.com",
    team: "Operations",
  },
  crm_matches: null,
};

test("transcriptToText formats speaker turns", () => {
  assert.equal(transcriptToText(sampleMeeting.transcript), "[00:04:26] Alex Example: We can support a broader customer onboarding flow next quarter.");
});

test("metadataMatchesQuery searches recorder and title text", () => {
  assert.equal(metadataMatchesQuery(sampleMeeting, "operations"), true);
  assert.equal(metadataMatchesQuery(sampleMeeting, "customer discovery"), true);
  assert.equal(metadataMatchesQuery(sampleMeeting, "not-there"), false);
});

test("searchMeeting finds summary and transcript matches", () => {
  const matches = searchMeeting(sampleMeeting, "renewal");
  assert.equal(matches.some((match) => match.source === "summary"), true);
  const transcriptMatches = searchMeeting(sampleMeeting, "customer onboarding");
  assert.equal(transcriptMatches.some((match) => match.source === "transcript"), true);
});

test("stripMarkdown removes links and headings", () => {
  assert.equal(stripMarkdown("## Summary\n\n[Link](https://example.com)"), "Summary\n\nLink");
});
