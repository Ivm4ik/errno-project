"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { roleHome, useAuth, type UserRole } from "@/lib/auth";
import { useT } from "@/lib/locale";

export function RoleGate({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const t = useT();
  const { user, ready } = useAuth();
  const router = useRouter();
  const allowed = Boolean(user && roles.includes(user.role));
  useEffect(() => {
    if (ready && user && !allowed) router.replace(roleHome(user.role));
  }, [allowed, ready, user, router]);
  if (!ready || !user || !allowed) return <div className="grid min-h-48 place-items-center text-sm text-muted">{t("common.loading")}</div>;
  return <>{children}</>;
}
