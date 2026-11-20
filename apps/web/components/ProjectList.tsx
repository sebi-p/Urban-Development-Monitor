import type { ProjectFeature } from "@mdu/db";
import { useTranslations } from "next-intl";
import { STATUS_COLOURS } from "@/lib/status";

/** Every map result is also reachable as a plain list (PLAN §8, WCAG 2.2 AA). */
export function ProjectList({ features }: { features: ProjectFeature[] }) {
  const t = useTranslations("City");
  const status = useTranslations("Status");
  const kind = useTranslations("Kind");

  if (features.length === 0) return <p>{t("empty")}</p>;

  return (
    <ul className="project-list">
      {features.map((f) => (
        <li key={f.id}>
          <span
            className="dot"
            style={{ background: STATUS_COLOURS[f.properties.status] }}
            aria-hidden
          />
          <strong>{f.properties.title}</strong>
          <span className="meta">
            {kind(f.properties.kind)} · {status(f.properties.status)}
            {f.properties.address ? ` · ${f.properties.address}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
