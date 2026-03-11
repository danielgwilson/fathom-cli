export type CalendarInviteesDomainsType = "all" | "only_internal" | "one_or_more_external";
export type MeetingDomainsType = Exclude<CalendarInviteesDomainsType, "all">;
export type TriggeredFor =
  | "my_recordings"
  | "shared_external_recordings"
  | "my_shared_with_team_recordings"
  | "shared_team_recordings";

export type TranscriptItemSpeaker = {
  display_name: string;
  matched_calendar_invitee_email?: string | null;
};

export type TranscriptItem = {
  speaker: TranscriptItemSpeaker;
  text: string;
  timestamp: string;
};

export type MeetingSummary = {
  template_name: string | null;
  markdown_formatted: string | null;
};

export type Assignee = {
  name: string | null;
  email: string | null;
  team: string | null;
};

export type ActionItem = {
  description: string;
  user_generated: boolean;
  completed: boolean;
  recording_timestamp: string;
  recording_playback_url: string;
  assignee: Assignee;
};

export type Invitee = {
  name: string | null;
  matched_speaker_display_name?: string | null;
  email: string | null;
  email_domain: string | null;
  is_external: boolean;
};

export type FathomUser = {
  name: string;
  email: string;
  email_domain: string;
  team: string | null;
};

export type CRMContactMatch = {
  name: string;
  email: string;
  record_url: string;
};

export type CRMCompanyMatch = {
  name: string;
  record_url: string;
};

export type CRMDealMatch = {
  name: string;
  amount: number;
  record_url: string;
};

export type CRMMatches = {
  contacts?: CRMContactMatch[];
  companies?: CRMCompanyMatch[];
  deals?: CRMDealMatch[];
  error?: string | null;
} | null;

export type Meeting = {
  title: string;
  meeting_title: string | null;
  recording_id: number;
  url: string;
  share_url: string;
  created_at: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  recording_start_time: string;
  recording_end_time: string;
  calendar_invitees_domains_type: MeetingDomainsType;
  transcript_language: string;
  transcript?: TranscriptItem[] | null;
  default_summary?: MeetingSummary | null;
  action_items?: ActionItem[] | null;
  calendar_invitees: Invitee[];
  recorded_by: FathomUser;
  crm_matches?: CRMMatches;
};

export type Team = {
  name: string;
  created_at: string;
};

export type TeamMember = {
  name: string;
  email: string;
  created_at: string;
};

export type Webhook = {
  id: string;
  url: string;
  secret: string;
  created_at: string;
  include_transcript: boolean;
  include_crm_matches: boolean;
  include_summary: boolean;
  include_action_items: boolean;
  triggered_for: TriggeredFor[];
};

export type CallbackResponse = {
  destination_url: string;
};

export type CursorListResponse<T> = {
  items: T[];
  next_cursor: string | null;
  limit: number | null;
  items_active_record?: unknown[] | null;
};

export type MeetingsListOptions = {
  calendarInviteesDomains?: string[];
  calendarInviteesDomainsType?: CalendarInviteesDomainsType;
  createdAfter?: string;
  createdBefore?: string;
  cursor?: string;
  includeActionItems?: boolean;
  includeCrmMatches?: boolean;
  includeSummary?: boolean;
  includeTranscript?: boolean;
  pageSize?: number;
  recordedBy?: string[];
  teams?: string[];
};

export type TeamMembersListOptions = {
  cursor?: string;
  pageSize?: number;
  team?: string;
};

export type TeamsListOptions = {
  cursor?: string;
  pageSize?: number;
};

export type CreateWebhookInput = {
  destination_url: string;
  include_action_items?: boolean;
  include_crm_matches?: boolean;
  include_summary?: boolean;
  include_transcript?: boolean;
  triggered_for: TriggeredFor[];
};

export type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  query?: URLSearchParams;
  body?: unknown;
  expectedStatuses?: number[];
};

export class FathomApiError extends Error {
  status?: number;
  data?: unknown;

  constructor(message: string, options: { status?: number; data?: unknown } = {}) {
    super(message);
    this.name = "FathomApiError";
    this.status = options.status;
    this.data = options.data;
  }
}

export type FathomApiClientOptions = {
  apiKey: string;
  baseUrl?: string;
  userAgent?: string;
  maxRetries?: number;
};

export type CollectPagesOptions<TPage extends { items: TItem[]; next_cursor: string | null }, TItem> = {
  all?: boolean;
  initialCursor?: string;
  maxItems?: number;
  pageSize?: number;
  fetchPage: (cursor: string | undefined, pageSize: number | undefined) => Promise<TPage>;
  onPage?: (page: { pages: number; collected: number; nextCursor: string | null }) => void;
};

export type CollectedPages<TItem> = {
  items: TItem[];
  nextCursor: string | null;
  pages: number;
  scanned: number;
};

function appendMany(search: URLSearchParams, name: string, values?: string[]): void {
  for (const value of values || []) {
    const normalized = value.trim();
    if (normalized) search.append(name, normalized);
  }
}

