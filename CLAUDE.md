# money-flow-backend — Agent Context

## What This Is
Express + TypeScript + MongoDB backend for Money Flow, a personal transaction tracking app.

## Stack
- Runtime: Node.js + TypeScript 5 (strict mode)
- Framework: Express 4
- Database: MongoDB via Mongoose 7
- Auth: JWT (not yet implemented — Phase 1 task)

## Project Structure
```
src/
  app.ts          ← Express bootstrap, MongoDB connect, server start
  routes/
    expenses.ts   ← CRUD routes for /api/expenses
  models/
    Expense.ts    ← Mongoose schema (matches frontend types.ts)
```

## Environment Variables
```
PORT=3001
MONGODB_URI=mongodb+srv://...
```
Copy `.env.example` to `.env` and fill in values. Never commit `.env`.

## API Routes
| Method | Path | Description |
|---|---|---|
| GET | /health | Health check |
| GET | /api/expenses | List all expenses |
| POST | /api/expenses | Create expense |
| PUT | /api/expenses/:id | Update expense |
| DELETE | /api/expenses/:id | Delete expense |

## Dev Commands
```bash
yarn install
yarn dev        # nodemon + ts-node (hot reload)
yarn build      # compile to dist/
yarn start      # run compiled JS
```

## Coding Rules
- No `any` types — TypeScript strict mode is on
- No hardcoded secrets — use env vars via dotenv
- All routes in `src/routes/` — never inline in app.ts
- Mongoose models in `src/models/`
- Return consistent JSON error shape: `{ error: string }`

## Branch Strategy
- `main` ← production only
- `develop` ← integration
- `feature/*` ← your working branch, open PRs to develop

## Phase 1 Scope
- [x] Express bootstrap + MongoDB connection
- [x] CRUD routes for expenses
- [ ] JWT auth (User model + register/login + middleware)
- [ ] Deploy to Railway
