import { dealeroverCache } from "@/modules/dealerover-system/bia/dealer/dealerover-kpi/utils/cache";
import type {
  DealerRosterEntry,
  DealerStatus,
  InventoryReportParams,
  InventoryReportResponse,
  InventoryRow,
  StockOutItem,
} from "../types";

/**
 * Server-only aggregation for the HQ inventory report.
 *
 * Roster lives on head-office Directus; each dealer owns its Spring Boot
 * running-inventory view plus its own Directus product master. A failing
 * dealer is reported offline and contributes no rows — never fatal.
 */

const UPSTREAM = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
const STATIC_TOKEN = process.env.DIRECTUS_STATIC_TOKEN || "";
const DEALEROVER_USERNAME = process.env.DEALEROVER_USERNAME || "";
const DEALEROVER_PASSWORD = process.env.DEALEROVER_PASSWORD || "";

const CREDENTIALS_CONFIGURED = Boolean(DEALEROVER_USERNAME && DEALEROVER_PASSWORD);

type LoginOutcome =
  | { ok: true; token: string }
  | { ok: false; reason: "credentials-missing" | "credentials-rejected" | "login-rejected" | "unreachable" };

type StockFailure = "unreachable" | "timeout" | "http-error";

type DealerFailureReason =
  | "credentials-missing"
  | "credentials-rejected"
  | "login-rejected"
  | "unreachable"
  | "timeout"
  | "http-error"
  | "product-master-unreachable";

const DEALER_FAILURE_MESSAGES: Record<DealerFailureReason, string> = {
  "credentials-missing":
    "Dealer credentials are not configured (DEALEROVER_USERNAME / DEALEROVER_PASSWORD are missing)",
  "credentials-rejected": "Dealer backend rejected the service-account credentials",
  "login-rejected": "Dealer backend rejected the login request",
  timeout: "Dealer backend timed out while reading inventory",
  unreachable: "Dealer backend unreachable",
  "http-error": "Dealer backend unreachable",
  "product-master-unreachable": "Dealer product master unreachable",
};

function classifyStockError(err: unknown): StockFailure {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/^HTTP \d+/.test(message)) return "http-error";
  return "unreachable";
}

const DEALER_LIST_FIELDS =
  "dealer_id,dealer_name,dealer_code,directus,directus_token,springboot,status,is_default";

const ROSTER_TIMEOUT_MS = 6000;
const INVENTORY_TIMEOUT_MS = 60000;
const MASTER_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 5 * 60 * 1000;

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

async function fetchJson(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { method: "GET", headers, cache: "no-store", signal });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 180)}` : ""}`);
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

async function fetchInventoryWithRetry(base: string, token: string): Promise<RawInventory[]> {
  const url = `${base}/api/view-running-inventory/filter`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const payload = await fetchJson(url, headers, AbortSignal.timeout(INVENTORY_TIMEOUT_MS));
      return extractData<RawInventory>(payload);
    } catch (err) {
      // A timeout retry would double a 60 s wait to 120 s for no benefit.
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) throw err;
      if (attempt === 1) throw err;
    }
  }
  return [];
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

