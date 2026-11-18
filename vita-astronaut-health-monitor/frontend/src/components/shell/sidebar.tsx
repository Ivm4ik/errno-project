"use client";

import clsx from "clsx";
import { Loader2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, memo, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { Kbd } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/locale";
import { isActivePath, navSectionsForRole, type NavItem } from "@/lib/navigation";
import { toggleSidebar, useSidebarCollapsed } from "@/lib/preferences";
import { Wordmark } from "./wordmark";

/**
 * Desktop sidebar: wordmark, personal navigation and uplink.
 * Collapses to a 60px icon rail. Live parts (clock, rates) are isolated leaf components, so
 * the sidebar itself does not re-render on every telemetry packet.
 */
export function Sidebar() {
  return (
    <aside
      aria-label="Sidebar"
      className="sticky top-0 z-30 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-panel)_90%,var(--sidebar-tint)),var(--color-panel))] transition-[width] duration-200 ease-[var(--ease-out-quint)] lg:flex collapsed:w-[60px]"
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 overflow-hidden px-5 collapsed:justify-center collapsed:gap-0 collapsed:px-0">
        <Link href="/" aria-label="ERRNO" className="min-w-0 rounded-md collapsed:hidden">
          <SidebarWordmark />
        </Link>
        <SidebarToggle />
      </div>

      <Suspense fallback={<NavList pathname={null} />}>
        <ActiveNav />
      </Suspense>
    </aside>
  );
}


function SidebarWordmark() {
  const collapsed = useSidebarCollapsed();
  return <Wordmark rail={collapsed} />;
}

/** One control in the header — collapse when open, expand when rail. */
function SidebarToggle() {
  const collapsed = useSidebarCollapsed();
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={`${collapsed ? "Expand" : "Collapse"} sidebar ( [ )`}
      className="grid size-8 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-overlay/[0.08] hover:text-ink"
    >
      <Icon className="size-4" />
    </button>
  );
}

function ActiveNav() {
  return <NavList pathname={usePathname()} />;
}

function activeHref(items: NavItem[], pathname: string | null) {
  return items
    .filter((item) => isActivePath(item.href, pathname))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/** Navigation list, shared by the desktop sidebar and the mobile drawer. */
export function NavList({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  const { user } = useAuth();
  const t = useT();
  const sections = navSectionsForRole(user?.role);
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  // Optimistic highlight: the clicked item lights up immediately instead of waiting for the next
  // route to render. It only applies while we are still on the page the click came from.
  const [pending, setPending] = useState<{ href: string; from: string | null } | null>(null);
  const navigating = pending !== null && pending.from === pathname;
  const current = navigating ? pending.href : pathname;


  // Sliding active indicator: positioned by writing styles directly (no React re-render), and
  // re-placed whenever the nav resizes (sidebar collapse, font load).
  useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;

    const place = () => {
      const active = nav.querySelector<HTMLElement>('[data-nav-active="true"]');
      if (!active) {
        pill.style.opacity = "0";
        return;
      }
      pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      pill.style.width = `${active.offsetWidth}px`;
      pill.style.height = `${active.offsetHeight}px`;
      pill.style.opacity = "1";
    };

    place();
    // Animate moves only after the first placement, so the page doesn't load with a slide.
    const frame = requestAnimationFrame(() => (pill.dataset.ready = "true"));
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [current]);

  return (
    <nav ref={navRef} aria-label="Main" className="relative min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-1 collapsed:overflow-visible collapsed:px-2">
      <span
        ref={pillRef}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 rounded-md bg-overlay/[0.06] opacity-0 data-[ready=true]:transition-[transform,width,height,opacity] data-[ready=true]:duration-200 data-[ready=true]:ease-[var(--ease-out-quint)]"
      />
      {sections.map((section) => (
        <div key={section.titleKey}>
          <p className="mb-1 px-2.5 text-[11.5px] font-medium text-faint collapsed:invisible collapsed:mb-0 collapsed:h-0">{t(section.titleKey)}</p>
          <ul className="space-y-px">
            {section.items.map((item) => (
              <li key={item.href}>
                <NavLink
                  item={item}
                  label={t(item.labelKey)}
                  active={item.href === activeHref(section.items, current)}
                  loading={navigating && pending.href === item.href}
                  onClick={(e) => {
                    onNavigate?.();
                    // Let modified clicks (new tab/window) behave natively.
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    if (!isActivePath(item.href, pathname)) setPending({ href: item.href, from: pathname });
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

const NavLink = memo(function NavLink({
  item: { href, icon: Icon, key },
  label,
  active,
  loading,
  onClick,
}: {
  item: NavItem;
  label: string;
  active: boolean;
  loading: boolean;
  onClick: (e: MouseEvent) => void;
}) {
  return (
    <Link
      href={href}
      data-nav-active={active}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={clsx(
        "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors duration-150 collapsed:justify-center collapsed:px-0",
        active ? "font-medium text-ink" : "text-muted hover:bg-overlay/[0.035] hover:text-ink",
      )}
    >
      <span className="relative">
        <Icon
          className={clsx("size-4 shrink-0 transition-colors", active ? "text-ink" : "text-faint group-hover:text-muted")}
          aria-hidden
          strokeWidth={active ? 2.1 : 1.8}
        />
      </span>
      <span className="truncate collapsed:hidden">{label}</span>
      {loading ? (
        <Loader2 className="ml-auto size-3.5 animate-spin text-faint collapsed:hidden" aria-label="Loading" />
      ) : (
        <span className="ml-auto hidden items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 lg:flex collapsed:!hidden">
          <Kbd className="!h-[18px] !min-w-[18px] !text-[10px]">G</Kbd>
          <Kbd className="!h-[18px] !min-w-[18px] !text-[10px] uppercase">{key}</Kbd>
        </span>
      )}

      {/* Tooltip in the collapsed rail. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full z-50 ml-3 hidden translate-x-[-4px] rounded-md bg-ink px-2 py-1 text-xs font-medium whitespace-nowrap text-canvas opacity-0 shadow-[var(--shadow-pop)] transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 collapsed:block"
      >
        {label}
      </span>
    </Link>
  );
});

