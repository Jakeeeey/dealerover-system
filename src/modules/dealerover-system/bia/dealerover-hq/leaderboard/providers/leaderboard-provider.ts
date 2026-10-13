"use client";

import type { LeaderboardResponse } from "../types";

const LEADERBOARD_ENDPOINT = "/api/dealerover-system/bia/dealerover-hq/leaderboard";

/**
 * Client-side fetch wrapper for the leaderboard proxy route.
 * The browser never talks to Directus directly — this hits our own `/api` route,
 * which injects the server-only Directus token.
 *
 * @param {string} [from] - Inclusive start date (`YYYY-MM-DD`); omitted = server default.
 * @param {string} [to] - Inclusive end date (`YYYY-MM-DD`); omitted = server default.
 * @returns {Promise<LeaderboardResponse>} The ranked salesmen + dealers payload.
 * @throws {Error} When the route responds with a non-OK status.
 */
export async function fetchLeaderboard(
  from?: string,
  to?: string,
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();

  const res = await fetch(`${LEADERBOARD_ENDPOINT}${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { message?: string; error?: string }
      | null;
    throw new Error(
      body?.message || body?.error || `Failed to fetch leaderboard (${res.status})`,
    );
  }

  return (await res.json()) as LeaderboardResponse;
}