function parseResponseBody(contentType: string | null, text: string): unknown {
  if (!text) return null;
  if (contentType?.includes("application/json")) return JSON.parse(text) as unknown;
  return text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FathomApiClient {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly userAgent: string;
  readonly maxRetries: number;

  constructor(options: FathomApiClientOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl || "https://api.fathom.ai/external/v1";
    this.userAgent = options.userAgent || "fathom-video-cli/0.1.0";
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
  }

  async request<T>(pathname: string, options: RequestOptions = {}): Promise<T> {
    const queryText = options.query?.toString();
    const url = queryText ? `${this.baseUrl}${pathname}?${queryText}` : `${this.baseUrl}${pathname}`;
    const expectedStatuses = options.expectedStatuses || [200];

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": options.body ? "application/json" : "application/json",
          "User-Agent": this.userAgent,
          "X-Api-Key": this.apiKey,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const contentType = response.headers.get("content-type");
      const text = await response.text();
      const data = parseResponseBody(contentType, text);

      if (expectedStatuses.includes(response.status)) {
        return data as T;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }

      throw new FathomApiError(
        typeof data === "string" && data ? data : `Fathom API request failed with status ${response.status}`,
        { status: response.status, data },
      );
    }

    throw new FathomApiError("Fathom API request failed");
  }

  async listMeetings(options: MeetingsListOptions = {}): Promise<CursorListResponse<Meeting>> {
    const query = new URLSearchParams();
    appendMany(query, "calendar_invitees_domains[]", options.calendarInviteesDomains);
    if (options.calendarInviteesDomainsType) query.set("calendar_invitees_domains_type", options.calendarInviteesDomainsType);
    if (options.createdAfter) query.set("created_after", options.createdAfter);
    if (options.createdBefore) query.set("created_before", options.createdBefore);
    if (options.cursor) query.set("cursor", options.cursor);
    if (typeof options.includeActionItems === "boolean") query.set("include_action_items", String(options.includeActionItems));
    if (typeof options.includeCrmMatches === "boolean") query.set("include_crm_matches", String(options.includeCrmMatches));
    if (typeof options.includeSummary === "boolean") query.set("include_summary", String(options.includeSummary));
    if (typeof options.includeTranscript === "boolean") query.set("include_transcript", String(options.includeTranscript));
    if (typeof options.pageSize === "number" && Number.isFinite(options.pageSize)) query.set("limit", String(options.pageSize));
    appendMany(query, "recorded_by[]", options.recordedBy);
    appendMany(query, "teams[]", options.teams);
    return this.request<CursorListResponse<Meeting>>("/meetings", { query });
  }

  async listTeams(options: TeamsListOptions = {}): Promise<CursorListResponse<Team>> {
    const query = new URLSearchParams();
    if (options.cursor) query.set("cursor", options.cursor);
    if (typeof options.pageSize === "number" && Number.isFinite(options.pageSize)) query.set("limit", String(options.pageSize));
    return this.request<CursorListResponse<Team>>("/teams", { query });
  }

  async listTeamMembers(options: TeamMembersListOptions = {}): Promise<CursorListResponse<TeamMember>> {
    const query = new URLSearchParams();
    if (options.cursor) query.set("cursor", options.cursor);
    if (typeof options.pageSize === "number" && Number.isFinite(options.pageSize)) query.set("limit", String(options.pageSize));
    if (options.team) query.set("team", options.team);
    return this.request<CursorListResponse<TeamMember>>("/team_members", { query });
  }

  async getRecordingTranscript(recordingId: number, destinationUrl?: string): Promise<{ transcript: TranscriptItem[] } | CallbackResponse> {
    const query = new URLSearchParams();
    if (destinationUrl) query.set("destination_url", destinationUrl);
    return this.request<{ transcript: TranscriptItem[] } | CallbackResponse>(`/recordings/${recordingId}/transcript`, { query });
  }

  async getRecordingSummary(recordingId: number, destinationUrl?: string): Promise<{ summary: MeetingSummary } | CallbackResponse> {
    const query = new URLSearchParams();
    if (destinationUrl) query.set("destination_url", destinationUrl);
    return this.request<{ summary: MeetingSummary } | CallbackResponse>(`/recordings/${recordingId}/summary`, { query });
  }

  async createWebhook(input: CreateWebhookInput): Promise<Webhook> {
    return this.request<Webhook>("/webhooks", { method: "POST", body: input, expectedStatuses: [201] });
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.request<null>(`/webhooks/${encodeURIComponent(id)}`, { method: "DELETE", expectedStatuses: [204] });
  }
}

export async function collectCursorPages<TPage extends { items: TItem[]; next_cursor: string | null }, TItem>(
  options: CollectPagesOptions<TPage, TItem>,
): Promise<CollectedPages<TItem>> {
  const all = !!options.all;
  const target = options.maxItems && options.maxItems > 0 ? options.maxItems : undefined;
  let cursor = options.initialCursor;
  let pages = 0;
  let nextCursor: string | null = null;
  let scanned = 0;
  const items: TItem[] = [];

  while (true) {
    const remaining = target ? Math.max(target - items.length, 0) : undefined;
    if (remaining === 0) break;
    const pageSize = remaining ? Math.min(options.pageSize || remaining, remaining) : options.pageSize;
    const page = await options.fetchPage(cursor, pageSize);
    pages += 1;
    nextCursor = page.next_cursor;
    scanned += page.items.length;
    for (const item of page.items) {
      if (target && items.length >= target) break;
      items.push(item);
    }
    options.onPage?.({ pages, collected: items.length, nextCursor });
    if (!all || !nextCursor || (target && items.length >= target)) break;
    cursor = nextCursor;
  }

  return { items, nextCursor, pages, scanned };
}

