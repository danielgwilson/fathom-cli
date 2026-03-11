import { saveApiKey } from "./config.js";
import { FathomApiClient } from "./fathom-api.js";

export type AuthValidation = {
  ok: boolean;
  reason?: string;
  sample?: {
    teamCount: number;
    nextCursor: string | null;
  };
};

export async function validateApiKey(apiKey: string): Promise<AuthValidation> {
  const client = new FathomApiClient({ apiKey });
  try {
    const teams = await client.listTeams({ pageSize: 1 });
    return {
      ok: true,
      sample: {
        teamCount: teams.items.length,
        nextCursor: teams.next_cursor,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      reason: error?.message || "Validation failed",
    };
  }
}

export async function saveAndValidateApiKey(apiKey: string): Promise<{ apiKey: string; validation: AuthValidation }> {
  const saved = await saveApiKey(apiKey);
  const validation = await validateApiKey(saved);
  return { apiKey: saved, validation };
}
