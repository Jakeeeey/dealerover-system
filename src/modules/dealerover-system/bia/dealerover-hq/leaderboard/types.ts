/**
 * DealerOver HQ — Leaderboard types.
 *
 * Ported from the DHQ salesman-rankings modal types, extended with a per-dealer
 * leaderboard aggregate (`DealerLeaderboardEntry`) so the Dealers tab can rank
 * the dealers themselves, not just their salesmen.
 *
 * NOTE: snake_case is intentional here — these interfaces mirror the raw
 * Directus `dealer_list` / `salesman` / `sales_invoice` row shapes.
 */

/** A row of the main Directus `dealer_list` collection. */
export interface DealerListItem {
  dealer_id: number;
  dealer_name: string | null;
  dealer_code: string;
  directus: string | null;
  directus_token: string | null;
  status?: string | null;
  is_default?: number | boolean;
}

/** A row of a dealer's own Directus `salesman` collection. */
export interface DealerSalesmanItem {
  id: number;
  salesman_code: string;
  salesman_name: string;
}

/** A row of a dealer's own Directus `sales_invoice` collection. */
export interface DealerSalesInvoiceItem {
  invoice_id: number;
  net_amount: number | null;
  salesman_id: number | null;
  invoice_date: string | null;
}

/** A ranked salesman across every reachable dealer. */
export interface SalesmanRankingEntry {
  rank: number;
  salesman_id: number;
  salesman_code: string;
  salesman_name: string;
  dealer_id: number;
  dealer_name: string;
  dealer_code: string;
  total_net_amount: number;
  total_invoices: number;
}

/** Connectivity check result for one dealer's own Directus instance. */
export interface DealerStatusCheckpoint {
  dealer_id: number;
  dealer_name: string;
  dealer_code: string;
  is_online: boolean;
  is_default?: boolean;
  error_message?: string;
}

/** A ranked dealer aggregate (totals across that dealer's salesmen). */
export interface DealerLeaderboardEntry {
  rank: number;
  dealer_id: number;
  dealer_name: string;
  dealer_code: string;
  total_net_amount: number;
  total_invoices: number;
  salesman_count: number;
  is_online: boolean;
}

/** Full payload returned by the leaderboard API route. */
export interface LeaderboardResponse {
  success: boolean;
  from: string;
  to: string;
  totalDealersCount: number;
  onlineDealersCount: number;
  totalSalesmenCount: number;
  totalRevenue: number;
  dealerStatuses: DealerStatusCheckpoint[];
  dealerRankings: DealerLeaderboardEntry[];
  rankings: SalesmanRankingEntry[];
  error?: string;
}
