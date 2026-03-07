import path from "node:path";

import { promises as fs } from "node:fs";

import { GraphNodeHandler } from "../stateGraph/types.js";
import { runTreeOfThoughts } from "../agents/runtime/tot.js";
import { safeRead, writeRunArtifact } from "./helpers.js";
import { NodeExecutionDeps } from "./types.js";
import { RunContextMemory } from "../memory/runContextMemory.js";
import { resolveConstraintProfile } from "../constraintProfile.js";

export function createDesignExperimentsNode(deps: NodeExecutionDeps): GraphNodeHandler {
  return {
    id: "design_experiments",
    async execute({ run, graph }) {
      const runContextMemory = new RunContextMemory(run.memoryRefs.runContextPath);
      const constraintProfile = await resolveConstraintProfile({
        run,
        runContextMemory,
        llm: deps.llm,
        eventStream: deps.eventStream,
        node: "design_experiments"
      });
      const hypothesesPath = path.join(".autoresearch", "runs", run.id, "hypotheses.jsonl");
      const hypothesesText = await safeRead(hypothesesPath);
      const seeds = hypothesesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 4)
        .map((line, idx) => {
          try {
            const obj = JSON.parse(line) as { text?: string };
            return obj.text || `hypothesis_${idx + 1}`;
          } catch {
            return `hypothesis_${idx + 1}`;
          }
        });

      const tot = runTreeOfThoughts(seeds, { branchCount: 6, topK: 2 });
      const selected = tot.selected[0];
      const collectDefaults = constraintProfile.collect;
      const paperProfile = constraintProfile.writing;

      const planYaml = [
        `run_id: ${run.id}`,
        `topic: "${escapeQuote(run.topic)}"`,
        "objective:",
        `  metric: "${escapeQuote(run.objectiveMetric)}"`,
        "constraints:",
        "  raw:",
        ...renderYamlStringList(run.constraints, 2),
        "  collect_defaults:",
        ...renderYamlKeyValueObject(
          {
            last_years: collectDefaults.lastYears,
            open_access_pdf: collectDefaults.openAccessPdf,
            min_citation_count: collectDefaults.minCitationCount,
            publication_types: collectDefaults.publicationTypes
          },
          2
        ),
        "  writing_defaults:",
        ...renderYamlKeyValueObject(
          {
            target_venue: paperProfile.targetVenue,
            tone_hint: paperProfile.toneHint,
            length_hint: paperProfile.lengthHint
          },
          2
        ),
        "  experiment_guidance:",
        ...renderYamlKeyValueObject(
          {
            profile_source: constraintProfile.source
          },
          2
        ),
        "  design_notes:",
        ...renderYamlStringList(constraintProfile.experiment.designNotes, 2),
        "  implementation_notes:",
        ...renderYamlStringList(constraintProfile.experiment.implementationNotes, 2),
        "  evaluation_notes:",
        ...renderYamlStringList(constraintProfile.experiment.evaluationNotes, 2),
        "  assumptions:",
        ...renderYamlStringList(constraintProfile.assumptions, 2),
        "hypotheses:",
        ...tot.selected.map((x) => `  - "${escapeQuote(x.text)}"`),
        "execution:",
        "  container: local",
        "  timeout_sec: 1800",
        "  budget:",
        "    max_tool_calls: 150"
      ].join("\n");

      const outputPath = await writeRunArtifact(run, "experiment_plan.yaml", planYaml);
      await fs.access(outputPath);
      await runContextMemory.put("design_experiments.primary", selected?.text || "");

      return {
        status: "success",
        summary: `Experiment plan fixed with ${tot.selected.length} shortlisted designs.`,
        needsApproval: true,
        toolCallsUsed: 1
      };
    }
  };
}

function escapeQuote(text: string): string {
  return text.replace(/"/g, "'");
}

function renderYamlStringList(items: string[], indentLevel: number): string[] {
  const indent = "  ".repeat(indentLevel);
  if (items.length === 0) {
    return [`${indent}- "none"`];
  }
  return items.map((item) => `${indent}- "${escapeQuote(item)}"`);
}

function renderYamlKeyValueObject(
  obj: Record<string, string | number | boolean | string[] | undefined>,
  indentLevel: number
): string[] {
  const indent = "  ".repeat(indentLevel);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      lines.push(`${indent}${key}:`);
      for (const item of value) {
        lines.push(`${indent}  - "${escapeQuote(item)}"`);
      }
      continue;
    }
    if (typeof value === "boolean") {
      lines.push(`${indent}${key}: ${value ? "true" : "false"}`);
      continue;
    }
    if (typeof value === "number") {
      lines.push(`${indent}${key}: ${value}`);
      continue;
    }
    lines.push(`${indent}${key}: "${escapeQuote(value)}"`);
  }
  if (lines.length === 0) {
    return [`${indent}{}`];
  }
  return lines;
}
