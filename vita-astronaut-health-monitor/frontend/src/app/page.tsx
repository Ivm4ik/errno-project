"use client";

import { RoleGate } from "@/components/auth/role-gate";
import { AstronautConsole } from "@/components/mission/astronaut-console";
import { useAuth } from "@/lib/auth";

export default function OverviewPage() {
  return (
    <RoleGate roles={["astronaut"]}>
      <Home />
    </RoleGate>
  );
}

function Home() {
  const { user } = useAuth();
  const id = user?.astronaut_id ?? "";
  return <AstronautConsole astronautId={id} />;
}
