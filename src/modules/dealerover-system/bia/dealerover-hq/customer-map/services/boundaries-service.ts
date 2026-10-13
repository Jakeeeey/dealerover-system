/**
 * Server-only PSGC boundary index for the HQ customer map.
 *
 * Boundary geometries: bettergov.ph / barangay-boundaries-repository
 * v2026.4.13.0 (PSGC). Loaded from `public/geojson/` once per server
 * instance and indexed with a bbox + coarse-grid prefilter so per-customer
 * point-in-polygon lookups stay cheap at request time.
 *
 * Why this exists: dealer customer rows carry empty PSGC text columns, so
 * province/city/barangay are derived server-side from each customer's
 * coordinates instead of trusting the raw columns.
 */

import fs from "node:fs";
import path from "node:path";

export type BoundaryLevel = "province" | "city" | "barangay";

export interface AdminResolution {
  province: string | null;
  city: string | null;
  brgy: string | null;
}

interface BoundaryGeometry {
  type: string;
  coordinates: unknown;
}

interface BoundaryFeature {
  type: "Feature";
  properties: {
    name?: string | null;
    psgc?: string | null;
    city?: string | null;
    province?: string | null;
    region?: string | null;
    level?: string | null;
    [key: string]: string | null | undefined;
  };
  geometry: BoundaryGeometry | null;
}

export interface BoundaryFeatureCollection {
  type: "FeatureCollection";
  features: BoundaryFeature[];
}

