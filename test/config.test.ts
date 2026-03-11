import test from "node:test";
import assert from "node:assert/strict";
import { redactApiKey } from "../src/config.js";

test("redactApiKey keeps only a small prefix and suffix", () => {
  assert.equal(redactApiKey("abcd1234wxyz9876"), "abcd…9876");
});

