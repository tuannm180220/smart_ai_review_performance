# Multi-tenant — PostgreSQL

The app stores per-user Settings and synced data in **PostgreSQL**.
Set `DATABASE_URL` in `backend/.env`. Without it, the app falls back to
single-tenant JSON files (no login).

## Quick start (Docker on port 5433)

```bash
# repo root — avoids conflict with other apps on :5432
docker compose up -d

cd backend
# ensure .env has DATABASE_URL, JWT_SECRET, CONFIG_ENCRYPTION_KEY
npm run migrate
npm run seed-local -- --email you@example.com --password 'your-login-password'
npm run dev
```

Frontend: `cd frontend && npm run dev` → `http://localhost:5173` → sign in.

Connection URL:

```text
postgresql://ai_review:ai_review_local@127.0.0.1:5433/ai_review
```

Full Postgres notes: [`local-postgres.md`](./local-postgres.md).
