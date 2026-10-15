import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth-utils";
import {
  getScopeBoundary,
  type BoundaryFeatureCollection,
  type ScopeArea,
} from "@/modules/dealerover-system/bia/dealerover-hq/customer-map/services/boundaries-service";
import { fetchDealerScopes } from "@/modules/dealerover-system/bia/dealerover-hq/customer-map/services/customer-map-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A dealer with no territory (or a registry where the owner has not created
// the `dealer_scope` collection yet) is a valid state, not an error — the map
// simply draws no highlight.
const EMPTY_COLLECTION: BoundaryFeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Builds the human label for one scope entry. Parents ride along so same-named
 * areas in different provinces stay distinguishable in the "not drawn" notice.
 * @param {ScopeArea} area - Resolved or unresolved scope entry.
 * @returns {string} Label like "city: Dagupan City" or "barangay: Poblacion (Dagupan City, Pangasinan)".
 */
function scopeLabel(area: ScopeArea): string {
  const base = `${area.level}: ${area.name.trim()}`;
  const parents = [area.parentCity?.trim(), area.parentProvince?.trim()].filter(
    (part): part is string => !!part,
  );
  return parents.length > 0 ? `${base} (${parents.join(", ")})` : base;
}

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const dealerId = (req.nextUrl.searchParams.get("dealerId") ?? "").trim();
  if (!dealerId) {
    return NextResponse.json(
      { success: false, message: "Missing dealerId. Pass ?dealerId=X." },
      { status: 400 },
    );
  }

  try {
    // fetchDealerScopes never throws (absent collection -> {}), so a missing
    // collection and a dealer with no rows converge here: 200 + empty.
    const scopes = await fetchDealerScopes();
    const areas = scopes[dealerId] ?? [];
    if (areas.length === 0) {
      return NextResponse.json({
        success: true,
        data: EMPTY_COLLECTION,
        resolved: [],
        unresolved: [],
      });
    }
    const { featureCollection, resolved, unresolved } = getScopeBoundary(areas);
    return NextResponse.json({
      success: true,
      data: featureCollection,
      resolved: resolved.map(scopeLabel),
      unresolved: unresolved.map(scopeLabel),
    });
  } catch (error) {
    // Belt-and-braces: neither dependency throws by contract, but a scope
    // failure must never 500 the map — degrade to "no territory".
    console.error("ERR_SCOPE_FAIL: [CustomerMap] Failed to serve dealer scope:", error);
    return NextResponse.json({
      success: true,
      data: EMPTY_COLLECTION,
      resolved: [],
      unresolved: [],
    });
  }
}
