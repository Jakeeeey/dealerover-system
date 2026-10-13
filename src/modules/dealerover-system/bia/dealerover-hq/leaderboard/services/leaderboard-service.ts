import type {
  DealerLeaderboardEntry,
  DealerListItem,
  DealerSalesInvoiceItem,
  DealerSalesmanItem,
  DealerStatusCheckpoint,
  LeaderboardResponse,
  SalesmanRankingEntry,
} from "../types";

/**
 * Leaderboard service — server-only, plain TypeScript (no React, no next/headers).
 *
 * Ported verbatim from the DHQ salesman-rankings API route, extended with a
 * per-dealer aggregation (`dealerRankings`).
 *
 * Data flow: this app's main Directus holds `dealer_list`; each dealer row's
 * `directus` / `directus_token` points at that dealer's own Directus, which
 * holds `salesman` and `sales_invoice`. Every dealer is queried concurrently
 * with a hard timeout so a single slow/offline dealer cannot stall the page.
 */

const MAIN_DIRECTUS_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") || "";
const MAIN_DIRECTUS_TOKEN = process.env.DIRECTUS_STATIC_TOKEN || "";

/** Per-dealer upstream timeout. Keeps one dead dealer from stalling the whole board. */
const DEALER_TIMEOUT_MS = 3500;

interface DealerResult {
  dealer_id: number;
  dealer_name: string;
  dealer_code: string;
  is_online: boolean;
  is_default: boolean;
  error_message?: string;
  entries: Omit<SalesmanRankingEntry, "rank">[];
}

type PresumRankedSalesman = Omit<SalesmanRankingEntry, "rank">;

function mainHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${MAIN_DIRECTUS_TOKEN}`,
  };
}

/**
 * Reads the dealer roster from the main Directus instance.
 * @returns {Promise<DealerListItem[]>} Every `dealer_list` row (unsanitized).
 * @throws {Error} When the main Directus request fails.
 */
async function fetchDealerList(): Promise<DealerListItem[]> {
  const res = await fetch(
    `${MAIN_DIRECTUS_BASE}/items/dealer_list?limit=-1&fields=dealer_id,dealer_name,dealer_code,directus,directus_token,status,is_default`,
    {
      method: "GET",
      headers: mainHeaders(),
      // Roster changes rarely; a short cache avoids re-querying on every filter tweak.
      next: { revalidate: 60 },
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to fetch dealer_list (${res.status}): ${body}`);
  }

  const json = await res.json();
  return (json.data || []) as DealerListItem[];
}

/**
 * Fetches a URL with an isolated AbortController so a hanging dealer is cut off.
 * @param {string} url - Absolute URL on a dealer's own Directus.
 * @param {string} token - That dealer's Directus token.
 * @returns {Promise<Response>} The raw response (caller inspects `.ok`).
 */
