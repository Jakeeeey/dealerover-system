import { NextRequest, NextResponse } from "next/server";
import { VSalesPerformanceDataDto } from "@/modules/dealerover-system/bia/dealer/dealerover-kpi/types";

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

async function fetchDealerSalesData(springbootUrl: string, token: string, startDate: string, endDate: string): Promise<VSalesPerformanceDataDto[]> {
    const cleanBase = springbootUrl.replace(/\/+$/, "");
    const params = new URLSearchParams();
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);

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
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";

    try {
        const dealers = await fetchDealersList();
        const combinedPerformance: VSalesPerformanceDataDto[] = [];

        await Promise.all(
            dealers.map(async (dealer) => {
                const springbootUrl = dealer.springboot;
                if (!springbootUrl) return;

                const token = await loginToDealerSpringBoot(springbootUrl);
                if (!token) return;

                const salesData = await fetchDealerSalesData(springbootUrl, token, startDate, endDate);
                const dealerId = Number(dealer.dealer_id);

                salesData.forEach((item) => {
                    const namespacedSalesmanId = (dealerId * 10000) + Number(item.salesmanId);
                    combinedPerformance.push({
                        ...item,
                        salesmanId: namespacedSalesmanId
                    });
                });
            })
        );

        return NextResponse.json(combinedPerformance);

    } catch (error) {
        console.error("[Dealer Performance API Error]:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
