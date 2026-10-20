import { Languages } from "lucide-react";
import { useTranslation } from "@/i18n";

/** Small, accessible control that remains usable in both LTR and RTL layouts. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n } = useTranslation();
  const arabic = i18n.language.startsWith("ar");
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm" role="group" aria-label={arabic ? "اختيار اللغة" : "Choose language"}>
      <Languages className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      {!compact && <span className="min-w-0 flex-1">{arabic ? "اللغة" : "Language"}</span>}
      <div className="flex items-center rounded-md border border-border bg-background p-0.5" dir="ltr">
        <button type="button" lang="ar" aria-pressed={arabic} onClick={() => void i18n.changeLanguage("ar")}
          className={`rounded px-2 py-1 text-xs transition-colors ${arabic ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
          العربية
        </button>
        <button type="button" lang="en" aria-pressed={!arabic} onClick={() => void i18n.changeLanguage("en")}
          className={`rounded px-2 py-1 text-xs transition-colors ${!arabic ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
          English
        </button>
      </div>
    </div>
  );
}
