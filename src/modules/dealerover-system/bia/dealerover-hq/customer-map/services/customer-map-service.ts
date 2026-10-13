import {
  type CustomerMapResponse,
  type CustomerMapRow,
  type DealerStatus,
  type LookupItem,
} from "../types";

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

/** Per-dealer request budget — a slow dealer must not stall the whole map. */
const FETCH_TIMEOUT_MS = 6000;
const DEALER_LIST_TTL_MS = 5 * 60 * 1000;

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

interface DealerBundle {
  customers: RawCustomer[];
  storeTypes: LookupItem[];
  classifications: LookupItem[];
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
    AbortSignal.timeout(FETCH_TIMEOUT_MS),
  );
  const rows = extractData<DealerRow>(payload);
  DEALER_LIST_CACHE.data = rows;
  DEALER_LIST_CACHE.expiry = now + DEALER_LIST_TTL_MS;
  return rows;
}

/**
 * Fetches one dealer's customers plus its two lookup catalogs.
 * Lookup failures degrade to empty labels; a customer failure rejects the dealer.
 * @param {DealerRow} dealer - Roster row carrying the dealer's own Directus URL + token.
 * @returns {Promise<DealerBundle>} Raw customers and resolved lookup entries.
 */
async function fetchDealerBundle(dealer: DealerRow): Promise<DealerBundle> {
  const base = (dealer.directus || "").replace(/\/+$/, "");
  if (!base) {
    throw new Error("ERR_CONFIG: Dealer has no Directus base URL configured");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${dealer.directus_token || ""}`,
  };
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  const [customersResult, storeTypeResult, classificationResult] = await Promise.allSettled([
    fetchJson(`${base}/items/customer?limit=-1&fields=${CUSTOMER_FIELDS}`, headers, signal),
    fetchJson(`${base}/items/store_type?limit=-1&fields=id,store_type`, headers, signal),
    fetchJson(
      `${base}/items/customer_classification?limit=-1&fields=id,classification_name`,
      headers,
      signal,
    ),
  ]);

  if (customersResult.status === "rejected") {
    throw customersResult.reason instanceof Error
      ? customersResult.reason
      : new Error("ERR_API_FAIL: Dealer customer fetch failed");
  }

  const storeTypes = extractData<StoreTypeRecord>(
    storeTypeResult.status === "fulfilled" ? storeTypeResult.value : null,
  )
    .map((record) => ({
      id: toInt(record.id),
      name: str(record.store_type),
    }))
    .filter((item) => item.id > 0 && item.name);

  const classifications = extractData<ClassificationRecord>(
    classificationResult.status === "fulfilled" ? classificationResult.value : null,
  )
    .map((record) => ({
      id: toInt(record.id),
      name: str(record.classification_name),
    }))
    .filter((item) => item.id > 0 && item.name);

  return {
    customers: extractData<RawCustomer>(customersResult.value),
    storeTypes,
    classifications,
  };
}

/**
 * Aggregates every dealer's customers into a single map-ready payload.
 * @param {string} [dealerId] - Optional dealer id to scope the fetch to one dealer.
 * @returns {Promise<CustomerMapResponse>} Flat customer rows, dealer statuses, and lookups.
 */
export async function fetchCustomerMap(dealerId?: string): Promise<CustomerMapResponse> {
  const empty: CustomerMapResponse = {
    success: true,
    dealerStatuses: [],
    customers: [],
    lookups: { storeTypes: [], classifications: [] },
  };

  if (!UPSTREAM) {
    console.error("ERR_CONFIG: [CustomerMap] NEXT_PUBLIC_API_BASE_URL is not defined");
    return { ...empty, success: false, error: "Server configuration error" };
  }

  let roster: DealerRow[];
  try {
    roster = await getDealerList();
  } catch (error) {
    console.error("ERR_API_FAIL: [CustomerMap] Failed to load dealer roster:", error);
    return { ...empty, success: false, error: "Unable to reach the dealer registry" };
  }

  const selected = dealerId
    ? roster.filter((dealer) => String(dealer.dealer_id) === String(dealerId))
    : roster;

  if (dealerId && selected.length === 0) {
    return { ...empty, success: false, error: `Unknown dealer: ${dealerId}` };
  }

  const results = await Promise.allSettled(selected.map((dealer) => fetchDealerBundle(dealer)));

  const customers: CustomerMapRow[] = [];
  const dealerStatuses: DealerStatus[] = [];
  // Dedupe lookups by name: ids are per-dealer and can collide across dealers.
  const storeTypeUnion = new Map<string, LookupItem>();
  const classificationUnion = new Map<string, LookupItem>();

  results.forEach((result, index) => {
    const dealer = selected[index];
    const dealerIdStr = String(dealer.dealer_id);
    const dealerName = str(dealer.dealer_name) || `Dealer ${dealerIdStr}`;
    const dealerCode = str(dealer.dealer_code);

    if (result.status === "rejected") {
      console.error(`ERR_API_FAIL: [CustomerMap] Dealer "${dealerName}" is offline:`, result.reason);
      dealerStatuses.push({
        dealerId: dealerIdStr,
        dealerName,
        dealerCode,
        online: false,
        customerCount: 0,
        error: "Dealer database unreachable",
      });
      return;
    }

    const bundle = result.value;
    // Resolve names against THIS dealer's own catalogs — ids are not global.
    const localStoreTypes = new Map(bundle.storeTypes.map((item) => [item.id, item.name]));
    const localClassifications = new Map(
      bundle.classifications.map((item) => [item.id, item.name]),
    );
    bundle.storeTypes.forEach((item) => {
      if (!storeTypeUnion.has(item.name)) storeTypeUnion.set(item.name, item);
    });
    bundle.classifications.forEach((item) => {
      if (!classificationUnion.has(item.name)) classificationUnion.set(item.name, item);
    });

    let plotted = 0;
    for (const raw of bundle.customers) {
      const coords = resolveCoordinates(raw);
      if (!coords) continue; // Drop customers with no usable coordinates.
      const id = toInt(raw.id);
      if (id <= 0) continue;

      const storeTypeId = raw.store_type === null || raw.store_type === undefined
        ? null
        : toInt(raw.store_type);
      const classificationId =
        raw.classification === null || raw.classification === undefined
          ? null
          : toInt(raw.classification);

      customers.push({
        key: `${dealerIdStr}:${id}`,
        dealerId: dealerIdStr,
        dealerName,
        dealerCode,
        id,
        customer_code: str(raw.customer_code),
        customer_name: str(raw.customer_name),
        store_name: str(raw.store_name),
        brgy: str(raw.brgy),
        city: str(raw.city),
        province: str(raw.province),
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
      plotted += 1;
    }

    dealerStatuses.push({
      dealerId: dealerIdStr,
      dealerName,
      dealerCode,
      online: true,
      customerCount: plotted,
    });
  });

  const sortByName = (a: LookupItem, b: LookupItem) => a.name.localeCompare(b.name);

  return {
    success: true,
    dealerStatuses,
    customers,
    lookups: {
      storeTypes: Array.from(storeTypeUnion.values()).sort(sortByName),
      classifications: Array.from(classificationUnion.values()).sort(sortByName),
    },
  };
}
