import test from "node:test";
import assert from "node:assert/strict";
import { collectCursorPages } from "../src/fathom-api.js";

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
