import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { getConfigPaths, saveApiKey } from "../src/config.js";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");
const fetchMockPath = path.join(repoRoot, "test", "helpers", "mock-fetch-auth-ok.mjs");

async function withTempConfigHome(fn: (tempDir: string) => Promise<void>): Promise<void> {
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousApiKey = process.env.FATHOM_API_KEY;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fathom-cli-auth-test-"));
  process.env.XDG_CONFIG_HOME = tempDir;
  delete process.env.FATHOM_API_KEY;
  try {
    await fn(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    if (previousApiKey === undefined) delete process.env.FATHOM_API_KEY;
    else process.env.FATHOM_API_KEY = previousApiKey;
  }
}

async function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return execFileAsync("node", ["--import", fetchMockPath, cliPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
  });
}

test("auth status reports env-based auth in JSON mode", async () => {
  await withTempConfigHome(async (tempDir) => {
    const { stdout } = await runCli(["auth", "status", "--json"], {
      XDG_CONFIG_HOME: tempDir,
      FATHOM_API_KEY: "env-secret-123456",
    });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.source, "env:FATHOM_API_KEY");
    assert.equal(parsed.data.storage, "env");
    assert.equal(parsed.data.apiKeyRedacted, "env-…3456");
    assert.equal(parsed.data.validation.ok, true);
  });
});

test("auth show reports redacted encrypted saved auth in JSON mode", async () => {
  await withTempConfigHome(async (tempDir) => {
    await saveApiKey("saved-secret-123456");
    const { stdout } = await runCli(["auth", "show", "--json"], {
      XDG_CONFIG_HOME: tempDir,
    });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.hasApiKey, true);
    assert.equal(parsed.data.source, "config:encrypted");
    assert.equal(parsed.data.storage, "encrypted");
    assert.equal(parsed.data.apiKeyRedacted, "save…3456");
  });
});

test("auth status reports encrypted saved auth in JSON mode", async () => {
  await withTempConfigHome(async (tempDir) => {
    await saveApiKey("saved-secret-123456");
    const { stdout } = await runCli(["auth", "status", "--json"], {
      XDG_CONFIG_HOME: tempDir,
    });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.source, "config:encrypted");
    assert.equal(parsed.data.storage, "encrypted");
    assert.equal(parsed.data.apiKeyRedacted, "save…3456");
    assert.equal(parsed.data.validation.ok, true);
  });
});

test("auth status migrates legacy plaintext config and reports encrypted storage", async () => {
  await withTempConfigHome(async (tempDir) => {
    const { configDir, legacyConfigPath, encryptedConfigPath } = getConfigPaths();
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(legacyConfigPath, `${JSON.stringify({ apiKey: "legacy-secret-123456" }, null, 2)}\n`, "utf8");

    const { stdout } = await runCli(["auth", "status", "--json"], {
      XDG_CONFIG_HOME: tempDir,
    });

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.source, "config:encrypted");
    assert.equal(parsed.data.storage, "encrypted");
    assert.equal(parsed.data.migratedFromLegacy, true);
    await assert.rejects(fs.access(legacyConfigPath));
    await fs.access(encryptedConfigPath);
  });
});
