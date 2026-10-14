import { type CustomerMapRow, type LookupItem } from "../types";
import { resolveAdmin } from "./boundaries-service";

/**
 * Server-only aggregation for the HQ customer map.
 *
 * The main Directus holds the `dealer_list` roster; each dealer has its OWN
 * Directus instance that owns its customers. This service reads the roster,
 * fans out to every dealer in parallel with a short timeout, and returns one
 * flat, dealer-tagged customer set. A dealer that fails is reported offline in
 * `dealerStatuses` and never fails the whole request.
 */

const UPSTREAM = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
const STATIC_TOKEN = process.env.DIRECTUS_STATIC_TOKEN || "";

// Never request `password`. Project only the fields the map consumes.
const CUSTOMER_FIELDS = [
  "id",
  "customer_code",
  "customer_name",
  "store_name",
  "brgy",
  "city",
  "province",
  "store_type",
  "classification",
  "price_type",
  "payment_term",
  "isActive",
  "latitude",
  "longitude",
  "location",
].join(",");

const DEALER_LIST_FIELDS =
  "dealer_id,dealer_name,dealer_code,directus,directus_token,springboot,status,is_default";

/**
 * Roster request budget. The roster is a small row set on main Directus, so it
 * stays tight: a dead registry must not hold the whole map open.
 */
const ROSTER_TIMEOUT_MS = 6000;
/**
 * Per-dealer customer budget. Men2 Dealer Marikina serves ~14.6k customers
 * (~4.9 MB) and measures 2.2-4.0 s from here and longer from other networks;
 * the previous shared 6 s budget reported it as falsely "offline". Only the
 * customer request gets this room — the catalog lookups keep the tight budget
 * below.
 */
const CUSTOMER_TIMEOUT_MS = 30000;
/** Catalog lookups are tiny; a slow one degrades to empty labels. */
const LOOKUP_TIMEOUT_MS = 6000;
const DEALER_LIST_TTL_MS = 5 * 60 * 1000;
/** A 4.9 MB per-dealer pull must not repeat on every refresh or dealer switch. */
const CUSTOMER_CACHE_TTL_MS = 3 * 60 * 1000;

interface DealerRow {
  dealer_id: number | string;
  dealer_name?: string;
  dealer_code?: string;
  directus?: string;
  directus_token?: string;
  springboot?: string;
  status?: string | number;
  is_default?: boolean | number | string;
}

interface RawCustomer {
  id?: number | string;
  customer_code?: string | null;
  customer_name?: string | null;
  store_name?: string | null;
  brgy?: string | null;
  city?: string | null;
  province?: string | null;
  store_type?: number | string | null;
  classification?: number | string | null;
  price_type?: string | number | null;
  payment_term?: string | number | null;
  isActive?: number | string | boolean | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  location?:
    | { type?: string; coordinates?: number[] }
    | string
    | null;
}

interface StoreTypeRecord {
  id?: number | string;
  store_type?: string | null;
}

interface ClassificationRecord {
  id?: number | string;
  classification_name?: string | null;
}

/** Coerces any Directus scalar to a finite integer (booleans map to 1/0). */
function toInt(value: unknown): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Coerces any Directus scalar to a trimmed string. */
function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Defensive unwrap of the Directus `{ data: [...] }` envelope. */
function extractData<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

/**
 * Resolves a customer's coordinates from the populated `location` GeoJSON point
 * (`coordinates` are LONGITUDE-first), falling back to the lat/lng decimals
 * only when `location` is null but both decimals exist.
 * @param {RawCustomer} row - Raw customer record.
 * @returns {{ lat: number; lng: number } | null} Coordinates, or null when absent/invalid.
 */
function resolveCoordinates(row: RawCustomer): { lat: number; lng: number } | null {
  let lng: number | null = null;
  let lat: number | null = null;

  const parsePoint = (point: { coordinates?: number[] } | null): void => {
    const coords = point?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return;
    const cLng = Number(coords[0]);
    const cLat = Number(coords[1]);
    if (Number.isFinite(cLng) && Number.isFinite(cLat)) {
      lng = cLng;
      lat = cLat;
    }
  };

  if (row.location && typeof row.location === "object") {
    parsePoint(row.location);
  } else if (typeof row.location === "string" && row.location.trim()) {
    try {
      parsePoint(JSON.parse(row.location) as { coordinates?: number[] });
    } catch {
      // Non-JSON location string — ignore and fall back to decimals.
    }
  }

  if (lng === null || lat === null) {
    const hasDecimals =
      row.latitude !== null &&
      row.latitude !== undefined &&
      row.longitude !== null &&
      row.longitude !== undefined;
    if (hasDecimals) {
      const dLat = Number(row.latitude);
      const dLng = Number(row.longitude);
      // 0/0 is the "not set" sentinel in this schema, not the Gulf of Guinea.
      if (Number.isFinite(dLat) && Number.isFinite(dLng) && (dLat !== 0 || dLng !== 0)) {
        lat = dLat;
        lng = dLng;
      }
    }
  }

  if (lng === null || lat === null) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return { lat, lng };
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  const res = await fetch(url, { method: "GET", headers, cache: "no-store", signal });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 180)}` : ""}`);
  }
  return res.json();
}

