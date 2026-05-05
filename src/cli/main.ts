#!/usr/bin/env node
import { runAutoLabOSApp } from "../app.js";
import { resolveCliAction } from "./args.js";
import { runAutoLabOSWebServer } from "../web/server.js";
import { runCompareAnalysisCli } from "./compareAnalysis.js";
import { runEvalHarnessCli } from "./evalHarness.js";
import { runEvolveCli } from "./evolveRun.js";
import { runPaperReadinessAuditCli } from "./audit.js";
import {
  runGovernanceBenchmarkBatchCli,
  runGovernanceBenchmarkDryRunCli,
  runGovernanceBenchmarkExportBundlesCli,
  runGovernanceBenchmarkSeedCli
} from "./governanceBenchmark.js";
import { runMetaHarnessCli } from "./metaHarness.js";

function printHelp(): void {
  process.stdout.write([
    "autolabos",
    "",
    "Single entrypoint for the AutoLabOS brief-first TUI.",
    "All operations are available inside the app via /commands.",
    "",
    "Usage:",
    "  autolabos",
    "  autolabos [--package <fast|thorough|paper_scale>] [--benchmark-condition gated|ungated|no_claim_ceiling|no_review_gate|no_figure_audit]",
    "  autolabos web [--host 127.0.0.1] [--port 4317] [--benchmark-condition gated|ungated|no_claim_ceiling|no_review_gate|no_figure_audit]",
    "  autolabos compare-analysis --run <run-id> [--limit 3] [--no-judge]",
    "  autolabos eval-harness [--run <run-id>] [--limit 10] [--output outputs/eval-harness/latest.json] [--no-history]",
    "  autolabos evolve [--max-cycles 3] [--target skills|prompts|all] [--dry-run]",
    "  autolabos audit (--run <run-artifact-root> | --external <artifact-root> [--draft <draft.md>] [--log <run.log>] | --seed AGB-001..AGB-010) [--out-dir outputs/audit]",
    "  autolabos governance-benchmark seed --source <path> [--task AGB-001] [--out-dir outputs/governance-benchmark/seeds] [--reference-only]",
    "  autolabos governance-benchmark dry-run --seed <path> [--task AGB-001] [--condition gated|ungated] [--out-dir outputs/governance-benchmark/AGB-001]",
    "  autolabos governance-benchmark batch --seeds <path> [--task AGB-001] [--condition gated|ungated] [--out-dir outputs/governance-benchmark/batch]",
    "  autolabos governance-benchmark export-bundles --source <outputs/run> [--source <outputs/run>] [--max 3] [--out-dir outputs/governance-benchmark/demo-bundles]",
    "  autolabos meta-harness [--runs 5] [--node analyze_results|review] [--no-apply] [--dry-run]",
    "  autolabos meta-harness --external-run <run-artifact-root> [--external-run <run-artifact-root>] --no-apply",
    "  autolabos --help",
    "  autolabos --version"
  ].join("\n") + "\n");
}

function printAuditHelp(): void {
  process.stdout.write([
    "autolabos audit",
    "",
    "Audit AI research-agent outputs for paper-readiness without treating write_paper completion as paper-ready.",
    "",
    "Usage:",
    "  autolabos audit --seed AGB-001 [--out-dir outputs/audit]",
    "  autolabos audit --seed AGB-001..AGB-010 [--out-dir outputs/audit]",
    "  autolabos audit --run <run-artifact-root> [--out-dir outputs/audit]",
    "  autolabos audit --external <artifact-root> [--draft <draft.md>] [--log <run.log>] [--out-dir outputs/audit]",
    "",
    "Examples:",
    "  autolabos audit --seed AGB-001",
    "  autolabos audit --seed AGB-003 --out-dir outputs/audit/AGB-003",
    "  autolabos audit --run .autolabos/runs/<run-id> --out-dir outputs/audit/<run-id>",
    "  autolabos audit --external <external-artifact-root> --draft <draft.md> --log <run.log> --out-dir outputs/audit/external",
    "",
    "Outputs:",
    "  paper-readiness-audit.md",
    "  claim-evidence-table.json",
    "  audit-timeline.json",
    "  claim-promotion-timeline.json",
    "  blocked-claim-events.json",
    "  done-condition-audit.json",
    "  autonomy-metrics.json",
    "  audit-summary.json",
    "  blockers.json",
    "  external-intake-manifest.json (for --external)"
  ].join("\n") + "\n");
}

