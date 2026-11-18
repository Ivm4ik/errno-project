"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { LogOut, Monitor, Moon, Settings2, Sun } from "lucide-react";
import { MenuLabel, MenuSeparator, Popover } from "@/components/ui/popover";
import { IconButton } from "@/components/ui/primitives";
import { useLocale } from "@/lib/locale";
import { setThemePreference, useTheme, type ThemePreference } from "@/lib/theme";
import { useAuth } from "@/lib/auth";

/** Language, theme, sign-out. */
export function SettingsMenu() {
  const { preference } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();

  const themes: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("common.themeLight"), icon: Sun },
    { value: "dark", label: t("common.themeDark"), icon: Moon },
    { value: "system", label: t("common.themeSystem"), icon: Monitor },
  ];

  return (
    <Popover
      width="17rem"
      trigger={({ toggle, open, ...aria }) => (
        <IconButton onClick={toggle} active={open} aria-label={t("common.settings")} title={t("common.settings")} {...aria}>
          <Settings2 />
        </IconButton>
      )}
    >
      <MenuLabel>{t("lang.switch")}</MenuLabel>
      <div role="radiogroup" aria-label={t("lang.switch")} className="grid grid-cols-2 gap-1 px-1 pb-1">
        {([
          { value: "uk" as const, label: t("lang.uk") },
          { value: "en" as const, label: t("lang.en") },
        ]).map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={locale === value}
            onClick={() => setLocale(value)}
            className={clsx(
              "rounded-lg py-2 text-[12px] font-medium transition-colors",
              locale === value ? "bg-accent/10 text-accent ring-1 ring-accent/25 ring-inset" : "text-muted hover:bg-overlay/[0.05] hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <MenuSeparator />
      <MenuLabel>{t("common.theme")}</MenuLabel>
      <div role="radiogroup" aria-label={t("common.theme")} className="grid grid-cols-3 gap-1 px-1 pb-1">
        {themes.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={preference === value}
            onClick={() => setThemePreference(value)}
            className={clsx(
              "flex flex-col items-center gap-1 rounded-lg py-2 text-[12px] font-medium transition-colors",
              preference === value ? "bg-accent/10 text-accent ring-1 ring-accent/25 ring-inset" : "text-muted hover:bg-overlay/[0.05] hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      <MenuSeparator />
      <MenuLabel>{user?.name ?? user?.login}</MenuLabel>
      <button
        type="button"
        onClick={() => { logout(); router.replace("/login"); }}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition-colors hover:bg-overlay/[0.05] hover:text-ink"
      ><LogOut className="size-4"/>{t("common.switchAccount")}</button>

    </Popover>
  );
}
