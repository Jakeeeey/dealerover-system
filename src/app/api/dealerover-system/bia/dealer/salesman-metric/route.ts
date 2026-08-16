import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Dealer {
  dealer_id: number | string;
  dealer_name?: string;
  springboot?: string;
  directus?: string;
  directus_token?: string;
}

interface SalesPerformanceItem {
  divisionId?: number;
  salesmanId?: number;
  salesmanCode?: string;
  supplierId?: number;
  divisionName?: string;
  salesmanName?: string;
  supplierName?: string;
  transactionDate?: string;
  fiscalPeriod?: string;
  customerCode?: string;
  province?: string;
  city?: string;
  storeTypeLabel?: string;
  storeName?: string;
  netAmount?: number;
}

interface FrequencyReportItem {
  salesmanId?: number;
  salesmanCode?: string;
  salesmanName?: string;
  customerCode?: string;
  storeName?: string;
  province?: string;
  city?: string;
  fiscalPeriod?: string;
  transactionDate?: string;
  invoiceNo?: string;
  netAmount?: number;
}

interface NewAccountItem {
  salesmanId?: number;
  salesmanCode?: string;
  salesmanName?: string;
  customerId?: number;
  customerCode?: string;
  customerName?: string;
  storeName?: string;
  province?: string;
  city?: string;
  dateEntered?: string;
  fiscalPeriod?: string;
}

interface ProductiveOutletTarget {
  salesmanId?: number;
  targetMonth?: number;
  targetYear?: number;
  targetProductiveOutlets?: number;
  actualProductiveOutlets?: number;
  achievementPercentage?: number;
  goalStatus?: string;
}

interface LineSalesTarget {
  invoiceNumber?: string;
  salesmanId?: number;
  targetMonth?: number;
  targetYear?: number;
  targetProductsPerReceipt?: number;
  targetReceiptCount?: number;
  actualQualifiedReceipts?: number;
  achievementPercentage?: number;
  goalStatus?: string;
}

interface BasketCountTarget {
  invoiceNumber?: string;
  salesmanId?: number;
  targetMonth?: number;
  targetYear?: number;
  targetAmountPerReceipt?: number;
  targetReceiptCount?: number;
  actualQualifiedReceipts?: number;
  achievementPercentage?: number;
  goalStatus?: string;
}

interface TacticalSkuTarget {
  salesmanId?: number;
  targetMonth?: number;
  targetYear?: number;
  productId?: number;
  targetQuantity?: number;
  actualQuantity?: number;
  quantityAchievementPercentage?: number;
  quantityGoalStatus?: string;
  targetValue?: number;
  actualValue?: number;
  valueAchievementPercentage?: number;
  valueGoalStatus?: string;
}

interface ReachCustomer {
  customerCode?: string;
  customerName?: string;
  dateEntered?: string;
}

interface ReachFilterItem {
  salesmanId?: number;
  salesmanCode?: string;
  salesmanName?: string;
  totalReach?: number;
  customers?: ReachCustomer[];
}

const UPSTREAM = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
const STATIC_TOKEN = process.env.DIRECTUS_STATIC_TOKEN || "";
const DEALEROVER_USERNAME = process.env.DEALEROVER_USERNAME || "";
const DEALEROVER_PASSWORD = process.env.DEALEROVER_PASSWORD || "";

function authHeaders() {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (STATIC_TOKEN) h.Authorization = `Bearer ${STATIC_TOKEN}`;
  return h;
}

