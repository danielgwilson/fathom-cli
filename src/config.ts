import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type FathomConfig = {
  apiKey?: string;
};

type EncryptedConfigPayload = {
  v: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

export type ConfigPaths = {
  configDir: string;
  encryptedConfigPath: string;
  legacyConfigPath: string;
  encryptionKeyPath: string;
};

export type StoredConfigState = {
  config: FathomConfig | null;
  storage: "encrypted" | "none";
  migratedFromLegacy: boolean;
  paths: ConfigPaths;
};

export class ConfigError extends Error {
  readonly code = "AUTH_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function getConfigBaseDir(): string {
  return process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
}

export function getConfigPaths(): ConfigPaths {
  const configDir = path.join(getConfigBaseDir(), "fathom");
  return {
    configDir,
    encryptedConfigPath: path.join(configDir, "config.enc"),
    legacyConfigPath: path.join(configDir, "config.json"),
    encryptionKeyPath: path.join(configDir, ".encryption_key"),
  };
}

export function redactApiKey(apiKey: string): string {
  const value = apiKey.trim();
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function ensureConfigDir(): Promise<void> {
  const { configDir } = getConfigPaths();
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.chmod(configDir, 0o700);
}

function normalizeConfig(config: unknown): FathomConfig | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const parsed = config as FathomConfig;
  if (parsed.apiKey && typeof parsed.apiKey !== "string") return null;
  return parsed;
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function readEncryptionKey(): Promise<Buffer | null> {
  const { encryptionKeyPath } = getConfigPaths();
  try {
    const raw = (await fs.readFile(encryptionKeyPath, "utf8")).trim();
    if (!raw) throw new ConfigError("Saved auth key file is empty. Run `fathom auth clear` and `fathom auth set` again.");
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new ConfigError("Saved auth key file is invalid. Run `fathom auth clear` and `fathom auth set` again.");
    }
    return key;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("Saved auth key file is unreadable. Run `fathom auth clear` and `fathom auth set` again.");
  }
}

async function getOrCreateEncryptionKey(): Promise<Buffer> {
  const { encryptionKeyPath } = getConfigPaths();
  const existing = await readEncryptionKey();
  if (existing) return existing;

  await ensureConfigDir();
  const key = randomBytes(32);
  await fs.writeFile(encryptionKeyPath, `${key.toString("base64")}\n`, { mode: 0o600 });
  await fs.chmod(encryptionKeyPath, 0o600);
  return key;
}

function encryptConfig(config: FathomConfig, key: Buffer): EncryptedConfigPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(config), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptConfig(payload: EncryptedConfigPayload, key: Buffer): FathomConfig {
  if (payload.v !== 1 || !payload.iv || !payload.tag || !payload.ciphertext) {
    throw new ConfigError("Saved auth file is invalid. Run `fathom auth clear` and `fathom auth set` again.");
  }
  try {
    const iv = Buffer.from(payload.iv, "base64");
    const tag = Buffer.from(payload.tag, "base64");
    const ciphertext = Buffer.from(payload.ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = normalizeConfig(JSON.parse(plaintext));
    if (!parsed) {
      throw new ConfigError("Saved auth payload is invalid. Run `fathom auth clear` and `fathom auth set` again.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("Saved auth is unreadable. Run `fathom auth clear` and `fathom auth set` again.");
  }
}

async function readEncryptedConfig(): Promise<FathomConfig | null> {
  const { encryptedConfigPath } = getConfigPaths();
  let payload: EncryptedConfigPayload | null = null;
  try {
    const raw = await fs.readFile(encryptedConfigPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigError("Saved auth file is invalid. Run `fathom auth clear` and `fathom auth set` again.");
    }
    payload = parsed as EncryptedConfigPayload;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("Saved auth file is unreadable. Run `fathom auth clear` and `fathom auth set` again.");
  }
  const key = await readEncryptionKey();
  if (!key) {
    throw new ConfigError("Saved auth key is missing. Run `fathom auth clear` and `fathom auth set` again.");
  }
  return decryptConfig(payload, key);
}

async function writeEncryptedConfig(config: FathomConfig): Promise<void> {
  const { encryptedConfigPath, legacyConfigPath } = getConfigPaths();
  await ensureConfigDir();
  const key = await getOrCreateEncryptionKey();
  const payload = encryptConfig(config, key);
  await fs.writeFile(encryptedConfigPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(encryptedConfigPath, 0o600);
  await removeIfPresent(legacyConfigPath);
}

async function readLegacyConfig(): Promise<FathomConfig | null> {
  const { legacyConfigPath } = getConfigPaths();
  const parsed = await readJsonFile<FathomConfig>(legacyConfigPath);
  return normalizeConfig(parsed);
}

export async function readStoredConfig(): Promise<StoredConfigState> {
  const paths = getConfigPaths();
  const encryptedConfig = await readEncryptedConfig();
  if (encryptedConfig) {
    await removeIfPresent(paths.legacyConfigPath);
    return {
      config: encryptedConfig,
      storage: "encrypted",
      migratedFromLegacy: false,
      paths,
    };
  }

  const legacyConfig = await readLegacyConfig();
  if (legacyConfig?.apiKey?.trim()) {
    await writeEncryptedConfig({ apiKey: legacyConfig.apiKey.trim() });
    await removeIfPresent(paths.legacyConfigPath);
    return {
      config: { apiKey: legacyConfig.apiKey.trim() },
      storage: "encrypted",
      migratedFromLegacy: true,
      paths,
    };
  }

  return {
    config: null,
    storage: "none",
    migratedFromLegacy: false,
    paths,
  };
}

export async function readConfig(): Promise<FathomConfig | null> {
  return (await readStoredConfig()).config;
}

export async function saveApiKey(apiKey: string): Promise<string> {
  const normalized = apiKey.trim();
  if (!normalized) throw new Error("API key is empty");
  await writeEncryptedConfig({ apiKey: normalized });
  return normalized;
}

export async function clearConfig(): Promise<void> {
  const { encryptedConfigPath, legacyConfigPath, encryptionKeyPath } = getConfigPaths();
  await removeIfPresent(encryptedConfigPath);
  await removeIfPresent(legacyConfigPath);
  await removeIfPresent(encryptionKeyPath);
}

export async function resolveApiKey(): Promise<string | null> {
  const env = process.env.FATHOM_API_KEY?.trim();
  if (env) return env;
  const state = await readStoredConfig();
  return state.config?.apiKey?.trim() || null;
}
