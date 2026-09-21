# Local PostgreSQL (port 5433)

Docker Compose maps **host 5433 → container 5432** so other apps can keep using 5432.

```bash
docker compose up -d
docker compose ps
```

`backend/.env`:

```bash
DATABASE_URL=postgresql://ai_review:ai_review_local@127.0.0.1:5433/ai_review
JWT_SECRET=<openssl rand -hex 32>
CONFIG_ENCRYPTION_KEY=<openssl rand -hex 32>
ALLOW_REGISTER=true
```

```bash
cd backend && npm run migrate && npm run seed-local -- --email you@example.com --password 'pass'
npm run dev
```

Change host port in `docker-compose.yml` (`"5434:5432"`) and update `DATABASE_URL`.

```bash
docker compose down       # keep data
docker compose down -v    # wipe volume
```
