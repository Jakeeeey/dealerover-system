import { dealeroverCache } from "@/modules/dealerover-system/bia/dealer/dealerover-kpi/utils/cache";
import type {
  BranchKind,
  DealerBranch,
  DealerRosterEntry,
  InventoryMetaResponse,
  InventoryPageResponse,
  InventoryRow,
  MasterProduct,
} from "../types";

/**
 * Server-only aggregation for the HQ inventory report.
 *
 * Roster lives on head-office Directus; each dealer owns its Spring Boot
 * running-inventory view plus its own Directus product master. One dealer is
 * loaded at a time: the client first reads the meta payload (branches +
 * product master, no stock) and then streams one branch-batch of stock rows
 * per page request. A failing dealer is reported offline, never fatal.
 */

/** Server default branch-batch size; reported back on the meta response. */
/**
 * Branches per stock request. Deliberately coarse: the dealer backends
 * rate-limit by REQUEST COUNT (measured: 3 requests per ~20 s window, then
 * HTTP 429 with Retry-After), so a whole dealer must load in a handful of
 * requests. Rows are only a few hundred KB per branch, while an extra request
 * costs a 20 s penalty.
 */
export const BRANCH_PAGE_SIZE = 10;

const UPSTREAM = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
const STATIC_TOKEN = process.env.DIRECTUS_STATIC_TOKEN || "";
const DEALEROVER_USERNAME = process.env.DEALEROVER_USERNAME || "";
const DEALEROVER_PASSWORD = process.env.DEALEROVER_PASSWORD || "";

const CREDENTIALS_CONFIGURED = Boolean(DEALEROVER_USERNAME && DEALEROVER_PASSWORD);

type LoginOutcome =
  | { ok: true; token: string }
  | { ok: false; reason: "credentials-missing" | "credentials-rejected" | "login-rejected" | "unreachable" };

type StockFailure = "unreachable" | "timeout" | "http-error" | "rate-limited";

type DealerFailureReason =
  | "credentials-missing"
  | "credentials-rejected"
  | "login-rejected"
  | "unreachable"
  | "timeout"
  | "http-error"
  | "rate-limited"
  | "product-master-unreachable";

const DEALER_FAILURE_MESSAGES: Record<DealerFailureReason, string> = {
  "credentials-missing":
    "Dealer credentials are not configured (DEALEROVER_USERNAME / DEALEROVER_PASSWORD are missing)",
  "credentials-rejected": "Dealer backend rejected the service-account credentials",
  "login-rejected": "Dealer backend rejected the login request",
  timeout: "Dealer backend timed out while reading inventory",
  unreachable: "Dealer backend unreachable",
  "http-error": "Dealer backend returned an error response",
  "rate-limited": "Dealer backend is throttling requests (too many in one window)",
  "product-master-unreachable": "Dealer product master unreachable",
};

function classifyStockError(err: unknown): StockFailure {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (isHttpError(err)) return err.status === 429 ? "rate-limited" : "http-error";
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/^HTTP \d+/.test(message)) return "http-error";
  return "unreachable";
}

function isAuthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /^HTTP 401\b/.test(message) || /^HTTP 403\b/.test(message);
}

function toDealerReason(err: unknown): DealerFailureReason {
  const failure = classifyStockError(err);
  return failure === "http-error" ? "http-error" : failure;
}

const DEALER_LIST_FIELDS =
  "dealer_id,dealer_name,dealer_code,directus,directus_token,springboot,status,is_default";

const ROSTER_TIMEOUT_MS = 6000;
const INVENTORY_TIMEOUT_MS = 60000;
const MASTER_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SPRING_TOKEN_TTL_MS = 10 * 60 * 1000;
const PAGE_CACHE_TTL_MS = 3 * 60 * 1000;
const MASTER_PAGE_LIMIT = 1000;

const PRODUCT_FIELDS = [
  "product_id",
  "product_code",
  "product_name",
  "cost_per_unit",
  "price_per_unit",
  "maintaining_quantity",
  "unit_of_measurement",
  "unit_of_measurement_count",
  "product_brand",
  "product_category",
  "isActive",
  "inventory_type",
].join(",");