async function main(): Promise<void> {
  const action = resolveCliAction(process.argv.slice(2));

  if (action.kind === "help") {
    printHelp();
    return;
  }

  if (action.kind === "audit-help") {
    printAuditHelp();
    return;
  }

  if (action.kind === "version") {
    process.stdout.write("autolabos 1.0.0\n");
    return;
  }

  if (action.kind === "error") {
    process.stderr.write(`${action.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (action.kind === "web") {
    await runAutoLabOSWebServer({
      cwd: process.cwd(),
      host: action.host,
      port: action.port,
      benchmarkCondition: action.benchmarkCondition
    });
    return;
  }

  if (action.kind === "compare-analysis") {
    await runCompareAnalysisCli({
      cwd: process.cwd(),
      runId: action.runId,
      limit: action.limit,
      judge: action.judge
    });
    return;
  }

  if (action.kind === "eval-harness") {
    await runEvalHarnessCli({
      cwd: process.cwd(),
      runIds: action.runIds,
      limit: action.limit,
      outputPath: action.outputPath,
      noHistory: action.noHistory
    });
    return;
  }

  if (action.kind === "evolve") {
    await runEvolveCli({
      cwd: process.cwd(),
      maxCycles: action.maxCycles,
      target: action.target,
      dryRun: action.dryRun
    });
    return;
  }

  if (action.kind === "audit") {
    await runPaperReadinessAuditCli({
      cwd: process.cwd(),
      runRoot: action.runRoot,
      externalRoot: action.externalRoot,
      draftPath: action.draftPath,
      logPath: action.logPath,
      seedId: action.seedId,
      outDir: action.outDir
    });
    return;
  }

  if (action.kind === "governance-benchmark-seed") {
    await runGovernanceBenchmarkSeedCli({
      cwd: process.cwd(),
      sourcePath: action.sourcePath,
      taskId: action.taskId,
      outDir: action.outDir,
      referenceOnly: action.referenceOnly
    });
    return;
  }

  if (action.kind === "governance-benchmark-dry-run") {
    await runGovernanceBenchmarkDryRunCli({
      cwd: process.cwd(),
      seedPath: action.seedPath,
      taskId: action.taskId,
      outDir: action.outDir,
      conditions: action.conditions
    });
    return;
  }

  if (action.kind === "governance-benchmark-batch") {
    await runGovernanceBenchmarkBatchCli({
      cwd: process.cwd(),
      seedsRoot: action.seedsRoot,
      taskIds: action.taskIds,
      outDir: action.outDir,
      conditions: action.conditions
    });
    return;
  }

  if (action.kind === "governance-benchmark-export-bundles") {
    await runGovernanceBenchmarkExportBundlesCli({
      cwd: process.cwd(),
      publicOutputRoots: action.publicOutputRoots,
      outDir: action.outDir,
      maxBundles: action.maxBundles
    });
    return;
  }

  if (action.kind === "meta-harness") {
    await runMetaHarnessCli({
      cwd: process.cwd(),
      runs: action.runs,
      nodes: action.nodes,
      externalRunRoots: action.externalRunRoots,
      noApply: action.noApply,
      dryRun: action.dryRun
    });
    return;
  }

  await runAutoLabOSApp({
    packageName: action.kind === "run" ? action.packageName : undefined,
    benchmarkCondition: action.kind === "run" ? action.benchmarkCondition : undefined
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
