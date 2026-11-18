import { Activity, Bell, Dumbbell, LayoutDashboard, Radio, Users, type LucideIcon } from "lucide-react";
import type { UserRole } from "@/lib/auth";
import type { TranslationKey } from "@/lib/translations";

/** Sidebar / drawer and command-palette navigation: one source of truth. */
export interface NavItem {
  href: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  /** Second key of the "g then …" shortcut. */
  key: string;
  /** Shown in the mobile bottom tab bar. */
  primary?: boolean;
}

const ASTRONAUT_ITEMS: NavItem[] = [
  { href: "/", labelKey: "nav.myHealth", icon: LayoutDashboard, key: "o", primary: true },
  { href: "/sensors", labelKey: "nav.sensors", icon: Activity, key: "s", primary: true },
  { href: "/training", labelKey: "nav.training", icon: Dumbbell, key: "t", primary: true },
];
const OFFICER_ITEMS: NavItem[] = [
  { href: "/captain", labelKey: "nav.watch", icon: LayoutDashboard, key: "c", primary: true },
  { href: "/sensors", labelKey: "nav.sensors", icon: Activity, key: "s", primary: true },
  { href: "/training", labelKey: "nav.training", icon: Dumbbell, key: "t", primary: true },
];
const MEDIC_ITEMS: NavItem[] = [
  { href: "/medic", labelKey: "nav.overview", icon: LayoutDashboard, key: "o", primary: true },
  { href: "/medic/crew", labelKey: "nav.crew", icon: Users, key: "a", primary: true },
  { href: "/medic/earth", labelKey: "nav.earth", icon: Radio, key: "e", primary: true },
  { href: "/medic/alerts", labelKey: "nav.alerts", icon: Bell, key: "l" },
];

export function navSectionsForRole(role: UserRole | undefined) {
  const items = role === "astronaut" ? ASTRONAUT_ITEMS : role === "officer" ? OFFICER_ITEMS : MEDIC_ITEMS;
  const titleKey: TranslationKey =
    role === "astronaut" ? "nav.section.astronaut" : role === "officer" ? "nav.section.officer" : "nav.section.medic";
  return [{ titleKey, items }];
}

export function navItemsForRole(role: UserRole | undefined) {
  return navSectionsForRole(role).flatMap((section) => section.items);
}

export const NAV_SECTIONS = navSectionsForRole(undefined);

export const NAV_ITEMS = navItemsForRole(undefined);

export const isActivePath = (href: string, pathname: string | null) =>
  pathname !== null && (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

/** The nav item a path belongs to (for breadcrumbs). */
export const navItemFor = (pathname: string | null) => NAV_ITEMS.find((item) => isActivePath(item.href, pathname));
