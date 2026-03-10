# Security Policy

## Supported versions

AutoLabOS is currently maintained on the latest `1.x` release line on the
default branch.

| Version | Supported |
| --- | --- |
| 1.x | Yes |
| < 1.0 | No |

## Reporting a vulnerability

Please do not open public GitHub issues for security problems.

Use GitHub's private vulnerability reporting flow for this repository if it is
enabled. If that option is not available, contact the maintainer privately
through GitHub and include as much detail as possible.

Helpful details include:

- affected command, API route, or workflow node
- reproduction steps
- impact assessment
- logs, screenshots, or proof-of-concept details when safe to share
- any suggested remediation or mitigation

## What to expect

- We will acknowledge a report after triage.
- We will validate the issue, assess impact, and work on a fix when confirmed.
- We may ask follow-up questions if reproduction details are incomplete.
- We will coordinate disclosure timing when a fix is required.

## Scope notes

Please include environment details when reporting issues tied to:

- local command execution
- Codex authentication state
- OpenAI API-backed modes
- PDF handling and local `pdflatex` availability
- Semantic Scholar integrations
