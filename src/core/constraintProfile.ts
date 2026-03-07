import { createHash } from "node:crypto";

import { AutoResearchEvent, EventStream } from "./events.js";
import { LLMClient } from "./llm/client.js";
import { RunContextMemory } from "./memory/runContextMemory.js";
import { RunRecord } from "../types.js";
import {
  buildHeuristicConstraintProfile,
  ConstraintProfile,
  normalizeConstraintProfile
} from "./runConstraints.js";

const PROFILE_CACHE_KEY = "constraints.profile";

interface StoredConstraintProfile {
  fingerprint: string;
  profile: ConstraintProfile;
  updatedAt: string;
}

interface ResolveConstraintProfileInput {
  run: RunRecord;
  runContextMemory: RunContextMemory;
  llm: LLMClient;
  eventStream?: EventStream;
  node?: AutoResearchEvent["node"];
}

export async function resolveConstraintProfile(input: ResolveConstraintProfileInput): Promise<ConstraintProfile> {
  const fingerprint = buildConstraintFingerprint(input.run);
  const cached = await input.runContextMemory.get<StoredConstraintProfile>(PROFILE_CACHE_KEY);
  if (cached?.fingerprint === fingerprint && cached.profile) {
    return normalizeConstraintProfile(cached.profile, input.run.constraints);
  }

  const heuristicFallback = buildHeuristicConstraintProfile(input.run.constraints);
  if (input.run.constraints.length === 0) {
    await input.runContextMemory.put(PROFILE_CACHE_KEY, {
      fingerprint,
      profile: heuristicFallback,
      updatedAt: new Date().toISOString()
    });
    return heuristicFallback;
  }

  try {
    const completion = await input.llm.complete(buildConstraintPrompt(input.run), {
      systemPrompt: buildConstraintSystemPrompt()
    });
    const parsed = parseConstraintProfileResponse(completion.text, input.run.constraints);
    const profile = normalizeConstraintProfile(
      {
        ...parsed,
        source: "llm"
      },
      input.run.constraints
    );

    await input.runContextMemory.put(PROFILE_CACHE_KEY, {
      fingerprint,
      profile,
      updatedAt: new Date().toISOString()
    });
    return profile;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.eventStream?.emit({
      type: "OBS_RECEIVED",
      runId: input.run.id,
      node: input.node,
      payload: {
        text: `Constraint profile fallback: ${message}`
      }
    });
    await input.runContextMemory.put(PROFILE_CACHE_KEY, {
      fingerprint,
      profile: heuristicFallback,
      updatedAt: new Date().toISOString()
    });
    return heuristicFallback;
  }
}

function buildConstraintSystemPrompt(): string {
  return [
    "You are the AutoResearch constraint planning agent.",
    "Convert raw run constraints into a strict JSON constraint profile.",
    "Do not invent requirements that are not explicit or strongly implied.",
    "Prefer null or empty arrays over guesses.",
    "Do not add a collect query.",
    "Return JSON only."
  ].join("\n");
}

function buildConstraintPrompt(run: RunRecord): string {
  return [
    "Return one JSON object with this shape:",
    "{",
    '  "collect": {',
    '    "dateRange": string|null,',
    '    "year": string|null,',
    '    "lastYears": number|null,',
    '    "fieldsOfStudy": string[],',
    '    "venues": string[],',
    '    "publicationTypes": string[],',
    '    "minCitationCount": number|null,',
    '    "openAccessPdf": boolean|null',
    "  },",
    '  "writing": {',
    '    "targetVenue": string|null,',
    '    "toneHint": string|null,',
    '    "lengthHint": string|null',
    "  },",
    '  "experiment": {',
    '    "designNotes": string[],',
    '    "implementationNotes": string[],',
    '    "evaluationNotes": string[]',
    "  },",
    '  "assumptions": string[]',
    "}",
    "",
    "Normalization rules:",
    "- Keep collect defaults generic. Explicit slash options will override these defaults later.",
    "- Use targetVenue only for actual venue or paper-style constraints.",
    "- Use toneHint and lengthHint only when clearly stated.",
    "- Put practical downstream implications into experiment.designNotes / implementationNotes / evaluationNotes.",
    "- assumptions should be short and only include strong inferences.",
    "",
    `Run topic: ${run.topic}`,
    `Objective metric: ${run.objectiveMetric || "none"}`,
    "Raw constraints:",
    ...(run.constraints.length > 0 ? run.constraints.map((constraint, index) => `${index + 1}. ${constraint}`) : ["none"])
  ].join("\n");
}

function parseConstraintProfileResponse(raw: string, constraints: string[]): Partial<ConstraintProfile> {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    throw new Error("LLM returned no JSON object for the constraint profile.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Constraint profile JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Constraint profile JSON must decode to an object.");
  }

  return normalizeConstraintProfile(parsed as Partial<ConstraintProfile>, constraints);
}

function extractJsonObject(raw: string): string | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = fenced?.[1] || raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return undefined;
  }
  return candidate.slice(start, end + 1);
}

function buildConstraintFingerprint(run: RunRecord): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        topic: run.topic,
        objectiveMetric: run.objectiveMetric,
        constraints: run.constraints
      })
    )
    .digest("hex");
}
