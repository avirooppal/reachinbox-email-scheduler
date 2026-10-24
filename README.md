# ReachInbox: Full-Stack Email Job Scheduler

### Reviewer Access & Live Links
- **Live Production URL:** [https://reachinbox-email-scheduler-n1js.onrender.com](https://reachinbox-email-scheduler-n1js.onrender.com)
- **Reviewer Demo Credentials:** `demo@example.com` / `DemoPassword123!` *(or click "Continue with Google")*
- **Bull Board Queue Dashboard:** [https://reachinbox-email-scheduler-n1js.onrender.com/admin/queues](https://reachinbox-email-scheduler-n1js.onrender.com/admin/queues)
- **Prometheus Metrics:** [https://reachinbox-email-scheduler-n1js.onrender.com/metrics](https://reachinbox-email-scheduler-n1js.onrender.com/metrics)
- **Health Check:** [https://reachinbox-email-scheduler-n1js.onrender.com/health](https://reachinbox-email-scheduler-n1js.onrender.com/health)

---

## How to Run Locally

### 1. Prerequisites
- Docker & Docker Compose
- Node.js 20+

### 2. Start Infrastructure (Docker)
Start PostgreSQL (port `5434`), Redis with AOF persistence (port `6379`), and Elasticsearch (port `9200`):
```bash
docker compose up -d
```

### 3. Run Backend
```bash
cd backend
npm install
npm run migrate
npm run seed

# Terminal 1: Start API Server (runs on http://localhost:4000)
npm run dev:api

# Terminal 2: Start Background Email Worker
npm run dev:worker
```

### 4. Run Frontend
```bash
cd frontend
npm install

# Terminal 3: Start Web Client (runs on http://localhost:5173)
npm run dev
```

---

## Environment Variables

### Backend (`backend/.env`)
```ini
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Databases
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5434/email_scheduler?schema=public"
REDIS_URL="redis://localhost:6379"
ELASTICSEARCH_URL="http://localhost:9200"

# Secrets
JWT_SECRET="16102559d30cdbbe7d036b2418a94d167f45b526b2d30be678fce4984d1ca55f"
ENCRYPTION_KEY="7645c84306ac289baf1991b20326cfdebea114d1cee9039ab74e67618a67fe35"

# Delivery Limits & Concurrency
WORKER_CONCURRENCY=5
MIN_DELAY_BETWEEN_EMAILS_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=200
MAX_EMAILS_PER_HOUR_GLOBAL=0
RATE_LIMIT_MODE=fixed
JITTER_PCT=15

# Google & Slack OAuth (Optional for local dev, pre-configured on live)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI="http://localhost:4000/auth/google/callback"
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI="http://localhost:4000/api/integrations/slack/callback"
```

### Frontend (`frontend/.env`)
```ini
VITE_BACKEND_URL=http://localhost:4000
```
