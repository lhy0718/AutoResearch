export type RunVerifierTrigger = "auto_handoff" | "manual";

export type RunVerifierStage = "preflight_test" | "command" | "metrics" | "policy" | "success";

export interface RunVerifierReport {
  source: "run_experiments";
  status: "pass" | "fail" | "skipped";
  trigger: RunVerifierTrigger;
  stage: RunVerifierStage;
  summary: string;
  policy_rule_id?: string;
  policy_reason?: string;
  command?: string;
  cwd?: string;
  metrics_path?: string;
  exit_code?: number;
  stdout_excerpt?: string;
  stderr_excerpt?: string;
  log_file?: string;
  suggested_next_action?: string;
  recorded_at: string;
}
