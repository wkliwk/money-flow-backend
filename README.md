# money-flow-backend

Express + TypeScript REST API for the Money Flow personal finance app.

## Local Development (Docker)

Start the full backend stack with one command:

```bash
# Start backend + MongoDB (dev mode with hot-reload)
docker compose --profile dev up --build

# Backend available at http://localhost:3001
# Health check: http://localhost:3001/health
```

### Seed test data

```bash
# With Docker running:
docker compose --profile dev exec backend npx ts-node scripts/seed.ts

# Or directly (if MongoDB is running locally):
npx ts-node scripts/seed.ts
```

Test credentials: `test@example.com` / `password123`

### Profiles

| Profile | What it runs | Use case |
|---------|-------------|----------|
| `dev` | Backend (nodemon hot-reload) + MongoDB | Day-to-day development |
| `test` | Backend (dev) + Backend (prod build) + MongoDB | Pre-deploy testing |

### Stop and clean up

```bash
docker compose --profile dev down          # stop containers
docker compose --profile dev down -v       # stop + delete data
```

## Local Development (without Docker)

```bash
npm install
cp .env.example .env  # edit with your MongoDB URI
npm run dev            # starts on PORT 3001
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with nodemon (hot-reload) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled JS |
| `npm test` | Run tests |
