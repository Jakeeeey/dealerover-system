import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchLeaderboard } from "@/modules/dealerover-system/bia/dealerover-hq/leaderboard/services/leaderboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "vos_access_token";

/**
 * Default leaderboard window — the last 30 days in Asia/Manila (PHT).
 * Mirrors the original salesman-rankings route helper.
 */
function getDefaultDateRange(): { from: string; to: string } {
    const now = new Date();

    const getPhtDateStr = (d: Date) => {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(d);
        const year = parts.find((p) => p.type === "year")?.value;
        const month = parts.find((p) => p.type === "month")?.value;
        const day = parts.find((p) => p.type === "day")?.value;
        return `${year}-${month}-${day}`;
    };

    const to = getPhtDateStr(now);
    const oneMonthAgo = new Date(now);
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
    const from = getPhtDateStr(oneMonthAgo);

    return { from, to };
}

export async function GET(req: Request) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get(COOKIE_NAME)?.value;

        if (!token) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 },
            );
        }

        const { searchParams } = new URL(req.url);
        const defaultRange = getDefaultDateRange();
        const from = searchParams.get("from") || defaultRange.from;
        const to = searchParams.get("to") || defaultRange.to;

        const result = await fetchLeaderboard(from, to);
        return NextResponse.json(result, { status: result.success ? 200 : 500 });
    } catch (error) {
        console.error("[Leaderboard API] Unexpected error:", error);
        return NextResponse.json(
            {
                success: false,
                from: "",
                to: "",
                totalDealersCount: 0,
                onlineDealersCount: 0,
                totalSalesmenCount: 0,
                totalRevenue: 0,
                dealerStatuses: [],
                dealerRankings: [],
                rankings: [],
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 },
        );
    }
}