const BRANCH_FIELDS = "id,branch_code,branch_name,isActive,isBadStock,isMoving,isReturn";
// Demand basis: the dealer's own invoices. `supplier_sales_forecast` is NOT
// used — it is seed data (identical on all three dealers, one branch, six
// non-zero rows).
const SALES_INVOICE_FIELDS = "invoice_id,invoice_no,invoice_date,branch_id,transaction_status";
const SALES_DETAIL_FIELDS = "detail_id,invoice_no,product_id,quantity,unit";
// Cancellation-like statuses are excluded defensively. None exist in the live
// data today (cancellations live in the separate *_cancellation_requests
// collections), so this list is a guard rather than a filter. `isPosted` is
// deliberately NOT used: it is false on every A2J and Urdaneta invoice, which
// would erase those dealers' demand.
const EXCLUDED_INVOICE_STATUSES = new Set([
  "cancelled",
  "canceled",
  "void",
  "voided",
  "replaced",
  "cancelled invoice",
  "canceled invoice",
]);
const BRAND_FIELDS = "brand_id,brand_name";
const CATEGORY_FIELDS = "category_id,category_name";
const SUPPLIER_FIELDS = "id,supplier_name,supplier_shortcut";

interface DealerRow {
  dealer_id: number | string;
  dealer_name?: string | null;
  dealer_code?: string | null;
  directus?: string | null;
  directus_token?: string | null;
  springboot?: string | null;
}

interface RawInventory {
  id?: string | null;
  productId?: number | string | null;
  supplierId?: number | string | null;
  branchId?: number | string | null;
  productCode?: string | null;
  productName?: string | null;
  productBarcode?: string | null;
  productBrand?: string | null;
  productCategory?: string | null;
  unitName?: string | null;
  unitCount?: number | string | null;
  branchName?: string | null;
  lastCutoff?: string | null;
  lastCount?: number | string | null;
  movementAfter?: number | string | null;
  runningInventory?: number | string | null;
  supplierShortcut?: string | null;
}

interface RawProduct {
  product_id?: number | string | null;
  product_code?: string | null;
  product_name?: string | null;
  cost_per_unit?: number | string | null;
  maintaining_quantity?: number | string | null;
  unit_of_measurement_count?: number | string | null;
  product_brand?: number | string | null;
  product_category?: number | string | null;
  isActive?: number | string | boolean | null;
}

interface RawBranch {
  id?: number | string | null;
  branch_code?: string | null;
  branch_name?: string | null;
  isActive?: number | string | boolean | null;
  isBadStock?: number | string | boolean | null;
  isMoving?: number | string | boolean | null;
  isReturn?: number | string | boolean | null;
}

interface RawInvoice {
  invoice_id?: number | string | null;
  invoice_no?: string | null;
  invoice_date?: string | null;
  branch_id?: number | string | null;
  transaction_status?: string | null;
}

interface RawInvoiceDetail {
  detail_id?: number | string | null;
  invoice_no?: string | null;
  product_id?: number | string | null;
  quantity?: number | string | null;
  unit?: number | string | null;
}

interface RawBrand {
  brand_id?: number | string | null;
  brand_name?: string | null;
}

interface RawCategory {
  category_id?: number | string | null;
  category_name?: string | null;
}

interface RawSupplier {
  id?: number | string | null;
  supplier_name?: string | null;
  supplier_shortcut?: string | null;
}

interface DealerContext {
  branches: DealerBranch[];
  products: MasterProduct[];
}

function toInt(value: unknown): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function extractData<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

function normalizeWindowDays(value: unknown): number {
  return Math.min(365, Math.max(7, Math.trunc(toNum(value)) || 30));
}

function normalizePageSize(value: unknown): number {
  const n = Math.trunc(toNum(value));
  if (!Number.isFinite(n) || n <= 0) return BRANCH_PAGE_SIZE;
  return Math.min(30, Math.max(1, n));
}

/** HTTP failure that keeps the status and Retry-After so 429 can be paced. */
class HttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, body: string, retryAfterSeconds: number | null) {
    super(`HTTP ${status}${body ? `: ${body.slice(0, 180)}` : ""}`);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

/** Parses a Retry-After header (the numeric-seconds form; dates are ignored). */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

async function fetchJson(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { method: "GET", headers, cache: "no-store", signal });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status, body, parseRetryAfter(res.headers.get("retry-after")));
  }
  return res.json();
}

