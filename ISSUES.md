# ISSUES.md

Last updated: 2026-04-26

This file was compacted on 2026-03-22 to remove duplicated template fragments, malformed partial entries, and conflicting reused LV identifiers. Detailed pre-cleanup prose remains in git history.

Usage rules:
- `ISSUES.md` is for reproduced live-validation defects and tracked research/paper-readiness risks.
- `TODO.md` is for forward-looking follow-ups, proposal-only work, and backlog items.
- Canonical workflow and policy still live in `AGENTS.md` and `docs/`.

---

## Current active status

- Active live-validation defects:
  - `LV-153` generated PEFT runners can pass implement-stage verification while the final experiment entrypoint calls undefined helper `set_global_seed(...)`, even though generated seed helpers are available under different names such as `seed_everything` or `transformers_set_seed`.
  - `LV-152` generated PEFT runners can pass implement-stage verification while the final study dispatcher searches only `run_study`, `execute_study`, `run_experiment`, and `execute_peft_instruction_study`, even though executable study helpers are generated under different names; the failure path can then call undefined `make_json_safe`.
  - `LV-151` generated PEFT runners can pass implement-stage verification and reach real model loading/training setup, but fail under installed `transformers 5.3.0` because `Trainer(..., tokenizer=...)` is no longer accepted.
  - `LV-150` generated PEFT runners can pass implement-stage verification while the metrics writer adapter passes `path=` but the selected writer requires `metrics_path`, causing final metrics writing to fail after real execution reaches payload assembly.
  - `LV-149` generated PEFT runners can pass implement-stage `py_compile` while a compatibility factory filters kwargs against `RecipeSpec.__dataclass_fields__` but omits the required `adapter_type` field, causing module-load failure before experiment execution.
  - `LV-148` generated PEFT runners can pass implement-stage verification and define executable row-loop helpers, but the final `_run_study_with_available_helper` resolver searches only different helper names and fails `run_experiments` with `No executable study helper was found in completed sections`.
  - `LV-147` generated PEFT runners can pass implement-stage verification and define a valid baseline-first PEFT execution helper, but the final `_entrypoint_execute_study` resolver searches only different helper names and fails `run_experiments` with `No baseline-first PEFT study execution helper was found in the runner`.
  - `LV-146` generated PEFT runners can pass implement-stage verification and define default PEFT recipes, but `run_experiments` still fails immediately because `set_seed(...) if "set_seed" in globals() else SEED` checks helper availability only for the argument expression, not for the function call itself, causing `NameError: set_seed is not defined`.
  - `LV-145` generated PEFT runners can pass implement-stage verification while CLI normalization reads only `PEFT_RECIPES` for default recipe selection even though no non-empty `PEFT_RECIPES` registry is defined, causing `run_experiments` to fail before model loading with `No PEFT recipes selected`.
  - `LV-144` generated PEFT runners can pass implement-stage verification and reach real CUDA/model execution while benchmark data loading and failure-metrics writer adapters search incompatible helper names/signatures, causing `run_experiments` to fail without producing current metrics.
  - `LV-143` staged native-Codex materialization can fail attempt 1/3 outright when a deeply nested subchunk still fails Python candidate validation with `IndentationError`, instead of recording the failed attempt, restoring isolation, and continuing to the next implement attempt.
  - `LV-142` generated PEFT runners can pass implement-stage verification and auto-handoff while the final study dispatcher searches only orchestration function names that were never generated, causing immediate `run_experiments` failure even though a baseline-first evaluation function exists under a different name.
  - `LV-141` generated PEFT runners can pass implement-stage verification and auto-handoff while recipe configuration containers are dict-backed but CLI/final metadata paths access entries as objects with `recipe.name`, causing immediate `AttributeError` in `run_experiments`.
  - `LV-140` generated PEFT runners can pass implement-stage verification and begin real `run_experiments` execution while the executable path still calls undefined failure-metrics helper `get_device_info()` and dispatches zero-shot evaluation through evaluator names that were never generated, causing runtime failure after model loading.
  - `LV-139` generated PEFT runners can pass implement-stage verification and auto-handoff while the executable path calls undefined lowercase helpers such as `get_device()` and `_json_safe()`, causing `run_experiments` to fail after handoff.
  - `LV-138` generated PEFT runners can pass implement-stage verification and begin executing before the entrypoint calls an undefined runtime helper `validate_runtime_dependencies`, causing `run_experiments` to fail before metrics are produced.
  - `LV-137` generated PEFT runners can pass implement-stage `py_compile` and compatibility repairs while a module-level recipe-id projection calls a `RecipeSpec.recipe_id` property that depends on undefined helper `slugify`, causing `run_experiments` to fail at module load.
  - `LV-136` generated PEFT runners can pass implement-stage verification after `RecipeSpec.name` property repair while a later duplicate `PEFT_RECIPES` block calls `RecipeSpec(name=..., recipe_type=..., rank=...)` against a dataclass constructor that only accepts `recipe_id`, `peft_type`, `config`, and related fields, causing `run_experiments` to fail at module load.
  - `LV-135` generated PEFT runners can pass implement-stage verification and auto-handoff while their baseline-first orchestration searches for benchmark evaluator names that do not include the evaluator actually generated by the evaluation section, causing `run_experiments` to fail and leave `metrics.json` empty.
  - `LV-134` staged native-Codex materialization can abort an entire `implement_experiments` attempt when one chunk response is not parseable JSON, instead of treating the malformed chunk as retryable and re-subdividing or regenerating it.
  - `LV-133` native Codex OAuth staged implementation can abort before producing a runnable implementation when the backend returns transient server/request errors during chunk generation, leaving same-flow verifier fixes unvalidated until a retry succeeds.
  - `LV-132` implement-stage verification now catches unsupported `TrainingArguments(overwrite_output_dir=...)`, but repeated native Codex retries still regenerate the same incompatible kwarg and exhaust all implement attempts before a runnable bundle is produced.
  - `LV-131` generated PEFT runners can pass implement-stage verification while their CLI dispatch references recipe-comparison workflow names that were never defined, causing `run_experiments` to write failed metrics and exit 1.
  - `LV-130` staged implementation can pass `py_compile` with unfilled `AUTOLABOS SECTION` skeleton blocks, causing `run_experiments` to exit 0 without writing metrics.
  - `LV-127` generated `baseline_first_locked` PEFT runners can internally sort the untuned reference before the locked tuned baseline even though the experiment contract requires the standard LoRA tuned baseline to be first.
  - `LV-119` implement-stage Python verification can pass `py_compile` while a generated runner still fails at module load on an undefined return-annotation type name.
  - `LV-113` `run_experiments` can receive a Python runner that passes implement-stage verification but fails on an unsupported `TrainingArguments(overwrite_output_dir=...)` kwarg in the installed `transformers` version.
  - `LV-108` `run_experiments` can complete after writing failed private metrics while stale public study artifacts still show completed baseline/comparator rows.
  - `LV-098` IEEE staging `pdf_url` rows cache HTML instead of PDF, so `analyze_papers` cannot preserve supplemental page images on abstract fallback for those papers.
- Active research/paper-readiness watchlist: see `Research and paper-readiness watchlist` below.
- Current watchlist snapshot:
  - `R-001` Result-table discipline and claim→evidence linkage — `MITIGATED`
  - `R-002` Scientific gate warnings surfacing — `MITIGATED`
  - `R-003` System-validation paper shape over-promotion — `MITIGATED`
  - `P-001` Baseline/comparator packaging — `MITIGATED`
  - `P-002` Compact quantitative result packaging — `MITIGATED`
  - `P-003` Related-work depth signaling — `MITIGATED`
- If a new runtime/UI defect is reproduced, add it under `Active live validation issues` with a fresh `LV-*` identifier and one dominant root-cause class.

---

## Active live validation issues

## Issue: LV-153

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the `LV-152` dispatcher/helper repair
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050s` from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Start a detached real TUI session in `.autolabos-validation` with the rebuilt CLI.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization and local verification.
  4. Let auto-handoff run the generated `run_peft_instruction_study.py`.
  5. Inspect the TUI status, `run_experiments_verify_report.json`, and `metrics.json`.

- Expected behavior:
  - Implement-stage verification should repair or reject generated runners whose final entrypoint calls a seeding helper that is not defined.
  - If compatible seed helpers are generated under names such as `seed_everything`, `set_reproducibility_seed`, or `transformers_set_seed`, the runner should bind a safe `set_global_seed(...)` compatibility alias before handoff.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass`.
  - Auto-handoff advanced beyond the previous dispatcher/helper mismatch, confirming the `LV-152` blocker was materially narrowed.
  - `run_experiments` failed immediately in the final entrypoint with `NameError: name 'set_global_seed' is not defined`.
  - The generated runner contained seed-related helpers and imports, including `transformers_set_seed` and `seed_everything`, but the final entrypoint still called `set_global_seed(int(getattr(args, "seed", SEED)))`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050s`.
  - Existing session: earlier same-flow retries failed before this point on dispatcher, JSON-safe helper, Trainer constructor, metrics writer, recipe schema, optional-helper, runtime-helper, and benchmark-loader boundaries.
  - Divergence: no session-state divergence observed; TUI status, `run_experiments_verify_report.json`, and `metrics.json` agree on the undefined `set_global_seed` failure.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged generation projected multiple seeding helper names across independent sections but did not reconcile the final entrypoint call with the helpers actually defined in the completed runner. Existing compatibility repair covered `set_seed` aliases, but not the semantically equivalent `set_global_seed` call surface.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - extends the existing seed-helper compatibility repair so generated runners that call `set_global_seed(...)` can bind that name to available generated seed helpers before handoff
      - keeps the repair bounded to seed helper surfaces such as `seed_everything`, `set_reproducibility_seed`, `transformers_set_seed`, `hf_set_seed`, or a repaired `set_seed` alias
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a generated runner that defines `seed_everything(...)` and `transformers_set_seed` but calls undefined `set_global_seed(...)` from `main(...)`

- Regression status:
  - Automated regression test linked: yes, `tests/implementSessionManager.test.ts`
  - Re-validation result: pending

- Follow-up risks:
  - Additional helper alias names may appear in generated runners; the repair should stay bounded to seeding helpers and avoid fabricating experiment outputs.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-152

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the `LV-151` `Trainer(tokenizer=...)` repair
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050r` from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Start a detached real TUI session in `.autolabos-validation` with the rebuilt CLI.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization and local verification.
  4. Let auto-handoff run the generated `run_peft_instruction_study.py`.
  5. Inspect the TUI status and generated runner.

- Expected behavior:
  - Implement-stage verification should reject final study dispatchers whose searched callable names are never defined.
  - Failure-metrics paths should not call undefined JSON-safe helper names.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass`.
  - Auto-handoff advanced beyond the previous `Trainer(tokenizer=...)` compatibility failure, confirming the `LV-151` blocker was materially narrowed.
  - `run_experiments` failed because `_call_first_available(...)` searched only `run_study`, `execute_study`, `run_experiment`, and `execute_peft_instruction_study`, while generated helpers existed under names such as `run_study_execution` and `execute_study_from_args`.
  - During exception handling, `_dependency_report()` called `make_json_safe(...)`, but only `dumps_json_safe(...)` was defined, causing `NameError: name 'make_json_safe' is not defined`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050r`.
  - Existing session: earlier same-flow retries failed before this point on Transformers Trainer compatibility, metrics writer adapter, recipe schema, study resolver, optional-helper, and benchmark-loader boundaries.
  - Divergence: no session-state divergence observed; TUI status and generated runner agree on the dispatcher mismatch and failure-path helper omission.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged generation produced executable study helpers and final CLI dispatch independently, but the final dispatcher candidate list was not derived from the actual helper names. Separately, failure-metrics code referenced a JSON-safe helper alias that was never defined.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - extends recipe/study workflow dispatch verification to include `None of the required functions are available` final-dispatcher failures
      - adds generated helper names such as `run_study_execution` and `execute_study_from_args` to the known study workflow entrypoint set
      - adds a bounded `make_json_safe(...)` compatibility alias repair when generated code defines `_autolabos_json_safe(...)` or another JSON-safe fallback but calls `make_json_safe(...)`
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a final `_call_first_available(...)` dispatcher that searches only missing required study functions
      - adds deterministic regression coverage for adding a missing `make_json_safe(...)` alias before local verification passes

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "required-functions dispatcher|make_json_safe|Trainer tokenizer|registered recipe workflow|completed-sections study resolver"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending.

- Follow-up risks:
  - More final-dispatcher name variants may appear; the verifier should continue checking concrete searched callable names rather than fabricating run outputs.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-151

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the `LV-150` metrics writer adapter guard
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050q` from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Start a detached real TUI session in `.autolabos-validation` with the rebuilt CLI.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization and local verification.
  4. Let auto-handoff run the generated `run_peft_instruction_study.py`.
  5. Inspect TUI output and generated failed metrics.

- Expected behavior:
  - Implement-stage verification should repair or reject generated `Trainer(...)` calls that pass kwargs unsupported by the installed `transformers` version.
  - The generated runner should not auto-handoff with `Trainer(..., tokenizer=tokenizer)` when the installed Trainer constructor rejects `tokenizer`.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass`.
  - Auto-handoff advanced beyond the previous metrics writer adapter failure, confirming the `LV-150` blocker was materially narrowed.
  - `run_experiments` reached real Hugging Face model loading, tokenized the instruction subset, and then failed at training setup with `TypeError("Trainer.__init__() got an unexpected keyword argument 'tokenizer'")`.
  - The generated code passed `tokenizer=tokenizer` directly to `Trainer(...)`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050q`.
  - Existing session: earlier same-flow retries failed before this point on recipe schema, study resolver, metrics writer, optional-helper, runtime-helper, and benchmark-loader boundaries.
  - Divergence: no session-state divergence observed; TUI status and failed metrics agree on the `Trainer` constructor incompatibility.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged generation still emits older Transformers Trainer constructor surfaces while the validation environment has `transformers 5.3.0`, where `tokenizer` is no longer accepted. Existing compatibility repair covers `TrainingArguments(overwrite_output_dir=...)` but not `Trainer(tokenizer=...)`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - adds a bounded compatibility repair that removes unsupported `Trainer(tokenizer=...)` kwargs before handoff
      - places the repair next to existing installed-Transformers compatibility repairs for `TrainingArguments`
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for removing `tokenizer=tokenizer` from generated `Trainer(...)` calls before local verification passes

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "Trainer tokenizer|TrainingArguments|metrics writer adapter"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: partial pass on 2026-04-26 in `autolabos-live-73050r`; the generated runner advanced beyond the `Trainer(tokenizer=...)` compatibility mismatch, then exposed the final dispatcher/helper mismatch and undefined `make_json_safe` failure path tracked as `LV-152`.

- Follow-up risks:
  - Additional Transformers v5 constructor-surface changes may appear after this repair; same-flow live validation remains required.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-150

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the `LV-149` `RecipeSpec.adapter_type` repair
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050p` from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Start a detached real TUI session in `.autolabos-validation` with the rebuilt CLI.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization and local verification.
  4. Let auto-handoff run the generated `run_peft_instruction_study.py`.
  5. Inspect the TUI status, `run_experiments_verify_report.json`, and the generated metrics writer adapter.

- Expected behavior:
  - Implement-stage verification should reject a runner whose metrics writer adapter does not pass all required writer arguments.
  - If `write_metrics_json(metrics, metrics_path)` is the selected writer, the adapter should pass both the payload and `metrics_path=metrics_path`.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass`.
  - Auto-handoff advanced beyond the previous `RecipeSpec.adapter_type` module-load failure, confirming the `LV-149` blocker was materially narrowed.
  - `run_experiments` then failed while writing metrics.
  - `_write_metrics_payload(...)` called `_call_with_supported_kwargs(writer, path=metrics_path, metrics=payload, payload=payload, data=payload, obj=payload)`.
  - The selected writer `write_metrics_json(metrics, metrics_path)` required `metrics_path`, but the adapter only supplied `path`, so `_call_with_supported_kwargs(...)` raised `Cannot call helper write_metrics_json; missing required arguments ['metrics_path']`.
  - Fallback positional calls then inverted the payload/path order once and finally tried to validate a failure payload without expected result keys.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050p`.
  - Existing session: earlier same-flow retries failed before this point on recipe schema, study resolver, optional-helper, runtime-helper, benchmark-loader, and metrics-writer payload-name boundaries.
  - Divergence: no session-state divergence observed; TUI status and generated runner agree on the metrics writer adapter mismatch.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: the existing metrics-writer verifier checked only payload keyword compatibility and missed required path-argument compatibility. Staged generation emitted a writer requiring `metrics_path` while the adapter passed `path` under a different semantic name.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - extends metrics writer adapter verification to inspect `_write_metrics_payload(...)` plus `_call_with_supported_kwargs(writer, ...)` variants
      - rejects selected writer signatures that require `metrics_path` when the adapter only passes a semantic `path` alias
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for `write_metrics_json(metrics, metrics_path)` being called through an adapter that only passes `path=metrics_path`

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "metrics writer adapter|RecipeSpec adapter_type|completed-sections study resolver"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: partial pass on 2026-04-26 in `autolabos-live-73050q`; the generated runner advanced beyond the metrics writer path-argument adapter mismatch and reached real model loading/training setup, then exposed the later `Trainer(tokenizer=...)` compatibility mismatch tracked as `LV-151`.

- Follow-up risks:
  - Additional writer signatures may use other required path aliases; verifier should remain focused on observed required-argument gaps without fabricating metrics artifacts.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-149

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the `LV-148` completed-sections resolver guard
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050o` from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Start a detached real TUI session in `.autolabos-validation` with the rebuilt CLI.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization and local `py_compile` verification.
  4. Let auto-handoff run the generated `run_peft_instruction_study.py`.
  5. Inspect the TUI status and `run_experiments_verify_report.json`.

- Expected behavior:
  - Implement-stage compatibility repair should supply required recipe schema aliases before handoff.
  - If `RecipeSpec` requires `adapter_type`, any factory that filters kwargs against dataclass fields should include an `adapter_type` value before calling `RecipeSpec(**values)`.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass`.
  - Auto-handoff advanced beyond the previous `No executable study helper was found in completed sections` failure, confirming the `LV-148` blocker was materially narrowed.
  - `run_experiments` then failed at module load with `TypeError: RecipeSpec.__init__() missing 1 required positional argument: 'adapter_type'`.
  - The generated `_recipe_spec_from_defaults(...)` built an alias dictionary with recipe metadata and filtered aliases through `dataclasses.fields(RecipeSpec)`, but did not provide an `adapter_type` alias even though the dataclass requires it.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050o`.
  - Existing session: earlier same-flow retries failed before this point on PEFT registry, TrainingArguments, benchmark loader, metrics writer, runtime-helper, optional-helper-call, and study resolver boundaries.
  - Divergence: no session-state divergence observed; TUI status and `run_experiments_verify_report.json` agree on the module-load constructor failure.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged generation changed the `RecipeSpec` schema to require `adapter_type`, but the later factory compatibility alias map did not include that required field. Existing repairs handle missing `peft_type` and `.name` surfaces, but not the symmetric missing `adapter_type` alias.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - adds a bounded `RecipeSpec.adapter_type` alias repair before handoff
      - preserves existing `peft_type` and `.name` repairs while adding the symmetric adapter-type schema surface
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a runner whose `RecipeSpec` dataclass requires `adapter_type` while `_recipe_spec_from_defaults(...)` filters aliases that omit it

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "RecipeSpec adapter_type|RecipeSpec peft_type|RecipeSpec name|completed-sections study resolver|baseline-first PEFT entrypoint resolver"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: partial pass on 2026-04-26 in `autolabos-live-73050p`; the generated runner advanced beyond the `RecipeSpec.adapter_type` module-load failure, then exposed the later metrics writer path-argument adapter mismatch tracked as `LV-150`.

- Follow-up risks:
  - Other required dataclass fields may need alias-surface repair if staged sections independently evolve recipe schemas and factory aliases.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-148

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the `LV-147` baseline-first PEFT entrypoint resolver guard
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050n` from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Start a detached real TUI session in `.autolabos-validation` with the rebuilt CLI.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization and local verification.
  4. Let auto-handoff run the generated `run_peft_instruction_study.py`.
  5. Inspect `run_experiments_verify_report.json`, `exec_logs/run_experiments.txt`, `metrics.json`, and the generated runner.

- Expected behavior:
  - Implement-stage verification should reject a generated runner whose final study resolver searches only helper names that are never defined.
  - A generated runner should not auto-handoff when executable row-loop helpers are present under names that the final resolver never searches.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass`.
  - Auto-handoff advanced beyond the previous `No baseline-first PEFT study execution helper was found` variant, confirming the `LV-147` blocker was materially narrowed.
  - `run_experiments` then failed with `RuntimeError: No executable study helper was found in completed sections.`
  - The generated runner defined `run_locked_peft_experiment_rows(...)` and `run_recipe_execution_evaluation_loop(...)`, but `_run_study_with_available_helper(...)` searched only `run_locked_peft_instruction_study`, `run_peft_instruction_study`, `run_locked_peft_study`, `run_peft_study`, `run_experiment_rows`, `run_locked_recipe_rows`, `run_recipe_experiment_loop`, and `execute_experiment`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050n`.
  - Existing session: earlier same-flow retries failed before this point on PEFT registry, TrainingArguments, benchmark loader, metrics writer, runtime-helper, optional-helper-call, and baseline-first entrypoint resolver boundaries.
  - Divergence: no session-state divergence observed; TUI status, `run_experiments_verify_report.json`, `metrics.json`, and the generated runner agree on the final resolver/helper mismatch.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged implementation can generate executable row-loop helpers and a later final CLI resolver independently, but the resolver candidate names are not derived from the actually materialized helper names. Existing implement-stage verification recognized previous dispatcher failure strings but not this generic completed-sections study-helper failure string.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - extends recipe/study workflow dispatch verification to include the observed `No executable study helper was found in completed sections` failure string
      - adds observed PEFT row-loop resolver candidate and generated helper names such as `run_locked_peft_instruction_study`, `run_locked_peft_experiment_rows`, and `run_recipe_execution_evaluation_loop` to the known study workflow entrypoint set
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a runner that defines row-loop helpers while `_run_study_with_available_helper(...)` searches only different missing helper names

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "completed-sections study resolver|baseline-first PEFT entrypoint resolver|experiment orchestration resolver|registered recipe workflow|PEFT recipe registry|unguarded optional set_seed"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: partial pass on 2026-04-26 in `autolabos-live-73050o`; the generated runner advanced beyond the `No executable study helper was found in completed sections` variant, then exposed the later `RecipeSpec.adapter_type` alias mismatch tracked as `LV-149`.

- Follow-up risks:
  - This is another adjacent dispatcher-name variant; broader structural checking should remain limited to real resolver failure strings and callable-name resolution, not manual artifact substitution.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-147

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the `LV-146` optional-helper call guard
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050m` from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Start a detached real TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization and local verification.
  4. Let auto-handoff run the generated `run_peft_instruction_study.py`.
  5. Inspect the TUI status, `run_experiments_verify_report.json`, and the generated runner.

- Expected behavior:
  - Implement-stage verification should reject a generated runner whose final study resolver searches only helper names that are never defined.
  - A generated baseline-first PEFT runner should either define one of the resolver's searched helper names or include the actual generated helper name in the resolver.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass`.
  - Auto-handoff advanced beyond the previous `set_seed` `NameError`, confirming the `LV-146` blocker was materially narrowed.
  - `run_experiments` then failed in `_entrypoint_execute_study` with `RuntimeError: No baseline-first PEFT study execution helper was found in the runner.`
  - The generated runner defined `run_baseline_first_peft_study(...)` and aliases such as `orchestrate_baseline_first_recipe_runs = run_baseline_first_peft_study`, but `_entrypoint_execute_study(...)` searched only `execute_baseline_first_recipe_study`, `run_baseline_first_recipe_study`, `run_baseline_first_recipe_orchestration`, `run_baseline_first_recipe_comparison`, `execute_baseline_first_study`, `run_peft_instruction_study`, `run_study`, and `run_experiment`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050m`.
  - Existing session: earlier same-flow retries failed before this point on PEFT registry, TrainingArguments, benchmark loader, metrics writer, runtime-helper, and optional-helper-call boundaries.
  - Divergence: no session-state divergence observed; TUI status, `run_experiments_verify_report.json`, and the generated runner agree on the final resolver/helper mismatch.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged implementation can generate a valid baseline-first PEFT execution helper while the later CLI/main entrypoint independently emits a lookup table that omits the generated helper name. Existing implement-stage verification recognizes older dispatcher failure strings but not this baseline-first PEFT entrypoint failure string.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - extends recipe/study workflow dispatch verification to include the observed `No baseline-first PEFT study execution helper was found` failure string
      - adds `run_baseline_first_peft_study` to the known baseline-first workflow entrypoint names so future resolvers that search the generated helper name can pass
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a runner that defines `run_baseline_first_peft_study(...)` while `_entrypoint_execute_study(...)` searches only other missing PEFT study helper names

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "baseline-first PEFT entrypoint resolver|experiment orchestration resolver|registered recipe workflow|PEFT recipe registry|unguarded optional set_seed"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: partial pass on 2026-04-26 in `autolabos-live-73050n`; the generated runner advanced beyond the `No baseline-first PEFT study execution helper was found` variant, then exposed the later generic study-helper resolver mismatch tracked as `LV-148`.

- Follow-up risks:
  - Adjacent resolver-name variants may continue to appear unless the verifier remains tied to observed executable failure strings and checks that searched callable names actually resolve before handoff.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-146

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the `LV-145` PEFT registry guard
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050m` from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Start a detached real TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization and local `py_compile` verification.
  4. Let auto-handoff run the generated `run_peft_instruction_study.py`.
  5. Inspect the TUI status, `run_experiments_verify_report.json`, and `metrics.json`.

