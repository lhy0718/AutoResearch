---
name: public-code-fixture-hygiene
description: Use when editing AutoLabOS public source, tests, examples, or generated-code fixtures to prevent one-off experiment identifiers, model names, benchmark names, or condition markers from becoming public contracts.
---

# Public Code Fixture Hygiene

Use this skill before and after changing AutoLabOS code, tests, examples, prompts, or repair fixtures that may be committed or published.

## Goal

Public source and tests must describe general AutoLabOS behavior, not one historical experiment. A test fixture is public code too.

## Rules

- Do not hardcode one-off runner names, model IDs, dataset names, benchmark names, or condition markers as system defaults or test contracts.
- Use neutral fixture names such as `run_instruction_study`, `benchmark_task_a`, `benchmark_task_b`, `baseline_condition`, and `candidate_condition_a`.
- Keep real experiment names inside run artifacts or user-provided inputs, not reusable source logic.
- If legacy compatibility is still needed, express it through generic alias/adapter behavior rather than naming a specific old experiment.
- Do not allow paper-writing fallbacks to invent a specific model, benchmark pair, method setting, or condition marker.

## Workflow

1. Search both `src` and `tests`; tests are public code.
2. Replace public fixture identifiers with domain-neutral names while preserving behavior.
3. Prefer semantic, file-scoped edits over broad repository-wide rewrites.
4. Add or update a regression test when a new leak pattern is found.
5. Keep `tests/publicCodeSanitization.test.ts` passing.

## Verification

Run the repository’s public-code sanitization test and the smallest relevant behavior tests:

```bash
npm test -- tests/publicCodeSanitization.test.ts
npm run build
```

For changes touching experiment execution, result analysis, or writing behavior, also run the closest focused tests, for example:

```bash
npm test -- tests/runExperimentsExecutionProfile.test.ts tests/resultAnalysis.test.ts tests/scientificWriting.test.ts
```

## Failure Pattern To Avoid

Do not stop after cleaning `src` if the same one-off identifiers remain in tests, examples, or generated-code fixtures. Public tests can teach future agents and contributors the wrong contract.
