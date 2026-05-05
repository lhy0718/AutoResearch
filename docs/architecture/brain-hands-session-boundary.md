# Brain / Hands / Session Boundary

This note records a future integration boundary for external model workers and execution sandboxes. It is a design contract, not a new runtime dependency.

## Roles

- Brain: model worker, prompt harness, planner, and audit policy.
- Hands: code execution sandbox, local or remote worktree, job runner, and generated experiment code.
- Session: durable run log, checkpoints, run record, artifact index, and audit exports.

## Boundary Rules

- The hands environment should not receive raw credentials, tokens, or private connector secrets.
- The session layer must preserve append-only events and checkpoint records outside model context.
- The brain layer may request work, but judge-lane artifacts decide paper-readiness promotion.
- External worker traces should link back to AutoLabOS run events and artifacts without replacing them.
- A sandbox or remote executor failure must remain visible in audit artifacts.

## P5 Scope

P5 documents this boundary and exposes timeline/done-condition artifacts. Actual remote execution, managed sessions, credential proxying, or hosted worker orchestration remain future work unless separately approved.
