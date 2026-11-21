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
}
