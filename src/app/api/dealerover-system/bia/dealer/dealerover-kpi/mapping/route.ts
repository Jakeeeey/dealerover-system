import { NextResponse } from "next/server";
import { SupervisorMapping, SalesmanMapping, SalesmanMaster } from "@/modules/dealerover-system/bia/dealer/dealerover-kpi/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Dealer {
  dealer_id: number | string;
  dealer_name?: string;
  springboot?: string;
  directus?: string;
  directus_token?: string;
}

interface DirectusSalesman {
  id: number | string;
  salesman_name?: string;
  salesman_code?: string;
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

async function fetchDealerSalesmen(directusUrl: string, directusToken: string): Promise<DirectusSalesman[]> {
    const cleanBase = directusUrl.replace(/\/+$/, "");
    const url = `${cleanBase}/items/salesman?fields=id,salesman_name,salesman_code&limit=-1`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (directusToken) headers.Authorization = `Bearer ${directusToken}`;

    try {
        const res = await fetch(url, { headers, cache: "no-store" });
        if (!res.ok) return [];
        const json = await res.json();
        return json.data || [];
    } catch (e) {
        console.error(`Error fetching salesmen from ${url}:`, e);
        return [];
    }
}

export async function GET() {
    try {
        // 1. Fetch the list of all dealers from main database
        const dealers = await fetchDealersList();

        const supervisorsList: SupervisorMapping[] = [];
        const salesmanMappingsList: SalesmanMapping[] = [];
        const salesmanMasterList: SalesmanMaster[] = [];

        // 2. Map each dealer as a supervisor
        dealers.forEach((dealer) => {
            const dealerId = Number(dealer.dealer_id);
            supervisorsList.push({
                id: dealerId,
                division_id: 1, // Default division
                supervisor_id: {
                    id: dealerId,
                    first_name: dealer.dealer_name || "Unknown Dealer",
                    last_name: ""
                }
            });
        });

        // 3. Query each dealer's Directus to get their salesmen and map them
        await Promise.all(
            dealers.map(async (dealer) => {
                const dealerId = Number(dealer.dealer_id);
                const directusUrl = dealer.directus;
                const directusToken = dealer.directus_token;
                if (!directusUrl) return;

                const salesmen = await fetchDealerSalesmen(directusUrl, directusToken || "");

                salesmen.forEach((salesman) => {
                    const localSalesmanId = Number(salesman.id);
                    const namespacedSalesmanId = (dealerId * 10000) + localSalesmanId;

                    // Map salesman to its Dealer's supervisor ID
                    salesmanMappingsList.push({
                        id: namespacedSalesmanId,
                        supervisor_per_division_id: dealerId,
                        salesman_id: namespacedSalesmanId
                    });

                    // Add to master list
                    salesmanMasterList.push({
                        id: namespacedSalesmanId,
                        salesman_name: salesman.salesman_name || "Unknown Salesman",
                        salesman_code: salesman.salesman_code || ""
                    });
                });
            })
        );

        return NextResponse.json({
            supervisors: supervisorsList,
            salesmanMappings: salesmanMappingsList,
            salesmanMaster: salesmanMasterList
        });

    } catch (error) {
        const err = error as Error;
        console.error("[Dealer Mapping API Error]:", err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
