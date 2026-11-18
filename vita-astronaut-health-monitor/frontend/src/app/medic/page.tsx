"use client";

import { RoleGate } from "@/components/auth/role-gate";
import { MedicOverview } from "@/components/medic/overview";

export default function MedicPage() {
  return (
    <RoleGate roles={["doctor", "chief"]}>
      <MedicOverview />
    </RoleGate>
  );
}
