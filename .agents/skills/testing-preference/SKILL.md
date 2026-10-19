---
name: testing-preference
description: How much automated testing the owner wants in this repo. Read before adding or expanding tests, or when deciding how to verify a change.
---

# Testing preference: keep it light

Dustin does his own manual QA. Automated tests are a safety net for the few things
that are easy to break silently, not a goal in themselves.

## Rules

- **Default to zero new tests.** Most changes here (board wiring, prompts, README,
  dependency bumps, env config) do not need a test. Verify with `npm run check`
  (typecheck) and, when relevant, `npm run build`, then stop.
- **Add a test only when all of these hold:**
  1. The bug or behaviour would fail *silently* in production (no typecheck, no
     obvious runtime error) — e.g. a Factory rule dispatching to a lane that
     doesn't exist.
  2. It can be covered in **one short test** (a handful of assertions).
  3. It fits in the existing file `tests/github-workflow.test.mjs`. Do not create
     new test files or test infrastructure.
- **Never** add "sanity" / "structure" tests (phase lists, kind labels, outcomes
  maps, "skill X is bundled") unless explicitly asked. If an existing one gets in
  the way of a change, delete it rather than expand it.
- **Never** add tests for prompt wording.
- When unsure, don't add the test — mention in the final summary that it's
  manually verifiable and how (e.g. "edit an issue on the board and confirm no
  `no destination lane` error").

## Verification that *is* expected

- `npm run check` must pass.
- Run the existing test file if the change touches `src/mastra/github-workflow.ts`.
- Describe the manual QA step for Dustin in the summary.
