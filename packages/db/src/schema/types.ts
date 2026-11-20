import { customType } from "drizzle-orm/pg-core";

/** WGS 84 everywhere (PLAN §6). */
export const SRID = 4326;

type GeometryType = "Geometry" | "Point" | "Polygon" | "MultiPolygon";

/**
 * PostGIS geometry column. Values travel as EWKT/WKB strings; read GeoJSON with
 * `ST_AsGeoJSON(...)` and write with `ST_GeomFromGeoJSON(...)` / `ST_GeomFromText(..., 4326)`.
 */
export const geometry = (name: string, type: GeometryType = "Geometry") =>
  customType<{ data: string; driverData: string }>({
    dataType: () => `geometry(${type},${SRID})`,
  })(name);

export const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});
