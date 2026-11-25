import type { Confidence } from "./enums.ts";

/** Every extracted value keeps the document and page it came from (CLAUDE.md). */
export interface Sourced<T> {
  value: T;
  source_document_id: string;
  page: number;
  confidence: Confidence;
  /** The city's copy of the document, for a link to the page (`#page=N`). */
  source_url?: string;
}

/** `project.indicators` jsonb (PLAN §6). All keys optional. */
export interface ProjectIndicators {
  site_area_m2?: Sourced<number>;
  pot_percent?: Sourced<number>;
  cut?: Sourced<number>;
  max_height_m?: Sourced<number>;
  height_regime?: Sourced<string>; // e.g. "P+4+R"
  main_functions?: Sourced<string[]>;
  dwellings?: Sourced<number>;
  parking_spaces?: Sourced<number>;
  green_space_percent?: Sourced<number>;
  setbacks?: Sourced<string>;
  /** How the map location was found (M3.4): the plan's own coordinates or a house number. */
  location?: Omit<Sourced<"parcel" | "address">, "page" | "source_document_id"> & {
    method: string;
    page: number | null;
    source_document_id: string | null;
  };
  /** Where `summary_ro`/`summary_en` came from (M4.2): the document the summary mostly relies
   * on, and the model and prompt that wrote it. */
  summary?: Omit<Sourced<"generated">, "page"> & {
    page: number | null;
    model: string;
    prompt_version: string;
  };
}

/** Display order of the indicators on cards and project pages (PLAN §6). */
export const INDICATOR_ORDER = [
  "height_regime",
  "max_height_m",
  "pot_percent",
  "cut",
  "dwellings",
  "parking_spaces",
  "green_space_percent",
  "site_area_m2",
] as const satisfies readonly (keyof ProjectIndicators)[];

export type CardFigure = (typeof INDICATOR_ORDER)[number];
