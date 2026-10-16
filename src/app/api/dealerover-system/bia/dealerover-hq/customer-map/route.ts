import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth-utils";
import {
  CUSTOMER_PAGE_SIZE,
  fetchCustomerPage,
  fetchDealerRoster,
} from "@/modules/dealerover-system/bia/dealerover-hq/customer-map/services/customer-map-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  // An explicit user refresh must not be served from the per-dealer cache.
  const bypassCache = params.get("refresh") === "1";

  try {
    // Roster first: the picker must never depend on what is selected or loaded.
    if (params.get("roster") === "1") {
      const roster = await fetchDealerRoster();
      return NextResponse.json({ success: true, roster });
    }

    const dealerId = params.get("dealerId")?.trim() || undefined;
    if (!dealerId) {
      return NextResponse.json(
        { success: false, message: "Missing dealerId. Pass ?roster=1 or ?dealerId=X&page=N&pageSize=M." },
        { status: 400 },
      );
    }

    const rawPage = Number(params.get("page") ?? "0");
    const rawSize = Number(params.get("pageSize") ?? String(CUSTOMER_PAGE_SIZE));
    const page = Number.isFinite(rawPage) && rawPage >= 0 ? Math.trunc(rawPage) : 0;
    const result = await fetchCustomerPage(dealerId, page, rawSize, { bypassCache });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[CustomerMap-API] Fatal error:", error);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred. Please try again later." },
      { status: 500 },
    );
  }
}