async function loginToDealerSpringBoot(springbootUrl: string): Promise<LoginOutcome> {
  if (!CREDENTIALS_CONFIGURED) {
    return { ok: false, reason: "credentials-missing" };
  }
  const cleanBase = springbootUrl.replace(/\/+$/, "");
  const loginUrl = `${cleanBase}/auth/login`;

  const payload = {
    email: DEALEROVER_USERNAME,
    hashPassword: DEALEROVER_PASSWORD,
    rememberMe: false,
    latitude: "",
    longitude: "",
  };

  try {
    const res = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`ERR_LOGIN_FAIL: [InventoryReport] Login failed for ${loginUrl}: ${res.status}`);
      if (res.status === 400) return { ok: false, reason: "login-rejected" };
      if (res.status === 401 || res.status === 403) return { ok: false, reason: "credentials-rejected" };
      return { ok: false, reason: "login-rejected" };
    }

    const json = await res.json();
    const dataObj =
      json && typeof json === "object" && "data" in (json as Record<string, unknown>)
        ? (json as { data: Record<string, unknown> }).data
        : (json as Record<string, unknown>);
    const token =
      (dataObj as Record<string, unknown>)?.["token"] ??
      (json as Record<string, unknown>)?.["token"];
    if (typeof token !== "string" || !token) {
      return { ok: false, reason: "login-rejected" };
    }
    return { ok: true, token };
  } catch (e) {
    console.error(`ERR_LOGIN_FAIL: [InventoryReport] Login error for ${loginUrl}:`, e);
    return { ok: false, reason: "unreachable" };
  }
}

/**
 * Spring Boot bearer tokens, keyed by the dealer's Spring base URL. Ten page
 * requests for one dealer share a single login instead of logging in ten
 * times.
 */
const SPRING_TOKEN_CACHE = new Map<string, { token: string; expiry: number }>();

function clearSpringToken(springBase: string): void {
  SPRING_TOKEN_CACHE.delete(springBase);
}

/**
 * Returns a cached Spring Boot token for the dealer, logging in when no
 * fresh token exists.
 */
async function getSpringToken(springBase: string, forceRefresh = false): Promise<LoginOutcome> {
  if (!forceRefresh) {
    const hit = SPRING_TOKEN_CACHE.get(springBase);
    if (hit && hit.expiry > Date.now()) return { ok: true, token: hit.token };
  }
  const login = await loginToDealerSpringBoot(springBase);
  if (login.ok) {
    SPRING_TOKEN_CACHE.set(springBase, { token: login.token, expiry: Date.now() + SPRING_TOKEN_TTL_MS });
  }
  return login;
}

const DEALER_LIST_CACHE: { data: DealerRow[] | null; expiry: number } = { data: null, expiry: 0 };

async function getCachedDealerList(): Promise<DealerRow[]> {
  const now = Date.now();
  if (DEALER_LIST_CACHE.data && DEALER_LIST_CACHE.expiry > now) {
    return DEALER_LIST_CACHE.data;
  }
  const payload = await fetchJson(
    `${UPSTREAM}/items/dealer_list?limit=-1&fields=${DEALER_LIST_FIELDS}`,
    { "Content-Type": "application/json", Authorization: `Bearer ${STATIC_TOKEN}` },
    AbortSignal.timeout(ROSTER_TIMEOUT_MS),
  );
  const rows = extractData<DealerRow>(payload);
  DEALER_LIST_CACHE.data = rows;
  DEALER_LIST_CACHE.expiry = now + CACHE_TTL_MS;
  return rows;
}

function findDealer(roster: DealerRow[], dealerId: string): DealerRow | null {
  return roster.find((d) => String(d.dealer_id) === dealerId) ?? null;
}