- Expected behavior:
  - Implement-stage verification should reject generated runners that call optional runtime helpers without defining them or guarding the call itself.
  - A missing `set_seed` helper should either be defined by the generated runner or replaced with a safe local seeding fallback before handoff.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass`.
  - Auto-handoff advanced beyond the previous `No PEFT recipes selected` failure, confirming the `LV-145` blocker was materially narrowed.
  - `run_experiments` then failed immediately in `run_baseline_first_study` with `NameError: name 'set_seed' is not defined`.
  - The generated code used `set_seed(int(getattr(args, "seed", SEED)) if "set_seed" in globals() else SEED)`, which protects only the argument expression and still always calls `set_seed`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050m`.
  - Existing session: earlier retries failed before this point on PEFT registry, TrainingArguments, benchmark loader, metrics writer, and runtime-helper boundaries.
  - Divergence: no session-state divergence observed; TUI status, `run_experiments_verify_report.json`, and `metrics.json` agree on the `set_seed` `NameError`.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged implementation generates optional-helper guards as conditional arguments instead of guarding the helper call or defining the helper, and implement-stage verification only checks syntax plus selected structural contracts.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - adds implement-stage verification for unsafe optional-helper call guards such as `set_seed(... if "set_seed" in globals() else ...)` when `set_seed` is not defined
      - applies the same guard to recovered bundle acceptance
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for the unguarded optional `set_seed` call shape observed in live `run_experiments`

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "PEFT recipe registry|unguarded optional set_seed|TrainingArguments|benchmark loader dispatch|metrics writer adapter"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: partial pass on 2026-04-26 in `autolabos-live-73050m`; the generated runner advanced beyond the `set_seed` `NameError`, then exposed the later resolver/helper mismatch tracked as `LV-147`.

- Follow-up risks:
  - Similar optional-helper call patterns can recur for other lowercase runtime helpers if the generated code uses expression-level guards instead of call-level guards.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-145

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the nested `LV-132` TrainingArguments repair
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050l` from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Start a fresh detached TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization, local verification, and auto-handoff.
  4. Let `run_experiments` execute the generated `run_peft_instruction_study.py`.
  5. Inspect `run_experiments_verify_report.json` and the generated runner.

- Expected behavior:
  - Implement-stage verification should reject a runner whose default CLI path can select no trainable PEFT recipe.
  - A baseline-first PEFT run should define a non-empty recipe registry before `parse_args()`/`normalize_args()` can raise on an empty selection.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass` on attempt 1/3.
  - Auto-handoff started `run_experiments`.
  - `run_experiments` failed before model loading with `ValueError: No PEFT recipes selected; check PEFT_RECIPES registry or --recipes.`
  - The generated script's `_available_recipe_names()` read `globals().get("PEFT_RECIPES", [])`, but no non-empty `PEFT_RECIPES` registry was defined for the default path.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050l`.
  - Existing session: earlier same-flow retries failed on benchmark-loader, metrics-writer, runtime-helper, and TrainingArguments compatibility boundaries before this parser/registry boundary.
  - Divergence: no state divergence observed; TUI status and `run_experiments_verify_report.json` agree on the empty recipe selection failure.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged sections generated recipe dataclasses and workflow code but did not materialize the concrete `PEFT_RECIPES` registry used by the CLI normalization path. `py_compile` cannot catch this because the registry lookup is dynamic through `globals()`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - adds implement-stage verification for PEFT recipe registry mismatches when CLI normalization can raise `No PEFT recipes selected` but no non-empty `PEFT_RECIPES` registry is defined
      - applies the same guard to recovered bundle acceptance so late recovered artifacts cannot bypass the recipe-selection contract
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a runner whose parser reads `PEFT_RECIPES` but no default registry exists

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "PEFT recipe registry|TrainingArguments|benchmark loader dispatch|metrics writer adapter"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending.

- Follow-up risks:
  - The verifier should require a real non-empty recipe registry, not inject a deterministic fallback row or fabricate experiment outputs.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-144

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the `LV-143` retryable materialization fix
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050j` from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Start a fresh detached TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization, local verification, and auto-handoff.
  4. Let `run_experiments` execute the generated `run_peft_instruction_study.py`.
  5. Inspect `run_experiments_verify_report.json`, `metrics.json`, and the generated runner.

- Expected behavior:
  - Implement-stage verification should reject a runner whose benchmark evaluator can only load examples through helper names that do not exist in the generated script.
  - Implement-stage verification should reject a runner whose canonical metrics writer has a required payload parameter name that the entrypoint adapter never passes.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass` after `python3 -m py_compile`.
  - `run_experiments` reached real execution on CUDA and loaded model weights on `NVIDIA GeForce RTX 4090`.
  - The generated runner defined `load_evaluation_benchmarks()`, but `evaluate_zero_shot_benchmarks()` searched only `load_benchmark_eval_examples()` and `load_benchmark_datasets()` before raising `RuntimeError: No benchmark examples were provided and no benchmark-loading helper is available.`
  - The failure path attempted to write failed metrics, but `_entrypoint_write_metrics()` invoked `write_metrics_json()` through keyword filtering with `metrics`, `payload`, and `metrics_payload` while the writer required `aggregated_metrics`, producing `write_metrics_json() missing 1 required positional argument: 'aggregated_metrics'`.
  - Current `metrics.json` was not produced for this failed run.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050j`.
  - Existing session: earlier same-flow retries failed before this point on orchestration dispatch and staged materialization errors.
  - Divergence: no state divergence observed; TUI status artifacts, `run_experiments_verify_report.json`, and the generated runner agree on the executable failure.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: independently generated staged sections can use semantically compatible helper concepts with incompatible concrete names. `py_compile` cannot catch the mismatch because all referenced names are protected by `globals()` checks or reflection, so the implement verifier needs cross-section contract checks for benchmark loader dispatch and metrics writer adapter signatures before handoff.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - adds implement-stage verification for benchmark loader dispatch mismatches when generated loaders exist under names not searched by the evaluator
      - adds implement-stage verification for metrics writer adapter mismatches when the entrypoint passes payload keywords that the writer signature does not accept
      - applies the same guards to recovered bundle acceptance so late recovered artifacts cannot bypass the contract checks
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for `load_evaluation_benchmarks()` being generated while the evaluator searches only `load_benchmark_eval_examples()` and `load_benchmark_datasets()`
      - adds deterministic regression coverage for `write_metrics_json(aggregated_metrics, metrics_path=...)` being called through an adapter that only passes `metrics`, `payload`, and `metrics_payload`

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "benchmark loader dispatch|metrics writer adapter|benchmark evaluator dispatch|experiment orchestration|study orchestration|retryable staged materialization"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: partial pass on 2026-04-26 in detached session `autolabos-live-73050k`: the observed benchmark-loader and metrics-writer mismatches did not auto-handoff to `run_experiments`; the run stayed in `implement_experiments` and verifier-blocked all three native Codex attempts before handoff, ending on the pre-existing `LV-132` `TrainingArguments(overwrite_output_dir=...)` compatibility surface.

- Follow-up risks:
  - The verifier should catch incompatible generated contracts without hard-coding this one run's artifacts as a deterministic fallback; the next retry must still obtain a native Codex implementation response.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-143

- Status: active
- Validation target: same-flow retry of `implement_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the expanded `LV-142` orchestration-dispatch guard
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050i` from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Start a fresh detached TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation dynamically plan materialization chunks and nested resubchunks.
  4. Allow candidate validation to reject a nested Python chunk with an indentation error.
  5. Inspect `implement_experiments/status.json`, `progress.jsonl`, and `checkpoints/latest.json`.

- Expected behavior:
  - A retryable staged materialization/candidate-validation failure should be recorded as attempt 1/3 failure.
  - The node should restore the attempt isolation context and continue with attempt 2/3 unless max attempts are exhausted.

- Actual behavior:
  - Dynamic chunk validation and re-subdivision ran repeatedly for parser/model argument chunks.
  - A deeply nested chunk failed candidate validation with `Sorry: IndentationError: unexpected indent (runner__chunk_1c__candidate.py, line 787)`.
  - `implement_experiments` wrote `status=failed` at attempt 1 even though `maxAttempts=3`.
  - No runnable implementation was produced and no next attempt was started.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050i`.
  - Existing session: earlier same-flow retries either auto-handed off to `run_experiments` or exposed orchestration-dispatch mismatches; this retry stayed inside staged materialization and failed before a runnable bundle was produced.
  - Divergence: no state divergence observed; TUI, status artifact, progress artifact, and checkpoint agree that `implement_experiments` stopped at attempt 1.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: chunk-level candidate validation errors are considered retryable inside the dynamic subdivision routine, but when a deeply nested validation failure bubbles out to the attempt-level LLM call catch, the attempt catch builds a stop-for-environment report and throws immediately instead of treating the materialization failure as a retryable implementation attempt.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - treats retryable staged materialization failures that bubble to the attempt-level LLM catch as bounded implementation failures
      - records the failed attempt, restores the isolation context, cleans up the attempt workspace, and continues to the next attempt while attempts remain
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage that a staged materialization candidate-validation error on attempt 1 is followed by attempt 2 instead of stopping the session

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "retryable staged materialization|experiment orchestration|study orchestration|registered recipe workflow"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending.

- Follow-up risks:
  - This should not mask persistent bad generation forever; max attempt handling must remain bounded at 3 attempts and should still stop after exhaustion.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`

## Issue: LV-142

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050g` from rebuilt `dist/cli/main.js` after `LV-141` verifier changes

- Reproduction steps:
  1. Start a fresh detached TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization, local verification, and auto-handoff.
  4. Let `run_experiments` execute the generated `run_peft_instruction_study.py`.
  5. Inspect `run_experiments_verify_report.json`, `metrics.json`, and the generated runner.

- Expected behavior:
  - Implement-stage verification should reject a runner whose final orchestration dispatcher searches study-entrypoint names that no generated function defines.
  - A runner should not auto-handoff if the only generated workflow function is named differently from the dispatch table used by `main()`.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass` after `python3 -m py_compile`.
  - The new runner avoided the prior dict recipe attribute, `write_metrics_json`, `get_device_info`, and zero-shot evaluator failures.
  - `run_experiments` failed immediately with `RuntimeError: No study orchestration function was found. Expected one of: run_study_orchestration, run_orchestration_and_status_handling, execute_study_with_status, run_study_with_status, run_full_study_with_status, run_peft_instruction_study, execute_peft_instruction_study, run_experiment_with_status, run_experiment`.
  - The generated runner did define `run_baseline_first_candidate_evaluation()`, but `_execute_orchestration()` never searched that name.
  - Same-flow revalidation with the first `LV-142` patch advanced to a related naming variant: the runner defined `execute_baseline_first_experiment(args, device)`, but `_select_experiment_orchestrator()` searched `run_experiment`, `run_study`, `run_peft_instruction_study`, `orchestrate_experiment`, `orchestrate_study`, `execute_experiment`, `execute_baseline_first_study`, `run_baseline_first_experiment`, `run_baseline_first_study`, and `build_and_write_metrics_payload`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050g` using rebuilt `dist/cli/main.js`.
  - Existing session: earlier same-flow retries failed on helper omissions, evaluator mismatch, and dict recipe attribute access; this retry passed those boundaries and exposed a later final-dispatcher naming mismatch.
  - Divergence: no state divergence observed for the runtime failure; `status.json`, `run_experiments_verify_report.json`, `metrics.json`, and the generated runner agree on the missing study orchestration entrypoint.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged sections can generate a valid baseline-first workflow function while the final CLI/main section independently emits a broader orchestration dispatch table. `py_compile` cannot catch the missing cross-section name contract, and the verifier only recognized older recipe-comparison dispatcher failure strings.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - extends recipe/study workflow dispatch verification to include final study orchestration failure strings such as `No study orchestration function was found`
      - extends the same guard to observed experiment-orchestration resolver variants such as `No experiment orchestration function was found`
      - rejects runners whose searched study orchestration entrypoint names are all undefined before auto-handoff
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a runner that defines `run_baseline_first_candidate_evaluation()` while `_execute_orchestration()` searches only missing study orchestration names
      - adds deterministic regression coverage for a runner that defines `execute_baseline_first_experiment()` while `_select_experiment_orchestrator()` searches only missing experiment orchestration names

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "registered recipe workflow|study orchestration|undefined execution helper|zero-shot workflow|dict recipe|benchmark evaluator dispatch"`
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "registered recipe workflow|study orchestration|experiment orchestration|undefined execution helper|zero-shot workflow|dict recipe|benchmark evaluator dispatch"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: original `No study orchestration function` variant no longer reproduced in `autolabos-live-73050h`, but the retry exposed the adjacent `No experiment orchestration function` variant; revalidation with the expanded guard is pending.

- Follow-up risks:
  - Adjacent dispatcher-name variants may continue to appear as staged generation changes task framing; verifier coverage should stay tied to observed executable failure strings rather than papering over artifacts manually.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-141

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050f` from rebuilt `dist/cli/main.js` after `LV-140` verifier changes

- Reproduction steps:
  1. Start a fresh detached TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization, local verification, and auto-handoff.
  4. Let `run_experiments` execute the generated `run_peft_instruction_study.py`.
  5. Inspect `run_experiments_verify_report.json`, `metrics.json`, and the generated runner.

- Expected behavior:
  - Implement-stage verification should reject a runner whose recipe config container is a list/tuple of dicts but later code accesses entries as objects with `recipe.name`.
  - A runner should not auto-handoff if the CLI parser will fail before experiments or even argument parsing complete.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass` after `python3 -m py_compile`.
  - The new runner avoided the prior undefined `get_device_info()` failure and zero-shot evaluator mismatch.
  - `run_experiments` failed immediately in `build_arg_parser()` with `AttributeError: 'dict' object has no attribute 'name'`.
  - Failure metrics were written, but metrics also recorded `metrics_helper_error: NameError: name 'write_metrics_json' is not defined`, showing another helper-name gap in the metrics path.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050f` using rebuilt `dist/cli/main.js`.
  - Existing session: earlier handoffs failed on undefined helpers and evaluator-dispatch mismatch; this retry passed those boundaries and exposed a recipe config schema mismatch before argument parsing completed.
  - Divergence: no state divergence observed for the runtime failure; status artifacts, verify report, and generated runner agree. The TUI still tends to retain prior error text while newer processes run, but process/artifact inspection disambiguates the current failure.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged sections can generate both dataclass/object-style recipe definitions and dict-backed recipe definitions in the same file. Later CLI/final-metadata code may assume object-style entries even when the active container is dict-backed, and `py_compile` cannot catch that schema mismatch.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - rejects dict-backed recipe config containers that are later accessed with object-style attributes such as `recipe.name`
      - treats `write_metrics_json()` as a critical helper that must be defined or imported before handoff
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for `RECIPE_CONFIGS: List[Dict[str, Any]]` with `[recipe.name for recipe in RECIPE_CONFIGS]`
      - extends undefined helper coverage to include `write_metrics_json()`

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "undefined execution helper|zero-shot workflow|dict recipe|benchmark evaluator dispatch"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending rebuilt TUI retry.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-140

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050e` from rebuilt `dist/cli/main.js` after `LV-139` verifier changes

- Reproduction steps:
  1. Start a fresh detached TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization, local verification, and auto-handoff.
  4. Let `run_experiments` execute the generated `run_peft_instruction_study.py`.
  5. Inspect `run_experiments_verify_report.json`, `exec_logs/run_experiments.txt`, and the generated runner.

- Expected behavior:
  - Implement-stage verification should reject a runner whose executable path calls critical runtime helpers that are never defined or imported.
  - Implement-stage verification should also reject a runner whose baseline-first zero-shot workflow searches only evaluator entrypoint names that no generated function defines.
  - A runner should not reach real model loading before these static executable-path defects are caught.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass` after `python3 -m py_compile`.
  - The new runner avoided the prior `get_device()` and `_json_safe()` omissions.
  - `run_experiments` loaded model weights and then failed with `RuntimeError: No zero-shot benchmark evaluation function was defined in earlier sections`.
  - The failure-metrics path also reported `Failed to write failure metrics: name 'get_device_info' is not defined`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050e` using rebuilt `dist/cli/main.js`.
  - Existing session: earlier handoffs failed on `RecipeSpec` constructor mismatch, undefined `slugify`, undefined `validate_runtime_dependencies`, and undefined `get_device`/`_json_safe`; this retry passed those boundaries and exposed a later evaluator-dispatch plus helper omission boundary.
  - Divergence: TUI display temporarily retained the previous `run_experiments` error while the new Python process was actually running; process table and updated verify report confirmed the fresh runtime failure. Dominant root cause remains implement-stage verifier coverage rather than a pure display bug.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged implementation can assemble executable workflow sections with locally valid syntax but inconsistent function naming across generated sections. The verifier had named checks for older evaluator-dispatch patterns and selected helper names, but did not cover the newer zero-shot evaluator fallback string or `get_device_info()` helper calls in metrics/failure paths.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - treats `get_device_info()` as a critical Python runtime helper that must be defined or imported before handoff
      - extends benchmark evaluator dispatch verification to cover zero-shot evaluator lookup names and the `No zero-shot benchmark evaluation function was defined in earlier sections` failure path
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - extends undefined execution-helper coverage to include `get_device_info()`
      - adds deterministic regression coverage for a `py_compile`-valid runner whose zero-shot workflow searches only missing evaluator entrypoints

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "undefined execution helper|zero-shot workflow|benchmark evaluator dispatch"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pass for the original `get_device_info()` and zero-shot evaluator mismatch symptoms on 2026-04-26 in `autolabos-live-73050f`; the retry advanced to a new `LV-141` recipe config schema failure.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-139

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050c` from rebuilt `dist/cli/main.js` after `LV-138` verifier changes

- Reproduction steps:
  1. Start a fresh detached TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization, local verification, and auto-handoff.
  4. Inspect `implement_experiments/status.json`, `run_experiments_verify_report.json`, `checkpoints/latest.json`, `metrics.json`, and the generated `run_peft_instruction_study.py`.

- Expected behavior:
  - Implement-stage verification should reject a runner whose executable path calls critical runtime helpers that are never defined or imported.
  - A runner should not auto-handoff to `run_experiments` if it will fail immediately on missing local helper functions before producing valid experiment metrics.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass` after `python3 -m py_compile`.
  - The generated runner avoided the prior undefined `validate_runtime_dependencies`, undefined `slugify`, and `RecipeSpec(name=...)` failures.
  - Auto-handoff to `run_experiments` failed with `NameError: name 'get_device' is not defined`.
  - The error-reporting path then failed again with `NameError: name '_json_safe' is not defined. Did you mean: 'json_safe'?`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050c` using rebuilt `dist/cli/main.js`.
  - Existing session: earlier retries failed on `RecipeSpec` constructor mismatch, undefined `slugify`, undefined `validate_runtime_dependencies`, and unsupported `TrainingArguments` kwargs; this retry passed those boundaries and exposed a later executable-path helper mismatch.
  - Divergence: no UI-only divergence observed; status, checkpoint, verify report, metrics, and generated runner agree on runtime helper failures after implement-stage pass.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: implement-stage verification still relies on `py_compile` plus targeted static checks. It now catches some named helper omissions, but the critical-helper coverage is too narrow, so executable lowercase helper calls such as `get_device()` and alias mismatches such as `_json_safe()` can escape to `run_experiments`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - extends critical Python runtime-helper verification to reject runners that call `get_device()` or `_json_safe()` without defining/importing them
      - applies the same check before reusing recovered public bundles
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a `py_compile`-valid runner whose executable path calls undefined `get_device()` and `_json_safe()` helpers

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "undefined execution helper|undefined runtime helper|undefined slugify|undefined return annotation|RecipeSpec constructor|benchmark evaluator dispatch|TrainingArguments"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending rebuilt TUI retry with extended runtime-helper verifier.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-138

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050b` from rebuilt `dist/cli/main.js` after `LV-137` verifier changes

- Reproduction steps:
  1. Start a fresh detached TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization, local verification, and auto-handoff.
  4. Inspect `implement_experiments/status.json`, `run_experiments_verify_report.json`, `checkpoints/latest.json`, and the generated `run_peft_instruction_study.py`.

- Expected behavior:
  - Implement-stage verification should reject a runner whose executable entrypoint calls critical runtime helper names that are never defined or imported.
  - A runner should not auto-handoff to `run_experiments` if it will fail before dependency checks, experiment execution, or metrics writing begins.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass` after `python3 -m py_compile`.
  - The generated runner avoided the prior `RecipeSpec(name=...)` and undefined `slugify()` failures.
  - The entrypoint called `validate_runtime_dependencies(dry_run=...)`.
  - No `validate_runtime_dependencies` function or import existed in the script.
  - `run_experiments` failed with `[peft-study] ERROR: name 'validate_runtime_dependencies' is not defined`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050b` using rebuilt `dist/cli/main.js`.
  - Existing session: earlier handoffs failed on constructor mismatch and undefined `slugify`; this retry passed those boundaries and exposed a later undefined runtime-helper boundary.
  - Divergence: no UI-only divergence observed; status, checkpoint, verify report, and generated runner agree on a runtime helper failure after implement-stage pass.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: implement-stage verification catches several specific undefined surfaces, but it does not verify that critical runtime helper calls in the entrypoint are defined. A runner can pass syntax verification and earlier compatibility guards while still failing immediately when `main()` starts.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - rejects Python runners that call critical runtime helper names such as `validate_runtime_dependencies()` without defining or importing them
      - prevents recovered public bundles with the same undefined runtime-helper reference from being reused
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a `py_compile`-valid runner whose `main()` calls undefined `validate_runtime_dependencies()`

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "undefined runtime helper|undefined slugify|undefined return annotation|RecipeSpec constructor|benchmark evaluator dispatch|RecipeSpec name|malformed staged_llm chunk|Codex OAuth overload|TrainingArguments|registered recipe workflow|AUTOLABOS section skeleton|untuned primary comparator"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending rebuilt TUI retry with undefined runtime-helper verifier.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-137

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched in detached session `autolabos-live-73050` from rebuilt `dist/cli/main.js` after `LV-136` verifier changes

- Reproduction steps:
  1. Start a fresh detached TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization, local verification, and auto-handoff.
  4. Inspect `implement_experiments/status.json`, `run_experiments_verify_report.json`, `checkpoints/latest.json`, and the generated `run_peft_instruction_study.py`.

- Expected behavior:
  - Implement-stage verification should reject a runner that references a helper function such as `slugify()` before defining or importing it.
  - A runner should not auto-handoff to `run_experiments` if a module-level recipe-id projection will fail before metrics can be produced.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass` after `python3 -m py_compile`.
  - The generated runner defined `RecipeSpec.recipe_id` as a property returning `slugify(self.name)`.
  - The runner then computed `ORDERED_RECIPE_IDS` at module load by reading `recipe.recipe_id` for every `RECIPE_SPECS` entry.
  - No `slugify` function or import existed before that property was evaluated.
  - `run_experiments` failed at module load with `NameError: name 'slugify' is not defined`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in detached TUI session `autolabos-live-73050` using rebuilt `dist/cli/main.js`.
  - Existing session: earlier handoffs failed on `RecipeSpec(name=...)` constructor mismatch; this retry passed that boundary and exposed a later undefined helper boundary.
  - Divergence: no UI-only divergence observed; status, checkpoint, verify report, and generated runner agree on a runtime module-load failure after implement-stage pass.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: implement-stage verification catches uppercase constants and return-annotation names, but not lowercase helper calls that can be triggered by module-level projections through dataclass properties. A runner can therefore pass `py_compile` while still failing immediately on import-time property evaluation.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - rejects Python runners that call `slugify()` without defining or importing it before handoff
      - prevents recovered public bundles with the same undefined helper reference from being reused
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a `py_compile`-valid runner whose module-level recipe-id projection calls `RecipeSpec.recipe_id`, which depends on missing `slugify()`

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "undefined slugify|undefined return annotation|RecipeSpec constructor|benchmark evaluator dispatch|RecipeSpec name|malformed staged_llm chunk|Codex OAuth overload|TrainingArguments|registered recipe workflow|AUTOLABOS section skeleton|untuned primary comparator"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending rebuilt TUI retry with undefined-`slugify` verifier.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-136

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched from rebuilt `dist/cli/main.js` after `LV-133`, `LV-134`, and `LV-135` mitigations

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete materialization and local verification.
  4. Allow the automatic handoff to `run_experiments`.
  5. Inspect `implement_experiments/status.json`, `run_experiments_verify_report.json`, `checkpoints/latest.json`, and the generated `run_peft_instruction_study.py`.

