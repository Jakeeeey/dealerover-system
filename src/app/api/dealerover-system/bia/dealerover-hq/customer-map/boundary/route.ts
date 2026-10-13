import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth-utils";
import {
  getBoundary,
  type BoundaryLevel,
} from "@/modules/dealerover-system/bia/dealerover-hq/customer-map/services/boundaries-service";

// Boundary geometries: bettergov.ph / barangay-boundaries-repository v2026.4.13.0 (PSGC).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLevel(value: string | null): value is BoundaryLevel {
  return value === "province" || value === "city" || value === "barangay";
}

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const levelParam = params.get("level");
  const name = (params.get("name") ?? "").trim();
  const city = (params.get("city") ?? "").trim();

  if (!isLevel(levelParam) || !name) {
    return NextResponse.json({ type: "FeatureCollection", features: [] });
  }

  try {
    return NextResponse.json(getBoundary(levelParam, name, city || undefined));
  } catch (error) {
    console.error("[CustomerMap-Boundary-API] Failed to serve boundary:", error);
    return NextResponse.json({ type: "FeatureCollection", features: [] });
  }
}
