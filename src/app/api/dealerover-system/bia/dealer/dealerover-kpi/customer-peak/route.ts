import { NextRequest, NextResponse } from "next/server";
import { VSalesPerformanceDataDto } from "@/modules/dealerover-system/bia/dealer/dealerover-kpi/types";
import { dealeroverCache } from "@/modules/dealerover-system/bia/dealer/dealerover-kpi/utils/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Dealer {
  dealer_id: number | string;
  dealer_name?: string;
  springboot?: string;
  directus?: string;
  directus_token?: string;
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

async function fetchDealerSalesData(springbootUrl: string, token: string, startDate: string, endDate: string) {
    const cleanBase = springbootUrl.replace(/\/+$/, "");
    const params = new URLSearchParams({ startDate, endDate });

    const url = `${cleanBase}/api/view-sales-performance/all?${params.toString()}`;

    try {
        const res = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            cache: "no-store"
        });

        if (!res.ok) {
            console.error(`Failed to fetch sales performance from ${url}: ${res.status}`);
            return [];
        }

        const data = await res.json();
        return Array.isArray(data) ? data : (data.data || []);
    } catch (e) {
        console.error(`Sales fetch error for ${url}:`, e);
        return [];
    }
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const names = searchParams.get("names")?.split("|") || [];
        const namespacedSalesmanIds = searchParams.get("ids")?.split(",").map(Number) || [];
        const viewType = searchParams.get("viewType") || "customer";
        const storeTypeFilter = searchParams.get("storeType");

        if (namespacedSalesmanIds.length === 0) {
            return NextResponse.json({ error: "ids is required" }, { status: 400 });
        }

        const cacheKey = `dealerover_customer_peak_${namespacedSalesmanIds.join(',')}_${viewType}_${storeTypeFilter || ''}_${names.join(',')}`;
        const cachedData = dealeroverCache.get(cacheKey);
        if (cachedData) {
            return NextResponse.json(cachedData);
        }

        const namespacedId = namespacedSalesmanIds[0];
        const dealerId = Math.floor(namespacedId / 10000);
        const localSalesmanId = namespacedId % 10000;

        const dealers = await fetchDealersList();
        const dealer = dealers.find((d) => Number(d.dealer_id) === dealerId);

        if (!dealer || !dealer.springboot) {
            return NextResponse.json({});
        }

        const token = await loginToDealerSpringBoot(dealer.springboot);
        if (!token) {
            return NextResponse.json({ error: "Failed to authenticate with dealer Spring Boot" }, { status: 500 });
        }

        const allTimeStartDate = "2000-01-01";
        const today = new Date().toISOString().split("T")[0];
        const allData = await fetchDealerSalesData(dealer.springboot, token, allTimeStartDate, today);

        if (!Array.isArray(allData) || allData.length === 0) {
            return NextResponse.json({});
        }

        const namesSet = names.length > 0 ? new Set(names) : null;
        const monthlyMap: Record<string, Record<string, number>> = {};
        const metadataMap: Record<string, Record<string, unknown>> = {};

        allData.forEach((item: VSalesPerformanceDataDto) => {
            // Filter by local salesman ID
            if (Number(item.salesmanId) !== localSalesmanId) return;

            let groupName = "Unknown";
            let rawCode = "";

            if (viewType === "area") {
                groupName = `${(item.province as string || "").trim()}, ${(item.city as string || "").trim()}`.replace(/^, |, $/g, "") || "Unknown Area";
                rawCode = `${(item.province as string || "").trim()}::${(item.city as string || "").trim()}`;
            } else if (viewType === "storeType") {
                groupName = (item.storeTypeLabel || "OTHERS").trim();
                rawCode = groupName;
            } else {
                rawCode = (item.customerCode || item.storeName || "Unknown").trim();
                groupName = (item.storeName || "Unknown Customer").trim();
            }

            if (namesSet && !namesSet.has(groupName)) return;

            const itemStoreType = (item.storeTypeLabel || "OTHERS").trim();
            if (storeTypeFilter) {
                const filterNorm = storeTypeFilter.trim().toLowerCase();
                const itemNorm = itemStoreType.toLowerCase();
                if (itemNorm !== filterNorm) {
                    return;
                }
            }

            const dateStr = item.transactionDate;
            if (!dateStr) return;

            const monthKey = dateStr.substring(0, 7);
            const groupKey = rawCode;

            if (!monthlyMap[groupKey]) {
                monthlyMap[groupKey] = {};
                metadataMap[groupKey] = {
                    name: groupName,
                    customerCode: groupKey,
                    storeTypeLabel: itemStoreType,
                    sId: namespacedId,
                    supId: Number(item.supplierId),
                    province: item.province,
                    city: item.city,
                    peakMonth: "",
                    peakMonthAmt: -1
                };
            }

            monthlyMap[groupKey][monthKey] = (monthlyMap[groupKey][monthKey] || 0) + (item.netAmount || 0);

            const currentMonthAmt = monthlyMap[groupKey][monthKey];
            const meta = metadataMap[groupKey] as {
                name: string;
                peakMonthAmt: number;
                peakMonth: string;
                customerCode: string;
                storeTypeLabel: string;
                sId: number;
                supId: number;
                province?: string;
                city?: string;
            };

            if (currentMonthAmt > meta.peakMonthAmt) {
                meta.peakMonthAmt = currentMonthAmt;
                meta.peakMonth = monthKey;
                meta.name = groupName;
            }
        });

        const finalMap: Record<string, { total: number; peak: number; metadata: Record<string, unknown> }> = {};

        Object.entries(monthlyMap).forEach(([groupKey, months]) => {
            const monthlyTotals = Object.values(months);
            const peak = monthlyTotals.length > 0 ? Math.max(...monthlyTotals) : 0;
            const meta = metadataMap[groupKey];
            const displayName = (meta.name as string) || groupKey;

            finalMap[displayName] = {
                total: monthlyTotals.reduce((a, b) => a + b, 0),
                peak: peak,
                metadata: meta
            };
        });

        dealeroverCache.set(cacheKey, finalMap);
        return NextResponse.json(finalMap);

    } catch (error) {
        const err = error as Error;
        console.error("[Customer Peak API Error]:", err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
