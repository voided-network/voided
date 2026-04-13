/**
 * Planning-only metadata for the fused-first Voided v2 migration.
 *
 * This file intentionally captures the target profile and policy surface before
 * the fused-shell runtime is promoted into the package. Keeping these ids and
 * defaults in source gives downstream consumers one place to align on names
 * during the migration.
 */

export type VoidedV2ProfileId =
  | "fused.default.v2"
  | "fused.hardened.v2"
  | "fused.structured.v2"
  | "map.legacy.v1";

export type VoidedV2ProfileAlias =
  | "default"
  | "high-security"
  | "experimental-fused-structured"
  | "legacy-map";

export type VoidedV2ProfileSupport = "stable" | "experimental" | "legacy";
export type VoidedV2ProfileStatus = "planned" | "compat";

export interface VoidedV2ProfilePlanEntry {
  id: VoidedV2ProfileId;
  alias: VoidedV2ProfileAlias;
  support: VoidedV2ProfileSupport;
  status: VoidedV2ProfileStatus;
  pipeline:
    | "compression->encryption->fused-shell"
    | "compression->encryption->map-shell";
  summary: string;
  notes: readonly string[];
}

export const VOIDED_V2_PROFILE_PLAN = [
  {
    id: "fused.default.v2",
    alias: "default",
    support: "stable",
    status: "planned",
    pipeline: "compression->encryption->fused-shell",
    summary: "Primary fused-first flow for normal Voided product traffic.",
    notes: [
      "Expected default write profile for Slipner.",
      "Replaces the current map-first product story.",
    ],
  },
  {
    id: "fused.hardened.v2",
    alias: "high-security",
    support: "stable",
    status: "planned",
    pipeline: "compression->encryption->fused-shell",
    summary: "Stable fused-first profile with heavier shell hardness.",
    notes: [
      "Intended for operators who want more shell overhead.",
      "Does not pull map shell back into the default stable path.",
    ],
  },
  {
    id: "fused.structured.v2",
    alias: "experimental-fused-structured",
    support: "experimental",
    status: "planned",
    pipeline: "compression->encryption->fused-shell",
    summary: "Experimental fused profile for structured or adaptive shell modes.",
    notes: [
      "Should remain opt-in until research and runtime validation settle.",
      "Not selected by default alias resolution.",
    ],
  },
  {
    id: "map.legacy.v1",
    alias: "legacy-map",
    support: "legacy",
    status: "compat",
    pipeline: "compression->encryption->map-shell",
    summary: "Compatibility lane for historical map-first artifacts and controlled writes.",
    notes: [
      "Readable during migration.",
      "Should not remain the main product-facing write path.",
    ],
  },
] as const satisfies readonly VoidedV2ProfilePlanEntry[];

const PROFILE_ALIAS_MAP: Readonly<Record<VoidedV2ProfileAlias, VoidedV2ProfileId>> = {
  default: "fused.default.v2",
  "high-security": "fused.hardened.v2",
  "experimental-fused-structured": "fused.structured.v2",
  "legacy-map": "map.legacy.v1",
};

const PROFILE_INDEX = new Map<VoidedV2ProfileId, VoidedV2ProfilePlanEntry>(
  VOIDED_V2_PROFILE_PLAN.map((entry) => [entry.id, entry])
);

export function listVoidedV2Profiles(): readonly VoidedV2ProfilePlanEntry[] {
  return VOIDED_V2_PROFILE_PLAN;
}

export function resolveVoidedV2Profile(
  profile: VoidedV2ProfileId | VoidedV2ProfileAlias
): VoidedV2ProfilePlanEntry | undefined {
  const profileId = PROFILE_ALIAS_MAP[profile as VoidedV2ProfileAlias] ?? profile;
  return PROFILE_INDEX.get(profileId as VoidedV2ProfileId);
}

export interface VoidedV2PolicyPlan {
  defaultWriteProfile: VoidedV2ProfileId;
  acceptedReadProfiles: readonly VoidedV2ProfileId[];
  allowExperimentalProfiles: boolean;
  allowLegacyWrites: boolean;
  repackLegacyOnRead: boolean;
}

export const DEFAULT_VOIDED_V2_POLICY_PLAN: VoidedV2PolicyPlan = {
  defaultWriteProfile: "fused.default.v2",
  acceptedReadProfiles: [
    "fused.default.v2",
    "fused.hardened.v2",
    "map.legacy.v1",
  ],
  allowExperimentalProfiles: false,
  allowLegacyWrites: false,
  repackLegacyOnRead: true,
};

export const HIGH_SECURITY_VOIDED_V2_POLICY_PLAN: VoidedV2PolicyPlan = {
  defaultWriteProfile: "fused.hardened.v2",
  acceptedReadProfiles: [
    "fused.default.v2",
    "fused.hardened.v2",
    "map.legacy.v1",
  ],
  allowExperimentalProfiles: false,
  allowLegacyWrites: false,
  repackLegacyOnRead: true,
};
