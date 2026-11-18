"use client";

import clsx from "clsx";
import { ArrowRight, Compass, Languages, Loader2, Rocket, ShieldCheck, Stethoscope, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/primitives";
import { roleHome, useAuth, useDemoAccounts, type DemoAccount, type UserRole } from "@/lib/auth";
import { useLocale, useT } from "@/lib/locale";
import { lastAccount } from "@/lib/session";

const ROLE_ORDER: UserRole[] = ["astronaut", "officer", "doctor", "chief"];
const ROLE_ICON: Record<UserRole, LucideIcon> = {
  astronaut: Rocket,
  officer: Compass,
  doctor: Stethoscope,
  chief: ShieldCheck,
};

const noopSubscribe = () => () => {};

/** First screen of the demo: pick who to be. No passwords; the choice is the sign-in. */
export default function LoginPage() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { select } = useAuth();
  const router = useRouter();
  const accounts = useDemoAccounts();
  const [entering, setEntering] = useState<string | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  // Browser-only values; the server snapshot keeps server and client markup identical.
  const last = useSyncExternalStore(noopSubscribe, lastAccount, () => null);

  const enter = async (account: DemoAccount) => {
    if (entering) return;
    setEntering(account.login);
    setFailed(null);
    try {
      const identity = await select(account.login);
      router.replace(roleHome(identity.role));
    } catch (cause) {
      setFailed(cause);
      setEntering(null);
    }
  };

  const list = [...(accounts.data ?? [])].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-canvas px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_480px_at_18%_-12%,color-mix(in_srgb,var(--color-accent)_18%,transparent),transparent_58%)]"
      />
      <button
        type="button"
        onClick={() => setLocale(locale === "uk" ? "en" : "uk")}
        aria-label={t("lang.switch")}
        className="absolute top-4 right-4 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[12px] font-medium text-muted transition-colors hover:text-ink"
      >
        <Languages className="size-3.5" aria-hidden />
        {locale === "uk" ? "UA" : "EN"}
      </button>

      <div className="relative w-full max-w-2xl">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <img src="/brand/errno-logo.png" alt="ERRNO" className="errno-logo h-12 w-auto" />
          <p className="font-mono text-[10px] tracking-[0.2em] text-muted uppercase">{t("login.missionTag")}</p>
        </div>

        <div className="mb-5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{t("login.pick.title")}</h1>
        </div>

        {accounts.isPending ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("login.pick.loading")}
          </div>
        ) : accounts.isError ? (
          <div className="space-y-3">
            <p role="alert" className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-center text-[12.5px] text-critical">
              {t("login.pick.error")}
            </p>
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => void accounts.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label={t("login.pick.title")}>
            {list.map((account) => {
              const Icon = ROLE_ICON[account.role];
              const busy = entering === account.login;
              return (
                <li key={account.login}>
                  <button
                    type="button"
                    onClick={() => void enter(account)}
                    disabled={entering !== null}
                    className={clsx(
                      "group relative flex w-full items-start gap-3.5 rounded-xl border bg-panel p-4 text-left shadow-[var(--shadow-sm)] transition-[border-color,box-shadow,transform] duration-150",
                      "hover:border-accent/50 hover:shadow-[var(--shadow-pop)] focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/20 focus-visible:outline-none",
                      "active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60",
                      last === account.login ? "border-accent/45" : "border-line",
                    )}
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14.5px] font-semibold">{account.name}</span>
                        {last === account.login ? (
                          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10.5px] font-medium text-accent">
                            {t("login.pick.last")}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10.5px] tracking-wider text-muted uppercase">
                        {t(`role.${account.role}`)}
                      </span>
                      <span className="mt-1.5 block text-[12.5px] leading-snug text-muted">{t(`login.role.${account.role}`)}</span>
                    </span>
                    <span className="mt-1 grid size-5 shrink-0 place-items-center text-faint transition-colors group-hover:text-accent">
                      {busy ? <Loader2 className="size-4 animate-spin" aria-label={t("login.pick.entering")} /> : <ArrowRight className="size-4" aria-hidden />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {failed ? (
          <p role="alert" className="mt-4 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-center text-[12.5px] text-critical">
            {failed instanceof Error ? failed.message : t("login.pick.error")}
          </p>
        ) : null}

        <div className="mt-6 space-y-1 text-center text-[12px] text-muted">
          <p>{t("login.footnote")}</p>
        </div>
      </div>
    </main>
  );
}
