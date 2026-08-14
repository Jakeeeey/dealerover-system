import { NextRequest, NextResponse } from "next/server";
import {
  aggregateMonthlyData,
  calculateSummary,
  filterSalesByCustomer,
  filterPurchasesBySupplier,
} from "@/modules/dealerover-system/bia/dealer/annual-sales/utils/annual-sales.utils";
import type { DealerOption } from "@/modules/dealerover-system/bia/dealer/annual-sales/types/annual-sales.schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
const STATIC_TOKEN = process.env.DIRECTUS_STATIC_TOKEN || "";
const DEALEROVER_USERNAME = process.env.DEALEROVER_USERNAME || "";
const DEALEROVER_PASSWORD = process.env.DEALEROVER_PASSWORD || "";

interface DirectusDealer {
  dealer_id: number | string;
  dealer_name?: string;
  springboot?: string;
}

function authHeaders() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (STATIC_TOKEN) h.Authorization = `Bearer ${STATIC_TOKEN}`;
  return h;
}

async function fetchDealersList(): Promise<DirectusDealer[]> {
  const url = `${UPSTREAM}/items/dealer_list?limit=-1`;
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch dealers: ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

/**
 * dealer_list currently has an exact duplicate row for every real dealer
 * (different dealer_id, identical name/springboot URL) — see
 * playbook-erp-dealerover-bia-frontend.md §7.1. De-duped here defensively
 * so the dropdown doesn't show every dealer twice; the underlying Directus
 * data issue itself is tracked separately and NOT fixed by this dedup.
 */
function dedupeDealers(dealers: DirectusDealer[]): DirectusDealer[] {
  const seen = new Set<string>();
  const result: DirectusDealer[] = [];
  for (const d of dealers) {
    const key = `${(d.dealer_name || "").trim().toLowerCase()}|${(d.springboot || "").trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(d);
  }
  return result;
}

async function loginToDealerSpringBoot(springbootUrl: string): Promise<string | null> {
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
      console.error(`ERR_LOGIN_FAIL: [AnnualSales-API] Login failed for ${loginUrl}: ${res.status}`);
      return null;
    }

    const json = await res.json();
    const dataObj = json && typeof json === "object" && "data" in json ? json.data : json;
    const token = dataObj?.token || dataObj?.accessToken || dataObj?.access_token || json?.token;
    return typeof token === "string" ? token : null;
  } catch (e) {
    console.error(`ERR_LOGIN_FAIL: [AnnualSales-API] Login error for ${loginUrl}:`, e);
    return null;
  }
}

function pickField(obj: Record<string, unknown>, candidates: string[]): string | number | undefined {
  for (const key of candidates) {
    const val = obj[key];
    if (val !== undefined && val !== null) return val as string | number;
  }
  return undefined;
}

function pickString(obj: Record<string, unknown>, candidates: string[]): string {
  const val = pickField(obj, candidates);
  return val !== undefined ? String(val) : "";
}

function pickNumber(obj: Record<string, unknown>, candidates: string[]): number {
  const val = pickField(obj, candidates);
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

interface NormalizedSales {
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  totalInvoiceAmount: number;
}

interface NormalizedPurchase {
  receiptNo: string;
  receiptDate: string;
  supplierName: string;
  totalReceiptAmount: number;
}

function normalizeSales(items: Record<string, unknown>[]): NormalizedSales[] {
  const uniqueInvoices = new Map<string, NormalizedSales>();
  for (const item of items) {
    const invoiceNo = pickString(item, ["invoiceNo", "invoice_no", "invoice_number"]);
    if (invoiceNo && !uniqueInvoices.has(invoiceNo)) {
      uniqueInvoices.set(invoiceNo, {
        invoiceNo,
        invoiceDate: pickString(item, ["invoiceDate", "invoice_date", "date", "transactionDate"]),
        customerName: pickString(item, ["customerName", "customer_name", "customer", "clientName"]),
        totalInvoiceAmount: pickNumber(item, ["totalInvoiceAmount", "total_invoice_amount", "amount", "totalAmount", "total"]),
      });
    }
  }
  return Array.from(uniqueInvoices.values());
}

function normalizePurchases(items: Record<string, unknown>[]): NormalizedPurchase[] {
  const uniqueReceipts = new Map<string, NormalizedPurchase>();
  for (const item of items) {
    const receiptNo = pickString(item, ["receiptNo", "receipt_no", "receipt_number", "docNo"]);
    if (receiptNo && !uniqueReceipts.has(receiptNo)) {
      uniqueReceipts.set(receiptNo, {
        receiptNo,
        receiptDate: pickString(item, ["receiptDate", "receipt_date", "date", "transactionDate"]),
        supplierName: pickString(item, ["supplierName", "supplier_name", "supplier", "vendorName"]),
        totalReceiptAmount: pickNumber(item, ["totalReceiptAmount", "total_receipt_amount", "amount", "totalAmount", "total", "totalPayable"]),
      });
    }
  }
  return Array.from(uniqueReceipts.values());
}

async function fetchWithErrorLogging(
  url: string,
  label: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; data: Record<string, unknown>[] }> {
  try {
    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      // non-JSON response
    }

    if (!res.ok) {
      const body =
        parsed && typeof parsed === "object"
          ? JSON.stringify(parsed).slice(0, 500)
          : text.slice(0, 300) || "(empty)";
      console.error(`ERR_API_FAIL: [AnnualSales-API] ${label} failed [${res.status}]: ${body}`);
      return { ok: false, data: [] };
    }

    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed as Record<string, unknown>)?.data ??
        (parsed as Record<string, unknown>)?.records ??
        (parsed as Record<string, unknown>)?.items ??
        [];
    return { ok: true, data: arr as Record<string, unknown>[] };
  } catch (err) {
    console.error(`ERR_API_FAIL: [AnnualSales-API] ${label} network error:`, err);
    return { ok: false, data: [] };
  }
}

// Dealer roster changes rarely — short cache avoids re-querying Directus on every filter tweak.
const DEALER_LIST_CACHE: { data: DirectusDealer[] | null; expiry: number } = { data: null, expiry: 0 };
const DEALER_LIST_TTL = 5 * 60 * 1000;

async function getCachedDealerList(): Promise<DirectusDealer[]> {
  const now = Date.now();
  if (DEALER_LIST_CACHE.data && DEALER_LIST_CACHE.expiry > now) {
    return DEALER_LIST_CACHE.data;
  }
  const raw = await fetchDealersList();
  const deduped = dedupeDealers(raw);
  DEALER_LIST_CACHE.data = deduped;
  DEALER_LIST_CACHE.expiry = now + DEALER_LIST_TTL;
  return deduped;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dealerId = searchParams.get("dealerId") ?? "";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const customerName = searchParams.get("customerName") ?? "";
  const supplierName = searchParams.get("supplierName") ?? "";

  if (!UPSTREAM) {
    console.error("ERR_CONFIG: [AnnualSales-API] NEXT_PUBLIC_API_BASE_URL is not defined");
    return NextResponse.json({ ok: false, error: "Server Configuration Error" }, { status: 500 });
  }

  try {
    const dealerRows = await getCachedDealerList();
    const dealers: DealerOption[] = dealerRows.map((d) => ({
      dealerId: d.dealer_id,
      dealerName: d.dealer_name || `Dealer ${d.dealer_id}`,
    }));

    const emptyResponse = {
      summary: { totalSales: 0, totalPurchases: 0, netVariance: 0, biasPercentage: 0 },
      monthlyData: [],
      salesTransactions: [],
      purchaseTransactions: [],
      customers: [],
      suppliers: [],
      dealers,
      ok: true,
    };

    // No dealer selected yet — return the dealer list only, skip the Spring Boot calls entirely.
    if (!dealerId) {
      return NextResponse.json(emptyResponse);
    }

    const dealer = dealerRows.find((d) => String(d.dealer_id) === dealerId);
    if (!dealer || !dealer.springboot) {
      return NextResponse.json(
        { ...emptyResponse, ok: false, error: "Unknown or misconfigured dealer" },
        { status: 404 },
      );
    }

    const token = await loginToDealerSpringBoot(dealer.springboot);
    if (!token) {
      return NextResponse.json(
        { ...emptyResponse, ok: false, error: "Failed to authenticate against this dealer's backend" },
        { status: 502 },
      );
    }

    const baseUrl = dealer.springboot.replace(/\/+$/, "");
    const salesUrl = new URL(`${baseUrl}/api/view-sales-report-itemized/filtered`);
    const purchaseUrl = new URL(`${baseUrl}/api/view-accounts-payable/all`);

    if (dateFrom) {
      salesUrl.searchParams.set("startDate", dateFrom);
      purchaseUrl.searchParams.set("startDate", dateFrom);
    }
    if (dateTo) {
      salesUrl.searchParams.set("endDate", dateTo);
      purchaseUrl.searchParams.set("endDate", dateTo);
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    const [salesResult, purchaseResult] = await Promise.all([
      fetchWithErrorLogging(salesUrl.toString(), "Sales API", headers),
      fetchWithErrorLogging(purchaseUrl.toString(), "Purchase API", headers),
    ]);

    const salesTransactions = normalizeSales(salesResult.data);
    const purchaseTransactions = normalizePurchases(purchaseResult.data);

    const customers = [
      ...new Set(salesTransactions.map((s) => s.customerName).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));

    const suppliers = [
      ...new Set(purchaseTransactions.map((s) => s.supplierName).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));

    const filteredSales = filterSalesByCustomer(salesTransactions, customerName);
    const filteredPurchases = filterPurchasesBySupplier(purchaseTransactions, supplierName);

    const monthlyData = aggregateMonthlyData(filteredSales, filteredPurchases);
    const summary = calculateSummary(monthlyData);

    return NextResponse.json({
      summary,
      monthlyData,
      salesTransactions: filteredSales,
      purchaseTransactions: filteredPurchases,
      customers,
      suppliers,
      dealers,
      ok: true,
    });
  } catch (error) {
    console.error("ERR_INTERNAL_FAIL: [AnnualSales-API] Fatal Error:", error);
    return NextResponse.json({ ok: false, error: "INTERNAL_FAIL: Gateway Error" }, { status: 502 });
  }
}
