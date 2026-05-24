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

## Monitoring & Observability

### Sentry Error Tracking

Sentry is wired up via `src/instrument.ts` and activates when `SENTRY_DSN` is set.

**Setup:**
1. Create a Node.js project at [sentry.io](https://sentry.io)
2. Copy the DSN from Project Settings > Client Keys
3. Add `SENTRY_DSN` as a Fly secret (`flyctl secrets set SENTRY_DSN=… -a money-flow-backend`)
4. Deploy and hit `GET /debug-sentry` to trigger a test error
5. Confirm the error appears in the Sentry dashboard
6. Remove or restrict `/debug-sentry` once verified (it is unprotected)

**Configuration (in `src/instrument.ts`):**
- `tracesSampleRate`: 20% in production, 100% in development
- `sendDefaultPii`: disabled (no personal data sent)
- `environment`: auto-detected from `NODE_ENV`

### UptimeRobot Monitoring

The `/health` endpoint returns `{"status":"ok"}` and is used for uptime monitoring.

**Setup:**
1. Sign up at [uptimerobot.com](https://uptimerobot.com) (free, no card needed)
2. Add a new monitor:
   - Type: **HTTPS**
   - URL: `https://money-flow-backend.fly.dev/health`
   - Interval: **5 minutes**
   - Alert contact: your email or Telegram
3. Optionally add `/api/health` as a second monitor (checks DB connectivity too)
