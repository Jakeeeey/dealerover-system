/**
 * Server-only PSGC boundary index for the HQ customer map.
 *
 * Data source: HDX COD-AB mirror of PSA/NAMRIA boundaries via ArcGIS
 * (geometry simplified at ~22 m tolerance; coordinates rounded to 5dp).
 *
 * Level -> file mapping under `public/geojson/`:
 *   - province -> `provinces.geojson` (88 features; loaded eagerly).
 *   - city -> `cities.geojson` (1,647 features; loaded eagerly).
 *   - barangay -> `barangays/<idx>.geojson` (88 files, one per province,
 *     where `<idx>` is the 0-based index into the provinces feature order;
 *     loaded lazily, never all at once).
 *   - `barangays-index.json` is a compact manifest of parallel arrays
 *     `{ province: number[], name: string[], city: string[] }` (~1.2 MB)
 *     loaded once at startup so a barangay's province file can be located
 *     without reading all 88 files.
 *
 * Memory strategy: provinces + cities are loaded eagerly and indexed once
 * per server instance (bbox + 0.05-degree coarse-grid prefilter, so
 * per-customer point-in-polygon lookups stay cheap at request time).
 * Barangays are NEVER globally indexed (44,947 features would pin RAM):
 * each province file is read, parsed, and indexed on demand and held in a
 * small LRU (the last ~6 provinces), so server RAM stays bounded.
 *
 * Why this exists: dealer customer rows carry empty PSGC text columns, so
 * province/city/barangay are derived server-side from each customer's
 * coordinates instead of trusting the raw columns.
 */

import fs from "node:fs";
import path from "node:path";

import {
  areaNamesMatch,
  normalizeArea,
} from "../utils/area-match";

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
}

/** Compact manifest entry: which province file a barangay lives in. */
interface BarangayManifest {
  /** Normalized barangay name -> province file indices holding that name. */
  nameToProvinces: Map<string, number[]>;
  /** Normalized `name|city` -> province file indices (city-narrowed lookup). */
  nameCityToProvinces: Map<string, number[]>;
}

/** Coarse-grid cell size in degrees. Small enough to prune, big enough to stay lean. */
const CELL_SIZE = 0.05;

/** Eagerly loaded levels: provinces + cities are small enough to index globally. */
const EAGER_FILES: Record<"province" | "city", string> = {
  province: "provinces.geojson",
  city: "cities.geojson",
};

const BARANGAY_MANIFEST_FILE = "barangays-index.json";

/** Barangay province files kept in memory; older entries are evicted first. */
const MAX_CACHED_BARANGAY_PROVINCES = 6;

function featureName(feature: BoundaryFeature): string {
  const name = feature.properties?.name;
  return typeof name === "string" ? name : "";
}

/**
 * Normalizes a boundary name for manifest keys and soft city matching.
 * @param {string} value - Raw boundary or city name.
 * @returns {string} Lower-cased, whitespace-collapsed name.
 */
function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

// normalizeArea / areaNamesMatch live in ../utils/area-match so the client-side
// territory check (which cannot import this server-only module) compares names
// by exactly the same rules.

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
  });

  return { features, bboxes, grid };
}

/**
 * Narrows a raw GeoJSON `features` value to valid boundary features.
 * @param {unknown} entries - Raw `features` array from a parsed file.
 * @returns {BoundaryFeature[]} Valid features (invalid entries dropped).
 */
function toBoundaryFeatures(entries: unknown): BoundaryFeature[] {
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (feature): feature is BoundaryFeature =>
      typeof feature === "object" &&
      feature !== null &&
      (feature as { type?: unknown }).type === "Feature" &&
      typeof (feature as { geometry?: unknown }).geometry === "object",
  );
}

/**
 * Reads one eagerly loaded boundary file from `public/geojson`.
 * @param {"province" | "city"} level - Which eager level to load.
 * @returns {BoundaryFeature[]} Parsed features (empty on any failure).
 */
function loadEagerFeatures(level: "province" | "city"): BoundaryFeature[] {
  try {
    const file = path.join(process.cwd(), "public", "geojson", EAGER_FILES[level]);
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as { features?: unknown };
    if (!parsed || !Array.isArray(parsed.features)) return [];
    return toBoundaryFeatures(parsed.features);
  } catch (error) {
    console.error(`ERR_INTERNAL_FAIL: [Boundaries] Failed to load ${EAGER_FILES[level]}:`, error);
    return [];
  }
}

let eagerCache: Record<"province" | "city", IndexedLevel> | null = null;

/**
 * Lazily loads + indexes the eager levels (provinces + cities) once per server instance.
 * @returns {Record<"province" | "city", IndexedLevel>} Cached eager indexes.
 */
