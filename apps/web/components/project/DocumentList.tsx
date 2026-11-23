import type { ProjectDocumentLink } from "@mdu/db";
import { ExternalLink, FileText } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

/** The official documents: name, type, date and size, each opening the city's own copy. */
export function DocumentList({ documents }: { documents: ProjectDocumentLink[] }) {
  const t = useTranslations("Project");
  const docType = useTranslations("DocType");
  const format = useFormatter();
  if (documents.length === 0) return <p className="text-sm text-slate-600">{t("noDocuments")}</p>;
  return (
    <>
      <ul className="documents divide-y divide-slate-100 rounded-[var(--radius-card)] border border-slate-200 bg-white">
        {documents.map((d) => {
          const name = d.label ?? docType(d.role ?? "other");
          const meta = [
            d.label && d.role && d.role !== "other" ? docType(d.role) : null,
            d.date
              ? format.dateTime(new Date(`${d.date}T12:00:00`), { dateStyle: "medium" })
              : null,
            d.size_bytes
              ? format.number(d.size_bytes / 1_048_576, {
                  style: "unit",
                  unit: "megabyte",
                  maximumFractionDigits: 1,
                })
              : null,
          ].filter(Boolean);
          return (
            <li key={d.url}>
              <a
                href={d.url}
                rel="noopener noreferrer"
                target="_blank"
                className="flex min-h-11 items-start gap-3 px-4 py-3 text-slate-900 hover:bg-slate-50 hover:no-underline"
              >
                <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-accent-700">{name}</span>
                  {meta.length > 0 && (
                    <span className="block text-xs text-slate-500">{meta.join(" · ")}</span>
                  )}
                </span>
                <ExternalLink aria-hidden className="mt-1 size-3.5 shrink-0 text-slate-400" />
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-slate-500">{t("documentsNote")}</p>
    </>
  );
}
