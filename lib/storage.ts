import type { ContactJobChange, SearchRequest, SearchResponse } from "@/lib/types";

type StoredWebhookEvent = {
  id: string;
  receivedAt: string;
  eventType?: string;
  entityType?: string;
  payload: unknown;
};

type StoredSearchRun = {
  id: string;
  createdAt: string;
  request: Omit<SearchRequest, "localLushaApiKey">;
  summary: SearchResponse["summary"];
  warnings: string[];
  results: ContactJobChange[];
};

declare global {
  var lushaWebhookEvents: StoredWebhookEvent[] | undefined;
  var searchRuns: StoredSearchRun[] | undefined;
}

function getWebhookStore() {
  if (!globalThis.lushaWebhookEvents) {
    globalThis.lushaWebhookEvents = [];
  }

  return globalThis.lushaWebhookEvents;
}

function getSearchRunStore() {
  if (!globalThis.searchRuns) {
    globalThis.searchRuns = [];
  }

  return globalThis.searchRuns;
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    return undefined;
  }

  return {
    url: url.replace(/\/+$/, ""),
    serviceRoleKey
  };
}

function omitApiKey(request: SearchRequest): Omit<SearchRequest, "localLushaApiKey"> {
  const safeRequest = { ...request };
  delete safeRequest.localLushaApiKey;
  return safeRequest;
}

export async function storeWebhookEvent(event: StoredWebhookEvent) {
  // Vercel serverless memory is ephemeral. For production persistence, replace this
  // with Supabase/PostgreSQL using DATABASE_URL and store only the minimum B2B
  // professional signal fields required for audit, deletion, and export workflows.
  getWebhookStore().unshift(event);
}

export async function listWebhookEvents() {
  return getWebhookStore();
}

export async function storeSearchRun(
  request: SearchRequest,
  response: Pick<SearchResponse, "summary" | "warnings" | "results">
): Promise<SearchResponse["storage"]> {
  const safeRequest = omitApiKey(request);
  const config = supabaseConfig();

  if (!config) {
    const run: StoredSearchRun = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      request: safeRequest,
      summary: response.summary,
      warnings: response.warnings,
      results: response.results
    };

    getSearchRunStore().unshift(run);

    return {
      status: "memory",
      id: run.id,
      message: "Search run stored in memory because Supabase is not configured."
    };
  }

  const payload = {
    company_domain: safeRequest.companyDomain || null,
    company_name: safeRequest.companyName || null,
    location: safeRequest.location || null,
    duration_days: safeRequest.durationDays,
    discipline: safeRequest.discipline,
    title_filter_mode: safeRequest.titleFilterMode,
    max_signal_lookups: safeRequest.maxSignalLookups,
    match_type: response.summary.matchType,
    mock_mode: response.summary.mockMode,
    total_contacts_found: response.summary.totalContactsFound,
    job_changes_found: response.summary.jobChangesFound,
    high_priority_contacts: response.summary.highPriorityContacts,
    credits_used: response.summary.creditsUsed ?? null,
    api_calls_used: response.summary.apiCallsUsed,
    signal_lookups_requested: response.summary.signalLookupsRequested,
    warnings: response.warnings,
    request: safeRequest,
    results: response.results
  };

  try {
    const saveResponse = await fetch(`${config.url}/rest/v1/search_runs`, {
      method: "POST",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    if (!saveResponse.ok) {
      return {
        status: "failed",
        message: "Supabase search-run save failed."
      };
    }

    const rows = (await saveResponse.json()) as Array<{ id?: string }>;

    return {
      status: "saved",
      id: rows[0]?.id,
      message: "Search run saved to Supabase."
    };
  } catch {
    return {
      status: "failed",
      message: "Supabase search-run save failed."
    };
  }
}