function getEagerIndexes(): Record<"province" | "city", IndexedLevel> {
  if (!eagerCache) {
    eagerCache = {
      province: buildIndex(loadEagerFeatures("province")),
      city: buildIndex(loadEagerFeatures("city")),
    };
  }
  return eagerCache;
}

/**
 * Appends a province index to a manifest bucket, keeping entries unique.
 * @param {Map<string, number[]>} target - Manifest map under construction.
 * @param {string} key - Normalized lookup key.
 * @param {number} provinceIndex - Province file index to record.
 */
function pushManifestEntry(
  target: Map<string, number[]>,
  key: string,
  provinceIndex: number,
): void {
  const list = target.get(key);
  if (list) {
    if (!list.includes(provinceIndex)) list.push(provinceIndex);
  } else {
    target.set(key, [provinceIndex]);
  }
}

let manifestCache: BarangayManifest | null = null;

/**
 * Loads the compact barangay manifest (`barangays-index.json` parallel arrays)
 * into normalized name -> province-index maps. Cheap (~1.2 MB) and read once.
 * @returns {BarangayManifest} Lookup maps (empty on any failure).
 */
function getBarangayManifest(): BarangayManifest {
  if (manifestCache) return manifestCache;
  const empty: BarangayManifest = { nameToProvinces: new Map(), nameCityToProvinces: new Map() };
  try {
    const file = path.join(process.cwd(), "public", "geojson", BARANGAY_MANIFEST_FILE);
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as {
      province?: unknown;
      name?: unknown;
      city?: unknown;
    };
    if (
      !parsed ||
      !Array.isArray(parsed.province) ||
      !Array.isArray(parsed.name) ||
      !Array.isArray(parsed.city) ||
      parsed.province.length !== parsed.name.length ||
      parsed.province.length !== parsed.city.length
    ) {
      console.error(
        `ERR_INTERNAL_FAIL: [Boundaries] ${BARANGAY_MANIFEST_FILE} has mismatched parallel arrays`,
      );
      manifestCache = empty;
      return manifestCache;
    }
    const provinces = parsed.province;
    const names = parsed.name;
    const cities = parsed.city;
    for (let i = 0; i < provinces.length; i += 1) {
      const provinceIndex = provinces[i];
      const name = names[i];
      const city = cities[i];
      if (
        typeof provinceIndex !== "number" ||
        !Number.isInteger(provinceIndex) ||
        provinceIndex < 0 ||
        typeof name !== "string" ||
        typeof city !== "string"
      ) {
        continue;
      }
      const normName = normalizeName(name);
      if (!normName) continue;
      pushManifestEntry(empty.nameToProvinces, normName, provinceIndex);
      const normCity = normalizeName(city);
      if (normCity) {
        pushManifestEntry(empty.nameCityToProvinces, `${normName}|${normCity}`, provinceIndex);
      }
    }
    for (const list of empty.nameToProvinces.values()) list.sort((a, b) => a - b);
    for (const list of empty.nameCityToProvinces.values()) list.sort((a, b) => a - b);
  } catch (error) {
    console.error(
      `ERR_INTERNAL_FAIL: [Boundaries] Failed to load ${BARANGAY_MANIFEST_FILE}:`,
      error,
    );
    manifestCache = empty;
    return manifestCache;
  }
  manifestCache = empty;
  return manifestCache;
}

/** LRU of per-province barangay indexes: province file index -> indexed level. */
const barangayCache = new Map<number, IndexedLevel>();

/**
 * Reads + indexes one province's barangay file on demand, LRU-cached so RAM
 * stays bounded to the last few provinces touched.
 * @param {number} provinceIndex - 0-based index into the provinces feature order.
 * @returns {IndexedLevel | null} Indexed barangays, or null when unreadable.
 */
