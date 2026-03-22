# money-flow-backend

Express + TypeScript REST API for money-flow app.

## Tech stack
- Node.js, Express, TypeScript
- MongoDB via Mongoose
- JWT authentication (bcryptjs)
- Deployed on Railway

## Key files
- `src/app.ts` — entry point, middleware setup
- `src/routes/` — API route handlers
- `src/models/` — Mongoose models
- `src/middleware/` — auth middleware

## Frontend
- Production frontend: Vercel
- Repo: /Users/ricky/Dev/money-flow-frontend

## Product Goal
A simple expense tracking app that lets users log and review their spending. Prioritise simplicity and usability. Do not add features that complicate the core use case.

Anti-goals: no multi-user, no complex analytics, no over-engineering.

## Context
Before starting any task, read the last 10 lines of /Users/ricky/Dev/decisions.jsonl for recent decisions.
After completing any task, append one line to /Users/ricky/Dev/decisions.jsonl:
`{"date":"YYYY-MM-DD","project":"money-flow-backend","prompt":"...","summary":"..."}`

## Autonomous operation rules
- You are running in a fully automated context with no human in the loop.
- Do not ask for approval. Make decisions and proceed.
- After completing a task: run `yarn build` to verify TypeScript compiles, then commit and push.
- Commit format: `type: short description` (feat, fix, refactor, chore)
- If build fails, fix it before committing. Do not use `--no-verify`.
- Do not add unnecessary comments, docstrings, or TODO markers.
- Prefer editing existing files over creating new ones.
- Keep changes minimal and focused on the task.
