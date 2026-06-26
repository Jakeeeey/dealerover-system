import { NextRequest, NextResponse } from "next/server";
import { ProductSalesDetail } from "@/modules/dealerover-system/bia/dealer/dealerover-kpi/types";
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

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const identifier = searchParams.get("customerCode");
        const viewType = searchParams.get("viewType") || "customer";
        const namespacedSalesmanId = searchParams.get("salesmanId");
        const supplierId = searchParams.get("supplierId");
        const startDate = searchParams.get("startDate");
        const endDate = searchParams.get("endDate");

        if (!namespacedSalesmanId || !supplierId || !startDate || !endDate) {
            return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
        }

        const cacheKey = `dealerover_customer_products_${namespacedSalesmanId}_${supplierId}_${startDate}_${endDate}_${identifier || ''}`;
        const cachedData = dealeroverCache.get(cacheKey);
        if (cachedData) {
            return NextResponse.json(cachedData);
        }

        const namespacedId = Number(namespacedSalesmanId);
        const dealerId = Math.floor(namespacedId / 10000);
        const localSalesmanId = namespacedId % 10000;

        const dealers = await fetchDealersList();
        const dealer = dealers.find((d) => Number(d.dealer_id) === dealerId);

        if (!dealer || !dealer.springboot) {
            return NextResponse.json([]);
        }

        const token = await loginToDealerSpringBoot(dealer.springboot);
        if (!token) {
            return NextResponse.json({ error: "Failed to authenticate with dealer Spring Boot" }, { status: 500 });
        }

        const cleanSpringBase = dealer.springboot.replace(/\/+$/, "");

        // 1. Determine correct endpoint based on identifier type
        const isAreaKey = identifier?.includes("::");
        let urlPath = "/api/sales-kpi";

        if (viewType === "area" && isAreaKey) {
            urlPath = "/api/sales-kpi-per-area";
        }

        const url = new URL(`${cleanSpringBase}${urlPath}`);

        if (viewType === "customer" || (viewType === "area" && !isAreaKey)) {
            url.searchParams.append("customerCode", identifier || "");
        } else if (viewType === "area" && identifier && isAreaKey) {
            const parts = identifier.split("::");
            url.searchParams.append("province", (parts[0] || "").trim());
            url.searchParams.append("city", (parts[1] || "").trim());
        }

        url.searchParams.append("salesmanId", String(localSalesmanId));
        url.searchParams.append("supplierId", supplierId || "");
        url.searchParams.append("startDate", startDate || "");
        url.searchParams.append("endDate", endDate || "");

        const res = await fetch(url.toString(), {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            cache: "no-store",
        });

        let currentData: Record<string, unknown>[] = [];
        if (res.ok) {
            currentData = await res.json();
        }

        // 2. Fetch 6 Months History for "Highest Sales"
        const now = new Date();
        const historyStart = new Date();
        historyStart.setMonth(now.getMonth() - 6);
        historyStart.setDate(1);

        const hStartStr = historyStart.toISOString().split('T')[0];
        const hEndStr = now.toISOString().split('T')[0];

        const hUrl = new URL(`${cleanSpringBase}/api/sales-kpi`);
        hUrl.searchParams.append("salesmanId", String(localSalesmanId));
        hUrl.searchParams.append("supplierId", supplierId || "");
        hUrl.searchParams.append("startDate", hStartStr);
        hUrl.searchParams.append("endDate", hEndStr);

        if (viewType === "customer" || (viewType === "area" && !isAreaKey)) {
            hUrl.searchParams.append("customerCode", identifier || "");
        }

        const hRes = await fetch(hUrl.toString(), {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            cache: "no-store",
        });

        const highestSalesMap = new Map<number, number>();
        const historicalMetadata = new Map<number, Record<string, unknown>>();

        if (hRes.ok) {
            let hData: Record<string, unknown>[] = await hRes.json();
            hData = hData.filter(item => Number(item.salesmanId) === localSalesmanId);

            if (viewType === "area" && isAreaKey) {
                const parts = (identifier || "").split("::");
                const pSearch = (parts[0] || "").toLowerCase().trim();
                const cSearch = (parts[1] || "").toLowerCase().trim();
                hData = hData.filter(item => {
                    const prov = (String(item.province || item.provinceName || "")).toLowerCase().trim();
                    const city = (String(item.city || item.cityName || "")).toLowerCase().trim();
                    return pSearch && cSearch ? (prov.includes(pSearch) && city.includes(cSearch)) : (prov.includes(pSearch) || city.includes(cSearch));
                });
            }

            const productMonthSum = new Map<string, number>();
            hData.forEach(item => {
                const pId = Number(item.productId);
                if (!pId) return;

                if (!historicalMetadata.has(pId)) {
                    historicalMetadata.set(pId, item);
                }

                const transactionDate = String(item.transactionDate || "");
                const monthKey = `${pId}-${transactionDate.substring(0, 7)}`;
                productMonthSum.set(monthKey, (productMonthSum.get(monthKey) || 0) + Number(item.netAmount || 0));
            });

            productMonthSum.forEach((sum, key) => {
                const pId = Number(key.split('-')[0]);
                if (!highestSalesMap.has(pId) || sum > highestSalesMap.get(pId)!) {
                    highestSalesMap.set(pId, sum);
                }
            });
        }

        const aggregatedMap = new Map<number, ProductSalesDetail>();

        historicalMetadata.forEach((item, pId) => {
            aggregatedMap.set(pId, {
                ...(item as unknown as ProductSalesDetail),
                salesmanId: namespacedId,
                totalQuantity: 0,
                quantityInBox: 0,
                quantityInPiece: 0,
                netAmount: 0,
                highestMonthlySales: highestSalesMap.get(pId) || 0
            } as ProductSalesDetail);
        });

        if (Array.isArray(currentData)) {
            currentData.forEach(item => {
                const pId = Number(item.productId as string);
                if (!pId) return;

                if (!aggregatedMap.has(pId)) {
                    aggregatedMap.set(pId, {
                        ...(item as unknown as ProductSalesDetail),
                        salesmanId: namespacedId,
                        totalQuantity: 0,
                        quantityInBox: 0,
                        quantityInPiece: 0,
                        netAmount: 0,
                        highestMonthlySales: highestSalesMap.get(pId) || 0
                    } as ProductSalesDetail);
                }

                const agg = aggregatedMap.get(pId)!;
                agg.totalQuantity += Number(item.totalQuantity as number || 0);
                agg.quantityInBox += Number(item.quantityInBox as number || 0);
                agg.quantityInPiece += Number(item.quantityInPiece as number || 0);
                agg.netAmount += Number(item.netAmount as number || 0);
            });
        }

        const finalResult = Array.from(aggregatedMap.values());
        dealeroverCache.set(cacheKey, finalResult);
        return NextResponse.json(finalResult);

    } catch (error) {
        console.error("[Customer Products API Error]:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
