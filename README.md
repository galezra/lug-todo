# lug-todo

Scaffold for the LUG todo-list SaaS MVP (LUG-4). No product features yet — this is
the repo, CI, and deploy skeleton that MVP work lands in.

## Stack

- **Node.js + Express** — smallest thing that can serve HTTP and grow into the todo
  API without a build step or framework lock-in.
- **SQLite** (added when LUG-4 needs persistence) — single file, no separate DB
  server to run/pay for at this scale.
- **Plain npm + Node's built-in test runner** — no extra tooling to maintain.

Not chosen: Next.js/React (no need for a client framework for a CRUD todo list yet),
Postgres (SQLite is enough until there's real concurrent write load).

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci && npm test` on every push
and PR to `main`.

## Deploy target

Picked **Fly.io** (`Dockerfile` + `fly.toml`): git-based single-service deploy, free
tier, no shared company infra. Not yet live — deploying requires a Fly.io account and
`FLY_API_TOKEN`, which this agent can't create autonomously. To go live:

1. Create a Fly.io account (human step).
2. `fly launch --no-deploy` in this repo, then `fly deploy`.
3. Or add `FLY_API_TOKEN` as a GitHub Actions secret and wire up a deploy-on-merge job.

## Local dev

```
npm install
npm run dev      # http://localhost:3000/healthz
npm test
```
