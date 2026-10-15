/**
 * Tolerant PH area-name matching, shared by the server boundary index and the
 * client-side territory check so the two can never disagree about whether two
 * names refer to the same area. Pure functions only — the server service keeps
 * its file loading and imports its comparison from here, because the client
 * cannot import a module that pulls in `node:fs`.
 */

/**
 * Normalizes an area name for tolerant matching: lower-case, strip punctuation,
 * drop administrative qualifiers ("city", "municipality", "mun", "of", "capital").
 * @param {string} value - Raw area name.
 * @returns {string} Normalized name for tolerant comparison.
 */
export function normalizeArea(value: string): string {
  return value
    .toLowerCase()
    .replace(/[().,'"]/g, " ")
    .replace(/\b(city|municipality|mun|of|capital)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when two area names refer to the same place (tolerating "City of X" / "X City").
 * @param {string} a - First area name.
 * @param {string} b - Second area name.
 * @returns {boolean} True when the names match tolerantly.
 */
export function areaNamesMatch(a: string, b: string): boolean {
  const na = normalizeArea(a);
  const nb = normalizeArea(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // One is a word-prefix of the other (e.g. "dagupan" vs "dagupan proper").
  return na.startsWith(`${nb} `) || nb.startsWith(`${na} `);
}

/** A dealer's scope entry, read back off a scope FeatureCollection. */
export interface ScopeAreaRef {
  level: string;
  name: string;
}

/**
 * Collects the areas a scope FeatureCollection covers. The boundary features
 * carry `level` + `name` in their properties, so the map's client can answer
 * "is this customer inside the territory?" from the geometry it already holds —
 * no second request.
 * @param {unknown} featureCollection - The scope FeatureCollection (or anything).
 * @returns {ScopeAreaRef[]} One entry per usable feature.
 */
export function scopeAreasFrom(featureCollection: unknown): ScopeAreaRef[] {
  const features = (featureCollection as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const areas: ScopeAreaRef[] = [];
  for (const feature of features) {
    const props = (feature as { properties?: Record<string, unknown> } | null)?.properties;
    if (!props) continue;
    const level = typeof props.level === "string" ? props.level : "";
    const name = typeof props.name === "string" ? props.name : "";
    if (!level || !name) continue;
    areas.push({ level, name });
  }
  return areas;
}

/** A customer's admin names as derived server-side from its coordinates. */
export interface CustomerAdmin {
  province: string;
  city: string;
  brgy: string;
}

/**
 * Whether a customer falls inside a dealer's territory: its derived admin name
 * at the area's own level has to match. A scope can mix levels (a province row
 * plus a city row), so ANY matching area counts as inside.
 * @param {CustomerAdmin} admin - The customer's derived province/city/barangay.
 * @param {ScopeAreaRef[]} areas - The scope's areas.
 * @returns {boolean} True when the customer is inside the territory.
 */
export function isInsideScope(admin: CustomerAdmin, areas: ScopeAreaRef[]): boolean {
  for (const area of areas) {
    if (area.level === "province" && areaNamesMatch(admin.province, area.name)) return true;
    if (area.level === "city" && areaNamesMatch(admin.city, area.name)) return true;
    if (area.level === "barangay" && areaNamesMatch(admin.brgy, area.name)) return true;
  }
  return false;
}
