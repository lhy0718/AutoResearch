#!/usr/bin/env node
import { generateAuditBlockerDemo } from "../dist/core/audit/auditDemoBundle.js";

const args = process.argv.slice(2);
let outDir;
for (let index = 0; index < args.length; index += 1) {
  const token = args[index];
  if (token === "--out-dir") {
    const value = args[index + 1];
    if (!value) {
      process.stderr.write("Missing value for --out-dir.\n");
      process.exitCode = 1;
      process.exit();
    }
    outDir = value;
    index += 1;
    continue;
  }
  if (token === "--help" || token === "-h") {
    process.stdout.write([
      "demo-audit-blockers",
      "",
      "Usage:",
      "  node scripts/demo-audit-blockers.mjs [--out-dir outputs/audit-demo]",
      "",
      "Runs AGB-001, AGB-003, and AGB-010 through the built paper-readiness audit demo."
    ].join("\n") + "\n");
    process.exit();
  }
  process.stderr.write(`Unsupported argument: ${token}\n`);
  process.exitCode = 1;
  process.exit();
}

const manifest = await generateAuditBlockerDemo({
  cwd: process.cwd(),
  outDir
});

process.stdout.write([
  `Audit blocker demo generated: ${manifest.output_dir}`,
  `All expected scenarios blocked: ${manifest.all_expected_blocked}`,
  ...manifest.entries.map((entry) =>
    `${entry.seed_id}: ${entry.actual_verdict}; ${entry.claim_ceiling}; report=${entry.report_path}`
  )
].join("\n") + "\n");

if (!manifest.all_expected_blocked) {
  process.exitCode = 1;
}
