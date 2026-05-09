---
name: autolabos-validation-workspace-hygiene
description: Use this skill when preparing, cleaning, or rerunning an AutoLabOS live validation workspace, especially when briefs, templates, run outputs, nested validation folders, or legacy artifacts may affect a real paper-readiness run.
contract_version: 1
contract_kind: codex_skill
runtime_contract: true
gate: validation_workspace_integrity
validation: workspace_root_artifact_review
---

# AutoLabOS Validation Workspace Hygiene

## Purpose

Keep a live validation workspace coherent before running AutoLabOS from it. The workspace root is an input and artifact boundary; it should not be confused with nested historical run folders or the repository.

This skill is about execution hygiene, not about claiming research success.

## Use this skill when

Use this skill when the user asks to:
- rerun a live validation from a specific workspace
- clean a validation workspace
- move a recent brief out of a nested run folder
- decide where `template.tex`, `.sty`, `.env`, or `.autolabos/config.yaml` should live
- remove legacy `.tmp`, `outputs`, logs, or nested workspace state before a real run
- explain why a run used the wrong brief or failed to find a manuscript template

## Workspace contract

- Run AutoLabOS from the intended validation workspace root, not from a nested historical run folder.
- If the user names both a workspace root and a nested prior run folder, treat the workspace root as the execution root unless they explicitly override it.
- Keep current input files at the workspace root: active brief, `.env`, `.autolabos/config.yaml`, manuscript template files, and style files.
- Treat repo files as implementation; do not copy private validation templates into the repo.
- Treat generated outputs, `.tmp`, old logs, and old `.autolabos/runs` state as disposable unless the user explicitly asks to preserve them.
- If a recent brief lives under a nested folder, promote it to the workspace root before rerunning.
- If promoting config from a nested validation folder, inspect it first and preserve only the intended provider, workflow, experiment, and paper settings.
- Do not create a new nested workspace merely because the active brief came from a nested folder; move the required inputs up and run from the root.

## Cleanup workflow

1. List files and directories before deleting anything.
2. Identify the active brief and verify it is the one the user intends to run.
3. Identify root-owned templates and style files before deciding anything is missing.
4. Promote required inputs to the workspace root.
5. Remove nested validation folders only after required inputs are copied.
6. Remove legacy root artifacts that could pollute the next run.
7. Re-list the workspace root and report the remaining files.

## Paper template checks

- The active brief should explicitly name the manuscript template, for example `template.tex`.
- First inspect the workspace root for the requested template and style files; do not assume they belong in the repo.
- Strict paper validation should have author metadata in the brief when final paper rendering is expected.
- If the template references a package name whose case differs from the available `.sty` file, fix the workspace-local compatibility issue before the live run.
- Prefer a workspace-local symlink or template-path repair over modifying repository code or committing validation templates.
- A case-compatibility symlink is acceptable only when it explains an actual template import mismatch; report why it exists so future cleanup does not remove it by mistake.

## Guardrails

- Do not delete current run evidence unless the user asked for a clean rerun or confirmed the cleanup scope.
- Do not move `.env` into the repo or print secrets.
- Do not claim cleanup validates scientific quality.
- Do not report a live validation as complete until the same run flow has been rerun from the cleaned workspace.
