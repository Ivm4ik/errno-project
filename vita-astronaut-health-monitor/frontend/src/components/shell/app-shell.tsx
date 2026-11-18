"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Drawer } from "@/components/ui/dialog";
import { roleHome, useAuth } from "@/lib/auth";
import { useT } from "@/lib/locale";
import { LoadingBar } from "./loading-bar";
import { ShortcutsDialog, useGlobalShortcuts } from "./shortcuts";
import { NavList, Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { Wordmark } from "./wordmark";

/** Root shell — Suspense so usePathname does not block prerender. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <AppShellInner>{children}</AppShellInner>
    </Suspense>
  );
}

function ShellFallback() {
  return <div className="grid min-h-dvh place-items-center text-sm text-muted">…</div>;
}

function AppShellInner({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, ready } = useAuth();
  const t = useT();

  useEffect(() => {
    if (!ready) return;
    if (pathname === "/login") {
      if (user) router.replace(roleHome(user.role));
    } else if (!user) router.replace("/login");
  }, [pathname, ready, user, router]);

  useGlobalShortcuts({
    onPalette: () => {},
    onHelp: () => setShortcutsOpen(true),
  });

  if (pathname === "/login") return <>{children}</>;
  if (!ready || !user) return <div className="grid min-h-dvh place-items-center text-sm text-muted">{t("common.loading")}</div>;

  return (
    <div className="flex min-h-dvh">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenNav={() => setNavOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        <footer className="border-t border-line/60 px-4 py-4 text-center font-mono text-[10px] tracking-wider text-faint uppercase sm:px-6 lg:px-8">
          {t("footer.disclaimer")}
        </footer>
      </div>

      <Drawer open={navOpen} onClose={() => setNavOpen(false)} side="left" width="17rem" label="Navigation">
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center px-5">
            <Wordmark />
          </div>
          <Suspense fallback={<NavList pathname={null} />}>
            <DrawerNav onNavigate={() => setNavOpen(false)} />
          </Suspense>
        </div>
      </Drawer>

      <LoadingBar />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function DrawerNav({ onNavigate }: { onNavigate: () => void }) {
  return <NavList pathname={usePathname()} onNavigate={onNavigate} />;
}
