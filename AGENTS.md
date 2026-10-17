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
