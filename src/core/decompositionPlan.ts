export type DynamicDecompositionUnitType =
  | "text_file"
  | "config_file"
  | "documentation_file"
  | "analysis_step"
  | "execution_step"
  | "verification_step";

export type DynamicDecompositionGenerationMode = "materialize_text_file" | "plan_only";

export interface DynamicDecompositionUnit {
  id: string;
  unit_type: DynamicDecompositionUnitType;
  title: string;
  purpose: string;
  generation_mode: DynamicDecompositionGenerationMode;
  target_path?: string;
  depends_on?: string[];
  verification_focus?: string[];
}

export interface DynamicDecompositionPlan {
  objective?: string;
  strategy?: string;
  rationale?: string;
  units: DynamicDecompositionUnit[];
}

export function parseDynamicDecompositionPlan(value: unknown): DynamicDecompositionPlan | undefined {
  const candidate = unwrapDynamicDecompositionPlanCandidate(value);
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }

  const record = candidate as Record<string, unknown>;
  const units = Array.isArray(record.units)
    ? record.units
        .map((item) => parseDynamicDecompositionUnit(item))
        .filter((item): item is DynamicDecompositionUnit => Boolean(item))
    : [];

  if (units.length === 0) {
    return undefined;
  }

  return {
    objective: asOptionalString(record.objective),
    strategy: asOptionalString(record.strategy),
    rationale: asOptionalString(record.rationale),
    units
  };
}

export function buildDynamicDecompositionPlan(params: {
  objective?: string;
  strategy?: string;
  rationale?: string;
  units: DynamicDecompositionUnit[];
}): DynamicDecompositionPlan {
  return {
    objective: params.objective,
    strategy: params.strategy,
    rationale: params.rationale,
    units: params.units
  };
}

function parseDynamicDecompositionUnit(value: unknown): DynamicDecompositionUnit | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = asOptionalString(record.id);
  const title = asOptionalString(record.title) || asOptionalString(record.name);
  const purpose = asOptionalString(record.purpose) || asOptionalString(record.summary);
  if (!id || !title || !purpose) {
    return undefined;
  }

  const unitType = normalizeUnitType(record.unit_type ?? record.type);
  const generationMode = normalizeGenerationMode(record.generation_mode ?? record.mode);
  if (!unitType || !generationMode) {
    return undefined;
  }

  return {
    id,
    unit_type: unitType,
    title,
    purpose,
    generation_mode: generationMode,
    target_path: asOptionalString(record.target_path) || asOptionalString(record.path),
    depends_on: asOptionalStringArray(record.depends_on) || asOptionalStringArray(record.dependsOn),
    verification_focus:
      asOptionalStringArray(record.verification_focus) || asOptionalStringArray(record.verificationFocus)
  };
}

function unwrapDynamicDecompositionPlanCandidate(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.units)) {
    return record;
  }
  if (record.decomposition_plan && typeof record.decomposition_plan === "object") {
    return record.decomposition_plan;
  }
  if (record.plan && typeof record.plan === "object") {
    return record.plan;
  }
  return value;
}

function normalizeUnitType(value: unknown): DynamicDecompositionUnitType | undefined {
  const normalized = asOptionalString(value);
  switch (normalized) {
    case "text_file":
    case "config_file":
    case "documentation_file":
    case "analysis_step":
    case "execution_step":
    case "verification_step":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeGenerationMode(value: unknown): DynamicDecompositionGenerationMode | undefined {
  const normalized = asOptionalString(value);
  switch (normalized) {
    case "materialize_text_file":
    case "plan_only":
      return normalized;
    default:
      return undefined;
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return normalized.length > 0 ? normalized : undefined;
}
