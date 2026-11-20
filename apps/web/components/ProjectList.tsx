import type { ProjectListItem } from "@mdu/db";
import { useFormatter, useTranslations } from "next-intl";
import { STATUS_COLOURS } from "@/lib/status";

/** Every project is reachable as a plain list, including those not on the map (PLAN §8). */
export function ProjectList({ projects }: { projects: ProjectListItem[] }) {
  const t = useTranslations("City");
  const status = useTranslations("Status");
  const kind = useTranslations("Kind");
  const format = useFormatter();

  if (projects.length === 0) return <p>{t("empty")}</p>;

  return (
    <ul className="project-list">
      {projects.map((p) => (
        <li key={p.id}>
          <span className="dot" style={{ background: STATUS_COLOURS[p.status] }} aria-hidden />
          <strong>{p.title}</strong>
          <span className="meta">
            {kind(p.kind)} · {status(p.status)}
            {p.eventDate
              ? ` · ${format.dateTime(new Date(`${p.eventDate}T12:00:00`), { dateStyle: "medium" })}`
              : ""}
          </span>
          <span className="meta">
            {p.address ?? t("noAddress")}
            {" · "}
            {p.hasLocation
              ? p.geomPrecision === "street"
                ? t("approximateLocation")
                : null
              : t("notOnMap")}
          </span>
          {(p.documents.length > 0 || p.sourceUrl) && (
            <details className="docs">
              <summary>{t("documents", { count: p.documents.length })}</summary>
              <ul>
                {p.documents.map((d) => (
                  <li key={d.url}>
                    <a href={d.url} rel="noopener noreferrer" target="_blank">
                      {d.label}
                    </a>
                  </li>
                ))}
              </ul>
              {p.sourceUrl && (
                <p className="source">
                  {t("source")}{" "}
                  <a href={p.sourceUrl} rel="noopener noreferrer" target="_blank">
                    {new URL(p.sourceUrl).hostname}
                  </a>
                </p>
              )}
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
