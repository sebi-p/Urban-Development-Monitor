import type { ProjectStatus } from "@mdu/shared";
import { useTranslations } from "next-intl";
import { GROUP_COLOUR, GROUP_ICON, GROUP_TEXT, STATUS_GROUP } from "@/lib/status";
import { cn } from "@/lib/utils";

/** Status as an icon plus a label in the group's colour: never colour alone. */
export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const t = useTranslations("Status");
  const group = STATUS_GROUP[status];
  const Icon = GROUP_ICON[group];
  const colour = GROUP_COLOUR[group];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        className,
      )}
      style={{
        color: GROUP_TEXT[group],
        backgroundColor: `${colour}14`,
        boxShadow: `inset 0 0 0 1px ${colour}33`,
      }}
    >
      <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
      {t(status)}
    </span>
  );
}
