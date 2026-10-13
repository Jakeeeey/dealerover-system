import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth-utils";
import { fetchCustomerMap } from "@/modules/dealerover-system/bia/dealerover-hq/customer-map/services/customer-map-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const dealerId = req.nextUrl.searchParams.get("dealerId")?.trim() || undefined;

  try {
    const result = await fetchCustomerMap(dealerId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[CustomerMap-API] Fatal error:", error);
    return NextResponse.json(
      { success: false, message: "An unexpected error occurred. Please try again later." },
      { status: 500 },
    );
  }
}
