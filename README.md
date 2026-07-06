# lug-todo

A basic todo list SaaS (LUG-4): email/password signup, per-user todo lists
(create/edit/toggle/delete), server-rendered HTML — no client framework.

## Stack

- **Node.js + Express** — smallest thing that can serve HTTP and the todo API
  without a build step or framework lock-in.
- **`node:sqlite`** (built into Node ≥22.5, no dependency) — single file, no
  separate DB server to run/pay for at this scale.
- **`node:crypto`** for password hashing (scrypt) and signed session cookies —
  no session-store or auth library needed for one instance.
- **Plain npm + Node's built-in test runner** — no extra tooling to maintain.

Not chosen: Next.js/React (no need for a client framework for a CRUD todo list),
Postgres (SQLite is enough until there's real concurrent write load), a session
store like Redis (single Fly machine, in-cookie signed session is enough).

Set `SESSION_SECRET` in production so sessions survive restarts/deploys — if
unset, the process generates an ephemeral one and all sessions are invalidated
on every restart.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci && npm test` on every push
and PR to `main`.

## Deploy target

Picked **Fly.io** (`Dockerfile` + `fly.toml`): git-based single-service deploy, free
tier, no shared company infra. Not yet live — deploying requires a Fly.io account and
`FLY_API_TOKEN`, which this agent can't create autonomously. To go live:

1. Create a Fly.io account (human step). Fly.io is third-party, non-company-controlled
   hosting — confirm it's an approved deploy target before creating the account.
2. Mount a persistent volume for the SQLite file (`fly volumes create`, then
   `[mounts]` in `fly.toml`) — without one, todos are lost on every machine restart.
3. Set `FLY_API_TOKEN` and `SESSION_SECRET` as secrets, then `fly launch --no-deploy`
   in this repo followed by `fly deploy`.
4. Or add `FLY_API_TOKEN` as a GitHub Actions secret and wire up a deploy-on-merge job.

## Local dev

```
npm install
npm run dev      # http://localhost:3000, signup at /signup
npm test
```
