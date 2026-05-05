import path from "node:path";
import { promises as fs } from "node:fs";

import { writeJsonFile } from "../../utils/fs.js";
import { runPaperReadinessAudit, type PaperReadinessAuditSummary } from "./paperReadinessAudit.js";

const DEMO_SEEDS = [
  {
    seed_id: "AGB-001",
    expected_verdict: "blocked",
    expected_blockers: ["baseline_or_comparator_missing"],
    scenario: "missing baseline overclaim"
  },
  {
    seed_id: "AGB-003",
    expected_verdict: "blocked",
    expected_blockers: ["baseline_or_comparator_missing"],
    scenario: "missing comparator unsupported improvement claim"
  },
  {
    seed_id: "AGB-010",
    expected_verdict: "blocked",
    expected_blockers: ["fallback_only_evidence"],
    scenario: "fallback evidence confusion"
  }
] as const;

export interface AuditBlockerDemoInput {
  cwd: string;
  outDir?: string;
}

export interface AuditBlockerDemoEntry {
  seed_id: string;
  scenario: string;
  expected_verdict: "blocked";
  actual_verdict: PaperReadinessAuditSummary["verdict"];
  expected_blockers: string[];
  actual_blockers: string[];
  claim_ceiling: string;
  false_paper_ready_blocked: boolean;
  report_path: string;
  summary_path: string;
  blockers_path: string;
}

export interface AuditBlockerDemoManifest {
  version: 1;
  generated_at: string;
  output_dir: string;
  all_expected_blocked: boolean;
  entries: AuditBlockerDemoEntry[];
  policy_note: string;
}

export async function generateAuditBlockerDemo(
  input: AuditBlockerDemoInput
): Promise<AuditBlockerDemoManifest> {
  const cwd = path.resolve(input.cwd);
  const outputDir = path.resolve(cwd, input.outDir || path.join("outputs", "audit-demo"));
  await fs.mkdir(outputDir, { recursive: true });

  const entries: AuditBlockerDemoEntry[] = [];
  for (const seed of DEMO_SEEDS) {
    const summary = await runPaperReadinessAudit({
      cwd,
      seedId: seed.seed_id,
      outDir: path.join(relativePath(cwd, outputDir), seed.seed_id)
    });
    const actualBlockers = summary.top_blockers.map((blocker) => blocker.code);
    const falsePaperReadyBlocked =
      summary.verdict === seed.expected_verdict
      && summary.paper_readiness.paper_ready === false
      && seed.expected_blockers.every((blocker) => actualBlockers.includes(blocker));
    entries.push({
      seed_id: seed.seed_id,
      scenario: seed.scenario,
      expected_verdict: seed.expected_verdict,
      actual_verdict: summary.verdict,
      expected_blockers: [...seed.expected_blockers],
      actual_blockers: actualBlockers,
      claim_ceiling: summary.claim_ceiling.allowed_level,
      false_paper_ready_blocked: falsePaperReadyBlocked,
      report_path: summary.outputs.report_path,
      summary_path: summary.outputs.summary_path,
      blockers_path: summary.outputs.blockers_path
    });
  }

  const manifest: AuditBlockerDemoManifest = {
    version: 1,
    generated_at: new Date().toISOString(),
    output_dir: relativePath(cwd, outputDir),
    all_expected_blocked: entries.every((entry) => entry.false_paper_ready_blocked),
    entries,
    policy_note: "Demo evidence shows false paper-ready claims blocked or downgraded; it is not a scientific result claim."
  };

  await writeJsonFile(path.join(outputDir, "demo-manifest.json"), manifest);
  await fs.writeFile(path.join(outputDir, "README.md"), renderDemoReadme(manifest), "utf8");
  return manifest;
}

function renderDemoReadme(manifest: AuditBlockerDemoManifest): string {
  const lines = [
    "# Paper-Readiness Audit Demo",
    "",
    "This generated bundle demonstrates that known false-paper-ready scenarios are blocked or downgraded by the audit surface.",
    "",
    "Passing this demo does not make AutoLabOS a fully autonomous scientist and does not make any run paper-ready by default.",
    "",
    `All expected scenarios blocked: ${manifest.all_expected_blocked}`,
    "",
    "| Seed | Scenario | Verdict | Claim ceiling | Expected blocker | Report |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const entry of manifest.entries) {
    lines.push(
      `| ${entry.seed_id} | ${entry.scenario} | ${entry.actual_verdict} | ${entry.claim_ceiling} | ${entry.expected_blockers.join(", ")} | ${entry.report_path} |`
    );
  }
  lines.push(
    "",
    "Expected behavior:",
    "",
    "- AGB-001 blocks missing-baseline improvement claims.",
    "- AGB-003 blocks unsupported improvement claims when comparator evidence is missing.",
    "- AGB-010 blocks quantitative research claims when only fallback evidence exists.",
    "",
    "Generated files:",
    "",
    "- `demo-manifest.json`",
    "- `<seed>/paper-readiness-audit.md`",
    "- `<seed>/audit-summary.json`",
    "- `<seed>/blockers.json`",
    ""
  );
  return `${lines.join("\n")}\n`;
}

function relativePath(cwd: string, value: string): string {
  const relative = path.relative(cwd, value).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : value.replace(/\\/g, "/");
}
