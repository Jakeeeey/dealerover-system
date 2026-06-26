import { NextRequest, NextResponse } from "next/server";
import { TargetSettingSalesman } from "@/modules/dealerover-system/bia/dealer/dealerover-kpi/types";

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

async function fetchDealerTargets(directusUrl: string, directusToken: string, startDate: string, endDate: string): Promise<TargetSettingSalesman[]> {
    const cleanBase = directusUrl.replace(/\/+$/, "");
    const url = `${cleanBase}/items/target_setting_salesman?filter[fiscal_period][_between]=[${startDate},${endDate}]&limit=-1&fields=id,salesman_id,supplier_id,target_amount,fiscal_period,ts_supervisor_id`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (directusToken) headers.Authorization = `Bearer ${directusToken}`;

    try {
        const res = await fetch(url, {
            method: "GET",
            headers,
            cache: "no-store"
        });

        if (!res.ok) {
            console.error(`Failed to fetch targets from ${url}: ${res.status}`);
            return [];
        }

        const json = await res.json();
        return json.data || [];
    } catch (e) {
        console.error(`Targets fetch error for ${url}:`, e);
        return [];
    }
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!startDate || !endDate) {
        return NextResponse.json({ error: "Missing startDate or endDate" }, { status: 400 });
    }

    try {
        const dealers = await fetchDealersList();
        const combinedSalesmanTargets: TargetSettingSalesman[] = [];

        await Promise.all(
            dealers.map(async (dealer) => {
                const directusUrl = dealer.directus;
                const directusToken = dealer.directus_token;
                if (!directusUrl) return;

                const targets = await fetchDealerTargets(directusUrl, directusToken || "", startDate, endDate);
                const dealerId = Number(dealer.dealer_id);

                targets.forEach((t) => {
                    const namespacedSalesmanId = (dealerId * 10000) + Number(t.salesman_id);
                    combinedSalesmanTargets.push({
                        ...t,
                        salesman_id: namespacedSalesmanId,
                        ts_supervisor_id: dealerId
                    });
                });
            })
        );

        return NextResponse.json({
            salesmanTargets: combinedSalesmanTargets
        });

    } catch (error) {
        console.error("[Dealer Targets API Error]:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