interface BBox {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

interface IndexedLevel {
  features: BoundaryFeature[];
  bboxes: (BBox | null)[];
  grid: Map<string, number[]>;
  /** Barangay-only: city name -> feature indices inside that city. */
  byCityName: Map<string, number[]>;
}

/** Coarse-grid cell size in degrees. Small enough to prune, big enough to stay lean. */
const CELL_SIZE = 0.05;

const GEO_FILES: Record<BoundaryLevel, string> = {
  province: "provinces.geojson",
  city: "cities.geojson",
  barangay: "barangays.geojson",
};

function featureName(feature: BoundaryFeature): string {
  const name = feature.properties?.name;
  return typeof name === "string" ? name : "";
}

function isNumberPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function expandBBox(bbox: BBox, lng: number, lat: number): void {
  if (lng < bbox.minLng) bbox.minLng = lng;
  if (lng > bbox.maxLng) bbox.maxLng = lng;
  if (lat < bbox.minLat) bbox.minLat = lat;
  if (lat > bbox.maxLat) bbox.maxLat = lat;
}

/**
 * Walks arbitrarily nested coordinate arrays to find the feature bbox.
 * @param {unknown} coords - Raw GeoJSON coordinates nest.
 * @param {BBox} bbox - Mutable bbox accumulator.
 */
function accumulateBBox(coords: unknown, bbox: BBox): void {
  if (isNumberPair(coords)) {
    expandBBox(bbox, coords[0], coords[1]);
    return;
  }
  if (Array.isArray(coords)) {
    for (const entry of coords) accumulateBBox(entry, bbox);
  }
}

function bboxOf(feature: BoundaryFeature): BBox | null {
  if (!feature.geometry || !feature.geometry.coordinates) return null;
  const bbox: BBox = { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity };
  accumulateBBox(feature.geometry.coordinates, bbox);
  if (!Number.isFinite(bbox.minLng) || !Number.isFinite(bbox.minLat)) return null;
  return bbox;
}

function cellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

/**
 * Builds the bbox + grid index for one boundary level.
 * @param {BoundaryFeature[]} features - Parsed GeoJSON features.
 * @returns {IndexedLevel} Indexed level ready for point lookups.
 */
function buildIndex(features: BoundaryFeature[]): IndexedLevel {
  const bboxes: (BBox | null)[] = new Array(features.length).fill(null);
  const grid = new Map<string, number[]>();
  const byCityName = new Map<string, number[]>();

  features.forEach((feature, index) => {
    const bbox = bboxOf(feature);
    bboxes[index] = bbox;
    if (!bbox) return;
    const minCX = Math.floor(bbox.minLng / CELL_SIZE);
    const maxCX = Math.floor(bbox.maxLng / CELL_SIZE);
    const minCY = Math.floor(bbox.minLat / CELL_SIZE);
    const maxCY = Math.floor(bbox.maxLat / CELL_SIZE);
    for (let cx = minCX; cx <= maxCX; cx += 1) {
      for (let cy = minCY; cy <= maxCY; cy += 1) {
        const key = cellKey(cx, cy);
        const bucket = grid.get(key);
        if (bucket) bucket.push(index);
        else grid.set(key, [index]);
      }
    }
    const city = feature.properties?.city;
    if (typeof city === "string" && city) {
      const list = byCityName.get(city);
      if (list) list.push(index);
      else byCityName.set(city, [index]);
    }
  });

  return { features, bboxes, grid, byCityName };
}

/**
 * Reads one boundary file from `public/geojson`.
 * @param {BoundaryLevel} level - Which boundary level to load.
 * @returns {BoundaryFeature[]} Parsed features (empty on any failure).
 */
function loadFeatures(level: BoundaryLevel): BoundaryFeature[] {
  try {
    const file = path.join(process.cwd(), "public", "geojson", GEO_FILES[level]);
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as { features?: unknown };
    if (!parsed || !Array.isArray(parsed.features)) return [];
    return parsed.features.filter(
      (feature): feature is BoundaryFeature =>
        typeof feature === "object" &&
        feature !== null &&
        (feature as { type?: unknown }).type === "Feature" &&
        typeof (feature as { geometry?: unknown }).geometry === "object",
    );
  } catch (error) {
    console.error(`ERR_INTERNAL_FAIL: [Boundaries] Failed to load ${GEO_FILES[level]}:`, error);
    return [];
  }
}

let cache: Record<BoundaryLevel, IndexedLevel> | null = null;

/**
 * Lazily loads + indexes all three boundary levels once per server instance.
 * @returns {Record<BoundaryLevel, IndexedLevel>} Cached indexes.
 */
function getIndexes(): Record<BoundaryLevel, IndexedLevel> {
  if (!cache) {
    cache = {
      province: buildIndex(loadFeatures("province")),
      city: buildIndex(loadFeatures("city")),
      barangay: buildIndex(loadFeatures("barangay")),
    };
  }
  return cache;
}

/**
 * Classic ray-casting test for one ring.
 * @param {number} lng - Point longitude.
 * @param {number} lat - Point latitude.
 * @param {number[][]} ring - Linear ring coordinates.
 * @returns {boolean} True when the point is inside the ring.
 */
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Tests a Polygon (first ring = exterior, rest = holes).
 * @param {unknown} rings - Polygon coordinate rings.
 * @param {number} lng - Point longitude.
 * @param {number} lat - Point latitude.
 * @returns {boolean} True when inside the exterior and outside every hole.
 */
function polygonContains(rings: unknown, lng: number, lat: number): boolean {
  if (!Array.isArray(rings) || rings.length === 0) return false;
  const exterior = rings[0] as number[][];
  if (!Array.isArray(exterior) || !pointInRing(lng, lat, exterior)) return false;
  for (let h = 1; h < rings.length; h += 1) {
    const hole = rings[h] as number[][];
    if (Array.isArray(hole) && hole.length > 0 && pointInRing(lng, lat, hole)) return false;
  }
  return true;
}

/**
 * Tests Polygon + MultiPolygon geometries.
 * @param {BoundaryGeometry | null} geometry - Feature geometry.
 * @param {number} lng - Point longitude.
 * @param {number} lat - Point latitude.
 * @returns {boolean} True when any polygon contains the point.
 */
function geometryContains(geometry: BoundaryGeometry | null, lng: number, lat: number): boolean {
  if (!geometry || !geometry.coordinates) return false;
  if (geometry.type === "Polygon") {
    return polygonContains(geometry.coordinates, lng, lat);
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return (geometry.coordinates as unknown[]).some((polygon) =>
      polygonContains(polygon, lng, lat),
    );
  }
  return false;
}

function bboxHits(bbox: BBox | null, lng: number, lat: number): boolean {
  return (
    !!bbox && lng >= bbox.minLng && lng <= bbox.maxLng && lat >= bbox.minLat && lat <= bbox.maxLat
  );
}

/**
 * Finds the first indexed feature containing the point.
 * @param {IndexedLevel} level - Indexed boundary level.
 * @param {number[]} candidates - Grid-prefiltered feature indices.
 * @param {number} lng - Point longitude.
 * @param {number} lat - Point latitude.
 * @returns {BoundaryFeature | null} Containing feature, if any.
 */
function findContaining(
  level: IndexedLevel,
  candidates: number[],
  lng: number,
  lat: number,
): BoundaryFeature | null {
  for (const index of candidates) {
    if (!bboxHits(level.bboxes[index], lng, lat)) continue;
    const feature = level.features[index];
    if (geometryContains(feature.geometry, lng, lat)) return feature;
  }
  return null;
}

function gridCandidates(level: IndexedLevel, lng: number, lat: number): number[] {
  return level.grid.get(cellKey(Math.floor(lng / CELL_SIZE), Math.floor(lat / CELL_SIZE))) ?? [];
}

/**
 * Resolves province/city/barangay names for a coordinate pair.
 * Barangay scanning is scoped to the matched city's features for speed.
 * @param {number} lng - Point longitude.
 * @param {number} lat - Point latitude.
 * @returns {AdminResolution} Resolved names (null when outside every polygon).
 */
export function resolveAdmin(lng: number, lat: number): AdminResolution {
  const none: AdminResolution = { province: null, city: null, brgy: null };
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return none;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return none;

  const indexes = getIndexes();

  const provinceFeature = findContaining(
    indexes.province,
    gridCandidates(indexes.province, lng, lat),
    lng,
    lat,
  );
  // Independent cities (province: null) sit outside any province polygon, so a
  // missing province must not block the city/barangay lookup below.
  const province = provinceFeature ? featureName(provinceFeature) || null : null;

  const cityFeature = findContaining(
    indexes.city,
    gridCandidates(indexes.city, lng, lat),
    lng,
    lat,
  );
  if (!cityFeature) return { ...none, province };
  const city = featureName(cityFeature) || null;
  if (!city) return { ...none, province };

  // Barangay polygons are disjoint, so scanning only the matched city's
  // barangays is exact and keeps per-row work to ~dozens of polygons.
  const scoped = indexes.barangay.byCityName.get(city) ?? [];
  let brgy: string | null = null;
  if (scoped.length > 0) {
    const barangays = indexes.barangay;
    for (const index of scoped) {
      if (!bboxHits(barangays.bboxes[index], lng, lat)) continue;
      const feature = barangays.features[index];
      if (geometryContains(feature.geometry, lng, lat)) {
        brgy = featureName(feature) || null;
        break;
      }
    }
  }

  return { province, city, brgy };
}

/**
 * Returns the boundary feature(s) matching a name for highlight rendering.
 * @param {BoundaryLevel} level - Which boundary level to search.
 * @param {string} name - Exact feature name (e.g. a resolved province/city).
 * @param {string} [city] - Optional parent city to disambiguate barangay names.
 * @returns {BoundaryFeatureCollection} Matching features (empty when none).
 */
export function getBoundary(
  level: BoundaryLevel,
  name: string,
  city?: string,
): BoundaryFeatureCollection {
  const empty: BoundaryFeatureCollection = { type: "FeatureCollection", features: [] };
  const wanted = name?.trim();
  if ((level !== "province" && level !== "city" && level !== "barangay") || !wanted) {
    return empty;
  }
  const wantedCity = city?.trim() ?? "";
  const { features } = getIndexes()[level];
  const matches = features.filter((feature) => {
    if (featureName(feature) !== wanted) return false;
    if (level === "barangay" && wantedCity && feature.properties?.city !== wantedCity) return false;
    return true;
  });
  return { type: "FeatureCollection", features: matches };
}