// Roster changes rarely — a short cache avoids re-querying main Directus on every refresh.
const DEALER_LIST_CACHE: { data: DealerRow[] | null; expiry: number } = {
  data: null,
  expiry: 0,
};

async function getDealerList(): Promise<DealerRow[]> {
  const now = Date.now();
  if (DEALER_LIST_CACHE.data && DEALER_LIST_CACHE.expiry > now) {
    return DEALER_LIST_CACHE.data;
  }
  const payload = await fetchJson(
    `${UPSTREAM}/items/dealer_list?limit=-1&fields=${DEALER_LIST_FIELDS}`,
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${STATIC_TOKEN}`,
    },
    AbortSignal.timeout(ROSTER_TIMEOUT_MS),
  );
  const rows = extractData<DealerRow>(payload);
  DEALER_LIST_CACHE.data = rows;
  DEALER_LIST_CACHE.expiry = now + DEALER_LIST_TTL_MS;
  return rows;
}

// Per-page cache for the streaming lanes: `dealerId:page:pageSize`.
// A slow dealer's early pages must not be re-pulled when a later page lands.
const CUSTOMER_PAGE_CACHE = new Map<string, { data: CustomerPagePayload; expiry: number }>();

// Per-dealer lookup catalogs, cached separately from the pages so later pages
// (which carry no lookups) still resolve against the page-0 catalogs.
const DEALER_LOOKUP_CACHE = new Map<
  string,
  { data: { storeTypes: LookupItem[]; classifications: LookupItem[] }; expiry: number }
>();

/** Dealer identity carried on every page payload (ids collide across dealers). */
interface DealerIdentity {
  dealerId: string;
  dealerName: string;
  dealerCode: string;
}

/** Page payload before zod validation at the provider boundary. */
export interface CustomerPagePayload extends DealerIdentity {
  success: boolean;
  online: boolean;
  page: number;
  pageSize: number;
  total?: number;
  hasMore: boolean;
  customers: CustomerMapRow[];
  lookups?: { storeTypes: LookupItem[]; classifications: LookupItem[] };
  error?: string;
}

/** Default page size for the streaming lanes. Measured: `limit=1000` answers in
 * ~4.2 s on the slowest dealer while a full 14.6k-row pull takes ~117 s, so
 * 1000 rows is the first-paint sweet spot — small dealers finish in one page. */
export const CUSTOMER_PAGE_SIZE = 1000;
const CUSTOMER_PAGE_SIZE_MIN = 100;
const CUSTOMER_PAGE_SIZE_MAX = 5000;

function clampPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) return CUSTOMER_PAGE_SIZE;
  return Math.min(CUSTOMER_PAGE_SIZE_MAX, Math.max(CUSTOMER_PAGE_SIZE_MIN, Math.trunc(pageSize)));
}

function dealerIdentityOf(dealer: DealerRow): DealerIdentity {
  const dealerId = String(dealer.dealer_id);
  return {
    dealerId,
    dealerName: str(dealer.dealer_name) || `Dealer ${dealerId}`,
    dealerCode: str(dealer.dealer_code),
  };
}

/**
 * Maps raw customer rows to plotted map rows. Shared by the full aggregation
 * and the paged lanes so both paths resolve coordinates, dealer tags, and
 * lookup names identically (lookup ids are per-dealer and collide across dealers).
 * @param {RawCustomer[]} rawCustomers - Raw customer records for one dealer page.
 * @param {LookupItem[]} storeTypes - That dealer's own store-type catalog.
 * @param {LookupItem[]} classifications - That dealer's own classification catalog.
 * @param {DealerIdentity} dealer - Dealer identity tagging every row.
 * @returns {CustomerMapRow[]} Mapped rows (customers without usable coordinates dropped).
 */
function mapCustomerRows(
  rawCustomers: RawCustomer[],
  storeTypes: LookupItem[],
  classifications: LookupItem[],
  dealer: DealerIdentity,
): CustomerMapRow[] {
  // Resolve names against THIS dealer's own catalogs — ids are not global.
  const localStoreTypes = new Map(storeTypes.map((item) => [item.id, item.name]));
  const localClassifications = new Map(classifications.map((item) => [item.id, item.name]));
  const rows: CustomerMapRow[] = [];

  for (const raw of rawCustomers) {
    const coords = resolveCoordinates(raw);
    if (!coords) continue; // Drop customers with no usable coordinates.
    const id = toInt(raw.id);
    if (id <= 0) continue;
    // Raw PSGC text columns are unreliable (often empty), so geo labels are
    // derived server-side from the coordinates via the PSGC boundary index.
    // Rows with no coordinates are dropped above; resolved misses keep "".
    const admin = resolveAdmin(coords.lng, coords.lat);

    const storeTypeId =
      raw.store_type === null || raw.store_type === undefined ? null : toInt(raw.store_type);
    const classificationId =
      raw.classification === null || raw.classification === undefined
        ? null
        : toInt(raw.classification);

    rows.push({
      key: `${dealer.dealerId}:${id}`,
      dealerId: dealer.dealerId,
      dealerName: dealer.dealerName,
      dealerCode: dealer.dealerCode,
      id,
      customer_code: str(raw.customer_code),
      customer_name: str(raw.customer_name),
      store_name: str(raw.store_name),
      brgy: admin.brgy ?? "",
      city: admin.city ?? "",
      province: admin.province ?? "",
      store_type: storeTypeId,
      store_type_name: storeTypeId !== null ? localStoreTypes.get(storeTypeId) ?? "" : "",
      classification: classificationId,
      classification_name:
        classificationId !== null ? localClassifications.get(classificationId) ?? "" : "",
      price_type: str(raw.price_type),
      payment_term: str(raw.payment_term),
      isActive: toInt(raw.isActive),
      lat: coords.lat,
      lng: coords.lng,
    });
  }

  return rows;
}

/**
 * Reads filter_count for one dealer's customer collection (cheap: no rows).
 * @param {string} base - Dealer Directus base URL.
 * @param {Record<string, string>} headers - Dealer auth headers.
 * @param {AbortSignal} signal - Request budget signal.
 * @returns {Promise<number | undefined>} Total row count, or undefined on failure.
 */
async function fetchCustomerTotal(
  base: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<number | undefined> {
  try {
    const payload = await fetchJson(
      `${base}/items/customer?limit=0&meta=filter_count`,
      headers,
      signal,
    );
    const meta = (payload as { meta?: { filter_count?: unknown } } | null)?.meta;
    const total = Number(meta?.filter_count);
    return Number.isFinite(total) && total >= 0 ? Math.trunc(total) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns the HQ dealer roster from the already-cached registry list. Never
 * touches dealer instances, so the picker renders even when every dealer is down.
 * @returns {Promise<{ dealerId: string; dealerName: string; dealerCode: string }[]>} Roster entries.
 */
export async function fetchDealerRoster(): Promise<
  { dealerId: string; dealerName: string; dealerCode: string }[]
> {
  const roster = await getDealerList();
  return roster.map((dealer) => {
    const identity = dealerIdentityOf(dealer);
    return {
      dealerId: identity.dealerId,
      dealerName: identity.dealerName,
      dealerCode: identity.dealerCode,
    };
  });
}

/**
 * Fetches one page of one dealer's customers. Page 0 also resolves that
 * dealer's lookup catalogs plus a cheap `filter_count` total so the UI can
 * show progress; later pages return rows only. Pages are cached per
 * `dealerId:page:pageSize`; failures are never cached. Pages for one dealer
 * must be read sequentially — parallel Directus calls on one instance 503.
 * @param {string} dealerId - Roster dealer id to page.
 * @param {number} page - Zero-based page index.
 * @param {number} pageSize - Rows per page (clamped to 100..5000, default 1000).
 * @param {{ bypassCache?: boolean }} [options] - Skip page + lookup caches on refresh.
 * @returns {Promise<CustomerPagePayload>} Page payload with mapped rows.
 */
export async function fetchCustomerPage(
  dealerId: string,
  page: number,
  pageSize: number,
  options?: { bypassCache?: boolean },
): Promise<CustomerPagePayload> {
  const safePage = Number.isFinite(page) && page >= 0 ? Math.trunc(page) : 0;
  const safeSize = clampPageSize(pageSize);
  const bypassCache = options?.bypassCache === true;

  let roster: DealerRow[];
  try {
    roster = await getDealerList();
  } catch (error) {
    console.error("ERR_API_FAIL: [CustomerMap] Failed to load dealer roster:", error);
    return {
      success: false,
      dealerId: String(dealerId),
      dealerName: `Dealer ${String(dealerId)}`,
      dealerCode: "",
      online: false,
      page: safePage,
      pageSize: safeSize,
      hasMore: false,
      customers: [],
      error: "Unable to reach the dealer registry",
    };
  }

  const dealer = roster.find((entry) => String(entry.dealer_id) === String(dealerId));
  if (!dealer) {
    return {
      success: false,
      dealerId: String(dealerId),
      dealerName: `Dealer ${String(dealerId)}`,
      dealerCode: "",
      online: false,
      page: safePage,
      pageSize: safeSize,
      hasMore: false,
      customers: [],
      error: `Unknown dealer: ${String(dealerId)}`,
    };
  }

  const identity = dealerIdentityOf(dealer);
  const base = (dealer.directus || "").replace(/\/+$/, "");
  if (!base) {
    return {
      success: false,
      ...identity,
      online: false,
      page: safePage,
      pageSize: safeSize,
      hasMore: false,
      customers: [],
      error: "Dealer has no Directus base URL configured",
    };
  }

  const pageKey = `${identity.dealerId}:${safePage}:${safeSize}`;
  if (!bypassCache) {
    const cached = CUSTOMER_PAGE_CACHE.get(pageKey);
    if (cached && cached.expiry > Date.now()) return cached.data;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${dealer.directus_token || ""}`,
  };

  // Page 0 resolves the dealer's own catalogs (cached separately, same TTL)
  // plus a cheap total for progress; later pages return rows only.
  let storeTypes: LookupItem[] = [];
  let classifications: LookupItem[] = [];
  let lookups: CustomerPagePayload["lookups"];
  let total: number | undefined;
  if (safePage === 0) {
    const cachedLookups = !bypassCache ? DEALER_LOOKUP_CACHE.get(identity.dealerId) : undefined;
    if (cachedLookups && cachedLookups.expiry > Date.now()) {
      storeTypes = cachedLookups.data.storeTypes;
      classifications = cachedLookups.data.classifications;
    } else {
      const [storeTypeResult, classificationResult, totalResult] = await Promise.allSettled([
        fetchJson(
          `${base}/items/store_type?limit=-1&fields=id,store_type`,
          headers,
          AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        ),
        fetchJson(
          `${base}/items/customer_classification?limit=-1&fields=id,classification_name`,
          headers,
          AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        ),
        fetchCustomerTotal(base, headers, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)),
      ]);
      storeTypes = extractData<StoreTypeRecord>(
        storeTypeResult.status === "fulfilled" ? storeTypeResult.value : null,
      )
        .map((record) => ({ id: toInt(record.id), name: str(record.store_type) }))
        .filter((item) => item.id > 0 && item.name);
      classifications = extractData<ClassificationRecord>(
        classificationResult.status === "fulfilled" ? classificationResult.value : null,
      )
        .map((record) => ({ id: toInt(record.id), name: str(record.classification_name) }))
        .filter((item) => item.id > 0 && item.name);
      total =
        totalResult.status === "fulfilled" && typeof totalResult.value === "number"
          ? totalResult.value
          : undefined;
      DEALER_LOOKUP_CACHE.set(identity.dealerId, {
        data: { storeTypes, classifications },
        expiry: Date.now() + CUSTOMER_CACHE_TTL_MS,
      });
    }
    lookups = { storeTypes, classifications };
  }

  let rawCustomers: RawCustomer[];
  try {
    const payload = await fetchJson(
      `${base}/items/customer?limit=${safeSize}&offset=${safePage * safeSize}&sort=id&fields=${CUSTOMER_FIELDS}`,
      headers,
      AbortSignal.timeout(CUSTOMER_TIMEOUT_MS),
    );
    rawCustomers = extractData<RawCustomer>(payload);
  } catch (reason) {
    const timedOut =
      reason instanceof Error && (reason.name === "TimeoutError" || reason.name === "AbortError");
    console.error(`ERR_API_FAIL: [CustomerMap] Dealer "${identity.dealerName}" page failed:`, reason);
    return {
      success: false,
      ...identity,
      online: false,
      page: safePage,
      pageSize: safeSize,
      hasMore: false,
      customers: [],
      ...(lookups ? { lookups } : {}),
      error: timedOut ? "Dealer timed out responding" : "Dealer database unreachable",
    };
  }

  const customers = mapCustomerRows(rawCustomers, storeTypes, classifications, identity);
  // Paging continues while the upstream still has rows: the raw row count is
  // the signal (mapped rows may drop coordinate-less entries).
  const payload: CustomerPagePayload = {
    success: true,
    ...identity,
    online: true,
    page: safePage,
    pageSize: safeSize,
    ...(total !== undefined ? { total } : {}),
    hasMore: rawCustomers.length === safeSize,
    customers,
    ...(lookups ? { lookups } : {}),
  };
  CUSTOMER_PAGE_CACHE.set(pageKey, { data: payload, expiry: Date.now() + CUSTOMER_CACHE_TTL_MS });
  return payload;
}
