# Design Notes

This directory contains bounded design reviews and implementation notes that support the canonical docs in `docs/`.

These notes are not claims that the described runtime behavior is already implemented or validated. Treat them as scoped contracts, design constraints, or future implementation plans unless the relevant checklist item and tests say otherwise.

## Current Notes

- `deep-reviewer-backend-integration-study.md`
- `stage-evolution-design.md`
- `exploration-knowledge-retention-review.md`
- `multimodal-memory-layer-review.md`
- `node-output-serialization-stability-audit.md`

## Placement Rule

Keep canonical user-facing and source-of-truth docs in `docs/`. Put longer design reviews, pressure tests, future implementation contracts, and P2/P3 planning notes here when they would otherwise crowd the docs root.