- Expected behavior:
  - Implement-stage verification should reject a runner whose `RecipeSpec(...)` constructor calls use keyword fields not accepted by the generated `RecipeSpec` dataclass.
  - A runner should not auto-handoff to `run_experiments` if module load will immediately fail before metrics can be produced.
  - Compatibility repair for `.name` attribute access should not mask an incompatible constructor schema.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass` and logged `Added a RecipeSpec.name compatibility property to run_peft_instruction_study.py before handoff`.
  - The generated runner contained an earlier valid `RecipeSpec` dataclass with fields such as `recipe_id`, `display_name`, `role`, `train`, `peft_type`, `run_order`, `is_reference`, `is_locked_baseline`, `target_modules`, `config`, and `description`.
  - A later duplicate `PEFT_RECIPES` block called `RecipeSpec(name="lora_r8", recipe_type="lora", rank=8, alpha=16, dropout=0.05, ...)`.
  - `run_experiments` failed at module load with `TypeError: RecipeSpec.__init__() got an unexpected keyword argument 'name'`.
  - `metrics.json` remained a stale zero-byte file from the failed handoff boundary.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after killing the previous TUI process, relaunching from rebuilt `dist/cli/main.js`, and retrying the same persisted run.
  - Existing session: earlier retries were blocked by transient provider failures, malformed staged chunk JSON, or evaluator-dispatch mismatch.
  - Divergence: no UI-only divergence observed; status, checkpoint, verify report, and generated runner agree on a runtime module-load failure after implement-stage pass.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: implement-stage verification repairs missing `RecipeSpec.name` attribute access but does not validate that every generated `RecipeSpec(...)` keyword call is compatible with the dataclass constructor. Mixed generated schema fragments can therefore pass `py_compile` and local compatibility repairs while failing immediately when executed.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - rejects Python runners whose `RecipeSpec(...)` keyword calls include fields not accepted by the generated `RecipeSpec` dataclass constructor
      - prevents recovered public bundles with the same constructor-keyword mismatch from being reused
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a `py_compile`-valid runner that would fail at module load because `RecipeSpec(name=..., recipe_type=..., rank=...)` does not match the generated dataclass

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "RecipeSpec constructor|benchmark evaluator dispatch|RecipeSpec name|malformed staged_llm chunk|Codex OAuth overload|TrainingArguments|registered recipe workflow|AUTOLABOS section skeleton|untuned primary comparator"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending rebuilt TUI retry with constructor-keyword verifier.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-135

- Status: active
- Validation target: same-flow retry of `implement_experiments` with auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched from rebuilt `dist/cli/main.js` after `LV-133` and `LV-134` mitigations

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native-Codex implementation complete all `6/6` materialization chunks.
  4. Allow the automatic handoff to `run_experiments`.
  5. Inspect `implement_experiments/status.json`, `run_experiments_verify_report.json`, `metrics.json`, and the generated `run_peft_instruction_study.py`.

- Expected behavior:
  - Implement-stage verification should reject or repair a runner whose orchestration layer cannot discover the benchmark evaluator generated by the evaluation section.
  - A runner should not auto-handoff to `run_experiments` if baseline evaluation will immediately fail on a missing evaluator dispatch surface.
  - `run_experiments` should not leave a zero-byte `metrics.json` after an implement-stage-verifiable but runtime-invalid evaluator mismatch.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass` after `python3 -m py_compile`.
  - The generated runner contained evaluator-like functions such as `evaluate_arc_challenge_and_hellaswag` and `evaluate_zero_shot_benchmarks`.
  - The baseline-first orchestration wrapper searched only for `evaluate_model_on_benchmarks`, `evaluate_benchmarks`, and `compute_benchmark_accuracies`.
  - `run_experiments` failed during baseline evaluation with `RuntimeError: No benchmark evaluator was defined by the evaluation_metrics_logic section`.
  - `metrics.json` was left as a zero-byte file after the command failure.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching from rebuilt `dist/cli/main.js` and retrying the same persisted run.
  - Existing session: earlier attempts were blocked by malformed chunk JSON and provider transient failures; this retry reached a later runtime boundary.
  - Divergence: no UI-only divergence observed; status, progress, checkpoint, verify report, and generated runner agree on the missing evaluator dispatch path.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: implement-stage verification validates syntax and several dispatch surfaces, but it does not verify that a baseline-first candidate evaluator lookup can resolve to a generated benchmark evaluator. The generated evaluation section and orchestration section can therefore be individually valid but semantically disconnected.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - rejects Python runners whose baseline-first evaluator dispatch searches only undefined evaluator entrypoints while generated benchmark evaluator functions exist under different names
      - prevents recovered public bundles with the same evaluator-dispatch mismatch from being reused
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a py-compile-valid runner whose orchestration cannot resolve the generated benchmark evaluator

- Regression status:
  - Automated regression test linked: yes.
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "benchmark evaluator dispatch|malformed staged_llm chunk|Codex OAuth overload|TrainingArguments|registered recipe workflow|AUTOLABOS section skeleton|untuned primary comparator"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending rebuilt TUI retry with evaluator-dispatch verifier.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-134

- Status: active
- Validation target: same-flow retry of `implement_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched from rebuilt `dist/cli/main.js` after the `LV-133` transient provider retry mitigation

- Reproduction steps:
  1. Rebuild and relaunch the TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow staged native-Codex materialization to reach chunk `2/4 subchunk 4/4`.
  4. Inspect `implement_experiments/status.json`, `implement_experiments/progress.jsonl`, and `checkpoints/latest.json`.

- Expected behavior:
  - If one staged chunk response is malformed or not parseable JSON, the materialization layer should treat that chunk as retryable.
  - The node should ask for a smaller subdivision or regenerate the malformed chunk instead of aborting the entire attempt before verifier handoff.

- Actual behavior:
  - The rebuilt TUI retry progressed through scaffold generation, decomposition, materialization planning, and multiple generated subchunks.
  - It reached `Generating staged_llm unit 1/1 chunk 2/4 subchunk 4/4: Zero-shot benchmark evaluation and accuracy aggregation helpers`.
  - The node then failed before producing a runnable implementation with `staged_llm chunk response did not contain a valid JSON object`.
  - The public script had grown to 51 KB, still contained `AUTOLABOS SECTION` skeleton markers, and did not reach local verifier or `run_experiments` handoff.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching from rebuilt `dist/cli/main.js`.
  - Existing session: earlier attempts were blocked by provider-side Codex OAuth errors tracked as `LV-133`.
  - Divergence: no UI-only divergence observed; status, progress, and checkpoint artifacts agree on parse failure before runnable handoff.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: candidate validation and timeout failures are already routed into dynamic re-subdivision, but malformed JSON chunk responses are not considered retryable materialization failures. A single malformed chunk therefore escapes the chunk-local recovery loop and terminates the whole implement attempt.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - treats malformed staged chunk JSON, wrong/missing chunk id, and empty chunk content as chunk-local retryable materialization errors
      - routes those failures through the existing dynamic re-subdivision path instead of aborting the whole implement attempt immediately
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds regression coverage for malformed staged chunk response classification

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "malformed staged_llm chunk|Codex OAuth overload|TrainingArguments|registered recipe workflow|AUTOLABOS section skeleton|untuned primary comparator"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending rebuilt TUI retry with malformed chunk responses routed to dynamic recovery

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_chunk_responses/runner_repair__zero_shot_evaluation_helpers__d0__chunk_2_4_subchunk_4_4_error.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_chunk_responses/runner_repair__zero_shot_evaluation_helpers__d0__chunk_2_4_subchunk_4_4_partial_on_error.txt`

## Issue: LV-133

- Status: active
- Validation target: same-flow retry of `implement_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`
  - TUI launched from rebuilt `dist/cli/main.js`

- Reproduction steps:
  1. Rebuild the repo and relaunch the TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow staged native-Codex implementation to generate dynamic materialization chunks.
  4. Inspect `implement_experiments/status.json` and `implement_experiments/progress.jsonl`.

- Expected behavior:
  - A transient Codex OAuth backend/request failure during one staged chunk should not permanently block same-flow validation if a subsequent retry can continue the node-owned implementation path.
  - Progress artifacts should distinguish provider-side failure from local verifier failure so `LV-132` and related implementation checks are not misclassified.

- Actual behavior:
  - A fresh rebuilt TUI retry started at `2026-04-25T16:24:32.423Z` and aborted before producing a runnable implementation with request error `8ae70323-e4a4-43a5-9fbb-2421866f6578`.
  - A second fresh rebuilt TUI retry started at `2026-04-25T16:28:15.192Z`, reached dynamic materialization, re-subdivided a failing CLI chunk, and then aborted before producing a runnable implementation with `Our servers are currently overloaded. Please try again later.`
  - The generated script snapshot at that point contained `TrainingArguments` references but did not contain `overwrite_output_dir`, so this run did not exercise the `LV-132` verifier-side repair boundary.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after killing the stale pre-build TUI process and relaunching from rebuilt `dist/cli/main.js`.
  - Existing session: an earlier retry in the same run had been aborted from the old TUI process and is not considered valid patched revalidation.
  - Divergence: no UI-only divergence observed; persisted status/progress artifacts record provider-side failure before runnable implementation handoff.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: staged implementation now depends on multiple native Codex OAuth calls. Even with streaming progress and dynamic chunking working, a transient backend overload/request failure in any chunk can abort the whole attempt before local verifier repairs or run-experiment handoff can be observed.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - classifies native Codex OAuth `overloaded`, `try again later`, and `you can retry your request` failures as transient staged-LLM provider errors
      - increases per-request transient retry budget from 3 to 5 attempts
      - retries transient failures even after partial delta output by preserving then discarding the incomplete partial response before retrying the same staged request
      - uses a small linear backoff between retry attempts
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds regression coverage that Codex OAuth overload and retry-later request failures are classified as transient, while auth-required failures are not

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "Codex OAuth overload|TrainingArguments|registered recipe workflow|AUTOLABOS section skeleton|untuned primary comparator"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending rebuilt TUI retry with transient provider retry mitigation

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-132

- Status: active
- Validation target: same-flow retry of `implement_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Rebuild and relaunch the TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow the staged native-Codex implementation to complete all three implement attempts.
  4. Inspect `implement_experiments/status.json`, `implement_experiments/progress.jsonl`, and `checkpoints/latest.json`.

- Expected behavior:
  - Once implement-stage verification reports the installed-version-incompatible `TrainingArguments(overwrite_output_dir=...)` kwarg, subsequent retries should either remove the kwarg or materialize a version-compatible kwargs factory.
  - The node should not exhaust all implement attempts on the same known compatibility surface.

- Actual behavior:
  - Attempt 1 failed local verification on `TrainingArguments(... overwrite_output_dir=...)`.
  - Attempt 2 generated a `Version-compatible TrainingArguments factory`, but then failed on an undefined `TrainingArguments` annotation.
  - Attempt 3 again failed local verification on `TrainingArguments(... overwrite_output_dir=...)` at `run_peft_instruction_study.py:272`.
  - The node ended with `status: "failed"` and did not hand off a runnable bundle to `run_experiments`.

- Fresh vs existing session comparison:
  - Fresh session: not yet rerun from a clean validation workspace for this exact boundary.
  - Existing session: reproduced in the active persisted run after the `LV-113` verifier mitigation was already present.
  - Divergence: no UI-only divergence observed; persisted status/progress/checkpoint artifacts agree that all attempts failed in implement-stage local verification.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: the verifier now identifies the incompatible `TrainingArguments` kwarg, but the retry feedback is not sufficient to force native Codex to remove the direct kwarg in every regenerated runner. A narrow verifier-side compatibility repair can remove the known unsupported kwarg without substituting experiment results or bypassing node-owned execution.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - attempts a narrow verifier-side compatibility repair that removes direct unsupported `TrainingArguments(overwrite_output_dir=...)` kwargs before local verification
      - now extracts full `TrainingArguments(...)` calls by parenthesis depth before repair, so nested expressions such as `output_dir=str(recipe_output_dir)` do not hide a later unsupported kwarg from the repair pass
      - leaves all experiment execution, metrics, and result rows node-owned; the repair only normalizes a known constructor compatibility surface
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - updates TrainingArguments regression coverage to require the unsupported kwarg to be removed before verification passes, including a nested `output_dir=str(...)` argument before `overwrite_output_dir`

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "TrainingArguments|registered recipe workflow|AUTOLABOS section skeleton|untuned primary comparator"`
  - Targeted nested-call repair test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "TrainingArguments|benchmark loader dispatch|metrics writer adapter"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: latest rebuilt TUI retry in `autolabos-live-73050k` confirmed verifier-side blocking before handoff, but attempt 3 reproduced `TrainingArguments(overwrite_output_dir=...)` after `output_dir=str(...)`; nested-call repair has been strengthened and requires another same-flow retry.

- Follow-up risks:
  - This repair should remain limited to constructor-compatibility surface cleanup; it must not fabricate experiment metrics, result rows, or fallback outputs.
- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-131

- Status: active
- Validation target: same-flow retry of `implement_experiments` and auto-handoff to `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow `implement_experiments` to pass local `python3 -m py_compile`.
  4. Let the auto-handoff execute `run_experiments`.
  5. Inspect `run_experiments_verify_report.json`, `metrics.json`, and `exec_logs/run_experiments.txt`.

- Expected behavior:
  - A runner that exposes a CLI dispatch helper for the recipe-comparison workflow should define at least one of the workflow function names it searches for.
  - If no searched recipe-comparison workflow function is defined, implement-stage verification should fail before auto-handoff to `run_experiments`.
  - The failure should feed back to the LLM implementer as a missing executable workflow function, not consume runner retry budget.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass`.
  - `run_experiments` executed the generated runner and wrote failed metrics with no result rows.
  - `metrics.json` recorded:
    - `RuntimeError: No recipe comparison workflow function was registered by earlier sections`
    - looked-for names included `run_baseline_first_peft_comparison`, `run_baseline_first_recipe_comparison`, `run_peft_recipe_comparison`, `execute_recipe_comparison`, `run_recipe_comparison`, `run_recipe_execution_and_evaluation_loop`, `execute_recipe_execution_and_evaluation_loop`, `run_study_comparison`, `compare_peft_recipes`, and `run_all_recipes`
  - `run_experiments_verify_report.json` failed at stage `command` with exit code `1`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching the rebuilt TUI and retrying the same persisted run.
  - Existing session: the same persisted run had older implementation failures and runtime blockers; this is a later handoff boundary after `py_compile` and metrics-writer coverage improved.
  - Divergence: no UI-only divergence; TUI replay, verifier report, metrics JSON, and exec log agree on the missing workflow registration.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: implement-stage verification still validates syntax and selected compatibility surfaces, but it does not check that generated dispatch tables are backed by at least one actually defined recipe-comparison workflow function. The runner can therefore be syntactically valid and still have no executable experiment loop.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - rejects Python runners whose recipe-comparison dispatcher searches only undefined workflow function names
      - applies the same rejection to recovered public bundles before reuse
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds deterministic regression coverage for a py-compile-valid runner with no registered workflow function

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-26 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "registered recipe workflow|orchestration candidate|AUTOLABOS section skeleton|untuned primary comparator"`
  - Build: pass on 2026-04-26 with `npm run build`
  - Harness: pass on 2026-04-26 with `npm run validate:harness`
  - Same-flow live revalidation: pending rebuilt TUI retry after verifier repair

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-120

- Status: resolved
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` while retrying `implement_experiments` with native Codex OAuth staged implementation
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow staged implementation to reach `chunk 4/5 subchunk 1/4` and its nested resubchunks for benchmark scoring helpers.
  4. Inspect `implement_experiments/status.json`, `implement_experiments/progress.jsonl`, and `checkpoints/latest.json`.

- Expected behavior:
  - If candidate validation identifies missing uppercase constants in a Python section, the node should ask the LLM for the minimal prepended constant definitions before exhausting deeper subdivision.
  - The repair should remain LLM-owned and node-internal; it must not substitute a deterministic fallback runner or manually fabricate experiment artifacts.
  - If the targeted repair cannot satisfy candidate validation, the existing dynamic re-subdivision path should remain available.

- Actual behavior:
  - Before the fix, native Codex OAuth streamed through chunk 4 and multiple nested resubchunks.
  - Candidate validation repeatedly caught undefined benchmark constants.
  - The node finally failed before producing a runnable implementation:
    - `DEFAULT_BENCHMARK_EVAL_BATCH_SIZE`
  - After the targeted repair, same-flow live revalidation reached `implement_experiments` completion at 2026-04-24T16:53:02.548Z with `verifyStatus=pass`.
  - The same run now advances into `run_experiments`; the current blocker is a later generated orchestration entrypoint mismatch tracked separately as `LV-122`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after rebuilding and relaunching the TUI, then running the same `/agent retry implement_experiments ...` flow.
  - Existing session: prior attempts in the same run failed at earlier validator or runtime boundaries.
  - Divergence: no UI-only divergence; status, progress, checkpoint, and error artifacts agree.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: dynamic re-subdivision correctly receives candidate-validation failures, but repeated nested splits are a poor repair mechanism for missing constants. The LLM needs a narrow, validation-triggered repair turn that asks only for the missing uppercase constant definitions to prepend before the failing chunk content.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`
  - Change summary: when candidate validation reports undefined uppercase constants, staged materialization now performs a targeted LLM repair pass that returns only prepended Python constant definitions. The repaired content is immediately revalidated; if it still fails, the prior dynamic re-subdivision path remains the fallback.

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "uppercase constants"`
  - Focused regression suite: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "candidate syntax|globals-guarded|undefined uppercase|undefined return annotation|uppercase constants|promotes synthetic reproducibility|replaces incompatible real_execution"`
  - Build: pass on 2026-04-24 with `npm run build`
  - Harness: pass on 2026-04-24 with `npm run validate:harness`
  - Full tests: pass on 2026-04-24 with `npm test`
  - Same-flow live revalidation: resolved on the same persisted run; observed targeted constant-repair progress entries include `DEFAULT_NUM_TRAIN_EPOCHS`, `DEFAULT_PER_DEVICE_EVAL_BATCH_SIZE`, `DEFAULT_LR_SCHEDULER_TYPE`, `DEFAULT_LORA_TARGET_MODULES`, and later `LOCKED_RECIPE_SPECS`
  - Adjacent regression review: previous `None`/`tuple[...]` annotation false positives were corrected by extending the annotation detector's safe built-in names, and the full test suite now passes

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`

## Issue: LV-122

- Status: resolved
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after `implement_experiments` completed and handed off to `run_experiments`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow `implement_experiments` to complete and pass local `python3 -m py_compile`.
  4. Let the run hand off to `run_experiments`.
  5. Inspect `checkpoints/latest.json` and the generated public runner.

- Expected behavior:
  - The generated runner's main path should invoke the actual orchestration function generated by the staged implementation.
  - If `_invoke_experiment_orchestration(...)` uses a `candidate_names` list, implement-stage verification should ensure safe generated entrypoints such as `execute_locked_recipe_plan` are included before handoff.
  - `run_experiments` should not be the first place this entrypoint mismatch is discovered.

- Actual behavior:
  - `implement_experiments` completed and passed local `py_compile`.
  - `run_experiments` immediately failed with:
    - `RuntimeError: No compatible experiment orchestration function was found. Tried: none. Last error: None`
  - The generated script defines `execute_locked_recipe_plan(...)`, but `_invoke_experiment_orchestration(...)` did not include that function name in its candidate list.
  - After the orchestration-candidate repair and rebuilt retry, this failure did not recur.
  - The same persisted run advanced to later runtime blockers tracked as `LV-123` and `LV-124`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching the rebuilt TUI and retrying the same persisted run.
  - Existing session: the same run crossed earlier constant and `peft_type` boundaries before failing at this new handoff boundary.
  - Divergence: no UI-only divergence; checkpoint and generated script agree on the failing boundary.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: implement-stage verification still over-relies on `py_compile` for the final runner handoff surface. A syntactically valid runner can define the correct orchestration function but omit it from the dispatch list used by `main()`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - adds a bounded Python runner compatibility repair that inserts safe, actually defined orchestration entrypoints into `_invoke_experiment_orchestration` candidate lists before handoff
      - re-runs local verification after the repair is materialized
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds a regression that a runner defining `execute_locked_recipe_plan(...)` but omitting it from `candidate_names` is repaired before handoff

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "RecipeSpec peft_type|orchestration candidate|uppercase constants|ExperimentConfig metadata"`
  - Build: pass on 2026-04-25 with `npm run build`
  - Harness: pending after newest issue-log update
  - Same-flow live revalidation: resolved for the orchestration-candidate boundary; the same persisted run no longer fails with `No compatible experiment orchestration function was found`

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-123

- Status: resolved
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the orchestration-candidate repair allowed `run_experiments` to start the generated PEFT runner
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` and allow handoff.
  3. Let `run_experiments` execute the generated PEFT runner.
  4. Inspect `checkpoints/latest.json` and `exec_logs/run_experiments.txt`.

- Expected behavior:
  - A generated runner that requires `trl` should either declare it in the bootstrap contract or fail during implement-stage preflight before consuming `run_experiments` retry budget.
  - Runtime dependency checks should cover Python modules required by generated imports, not only file/path materialization.

- Actual behavior:
  - After the LV-122 repair, `run_experiments` reached runtime dependency validation and failed with:
    - `RuntimeDependencyError: Missing required runtime dependencies for PEFT instruction study: trl`
  - Local inspection showed `torch`, `transformers`, `datasets`, `peft`, and `accelerate` were present, but `trl` was missing.
  - Installing `trl` resolved this blocker:
    - `python3 -m pip install trl`
    - verification output: `trl 1.2.0 SFTTrainer ok`
  - A subsequent retry progressed past the missing-`trl` boundary and failed later on `set_seed`, tracked as `LV-124`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in the rebuilt TUI after the orchestration-candidate boundary was repaired.
  - Existing session: prior attempts failed before dependency bootstrap reached the `trl` check.
  - Divergence: no UI-only divergence; checkpoint, exec log, and generated runner agree on the missing dependency.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: the generated bootstrap contract omitted `trl` even though the generated script required `SFTTrainer`, and implement-stage bootstrap evaluation currently does not enforce `python_module_available` checks. The handoff therefore relied on `py_compile`, which does not import runtime dependencies.

- Code/test changes:
  - Code: none for the local environment unblock; `trl` was installed into the validation Python environment.
  - Follow-up needed: implement-stage bootstrap evaluation should enforce required Python module availability and should derive or validate required modules from generated imports before handoff.

- Regression status:
  - Automated regression test linked: no
  - Environment verification: pass on 2026-04-25 with `python3 -c "import trl; from trl import SFTTrainer; print('trl', trl.__version__, 'SFTTrainer ok')"`
  - Same-flow live revalidation: resolved for missing `trl`; the same persisted run advanced to the later `set_seed` runtime defect in `LV-124`
  - Adjacent regression review: this is a dependency-coverage gap, not a recurrence of the orchestration-candidate bug

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/bootstrap_contract.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-124

- Status: resolved
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after installing `trl` and retrying `run_experiments`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Install and verify `trl` in the validation environment.
  2. In the real TUI, run `/agent retry run_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let the generated PEFT runner enter baseline execution.
  4. Inspect `checkpoints/latest.json`, `run_experiments_verify_report.json`, and the generated script.

- Expected behavior:
  - If a generated runner imports `set_seed as transformers_set_seed`, any helper that calls `set_seed(...)` should bind a compatibility alias before handoff.
  - Implement-stage verification should catch this simple runtime-name mismatch before `run_experiments` executes the baseline.

- Actual behavior:
  - The runner imported `set_seed` as `transformers_set_seed`.
  - The generated `seed_everything(...)` helper called `set_seed(...)` directly.
  - `py_compile` passed because undefined names inside function bodies are not resolved until execution.
  - `run_experiments` failed with:
    - `NameError: name 'set_seed' is not defined`
  - Latest observed checkpoint:
    - sequence: `327`
    - node: `run_experiments`
    - phase: `fail`
    - createdAt: `2026-04-25T04:41:27.591Z`
  - After rebuilt same-flow retry through `implement_experiments`, the regenerated runner defined a concrete `set_seed(...)` wrapper around `hf_set_seed`.
  - The same persisted run advanced past the `set_seed` failure and executed into a later metrics serialization failure tracked as `LV-125`.

- Fresh vs existing session comparison:
  - Fresh session: resolved after rebuilt TUI retry through `implement_experiments`.
  - Existing session: reproduced in the active persisted run after the missing-`trl` blocker was resolved.
  - Divergence: no UI-only divergence; generated source, checkpoint, and verifier report agreed on the runtime-name mismatch before the fix, and the post-fix run crossed that boundary.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: implement-stage handoff verification still treats `py_compile` as enough for function-body name safety. The generated source had a recoverable import alias mismatch, but no compatibility pass bound `set_seed = transformers_set_seed` before runtime.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - adds a bounded Python runner compatibility repair that inserts a `set_seed` alias when a runner imports `transformers.set_seed` as `transformers_set_seed` but later calls `set_seed(...)`
      - re-runs local verification after the repair is materialized
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds a regression for the missing Transformers `set_seed` alias before auto-handoff to `run_experiments`

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-25 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "set_seed|orchestration candidate|RecipeSpec peft_type|uppercase constants|ExperimentConfig metadata"`
  - Build: pass on 2026-04-25 with `npm run build`
  - Diff whitespace check: pass on 2026-04-25 with `git diff --check`
  - Harness: pass on 2026-04-25 with `npm run validate:harness`
  - Same-flow live revalidation: resolved for the `set_seed` boundary; the same persisted run progressed into `run_experiments` and failed later on invalid `NaN` metrics JSON

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-125