function getProvinceBarangays(provinceIndex: number): IndexedLevel | null {
  if (!Number.isInteger(provinceIndex) || provinceIndex < 0) return null;
  const cached = barangayCache.get(provinceIndex);
  if (cached) {
    barangayCache.delete(provinceIndex);
    barangayCache.set(provinceIndex, cached);
    return cached;
  }
  const provinceCount = getEagerIndexes().province.features.length;
  if (provinceIndex >= provinceCount) {
    console.error(
      `ERR_INTERNAL_FAIL: [Boundaries] Barangay province index ${provinceIndex} out of range (0..${provinceCount - 1})`,
    );
    return null;
  }
  let features: BoundaryFeature[];
  try {
    const file = path.join(
      process.cwd(),
      "public",
      "geojson",
      "barangays",
      `${provinceIndex}.geojson`,
    );
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as { features?: unknown };
    if (!parsed || !Array.isArray(parsed.features)) {
      console.error(
        `ERR_INTERNAL_FAIL: [Boundaries] barangays/${provinceIndex}.geojson has no features array`,
      );
      return null;
    }
    features = toBoundaryFeatures(parsed.features);
  } catch (error) {
    console.error(
      `ERR_INTERNAL_FAIL: [Boundaries] Failed to load barangays/${provinceIndex}.geojson:`,
      error,
    );
    return null;
  }
  const indexed = buildIndex(features);
  barangayCache.set(provinceIndex, indexed);
  while (barangayCache.size > MAX_CACHED_BARANGAY_PROVINCES) {
    const oldest = barangayCache.keys().next();
    if (oldest.done) break;
    barangayCache.delete(oldest.value);
  }
  return indexed;
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
 * @returns {number} Containing feature index, or -1 when none contains the point.
 */
function findContainingIndex(
  level: IndexedLevel,
  candidates: number[],
  lng: number,
  lat: number,
): number {
  for (const index of candidates) {
    if (!bboxHits(level.bboxes[index], lng, lat)) continue;
    const feature = level.features[index];
    if (geometryContains(feature.geometry, lng, lat)) return index;
  }
  return -1;
}

function gridCandidates(level: IndexedLevel, lng: number, lat: number): number[] {
  return level.grid.get(cellKey(Math.floor(lng / CELL_SIZE), Math.floor(lat / CELL_SIZE))) ?? [];
}

/**
 * Resolves province/city/barangay names for a coordinate pair.
 * The barangay scan is scoped to the PIP-matched province's file (loaded on
 * demand into the LRU); a missing province or unreadable file yields brgy null.
 * @param {number} lng - Point longitude.
 * @param {number} lat - Point latitude.
 * @returns {AdminResolution} Resolved names (null when outside every polygon).
 */
export function resolveAdmin(lng: number, lat: number): AdminResolution {
  const none: AdminResolution = { province: null, city: null, brgy: null };
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return none;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return none;

  const indexes = getEagerIndexes();

  const provinceIndex = findContainingIndex(
    indexes.province,
    gridCandidates(indexes.province, lng, lat),
    lng,
    lat,
  );
  // Independent cities (province: null) sit outside any province polygon, so a
  // missing province must not block the city lookup below (barangay still
  // needs a province file, so it stays null in that case).
  const province =
    provinceIndex >= 0 ? featureName(indexes.province.features[provinceIndex]) || null : null;

  const cityIndex = findContainingIndex(
    indexes.city,
    gridCandidates(indexes.city, lng, lat),
    lng,
    lat,
  );
  if (cityIndex < 0) return { ...none, province };
  const city = featureName(indexes.city.features[cityIndex]) || null;
  if (!city) return { ...none, province };

  if (provinceIndex < 0) return { ...none, province, city };
  const barangays = getProvinceBarangays(provinceIndex);
  if (!barangays) return { province, city, brgy: null };

  // Barangay polygons are disjoint, so the grid-prefiltered candidates are
  // exact and cheap — scoped by geometry (not by city name).
  const brgyIndex = findContainingIndex(
    barangays,
    gridCandidates(barangays, lng, lat),
    lng,
    lat,
  );
  return {
    province,
    city,
    brgy: brgyIndex >= 0 ? featureName(barangays.features[brgyIndex]) || null : null,
  };
}

/**
 * Returns the boundary feature(s) matching a name for highlight rendering.
 * Provinces/cities match against the eager indexes; barangays use the
 * manifest to load only the province file(s) that hold the name.
 * @param {BoundaryLevel} level - Which boundary level to search.
 * @param {string} name - Exact feature name (e.g. a resolved province/city).
 * @param {string} [city] - Optional parent city to disambiguate barangay names.
 * @param {string} [province] - Optional parent province to disambiguate city/barangay names.
 * @returns {BoundaryFeatureCollection} Matching features (empty when none).
 */
export function getBoundary(
  level: BoundaryLevel,
  name: string,
  city?: string,
  province?: string,
): BoundaryFeatureCollection {
  const empty: BoundaryFeatureCollection = { type: "FeatureCollection", features: [] };
  const wanted = name?.trim();
  if ((level !== "province" && level !== "city" && level !== "barangay") || !wanted) {
    return empty;
  }
  if (level === "province" || level === "city") {
    const { features } = getEagerIndexes()[level];
    const wantedProvince = province?.trim() ?? "";
    return {
      type: "FeatureCollection",
      features: features.filter(
        (feature) =>
          featureName(feature) === wanted &&
          (!wantedProvince ||
            areaNamesMatch(String(feature.properties?.province ?? ""), wantedProvince)),
      ),
    };
  }

  // Barangay: the manifest says which province file(s) hold this name, so only
  // those files are read (through the LRU) instead of scanning all 88.
  const wantedCity = city?.trim() ?? "";
  const manifest = getBarangayManifest();
  const normName = normalizeName(wanted);
  const normCity = normalizeName(wantedCity);
  if (!normName) return empty;
  let candidateIndices: number[];
  if (normCity) {
    const scoped = manifest.nameCityToProvinces.get(`${normName}|${normCity}`);
    candidateIndices =
      scoped && scoped.length > 0
        ? [...scoped]
        : [...(manifest.nameToProvinces.get(normName) ?? [])];
  } else {
    candidateIndices = [...(manifest.nameToProvinces.get(normName) ?? [])];
  }
  if (candidateIndices.length === 0) return empty;

  const matches: BoundaryFeature[] = [];
  for (const provinceIndex of candidateIndices) {
    const barangays = getProvinceBarangays(provinceIndex);
    if (!barangays) continue;
    for (const feature of barangays.features) {
      if (normalizeName(featureName(feature)) === normName) matches.push(feature);
    }
  }
  const wantedProvince = province?.trim() ?? "";
  if (normCity || wantedProvince) {
    // City/province strings differ between the CITIES source ("Dagupan City")
    // and the barangay source ("Dagupan"), so compare tolerantly. Hints are
    // strict: when supplied and nothing survives, return empty (showing
    // nothing is correct; showing other regions is not).
    const scoped = matches.filter(
      (feature) =>
        (!normCity ||
          areaNamesMatch(String(feature.properties?.city ?? ""), wantedCity)) &&
        (!wantedProvince ||
          areaNamesMatch(String(feature.properties?.province ?? ""), wantedProvince)),
    );
    if (scoped.length === 0) {
      console.warn(
        `ERR_NOT_FOUND: [Boundaries] no match for barangay "${wanted}"` +
          (normCity ? ` in city "${wantedCity}"` : "") +
          (wantedProvince ? ` in province "${wantedProvince}"` : "") +
          ` (${matches.length} same-named candidate(s) rejected by hints)`,
      );
    }
    return { type: "FeatureCollection", features: scoped };
  }
  return { type: "FeatureCollection", features: matches };
}

export interface ScopeArea {
  level: BoundaryLevel;
  name: string;
  /** Parent province hint — required for a barangay entry, also disambiguates same-named cities. */
  parentProvince?: string;
  /** Parent city hint — disambiguates same-named barangays. */
  parentCity?: string;
}

export interface ScopeBoundaryResult {
  featureCollection: BoundaryFeatureCollection;
  resolved: ScopeArea[];
  unresolved: ScopeArea[];
}

/**
 * Builds the dedupe key for one scope entry. Names are compared tolerantly
 * ("Dagupan City" vs "dagupan") so the same territory listed twice under
 * different spellings still collapses to one entry instead of double-drawing.
 * @param {ScopeArea} area - Dealer scope entry.
 * @returns {string} Normalized level + name + parents key.
 */
function scopeAreaKey(area: ScopeArea): string {
  const level = typeof area?.level === "string" ? area.level : "";
  const name = typeof area?.name === "string" ? area.name : "";
  const city = typeof area?.parentCity === "string" ? area.parentCity : "";
  const province = typeof area?.parentProvince === "string" ? area.parentProvince : "";
  return `${level}|${normalizeArea(name)}|${normalizeArea(city)}|${normalizeArea(province)}`;
}

/**
 * Merges every area of a dealer's scope into ONE FeatureCollection; never throws.
 * Each entry resolves through the standard `getBoundary` path (so province/city
 * eager indexes and the barangay manifest + LRU are reused, not reimplemented);
 * entries with no geometry land in `unresolved` for the "not drawn" notice.
 * @param {ScopeArea[]} areas - A dealer's assigned territory entries.
 * @returns {ScopeBoundaryResult} Merged collection (input order) + resolved/unresolved split.
 */
export function getScopeBoundary(areas: ScopeArea[]): ScopeBoundaryResult {
  const none: ScopeBoundaryResult = {
    featureCollection: { type: "FeatureCollection", features: [] },
    resolved: [],
    unresolved: [],
  };
  if (!Array.isArray(areas) || areas.length === 0) return none;

  const seen = new Set<string>();
  const resolved: ScopeArea[] = [];
  const unresolved: ScopeArea[] = [];
  const features: BoundaryFeatureCollection["features"] = [];
  for (const area of areas) {
    const key = scopeAreaKey(area);
    if (seen.has(key)) continue;
    seen.add(key);
    let collection: BoundaryFeatureCollection;
    try {
      collection = getBoundary(area.level, area.name, area.parentCity, area.parentProvince);
    } catch {
      // Unknown/malformed names must degrade to "unresolved", never 500 the scope route.
      unresolved.push(area);
      continue;
    }
    if (collection.features.length > 0) {
      resolved.push(area);
      features.push(...collection.features);
    } else {
      unresolved.push(area);
    }
  }
  return {
    featureCollection: { type: "FeatureCollection", features },
    resolved,
    unresolved,
  };
}