async function fetchDealersList(): Promise<Dealer[]> {
  const url = `${UPSTREAM}/items/dealer_list?limit=-1`;
  const res = await fetch(url, {
    headers: authHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch dealers: ${res.status}`);
  }

  const json = await res.json();
  return json.data || [];
}

async function loginToDealerSpringBoot(springbootUrl: string): Promise<string | null> {
  const cleanBase = springbootUrl.replace(/\/+$/, "");
  const loginUrl = `${cleanBase}/auth/login`;

  const payload = {
    email: DEALEROVER_USERNAME,
    hashPassword: DEALEROVER_PASSWORD,
    rememberMe: false,
    latitude: "",
    longitude: ""
  };

  try {
    const res = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    if (!res.ok) {
      console.error(`Login failed for ${loginUrl}: ${res.status}`);
      return null;
    }

    const json = await res.json();
    const dataObj = json && typeof json === "object" && "data" in json ? json.data : json;
    const token = dataObj?.token || dataObj?.accessToken || dataObj?.access_token || json?.token;
    return typeof token === "string" ? token : null;
  } catch (e) {
    console.error(`Login error for ${loginUrl}:`, e);
    return null;
  }
}

function json(res: unknown, init?: ResponseInit) {
  return NextResponse.json(res, init);
}

const requestCache = new Map<string, { data: unknown; expiry: number }>();

function getCachedData<T>(key: string): T | null {
  const cached = requestCache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return cached.data as T;
  }
  return null;
}

function setCachedData<T>(key: string, data: T, ttlMs: number = 60000) {
  requestCache.set(key, { data, expiry: Date.now() + ttlMs });
}

async function safeFetch<T>(
  url: string, 
  defaultValue: T, 
  token?: string,
  cacheKey?: string,
  ttlMs: number = 60000
): Promise<T> {
  if (cacheKey) {
    const cached = getCachedData<T>(cacheKey);
    if (cached) return cached;
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      cache: "no-store"
    });
    if (!res.ok) return defaultValue;
    const data = await res.json() as T;

    if (cacheKey) {
      setCachedData(cacheKey, data, ttlMs);
    }
    
    return data;
  } catch (err) {
    console.error(`Error fetching from ${url}:`, err);
    return defaultValue;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = (sp.get("mode") || "report").toLowerCase();

  if (mode === "dealers") {
    try {
      const dealers = await fetchDealersList();
      const mapped = dealers.map(d => ({
        id: Number(d.dealer_id),
        name: d.dealer_name || `Dealer #${d.dealer_id}`
      }));
      return json({ success: true, data: mapped });
    } catch (err) {
      console.error("Failed to fetch dealers list:", err);
      return json({ success: false, error: "Failed to fetch dealers list" }, { status: 500 });
    }
  }


  // ==========================================
  // RESOLVE SELECTIVE DEALER CREDENTIALS & BACKEND API URL
  // ==========================================
  const dealerIdParam = sp.get("dealerId");
  if (!dealerIdParam) {
    return json({ success: false, error: "dealerId is required" }, { status: 400 });
  }

  const dealerId = Number(dealerIdParam);
  let dealers: Dealer[] = [];
  try {
    dealers = await fetchDealersList();
  } catch (err) {
    console.error("Failed to fetch dealers during operation:", err);
    return json({ success: false, error: "Failed to fetch dealers database" }, { status: 500 });
  }

  const dealer = dealers.find((d) => Number(d.dealer_id) === dealerId);
  if (!dealer || !dealer.springboot) {
    return json({ success: false, error: `Configured backend url not found for Dealer ID ${dealerId}` }, { status: 404 });
  }

  const springbootToken = await loginToDealerSpringBoot(dealer.springboot);
  if (!springbootToken) {
    return json({ success: false, error: "Authentication failed on Dealer's Spring Boot server" }, { status: 401 });
  }

  const activeApiBase = dealer.springboot.replace(/\/+$/, "");

  // ==========================================
  // MODE: LOOKUPS
  // ==========================================
  if (mode === "lookups") {
    const startDate = sp.get("startDate") || "2025-01-01";
    const endDate = sp.get("endDate") || "2026-12-31";

    const cacheKey = `lookups_${dealerId}_${startDate}_${endDate}`;
    const allSalesData = await safeFetch<SalesPerformanceItem[] | null>(
      `${activeApiBase}/api/view-sales-performance/all?startDate=${startDate}&endDate=${endDate}`,
      null,
      springbootToken,
      cacheKey,
      300000 // Cache for 5 minutes
    );

    if (!allSalesData || !Array.isArray(allSalesData)) {
      return json({ success: true, data: [] });
    }

    // Extract unique salesmen
    const map = new Map<number, { salesmanId: number; salesmanCode: string; salesmanName: string }>();
    for (const item of allSalesData) {
      const id = Number(item?.salesmanId);
      if (!id) continue;
      if (!map.has(id)) {
        map.set(id, {
          salesmanId: id,
          salesmanCode: String(item?.salesmanCode || ""),
          salesmanName: String(item?.salesmanName || `Salesman #${id}`),
        });
      }
    }

    const salesmenList = Array.from(map.values()).sort((a, b) =>
      a.salesmanName.localeCompare(b.salesmanName)
    );

    return json({ success: true, data: salesmenList });
  }

  // ==========================================
  // MODE: REACH BREAKDOWN
  // ==========================================
  if (mode === "reach-breakdown") {
    const salesmanIdParam = sp.get("salesmanId");
    const startDate = sp.get("startDate") || "2025-01-01";

    if (!salesmanIdParam) {
      return json({ success: false, error: "salesmanId is required" }, { status: 400 });
    }

    const dateParts = startDate.split("-");
    const targetYear = dateParts[0] ? Number(dateParts[0]) : 2026;
    const targetMonth = dateParts[1] ? Number(dateParts[1]) : 3;

    const salesmanId = Number(salesmanIdParam);
    const reachUrl = `${activeApiBase}/api/view-salesman-reach/filter-by-date?month=${targetMonth}&year=${targetYear}`;
    const allReachData = await safeFetch<ReachFilterItem[] | null>(reachUrl, null, springbootToken);
    const reachData = Array.isArray(allReachData) ? allReachData.find(r => r.salesmanId === salesmanId) : null;
    
    if (!reachData || !reachData.customers) {
      return json({ success: true, totalReach: 0, customers: [] });
    }

    return json({ 
      success: true, 
      totalReach: reachData.totalReach || 0,
      customers: reachData.customers
    });
  }

  // ==========================================
  // MODE: SUPPLIER BREAKDOWN
  // ==========================================
  if (mode === "supplier-breakdown") {
    const salesmanIdParam = sp.get("salesmanId");
    const startDate = sp.get("startDate") || "2025-01-01";
    const endDate = sp.get("endDate") || "2026-12-31";

    if (!salesmanIdParam) {
      return json({ success: false, error: "salesmanId is required" }, { status: 400 });
    }

    const salesmanId = Number(salesmanIdParam);

    const cacheKey = `supplier_${dealerId}_${startDate}_${endDate}`;
    const allSalesData = await safeFetch<SalesPerformanceItem[] | null>(
      `${activeApiBase}/api/view-sales-performance/all?startDate=${startDate}&endDate=${endDate}`, 
      null, 
      springbootToken,
      cacheKey,
      300000 // Cache for 5 minutes
    );
    if (!allSalesData || !Array.isArray(allSalesData)) {
      return json({ success: true, totalSales: 0, data: [] });
    }

    // Filter by salesman and date
    const filtered = allSalesData.filter((x) => {
      const matchedSalesman = Number(x.salesmanId) === salesmanId;
      if (!matchedSalesman) return false;
      if (!x.transactionDate) return false;
      return x.transactionDate >= startDate && x.transactionDate <= endDate;
    });

    // Group by supplier
    const groupMap = new Map<number, { supplierId: number; supplierName: string; netAmount: number }>();
    let totalSales = 0;

    for (const item of filtered) {
      const supId = Number(item.supplierId) || 0;
      const supName = item.supplierName || "Other / Unknown Supplier";
      const amt = Number(item.netAmount) || 0;

      totalSales += amt;

      const existing = groupMap.get(supId);
      if (existing) {
        existing.netAmount += amt;
      } else {
        groupMap.set(supId, {
          supplierId: supId,
          supplierName: supName,
          netAmount: amt,
        });
      }
    }

    const breakdown = Array.from(groupMap.values())
      .map(item => ({
        ...item,
        percentage: totalSales > 0 ? (item.netAmount / totalSales) * 100 : 0
      }))
      .sort((a, b) => b.netAmount - a.netAmount);

    return json({ success: true, totalSales, data: breakdown });
  }

  // ==========================================
  // MODE: FREQUENCY DETAIL
  // ==========================================
  if (mode === "frequency-detail") {
    const salesmanIdParam = sp.get("salesmanId");
    const salesmanCodeParam = sp.get("salesmanCode") || "";
    const startDate = sp.get("startDate") || "2025-01-01";
    const endDate = sp.get("endDate") || "2026-12-31";

    if (!salesmanIdParam) {
      return json({ success: false, error: "salesmanId is required" }, { status: 400 });
    }

    const salesmanId = Number(salesmanIdParam);
    const code = encodeURIComponent(salesmanCodeParam);

    const freqUrl = `${activeApiBase}/api/view-salesman-frequency-report/filter?startDate=${startDate}&endDate=${endDate}&salesmanId=${salesmanId}&salesmanCode=${code}`;
    const freqData = await safeFetch<FrequencyReportItem[]>(freqUrl, [], springbootToken);

    const filtered = freqData.filter((x) => {
      const matchedSalesman = Number(x.salesmanId) === salesmanId;
      if (!matchedSalesman) return false;

      const date = x.transactionDate || x.fiscalPeriod;
      if (date) {
        return date >= startDate && date <= endDate;
      }
      return true;
    });

    return json({ success: true, data: filtered });
  }

  // ==========================================
  // MODE: NEW ACCOUNTS DETAIL
  // ==========================================
  if (mode === "new-accounts-detail") {
    const salesmanIdParam = sp.get("salesmanId");
    const salesmanCodeParam = sp.get("salesmanCode") || "";
    const startDate = sp.get("startDate") || "2025-01-01";
    const endDate = sp.get("endDate") || "2026-12-31";

    if (!salesmanIdParam) {
      return json({ success: false, error: "salesmanId is required" }, { status: 400 });
    }

    const salesmanId = Number(salesmanIdParam);
    const code = encodeURIComponent(salesmanCodeParam);

    const newAccUrl = `${activeApiBase}/api/v-salesman-new-account/filter?startDate=${startDate}&endDate=${endDate}&salesmanId=${salesmanId}&salesmanCode=${code}`;
    const newAccData = await safeFetch<NewAccountItem[]>(newAccUrl, [], springbootToken);

    const filtered = newAccData.filter((x) => {
      const matchedSalesman = Number(x.salesmanId) === salesmanId;
      if (!matchedSalesman) return false;

      const date = x.dateEntered || x.fiscalPeriod;
      if (date) {
        return date >= startDate && date <= endDate;
      }
      return true;
    });

    return json({ success: true, data: filtered });
  }

  // ==========================================
  // MODE: PRODUCTIVE OUTLET DETAIL
  // ==========================================
  if (mode === "productive-outlet-detail") {
    const salesmanIdParam = sp.get("salesmanId");
    const targetMonthParam = sp.get("targetMonth");
    const targetYearParam = sp.get("targetYear");

    if (!salesmanIdParam || !targetMonthParam || !targetYearParam) {
      return json({ success: false, error: "salesmanId, targetMonth, and targetYear are required" }, { status: 400 });
    }

    const salesmanId = Number(salesmanIdParam);
    const targetMonth = Number(targetMonthParam);
    const targetYear = Number(targetYearParam);

    const url = `${activeApiBase}/api/salesman-productive-outlet-target?salesmanId=${salesmanId}&targetMonth=${targetMonth}&targetYear=${targetYear}`;
    const data = await safeFetch<ProductiveOutletTarget[]>(url, [], springbootToken);

    return json({ success: true, data });
  }

  // ==========================================
  // MODE: BASKET COUNT DETAIL
  // ==========================================
  if (mode === "basket-count-detail") {
    const salesmanIdParam = sp.get("salesmanId");
    const targetMonthParam = sp.get("targetMonth");
    const targetYearParam = sp.get("targetYear");

    if (!salesmanIdParam || !targetMonthParam || !targetYearParam) {
      return json({ success: false, error: "salesmanId, targetMonth, and targetYear are required" }, { status: 400 });
    }

    const salesmanId = Number(salesmanIdParam);
    const targetMonth = Number(targetMonthParam);
    const targetYear = Number(targetYearParam);

    const url = `${activeApiBase}/api/salesman-basket-count-target-set?salesmanId=${salesmanId}&targetMonth=${targetMonth}&targetYear=${targetYear}`;
    const data = await safeFetch<BasketCountTarget[]>(url, [], springbootToken);

    return json({ success: true, data });
  }

  // ==========================================
  // MODE: LINE SALES DETAIL
  // ==========================================
  if (mode === "line-sales-detail") {
    const salesmanIdParam = sp.get("salesmanId");
    const targetMonthParam = sp.get("targetMonth");
    const targetYearParam = sp.get("targetYear");

    if (!salesmanIdParam || !targetMonthParam || !targetYearParam) {
      return json({ success: false, error: "salesmanId, targetMonth, and targetYear are required" }, { status: 400 });
    }

    const salesmanId = Number(salesmanIdParam);
    const targetMonth = Number(targetMonthParam);
    const targetYear = Number(targetYearParam);

    const url = `${activeApiBase}/api/salesman-line-sales-target-setting?salesmanId=${salesmanId}&targetMonth=${targetMonth}&targetYear=${targetYear}`;
    const data = await safeFetch<LineSalesTarget[]>(url, [], springbootToken);

    return json({ success: true, data });
  }

  // ==========================================
  // MODE: TACTICAL SKU DETAIL
  // ==========================================
  if (mode === "tactical-sku-detail") {
    const salesmanIdParam = sp.get("salesmanId");
    const targetMonthParam = sp.get("targetMonth");
    const targetYearParam = sp.get("targetYear");

    if (!salesmanIdParam || !targetMonthParam || !targetYearParam) {
      return json({ success: false, error: "salesmanId, targetMonth, and targetYear are required" }, { status: 400 });
    }

    const salesmanId = Number(salesmanIdParam);
    const targetMonth = Number(targetMonthParam);
    const targetYear = Number(targetYearParam);

    const url = `${activeApiBase}/api/salesman-tactical-sku-target-setting?salesmanId=${salesmanId}&targetMonth=${targetMonth}&targetYear=${targetYear}`;
    const data = await safeFetch<TacticalSkuTarget[]>(url, [], springbootToken);

    return json({ success: true, data });
  }

  // ==========================================
  // MODE: REPORT
  // ==========================================
  const salesmanIdParam = sp.get("salesmanId");
  const salesmanCodeParam = sp.get("salesmanCode") || "";
  const startDate = sp.get("startDate") || "2025-01-01";
  const endDate = sp.get("endDate") || "2026-12-31";

  // Parse Target Month & Year from startDate (or default)
  const dateParts = startDate.split("-");
  const targetYear = dateParts[0] ? Number(dateParts[0]) : 2026;
  const targetMonth = dateParts[1] ? Number(dateParts[1]) : 3;

  // 1. Fetch sales performance list to identify salesmen we need to report on
  const salesCacheKey = `report_sales_${dealerId}_${startDate}_${endDate}`;
  const allSalesData = await safeFetch<SalesPerformanceItem[] | null>(
    `${activeApiBase}/api/view-sales-performance/all?startDate=${startDate}&endDate=${endDate}`,
    null,
    springbootToken,
    salesCacheKey,
    300000 // Cache for 5 minutes
  );
  if (!allSalesData || !Array.isArray(allSalesData)) {
    return json({ success: true, data: [] });
  }

  // Determine target salesmen
  let targetSalesmen: Array<{ salesmanId: number; salesmanCode: string; salesmanName: string }> = [];

  if (salesmanIdParam && salesmanIdParam !== "all") {
    const targetId = Number(salesmanIdParam);
    const matched = allSalesData.find((x) => Number(x.salesmanId) === targetId);
    if (matched) {
      targetSalesmen = [{
        salesmanId: targetId,
        salesmanCode: matched.salesmanCode || salesmanCodeParam,
        salesmanName: matched.salesmanName || "Salesman",
      }];
    } else {
      // Fallback
      targetSalesmen = [{
        salesmanId: targetId,
        salesmanCode: salesmanCodeParam || "CODE",
        salesmanName: "Salesman",
      }];
    }
  } else {
    // Unique list of all salesmen
    const map = new Map<number, { salesmanId: number; salesmanCode: string; salesmanName: string }>();
    for (const item of allSalesData) {
      const id = Number(item.salesmanId);
      if (!id) continue;
      if (!map.has(id)) {
        map.set(id, {
          salesmanId: id,
          salesmanCode: String(item.salesmanCode || ""),
          salesmanName: String(item.salesmanName || ""),
        });
      }
    }
    targetSalesmen = Array.from(map.values());
  }

  // Fetch all reach data for the target month and year
  const reachCacheKey = `report_reach_${dealerId}_${targetMonth}_${targetYear}`;
  const allReachData = await safeFetch<ReachFilterItem[] | null>(
    `${activeApiBase}/api/view-salesman-reach/filter-by-date?month=${targetMonth}&year=${targetYear}`, 
    null, 
    springbootToken,
    reachCacheKey,
    300000 // Cache for 5 minutes
  );

  // For each target salesman, fetch their metrics in chunks
  const rows: Record<string, unknown>[] = [];
  const chunkSize = 5;

  for (let i = 0; i < targetSalesmen.length; i += chunkSize) {
    const chunk = targetSalesmen.slice(i, i + chunkSize);
    const chunkRows = await Promise.all(
      chunk.map(async (sm) => {
        const id = sm.salesmanId;
        const code = encodeURIComponent(sm.salesmanCode);

        const freqUrl = `${activeApiBase}/api/view-salesman-frequency-report/filter?startDate=${startDate}&endDate=${endDate}&salesmanId=${id}&salesmanCode=${code}`;
        const newAccUrl = `${activeApiBase}/api/v-salesman-new-account/filter?startDate=${startDate}&endDate=${endDate}&salesmanId=${id}&salesmanCode=${code}`;
        const productiveOutletUrl = `${activeApiBase}/api/salesman-productive-outlet-target?salesmanId=${id}&targetMonth=${targetMonth}&targetYear=${targetYear}`;
        const lineSalesUrl = `${activeApiBase}/api/salesman-line-sales-target-setting?salesmanId=${id}&targetMonth=${targetMonth}&targetYear=${targetYear}`;
        const basketCountUrl = `${activeApiBase}/api/salesman-basket-count-target-set?salesmanId=${id}&targetMonth=${targetMonth}&targetYear=${targetYear}`;
        const tacticalSkuUrl = `${activeApiBase}/api/salesman-tactical-sku-target-setting?salesmanId=${id}&targetMonth=${targetMonth}&targetYear=${targetYear}`;

        // Fetch in parallel for this salesman
        const [freqData, newAccData, productiveOutlet, lineSales, basketCount, tacticalSku] = await Promise.all([
          safeFetch<FrequencyReportItem[]>(freqUrl, [], springbootToken),
          safeFetch<NewAccountItem[]>(newAccUrl, [], springbootToken),
          safeFetch<ProductiveOutletTarget | null>(productiveOutletUrl, null, springbootToken),
          safeFetch<LineSalesTarget | null>(lineSalesUrl, null, springbootToken),
          safeFetch<BasketCountTarget | null>(basketCountUrl, null, springbootToken),
          safeFetch<TacticalSkuTarget[]>(tacticalSkuUrl, [], springbootToken),
        ]);

        const reachData = Array.isArray(allReachData) ? allReachData.find(r => r.salesmanId === id) : null;

        // Process Metric 1: Sales Performance
        const salesPerformance = allSalesData
          .filter((x) => {
            const matchedSalesman = Number(x.salesmanId) === id;
            if (!matchedSalesman) return false;
            if (!x.transactionDate) return false;
            return x.transactionDate >= startDate && x.transactionDate <= endDate;
          })
          .reduce((sum: number, x) => sum + (Number(x.netAmount) || 0), 0);

        // Process Metric 2: Reach
        const reach = reachData ? Number(reachData.totalReach ?? 0) : 0;

        // Process Metric 3: Frequency
        const filteredFreq = Array.isArray(freqData)
          ? freqData.filter((x) => {
              const date = x.transactionDate || x.fiscalPeriod;
              return date ? (date >= startDate && date <= endDate) : true;
            })
          : [];

        // Count unique customer codes (representing active outlets/customers meeting the threshold)
        const uniqueCustomers = new Set(filteredFreq.map((x) => x.customerCode).filter(Boolean));

        const freqCount = uniqueCustomers.size;
        const freqAmount = filteredFreq.reduce((sum: number, x) => sum + (Number(x.netAmount) || 0), 0);

        // Process Metric 4: New Accounts
        const filteredNewAcc = Array.isArray(newAccData)
          ? newAccData.filter((x) => {
              const date = x.dateEntered || x.fiscalPeriod;
              return date ? (date >= startDate && date <= endDate) : true;
            })
          : [];

        const newAccounts = filteredNewAcc.length;

        // Process Metric 5: Productive Outlets Target
        let productiveOutletsTarget = 0;
        let productiveOutletsActual = 0;
        let productiveOutletsAchievement = 0;
        let productiveOutletsStatus = "No Target Set";
        if (productiveOutlet) {
          productiveOutletsTarget = Number(productiveOutlet.targetProductiveOutlets ?? 0);
          productiveOutletsActual = Number(productiveOutlet.actualProductiveOutlets ?? 0);
          productiveOutletsAchievement = Number(productiveOutlet.achievementPercentage ?? 0);
          productiveOutletsStatus = String(productiveOutlet.goalStatus ?? "No Target Set");
        }

        // Process Metric 6: Line Sales Target
        let lineSalesTargetProductsPerReceipt = 0;
        let lineSalesTargetReceiptCount = 0;
        let lineSalesActualReceipts = 0;
        let lineSalesAchievement = 0;
        let lineSalesStatus = "Below Target";

        if (Array.isArray(lineSales) && lineSales.length > 0) {
          lineSalesTargetProductsPerReceipt = Number(lineSales[0].targetProductsPerReceipt ?? 0);
          lineSalesTargetReceiptCount = Number(lineSales[0].targetReceiptCount ?? 0);
          
          const validReceipts = lineSales.filter((item: LineSalesTarget) => item.invoiceNumber);
          lineSalesActualReceipts = validReceipts.length;

          if (lineSalesTargetReceiptCount > 0) {
            lineSalesAchievement = (lineSalesActualReceipts / lineSalesTargetReceiptCount) * 100;
            lineSalesStatus = lineSalesAchievement >= 100 ? "Met Target" : "Below Target";
          } else {
            lineSalesAchievement = lineSalesActualReceipts > 0 ? 100 : 0;
            lineSalesStatus = lineSalesTargetReceiptCount === 0 && lineSalesActualReceipts === 0 ? "No Target Set" : (lineSalesActualReceipts > 0 ? "Met Target" : "Below Target");
          }
        } else if (lineSales && !Array.isArray(lineSales)) {
          lineSalesTargetProductsPerReceipt = Number((lineSales as unknown as LineSalesTarget).targetProductsPerReceipt ?? 0);
          lineSalesTargetReceiptCount = Number((lineSales as unknown as LineSalesTarget).targetReceiptCount ?? 0);
          lineSalesActualReceipts = Number((lineSales as unknown as LineSalesTarget).actualQualifiedReceipts ?? 0);
          lineSalesAchievement = Number((lineSales as unknown as LineSalesTarget).achievementPercentage ?? 0);
          lineSalesStatus = String((lineSales as unknown as LineSalesTarget).goalStatus ?? "Below Target");
        }

        // Process Metric 7: Basket Count Target
        let basketCountTargetAmount = 0;
        let basketCountTargetReceiptCount = 0;
        let basketCountActualReceipts = 0;
        let basketCountAchievement = 0;
        let basketCountStatus = "Below Target";

        if (Array.isArray(basketCount) && basketCount.length > 0) {
          basketCountTargetAmount = Number(basketCount[0].targetAmountPerReceipt ?? 0);
          basketCountTargetReceiptCount = Number(basketCount[0].targetReceiptCount ?? 0);
          
          // Count receipts that actually have an invoice number and amount
          const validReceipts = basketCount.filter((item: BasketCountTarget) => item.invoiceNumber);
          basketCountActualReceipts = validReceipts.length;
          
          if (basketCountTargetReceiptCount > 0) {
            basketCountAchievement = (basketCountActualReceipts / basketCountTargetReceiptCount) * 100;
            basketCountStatus = basketCountAchievement >= 100 ? "Met Target" : "Below Target";
          } else {
            basketCountAchievement = basketCountActualReceipts > 0 ? 100 : 0;
            basketCountStatus = basketCountTargetReceiptCount === 0 && basketCountActualReceipts === 0 ? "No Target Set" : (basketCountActualReceipts > 0 ? "Met Target" : "Below Target");
          }
        } else if (basketCount && !Array.isArray(basketCount)) {
          // Fallback in case it ever returns an object again
          basketCountTargetAmount = Number((basketCount as unknown as BasketCountTarget).targetAmountPerReceipt ?? 0);
          basketCountTargetReceiptCount = Number((basketCount as unknown as BasketCountTarget).targetReceiptCount ?? 0);
          basketCountActualReceipts = Number((basketCount as unknown as BasketCountTarget).actualQualifiedReceipts ?? 0);
          basketCountAchievement = Number((basketCount as unknown as BasketCountTarget).achievementPercentage ?? 0);
          basketCountStatus = String((basketCount as unknown as BasketCountTarget).goalStatus ?? "Below Target");
        }

        // Process Metric 8: Tactical SKU Target
        let tacticalSkuTargetQty = 0;
        let tacticalSkuActualQty = 0;
        let tacticalSkuAchievement = 0;
        let tacticalSkuStatus = "No Target Set";

        tacticalSkuTargetQty = Array.isArray(tacticalSku)
          ? tacticalSku.reduce((sum, item) => sum + Number(item.targetQuantity ?? 0), 0)
          : 0;
        tacticalSkuActualQty = Array.isArray(tacticalSku)
          ? tacticalSku.reduce((sum, item) => sum + Number(item.actualQuantity ?? 0), 0)
          : 0;
        tacticalSkuAchievement = tacticalSkuTargetQty > 0
          ? (tacticalSkuActualQty / tacticalSkuTargetQty) * 100
          : (Array.isArray(tacticalSku) && tacticalSku.length > 0 ? Number(tacticalSku[0].quantityAchievementPercentage ?? 0) : 0);

        const hasBelowTarget = Array.isArray(tacticalSku) && tacticalSku.some(item => String(item.quantityGoalStatus).toLowerCase().includes("below"));
        tacticalSkuStatus = Array.isArray(tacticalSku) && tacticalSku.length > 0
          ? (hasBelowTarget ? "Below Target" : "Met Target")
          : "No Target Set";

        return {
          salesmanId: id,
          salesmanCode: sm.salesmanCode,
          salesmanName: sm.salesmanName,
          salesPerformance,
          reach,
          frequencyCount: freqCount,
          frequencyAmount: freqAmount,
          newAccounts,
          productiveOutletsTarget,
          productiveOutletsActual,
          productiveOutletsAchievement,
          productiveOutletsStatus,
          lineSalesTargetProductsPerReceipt,
          lineSalesTargetReceiptCount,
          lineSalesActualReceipts,
          lineSalesAchievement,
          lineSalesStatus,
          basketCountTargetAmount,
          basketCountTargetReceiptCount,
          basketCountActualReceipts,
          basketCountAchievement,
          basketCountStatus,
          tacticalSkuTargetQty,
          tacticalSkuActualQty,
          tacticalSkuAchievement,
          tacticalSkuStatus,
        };
      })
    );
    rows.push(...chunkRows);
  }

  return json({
    success: true,
    data: rows,
  });
}