- Status: resolved
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the rebuilt `implement_experiments` retry crossed the `set_seed` runtime boundary
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow the generated runner to pass local `py_compile` and auto-handoff to `run_experiments`.
  4. Let the PEFT runner execute the tiny GPT-2 baseline/comparator path.
  5. Inspect `metrics.json`, `checkpoints/latest.json`, and `run_experiments_verify_report.json`.

- Expected behavior:
  - `metrics.json` should always be strict JSON parseable by Node and downstream analysis.
  - If a metric is non-finite, the generated runner should serialize it as a JSON-safe missing value and preserve the surrounding execution evidence rather than writing invalid JSON.
  - Implement-stage handoff verification should normalize Python `json.dump(...)` calls used for metrics so non-standard `NaN` literals cannot leak into persisted artifacts.

- Actual behavior:
  - The generated runner executed far enough to write metrics.
  - Python `json.dump(...)` emitted `NaN` for `train_loss`.
  - Node-side metrics parsing rejected the file:
    - `Experiment produced invalid metrics JSON at .../metrics.json: Unexpected token 'N', ..."in_loss": NaN, "... is not valid JSON`
  - Latest observed checkpoint:
    - sequence: `333`
    - node: `run_experiments`
    - phase: `fail`
    - createdAt: `2026-04-25T04:49:18.131Z`
  - After the strict metrics JSON repair, implement-stage verification emitted:
    - `Made metrics JSON serialization strict and non-finite-safe in run_peft_instruction_study.py before handoff.`
  - The same persisted run crossed the invalid-`NaN` metrics boundary and failed later on `RecipeSpec.name`, tracked as `LV-126`.

- Fresh vs existing session comparison:
  - Fresh session: resolved after rebuilt TUI retry through `implement_experiments`.
  - Existing session: reproduced in the active persisted run after `set_seed` was resolved.
  - Divergence: no UI-only divergence; checkpoint, verifier report, and the raw `metrics.json` agreed on invalid JSON before the fix, and the post-fix run crossed that boundary.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: generated Python runners may use `json.dump` with its default `allow_nan=True`, which writes JavaScript-style non-finite literals that are not valid JSON. The current implement-stage verifier catches syntax and selected runner-surface issues but does not enforce metrics serialization strictness before handoff.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - adds a bounded Python runner compatibility repair that inserts `_autolabos_json_safe(...)` and rewrites `json.dump(...)` calls to serialize strict JSON with `allow_nan=False`
      - maps non-finite floats and numpy/torch scalar non-finite values to `null` before persisted metrics are written
      - re-runs local verification after the repair is materialized
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds a regression that a Python runner writing `float('nan')` through `json.dump(payload, ...)` is repaired before auto-handoff

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-25 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "strict|set_seed|orchestration candidate|RecipeSpec peft_type|uppercase constants|ExperimentConfig metadata"`
  - Build: pass on 2026-04-25 with `npm run build`
  - Harness: pass on 2026-04-25 with `npm run validate:harness`
  - Diff whitespace check: pass on 2026-04-25 with `git diff --check`
  - Same-flow live revalidation: resolved for invalid `NaN` metrics JSON; the same persisted run advanced to the later `RecipeSpec.name` runtime defect in `LV-126`

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-126

- Status: resolved
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the strict metrics JSON repair allowed `run_experiments` to execute the regenerated runner
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow `implement_experiments` to complete and hand off to `run_experiments`.
  4. Inspect `checkpoints/latest.json` and the generated runner traceback.

- Expected behavior:
  - If generated code constructs argparse choices with `[recipe.name for recipe in PEFT_RECIPES]`, each `RecipeSpec` object should expose a compatible `.name` value before handoff.
  - Implement-stage verification should catch or repair this dataclass surface mismatch before `run_experiments` executes the command.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass`.
  - `run_experiments` failed during argument parser construction:
    - `AttributeError: 'RecipeSpec' object has no attribute 'name'`
  - Latest observed checkpoint:
    - sequence: `339`
    - node: `run_experiments`
    - phase: `fail`
    - createdAt: `2026-04-25T05:01:24.237Z`
  - After the `RecipeSpec.name` repair, the same persisted run no longer failed during parser construction.
  - Same-flow revalidation advanced into candidate orchestration and exposed a later locked recipe-order contradiction tracked as `LV-127`.

- Fresh vs existing session comparison:
  - Fresh session: resolved after rebuilt TUI retry through `implement_experiments`.
  - Existing session: reproduced in the active persisted run after `LV-125` was resolved.
  - Divergence: no UI-only divergence; generated source and checkpoint agreed on the dataclass surface mismatch before the fix, and the post-fix same-flow retry crossed that boundary.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: generated recipe code changed the `RecipeSpec` schema to fields such as `recipe_id` and `display_name`, but later parser code still projected the older `.name` surface. `py_compile` cannot evaluate list comprehensions inside parser construction, so the mismatch escaped to `run_experiments`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - adds a bounded Python runner compatibility repair that inserts a `RecipeSpec.name` property when generated code references `.name` but the dataclass does not expose that field
      - re-runs local verification after the repair is materialized
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds a regression for a generated `PEFT_RECIPES` list used by argparse choices through `recipe.name`

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-25 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "RecipeSpec name|strict|set_seed|orchestration candidate|RecipeSpec peft_type|uppercase constants|ExperimentConfig metadata"`
  - Build: pass on 2026-04-25 with `npm run build`
  - Harness: pass on 2026-04-25 with `npm run validate:harness`
  - Diff whitespace check: pass on 2026-04-25 with `git diff --check`
  - Same-flow live revalidation: resolved for `RecipeSpec.name`; the same persisted run advanced to the later baseline-first recipe-order defect in `LV-127`

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-127

- Status: active
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after the `RecipeSpec.name` repair allowed `run_experiments` to reach candidate orchestration
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow `implement_experiments` to complete and hand off to `run_experiments`.
  4. Let the generated runner enter `_get_locked_recipe_sequence(...)`.
  5. Inspect `checkpoints/latest.json`, `exec_logs/run_experiments.txt`, and the generated runner.

- Expected behavior:
  - For `COMPARISON_MODE = "baseline_first_locked"`, the generated PEFT runner should execute the locked standard LoRA tuned baseline first.
  - The untuned reference can remain in the comparison for context, but it should not displace the primary tuned baseline when the experiment contract says baseline-first.
  - Implement-stage verification should catch a generated runner that contains contradictory standard-first and reference-first recipe-order checks before handoff.

- Actual behavior:
  - First reproduction:
    - `implement_experiments` completed with `verifyStatus=pass`.
    - `run_experiments` failed before candidate execution with:
      - `RuntimeError: Locked comparison contract requires the untuned reference candidate to run first.`
    - The generated runner's earlier `validate_locked_peft_recipe_order(...)` requires `LOCKED_STANDARD_LORA_RECIPE_ID` first.
    - A later helper `_candidate_sort_key(...)` sorted `_recipe_is_reference(recipe)` to rank `0`, and `_get_locked_recipe_sequence(...)` then required reference first.
    - This internal contradiction escaped `py_compile` because the failing order check only executes at runtime.
  - Same-flow revalidation after the first compatibility repair:
    - `implement_experiments` and `run_experiments` reached `verifyStatus=pass`.
    - `metrics.json` still used `recipe_order: ["baseline_no_tuning", "lora_r8", "lora_r16"]`.
    - `best_recipe` was `baseline_no_tuning`, `baseline_mean_zero_shot_accuracy` was `0.36458333333333337`, and both tuned LoRA variants were lower at `0.34375`.
    - The experiment contract requires the named tuned standard LoRA baseline (`rank=16`, `dropout=0.0`, full subset, fixed seed) as the primary comparator, not an untuned/no-tuning row as the primary baseline.

- Fresh vs existing session comparison:
  - Fresh session: pending rebuilt TUI retry after the baseline-first recipe-order repair.
  - Existing session: reproduced in the active persisted run after `LV-126` was resolved.
  - Divergence: no UI-only divergence; checkpoint, exec log, and generated source agree on the runtime recipe-order contradiction.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged implementation combined two incompatible projections of the comparison contract: a standard-LoRA-first validator and a reference-first orchestrator helper. Implement-stage verification does not execute the candidate sequence helper, so the self-contradiction survived until `run_experiments`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - adds a bounded Python runner compatibility repair that detects `baseline_first_locked` runners whose `_get_locked_recipe_sequence(...)` enforces untuned-reference-first ordering
      - rewrites `_candidate_sort_key(...)` and the sequence validation to keep the standard LoRA tuned baseline first while retaining the untuned reference in the comparison
      - re-runs local verification after the repair is materialized
      - adds a verification blocker for generated baseline-first PEFT runners that treat `baseline_no_tuning` as the primary baseline while tuned LoRA candidates exist
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds a regression for generated baseline-first PEFT runners that sort the untuned reference before the locked tuned baseline
      - adds a regression that rejects generated baseline-first PEFT runners using an untuned/no-tuning row as the primary comparator

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-25 with `npx vitest run tests/objectiveMetric.test.ts tests/implementSessionManager.test.ts --testNamePattern "PEFT recipe result rows|delta objective|untuned row as the primary comparator|baseline-first PEFT"`
  - Build: pass on 2026-04-25 with `npm run build`.
  - Harness: pass on 2026-04-25 with `npm run validate:harness`.
  - Same-flow live revalidation: narrowed before this follow-up. Pending rebuilt TUI retry to verify the semantic tuned-baseline blocker is now enforced in the live flow.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-128

- Status: resolved
- Validation target: same-flow `analyze_results` evaluation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after `run_experiments` produced a technically valid metrics bundle
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `run_experiments`
  - failing node: `analyze_results`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Continue the same persisted run after `run_experiments` writes `metrics.json`.
  2. Allow `analyze_results` to evaluate the objective metric.
  3. Inspect `run_experiments_verify_report.json`, `metrics.json`, `result_analysis.json`, and `result_table.json`.

- Expected behavior:
  - A target such as at least `+1.0` percentage point over baseline must evaluate a numeric delta or improvement-over-baseline metric.
  - If only absolute baseline accuracy is available, `analyze_results` should report the objective metric as missing or not met, not met.
  - If tuned alternatives underperform the baseline, the objective should be `not_met`.

- Actual behavior:
  - `metrics.json` had `baseline_mean_zero_shot_accuracy=0.36458333333333337`.
  - Tuned LoRA alternatives had lower mean zero-shot accuracy (`0.34375`).
  - `analyze_results` matched `baseline_mean_zero_shot_accuracy` for primary metric `accuracy_delta_vs_baseline`.
  - The result was incorrectly marked `met` because `0.36458333333333337 >= 0.01`.
  - `result_table.json` had no comparison rows, so the public analysis surface did not expose the required delta comparison.

- Fresh vs existing session comparison:
  - Fresh session: pending rebuilt TUI retry after the objective-metric repair.
  - Existing session: reproduced in the active persisted run after `LV-127` was narrowed.
  - Divergence: no UI-only divergence observed; stored metrics and analysis artifacts agree on the false-positive objective evaluation.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: objective metric matching treats token overlap between `accuracy_delta_vs_baseline` and `baseline_mean_zero_shot_accuracy` as enough for best-effort matching, and relative metric synthesis does not currently derive a delta from `results[]` rows shaped like PEFT recipe outputs.

- Code/test changes:
  - Code:
    - `src/core/objectiveMetric.ts`
      - synthesizes delta/improvement metrics from `metrics.results[]` when baseline and non-baseline recipe rows exist
      - adds PEFT-style accuracy keys such as `mean_zero_shot_accuracy`, `zero_shot_accuracy`, `arc_challenge_accuracy`, and `hellaswag_accuracy`
      - prevents best-effort matching from selecting absolute baseline metrics for relative/delta objectives
  - Tests:
    - `tests/objectiveMetric.test.ts`
      - adds regressions for PEFT recipe-row delta synthesis and for rejecting false-positive absolute baseline matches

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-25 with `npx vitest run tests/objectiveMetric.test.ts tests/implementSessionManager.test.ts --testNamePattern "PEFT recipe result rows|delta objective|untuned row as the primary comparator|baseline-first PEFT"`
  - Build: pass on 2026-04-25 with `npm run build`.
  - Harness: pass on 2026-04-25 with `npm run validate:harness`.
  - Same-flow live revalidation: resolved on 2026-04-25 after relaunching the rebuilt TUI; replayed `analyze_results` reported `Objective metric not met: accuracy_delta_vs_baseline=-0.02083333333333337 does not satisfy >= 0.01` instead of matching `baseline_mean_zero_shot_accuracy`.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/result_analysis.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/result_table.json`

## Issue: LV-129

- Status: resolved
- Validation target: same-flow retry of `implement_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after adding the tuned-baseline semantic validator
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Rebuild the project after adding the tuned-baseline semantic validator.
  2. Relaunch the TUI in `.autolabos-validation`.
  3. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  4. Inspect `implement_experiments/status.json` and `implement_experiments/progress.jsonl`.

- Expected behavior:
  - The recovered-bundle path should apply the same semantic validation as the normal local-verification path.
  - A stale public runner that treats `baseline_no_tuning` as the primary comparator should not be reused only because it has prior execution evidence and passes `py_compile`.
  - The node should either re-enter Codex or fail with actionable feedback rather than silently accepting the stale bundle.

- Actual behavior:
  - The rebuilt TUI retried `implement_experiments`.
  - The node reused the existing governed experiment bundle and execution evidence instead of re-entering Codex.
  - `implement_experiments/status.json` reported `verifyStatus=pass` after only `python3 -m py_compile`.
  - The stale `run_peft_instruction_study.py` still contained the untuned-primary-baseline structure observed in `LV-127`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching the rebuilt TUI.
  - Existing session: the stale public bundle was accepted from the persisted run directory.
  - Divergence: no UI-only divergence; progress and status artifacts show the recovered-bundle path bypassing the new semantic validator.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `recoverStructuredResultFromPublicBundle(...)` can return a structured implement result before the normal verification path inspects semantic runner contracts, so stale persisted public artifacts can remain authoritative after the code-level validator changes.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - rejects recovered public bundles when `detectPythonBaselineFirstTunedBaselineMismatch(...)` identifies an untuned/no-tuning primary baseline in a baseline-first PEFT runner
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds a regression that a bad baseline-first PEFT public bundle with execution evidence is not reused and Codex is re-entered

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-25 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "untuned primary comparator|baseline-first PEFT runner uses an untuned primary comparator|existing public bundle with execution evidence"`
  - Build: pass on 2026-04-25 with `npm run build`.
  - Harness: pass on 2026-04-25 with `npm run validate:harness`.
  - Same-flow live revalidation: resolved for the recovered-bundle reuse boundary on 2026-04-25. After relaunching the rebuilt TUI and running `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`, progress entered `Planning staged_llm implementation scaffold before generating file contents` and subsequent Codex OAuth generation instead of `Reused the existing governed experiment bundle and execution evidence`.
  - Remaining downstream status: `implement_experiments` is still running through dynamic staged generation; this is tracked under the broader `LV-127` semantic tuned-baseline contract issue rather than `LV-129`.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-130

- Status: active
- Validation target: same-flow retry of `run_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after `implement_experiments` generated a new tuned-baseline runner
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. After implement reports `verifyStatus=pass`, run `/agent retry run_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  4. Inspect `run_experiments_verify_report.json`, `exec_logs/run_experiments.txt`, `metrics.json`, and the generated runner tail.

- Expected behavior:
  - Final generated Python runners must contain executable code for all materialized sections.
  - Planning-only `AUTOLABOS SECTION` skeleton markers must not survive into the final script.
  - Implement-stage verification should reject an incomplete sectioned skeleton before handoff, because `py_compile` cannot prove that the script writes metrics.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass`.
  - `run_experiments` archived the prior metrics and ran the new script.
  - The script exited with code `0` after logging only device detection.
  - `metrics.json` was missing, and `run_experiments_verify_report.json` failed with:
    - `Experiment finished without metrics output at .../metrics.json`
  - The generated script tail still contained empty final sections:
    - `orchestration_row_runner`
    - `orchestration_baseline_first_workflow`
    - `orchestration_result_aggregation`
    - `cli_metrics_writer`
    - `cli_parser_and_main`

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching the rebuilt TUI and retrying the same persisted run.
  - Existing session: the same persisted run had older metrics from the previous runner; these were archived before the failed new execution.
  - Divergence: no UI-only divergence; status, verifier report, exec log, and generated source agree on an incomplete final runner.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: staged materialization can recover a partially materialized sectioned skeleton after Codex stream failure. Local verification only runs `py_compile`, so skeleton markers and missing executable entrypoint/metrics writer code can pass implement-stage verification.

- Code/test changes:
  - Code:
      - `src/core/agents/implementSessionManager.ts`
      - rejects final Python runners that still contain `AUTOLABOS SECTION` skeleton markers after staged materialization
      - runs the unfilled-section check before local `py_compile`, so incomplete sectioned runners receive targeted implementation feedback instead of first surfacing syntax/compatibility-shim failures
      - reports the failure as a runnable-entrypoint/metrics-writer completion issue before auto-handoff to `run_experiments`
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds a regression that a final Python runner with unfilled section skeleton markers fails implement-stage verification instead of reaching `run_experiments`

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-25 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "AUTOLABOS section skeleton|comment scaffolding|untuned primary comparator"`
  - Build: pass on 2026-04-25 with `npm run build`
  - Harness: pass on 2026-04-25 with `npm run validate:harness`
  - Same-flow live revalidation: pending rebuilt TUI retry through `implement_experiments`; an initial rebuilt retry blocked before handoff on local `py_compile` after compatibility repairs, so the check was moved earlier and must be re-run from the rebuilt TUI

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-121

- Status: resolved
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after `implement_experiments` generated a `RecipeSpec` constructor surface used by `run_experiments`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - producing node: `implement_experiments`
  - failing node: `run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let the run hand off to `run_experiments`.
  4. Inspect the generated runner traceback.

- Expected behavior:
  - Generated recipe factories should pass the required fields expected by `RecipeSpec`.
  - Implement-stage verification should repair or reject a constructor-surface mismatch before handoff.

- Actual behavior:
  - Before the fix, `run_experiments` failed with:
    - `TypeError: RecipeSpec.__init__() missing 1 required positional argument: 'peft_type'`
  - After the compatibility repair and same-flow retry, this `peft_type` failure did not recur.
  - The same run progressed to a later orchestration candidate mismatch tracked as `LV-122`.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching the TUI and retrying the same persisted run.
  - Existing session: prior attempts failed at earlier implement-stage boundaries before reaching this constructor mismatch.
  - Divergence: no UI-only divergence; the generated runner traceback matched the checkpoint failure.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: generated recipe compatibility helpers filtered candidate kwargs against `RecipeSpec.__dataclass_fields__`, but only supplied aliases such as `adapter_type` or `peft_method`; when `RecipeSpec` required `peft_type`, the handoff passed `py_compile` and failed only at runtime.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - adds a bounded `RecipeSpec.peft_type` alias repair before handoff
      - re-runs local verification after the repair
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - adds a regression for the missing `RecipeSpec.peft_type` alias repair

- Regression status:
  - Automated regression test linked: yes
  - Targeted test: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "RecipeSpec peft_type|orchestration candidate|uppercase constants|ExperimentConfig metadata"`
  - Same-flow live revalidation: resolved for the `peft_type` boundary; the next observed failure is `LV-122`

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-119

- Status: active
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after retrying `implement_experiments` and handing off to `run_experiments`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - failing node: `run_experiments`
  - producing node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow native Codex staged implementation to complete and pass local `py_compile`.
  4. Let the TUI hand off to `run_experiments`.
  5. Inspect `checkpoints/latest.json`.

- Expected behavior:
  - Implement-stage verification should reject a Python runner that will fail immediately at module load.
  - If generated code defines `PeftRecipeSpec`, subsequent return annotations should use `PeftRecipeSpec` or define/import `RecipeSpec` before use.
  - `run_experiments` should not be the first place this trivial module-load defect is discovered.

- Actual behavior:
  - `implement_experiments` completed and reported local verification passed via:
    - `python3 -m py_compile "/home/hanyong/.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py"`
  - Immediate `run_experiments` execution failed while importing/evaluating function annotations:
    - `NameError: name 'RecipeSpec' is not defined. Did you mean: 'PeftRecipeSpec'?`
  - Latest checkpoint:
    - `0301-run_experiments-fail.json`

- Fresh vs existing session comparison:
  - Fresh session: reproduced in the active rebuilt TUI process after the LV-116/LV-117/LV-118 patches.
  - Existing session: earlier attempts failed before implement-stage completion.
  - Divergence: no UI-only divergence; persisted checkpoint and `run_status.json` show the failure.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: local implementation verification relied on `py_compile`, which validates syntax but does not execute module-level annotation evaluation. The generated runner defined `PeftRecipeSpec` but used `RecipeSpec` in return annotations, so the module failed at runtime before the experiment logic started.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`
  - Change summary: implement verification now performs an additional Python static pass for undefined return-annotation names after `py_compile` succeeds. A new regression test confirms that a runner with `def build_recipe() -> RecipeSpec:` retries before handoff when only `PeftRecipeSpec` is defined.

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "undefined return annotation"`
  - Build: pending after LV-119 patch
  - Harness: pending after LV-119 patch
  - Same-flow live revalidation: pending rebuilt TUI retry after undefined-annotation detector patch
  - Adjacent regression review: detector is limited to Python return annotations and common built-in/typing names to avoid substituting runtime execution for full experiments

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/checkpoints/latest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_status.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

## Issue: LV-118

- Status: mitigated
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` while retrying `implement_experiments` with native Codex OAuth staged implementation
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow staged implementation to dynamically re-subdivide the configuration/defaults chunk.
  4. Inspect `implement_experiments/status.json`.

- Expected behavior:
  - Python chunks inserted below the module header should not include `from __future__ import annotations`.
  - Candidate validation should continue to catch real syntax errors without falling back to deterministic implementation.

- Actual behavior:
  - The run progressed through nested dynamic subdivision and continued receiving Codex output.
  - A later subchunk emitted `from __future__ import annotations` inside an already materialized module section.
  - Candidate validation failed with:
    - `SyntaxError: from __future__ imports must occur at the beginning of the file`

- Fresh vs existing session comparison:
  - Fresh session: reproduced after restarting the TUI with the transient-provider retry patch and rerunning the same live retry.
  - Existing session: earlier attempts stopped at candidate-validation and transient-provider boundaries.
  - Divergence: no UI-only divergence; the failure is persisted in node status/progress artifacts.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: chunk prompts required syntactically insertable Python content but did not explicitly forbid future imports in later chunks. Since the chunk is inserted into an existing sectioned module, future imports below the header violate Python syntax.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`
  - Change summary: Python chunk prompt now forbids `from __future__ import annotations`; staged Python chunk normalization removes that future-import line if emitted anyway before candidate validation/materialization.

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "candidate syntax|transient Codex 503|globals-guarded|undefined uppercase"`
  - Build: pass on 2026-04-24 with `npm run build`
  - Harness: pass on 2026-04-24 with `npm run validate:harness`
  - Same-flow live revalidation: pass for the original symptom on 2026-04-24; the same live retry completed `implement_experiments` and then exposed LV-119 in `run_experiments`
  - Adjacent regression review: normalization removes only `from __future__ import annotations` lines in Python materialization chunks and leaves candidate syntax validation active

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`

## Issue: LV-117

- Status: mitigated
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` while retrying `implement_experiments` with native Codex OAuth staged implementation
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow staged implementation to reach chunk materialization.
  4. Observe `implement_experiments/status.json` after the provider returns a transient upstream `503`.

- Expected behavior:
  - A transient provider transport failure before any text delta is observed should retry the same LLM request a small bounded number of times.
  - The node should not switch to deterministic fallback or substitute a runner.
  - The retry should remain visible in progress artifacts.

- Actual behavior:
  - A fresh same-flow retry reached actual staged file chunk generation.
  - The previous `BASELINE_COMPARATOR_ROLE` candidate-validation blocker did not recur before the new failure.
  - The node failed terminally on the first transient provider failure:
    - `Codex OAuth backend request failed: 503 upstream connect error or disconnect/reset before headers. reset reason: connection termination`

- Fresh vs existing session comparison:
  - Fresh session: reproduced after restarting the TUI with the latest build and rerunning the same live retry.
  - Existing session: earlier attempts stopped at candidate-validation boundaries.
  - Divergence: no UI-only divergence; the failure is persisted in node status/progress artifacts.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: staged LLM request handling treated transient Codex OAuth transport failures as terminal when no partial output had been observed. This made a short upstream connection reset abort the whole node instead of retrying the same provider request.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`
  - Change summary: staged LLM requests now retry narrowly classified transient provider errors (`503`, upstream connect/reset, connection termination, pre-response fetch failures) up to a bounded limit when no text delta has been received.

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "transient Codex 503|candidate syntax|globals-guarded|undefined uppercase"`
  - Build: pass on 2026-04-24 with `npm run build`
  - Harness: pass on 2026-04-24 with `npm run validate:harness`
  - Same-flow live revalidation: pass for the original symptom on 2026-04-24; the same live retry completed `implement_experiments` without a terminal transient-provider abort and then exposed LV-119 in `run_experiments`
  - Adjacent regression review: retry is bounded, requires no partial text, and does not invoke deterministic fallback

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`

