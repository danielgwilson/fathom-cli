import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConfigError, clearConfig, getConfigPaths, readStoredConfig, redactApiKey, resolveApiKey, saveApiKey } from "../src/config.js";

async function withTempConfigHome(fn: (tempDir: string) => Promise<void>): Promise<void> {
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousApiKey = process.env.FATHOM_API_KEY;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fathom-config-test-"));
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

test("redactApiKey keeps only a small prefix and suffix", () => {
  assert.equal(redactApiKey("abcd1234wxyz9876"), "abcd…9876");
});

test("saveApiKey stores encrypted config and not plaintext", async () => {
  await withTempConfigHome(async () => {
    await saveApiKey("demo-secret-123456");
    const { encryptedConfigPath, encryptionKeyPath, legacyConfigPath } = getConfigPaths();
    const encryptedRaw = await fs.readFile(encryptedConfigPath, "utf8");
    const keyRaw = await fs.readFile(encryptionKeyPath, "utf8");

    assert.match(encryptedRaw, /"ciphertext":/);
    assert.doesNotMatch(encryptedRaw, /demo-secret-123456/);
    assert.ok(keyRaw.trim().length > 0);
    await assert.rejects(fs.access(legacyConfigPath));

    const state = await readStoredConfig();
    assert.equal(state.storage, "encrypted");
    assert.equal(state.config?.apiKey, "demo-secret-123456");
    assert.equal(await resolveApiKey(), "demo-secret-123456");
  });
});

test("FATHOM_API_KEY overrides saved encrypted auth", async () => {
  await withTempConfigHome(async () => {
    await saveApiKey("saved-secret-123456");
    process.env.FATHOM_API_KEY = "env-secret-654321";
    assert.equal(await resolveApiKey(), "env-secret-654321");
  });
});

test("clearConfig removes encrypted auth files and key material", async () => {
  await withTempConfigHome(async () => {
    await saveApiKey("demo-secret-123456");
    const { encryptedConfigPath, encryptionKeyPath } = getConfigPaths();
    await clearConfig();
    await assert.rejects(fs.access(encryptedConfigPath));
    await assert.rejects(fs.access(encryptionKeyPath));
    assert.equal(await resolveApiKey(), null);
  });
});

test("legacy plaintext config migrates automatically to encrypted storage", async () => {
  await withTempConfigHome(async () => {
    const { configDir, legacyConfigPath, encryptedConfigPath } = getConfigPaths();
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(legacyConfigPath, `${JSON.stringify({ apiKey: "legacy-secret-123456" }, null, 2)}\n`, "utf8");

    const state = await readStoredConfig();
    assert.equal(state.migratedFromLegacy, true);
    assert.equal(state.storage, "encrypted");
    assert.equal(state.config?.apiKey, "legacy-secret-123456");
    await assert.rejects(fs.access(legacyConfigPath));
    await fs.access(encryptedConfigPath);
  });
});

test("corrupted encrypted config raises a clean config error", async () => {
  await withTempConfigHome(async () => {
    const { configDir, encryptedConfigPath, encryptionKeyPath } = getConfigPaths();
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(encryptedConfigPath, `{"v":1,"iv":"bad","tag":"bad","ciphertext":"bad"}\n`, "utf8");
    await fs.writeFile(encryptionKeyPath, Buffer.alloc(32, 7).toString("base64"), "utf8");

    await assert.rejects(
      () => readStoredConfig(),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.code === "AUTH_INVALID" &&
        /Saved auth is unreadable|Saved auth payload is invalid|Saved auth file is invalid/.test(error.message),
    );
  });
});