function dealerHeaders(dealer: DealerRow): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${dealer.directus_token || ""}`,
  };
}

type StockResult =
  | { ok: true; rows: RawInventory[] }
  | { ok: false; reason: DealerFailureReason; detail?: string };

const STOCK_MAX_ATTEMPTS = 3;
/** Ceiling for a Retry-After wait so one page cannot hang the request forever. */
const STOCK_MAX_RATE_LIMIT_WAIT_SECONDS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Short, non-secret detail that makes a failure message diagnosable. */
function describeStockError(err: unknown): string | undefined {
  if (isHttpError(err)) return `HTTP ${err.status}`;
  if (err instanceof Error && err.name) return err.name;
  return undefined;
}

/**
 * Reads one branch-batch of running-inventory rows. The dealer backend
 * ignores limit/offset-style paging, so callers pass the wanted branch ids
 * as repeated `branchId` params and the backend returns those branches' rows.
 *
 * Failure handling, in order:
 * - 401/403 clears the cached Spring token and retries with a fresh login.
 * - 429 honours Retry-After (capped) and retries, because the dealer backends
 *   allow only a few requests per window — pacing beats failing the stream.
 * - a timeout is never retried (this call is already the slowest we make).
 * - any other failure gets one plain retry.
 */
async function fetchStockForBranches(springBase: string, branchIds: number[]): Promise<StockResult> {
  const query = branchIds.map((id) => `branchId=${encodeURIComponent(String(id))}`).join("&");
  const url = `${springBase}/api/view-running-inventory/filter?${query}`;

  let login = await getSpringToken(springBase);
  if (!login.ok) return { ok: false, reason: login.reason };
  let token = login.token;
  let lastError: unknown = null;
  let plainRetryUsed = false;

  for (let attempt = 1; attempt <= STOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const payload = await fetchJson(
        url,
        { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        AbortSignal.timeout(INVENTORY_TIMEOUT_MS),
      );
      return { ok: true, rows: extractData<RawInventory>(payload) };
    } catch (err) {
      lastError = err;

      if (isAuthError(err)) {
        console.error(
          `ERR_AUTH_FAIL: [InventoryReport] Stock token rejected for ${springBase}, refreshing login`,
        );
        clearSpringToken(springBase);
        login = await getSpringToken(springBase, true);
        if (!login.ok) return { ok: false, reason: login.reason };
        token = login.token;
        continue;
      }

      if (isHttpError(err) && err.status === 429) {
        const waitSeconds = Math.min(err.retryAfterSeconds ?? 20, STOCK_MAX_RATE_LIMIT_WAIT_SECONDS);
        if (attempt >= STOCK_MAX_ATTEMPTS) {
          console.error(
            `ERR_RATE_LIMIT: [InventoryReport] ${springBase} still throttling after ${attempt} attempts`,
          );
          return { ok: false, reason: "rate-limited", detail: `HTTP 429 after ${attempt} attempts` };
        }
        console.warn(
          `ERR_RATE_LIMIT: [InventoryReport] ${springBase} returned 429; waiting ${waitSeconds}s (attempt ${attempt})`,
        );
        await sleep(waitSeconds * 1000);
        continue;
      }

      // A timeout retry would double a 60 s wait to 120 s for no benefit.
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        console.error(`ERR_API_FAIL: [InventoryReport] Stock request timed out for ${url}:`, err);
        return { ok: false, reason: "timeout" };
      }

      console.error(`ERR_API_FAIL: [InventoryReport] Stock request failed for ${url}:`, err);
      if (!plainRetryUsed && attempt < STOCK_MAX_ATTEMPTS) {
        plainRetryUsed = true;
        continue;
      }
      return { ok: false, reason: toDealerReason(err), detail: describeStockError(err) };
    }
  }

  return {
    ok: false,
    reason: toDealerReason(lastError),
    detail: describeStockError(lastError),
  };
}

async function getCachedCollection<T>(key: string, url: string, headers: Record<string, string>): Promise<T[]> {
  const hit = dealeroverCache.get<T[]>(key);
  if (hit) return hit;
  const payload = await fetchJson(url, headers, AbortSignal.timeout(MASTER_TIMEOUT_MS));
  const rows = extractData<T>(payload);
  dealeroverCache.set(key, rows, CACHE_TTL_MS);
  return rows;
}

/**
 * Derives the physical role of a branch from the dealer's own branch flags.
 * Bad-stock twins win over the return flag they also carry; a missing row
 * maps to "other".
 */
export function classifyBranchKind(branch: RawBranch | null | undefined): BranchKind {
  if (!branch) return "other";
  if (toInt(branch.isBadStock) !== 0) return "bad_stock";
  if (toInt(branch.isReturn) !== 0) return "return";
  if (toInt(branch.isMoving) !== 0) return "moving";
  if (/warehouse|central/i.test(str(branch.branch_name))) return "warehouse";
  return "selling";
}

/**
 * Demand in BASE PIECES per `${productId}:${branchId}` over the trailing
 * window, built from the dealer's own invoices.
 *
 * Invoice lines record `quantity` in the SKU's selling unit — verified against
 * live data: every line's `unit` matches the product's `unit_of_measurement`
 * (2,084/2,084) — so pieces = quantity x pack size. Invoices with a
 * cancellation-like status, an unparsable date, an unknown branch or a date
 * before the window are excluded.
 */
function buildDemandByKey(
  invoices: RawInvoice[],
  details: RawInvoiceDetail[],
  packById: Map<number, number>,
  windowStart: number,
): Map<string, number> {
  const branchByInvoice = new Map<string, number>();
  for (const inv of invoices) {
    const invoiceNo = str(inv.invoice_no);
    if (!invoiceNo) continue;
    if (EXCLUDED_INVOICE_STATUSES.has(str(inv.transaction_status).toLowerCase())) continue;
    const date = Date.parse(str(inv.invoice_date));
    if (!Number.isFinite(date) || date < windowStart) continue;
    const branchId = toInt(inv.branch_id);
    if (branchId <= 0) continue;
    branchByInvoice.set(invoiceNo, branchId);
  }

  const demandByKey = new Map<string, number>();
  for (const line of details) {
    const branchId = branchByInvoice.get(str(line.invoice_no));
    if (!branchId) continue;
    const productId = toInt(line.product_id);
    if (productId <= 0) continue;
    const qty = toNum(line.quantity);
    if (qty === 0) continue;
    const pack = packById.get(productId) ?? 1;
    const key = `${productId}:${branchId}`;
    demandByKey.set(key, (demandByKey.get(key) ?? 0) + qty * pack);
  }
  return demandByKey;
}

/**
 * Reads the dealer's whole active product master through limit/offset paging
 * (`sort=product_id`, explicit fields, `isActive=1` filter — the collection
 * is too large for a single `limit=-1` read) and resolves brand/category
 * names through the cached lookups.
 */
async function fetchMasterProducts(
  directusBase: string,
  headers: Record<string, string>,
  brandById: Map<number, string>,
  categoryById: Map<number, string>,
): Promise<MasterProduct[]> {
  const products: MasterProduct[] = [];
  const seen = new Set<number>();
  let offset = 0;
  for (;;) {
    const url =
      `${directusBase}/items/products?limit=${MASTER_PAGE_LIMIT}&offset=${offset}` +
      `&sort=product_id&fields=${PRODUCT_FIELDS}&filter[isActive][_eq]=1`;
    const payload = await fetchJson(url, headers, AbortSignal.timeout(MASTER_TIMEOUT_MS));
    const batch = extractData<RawProduct>(payload);
    for (const p of batch) {
      const pid = toInt(p.product_id);
      if (pid <= 0 || seen.has(pid)) continue;
      if (toInt(p.isActive) === 0) continue;
      seen.add(pid);
      products.push({
        productId: pid,
        productCode: str(p.product_code),
        productName: str(p.product_name),
        brand: brandById.get(toInt(p.product_brand)) ?? "",
        category: categoryById.get(toInt(p.product_category)) ?? "",
        unitCount: toNum(p.unit_of_measurement_count),
        costPerUnit: toNum(p.cost_per_unit),
        maintainingQuantity: toNum(p.maintaining_quantity),
      });
    }
    if (batch.length < MASTER_PAGE_LIMIT) break;
    offset += MASTER_PAGE_LIMIT;
  }
  return products;
}

/**
 * Builds and caches one dealer's branch list plus its active product master
 * (TTL 5 min). Never touches stock — the meta and page entry points share
 * this so every page request reuses the same join basis.
 */
async function ensureDealerContext(
  dealer: DealerRow,
  opts?: { refresh?: boolean },
): Promise<DealerContext> {
  const dealerId = String(dealer.dealer_id);
  const cacheKey = `inventory-report:${dealerId}:context`;
  if (!opts?.refresh) {
    const hit = dealeroverCache.get<DealerContext>(cacheKey);
    if (hit) return hit;
  }

  const directusBase = str(dealer.directus).replace(/\/+$/, "");
  const headers = dealerHeaders(dealer);

  const rawBranches = await getCachedCollection<RawBranch>(
    `inventory-report:${dealerId}:branches`,
    `${directusBase}/items/branches?limit=-1&fields=${BRANCH_FIELDS}`,
    headers,
  );
  const branches: DealerBranch[] = [];
  const seenBranches = new Set<number>();
  for (const b of rawBranches) {
    const bid = toInt(b.id);
    if (bid <= 0 || seenBranches.has(bid)) continue;
    seenBranches.add(bid);
    branches.push({
      branchId: bid,
      branchName: str(b.branch_name) || `Branch ${bid}`,
      kind: classifyBranchKind(b),
    });
  }
  branches.sort((a, b) => a.branchId - b.branchId);

  const settled = await Promise.allSettled([
    getCachedCollection<RawBrand>(
      `inventory-report:${dealerId}:brands`,
      `${directusBase}/items/brand?limit=-1&fields=${BRAND_FIELDS}`,
      headers,
    ),
    getCachedCollection<RawCategory>(
      `inventory-report:${dealerId}:categories`,
      `${directusBase}/items/categories?limit=-1&fields=${CATEGORY_FIELDS}`,
      headers,
    ),
  ]);
  const brandById = new Map<number, string>();
  if (settled[0].status === "fulfilled") {
    for (const b of settled[0].value) {
      const bid = toInt(b.brand_id);
      if (bid > 0) brandById.set(bid, str(b.brand_name));
    }
  }
  const categoryById = new Map<number, string>();
  if (settled[1].status === "fulfilled") {
    for (const c of settled[1].value) {
      const cid = toInt(c.category_id);
      if (cid > 0) categoryById.set(cid, str(c.category_name));
    }
  }

  const products = await fetchMasterProducts(directusBase, headers, brandById, categoryById);

  const ctx: DealerContext = { branches, products };
  dealeroverCache.set(cacheKey, ctx, CACHE_TTL_MS);
  return ctx;
}

/**
 * Lightweight dealer roster built from the already-cached dealer list.
 * Lets the picker render without depending on the selected dealers' data.
 */
export async function fetchDealerRoster(): Promise<DealerRosterEntry[]> {
  const roster = await getCachedDealerList();
  return roster.map((d) => ({
    dealerId: String(d.dealer_id),
    dealerName: str(d.dealer_name) || `Dealer ${String(d.dealer_id)}`,
    dealerCode: str(d.dealer_code),
  }));
}

function offlineMeta(
  dealerId: string,
  dealerName: string,
  dealerCode: string,
  reason: DealerFailureReason,
  success: boolean,
): InventoryMetaResponse {
  return {
    success,
    dealer: {
      dealerId,
      dealerName,
      dealerCode,
      online: false,
      rowCount: 0,
      error: DEALER_FAILURE_MESSAGES[reason],
      reason,
    },
    branches: [],
    products: [],
    totalBranches: 0,
    branchPageSize: BRANCH_PAGE_SIZE,
    error: DEALER_FAILURE_MESSAGES[reason],
  };
}

/**
 * Loads one dealer's branches plus its whole active product master. Never
 * fetches stock — the client pages stock separately. A failing dealer is
 * reported offline (with a self-diagnosing reason) instead of throwing.
 */
export async function fetchInventoryMeta(
  dealerId: string,
  opts?: { refresh?: boolean },
): Promise<InventoryMetaResponse> {
  const id = str(dealerId);

  if (!UPSTREAM) {
    console.error("ERR_CONFIG: [InventoryReport] NEXT_PUBLIC_API_BASE_URL is not defined");
    return offlineMeta(id, `Dealer ${id}`, "", "unreachable", false);
  }

  let roster: DealerRow[];
  try {
    roster = await getCachedDealerList();
  } catch (error) {
    console.error("ERR_API_FAIL: [InventoryReport] Failed to load dealer roster:", error);
    return offlineMeta(id, `Dealer ${id}`, "", "unreachable", false);
  }

  const dealer = findDealer(roster, id);
  if (!dealer) {
    console.error(`ERR_NOT_FOUND: [InventoryReport] Dealer "${id}" is not on the roster`);
    return {
      success: false,
      dealer: {
        dealerId: id,
        dealerName: `Dealer ${id}`,
        dealerCode: "",
        online: false,
        rowCount: 0,
        error: "Unknown dealer",
        reason: "unreachable",
      },
      branches: [],
      products: [],
      totalBranches: 0,
      branchPageSize: BRANCH_PAGE_SIZE,
      error: "Unknown dealer",
    };
  }

  const dealerName = str(dealer.dealer_name) || `Dealer ${id}`;
  const dealerCode = str(dealer.dealer_code);
  const springBase = str(dealer.springboot).replace(/\/+$/, "");
  const directusBase = str(dealer.directus).replace(/\/+$/, "");
  if (!springBase || !directusBase) {
    return offlineMeta(id, dealerName, dealerCode, "unreachable", false);
  }

  // Login first: without a Spring token no stock page can load, so fail fast
  // with the credential reason instead of shipping a master nobody can page.
  const login = await getSpringToken(springBase, opts?.refresh === true);
  if (!login.ok) {
    return offlineMeta(id, dealerName, dealerCode, login.reason, false);
  }

  let ctx: DealerContext;
  try {
    ctx = await ensureDealerContext(dealer, { refresh: opts?.refresh });
  } catch (err) {
    console.error(`ERR_API_FAIL: [InventoryReport] Dealer "${dealerName}" master unreachable:`, err);
    const failure = classifyStockError(err);
    return offlineMeta(
      id,
      dealerName,
      dealerCode,
      failure === "timeout" ? "timeout" : "product-master-unreachable",
      false,
    );
  }

  return {
    success: true,
    dealer: { dealerId: id, dealerName, dealerCode, online: true, rowCount: 0 },
    branches: ctx.branches,
    products: ctx.products,
    totalBranches: ctx.branches.length,
    branchPageSize: BRANCH_PAGE_SIZE,
  };
}

/**
 * Loads one branch-batch of stock rows for a dealer and joins cost, reorder
 * floor and trailing demand onto each row. Zero rows are dropped unless
 * `includeZero` is set. Page payloads are cached for 3 min per
 * dealer/page/size/window/zero-flags unless `bypassCache` is set.
 */
export async function fetchInventoryPage(
  dealerId: string,
  page: number,
  pageSize: number,
  opts?: { windowDays?: number; includeZero?: boolean; bypassCache?: boolean },
): Promise<InventoryPageResponse> {
  const id = str(dealerId);
  const safePage = Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0;
  const safeSize = normalizePageSize(pageSize);
  const windowDays = normalizeWindowDays(opts?.windowDays ?? 30);
  const includeZero = opts?.includeZero === true;

  const empty = (totalBranches: number, branchIds: number[], error?: string): InventoryPageResponse => ({
    success: error === undefined,
    dealerId: id,
    page: safePage,
    pageSize: safeSize,
    totalBranches,
    branchIds,
    hasMore: false,
    scanned: 0,
    rows: [],
    error,
  });

  if (!UPSTREAM) {
    console.error("ERR_CONFIG: [InventoryReport] NEXT_PUBLIC_API_BASE_URL is not defined");
    return empty(0, [], "Server configuration error");
  }

  const cacheKey =
    `inventory-report:page:${id}:${safePage}:${safeSize}:${windowDays}:${includeZero ? 1 : 0}`;
  if (!opts?.bypassCache) {
    const hit = dealeroverCache.get<InventoryPageResponse>(cacheKey);
    if (hit) return hit;
  }

  let roster: DealerRow[];
  try {
    roster = await getCachedDealerList();
  } catch (error) {
    console.error("ERR_API_FAIL: [InventoryReport] Failed to load dealer roster:", error);
    return empty(0, [], "Unable to reach the dealer registry");
  }

  const dealer = findDealer(roster, id);
  if (!dealer) {
    console.error(`ERR_NOT_FOUND: [InventoryReport] Dealer "${id}" is not on the roster`);
    return empty(0, [], "Unknown dealer");
  }

  const dealerName = str(dealer.dealer_name) || `Dealer ${id}`;
  const dealerCode = str(dealer.dealer_code);
  const springBase = str(dealer.springboot).replace(/\/+$/, "");
  const directusBase = str(dealer.directus).replace(/\/+$/, "");
  if (!springBase || !directusBase) {
    return empty(0, [], DEALER_FAILURE_MESSAGES["unreachable"]);
  }

  let ctx: DealerContext;
  try {
    ctx = await ensureDealerContext(dealer);
  } catch (err) {
    console.error(`ERR_API_FAIL: [InventoryReport] Dealer "${dealerName}" master unreachable:`, err);
    return empty(0, [], DEALER_FAILURE_MESSAGES["product-master-unreachable"]);
  }

  const totalBranches = ctx.branches.length;
  const slice = ctx.branches.slice(safePage * safeSize, safePage * safeSize + safeSize);
  const branchIds = slice.map((b) => b.branchId);
  if (branchIds.length === 0) {
    return { ...empty(totalBranches, []), success: true };
  }

  const stock = await fetchStockForBranches(springBase, branchIds);
  if (!stock.ok) {
    console.error(
      `ERR_API_FAIL: [InventoryReport] Dealer "${dealerName}" page ${safePage} failed: ${stock.reason}${stock.detail ? ` (${stock.detail})` : ""}`,
    );
    return empty(
      totalBranches,
      branchIds,
      `${DEALER_FAILURE_MESSAGES[stock.reason]}${stock.detail ? ` (${stock.detail})` : ""}`,
    );
  }

  const headers = dealerHeaders(dealer);
  const settled = await Promise.allSettled([
    getCachedCollection<RawInvoice>(
      `inventory-report:${id}:invoices`,
      `${directusBase}/items/sales_invoice?limit=-1&fields=${SALES_INVOICE_FIELDS}`,
      headers,
    ),
    getCachedCollection<RawInvoiceDetail>(
      `inventory-report:${id}:invoice-lines`,
      `${directusBase}/items/sales_invoice_details?limit=-1&fields=${SALES_DETAIL_FIELDS}`,
      headers,
    ),
    getCachedCollection<RawSupplier>(
      `inventory-report:${id}:suppliers`,
      `${directusBase}/items/suppliers?limit=-1&fields=${SUPPLIER_FIELDS}`,
      headers,
    ),
  ]);
  const invoices = settled[0].status === "fulfilled" ? settled[0].value : [];
  const invoiceLines = settled[1].status === "fulfilled" ? settled[1].value : [];
  const suppliers = settled[2].status === "fulfilled" ? settled[2].value : [];

  const productById = new Map<number, MasterProduct>();
  for (const p of ctx.products) {
    if (!productById.has(p.productId)) productById.set(p.productId, p);
  }
  const branchNameById = new Map<number, string>();
  for (const b of ctx.branches) branchNameById.set(b.branchId, b.branchName);
  const supplierShortcutById = new Map<number, string>();
  for (const s of suppliers) {
    const sid = toInt(s.id);
    if (sid > 0) supplierShortcutById.set(sid, str(s.supplier_shortcut));
  }

  // Demand basis: the dealer's own invoices over the trailing window.
  const windowStart = Date.now() - Math.max(windowDays, 1) * 24 * 60 * 60 * 1000;
  const packById = new Map<number, number>();
  for (const p of ctx.products) {
    if (p.unitCount > 0) packById.set(p.productId, p.unitCount);
  }
  const demandByKey = buildDemandByKey(invoices, invoiceLines, packById, windowStart);

  const rows: InventoryRow[] = [];
  for (const raw of stock.rows) {
    const running = toNum(raw.runningInventory);
    if (running <= 0 && !includeZero) continue;
    const productId = toInt(raw.productId);
    const branchId = toInt(raw.branchId);
    if (productId <= 0 || branchId <= 0) continue;
    const master = productById.get(productId);
    const rawUnitCount = toNum(raw.unitCount);
    const unitCount = rawUnitCount > 0 ? rawUnitCount : (master?.unitCount ?? 0);
    const rawShortcut = str(raw.supplierShortcut);
    const fallbackShortcut = supplierShortcutById.get(toInt(raw.supplierId)) ?? "";

    rows.push({
      key: `${id}:${str(raw.id) || `${branchId}-${productId}`}`,
      dealerId: id,
      dealerName,
      dealerCode,
      branchId,
      branchName: str(raw.branchName) || branchNameById.get(branchId) || `Branch ${branchId}`,
      productId,
      productCode: str(raw.productCode),
      productName: str(raw.productName),
      productBarcode: str(raw.productBarcode),
      productBrand: str(raw.productBrand) || master?.brand || "",
      productCategory: str(raw.productCategory) || master?.category || "",
      supplierShortcut: rawShortcut || fallbackShortcut,
      unitName: str(raw.unitName),
      unitCount,
      onHand: running,
      lastCount: toNum(raw.lastCount),
      movementAfter: toNum(raw.movementAfter),
      lastCutoff: str(raw.lastCutoff),
      costPerUnit: master?.costPerUnit ?? 0,
      maintainingQuantity: master?.maintainingQuantity ?? 0,
      demandQty: demandByKey.get(`${productId}:${branchId}`) ?? 0,
    });
  }

  const response: InventoryPageResponse = {
    success: true,
    dealerId: id,
    page: safePage,
    pageSize: safeSize,
    totalBranches,
    branchIds,
    hasMore: (safePage + 1) * safeSize < totalBranches,
    scanned: stock.rows.length,
    rows,
  };
  if (!opts?.bypassCache) {
    dealeroverCache.set(cacheKey, response, PAGE_CACHE_TTL_MS);
  }
  return response;
}