## Issue: LV-116

- Status: mitigated
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` while retrying `implement_experiments` with native Codex OAuth staged implementation
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow staged implementation to reach `chunk 1/5 subchunk 3/3` and its dynamically nested resubchunks.
  4. Inspect `implement_experiments/status.json` and `unit_chunk_responses/*_error.txt`.

- Expected behavior:
  - When candidate validation fails, the dynamic re-subdivision planner should receive the concrete failure details.
  - If the failure names undefined uppercase constants, the next subdivision should put those constant definitions before any dataclass/config/helper references them, or replace them with same-subchunk literals/config lookups.
  - The node should preserve LLM-owned implementation generation without deterministic runner substitution.

- Actual behavior:
  - Candidate validation correctly caught undefined uppercase constants before final materialization.
  - The planner repeatedly subdivided recipe/dataclass chunks, but because the prompt only said the previous attempt did not complete, Codex kept producing subchunks that referenced `PEFT_METHOD_UNTOUCHED`, `PEFT_METHOD_LORA`, `PEFT_METHOD_ADALORA`, and `PEFT_METHOD_IA3` before defining them.
  - Attempt 1 failed before any runnable implementation was produced:
    - `staged_llm chunk response for peft_recipe_tuning_fields failed candidate validation: Python source references uppercase constant(s) that are never defined or imported: PEFT_METHOD_UNTOUCHED ...`
  - After passing the concrete failure into the subdivision prompt, a fresh same-flow retry progressed past the earlier `PEFT_METHOD_*` blocker, but failed on a deeper nested candidate:
    - `staged_llm chunk response for locked_baseline_candidate_id_literal failed candidate validation: Python source references uppercase constant(s) that are never defined or imported: BASELINE_COMPARATOR_ROLE ...`

- Fresh vs existing session comparison:
  - Fresh session: reproduced after restarting the TUI with the latest build and rerunning the same live retry.
  - Existing session: prior attempts stopped on earlier verifier/materialization boundaries.
  - Divergence: no UI-only divergence; the failure is persisted in node status/progress artifacts.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: candidate-validation failures were retryable, but the concrete validation error was initially not included in the re-subdivision planning prompt. After that was fixed, the remaining blocker was that nested subchunk candidate validation checked only the current subchunk content rather than the prior sibling subchunks plus the current subchunk. This made valid earlier constant definitions invisible to later candidate checks.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`
  - Change summary: retry subdivision planning now receives a trimmed previous failure message; the prompt instructs Codex to place undefined uppercase constant definitions in the earliest relevant subchunk or use same-subchunk literals/config lookups. Candidate validation now checks the cumulative parent-section draft (`prior sibling subchunks + current subchunk`) so later subchunks can safely reference constants defined by earlier sibling subchunks.

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "candidate syntax|globals-guarded|undefined uppercase"`
  - Build: pass on 2026-04-24 with `npm run build`
  - Harness: pass on 2026-04-24 with `npm run validate:harness`
  - Same-flow live revalidation: pass for the original symptom on 2026-04-24; the same live retry completed `implement_experiments` without repeated undefined uppercase subchunk failures and then exposed LV-119 in `run_experiments`
  - Adjacent regression review: candidate syntax re-subdivision, globals-guarded fallback constants, and true-positive undefined uppercase constants remain covered by targeted tests

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_chunk_responses/runner_repair__peft_recipe_tuning_fields__d3__chunk_1_5_subchunk_3_3_resubchunk_2_3_resubchunk_2_4_resubchunk_2_2_error.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_chunk_responses/runner_repair__locked_baseline_candidate_id_literal__d4__chunk_1_6_subchunk_3_4_resubchunk_2_3_resubchunk_2_3_resubchunk_2_3_error.txt`

---

## Issue: LV-115

- Status: mitigated
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` while retrying `implement_experiments` with native Codex OAuth staged implementation
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow native Codex staged implementation to complete all chunk/subchunk generation.
  4. Inspect `implement_experiments/status.json`.

- Expected behavior:
  - A Python expression such as `DEFAULT_MAX_TRAIN_EXAMPLES if "DEFAULT_MAX_TRAIN_EXAMPLES" in globals() else 5000` should not fail static undefined-uppercase validation because Python will evaluate the fallback branch when the constant is absent.
  - Truly unguarded undefined uppercase constants should still fail before handoff.
  - Candidate-stage validation should catch real static constant defects as early as possible instead of waiting until full staged generation completes.

- Actual behavior:
  - Attempt 3 completed staged Codex implementation and passed the prior HellaSwag syntax boundary.
  - Final local verification failed with:
    - `Python source references uppercase constant(s) that are never defined or imported: DEFAULT_MAX_TRAIN_EXAMPLES at run_peft_instruction_study.py:2717`
  - The flagged generated expression was guarded by `"DEFAULT_MAX_TRAIN_EXAMPLES" in globals()` with a concrete fallback value.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching the TUI with rebuilt `dist` and rerunning the same live retry.
  - Existing session: previous attempts in the same persisted run stopped on earlier implementation/verifier boundaries.
  - Divergence: no UI-only divergence; the false-positive verifier failure is persisted in node status/progress artifacts.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the static uppercase-reference verifier strips strings before identifier scanning and does not model same-line `NAME if "NAME" in globals() else fallback` optional-reference semantics. As a result, safe guarded fallback references are treated like unguarded missing constants.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`
  - Change summary: globals-guarded fallback constants are exempted from undefined-uppercase failure, while candidate Python section validation now also runs the same static undefined-uppercase check after `py_compile` so real defects surface at the retryable chunk boundary.

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "undefined uppercase|uppercase words|globals-guarded|candidate syntax"`
  - Build: pass on 2026-04-24 with `npm run build`
  - Harness: pass on 2026-04-24 with `npm run validate:harness`
  - Same-flow live revalidation: partial pass on 2026-04-24. After rebuilt TUI retry, the previous `DEFAULT_MAX_TRAIN_EXAMPLES if "DEFAULT_MAX_TRAIN_EXAMPLES" in globals() else 5000` false positive did not recur. The same run is now blocked by `LV-116`, a later dependency-ordering failure in dynamically re-subdivided recipe/dataclass chunks.
  - Adjacent regression review: true-positive undefined uppercase constants, docstring uppercase words, attribute names, and candidate syntax re-subdivision remain covered by targeted tests

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`

---

## Issue: LV-114

- Status: mitigated
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` while retrying `implement_experiments` with native Codex OAuth staged implementation
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow native Codex staged implementation to reach the Python section for HellaSwag validation subset evaluation.
  4. Inspect `implement_experiments/status.json` and `implement_experiments/progress.jsonl`.

- Expected behavior:
  - Candidate Python section content should be locally syntax-checked before it is committed into the canonical sectioned runner.
  - A candidate syntax failure should be treated like a retryable materialization failure and routed back through dynamic subchunk subdivision.
  - The node should preserve LLM-owned implementation generation without falling back to deterministic runner substitution.

- Actual behavior:
  - Attempt 2 streamed native Codex output through staged chunks and reached `chunk 3/5 subchunk 3/4: HellaSwag validation subset evaluation`.
  - The generated section introduced a Python syntax error:
    - `SyntaxError: unmatched ')'`
  - `implement_experiments` failed before any runnable implementation was produced because the syntax check happened after section materialization instead of inside the retryable dynamic-subdivision boundary.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching the TUI with rebuilt `dist`.
  - Existing session: the persisted run had prior verifier failures, but this symptom is a new implementation materialization boundary in the same live run.
  - Divergence: no UI-only divergence; the failure is persisted in node status/progress artifacts.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: Python section syntax validation ran only after mutating the canonical sectioned skeleton on disk. That put syntax errors outside `materializeStagedLlmChunkWithDynamicSubdivision`, so the existing retry/re-subdivision machinery could not repair the malformed section.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`
  - Change summary: candidate Python section content is inserted into a temporary skeleton and `py_compile` checked before final materialization; candidate-validation failures are retryable and can trigger smaller dynamic subchunks.

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "candidate syntax|provider-terminated|canonical skeleton|comment scaffolding|TrainingArguments|undefined uppercase|uppercase words|partial staged_llm|deferred root"`
  - Build: pass on 2026-04-24 with `npm run build`
  - Harness: pass on 2026-04-24 with `npm run validate:harness`
  - Same-flow live revalidation: partial pass on 2026-04-24. Attempt 3 reached and passed `chunk 3/4 subchunk 3/5: ARC-Challenge and HellaSwag zero-shot evaluation harness`, then completed all staged LLM chunks. The same run is now blocked by `LV-115`, a later static verifier false positive rather than the original HellaSwag syntax/materialization boundary.
  - Adjacent regression review: provider-terminated re-subdivision, canonical skeleton materialization, and comment-only chunk guard remain covered by targeted tests

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`

---

## Issue: LV-113

- Status: mitigated
- Validation target: same-flow live revalidation for run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after `implement_experiments` passed with native Codex OAuth
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node boundary: `implement_experiments -> run_experiments`
  - backend: native Codex OAuth with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow `implement_experiments` to pass local verification and hand off to `run_experiments`.
  4. Let `run_experiments` execute the generated public runner.

- Expected behavior:
  - `implement_experiments` should catch known runtime-incompatible `TrainingArguments` kwargs before handoff when the generated script contains them.
  - A runner that passes implement-stage verification should not fail immediately in `run_experiments` on a constructor signature mismatch.

- Actual behavior:
  - `implement_experiments` completed with `verifyStatus=pass` at `2026-04-24T04:55:22Z`.
  - `run_experiments` then loaded datasets and model weights, evaluated the baseline, and failed while entering training:
    - `TypeError: TrainingArguments.__init__() got an unexpected keyword argument 'overwrite_output_dir'`
  - The failure wrote failed private metrics with a completed baseline row but no tuned comparator rows.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after restarting the TUI with the latest build.
  - Existing session: previous attempts in the same persisted run showed earlier implementation verifier failures.
  - Divergence: no UI-only divergence; the failure is in the generated Python runner and persisted run artifacts.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: implement-stage local verification still relies mostly on `py_compile` plus targeted static checks. `py_compile` cannot validate runtime constructor signatures, so an installed-version-incompatible `TrainingArguments` kwarg escaped to `run_experiments`.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "candidate syntax|provider-terminated|canonical skeleton|comment scaffolding|TrainingArguments|undefined uppercase|uppercase words|partial staged_llm|deferred root"`
  - Build: pass on 2026-04-24 with `npm run build`
  - Harness: pass on 2026-04-24 with `npm run validate:harness`
  - Same-flow live revalidation: pending restart/retry with patched verifier
  - Adjacent regression review: `LV-110` true-positive undefined-constant class remains separately covered

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`

---

## Issue: LV-112

- Status: mitigated
- Validation target: real persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` while retrying `implement_experiments` with the new undefined-uppercase verifier
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth backend with `gpt-5.5` and `medium`

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow staged native Codex implementation to generate a Python runner.
  4. Inspect `implement_experiments/progress.jsonl` after local verification.

- Expected behavior:
  - The verifier should reject real undefined module-level constants such as `DEFAULT_NUM_TRAIN_EPOCHS`.
  - It should not treat uppercase words inside Python docstrings, comments, strings, or attribute access such as `TaskType.CAUSAL_LM` as missing free names.
  - Valid generated runners should not spend retry budget solely because documentation mentions `PEFT`, `JSON`, or `CAUSAL_LM`.

- Actual behavior:
  - Attempt 1 failed local verification after generating a runner with:
    - `Python source references uppercase constant(s) that are never defined or imported: CAUSAL_LM ..., PEFT ..., DEFAULT_SAVE_TOTAL_LIMIT ...`
  - Attempt 2 failed local verification with:
    - `PEFT at run_peft_instruction_study.py:5`
    - `JSON at run_peft_instruction_study.py:6`
    - `CAUSAL_LM at run_peft_instruction_study.py:323`
  - Inspection showed at least some flagged terms were documentation words or attribute names, not missing runtime names.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching the TUI with rebuilt `dist`.
  - Existing session: the same persisted run had already consumed retries on related implementation verifier failures.
  - Divergence: no UI-only divergence; the failure is persisted in implement progress and retry state.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the TypeScript regex verifier strips single-line strings and comments but does not track triple-quoted Python strings across lines, and it also counts uppercase tokens after a dot as free identifiers. This creates false positives for docstrings and enum/library attribute names.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "undefined uppercase|uppercase words"`
  - Build: pass on 2026-04-24 with `npm run build`
  - Harness: pass on 2026-04-24 with `npm run validate:harness`
  - Same-flow live revalidation: pass on 2026-04-24; the rebuilt TUI retried `implement_experiments`, local verification passed, and the run advanced to `run_experiments`
  - Adjacent regression review: `LV-110` remains the intended true-positive class; this issue only narrows false positives

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

---

## Issue: LV-111

- Status: mitigated
- Validation target: real persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` while retrying `implement_experiments` with native Codex OAuth staged implementation
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth backend with streamed delta events

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let staged native Codex implementation generate a long Python runner.
  4. Inspect the live TUI and `.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`.

- Expected behavior:
  - Long Codex generations should remain observable through periodic progress summaries and persisted partial snapshots.
  - The event stream should not persist nearly every provider token as a separate `OBS_RECEIVED` item.
  - The progress count should reflect meaningful operator-visible milestones, not token count.

- Actual behavior:
  - The TUI repeatedly showed token fragments such as `LLM> _available`, `LLM> ()`, and path fragments.
  - The persisted progress count rose into tens of thousands during a single implementation attempt.
  - `events.jsonl` became dominated by token-level `OBS_RECEIVED` records, making actual verifier transitions and retry causes hard to locate.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching the TUI with rebuilt `dist`.
  - Existing session: earlier attempts in the same run already showed the same token-level progress flood.
  - Divergence: no evidence of UI-only divergence; the flood is persisted in run artifacts.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `completeStagedLlmRequest` forwards every streamed delta from the LLM provider to `emitImplementObservation`, which writes both `OBS_RECEIVED` and progress history. Partial snapshots already preserve detailed text, so persisted observations only need bounded summaries.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: covered by build and existing implement/session regressions; a focused progress-throttle test remains desirable.

- Regression status:
  - Automated regression test linked: partial
  - Targeted tests: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "partial staged_llm|undefined uppercase|deferred|materialized|staged_llm|materialization"`
  - Build: pass on 2026-04-24 with `npm run build`
  - Harness: pass on 2026-04-24 with `npm run validate:harness`
  - Full test suite: pass on 2026-04-24 with `npm test`
  - Same-flow live revalidation: pending until the active long implementation retry finishes or is restarted with the latest build
  - Adjacent regression review: current active TUI still emits token-level progress because it was launched before this patch; next rebuilt TUI launch should emit coalesced summaries

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/partial_response_attempt_2.txt`

---

## Issue: LV-110

- Status: mitigated
- Validation target: real persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after `implement_experiments` advanced to `run_experiments`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `run_experiments`
  - backend: native Codex OAuth backend for implementation, with `gpt-5.5` and `medium` shown in the TUI footer

- Reproduction steps:
  1. From the real TUI session in `.autolabos-validation`, retry `implement_experiments` for run `73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  2. Allow the node to recover or reuse the governed public experiment bundle and pass local `py_compile` verification.
  3. Let the workflow hand off to `run_experiments`.
  4. Observe the Python runner fail immediately during module-level evaluation.

- Expected behavior:
  - `implement_experiments` should not hand off a Python runner that only passes syntax compilation but fails immediately when module-level constants are evaluated.
  - Lightweight local verification should catch undefined module-level configuration constants before `run_experiments` consumes retry budget.
  - The repair feedback should point the implementer to define constants or load them from config, not rely on `run_experiments` to discover the problem.

- Actual behavior:
  - `implement_experiments` completed after local verification with:
    - `python3 -m py_compile ".../run_peft_instruction_study.py"`
  - `run_experiments` then failed with:
    - `NameError: name 'DEFAULT_NUM_TRAIN_EPOCHS' is not defined`
  - The failing source constructs `COMMON_TRAINING_HYPERPARAMETERS` at module scope using undefined constants including:
    - `DEFAULT_NUM_TRAIN_EPOCHS`
    - `DEFAULT_LEARNING_RATE`
    - `DEFAULT_PER_DEVICE_TRAIN_BATCH_SIZE`
    - `DEFAULT_GRADIENT_ACCUMULATION_STEPS`
    - `DEFAULT_MAX_SEQUENCE_LENGTH`
    - `DEFAULT_WARMUP_RATIO`
    - `DEFAULT_WEIGHT_DECAY`
    - `DEFAULT_LR_SCHEDULER_TYPE`
    - `DEFAULT_OPTIMIZER`

- Fresh vs existing session comparison:
  - Fresh session: reproduced before the code-level verification patch.
  - Existing session: reproduced in the active persisted run after `implement_experiments` handed off to `run_experiments`.
  - Divergence: no evidence of a UI-only issue; the failure is in the generated Python runner and persisted run state.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: implement-stage verification treated `py_compile` as sufficient for runnable handoff, but Python compilation does not resolve free names used in module-level dictionaries. Undefined training defaults therefore escaped into the persisted public runner and consumed `run_experiments` retries.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "partial staged_llm|undefined uppercase|deferred|materialized|staged_llm|materialization"`
  - Build: pass on 2026-04-24 with `npm run build`
  - Harness: pass on 2026-04-24 with `npm run validate:harness`
  - Full test suite: pass on 2026-04-24 with `npm test`
  - Same-flow live revalidation: pass for this boundary on 2026-04-24; the retried `implement_experiments` loaded the `DEFAULT_NUM_TRAIN_EPOCHS` runner feedback and later failures no longer handed off that undefined-constant class to `run_experiments`
  - Adjacent regression review: token-level progress flood found during the same live retry is tracked as `LV-111`

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/preexisting_metrics_1777003561140.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

---

## Issue: LV-109

- Status: mitigated
- Validation target: real backtrack flow for persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after switching API and native Codex defaults/current runtime to `gpt-5.5` with `medium` reasoning
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`
  - backend: native Codex OAuth backend, not CLI subprocess fallback
  - TUI footer after relaunch: `chat gpt-5.5 + medium | backend gpt-5.5 + medium`

- Reproduction steps:
  1. Rebuild the project and relaunch the real TUI in `.autolabos-validation`.
  2. Confirm the TUI footer shows `gpt-5.5 + medium` for chat and backend.
  3. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  4. Allow native Codex OAuth `staged_llm` implementation to run through all three retry attempts.
  5. Inspect `.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`.

- Expected behavior:
  - `implement_experiments` should distinguish implementation-time artifacts from runtime outputs that will only be created by `run_experiments`.
  - Generated READMEs, manifests, and implementation metadata may document future runtime outputs, but they should not claim those outputs as already materialized implementation artifacts.
  - If a candidate references a runtime-only output as materialized, the next retry should receive explicit corrective feedback and avoid repeating the same contract error.
  - The node should preserve observable Codex progress without flooding persisted progress with token-level `LLM>` fragments.

- Actual behavior:
  - The node used native Codex OAuth and received streamed output throughout the run, so this was not a silent Codex non-response.
  - Retry attempt 1 generated the runner and README in many purpose-aligned chunks, then restored 60 paths before the next branch.
  - Retry attempt 2 generated a more compact runner and README, then restored 59 paths before the next branch.
  - Retry attempt 3 generated a runner and README, including an explicit measured fallback path, then failed final verification.
  - Final failure:
    - `Implementer referenced artifact(s) that were not materialized: outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/peft_instruction_study_results.json`
  - Earlier retry history for the same run showed the same class of defect with:
    - `outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/results.json`
    - `outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run.log`
  - The TUI also showed very high persisted progress update counts while streaming token fragments, making the long-running implementation harder to inspect.

- Fresh vs existing session comparison:
  - Fresh session: reproduced after relaunching the TUI with rebuilt `dist` and updated external validation config.
  - Existing session: the same persisted run already contained earlier runtime-artifact materialization failures.
  - Divergence: no UI-only divergence; this is a persisted implementation contract and retry-feedback issue.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the implementation verifier correctly blocks non-materialized artifact references, but the staged implementation planner/README/manifest prompts do not sufficiently separate `implementation_artifacts` from `runtime_outputs`. Retry feedback is too generic, so later branches can still document or register runtime outputs as if they already exist during `implement_experiments`.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: pass on 2026-04-24 with `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "deferred|materialized"`
  - Build: pass on 2026-04-24 with `npm run build`
  - Harness: pass on 2026-04-24 with `npm run validate:harness`
  - Full test suite: pass on 2026-04-24 with `npm test`
  - Same-flow live revalidation: `implement_experiments` advanced to `run_experiments`, but the active TUI process was not relaunched after the code patch and reused an existing public bundle; rebuilt same-flow confirmation remains pending
  - Adjacent regression review: a downstream runtime constant failure is tracked as `LV-110`

- Most likely failing boundary:
  - `src/core/agents/implementSessionManager.ts` implementation artifact reference verification and corrective retry feedback
  - staged implementation prompts that ask for output artifact documentation without enforcing runtime-output vs implementation-artifact separation
  - progress persistence/rendering around streamed `LLM>` token fragments during long native Codex OAuth generations

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/experiment_governance/implementation_context.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/README.md`

---

## Issue: LV-108

- Status: active
- Validation target: real backtrack flow for persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after LV-107 live revalidation
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached after LV-107 guard: `implement_experiments -> run_experiments -> analyze_results`
  - backend: native Codex OAuth backend, not CLI subprocess fallback

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Allow implementation attempt 1 to fail pre-handoff on the argparse/run-command verifier.
  4. Allow implementation attempt 2 to complete and hand off to `run_experiments`.
  5. Inspect `.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`.
  6. Inspect `outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/study_results.json`.
  7. Inspect `outputs/identify-which-lightweight-parameter-efficient-i-73050f85/analysis/transition_recommendation.json`.

- Expected behavior:
  - `run_experiments` should fail or backtrack when every private metrics recipe fails before any baseline/comparator result is produced.
  - Public experiment artifacts should not retain stale successful rows that disagree with the private `metrics.json` used by `analyze_results`.
  - `analyze_results` should receive one coherent results surface, not failed private metrics plus stale public success artifacts.

- Actual behavior:
  - `run_experiments` completed after executing a compatible command:
    - `python .../run_peft_instruction_study.py --model-name Qwen/Qwen2.5-1.5B --instruction-dataset yahma/alpaca-cleaned --recipes baseline,lora,rslora,adalora --max-steps 64 --per-device-train-batch-size 1 --gradient-accumulation-steps 16 --metrics-path .../metrics.json`
  - Private `.autolabos/runs/.../metrics.json` recorded `completed_recipe_count: 0`, `failed_recipe_count: 4`, and per-recipe errors:
    - `TypeError: RecipeSpec.__init__() missing 3 required positional arguments: 'name', 'use_peft', and 'description'`
  - Private `device_info.study_peak_gpu_memory_gb` remained `0`, so the objective metric gate failed.
  - Public `study_results.json` still contained completed baseline and comparator rows with non-null accuracies and GPU memory values from a different/stale result schema.
  - `analyze_results` paused with `reason: "incomplete_results_table"` based on the failed private metrics.

- Fresh vs existing session comparison:
  - Fresh session: reproduced in the newly launched rebuilt TUI process.
  - Existing session: persisted artifacts show the same private/public disagreement.
  - Divergence: no UI-only divergence; the defect is artifact/state consistency across private run metrics and public experiment outputs.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the run accepts process exit code 0 and a written metrics file as successful execution even when all recipe rows failed structurally. Public experiment artifacts are not cleared or atomically regenerated for the new execution, so stale successful artifacts can survive beside failed private metrics.

- Code/test changes:
  - Code: pending
  - Tests: pending

- Regression status:
  - Automated regression test linked: pending
  - Targeted tests: pending
  - Build: pending
  - Harness: pending
  - Same-flow live revalidation: pending
  - Adjacent regression review: pending

- Most likely failing boundary:
  - `run_experiments` success criteria and artifact consistency checks around private `metrics.json` vs public experiment artifacts.
  - Generated `run_peft_instruction_study.py` recipe construction / `RecipeSpec` compatibility in the implementation node.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/study_results.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/analysis/result_analysis.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/analysis/transition_recommendation.json`

---

## Resolved live validation issues

The resolved entries below are kept as recent validation history and regression context.

## Issue: LV-107

- Status: resolved
- Validation target: real backtrack flow for persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached after LV-106 fix: `analyze_results -> design_experiments -> implement_experiments -> run_experiments`
  - backend: native Codex OAuth backend, not CLI subprocess fallback

- Reproduction steps:
  1. Relaunch the rebuilt TUI in `.autolabos-validation`.
  2. Run `/agent retry analyze_results 73050f85-6b56-4385-8c31-2ec69a5b7dec` to apply the governed `backtrack_to_design` transition.
  3. Use `/retry` at `design_experiments`.
  4. Allow `design_experiments` to complete and auto-handoff into `implement_experiments`.
  5. Allow `implement_experiments` to complete and auto-handoff into `run_experiments`.

- Expected behavior:
  - Before auto-handoff, implementation verification should ensure the generated runner accepts the exact `run_command` flags that `run_experiments` will execute.
  - If `run_command` uses flags such as `--output-dir` or `--max-eval-examples`, the generated Python argparse surface should accept them or implementation verification should fail with `next_action: retry_patch`.
  - `run_experiments` should not be the first place that discovers a trivial CLI contract mismatch.

- Actual behavior:
  - `implement_experiments` completed after `python -m py_compile` passed and auto-approved the handoff.
  - The generated script accepted `--metrics-path` and `--public-dir`, but not `--output-dir` or `--max-eval-examples`.
  - The persisted implementation `run_command` still included `--output-dir ... --max-eval-examples 500`.
  - `run_experiments` failed immediately with argparse:
    - `run_peft_instruction_study.py: error: unrecognized arguments: --output-dir ... --max-eval-examples 500`

- Fresh vs existing session comparison:
  - Fresh session: reproduced in a newly launched TUI process after rebuilding `dist`.
  - Existing session: the failure is visible in the persisted run artifacts and `events.jsonl`.
  - Divergence: no fresh-vs-existing UI divergence; the defect is a persisted implementation handoff contract issue.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `implement_experiments` persists and trusts the LLM-returned `run_command` after only lightweight syntax verification. The verifier does not compare the returned command flags against the generated Python argparse surface, so a stale or incompatible command can be persisted and handed to `run_experiments`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - added pre-handoff detection for Python argparse surfaces where `run_command` passes long-form flags that the generated runner does not accept
      - blocks auto-handoff with `failure_type: "implementation"` and `next_action: "retry_patch"` instead of letting `run_experiments` discover the CLI mismatch
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - added coverage that a generated Python runner missing `--output-dir` / `--max-eval-examples` support does not auto-handoff to `run_experiments`

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: `npx vitest run tests/implementSessionManager.test.ts --testNamePattern "argparse mismatch|parse_args helper"` passed; `npx vitest run tests/implementSessionManager.test.ts` passed
  - Build: `npm run build` passed
  - Broad tests: `npm test` passed
  - Harness: `npm run validate:harness` passed after adding this entry
  - Same-flow live revalidation: passed on 2026-04-24 in the real `.autolabos-validation` TUI flow
  - Live evidence:
    - `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` entered native Codex OAuth `staged_llm` mode with runner feedback from the prior argparse failure
    - implementation attempt 1 generated a runner whose `run_command` passed unsupported argparse flags
    - the new verifier blocked auto-handoff with `verify_report.json` status `fail`, `failure_type: "implementation"`, `next_action: "retry_patch"`, and `stderr_excerpt: "run_command passes unsupported Python argparse flag(s): --max-train-examples..."`
    - the TUI restored 57 paths and started implementation attempt 2 instead of handing the incompatible command to `run_experiments`
    - attempt 2 produced a compatible command and `run_experiments` executed it without the prior `--output-dir` / `--max-eval-examples` argparse failure
  - Adjacent regression review: broad implementation-session and full test suites passed; same-flow live retry confirmed the guarded backtrack path

- Most likely failing boundary:
  - Python runner handoff verification in `src/core/agents/implementSessionManager.ts`.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_panel/triage.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/experiment_governance/implementation_context.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

---

## Issue: LV-106

- Status: resolved
- Validation target: same persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after successful `run_experiments` retry and automatic `analyze_results`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached: `run_experiments -> analyze_results`
  - existing TUI session, resumed from the persisted run after prior implementation repairs

- Reproduction steps:
  1. In the existing real TUI session, run `/agent retry run_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  2. Wait for the node-owned PEFT runner to complete.
  3. Inspect `.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`.
  4. Inspect `outputs/identify-which-lightweight-parameter-efficient-i-73050f85/analysis/result_table.json`.
  5. Inspect `.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/transition_recommendation.json`.

- Expected behavior:
  - When `metrics.json` contains an executed baseline row and executed comparator rows under `results`, `analyze_results` should project those rows into `condition_comparisons` / `results_table`.
  - The negative scientific result should remain visible as `accuracy_delta_vs_baseline=0`.
  - The transition should be driven by the objective/evidence gate, for example a design backtrack, not by a false `incomplete_results_table` pause.

- Actual behavior:
  - `run_experiments_verify_report.json` records `status: "pass"` and the fresh metrics contract is present.
  - `metrics.json` contains:
    - baseline row with `recipe: "baseline"` and `mean_accuracy: 0.546875`
    - comparator rows `lora_qv_r8` and `lora_qkvo_r16`
    - top-level `best_recipe: "lora_qv_r8"`
    - top-level `accuracy_delta_vs_baseline: 0`
    - bootstrap confidence intervals in each executed result row
  - `analysis/result_table.json` collapses the run to a single `primary` condition and leaves `comparisons: []`.
  - `transition_recommendation.json` records:
    - `action: "pause_for_human"`
    - `reason: "incomplete_results_table"`
    - evidence lines with `baseline=null, comparator=null`
  - `analyze_results_panel/inputs.json` simultaneously shows the underlying baseline recommendation was `backtrack_to_design`, so the false table incompleteness is overriding the governed backtrack.
  - Fixed behavior verified on 2026-04-24:
    - the same persisted TUI run was relaunched with the rebuilt runtime
    - `/agent retry analyze_results 73050f85-6b56-4385-8c31-2ec69a5b7dec` reran the real node
    - `result_analysis.json` now contains `condition_comparisons[0].source: "metrics.results"`
    - `result_analysis.json` now contains a structured `results_table` row with `metric: "mean_accuracy"`, `baseline: 0.546875`, and `comparator: 0.546875`
    - `transition_recommendation.json` now records `action: "backtrack_to_design"` / `targetNode: "design_experiments"` rather than `pause_for_human` / `incomplete_results_table`
    - the TUI applied `backtrack_to_design -> design_experiments` and paused before rerunning `design_experiments` because execution had started from `analyze_results`

- Fresh vs existing session comparison:
  - Fresh session: a new TUI process was launched in the same external validation workspace after rebuilding `dist`.
  - Existing session: reproduced in the prior real persisted TUI session and confirmed through run-scoped plus public analysis artifacts.
  - Divergence: the old process replayed the stale pause; the freshly launched rebuilt process reran `analyze_results` and cleared the false incomplete-table transition.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: `buildConditionComparisons` only promotes `metrics.comparison` and `metrics.condition_metrics`. The current node-owned PEFT runner writes executed conditions under `metrics.results`, so `buildStructuredResultsTable` falls back to the contract schema and reports null baseline/comparator values even though the executed rows are present.

- Code/test changes:
  - Code:
    - `src/core/resultAnalysis.ts`
      - added projection from node-owned `metrics.results` arrays into `condition_comparisons` when explicit `baseline` and `best_recipe` rows are present
      - preserves negative objective outcomes while allowing the structured results table to carry baseline/comparator values
  - Tests:
    - `tests/resultAnalysis.test.ts`
      - added coverage for projecting `metrics.results` baseline/comparator rows into `condition_comparisons`
    - `tests/objectiveMetricPropagation.test.ts`
      - added coverage that `analyze_results` no longer pauses with `incomplete_results_table` when `metrics.results` contains baseline and best comparator rows

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: `npx vitest run tests/resultAnalysis.test.ts tests/resultTable.test.ts tests/objectiveMetricPropagation.test.ts` passed
  - Build: `npm run build` passed
  - Same-flow live revalidation: passed
  - Adjacent regression review: targeted result-table and objective-propagation tests passed; broad `npm test` and `npm run validate:harness` passed after this `ISSUES.md` update

- Most likely failing boundary:
  - resolved; the remaining active workflow state is the governed scientific backtrack to `design_experiments` after a real negative result.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/analyze_results_panel/inputs.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/transition_recommendation.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/result_analysis.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/analysis/result_table.json`

---

## Issue: LV-105

- Status: resolved
- Validation target: same persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after removing `allow_network` as a runtime execution gate and rerunning `run_experiments`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached: `run_experiments -> analyze_results`

- Reproduction steps:
  1. Relaunch the real TUI in `.autolabos-validation`.
  2. Run `/agent retry run_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Wait for the PEFT runner to complete after public Hugging Face model/dataset bootstrap.
  4. Inspect `run_record.json`, `metrics.json`, `run_experiments_verify_report.json`, and `events.jsonl`.

- Expected behavior:
  - If the experiment command exits `0` but `metrics.json` reports failed tuned conditions, missing objective metrics, or an incomplete baseline/comparator table, `run_experiments` should not present the run as a clean pass.
  - The verifier should classify the result as incomplete/degraded and keep the workflow from treating execution success as experiment adequacy.

- Actual behavior:
  - Original failing behavior: the same-flow retry ran for about 306 seconds and completed the public PEFT runner after Hugging Face bootstrap.
  - `run_experiments_verify_report.json` records:
    - `status: "pass"`
    - `stage: "success"`
    - `exit_code: 0`
  - However, `metrics.json` shows:
    - baseline evaluation succeeded with ARC-Challenge/HellaSwag raw accuracies
    - `successful_tuned_condition_count: 0`
    - `failed_condition_count: 3`
    - `all_conditions_succeeded: false`
    - primary metric values such as `baseline_value`, `best_tuned_value`, and `best_tuned_delta_vs_baseline` are `null`
  - `analyze_results` then pauses with:
    - `Objective metric "accuracy_delta_vs_baseline" was not found in metrics.json.`
    - `Results table is incomplete: baseline and comparator must both be populated for every reported row.`
  - Fixed behavior verified on 2026-04-23:
    - the same persisted TUI retry reran `run_experiments`
    - the PEFT command still produced incomplete comparator metrics
    - `run_experiments` emitted `TEST_FAILED`
    - `run_experiments_verify_report.json` now records:
      - `status: "fail"`
      - `stage: "metrics"`
      - `summary: Experiment metrics contract failed: Objective metric "accuracy_delta_vs_baseline" was not found in metrics.json. Study aggregate reports incomplete execution (1 completed, 3 failed). No tuned comparator condition completed successfully. ...`
  - Follow-up live behavior verified on 2026-04-24 after the `implement_experiments` repair completed:
    - targeted `/agent retry run_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` launched the generated runner again
    - the command completed and wrote a fresh `metrics.json`
    - `run_experiments_verify_report.json` records `status: "pass"` / `stage: "success"` because the runner now emits the required metrics contract fields and exits `0`
    - `metrics.json` includes numeric `accuracy_delta_vs_baseline`, `baseline_mean_accuracy`, `best_mean_accuracy`, per-condition accuracy rows, bootstrap CIs, GPU memory, and trainable-parameter counts
    - the scientific result is still negative: `accuracy_delta_vs_baseline=0`, so `analyze_results` correctly pauses with `Objective metric not met: accuracy_delta_vs_baseline=0 does not satisfy >= 0.01.`
    - this is no longer the LV-105 verifier defect; it is an honest experimental non-improvement result that should be handled by analysis/review, not hidden as a system failure.

- Fresh vs existing session comparison:
  - Fresh session: not separately rerun for this post-network-gate semantic boundary.
  - Existing session: reproduced directly on the same persisted run after the network-policy fix, then revalidated after the verifier fix.
  - Divergence: none established; the failing boundary was in persisted run-verifier semantics rather than stale UI state.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `run_experiments` is currently treating process exit code and metrics-file materialization as sufficient for verifier pass, without enforcing the metrics contract that tuned comparator conditions and the configured objective metric must be present for a baseline/comparator experiment.

- Code/test changes:
  - Code:
    - `src/core/nodes/runExperiments.ts`
      - added post-command metrics-contract validation after `objective_evaluation.json` is written
      - fails verifier reports when the configured objective metric is missing
      - fails baseline-first comparator runs when primary study aggregate reports incomplete execution, no successful tuned comparator, or non-numeric baseline/comparator/delta aggregate values
  - Tests:
    - `tests/runExperimentsExecutionProfile.test.ts`
      - added regression coverage for a command that exits `0` but writes incomplete comparator metrics

- Regression status:
  - Automated regression test linked: yes
  - Targeted tests: `npx vitest run tests/runExperimentsExecutionProfile.test.ts tests/objectiveMetricPropagation.test.ts` passed
  - Broad validation: `npm run build`, `npm test`, and `npm run validate:harness` passed
  - Same-flow live revalidation: confirmed
  - Latest state: same persisted retry now marks `run_experiments_verify_report.json` as `status: "fail"` / `stage: "metrics"` instead of `pass`.
  - Latest post-implementation same-flow retry: `run_experiments` completes with a metrics-contract pass, and `analyze_results` pauses on the scientific outcome because the objective threshold was not met.

- Most likely failing boundary:
  - resolved; the remaining boundary is research adequacy/objective-outcome interpretation in `analyze_results`, not `run_experiments` verifier semantics

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/metrics.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`

- Recommended next step:
  - Treat the current `accuracy_delta_vs_baseline=0` as a real negative result unless a governed backtrack explicitly revises the experiment design or implementation; do not claim the target improvement was achieved.

## Issue: LV-103

- Status: resolved
- Validation target: existing external-workspace TUI same-flow `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` after removing heuristic decomposition/materialization/subdivision fallbacks and then tightening staged materialization/bootstrap guards
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`

- Reproduction steps:
  1. Remove heuristic `implement_experiments` fallback projection/chunking paths so staged LLM decomposition, materialization planning, and subdivision planning all require parseable provider plans.
  2. Run `npm run build`, `npm test`, and `npm run validate:harness`.
  3. Relaunch the real TUI in `.autolabos-validation`, reopen the failed run, and issue `/retry`.
  4. Inspect `implement_experiments/status.json` and `implement_experiments/progress.jsonl`.

- Expected behavior:
  - The same-flow retry should localize the real runner file, materialize substantive Python rather than placeholder skeleton text, and continue through staged scaffold/bootstrap/decomposition/materialization without provider-side aborts.
  - If the provider cannot supply a valid scaffold or chunk, the run should fail narrowly and honestly rather than reusing heuristic projections or recovering comment-only public bundles.

- Actual behavior:
  - The heuristic projection path is gone and the localizer now correctly focuses the true failing runner:
    - `outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`
  - Additional repo-side guards are now in place:
    - placeholder/comment-only staged chunk responses are rejected instead of being accepted as materialized Python
    - comment-only public bundles are no longer recoverable as valid implement results
    - staged scaffold and bootstrap prompts were compacted to reduce provider payload size
  - Live retries still fail at the Codex OAuth boundary before a runnable repair is produced:
    - retry at `2026-04-23T08:04:36Z` progressed past scaffold planning, then failed during bootstrap with:
      - `Implementation execution failed before any runnable implementation was produced: Codex OAuth backend returned an error ... request ID 7eb2608e-9fbc-4ab7-a0f9-2a04dba5b13a`
    - retry at `2026-04-23T08:09:15Z` failed even earlier at scaffold with:
      - `Implementation execution failed before any runnable implementation was produced: Codex OAuth backend returned an error ... request ID 6a75ce32-9ad4-41ac-8289-c530477e510c`
    - earlier same-day retries also showed:
      - provider abort after bootstrap wait: `This operation was aborted`
      - provider error after chunk subdivision wait: request ID `9e317b4c-a0e8-4c47-b940-e25beebd8f32`
    - latest live retry at `2026-04-23T09:12:18Z` confirmed the new prompt-artifact instrumentation works:
      - `implement_experiments/scaffold_prompt.txt` is written before the first scaffold request
      - `implement_experiments/scaffold_raw_response.txt` is written once scaffold planning completes
      - `implement_experiments/bootstrap_contract_prompt.txt` is written before the bootstrap request
      - the same run then advances to bootstrap and stalls again with:
        - `threadId: "resp_01a31167d1197b170169e9e27346308191bee3b4f775c77621"`
        - `status: "running"`
        - `message: "Still waiting on staged_llm provider output; no new provider progress for 119s."`
    - latest live retry at `2026-04-23T12:54:56Z` confirmed the additional prompt-compaction patch reached the live run:
      - `implement_experiments/scaffold_prompt.txt` shrank from `17781` bytes to `11984` bytes while `bootstrap_contract_prompt.txt` remained `8392` bytes
      - scaffold again completed after two heartbeat waits and progressed into bootstrap with:
        - `threadId: "resp_03bc692ebc4ffb2e0169ea16a1c9d48191934016106e50a3d7"`
      - bootstrap then reproduced the same no-text-delta wait pattern through at least:
        - `59s`
        - `119s`
        - `179s`
        - `240s`
        - `300s`
      - that retry eventually emitted streamed output after `360s` and then failed with:
        - `Implementation execution failed before any runnable implementation was produced: staged_llm bootstrap planning did not return a parseable bootstrap contract`
    - latest live retry at `2026-04-23T14:17:58Z` confirmed the bootstrap-specific compaction patch reached the live run:
      - `implement_experiments/bootstrap_contract_prompt.txt` shrank further from `8392` bytes to `6234` bytes
      - `implement_experiments/scaffold_prompt.txt` remained about `12KB` (`11987` bytes)
      - scaffold now completed after a single `59s` heartbeat and advanced into bootstrap with:
        - `threadId: "resp_0542f1f5a665db340169ea2a16ab4481919401ec38452679f2"`
      - bootstrap planning then completed successfully enough to write a parseable raw contract artifact:
        - `implement_experiments/bootstrap_contract_raw_response.txt` (`8762` bytes)
      - the run progressed past bootstrap and deep into staged materialization:
        - the public runner file expanded from the 44-line skeleton placeholder to `1923` lines
        - chunk generation advanced through dataset caching, evaluation helpers, and baseline-first PEFT execution decomposition
      - the remaining failure boundary shifted later in the flow:
        - `resp_086a26e641d247890169ea356b56688191bbd401ba9dbf6b32` timed out after `540s` with no text delta for the aggregate-metrics execution chunk
        - staged resubdivision succeeded and launched `resp_0fbed7ef14f965550169ea39b0a9e881918e4dca403d0f22ab`
        - the live attempt ultimately ended with:
          - `Implementation execution failed before any runnable implementation was produced: terminated`
    - latest live retry at `2026-04-23T22:05:40Z` confirmed late materialization artifact instrumentation reached the real flow:
      - the run again localized the same runner and passed scaffold, bootstrap, decomposition repair, materialization planning, and chunk subdivision planning
      - new per-chunk prompt artifacts appeared under `implement_experiments/unit_chunk_prompts`
      - new per-chunk raw response artifacts appeared under `implement_experiments/unit_chunk_responses`
      - observed live artifacts included:
        - `peft_runner__runner_core_setup__d0__chunk_1_2_subchunk_1_3.txt` prompt (`12910` bytes) and response (`15955` bytes)
        - `peft_runner__runner_core_data__d0__chunk_1_2_subchunk_2_3.txt` prompt (`13973` bytes) and response (`17838` bytes)
        - `peft_runner__runner_core_eval__d0__chunk_1_2_subchunk_3_3.txt` prompt (`14128` bytes) and response (`17442` bytes)
        - `peft_runner__runner_baseline_and_recipe_execution__d0__chunk_2_2_subchunk_1_3.txt` prompt and response (`38081` bytes)
        - `peft_runner__runner_result_aggregation_and_persistence__d0__chunk_2_2_subchunk_2_3.txt` prompt while no matching final response was produced
      - the public runner grew to `2333` lines before failure
      - the failing request waited through `59s`, `120s`, and `180s` heartbeat observations and then ended with:
        - `Implementation execution failed before any runnable implementation was produced: terminated`
      - a `runner_result_aggregation_and_persistence` `_partial_on_error` artifact was emitted, but it matched the previous successful response size (`38081` bytes), indicating the global partial snapshot can be stale across chunk requests.
  - The public runner file is no longer stuck at the 44-line canonical skeleton placeholder, but the live attempt still did not finish verification or produce a stable runnable repair.
  - Latest same-flow retry after routing single-chunk Python materialization through chunk generation completed successfully:
    - retry started at `2026-04-23T23:02:54Z`
    - dynamic materialization reached `Generating staged_llm unit 1/1 chunk 1/1: Implement the PEFT instruction study runner`
    - the request waited through heartbeat observations up to `539s`, then returned streamed Codex OAuth output
    - `unit_chunk_responses/peft_runner__peft_runner__d0__chunk_1_1.txt` was written
    - the public runner was rewritten to `690` lines
    - local verification passed via `python -m py_compile /home/hanyong/.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`
    - `implement_experiments/status.json` ended with `status: "completed"` and `verifyStatus: "pass"`
  - A remaining observability gap was found during this same live retry:
    - the Codex OAuth SSE parser accumulated `response.output_text.delta` internally, but the generic `CodexOAuthResponsesLLMClient` forwarded all progress as `status`
    - as a result, `implement_experiments/partial_response.txt` and `LLM>` progress lines only appeared after final completion, not during long-running Codex OAuth text deltas
    - this does not block completion, but it made long provider waits harder to inspect while the request was still running

- Fresh vs existing session comparison:
  - Fresh session: multiple fresh TUI relaunches on 2026-04-23 reproduced the provider-side scaffold/bootstrap/materialization instability before the final patch set.
  - Existing session: the same persisted run completed `implement_experiments` after the retryable `terminated`, per-request artifact isolation, and single-chunk Python chunk-routing fixes.
  - Divergence: none established; the same persisted run moved from failure to completed after code changes rather than after a state reset.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: the heuristic-free staged path is now behaving more honestly, but the live Codex OAuth provider remains unstable at the first scaffold/bootstrap planning turns for this run, intermittently returning backend errors or aborts before any usable structured response can be materialized.
  - Updated 2026-04-24 hypothesis: the remaining late materialization boundary includes provider-side `terminated` responses that are not AutoLabOS local timeout errors. Treating those as terminal prevents the existing dynamic re-subdivision path from making the request smaller. The global `partial_response.txt` is also reused across requests, so failed chunk snapshots can accidentally capture the previous successful chunk rather than the failed request.
  - Resolution update: confirmed. Once provider-side `terminated` was treated as retryable for materialization, request-local/attempt-local artifacts were isolated, and Python runner materialization always used the chunk path, the same live retry completed. The separate no-intermediate-output symptom was traced to Codex OAuth delta events being forwarded as `status` instead of `delta`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - removed heuristic fallback projection for `decomposition_plan`
      - removed heuristic fallback materialization/subdivision plans
      - removed heuristic gating that skipped planning for “simple” units/chunks
      - tightened staged prompts to ask for the smallest purpose-aligned unit/chunk/subchunk set without fixed-size guidance
      - rejected placeholder/comment-only staged Python chunk responses and empty final materializations
      - blocked recovery of placeholder-only public script bundles
      - compacted staged scaffold and bootstrap planning prompts to reduce provider request size
      - raised the default staged LLM request timeout for `implement_experiments` from `600000ms` to `1800000ms`
      - clears the per-request partial snapshot before each staged LLM request so chunk `_partial_on_error` artifacts cannot reuse stale successful output
      - clears stale staged attempt artifact directories at the start of each staged bundle while preserving progress/status logs
      - treats provider-side `terminated` during chunk materialization as a retryable transient failure that triggers smaller dynamic re-subdivision
      - routes single-chunk Python runner materialization through chunk generation instead of the whole-file staged generation path
      - writes chunk-specific `_error.txt` artifacts when materialization requests fail
    - `src/core/agents/implementationLocalizer.ts`
      - added exact previous-script path preference so reruns prioritize the real failing runner over nearby manifests/analysis artifacts
    - `src/integrations/codex/oauthResponsesTextClient.ts`
      - emits Codex OAuth SSE `response.output_text.delta` frames as typed `delta` progress events while preserving status events
    - `src/core/llm/client.ts`
      - forwards Codex OAuth typed progress events unchanged so staged implement partial snapshots can observe real text deltas
  - Tests:
  - `tests/codexOAuthTextClient.test.ts`
      - added regression coverage that Codex OAuth streamed deltas reach the generic LLM progress callback
  - `tests/implementSessionManager.test.ts`
      - added regressions that fail loudly when decomposition, materialization, or subdivision plans are missing/unparseable instead of silently falling back
      - added regression coverage for comment-only canonical-skeleton chunk responses
      - added regression coverage that scaffold/bootstrap prompt artifacts and raw responses are persisted
      - added regression coverage that late chunk prompts/raw responses are persisted and that sibling/recursive subchunks receive parent draft context
      - added regression coverage that provider-side `terminated` re-subdivides the failing chunk and does not emit stale `_partial_on_error` snapshots
      - added regression coverage that stale chunk response artifacts from a previous retry are removed before the next staged bundle writes fresh artifacts
      - added regression coverage that single-chunk Python runner plans still use chunk generation, preserving retry/re-subdivision behavior
    - `tests/implementationLocalizer.test.ts`
      - added regression coverage that prefers the exact previous run script over adjacent manifest files

- Regression status:
  - Automated regression test linked: yes (`tests/implementSessionManager.test.ts`, `tests/implementationLocalizer.test.ts`)
  - Re-validation result:
    - targeted implement/localizer regressions passed
    - `npm run build` passed
    - `npm test` passed
    - live same-flow reruns are no longer blocked at bootstrap on the latest retry, but still fail later during staged chunk/resubchunk generation
    - latest same-flow retry with the smaller scaffold prompt still narrows to the bootstrap wait boundary rather than producing a runnable repair
    - latest same-flow retry with the smaller bootstrap prompt reaches bootstrap faster, yields a parseable bootstrap contract, and materially grows the runner file before terminating later in materialization
    - latest same-flow retry with per-chunk prompt/raw instrumentation confirms the next failure surface can now be audited at the individual chunk request level
    - latest same-flow retry now narrows the next patch target to provider-side `terminated` handling and stale per-request partial snapshot isolation
    - latest same-flow retry after those fixes completed `implement_experiments` with `verifyStatus: "pass"`
    - automated regression after the 2026-04-24 patch: `npx vitest run tests/implementSessionManager.test.ts`, `npm run build`, `npm test`, and `npm run validate:harness` passed
    - targeted Codex OAuth progress regression after the observability patch: `npx vitest run tests/codexOAuthTextClient.test.ts` passed

- Most likely failing boundary:
  - resolved for `implement_experiments` same-flow retry; next validation boundary is downstream `run_experiments` execution of the newly generated runner and its metrics contract

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/scaffold_prompt.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/scaffold_raw_response.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/bootstrap_contract_prompt.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/bootstrap_contract_raw_response.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_chunk_prompts/`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_chunk_responses/`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`
  - `docs/codex-oauth-live-diagnostics.md`

- Recommended next step:
  - rebuild the runtime with Codex OAuth delta-forwarding, rerun the required validation suite, then continue to downstream `run_experiments` to verify the generated PEFT runner produces the required `accuracy_delta_vs_baseline` metrics rather than only passing `py_compile`.

## Issue: LV-101

- Status: resolved
- Validation target: existing external-workspace TUI `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` after the deferred-results patch
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`

- Reproduction steps:
  1. Relaunch a fresh real TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let attempt 1/3 enter staged LLM mode and wait for the bounded hard timeout.
  4. Inspect `implement_experiments/status.json`, `implement_experiments/progress.jsonl`, and `events.jsonl`.

- Expected behavior:
  - The staged implementation turn should either stream/output usable Codex text and continue into implementation validation, or fail for a narrower request-level reason before consuming the full 600000ms budget.

- Actual behavior:
  - The same-flow retry used to stall before producing any implement-stage text, first as one giant staged LLM turn and later as the first runner chunk after decomposition.
  - After the staged runner was split into purpose-aligned chunks, the same persisted run eventually advanced through all three runner chunks and completed the rest of the implement bundle:
    - `Generating staged_llm unit 1/3 chunk 2/3: Dataset preparation, model setup, PEFT condition execution, and benchmark evaluation (...)`
    - `Generating staged_llm unit 1/3 chunk 3/3: Result aggregation, metrics JSON writing, public artifact export, and main entrypoint (...)`
    - `Generating staged_llm unit 2/3: Bounded experiment plan (...)`
    - `Generating staged_llm unit 3/3: Experiment usage and interpretation guide (...)`
    - `Implementation turn completed.`
    - `Local verification passed via python -m py_compile .../run_peft_instruction_study.py.`
  - The final `implement_experiments/status.json` for the same persisted run is now `completed` with `verifyStatus: "pass"`.

- Fresh vs existing session comparison:
  - Fresh session: not separately needed; the same persisted run was retried from a rebuilt real TUI session.
  - Existing session: the repaired flow now crosses the former stall boundary, completes implement-stage materialization, and passes local verification.
  - Divergence: none remains at the original boundary.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: the original staged implement request was too coarse; after purpose-aligned decomposition and chunked runner generation, the same live path can now materialize and verify successfully.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - added staged-LLM heartbeat progress updates and partial-response snapshotting to `implement_experiments`
      - added shared `decomposition_plan` contract emission plus a bounded staged repair turn when scaffolds omit that plan
      - added dynamic materialization chunk planning for large text-file units so runnable scripts can be generated as purpose-aligned subcalls instead of one giant file turn
    - `src/core/decompositionPlan.ts`
      - added reusable dynamic decomposition-plan types/parsing for future prompt-splitting migrations
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - added a regression that timeouting staged-LLM requests persist partial-response artifacts and timeout observations when progress is observed
      - added regressions for decomposition-plan artifact emission and decomposition-plan repair when the scaffold omits it
      - updated staged-LLM implement regressions to cover dynamic materialization plans and chunked runner generation

- Regression status:
  - Automated regression test linked: yes (`tests/implementSessionManager.test.ts`)
  - Re-validation result: resolved in the same persisted run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - New observation: the same-flow retry now survives the former stall, completes `implement_experiments`, and passes local `py_compile` verification.

- Most likely failing boundary:
  - resolved staged LLM request/materialization boundary inside `implement_experiments`

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/decomposition_plan.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/decomposition_plan_raw_response.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_plans/runner_script.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_plans/runner_script_raw_response.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/unit_plans/runner__chunk1_setup_and_plan.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`

- Recommended next step:
  - move downstream to the new `run_experiments` failure now that the implement-stage stall is resolved.

## Issue: LV-100

- Status: resolved
- Validation target: existing external-workspace TUI `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` after the native Codex stream-materialization fix
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - node: `implement_experiments`

- Reproduction steps:
  1. Relaunch a fresh real TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let the staged implementation turn finish and inspect `implement_experiments/progress.jsonl`, `verify_report.json`, and the public experiment directory.

- Expected behavior:
  - `implement_experiments` should allow future public result files such as `outputs/.../experiment/results/summary.json` to remain absent at implement time.
  - Those files should be treated like deferred execution outputs that `run_experiments` is responsible for materializing later.

- Actual behavior:
  - Before the patch, the same live run could complete an implementation turn and then fail attempt 1 with:
    - `Implementer referenced artifact(s) that were not materialized: outputs/.../experiment/results/summary.json, .../condition_results.json, .../report.md`
  - The missing paths were public result files under `outputs/.../experiment/results/*`, not immediate implement-stage artifacts.
  - The node then restored the branch snapshot and retried instead of handing off to `run_experiments`.

- Fresh vs existing session comparison:
  - Fresh session: not separately needed.
  - Existing session: the same persisted run now crosses the former boundary, completes `implement_experiments`, and enters `run_experiments` instead of failing on deferred public result files.
  - Divergence: none remains at the original boundary.

- Root cause hypothesis:
  - Type: `in_memory_projection_bug`
  - Hypothesis: implement-stage artifact validation was projecting future public run outputs into the current materialization set and treating them as missing supplemental artifacts, even though those `results/*` files should only exist after `run_experiments`.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - broadened deferred execution artifact recognition so public `outputs/.../experiment/results/*` paths are treated as deferred run-time outputs rather than immediate implement-stage requirements
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - added a regression that missing public experiment result files under `outputs/.../experiment/results/*` do not fail implement-stage validation

- Regression status:
  - Automated regression test linked: yes (`tests/implementSessionManager.test.ts`)
  - `npm test`: passed
  - `npm run build`: passed
  - `npm run validate:harness`: passed
  - Same-flow live revalidation: resolved; the same persisted run no longer fails on missing deferred `results/*` artifacts and instead proceeds into `run_experiments`.

- Most likely failing boundary:
  - implement-stage artifact-validation boundary inside `materializeDeclaredArtifacts(...)` / deferred output classification

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/`

- Recommended next step:
  - keep following the same persisted run from `run_experiments`, where the next real blocker is now runner integrity rather than implement-stage artifact classification.

## Issue: LV-102

- Status: resolved
- Validation target: same persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after `implement_experiments` was repaired with dynamic decomposition, runner chunking, and local `py_compile` verification
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached: `implement_experiments -> run_experiments`

- Reproduction steps:
  1. Relaunch a fresh real TUI session in `.autolabos-validation`.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let `implement_experiments` complete and hand off to `run_experiments`.
  4. Inspect `run_record.json`, `events.jsonl`, and the runner traceback produced by `run_experiments`.

- Expected behavior:
  - The repaired public runner should preserve required setup helpers such as `parse_args()` across chunk joins and should survive both local `py_compile` verification and the initial `run_experiments` invocation.

- Actual behavior:
  - Before the fix, the same persisted run completed `implement_experiments` and passed local `python -m py_compile`, but the generated runner then aborted immediately inside `run_experiments` with:
    - `RuntimeError("Missing parse_args() in runner setup chunk.")`
  - After the compatibility repair and same-flow continuation, that boundary no longer reproduces.
  - The same persisted run now advances beyond the `parse_args()`/config-join surface and fails later for a different reason (offline Hugging Face bootstrap), so `LV-102` is no longer the dominant blocker.

- Fresh vs existing session comparison:
  - Fresh session: not separately reproduced yet.
  - Existing session: reproduced directly on the same persisted run after implement-stage recovery.
  - Divergence: unknown; this is currently a downstream runner-integrity bug, not a session-state mismatch.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: chunked runner materialization can still produce an internally inconsistent final script where later orchestration code expects setup-surface helpers that were omitted, overwritten, or not preserved correctly across subchunk joins. Local `py_compile` is too weak to catch this semantic integrity failure.

- Code/test changes:
  - Code:
    - `src/core/agents/implementSessionManager.ts`
      - repairs Python runners that define `build_arg_parser()` but omit a callable `parse_args()` helper by inserting a bounded compatibility shim before handoff
      - re-runs local verification after the shim is materialized so the persisted public runner surface reflects the repaired contract before `run_experiments`
      - normalizes locked PEFT configs to the recipes-only runtime schema before handoff
      - aligns generated runner helper invocation kwargs and baseline-first locked-condition counting before handoff
  - Tests:
    - `tests/implementSessionManager.test.ts`
      - added a regression that a generated Python runner missing `parse_args()` is repaired before handoff and still passes local `py_compile`
      - added regressions for locked PEFT config normalization, baseline-first locked-condition counting, and condition-helper kwarg repair

- Regression status:
  - Automated regression test linked: yes (`tests/implementSessionManager.test.ts`)
  - `npx vitest run tests/implementSessionManager.test.ts`: passed after the runner/config compatibility repairs
  - `npm run build`: passed after the repairs
  - `npm run validate:harness`: passed after updating this entry
  - Same-flow live revalidation: resolved; the same persisted run now crosses the old runner-integrity boundary and reaches a later offline-model/bootstrap failure in `run_experiments`.

- Most likely failing boundary:
  - resolved runner integrity across staged chunk/subchunk joins in `implement_experiments`, only surfaced by `run_experiments`

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`

- Recommended next step:
  - keep the implement-stage compatibility repairs, and treat offline Hugging Face bootstrap as the next real `run_experiments` blocker rather than a recurrence of this runner-integrity issue.

## Issue: LV-104

- Status: resolved
- Validation target: same persisted external-workspace run `73050f85-6b56-4385-8c31-2ec69a5b7dec` after removing `allow_network` as a runtime execution gate and rerunning `run_experiments` through the real TUI
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - nodes reached: `implement_experiments -> run_experiments`

- Reproduction steps:
  1. Remove `allow_network` as an execution-blocking runtime contract and keep network usage as metadata/labeling only.
  2. Rebuild and rerun the validation suite.
  3. Relaunch the real TUI in `.autolabos-validation`.
  4. Run `/agent retry run_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  5. Inspect `run_record.json`, `events.jsonl`, `pgrep` process state, and the active experiment bundle.

- Expected behavior:
  - The same persisted run should no longer stop before execution with an offline-policy/bootstrap refusal tied to `allow_network=false`.
  - `run_experiments` should be allowed to proceed into real model/dataset bootstrap, with network usage treated as a runtime dependency rather than a policy block.

- Actual behavior:
  - Before the policy change, the repaired PEFT runner failed immediately at the baseline Hugging Face bootstrap boundary with:
    - `LocalEntryNotFoundError: ... outgoing traffic has been disabled`
    - `To enable hf.co look-ups and downloads online, set 'local_files_only' to False.`
  - After removing the runtime network gate and rerunning the same persisted run through the real TUI, the old failure boundary no longer reproduces:
    - the retry is accepted in the real TUI
    - the persisted run moves back to `status: "running"` / `currentNode: "run_experiments"`
    - the parent PEFT runner process is alive
    - the embedded Hugging Face evaluation subprocess is also alive and actively executing the model/dataset bootstrap code path
  - The original `allow_network` / offline-policy blocker is therefore gone; the remaining downstream runtime outcome is now a true execution question rather than a policy refusal.

- Fresh vs existing session comparison:
  - Fresh session: a fresh full run had already shown the earlier bootstrap-policy gate at `implement_experiments`.
  - Existing session: after the policy removal, the same persisted run was retried from a freshly relaunched real TUI session and now proceeds into active execution instead of failing immediately at the offline-policy boundary.
  - Divergence: the existing-session rerun confirms the old failure was policy/runtime-contract driven rather than a stale-session-only artifact.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the earlier failure was caused by an execution contract that still forced the workflow to behave as offline/local-only when public Hugging Face assets were not prewarmed. Removing `allow_network` as a runtime gate and treating network use as metadata unblocked the same-flow execution path.

- Code/test changes:
  - Code:
    - `src/types.ts`
      - downgraded `allow_network` to deprecated compatibility metadata
    - `src/config.ts`
      - stopped persisting `allow_network` in new configs and normalized network state through metadata-only `network_policy`
    - `src/tools/commandPolicy.ts`
      - removed network fetch blocking from command policy
    - `src/tools/aciLocalAdapter.ts`
      - stopped forcing Hugging Face tooling into offline mode via the deprecated network flag
    - `src/core/agents/implementSessionManager.ts`
      - changed the bootstrap/environment contract so remote Hugging Face assets are treated as explicit runtime requirements instead of execution blockers
    - `src/core/nodes/runExperiments.ts`
      - removed the hard stop on bootstrap `requires_network` and downgraded it to runtime observation/labeling
  - Tests:
    - `tests/aciLocalAdapter.test.ts`
    - `tests/commandPolicy.test.ts`
    - `tests/configEnv.test.ts`
    - `tests/doctorHarnessIntegration.test.ts`
    - `tests/implementSessionManager.test.ts`
    - `tests/readinessRisks.test.ts`
    - `tests/runExperimentsExecutionProfile.test.ts`
      - updated/added regressions proving network use is metadata-only and no longer a hard execution block

- Regression status:
  - Automated regression tests linked: yes
  - `npx vitest run tests/configEnv.test.ts tests/commandPolicy.test.ts tests/aciLocalAdapter.test.ts tests/readinessRisks.test.ts tests/doctorHarnessIntegration.test.ts tests/runExperimentsExecutionProfile.test.ts tests/implementSessionManager.test.ts`: passed
  - `npm run build`: passed
  - `npm test`: passed
  - `npm run validate:harness`: passed
  - Same-flow live revalidation: resolved for the original boundary; the persisted run no longer fails at the old offline-policy/bootstrap gate and instead proceeds into active `run_experiments` execution with the Hugging Face evaluation subprocess alive.

- Most likely failing boundary:
  - resolved execution-policy boundary for public Hugging Face assets

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/exec_logs/run_experiments.txt`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_experiments_verify_report.json`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/run_peft_instruction_study.py`
  - `.autolabos-validation/outputs/identify-which-lightweight-parameter-efficient-i-73050f85/experiment/experiment_config.yaml`
  - active process evidence from same-flow retry:
    - parent runner `python .../run_peft_instruction_study.py`
    - embedded evaluation subprocess `python -c ... AutoModelForCausalLM.from_pretrained(...) ... load_dataset(...)`

- Recommended next step:
  - continue tracking the in-flight `run_experiments` retry to determine the next real runtime blocker now that the old network-policy gate has been removed.

## Issue: LV-099

- Status: resolved
- Validation target: existing external-workspace TUI `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec` on the rebuilt native Codex runtime after removing automatic `previous_response_id` forwarding
- Environment/session context:
  - real TUI workspace: `.autolabos-validation`
  - run: `73050f85-6b56-4385-8c31-2ec69a5b7dec`
  - rebuilt runtime launched from `dist/cli/main.js`

- Reproduction steps:
  1. Start a fresh real TUI session in `.autolabos-validation` on the rebuilt runtime.
  2. Run `/agent retry implement_experiments 73050f85-6b56-4385-8c31-2ec69a5b7dec`.
  3. Let the staged LLM attempt localize branch focus and submit the native Codex OAuth request.
  4. Inspect `implement_experiments/status.json`, `implement_experiments/progress.jsonl`, `events.jsonl`, and `run_record.json`.

- Expected behavior:
  - The retry should progress beyond `Submitting request to Codex OAuth Responses backend.`
  - After streamed Codex output arrives, the run should materialize a structured implementation result or at least salvage non-empty final text for parsing into a runnable bundle.

- Actual behavior:
  - Before the parser fix, the same live retry progressed to:
    - `Submitting request to Codex OAuth backend.`
    - `Submitting request to Codex OAuth Responses backend.`
    - `Received streamed Codex OAuth output.`
    - then failed with:
      - `Implementation execution failed before any runnable implementation was produced: Codex OAuth backend returned no output text (status=in_progress).`
  - After the parser fix and same-flow revalidation, the retried run no longer reproduces that failure.
  - The live flow now advances past native Codex text materialization, validates the returned implementation, and continues into later branch/attempt handling.
  - A separate downstream problem remains possible in the same node when the implementer references artifacts that were never materialized, but that is no longer the native stream-materialization boundary covered by `LV-099`.

- Fresh vs existing session comparison:
  - Fresh session: no separate fresh-from-bootstrap repro was needed for this parser boundary; the same persisted run was retried from a freshly relaunched rebuilt TUI session.
  - Existing session: before the fix, the same persisted run failed at `Codex OAuth backend returned no output text (status=in_progress)` after streamed output arrived.
  - Revalidated session: after the fix, that same persisted run proceeds past text materialization and into later implementation validation/retry handling.
  - Fresh-vs-existing divergence is not the issue here; the original symptom disappeared in the same persisted run on a rebuilt fresh TUI session.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis confirmed: the native Codex OAuth stream parser was too narrow. It trusted `response.output_text.delta` plus `response.completed` as the primary success path and could drop usable text when the backend emitted completion-bearing `item.completed`/`*.done`-style events without a final `response.completed` payload.

- Code/test changes:
  - Code:
    - `src/integrations/codex/oauthResponsesTextClient.ts`
      - no longer infers `previous_response_id` from `threadId`
      - now salvages completion-bearing text candidates from `item.completed`, `message.completed`, and `*.done`/`*.completed` stream events
      - now merges response payload snapshots across stream events instead of trusting only `response.completed`
      - now selects the best available final text from streamed deltas, payload output, and salvaged completion candidates
    - `src/core/llm/client.ts`
      - stopped auto-forwarding `threadId` as `previousResponseId` for native Codex OAuth completions
    - `src/integrations/codex/codexCliClient.ts`
      - stopped auto-forwarding `threadId` as `previousResponseId` when the native Codex wrapper issues a text completion
  - Tests:
    - `tests/codexOAuthTextClient.test.ts`
      - added regression coverage that `threadId` alone no longer serializes `previous_response_id`
      - explicit `previousResponseId` still serializes when intentionally provided
      - added regressions that salvage text from `item.completed` without `response.completed`
      - added regressions that salvage text from `response.output_text.done`

- Regression status:
  - Automated regression test linked: yes (`tests/codexOAuthTextClient.test.ts`)
  - Re-validation result: fixed in the same live retry flow; the original `status=in_progress` no-output failure no longer reproduces.

- Most likely failing boundary:
  - resolved native Codex OAuth stream-materialization boundary inside `implement_experiments` staged LLM mode

- Follow-up risks:
  - Later `implement_experiments` validation can still fail for unrelated reasons such as missing materialized artifacts or branch-level implementation drift.
  - Long-running prompts may still expose new native Codex event shapes; the current parser is broader, but future provider changes could require more salvage coverage.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/status.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/implement_experiments/progress.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/verify_report.json`

- Recommended next step:
  - continue the same live `implement_experiments` flow and treat any remaining failure after text materialization as a new downstream issue rather than a recurrence of `LV-099`.

- Resolution notes:
  - The same persisted run `73050f85-6b56-4385-8c31-2ec69a5b7dec` was retried again from a freshly relaunched rebuilt TUI session.
  - The retried flow no longer reproduced `Codex OAuth backend returned no output text (status=in_progress)`.
  - In the same live run, `implement_experiments` progressed beyond text materialization, validated the returned implementation, and emitted later-stage observations such as:
    - `Implementer referenced artifact(s) that were not materialized: ...`
    - `Restored 36 path(s) before retrying the next candidate branch.`
    - `Implementation attempt 2/3 started.`
  - Those later observations confirm the original native stream-materialization boundary was crossed successfully and the parser fix changed the runtime behavior in the intended same flow.

## Issue: LV-098

- Status: in_progress
- Validation target: fresh external-workspace TUI `/brief start --latest` rerun for IEEE PEFT papers that previously reached `pdf_extract_failed` abstract fallback despite a nominal `pdf_url`
- Environment/session context:
  - real TUI workspace: `.autolabos-validation/.live/abstract-image-rerun-wgj0hk`
  - run: `4600d589-7162-4d46-8d2e-a6939713bafc`
  - target papers:
    - `doi:10.1109/lsp.2024.3377590` (`Chain-of-LoRA...`)
    - `doi:10.1109/globecom52923.2024.10901572` (`Federated Low-Rank Adaptation...`)

- Reproduction steps:
  1. Start a fresh external workspace and run real TUI `/brief start --latest`.
  2. Let `collect_papers` finish and `analyze_papers` reach the two IEEE target papers above.
  3. Observe source resolution log lines and inspect the cached `analysis_cache/pdfs/*` and `analysis_cache/page_images/*` artifacts for those paper ids.

- Expected behavior:
  - If a real PDF is available but text extraction is unusable, `resolvePaperTextSource(...)` should preserve rendered page images and log:
    - `PDF extraction produced no usable text. Falling back to abstract with supplemental page images.`
  - The later analyzer path should then attach those images on the extractor call.

- Actual behavior:
  - The fresh rerun still logs:
    - `[doi:10.1109/lsp.2024.3377590] PDF extraction produced no usable text. Falling back to abstract.`
    - `[doi:10.1109/globecom52923.2024.10901572] PDF extraction produced no usable text. Falling back to abstract.`
  - Both papers persist as `source=abstract` with no supplemental page images.
  - Direct inspection of the cached pseudo-PDFs shows they are HTML, not PDF:
    - `<!DOCTYPE html> ... <script> var MEMBER_PROFILE_...`
  - Their page-image directories exist but contain no PNG files, so this is not a later analyzer drop; the renderer never received a real PDF to rasterize.

- Fresh vs existing session comparison:
  - Fresh session: the earlier fresh rerun in `.live/abstract-image-rerun-wgj0hk` reproduces the IEEE staging-url failure, the newer fresh rerun in `.live/ieee-filter-rerun-9RKL01` proves the new `no_pdf_url` path is working for other unusable metadata rows, and the targeted fresh rerun in `.live/ieee-targeted-fresh-20260416-213634` confirms both IEEE targets are selected in the active top-30 with `pdf_availability_score: 0`, but the live node has not yet advanced far enough to emit their per-paper source-resolution logs.
  - Existing session: no separate resumed-session divergence has been observed; the defect is anchored at fresh source resolution against persisted corpus metadata before resume handling matters.
  - Divergence: no meaningful fresh-vs-existing divergence established so far; the remaining gap is target-paper coverage in the fresh rerun.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: persisted corpus rows can carry invalid IEEE staging `pdf_url` values from provider metadata (for example `http://xplorestaging.ieee.org/...pdf?arnumber=...`) that return HTML instead of a PDF binary. When those URLs are cached, the image-rescue path never gets a real PDF to render, so abstract fallback cannot preserve supplemental page images.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperText.ts`
      - added a smaller `pdftoppm -scale-to 1024` rescue render attempt for real PDFs that fail default rasterization.
      - added invalid-PDF detection so HTML masquerading as `.pdf` is no longer silently cached as a PDF.
      - now treats known unusable IEEE staging hosts such as `xplorestaging.ieee.org` as non-usable `pdf_url` metadata before download.
  - Tests:
    - `tests/paperTextImageFallback.test.ts`
    - `tests/paperText.test.ts`

- Regression status:
  - Automated regression test linked: yes (`tests/paperText.test.ts`, `tests/paperTextImageFallback.test.ts`)
  - Re-validation result: pending same-flow confirmation for the two IEEE targets; the latest fresh reruns already show real `No PDF URL found. Using abstract fallback.` behavior for other unusable rows in the same patched runtime, and the targeted rerun now proves both IEEE targets are in the selected set under the patched resolver.

- Most likely failing boundary:
  - persisted metadata / source-resolution boundary

- Follow-up risks:
  - the target IEEE papers may still require alternate public-PDF enrichment even after the staging host is rejected, so this patch may only convert the failure from fake-PDF handling to honest `no_pdf_url` fallback.
  - even with both targets selected, long-running earlier papers can delay the same-flow per-paper confirmation because the node is still bounded and sequential enough that rank 4/25 may take time to surface in logs.

- Evidence/artifacts:
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/events.jsonl`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/corpus.jsonl`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/pdfs/doi_10.1109_lsp.2024.3377590.pdf`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/pdfs/doi_10.1109_globecom52923.2024.10901572.pdf`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/page_images/doi_10.1109_lsp.2024.3377590/`
  - `.autolabos-validation/.live/abstract-image-rerun-wgj0hk/.autolabos/runs/4600d589-7162-4d46-8d2e-a6939713bafc/analysis_cache/page_images/doi_10.1109_globecom52923.2024.10901572/`
  - `.autolabos-validation/.live/ieee-filter-rerun-9RKL01/.autolabos/runs/686eee86-9033-4ad9-8017-af4b3bf2d7f0/events.jsonl`
  - `.autolabos-validation/.live/ieee-filter-rerun-9RKL01/.autolabos/runs/686eee86-9033-4ad9-8017-af4b3bf2d7f0/corpus.jsonl`
  - `.autolabos-validation/.live/ieee-targeted-fresh-20260416-213634/.autolabos/runs/00575beb-de5b-4c57-9316-0377db0f2c4f/events.jsonl`
  - `.autolabos-validation/.live/ieee-targeted-fresh-20260416-213634/.autolabos/runs/00575beb-de5b-4c57-9316-0377db0f2c4f/analysis_manifest.json`
  - `.autolabos-validation/.live/ieee-targeted-fresh-20260416-213634/.autolabos/runs/00575beb-de5b-4c57-9316-0377db0f2c4f/corpus.jsonl`

- Recommended next step:
  - add a metadata-repair or alternate-PDF-resolution step for known bad IEEE staging URLs before `downloadPdf(...)` is attempted, or explicitly downgrade those rows as `invalid_pdf_content` with a clearer operator-facing note.

## Issue: LV-097

- Status: resolved
- Validation target: existing external-workspace TUI `/retry` flow for paused `analyze_papers` on run `73050f85-6b56-4385-8c31-2ec69a5b7dec`
- Environment/session context: default external validation root `.autolabos-validation`, real TUI startup automation, resumed paused session after `LV-096` was closed

- Reproduction steps:
  1. Start a real TUI session in `.autolabos-validation`.
  2. Resume the paused run `73050f85-6b56-4385-8c31-2ec69a5b7dec` with `/retry`.
  3. Let `analyze_papers` rerun its rerank-fallback shortlist and inspect `run_record.json`, `events.jsonl`, `paper_summaries.jsonl`, and `evidence_store.jsonl`.
  4. Wait until the first selected paper (`Compresso...`) reaches planner timeout on the full-text path.

- Expected behavior:
  - A paused existing session should preserve or quickly re-materialize a first persisted summary/evidence row when `analyze_papers` is retried.
  - If the shortlist changes, the reset should still recover to a persisted first row within the same bounded retry cycle.

- Actual behavior:
  - Before the fix, `/retry` could recompute the rerank-fallback shortlist and log:
    - `Analysis selection changed since the previous run. Resetting summaries/evidence for the new paper set.`
  - The existing `paper_summaries.jsonl` and `evidence_store.jsonl` were removed.
  - The rerun then reached:
    - `Analyzing paper 1/30: "Compresso: Structured Pruning with Collaborative Prompting Learns Compact Large Language Models".`
    - `[cef2e06efd484520808dfbeeee2029c4d06bd799] Planner unavailable, falling back to direct extraction: planner exceeded the 15000ms timeout`
  - with no persisted rows re-created.
  - After the fix and same-flow revalidation:
    - `/retry` now reuses the cached selection instead of resetting persisted outputs.
    - Full-text planner timeout on resumed papers logs:
      - `Planner timed out on a full-text source. Using a deterministic source-grounded fallback analysis so the first persisted row can be materialized without another long LLM roundtrip.`
    - Persisted rows re-materialize and continue accumulating in the same resumed run.

- Fresh vs existing session comparison:
  - Fresh session: the earlier fresh external-workspace `/brief start --latest` flow for the same run family already materialized persisted rows, including the abstract-only planner-timeout fallback fixed in `LV-096`.
  - Existing session: after the fix, the paused-session `/retry` path now reuses the cached selection and materializes deterministic full-text fallback rows instead of stalling at zero.
  - Divergence: no remaining fresh-vs-existing divergence observed at the first-row persistence boundary.

- Root cause hypothesis:
  - Type: `resume_reload_bug`
  - Hypothesis confirmed: retrying `analyze_papers` from a paused run could re-enter selection planning and, when it hit a full-text planner-timeout paper before any new rows were re-materialized, the direct-extraction path left the run at zero persisted rows. The fix makes planner-timeout on a full-text source materialize a conservative full-text fallback row immediately.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperAnalyzer.ts`
      - planner timeout on a full-text source now returns a deterministic source-grounded fallback draft immediately instead of falling through to a long direct-extraction wait when the planner has already timed out.
  - Tests:
    - `tests/paperAnalyzer.test.ts`
      - added a regression for planner timeout on a full-text source.
    - `tests/analyzePapers.test.ts`
      - added a node-level regression that persists a full-text fallback row when the first selected paper hits planner timeout.

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: fixed in the same real external-workspace TUI `/retry` flow

- Follow-up risks:
  - Deterministic full-text fallback rows are intentionally weaker than normal structured extraction+review, so they should stay under the existing claim ceiling.
  - Analyze latency remains non-trivial because full-text planner timeouts still burn wall time before the fallback kicks in, but the resumed session no longer regresses to a zero-row stall.

- Evidence/artifacts:
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/analysis_manifest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/paper_summaries.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/evidence_store.jsonl`

- Resolution notes:
  - After rebuilding, the same paused external-workspace run was resumed with a real TUI `/retry`.
  - The resumed flow now logs:
    - `Reusing cached paper rerank from analysis_manifest.json for top 30; skipping a new LLM rerank.`
    - `Planner timed out on a full-text source. Using a deterministic source-grounded fallback analysis so the first persisted row can be materialized without another long LLM roundtrip.`
    - `Persisted analysis outputs for "...\" (1 summary row, 1 evidence row(s)).`
  - In the same resumed run, `paper_summaries.jsonl` and `evidence_store.jsonl` were re-created and continued growing beyond the first paper; at validation time the run had already reached 7 persisted summary rows and 7 persisted evidence rows while still running.

## Issue: LV-096

- Status: resolved
- Validation target: real external-workspace TUI flow `/brief start --latest` through `analyze_papers` first-paper persistence, plus an abstract-only `pdf_extract_failed` paper in the same run
- Environment/session context: default external validation root `.autolabos-validation`, real TUI startup automation, run `73050f85-6b56-4385-8c31-2ec69a5b7dec`

- Reproduction steps:
  1. Start a real TUI session in `.autolabos-validation`.
  2. Run `/brief start --latest`.
  3. Let `collect_papers` complete and `analyze_papers` begin on `Compresso...`.
  4. Observe the first paper hit full-text planner timeout, then full-text extractor timeout, then full-text-only retry timeout.
  5. Inspect `events.jsonl`, `paper_summaries.jsonl`, `evidence_store.jsonl`, and `run_record.json`.

- Expected behavior:
  - After repeated full-text timeout exhaustion, the node should materialize a weak but honest persisted output for the first paper so warm-start can end.
  - If a later selected paper falls back to `pdf_extract_failed`, a planner timeout on the abstract-only path should also materialize a deterministic fallback row instead of stalling before persistence.

- Actual behavior:
  - Before the fix, the abstract-only `pdf_extract_failed` branch could log:
    - `Planning analysis focus, claim targets, and verification checks.`
    - `Planner unavailable, falling back to direct extraction: planner exceeded the 45000ms timeout`
    - with no persisted rows yet materialized.
  - After the fix and same-flow revalidation:
    - `Compresso...` persisted a deterministic abstract fallback row immediately after the repeated full-text timeouts.
    - A later abstract-only paper (`Federated Low-Rank Adaptation for Large Language Model Fine-Tuning Over Wireless Networks`) logged:
      - `Planner timed out on an abstract-only source. Using a deterministic abstract fallback analysis to preserve a minimal, source-grounded summary.`
      - `Persisted analysis outputs for "Federated Low-Rank Adaptation for Large Language Model Fine-Tuning Over Wireless Networks" (1 summary row, 1 evidence row(s)).`
  - `paper_summaries.jsonl` and `evidence_store.jsonl` now materialize in the same run, and `run_record.json` records `Persisted 2 summary row(s) and 2 evidence row(s).`

- Fresh vs existing session comparison:
  - Fresh session: `/brief start --latest` succeeds, `collect_papers` completes, and `analyze_papers` now persists rows during the same bounded analyze cycle.
  - Existing session: no separate resumed session was required for the closing validation because the fixed fresh external-workspace run now proves both the repeated full-text timeout fallback and the abstract-only planner-timeout fallback materialize persisted outputs.
  - Divergence: no remaining fresh-vs-existing difference observed at the persistence boundary.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis confirmed: the `pdf_extract_failed` abstract path routed planner timeout into a second extraction-style LLM pass instead of synthesizing a deterministic fallback immediately, delaying warm-start persistence behind another timeout-prone step.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperAnalyzer.ts`
      - planner timeout on an abstract-only source now returns a deterministic fallback draft immediately instead of falling through to direct extraction.
  - Tests:
    - `tests/paperAnalyzer.test.ts`
      - added a regression for planner timeout on an abstract-only source.

- Regression status:
  - Automated regression test linked: yes (`paperAnalyzer` planner-timeout abstract fallback case)
  - Re-validation result: fixed in a real external-workspace TUI flow under `.autolabos-validation`

- Follow-up risks:
  - Full-text planner/extractor retries still consume noticeable wall time before the existing repeated-timeout fallback kicks in, so analyze latency remains a quality-of-life concern even though persistence now succeeds.
  - The external-workspace TUI path is now proven through `collect_papers` and persisted `analyze_papers` rows, so future regressions at this boundary should be revalidated on the same workspace style, not only under repository-local fixtures.

- Evidence/artifacts:
  - `.autolabos-validation/Brief.md`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/run_record.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/events.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/collect_result.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/analysis_manifest.json`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/paper_summaries.jsonl`
  - `.autolabos-validation/.autolabos/runs/73050f85-6b56-4385-8c31-2ec69a5b7dec/evidence_store.jsonl`

## Issue: LV-095

- Status: resolved
- Validation target: real `test/.tmp` broad compact-model brief through resumed `analyze_papers` first-paper persistence
- Environment/session context: resumed fresh-workspace run `b86d40eb-4e9c-454c-bb48-019563a90bed` in `test/.tmp/compact-brief-rerun-6`, after the shortlist-quality fix and a real TUI `/retry`

- Reproduction steps:
  1. Start a fresh run from the broad compact-model / lightweight PEFT brief and let `collect_papers` complete.
  2. Let `analyze_papers` build the rerank-fallback shortlist and begin paper `1/30` (`Compresso...`).
  3. Resume the same run with a real TUI `/retry` after the first stalled attempt.
  4. Observe the full-text + image attempt time out, then the full-text-only retry time out, then the abstract-only fallback begin.
  5. Inspect `events.jsonl`, `paper_summaries.jsonl`, and `evidence_store.jsonl`.

- Expected behavior:
  - After full-text and full-text-only analysis both time out, the node should quickly materialize a weak but honest abstract-only fallback row so serial warm-start can end and persisted related-work artifacts can start accumulating.
  - The first persisted summary/evidence row should appear within the same bounded retry cycle.

- Actual behavior:
  - The run reaches:
    - `Extractor timed out with 12 rendered PDF page image(s). Retrying once with full text only.`
    - `Full-text extraction timed out again after removing rendered page images. Falling back to abstract-only analysis for this paper.`
    - `Planner unavailable, falling back to direct extraction: planner exceeded the 45000ms timeout`
  - But no `paper_summaries.jsonl` or `evidence_store.jsonl` row is materialized yet.
  - `run_record.json` still reports `Persisted 0 summary row(s) and 0 evidence row(s).`
  - The live TUI session continues to show `Analyzing... 1/30` with no first persisted output.

- Fresh vs existing session comparison:
  - Fresh session: the same run starts correctly from the tightened shortlist and reaches paper `1/30`.
- Existing session: after `/retry`, the node still stalls before the first persisted fallback row.
  - Divergence: no evidence that this is a fresh-vs-existing shortlist problem anymore; the remaining boundary is first-paper fallback materialization latency.

- Root cause hypothesis:
  - Type: `race_timing_bug`
  - Hypothesis: once full-text and full-text-only retries are exhausted, `analyze_papers` still spends another full abstract-only LLM roundtrip before synthesizing the deterministic fallback, so the first persisted row is delayed behind another timeout-prone path instead of being materialized immediately.

- Code/test changes:
  - Code:
    - `src/core/analysis/paperAnalyzer.ts`
    - `src/core/nodes/analyzePapers.ts`
  - Tests:
    - `tests/analyzePapers.test.ts`
    - `tests/paperAnalyzer.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same real flow after rebuilding and rerunning from a fresh `test/.tmp` workspace with shortened analysis timeouts

- Follow-up risks:
  - The first persisted row now materializes promptly, but long-lived aborted Codex subprocesses are still worth watching because the timeout-heavy paper-analysis path can leak background CLI children.
- Evidence/artifacts:
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/run_record.json`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/events.jsonl`
  - `/tmp/retry-analyze-b86-2.log`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/run_record.json`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/events.jsonl`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/paper_summaries.jsonl`
  - `test/.tmp/compact-brief-rerun-8-g6F8m6/.autolabos/runs/6147662c-96c4-45e3-b580-4f81d824c462/evidence_store.jsonl`

- Resolution notes:
  - The fix stops spending another abstract-only LLM roundtrip after full-text and full-text-only retries have already timed out.
  - Instead, `analyze_papers` now synthesizes the same conservative deterministic abstract fallback row immediately and persists it.
  - In the same live flow, the fresh rerun `6147662c-96c4-45e3-b580-4f81d824c462` now logs:
    - `Using a deterministic abstract fallback immediately after repeated full-text timeouts...`
    - `Persisted analysis outputs for "Compresso..." (1 summary row, 1 evidence row(s)).`
    - `Warm-start persisted outputs; continuing remaining 29 paper(s) with concurrency 3.`
  - The first persisted rows remain properly weak and abstract-bounded:
    - `source_type: "abstract"`
    - `confidence: 0.3`
    - `Abstract-only fallback; no verified full-text extraction completed before timeout.`

## Issue: LV-094

- Status: resolved
- Validation target: real `test/`-workspace broad compact-model brief through `collect_papers -> analyze_papers`
- Environment/session context: fresh `test/` workspace run `d45c14cd-edb0-4b45-95cf-9668c712c9a3` using the broadened compact-model / PEFT brief and the same governed `/brief start --latest` entry path

- Reproduction steps:
  1. Update `test/Brief.md` to the broader compact-model / lightweight PEFT study.
  2. Start a fresh real run from `test/` using `/brief start --latest`.
  3. Let `collect_papers` finish and `analyze_papers` build its top-30 shortlist after the rerank timeout fallback.
  4. Inspect `analysis_manifest.json`, `paper_summaries.jsonl`, and `events.jsonl`.

- Expected behavior:
  - For this brief, the rerank-fallback shortlist should stay centered on instruction tuning, LoRA/PEFT, compact-model adaptation, and bounded recipe trade-offs.
  - Domain-specific papers from unrelated application areas should not dominate the top-30 when the fallback safeguard is active.

- Actual behavior:
  - `collect_papers` now uses the improved query `+\"low-rank adaptation\" +\"instruction tuning\"` and completes successfully.
  - However, the fallback shortlist still admits off-topic domain papers into the selected 30, including medical, multimodal, and narrow application papers such as:
    - `MentalQLM: A Lightweight Large Language Model for Mental Healthcare Based on Instruction Tuning and Dual LoRA Modules.`
    - `BioInstruct: Instruction Tuning of Large Language Models for Biomedical Natural Language Processing`
    - `Ziya-Visual: Bilingual Large Vision-Language Model via Multi-Task Instruction Tuning`
    - `ATFLRec: A Multimodal Recommender System with Audio-Text Fusion and Low-Rank Adaptation via Instruction-Tuned Large Language Model`
  - The shortlist is better than the older broad-query run, but still not tight enough to count as a clean related-work set for this run contract.

- Fresh vs existing session comparison:
  - Fresh session: the new run `d45c14cd-edb0-4b45-95cf-9668c712c9a3` reproduces the shortlist drift in the rerank-fallback path.
  - Existing session: earlier broad-query run `089dce45-0385-4a93-9d2d-b1b5b10678bc` was worse at collect time, but the same underlying shortlist weakness remains when rerank times out.
  - Divergence: collect quality improved with the tightened brief; shortlist purity is still the remaining boundary.

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the strict rerank-fallback safeguard relies mostly on anchor hit counts, but it does not penalize domain-specific tokens strongly enough when those domains are absent from the research brief. As a result, papers that mention LoRA/instruction tuning in unrelated application areas still survive the fallback shortlist.

- Code/test changes:
  - Code: `src/core/nodes/analyzePapers.ts`
  - Tests: `tests/analyzePapers.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same live flow after rebuilding and rerunning from a fresh `test/.tmp` workspace

- Follow-up risks:
  - The shortlist is materially cleaner, but some domain-specific titles can still remain if they are genuinely PEFT/instruction-tuning focused enough for this brief.
  - If a future brief is explicitly medical or multimodal, the guard still depends on the brief carrying those anchors.
- Evidence/artifacts:
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/collect_request.json`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/collect_result.json`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/analysis_manifest.json`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/paper_summaries.jsonl`
  - `test/.autolabos/runs/d45c14cd-edb0-4b45-95cf-9668c712c9a3/events.jsonl`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/analysis_manifest.json`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/collect_request.json`
  - `test/.tmp/compact-brief-rerun-6/.autolabos/runs/b86d40eb-4e9c-454c-bb48-019563a90bed/events.jsonl`

- Resolution notes:
  - After the first patch, the live rerun still showed off-topic domain titles because the rerun was launched from an old built artifact.
  - After rebuilding and rerunning the same `/brief start --latest` flow from a fresh workspace, the rerank-fallback safeguard now reports:
    - `Dropped 24 off-topic paper(s) and promoted 24 replacement(s).`
  - The fresh selected top-30 is now led by papers such as:
    - `Compresso: Structured Pruning with Collaborative Prompting Learns Compact Large Language Models`
    - `Towards Alignment-Centric Paradigm: A Survey of Instruction Tuning in Large Language Models`
    - `Hyperparameter Optimization for Large Language Model Instruction-Tuning`
    - `Chain-of-LoRA: Enhancing the Instruction Fine-Tuning Performance of Low-Rank Adaptation on Diverse Instruction Set`
    - `MiLoRA: Efficient Mixture of Low-Rank Adaptation for Large Language Models Fine-tuning`
  - In the same rerun, the earlier drifting titles no longer appear near the top of the selected shortlist, including:
    - `ATFLRec...`
    - `MentalQLM...`
    - `BioInstruct...`
    - `Ziya-Visual...`

## Issue: LV-085

- Status: resolved
- Validation target: real `test/`-workspace governed run for the LoRA rank × dropout factorial brief
- Environment/session context: real `test/` workspace run `2c473563-13ad-4e11-b32a-9ff63e358f10`, revalidated through the same governed flow after implement fallback recovery changes

- Reproduction steps:
  1. Start the real run from `test/` with the governed brief for the Mistral-7B LoRA rank/dropout sweep.
  2. Let the run progress through `collect_papers`, `analyze_papers`, `generate_hypotheses`, and `design_experiments`.
  3. Allow `implement_experiments` to attempt public-bundle materialization and local verification.
  4. Observe the run fail before `run_experiments` because the declared public script path was never materialized.

- Expected behavior:
  - `implement_experiments` should hand off a runnable public experiment bundle containing the declared entrypoint, config, and docs.
  - Local verification should only fail if the declared public bundle is truly incomplete or unrunnable.

- Actual behavior:
  - Before the fix, `implement_experiments` failed with:
    - `Local verification could not start because required artifact(s) were not materialized ... run_lora_rank_dropout_sweep.py`
  - After the fix, the same real run now materializes:
    - `run_lora_rank_dropout_sweep.py`
    - `lora_rank_dropout_config.json`
    - `README_lora_rank_dropout.md`
  - The workflow advances beyond `implement_experiments`; the next real failure is later in `run_experiments` on offline Hugging Face model/tokenizer availability.

- Fresh vs existing session comparison:
  - Fresh session: broader-brief reruns now also advance through `collect_papers` into `analyze_papers`
  - Existing session: the persisted run `2c473563-13ad-4e11-b32a-9ff63e358f10` no longer fails on missing public artifacts
  - Divergence: no remaining evidence that the dominant failure is implement-stage materialization

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: `implement_experiments` is ending with a declared public run command, but the actual public script/config bundle was never materialized into `outputs/.../experiment/`; the old `metrics.json` symptom is stale and no longer the dominant blocker.

- Code/test changes:
  - Code: `src/core/agents/implementSessionManager.ts`
  - Tests: `tests/implementSessionManager.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same real flow; artifact materialization now succeeds and the blocker moved downstream

- Follow-up risks:
  - The active blocker has shifted to `LV-086` and later runner/environment boundaries.
- Evidence/artifacts:
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/events.jsonl`
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/run_record.json`
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/memory/run_context.json`
  - `test/.autolabos/runs/2c473563-13ad-4e11-b32a-9ff63e358f10/implement_result.json`
  - `test/outputs/lora-rank-dropout-interaction-study-for-mistral--2c473563/experiment/run_lora_rank_dropout_sweep.py`
  - `test/outputs/lora-rank-dropout-interaction-study-for-mistral--2c473563/experiment/lora_rank_dropout_config.json`

## Issue: LV-086

- Status: resolved
- Validation target: real `test/`-workspace governed run for the LoRA rank × dropout factorial brief after `run_experiments`
- Environment/session context: same persisted live run `1f46de0f-5beb-4de6-a219-abf483b74101`, revalidated by forcing `analyze_results` through a real `test/` TUI session after the preflight-only metrics patch

- Reproduction steps:
  1. Start the real run from `test/` with the governed LoRA rank/dropout brief.
  2. Let `implement_experiments` and `run_experiments` complete.
  3. Inspect `.autolabos/runs/<run-id>/metrics.json` and `analysis/result_table.json`.
  4. Observe that the recorded metrics come from `mode: "preflight"` with no training or evaluation executed.

- Expected behavior:
  - `run_experiments` should not treat preflight-only environment checks as successful executed experiment evidence for this paper-scale brief.
  - Objective evaluation should not infer research success from hardware/resource fields such as `device.gpu_count` when the stated objective is benchmark accuracy on ARC-Challenge and HellaSwag.

- Actual behavior:
  - Before the fix:
    - `metrics.json` contained `mode: "preflight"` and `primary_metric: null`
    - `run_experiments` summarized `Objective metric met: device.gpu_count=2 >= 0.015`
    - `analyze_results` carried that stale success claim into `result_analysis.json`
  - After the fix and same-flow rerun:
    - `analyze_results` fails with `Experiment only emitted preflight metrics; no training or evaluation was executed.`
    - `result_table.json` is empty and no longer exposes `device.gpu_count` as the objective metric
    - `result_analysis.json` now reports `objective_status: "missing"` and no longer carries success-style `verifier_feedback`
    - `run_record.json` pauses back at `run_experiments` with the preflight-only failure surfaced as the latest summary

- Fresh vs existing session comparison:
  - Fresh session: the patched code was exercised in a real `test/` TUI rerun using startup automation from the same workspace
  - Existing session: the same persisted run `1f46de0f-5beb-4de6-a219-abf483b74101` now shows corrected artifacts after rerunning `analyze_results`
  - Divergence: none observed for this boundary after the rerun

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: preflight-only metrics were being allowed through result analysis and stale success-style verifier feedback from `run_experiments` was being copied into `result_analysis.json`, leaving a misleading “objective met” trail even when no executed experiment evidence existed.

- Code/test changes:
  - Code:
    - `src/core/experiments/executedMetrics.ts`
    - `src/core/nodes/runExperiments.ts`
    - `src/core/nodes/analyzeResults.ts`
  - Tests:
    - `tests/objectiveMetricPropagation.test.ts`

- Regression status:
  - Automated regression test linked: yes
  - Re-validation result: pass on the same real flow; preflight-only metrics are now surfaced as failure and no longer over-promoted into public analysis artifacts

- Follow-up risks:
  - `run_experiments` still pauses upstream because the underlying experiment never executed beyond preflight; that is now an honest blocker rather than a misleading success signal.
- Evidence/artifacts:
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/metrics.json`
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/result_analysis.json`
  - `test/outputs/lora-rank-dropout-interaction-for-mistral-7b-ins-1f46de0f/analysis/result_table.json`
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/run_record.json`
  - `test/.autolabos/runs/1f46de0f-5beb-4de6-a219-abf483b74101/events.jsonl`

## Issue: LV-ARCHIVE-ANCHOR

- Status: resolved
- Validation target: `ISSUES.md` structural compatibility with harness validation
- Environment/session context: repository root documentation state after archive compaction

- Reproduction steps:
  1. Run `npm run validate:harness` from the repository root.
  2. Observe that the validator scans `ISSUES.md`.
  3. Remove all structured `Issue:` entries from the file.

- Expected behavior: `ISSUES.md` remains machine-readable by the harness validator.
- Actual behavior: the validator reports `issue_entry_missing` when no structured issue headings remain.
- Fresh vs existing session comparison:
  - Fresh session: same validator result
  - Existing session: same validator result
  - Divergence: no

- Root cause hypothesis:
  - Type: `persisted_state_bug`
  - Hypothesis: the validator still expects at least one structured `Issue:` entry even when active defects are empty and older issues have been compacted into git history.

- Code/test changes:
  - Code: none
  - Tests: none

- Regression status:
  - Automated regression test linked: no
  - Re-validation result: pass once this archive anchor remains present

- Follow-up risks: validator and operator-facing issue management can drift again if the file is compacted without leaving any structured anchor.
- Evidence/artifacts: `npm run validate:harness`, `docs/live-validation-issue-template.md`
