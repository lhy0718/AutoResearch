---
name: paper-build-output-hygiene
description: Use this skill when validating AutoLabOS-generated TeX/PDF/paper bundles and keeping test/output coherent without manually substituting artifacts.
---

# Paper Build Output Hygiene

## Purpose
Ensure that AutoLabOS itself generates the paper-facing artifacts and that `test/output/` remains a clean, operator-facing bundle.

This skill is about artifact integrity and output structure, not about overstating research quality.

## Use this skill when
Use this skill when the user asks to:
- inspect generated TeX/PDF outputs
- clean up paper output structure
- remove duplicate or confusing bundles
- verify page-budget compliance
- determine whether TeX→PDF is wired correctly
- ensure the canonical output path is coherent

## Required validations
Always report:
1. current output structure
2. unnecessary file/folder status
3. duplicate artifact status
4. required artifact coverage
5. TeX status
6. PDF status
7. page-budget compliance status
8. wiring/path changes needed

## Required principles
- AutoLabOS should generate the canonical paper artifacts itself.
- Do not manually substitute externally written TeX/PDF as if it were system output.
- Prefer one coherent canonical bundle over many partially overlapping bundles.
- Keep operator-facing outputs easy to inspect.

## Guardrails
- Do not manually author TeX/PDF as a substitute for system output.
- Do not multiply output folders unless the contract explicitly requires it.
- Do not break canonical runtime paths while cleaning structure.
- Distinguish between "artifact exists" and "artifact is correctly wired and usable".