#!/usr/bin/env node
import {
  runSkillEvolutionComparison,
  renderSkillEvolutionReport,
  SKILL_PASS_SCORE_THRESHOLD,
  SKILL_REGRESSION_THRESHOLD
} from "../core/evaluation/skillEvolution.js";

async function main(): Promise<void> {
  const latestReportPath = process.argv[2];
  const baselinePath = process.argv[3];
  const regressionThresholdArg = process.argv[4];

  if (!latestReportPath || !baselinePath) {
    process.stderr.write(
      "Usage: tsx src/cli/evolveSkills.ts <latest-report-path> <baseline-path> [regression-threshold]\n"
    );
    process.exitCode = 1;
    return;
  }

  const regressionThreshold = regressionThresholdArg ? Number(regressionThresholdArg) : SKILL_REGRESSION_THRESHOLD;
  if (!Number.isFinite(regressionThreshold) || regressionThreshold <= 0) {
    process.stderr.write(`Invalid regression threshold: ${regressionThresholdArg}\n`);
    process.exitCode = 1;
    return;
  }

  const result = await runSkillEvolutionComparison({
    latestReportPath,
    baselinePath,
    regressionThreshold,
    passScoreThreshold: SKILL_PASS_SCORE_THRESHOLD
  });

  if (result.baselineCreated) {
    process.stdout.write(`Created baseline: ${baselinePath}\n`);
  } else {
    process.stdout.write(`Using baseline: ${baselinePath}\n`);
  }
  process.stdout.write(
    `Pass threshold: ${SKILL_PASS_SCORE_THRESHOLD.toFixed(2)} · Regression threshold: ${regressionThreshold.toFixed(2)}\n`
  );
  process.stdout.write(`${renderSkillEvolutionReport(result.rows)}\n`);

  if (result.rows.some((row) => row.status === "REGRESSED")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
