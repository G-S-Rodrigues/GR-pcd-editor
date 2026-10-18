# Contributor guidance

Read `point-cloud-cleaner-spec.md` for the normative product requirements,
`docs/GLOSSARY.md` for stable domain language, and `docs/agents/testing.md`
before selecting verification commands.

Never commit user PCDs, sessions, uploads, outputs, credentials, or agent and
plan artifacts. Any public fixture must be synthetic or explicitly cleared for
redistribution.

Stack: Python 3.12/FastAPI/uv backend in `backend/gr_pcd/`, Vite/TypeScript/
three.js frontend in `frontend/`, checks via the Compose `checks` profile.
See `docs/agents/testing.md`.

## Tests are verification, not a blocker

Tests exist so agents can verify their work. When an existing test fails
because the product changed on purpose (an owner ruling, a moved control, new
layout geometry, a renamed label), do not stop and ask: update the test to the
new behaviour, using the recommended fix, and list every changed or removed
test by id in the commit message. Keep what the test protects: change the
setup, selector, text or geometry it pins, never loosen a tolerance, threshold
or assertion, never add sleeps (wait for state instead), never skip or xfail.
Escalate only when a failure points at a real regression, or when the only way
to pass is to weaken what the test checks.
