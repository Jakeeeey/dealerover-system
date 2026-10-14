import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth-utils";
import { fetchDealerRoster, fetchInventoryReport } from "@/modules/dealerover-system/bia/dealerover-hq/inventory-report/services/inventory-report-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseWindowDays(value: string | null): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return Math.min(365, Math.max(7, Math.trunc(n)));
}

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    if (!token) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const includeZero = searchParams.get("includeZero") === "1" || searchParams.get("includeZero") === "true";
    const windowDays = parseWindowDays(searchParams.get("windowDays"));

    if (searchParams.get("roster") === "1") {
      const roster = await fetchDealerRoster();
      return NextResponse.json(
        {
          success: true,
          data: {
            success: true,
            generatedAt: new Date().toISOString(),
            windowDays,
            includeZero,
            dealers: [],
            rows: [],
            stockOuts: [],
            roster,
          },
        },
        { status: 200 },
      );
    }

    const dealerIds = searchParams.getAll("dealerIds").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
    const single = searchParams.get("dealerId")?.trim();
    if (single) dealerIds.push(single);

    const data = await fetchInventoryReport({ dealerIds, includeZero, windowDays });
    if (!data.success) {
      return NextResponse.json({ success: false, message: data.error ?? "Failed to load inventory report" }, { status: 500 });
    }
    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    console.error("[InventoryReport API] Unexpected error:", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
