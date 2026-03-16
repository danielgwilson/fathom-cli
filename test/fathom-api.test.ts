import test from "node:test";
import assert from "node:assert/strict";
import { collectCursorPages, isFathomShareUrl, parseSharedPagePayload, parseSharedTranscriptHtml } from "../src/fathom-api.js";

test("collectCursorPages respects maxItems across multiple pages", async () => {
  const pages = [
    { items: [1, 2, 3], next_cursor: "next-1", limit: 3 },
    { items: [4, 5, 6], next_cursor: null, limit: 3 },
  ];

  let index = 0;
  const result = await collectCursorPages({
    all: true,
    maxItems: 4,
    fetchPage: async () => {
      const page = pages[index++];
      if (!page) throw new Error("Missing test page");
      return page;
    },
  });

  assert.deepEqual(result.items, [1, 2, 3, 4]);
  assert.equal(result.pages, 2);
  assert.equal(result.scanned, 6);
  assert.equal(result.nextCursor, null);
});

test("isFathomShareUrl recognizes canonical share URLs", () => {
  assert.equal(isFathomShareUrl("https://fathom.video/share/example-share-token"), true);
  assert.equal(isFathomShareUrl("https://fathom.video/calls/123"), false);
  assert.equal(isFathomShareUrl("not-a-url"), false);
});

test("parseSharedPagePayload reads inertia data-page payload", () => {
  const html = `
    <div
      id="app"
      data-page="{&quot;component&quot;:&quot;page-call-detail&quot;,&quot;props&quot;:{&quot;access&quot;:&quot;external_view_only&quot;,&quot;duration&quot;:90,&quot;copyTranscriptUrl&quot;:&quot;https://fathom.video/calls/123/copy_transcript?token=abc&quot;,&quot;call&quot;:{&quot;id&quot;:123,&quot;title&quot;:&quot;Demo Call&quot;,&quot;topic&quot;:&quot;Demo Call&quot;,&quot;started_at&quot;:&quot;2026-03-16T02:56:00.000000Z&quot;,&quot;recording&quot;:{&quot;started_at&quot;:&quot;2026-03-16T02:57:11.000000Z&quot;},&quot;host&quot;:{&quot;email&quot;:&quot;alex@example.com&quot;,&quot;company&quot;:{&quot;domain&quot;:&quot;example.com&quot;}}}}}"
    ></div>
  `;
  const payload = parseSharedPagePayload(html);
  assert.equal(payload.props?.access, "external_view_only");
  assert.equal(payload.props?.call?.id, 123);
  assert.equal(payload.props?.copyTranscriptUrl, "https://fathom.video/calls/123/copy_transcript?token=abc");
});

test("parseSharedTranscriptHtml extracts timestamped speaker turns", () => {
  const items = parseSharedTranscriptHtml(`
    <h1>Demo Call</h1>
    <p><a href='https://fathom.video/calls/123?timestamp=1.16'>@0:01</a> - <b>Alex Example</b></p>
    <p style='margin-left:0px'>Hello &amp; welcome.</p>
    <br />
    <p><a href='https://fathom.video/calls/123?timestamp=6.52'>@0:06</a> - <b>Jordan Example</b></p>
    <p style='margin-left:0px'>Thanks for having me.</p>
  `);

  assert.deepEqual(items, [
    {
      speaker: { display_name: "Alex Example" },
      text: "Hello & welcome.",
      timestamp: "0:01",
    },
    {
      speaker: { display_name: "Jordan Example" },
      text: "Thanks for having me.",
      timestamp: "0:06",
    },
  ]);
});
