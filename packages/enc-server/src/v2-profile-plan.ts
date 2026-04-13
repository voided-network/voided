/**
 * Planning-only metadata for the fused-first Voided v2 preset and role-alias
 * migration.
 *
 * This file captures the fused-first preset and policy surface for Voided v2.
 * Keeping these ids and defaults in source gives downstream consumers one
 * place to align on names while the runtime surfaces settle.
 */

export type VoidedV2PresetId =
  | "fused.compact.v2"
  | "fused.balanced.v2"
  | "fused.concealed.v2";

export type VoidedV2PresetAlias =
  | "compact"
  | "balanced"
  | "concealed";

export type VoidedV2RoleAlias =
  | "default"
  | "high-security"
  | "low-overhead";

export type VoidedV2PresetSupport = "stable";
export type VoidedV2PresetStatus = "planned";

export interface VoidedV2PresetPlanEntry {
  id: VoidedV2PresetId;
  alias: VoidedV2PresetAlias;
  roleAliases: readonly VoidedV2RoleAlias[];
  support: VoidedV2PresetSupport;
  status: VoidedV2PresetStatus;
  pipeline: "compression->encryption->fused-shell";
  internalShell:
    | "FusedPrefixShell"
    | "FusedReactiveShell"
    | "FusedScheduledShell";
  summary: string;
  notes: readonly string[];
}

export const VOIDED_V2_PRESET_PLAN = [
  {
    id: "fused.compact.v2",
    alias: "compact",
    roleAliases: ["low-overhead"],
    support: "stable",
    status: "planned",
    pipeline: "compression->encryption->fused-shell",
    internalShell: "FusedPrefixShell",
    summary: "Lowest-overhead stable fused preset.",
    notes: [
      "Maps directly to the frozen compact fused preset.",
      "Useful when overhead matters more than concealment variety.",
    ],
  },
  {
    id: "fused.balanced.v2",
    alias: "balanced",
    roleAliases: ["default"],
    support: "stable",
    status: "planned",
    pipeline: "compression->encryption->fused-shell",
    internalShell: "FusedReactiveShell",
    summary: "Default fused preset for normal Voided product traffic.",
    notes: [
      "Maps directly to the frozen balanced fused preset.",
      "Recommended default write preset for Slipner.",
    ],
  },
  {
    id: "fused.concealed.v2",
    alias: "concealed",
    roleAliases: ["high-security"],
    support: "stable",
    status: "planned",
    pipeline: "compression->encryption->fused-shell",
    internalShell: "FusedScheduledShell",
    summary: "Heavier stable fused preset with more concealment variation.",
    notes: [
      "Maps directly to the frozen concealed fused preset.",
      "Recommended high-security role alias.",
    ],
  },
]
  as const satisfies readonly VoidedV2PresetPlanEntry[];

const PRESET_ALIAS_MAP: Readonly<Record<VoidedV2PresetAlias, VoidedV2PresetId>> = {
  compact: "fused.compact.v2",
  balanced: "fused.balanced.v2",
  concealed: "fused.concealed.v2",
};

const ROLE_ALIAS_MAP: Readonly<Record<VoidedV2RoleAlias, VoidedV2PresetId>> = {
  default: "fused.balanced.v2",
  "high-security": "fused.concealed.v2",
  "low-overhead": "fused.compact.v2",
};

const PRESET_INDEX = new Map<VoidedV2PresetId, VoidedV2PresetPlanEntry>(
  VOIDED_V2_PRESET_PLAN.map((entry) => [entry.id, entry])
);

export function listVoidedV2Presets(): readonly VoidedV2PresetPlanEntry[] {
  return VOIDED_V2_PRESET_PLAN;
}

export function resolveVoidedV2Preset(
  preset: VoidedV2PresetId | VoidedV2PresetAlias | VoidedV2RoleAlias
): VoidedV2PresetPlanEntry | undefined {
  const presetId =
    PRESET_ALIAS_MAP[preset as VoidedV2PresetAlias] ??
    ROLE_ALIAS_MAP[preset as VoidedV2RoleAlias] ??
    preset;
  return PRESET_INDEX.get(presetId as VoidedV2PresetId);
}

export interface VoidedV2PolicyPlan {
  defaultWritePreset: VoidedV2PresetId;
  acceptedReadPresets: readonly VoidedV2PresetId[];
}

export const DEFAULT_VOIDED_V2_POLICY_PLAN: VoidedV2PolicyPlan = {
  defaultWritePreset: "fused.balanced.v2",
  acceptedReadPresets: [
    "fused.compact.v2",
    "fused.balanced.v2",
    "fused.concealed.v2",
  ],
};

export const HIGH_SECURITY_VOIDED_V2_POLICY_PLAN: VoidedV2PolicyPlan = {
  defaultWritePreset: "fused.concealed.v2",
  acceptedReadPresets: [
    "fused.compact.v2",
    "fused.balanced.v2",
    "fused.concealed.v2",
  ],
};
