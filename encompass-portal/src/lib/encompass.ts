const API_BASE = "https://api.elliemae.com";
const CLIENT_ID = "ybfs8jf";
const CLIENT_SECRET = "X4C6lbq$Rz^SmGF7IuDYKr^etSJDsIUlqye6DFwwpRDiKwnll!zHIpu0XI1451Fg";
const USERNAME = "snorkel.ai@encompass:BE11061674";
const PASSWORD = "38Xka#5$bAFFINjR05$%";
const SUBJECT_USER = "snorkel.ai";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  // Step 1: Get super admin token via password grant
  const tokenUrl = `${API_BASE}/oauth2/v1/token`;

  const params = new URLSearchParams({
    grant_type: "password",
    username: USERNAME,
    password: PASSWORD,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const superToken = data.access_token;
  const expiresIn = data.expires_in || 3600;

  cachedToken = {
    token: superToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return superToken;
}

function invalidateToken() {
  cachedToken = null;
}

async function apiGet(path: string, params?: Record<string, string>) {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken();
    const res = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401 && attempt === 0) {
      invalidateToken();
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text.slice(0, 500)}`);
    }
    return res.json();
  }
}

async function apiPost(path: string, body: unknown, params?: Record<string, string>) {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken();
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401 && attempt === 0) {
      invalidateToken();
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text.slice(0, 500)}`);
    }
    return res.json();
  }
}

// ── Pipeline Search ──

export interface PipelineFilter {
  canonicalName: string;
  value: string;
  matchType: string;
  include: boolean;
}

export const PIPELINE_FIELDS = [
  "Loan.LoanNumber",
  "Loan.BorrowerFirstName",
  "Loan.BorrowerLastName",
  "Loan.CoBorrowerFirstName",
  "Loan.CoBorrowerLastName",
  "Loan.LoanFolder",
  "Loan.LastModified",
  "Loan.LoanAmount",
  "Loan.LoanStatus",
  "Loan.DateCreated",
  "Loan.CurrentMilestoneName",
  "Loan.LoanOfficerName",
  "Loan.LoanProcessorName",
  "Loan.SubjectPropertyAddress",
  "Loan.SubjectPropertyCity",
  "Loan.SubjectPropertyState",
  "Loan.SubjectPropertyZip",
  "Loan.NoteRatePercent",
  "Loan.LoanProgram",
  "Loan.LoanPurpose",
  "Loan.LienPosition",
  "Loan.Channel",
  "Loan.LockStatus",
  "Loan.LockExpirationDate",
  "Loan.ClosingDate",
  // Field ID references (fallback for canonical names that return empty)
  "Fields.14",   // Property State
  "Fields.12",   // Property City
  "Fields.11",   // Property Address
  "Fields.3",    // Note Rate
  "Fields.748",  // Est. Closing Date
  "Fields.745",  // Application Date (if DateCreated differs)
];

export async function searchPipeline(
  start = 0,
  limit = 50,
  searchTerm?: string,
  folderFilter?: string,
) {
  const filters: PipelineFilter[] = [
    {
      canonicalName: "Loan.LoanFolder",
      value: "(Trash)",
      matchType: "exact",
      include: false,
    },
  ];

  if (folderFilter) {
    filters.push({
      canonicalName: "Loan.LoanFolder",
      value: folderFilter,
      matchType: "exact",
      include: true,
    });
  }

  const filter =
    filters.length === 1
      ? filters[0]
      : { operator: "and", terms: filters };

  const body: Record<string, unknown> = {
    fields: PIPELINE_FIELDS,
    filter,
    sortOrder: [{ canonicalName: "Loan.LastModified", order: "desc" }],
  };

  if (searchTerm) {
    body.filter = {
      operator: "and",
      terms: [
        filter,
        {
          operator: "or",
          terms: [
            { canonicalName: "Loan.LoanNumber", value: searchTerm, matchType: "contains", include: true },
            { canonicalName: "Loan.BorrowerLastName", value: searchTerm, matchType: "contains", include: true },
          ],
        },
      ],
    };
  }

  return apiPost(`/encompass/v1/loanPipeline`, body, {
    start: String(start),
    limit: String(limit),
  });
}

// ── Pipeline with raw filters (for AI search) ──

export async function searchPipelineWithFilters(
  filters: unknown,
  sortOrder?: unknown[],
  start = 0,
  limit = 200,
) {
  const trashFilter = {
    canonicalName: "Loan.LoanFolder",
    value: "(Trash)",
    matchType: "exact",
    include: false,
  };

  const combinedFilter = filters
    ? { operator: "and", terms: [trashFilter, filters] }
    : trashFilter;

  const body: Record<string, unknown> = {
    fields: PIPELINE_FIELDS,
    filter: combinedFilter,
    sortOrder: sortOrder || [{ canonicalName: "Loan.LastModified", order: "desc" }],
  };

  return apiPost(`/encompass/v1/loanPipeline`, body, {
    start: String(start),
    limit: String(limit),
  });
}

// ── Loan Detail ──

export async function getLoan(loanId: string) {
  return apiGet(`/encompass/v3/loans/${loanId}`);
}

// ── Field Reader ──

export async function readFields(loanId: string, fieldIds: string[]) {
  return apiPost(`/encompass/v1/loans/${loanId}/fieldReader`, fieldIds);
}

// ── Documents ──

export async function getDocuments(loanId: string) {
  return apiGet(`/encompass/v3/loans/${loanId}/documents`);
}

export async function getAttachments(loanId: string) {
  return apiGet(`/encompass/v3/loans/${loanId}/attachments`);
}

// V3 batch download URL endpoint — returns signed streaming URLs per page
export async function getAttachmentSignedUrls(
  loanId: string,
  attachmentIds: string[],
): Promise<{
  attachments: Array<{
    id: string;
    pages: Array<{ url: string; thumbnail: { url: string } }>;
    originalUrls?: unknown;
  }>;
}> {
  return apiPost(`/encompass/v3/loans/${loanId}/attachmentDownloadUrl`, {
    attachments: attachmentIds,
  });
}

// ── Loan Folders ──

export async function getLoanFolders() {
  return apiGet(`/encompass/v3/loanFolders`);
}

// ── Milestones ──

export async function getMilestones(loanId: string) {
  return apiGet(`/encompass/v1/loans/${loanId}/milestones`);
}

// ── Disclosure Tracking ──

export async function getDisclosureTracking(loanId: string) {
  return apiGet(`/encompass/v1/loans/${loanId}/disclosureTracking2015`);
}
