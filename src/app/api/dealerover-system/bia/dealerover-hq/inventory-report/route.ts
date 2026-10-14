import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth-utils";
import {
  BRANCH_PAGE_SIZE,
  fetchDealerRoster,
  fetchInventoryAnalytics,
  fetchInventoryMeta,
  fetchInventoryPage,
} from "@/modules/dealerover-system/bia/dealerover-hq/inventory-report/services/inventory-report-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseWindowDays(value: string | null): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return Math.min(365, Math.max(7, Math.trunc(n)));
}

function parseLookbackDays(value: string | null): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 90;
  return Math.min(365, Math.max(7, Math.trunc(n)));
}

function parsePage(value: string | null): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

function parsePageSize(value: string | null): number {
  if (value === null || value === "") return BRANCH_PAGE_SIZE;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return BRANCH_PAGE_SIZE;
  return Math.min(30, Math.max(1, Math.trunc(n)));
}

function isTruthyFlag(value: string | null): boolean {
  return value === "1" || value === "true";
}

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    if (!token) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);

    if (searchParams.get("roster") === "1") {
      const roster = await fetchDealerRoster();
      return NextResponse.json({ success: true, roster }, { status: 200 });
    }

    const dealerId = searchParams.get("dealerId")?.trim() || "";
    if (!dealerId) {
      return NextResponse.json(
        { success: false, error: "Missing required query parameter: dealerId" },
        { status: 400 },
      );
    }

    if (isTruthyFlag(searchParams.get("analytics"))) {
      const windowDays = parseWindowDays(searchParams.get("windowDays"));
      const lookbackDays = parseLookbackDays(searchParams.get("lookbackDays"));
      const bypassCache = isTruthyFlag(searchParams.get("refresh"));
      const analytics = await fetchInventoryAnalytics(dealerId, {
        windowDays,
        lookbackDays,
        bypassCache,
      });
      // An offline dealer's demand index still rides inside the schema payload
      // (with `success: false` plus `error`) so the client can render
      // zero-stock states; analytics never 404s.
      return NextResponse.json(analytics, { status: 200 });
    }

    if (isTruthyFlag(searchParams.get("meta"))) {
      const refresh = isTruthyFlag(searchParams.get("refresh"));
      const meta = await fetchInventoryMeta(dealerId, { refresh });
      // Business-level failures (offline dealer with its reason) still ride
      // inside the schema payload so the client can read dealer.reason; only
      // an unknown dealer is a 404.
      if (!meta.success && meta.error === "Unknown dealer") {
        return NextResponse.json(meta, { status: 404 });
      }
      return NextResponse.json(meta, { status: 200 });
    }

    const rawPage = parsePage(searchParams.get("page"));
    if (rawPage === null) {
      return NextResponse.json(
        { success: false, error: "Missing required query parameter: page" },
        { status: 400 },
      );
    }

    const pageSize = parsePageSize(searchParams.get("pageSize"));
    const windowDays = parseWindowDays(searchParams.get("windowDays"));
    const includeZero = isTruthyFlag(searchParams.get("includeZero"));
    const bypassCache = isTruthyFlag(searchParams.get("refresh"));

    const page = await fetchInventoryPage(dealerId, rawPage, pageSize, {
      windowDays,
      includeZero,
      bypassCache,
    });
    // A failed stock page still rides inside the schema payload (with its
    // error) so the client keeps the rows streamed so far; only an unknown
    // dealer is a 404.
    if (!page.success && page.error === "Unknown dealer") {
      return NextResponse.json(page, { status: 404 });
    }
    return NextResponse.json(page, { status: 200 });
  } catch (error) {
    console.error("[InventoryReport API] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
