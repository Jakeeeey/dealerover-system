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

async function fetchDealerCustomerTargets(directusUrl: string, directusToken: string, localSalesmanId: number, startDate: string, endDate: string, viewType: string) {
    const cleanBase = directusUrl.replace(/\/+$/, "");

    const directusHeaders = () => {
        const h: Record<string, string> = { "Content-Type": "application/json" };
        if (directusToken) h.Authorization = `Bearer ${directusToken}`;
        return h;
    };

    if (viewType === "area") {
        const targetMonth = startDate.substring(0, 7);
        const settingUrl = `${cleanBase}/items/salesman_target_setting?fields=*&limit=-1`;
        const areaUrl = `${cleanBase}/items/salesman_target_area_sales?fields=*&limit=-1`;

        const [settingRes, areaRes] = await Promise.all([
            fetch(settingUrl, { cache: "no-store", headers: directusHeaders() }),
            fetch(areaUrl, { cache: "no-store", headers: directusHeaders() })
        ]);

        if (!settingRes.ok || !areaRes.ok) return [];

        const { data: allSettings } = await settingRes.json();
        const { data: allAreas } = await areaRes.json();

        const validSettingIds = (allSettings || [])
            .filter((s: Record<string, unknown>) => {
                const sFrom = (s.date_range_from as string || "").substring(0, 7);
                const sTo = (s.date_range_to as string || "").substring(0, 7);
                return targetMonth >= sFrom && targetMonth <= sTo;
            })
            .map((s: Record<string, unknown>) => s.id as number);

        if (validSettingIds.length === 0) return [];

        return (allAreas || [])
            .filter((item: Record<string, unknown>) => {
                const rawTid = item.target_setting_id || item.target_setting || item.targetSetting;
                const areaSettingId = Number(typeof rawTid === 'object' && rawTid !== null ? (rawTid as Record<string, unknown>).id : rawTid);
                return validSettingIds.includes(areaSettingId);
            })
            .map((item: Record<string, unknown>) => ({
                province: (item.province as string) || "",
                city: (item.city as string) || "",
                target_amount: Number((item.target_amount as number) || (item.targetAmount as number) || (item.amount as number) || 0)
            }));
    }

    // Customer or Store Type View filtered by localSalesmanId
    const filter = JSON.stringify({
        _and: [
            { target_setting_id: { salesman_id: { _eq: localSalesmanId } } },
            { target_setting_id: { date_range_from: { _gte: startDate } } },
            { target_setting_id: { date_range_from: { _lte: endDate } } }
        ]
    });

    const fields = "target_amount,customer_id.store_name,customer_id.store_type.store_type,target_setting_id.status";
    const url = `${cleanBase}/items/salesman_target_customer_sales?filter=${encodeURIComponent(filter)}&fields=${fields}&limit=-1`;

    const res = await fetch(url, {
        cache: "no-store",
        headers: directusHeaders(),
    });

    if (!res.ok) {
        throw new Error(`Directus error: ${res.status}`);
    }

    const { data } = await res.json();

    const targetMap: Record<string, number> = {};
    (data || []).forEach((item: Record<string, unknown>) => {
        const customer = item.customer_id as Record<string, unknown> | undefined;
        const storeName = customer?.store_name as string | undefined;
        const storeType = (customer?.store_type as Record<string, unknown> | undefined)?.store_type as string | undefined;

        const key = viewType === "storeType" ? (storeType || "OTHERS") : storeName;
        if (key) {
            targetMap[key] = (targetMap[key] || 0) + (item.target_amount as number || 0);
        }
    });

    return targetMap;
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const namespacedSalesmanIds = searchParams.get("salesmanIds")?.split(",") || [];
        const startDate = searchParams.get("startDate");
        const endDate = searchParams.get("endDate");
        const viewType = searchParams.get("viewType") || "customer";

        if (namespacedSalesmanIds.length === 0 || !startDate || !endDate) {
            return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
        }

        const namespacedId = Number(namespacedSalesmanIds[0]);
        const dealerId = Math.floor(namespacedId / 10000);
        const localSalesmanId = namespacedId % 10000;

        const dealers = await fetchDealersList();
        const dealer = dealers.find((d) => Number(d.dealer_id) === dealerId);

        if (!dealer || !dealer.directus) {
            return NextResponse.json(viewType === "area" ? [] : {});
        }

        const data = await fetchDealerCustomerTargets(
            dealer.directus,
            dealer.directus_token || "",
            localSalesmanId,
            startDate,
            endDate,
            viewType
        );

        return NextResponse.json(data);

    } catch (error) {
        const err = error as Error;
        console.error("[Customer Targets API Error]:", err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
