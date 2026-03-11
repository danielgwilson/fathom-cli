import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type FathomConfig = {
  apiKey?: string;
};

export const CONFIG_DIR = path.join(os.homedir(), ".config", "fathom");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function redactApiKey(apiKey: string): string {
  const value = apiKey.trim();
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function readConfig(): Promise<FathomConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as FathomConfig;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(CONFIG_DIR, 0o700);
}

export async function writeConfig(config: FathomConfig): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(CONFIG_PATH, 0o600);
}

export async function saveApiKey(apiKey: string): Promise<string> {
  const normalized = apiKey.trim();
  if (!normalized) throw new Error("API key is empty");
  await writeConfig({ apiKey: normalized });
  return normalized;
}

export async function clearConfig(): Promise<void> {
  try {
    await fs.unlink(CONFIG_PATH);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function resolveApiKey(): Promise<string | null> {
  const env = process.env.FATHOM_API_KEY?.trim();
  if (env) return env;
  const config = await readConfig();
  return config?.apiKey?.trim() || null;
}