async function fetchDealerReport(dealer: DealerRow, windowDays: number, includeZero: boolean): Promise<{
  status: DealerStatus;
  rows: InventoryRow[];
  stockOuts: StockOutItem[];
}> {
  const dealerId = String(dealer.dealer_id);
  const dealerName = str(dealer.dealer_name) || `Dealer ${dealerId}`;
  const dealerCode = str(dealer.dealer_code);
  const fail = (
    reason: DealerFailureReason,
  ): { status: DealerStatus; rows: InventoryRow[]; stockOuts: StockOutItem[] } => ({
    status: { dealerId, dealerName, dealerCode, online: false, rowCount: 0, error: DEALER_FAILURE_MESSAGES[reason], reason },
    rows: [],
    stockOuts: [],
  });

  const springBase = str(dealer.springboot).replace(/\/+$/, "");
  const directusBase = str(dealer.directus).replace(/\/+$/, "");
  if (!springBase || !directusBase) {
    return fail("unreachable");
  }

  const login = await loginToDealerSpringBoot(springBase);
  if (!login.ok) {
    return fail(login.reason);
  }
  const token = login.token;

  let rawInventory: RawInventory[];
  try {
    rawInventory = await fetchInventoryWithRetry(springBase, token);
  } catch (err) {
    console.error(`ERR_API_FAIL: [InventoryReport] Dealer "${dealerName}" inventory unreachable:`, err);
    const failure = classifyStockError(err);
    return fail(failure === "http-error" ? "http-error" : failure);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${dealer.directus_token || ""}`,
  };

  let products: RawProduct[];
  let branches: RawBranch[];
  let invoices: RawInvoice[];
  let invoiceLines: RawInvoiceDetail[];
  let brands: RawBrand[];
  let categories: RawCategory[];
  let suppliers: RawSupplier[];
  try {
    const settled = await Promise.allSettled([
      getCachedCollection<RawProduct>(
        `inventory-report:${dealerId}:products`,
        `${directusBase}/items/products?limit=-1&fields=${PRODUCT_FIELDS}`,
        headers,
      ),
      getCachedCollection<RawBranch>(
        `inventory-report:${dealerId}:branches`,
        `${directusBase}/items/branches?limit=-1&fields=${BRANCH_FIELDS}`,
        headers,
      ),
      getCachedCollection<RawInvoice>(
        `inventory-report:${dealerId}:invoices`,
        `${directusBase}/items/sales_invoice?limit=-1&fields=${SALES_INVOICE_FIELDS}`,
        headers,
      ),
      getCachedCollection<RawInvoiceDetail>(
        `inventory-report:${dealerId}:invoice-lines`,
        `${directusBase}/items/sales_invoice_details?limit=-1&fields=${SALES_DETAIL_FIELDS}`,
        headers,
      ),
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
      getCachedCollection<RawSupplier>(
        `inventory-report:${dealerId}:suppliers`,
        `${directusBase}/items/suppliers?limit=-1&fields=${SUPPLIER_FIELDS}`,
        headers,
      ),
    ]);
    if (settled[0].status === "rejected" || settled[1].status === "rejected") {
      throw settled[0].status === "rejected" ? settled[0].reason : (settled[1] as PromiseRejectedResult).reason;
    }
    products = settled[0].status === "fulfilled" ? settled[0].value : [];
    branches = settled[1].status === "fulfilled" ? settled[1].value : [];
    invoices = settled[2].status === "fulfilled" ? settled[2].value : [];
    invoiceLines = settled[3].status === "fulfilled" ? settled[3].value : [];
    brands = settled[4].status === "fulfilled" ? settled[4].value : [];
    categories = settled[5].status === "fulfilled" ? settled[5].value : [];
    suppliers = settled[6].status === "fulfilled" ? settled[6].value : [];
  } catch (err) {
    console.error(`ERR_API_FAIL: [InventoryReport] Dealer "${dealerName}" master unreachable:`, err);
    return fail("product-master-unreachable");
  }

  const productById = new Map<number, RawProduct>();
  for (const p of products) {
    const pid = toInt(p.product_id);
    if (pid > 0 && !productById.has(pid)) productById.set(pid, p);
  }
  const branchNameById = new Map<number, string>();
  for (const b of branches) {
    const bid = toInt(b.id);
    if (bid > 0) branchNameById.set(bid, str(b.branch_name));
  }
  const brandById = new Map<number, string>();
  for (const b of brands) {
    const bid = toInt(b.brand_id);
    if (bid > 0) brandById.set(bid, str(b.brand_name));
  }
  const categoryById = new Map<number, string>();
  for (const c of categories) {
    const cid = toInt(c.category_id);
    if (cid > 0) categoryById.set(cid, str(c.category_name));
  }
  const supplierShortcutById = new Map<number, string>();
  for (const s of suppliers) {
    const sid = toInt(s.id);
    if (sid > 0) supplierShortcutById.set(sid, str(s.supplier_shortcut));
  }

  // Demand basis: the dealer's own invoices over the trailing window.
  const windowStart = Date.now() - Math.max(windowDays, 1) * 24 * 60 * 60 * 1000;
  const packById = new Map<number, number>();
  for (const [pid, master] of productById) {
    const pack = toNum(master.unit_of_measurement_count);
    if (pack > 0) packById.set(pid, pack);
  }
  const demandByKey = buildDemandByKey(invoices, invoiceLines, packById, windowStart);

  const rows: InventoryRow[] = [];
  const nonZeroProductIds = new Set<number>();

  for (const raw of rawInventory) {
    const running = toNum(raw.runningInventory);
    if (running <= 0 && !includeZero) continue;
    const productId = toInt(raw.productId);
    const branchId = toInt(raw.branchId);
    if (productId <= 0 || branchId <= 0) continue;
    const master = productById.get(productId);
    const rawUnitCount = toNum(raw.unitCount);
    const masterPack = master ? toNum(master.unit_of_measurement_count) : 0;
    const unitCount = rawUnitCount > 0 ? rawUnitCount : masterPack > 0 ? masterPack : 0;
    const costPerUnit = master ? toNum(master.cost_per_unit) : 0;
    const maintainingQuantity = master ? toNum(master.maintaining_quantity) : 0;
    const rawBrand = str(raw.productBrand);
    const rawCategory = str(raw.productCategory);
    const fallbackBrand = master ? (brandById.get(toInt(master.product_brand)) ?? "") : "";
    const fallbackCategory = master ? (categoryById.get(toInt(master.product_category)) ?? "") : "";
    const rawShortcut = str(raw.supplierShortcut);
    const supplierId = toInt(raw.supplierId);
    const fallbackShortcut = supplierShortcutById.get(supplierId) ?? "";

    if (running > 0) nonZeroProductIds.add(productId);

    rows.push({
      key: `${dealerId}:${str(raw.id) || `${branchId}-${productId}`}`,
      dealerId,
      dealerName,
      dealerCode,
      branchId,
      branchName: str(raw.branchName) || branchNameById.get(branchId) || `Branch ${branchId}`,
      productId,
      productCode: str(raw.productCode),
      productName: str(raw.productName),
      productBarcode: str(raw.productBarcode),
      productBrand: rawBrand || fallbackBrand,
      productCategory: rawCategory || fallbackCategory,
      supplierShortcut: rawShortcut || fallbackShortcut,
      unitName: str(raw.unitName),
      unitCount,
      onHand: running,
      lastCount: toNum(raw.lastCount),
      movementAfter: toNum(raw.movementAfter),
      lastCutoff: str(raw.lastCutoff),
      costPerUnit,
      maintainingQuantity,
      demandQty: demandByKey.get(`${productId}:${branchId}`) ?? 0,
    });
  }

  const stockOuts: StockOutItem[] = [];
  const branchIds = new Set<number>();
  for (const row of rows) branchIds.add(row.branchId);
  // Branch count for a stock-out = distinct branches seen for this dealer
  // (the running view lists every active product x branch, so this is the
  // branch universe the product is absent from).
  const branchCount = branchIds.size > 0 ? branchIds.size : branches.length;
  for (const p of products) {
    const pid = toInt(p.product_id);
    if (pid <= 0) continue;
    if (toInt(p.isActive) === 0) continue;
    if (nonZeroProductIds.has(pid)) continue;
    stockOuts.push({
      key: `${dealerId}:stockout:${pid}`,
      dealerId,
      dealerName,
      productId: pid,
      productCode: str(p.product_code),
      productName: str(p.product_name),
      brand: brandById.get(toInt(p.product_brand)) ?? "",
      category: categoryById.get(toInt(p.product_category)) ?? "",
      costPerUnit: toNum(p.cost_per_unit),
      branchCount,
    });
  }

  return {
    status: { dealerId, dealerName, dealerCode, online: true, rowCount: rows.length },
    rows,
    stockOuts,
  };
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

/**
 * Aggregates every dealer's running inventory into one HQ report payload.
 */
export async function fetchInventoryReport(params: InventoryReportParams): Promise<InventoryReportResponse> {
  const windowDays = Math.min(365, Math.max(7, Math.trunc(params.windowDays ?? 30) || 30));
  const includeZero = params.includeZero === true;
  const empty: InventoryReportResponse = {
    success: true,
    generatedAt: new Date().toISOString(),
    windowDays,
    includeZero,
    dealers: [],
    rows: [],
    stockOuts: [],
  };

  if (!UPSTREAM) {
    console.error("ERR_CONFIG: [InventoryReport] NEXT_PUBLIC_API_BASE_URL is not defined");
    return { ...empty, success: false, error: "Server configuration error" };
  }

  let roster: DealerRow[];
  try {
    roster = await getCachedDealerList();
  } catch (error) {
    console.error("ERR_API_FAIL: [InventoryReport] Failed to load dealer roster:", error);
    return { ...empty, success: false, error: "Unable to reach the dealer registry" };
  }

  const wanted = (params.dealerIds ?? []).map(String).filter(Boolean);
  const selected = wanted.length ? roster.filter((d) => wanted.includes(String(d.dealer_id))) : roster;

  const results = await Promise.allSettled(selected.map((dealer) => fetchDealerReport(dealer, windowDays, includeZero)));

  const dealers: DealerStatus[] = [];
  const rows: InventoryRow[] = [];
  const stockOuts: StockOutItem[] = [];

  results.forEach((result, index) => {
    const dealer = selected[index];
    const dealerId = String(dealer.dealer_id);
    const dealerName = str(dealer.dealer_name) || `Dealer ${dealerId}`;
    if (result.status === "rejected") {
      console.error(`ERR_API_FAIL: [InventoryReport] Dealer "${dealerName}" is offline:`, result.reason);
      dealers.push({
        dealerId,
        dealerName,
        dealerCode: str(dealer.dealer_code),
        online: false,
        rowCount: 0,
        error: "Dealer backend unreachable",
        reason: "unreachable",
      });
      return;
    }
    dealers.push(result.value.status);
    rows.push(...result.value.rows);
    stockOuts.push(...result.value.stockOuts);
  });

  return { ...empty, dealers, rows, stockOuts };
}