async function safeDealerFetch(url: string, token: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEALER_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Aggregates one dealer's salesmen + invoices into per-salesman totals.
 *
 * Literal timestamps (`YYYY-MM-DDTHH:mm:ss`, no offset) are used so the filter
 * matches the raw stored date strings exactly.
 *
 * @param {DealerListItem} dealer - A validated roster row with credentials.
 * @param {string} from - Inclusive start date (`YYYY-MM-DD`).
 * @param {string} to - Inclusive end date (`YYYY-MM-DD`).
 * @returns {Promise<DealerResult>} Entries plus an online/offline checkpoint.
 */
async function fetchDealerResult(
  dealer: DealerListItem,
  from: string,
  to: string,
): Promise<DealerResult> {
  const dealerBase = dealer.directus?.replace(/\/+$/, "");
  const dealerToken = dealer.directus_token;
  const dealerName = dealer.dealer_name || dealer.dealer_code;
  const dealerCode = dealer.dealer_code;
  const isDefault = Number(dealer.is_default) === 1 || dealer.is_default === true;

  if (!dealerBase || !dealerToken) {
    return {
      dealer_id: dealer.dealer_id,
      dealer_name: dealerName,
      dealer_code: dealerCode,
      is_online: false,
      is_default: isDefault,
      error_message: "Missing directus credentials",
      entries: [],
    };
  }

  try {
    const filterFromIso = `${from}T00:00:00`;
    const filterToIso = `${to}T23:59:59`;

    const salesmanPromise = safeDealerFetch(
      `${dealerBase}/items/salesman?limit=-1&fields=id,salesman_code,salesman_name`,
      dealerToken,
    );

    const invoiceFilter = JSON.stringify({
      _and: [
        { invoice_date: { _gte: filterFromIso } },
        { invoice_date: { _lte: filterToIso } },
        { transaction_status: { _neq: "Cancelled" } },
      ],
    });
    const invoicePromise = safeDealerFetch(
      `${dealerBase}/items/sales_invoice?limit=-1&fields=invoice_id,net_amount,salesman_id,invoice_date,transaction_status&filter=${encodeURIComponent(invoiceFilter)}`,
      dealerToken,
    );

    const [salesmanResResult, invoiceResResult] = await Promise.allSettled([
      salesmanPromise,
      invoicePromise,
    ]);

    if (salesmanResResult.status !== "fulfilled" || invoiceResResult.status !== "fulfilled") {
      const failureReason =
        salesmanResResult.status !== "fulfilled"
          ? salesmanResResult.reason?.message || "Salesman endpoint unreachable"
          : invoiceResResult.status !== "fulfilled"
            ? invoiceResResult.reason?.message || "Invoice endpoint unreachable"
            : "Unreachable";
      return {
        dealer_id: dealer.dealer_id,
        dealer_name: dealerName,
        dealer_code: dealerCode,
        is_online: false,
        is_default: isDefault,
        error_message: failureReason,
        entries: [],
      };
    }

    const salesmanRes = salesmanResResult.value;
    const invoiceRes = invoiceResResult.value;

    if (!salesmanRes.ok || !invoiceRes.ok) {
      return {
        dealer_id: dealer.dealer_id,
        dealer_name: dealerName,
        dealer_code: dealerCode,
        is_online: false,
        is_default: isDefault,
        error_message: `HTTP Error ${salesmanRes.status || invoiceRes.status}`,
        entries: [],
      };
    }

    const salesmanJson = await salesmanRes.json().catch(() => ({ data: [] }));
    const invoiceJson = await invoiceRes.json().catch(() => ({ data: [] }));

    const salesmen: DealerSalesmanItem[] = salesmanJson.data || [];
    const invoices: DealerSalesInvoiceItem[] = invoiceJson.data || [];

    const statsBySalesman = new Map<number, { totalAmount: number; invoiceCount: number }>();
    invoices.forEach((inv) => {
      if (inv.salesman_id) {
        const current = statsBySalesman.get(inv.salesman_id) || {
          totalAmount: 0,
          invoiceCount: 0,
        };
        current.totalAmount += Number(inv.net_amount || 0);
        current.invoiceCount += 1;
        statsBySalesman.set(inv.salesman_id, current);
      }
    });

    const entries: PresumRankedSalesman[] = salesmen.map((sm) => {
      const stats = statsBySalesman.get(sm.id) || { totalAmount: 0, invoiceCount: 0 };
      return {
        salesman_id: sm.id,
        salesman_code: sm.salesman_code || "N/A",
        salesman_name: sm.salesman_name || "Unknown Salesman",
        dealer_id: dealer.dealer_id,
        dealer_name: dealerName,
        dealer_code: dealerCode,
        total_net_amount: stats.totalAmount,
        total_invoices: stats.invoiceCount,
      };
    });

    return {
      dealer_id: dealer.dealer_id,
      dealer_name: dealerName,
      dealer_code: dealerCode,
      is_online: true,
      is_default: isDefault,
      entries,
    };
  } catch (dealerErr: unknown) {
    const errMsg = dealerErr instanceof Error ? dealerErr.message : "Connection timeout";
    return {
      dealer_id: dealer.dealer_id,
      dealer_name: dealerName,
      dealer_code: dealerCode,
      is_online: false,
      is_default: isDefault,
      error_message: errMsg,
      entries: [],
    };
  }
}

/**
 * Assigns standard-competition ranks (1, 2, 2, 4 …) by descending total.
 * @param {T[]} rows - Rows already sorted by `total_net_amount` desc.
 * @returns {Array<T & { rank: number }>} The same rows with a `rank` field.
 */
function assignCompetitionRanks<T extends { total_net_amount: number }>(
  rows: T[],
): (T & { rank: number })[] {
  let currentRank = 1;
  return rows.map((entry, index) => {
    if (index > 0 && entry.total_net_amount < rows[index - 1].total_net_amount) {
      currentRank = index + 1;
    }
    return { ...entry, rank: currentRank };
  });
}

function emptyResponse(from: string, to: string, error?: string): LeaderboardResponse {
  return {
    success: false,
    from,
    to,
    totalDealersCount: 0,
    onlineDealersCount: 0,
    totalSalesmenCount: 0,
    totalRevenue: 0,
    dealerStatuses: [],
    dealerRankings: [],
    rankings: [],
    error,
  };
}

/**
 * Builds the complete leaderboard for a date range across every configured dealer.
 *
 * @param {string} from - Inclusive start date (`YYYY-MM-DD`).
 * @param {string} to - Inclusive end date (`YYYY-MM-DD`).
 * @returns {Promise<LeaderboardResponse>} Ranked salesmen + ranked dealers.
 */
export async function fetchLeaderboard(from: string, to: string): Promise<LeaderboardResponse> {
  try {
    const allDealers = await fetchDealerList();

    // Dedupe by dealer_code + directus host: the same physical dealer must not be
    // queried twice or its sales would be double-counted.
    const seenDealers = new Set<string>();
    const validDealers: DealerListItem[] = [];
    for (const d of allDealers) {
      if (!d.directus || !d.directus_token) continue;
      const uniqueKey = `${d.dealer_code || ""}-${d.directus.trim().toLowerCase()}`;
      if (!seenDealers.has(uniqueKey)) {
        seenDealers.add(uniqueKey);
        validDealers.push(d);
      }
    }

    const results = await Promise.allSettled(
      validDealers.map((dealer) => fetchDealerResult(dealer, from, to)),
    );

    const allEntries: PresumRankedSalesman[] = [];
    const dealerStatuses: DealerStatusCheckpoint[] = [];

    results.forEach((res, index) => {
      if (res.status === "fulfilled") {
        const item = res.value;
        dealerStatuses.push({
          dealer_id: item.dealer_id,
          dealer_name: item.dealer_name,
          dealer_code: item.dealer_code,
          is_online: item.is_online,
          is_default: item.is_default,
          error_message: item.error_message,
        });
        if (item.entries) {
          allEntries.push(...item.entries);
        }
      } else {
        const fallbackDealer = validDealers[index];
        const isDefault =
          Number(fallbackDealer?.is_default) === 1 || fallbackDealer?.is_default === true;
        dealerStatuses.push({
          dealer_id: fallbackDealer?.dealer_id || index,
          dealer_name: fallbackDealer?.dealer_name || fallbackDealer?.dealer_code || "Unknown",
          dealer_code: fallbackDealer?.dealer_code || "N/A",
          is_online: false,
          is_default: isDefault,
          error_message: "Request failed",
        });
      }
    });

    // Rank salesmen by total net amount, descending.
    allEntries.sort((a, b) => b.total_net_amount - a.total_net_amount);
    const rankedEntries = assignCompetitionRanks(allEntries) as SalesmanRankingEntry[];

    // Per-dealer aggregate: sum of that dealer's salesman totals. Offline dealers
    // are kept (they still appear on the board) but contribute zero.
    const dealerMap = new Map<number, DealerLeaderboardEntry>();
    dealerStatuses.forEach((ds) => {
      dealerMap.set(ds.dealer_id, {
        rank: 0,
        dealer_id: ds.dealer_id,
        dealer_name: ds.dealer_name,
        dealer_code: ds.dealer_code,
        total_net_amount: 0,
        total_invoices: 0,
        salesman_count: 0,
        is_online: ds.is_online,
      });
    });
    rankedEntries.forEach((entry) => {
      const dealer = dealerMap.get(entry.dealer_id);
      if (!dealer) return;
      dealer.total_net_amount += entry.total_net_amount;
      dealer.total_invoices += entry.total_invoices;
      dealer.salesman_count += 1;
    });

    const dealerRows = Array.from(dealerMap.values()).sort(
      (a, b) => b.total_net_amount - a.total_net_amount,
    );
    const dealerRankings = assignCompetitionRanks(dealerRows) as DealerLeaderboardEntry[];

    const totalRevenue = rankedEntries.reduce((acc, curr) => acc + curr.total_net_amount, 0);
    const onlineDealersCount = dealerStatuses.filter((d) => d.is_online).length;

    return {
      success: true,
      from,
      to,
      totalDealersCount: validDealers.length,
      onlineDealersCount,
      totalSalesmenCount: rankedEntries.length,
      totalRevenue,
      dealerStatuses,
      dealerRankings,
      rankings: rankedEntries,
    };
  } catch (error: unknown) {
    console.error("[Leaderboard Service] Unexpected error:", error);
    return emptyResponse(from, to, error instanceof Error ? error.message : String(error));
  }
}
