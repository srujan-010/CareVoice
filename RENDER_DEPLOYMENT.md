# CareVoice — Render Backend Deployment Guide

This guide covers deploying the CareVoice Node/Express backend to **Render** using the direct **Sarvam Instant Outbound API** architecture (no manual Sarvam outbound campaigns required).

---

## 1. Pre-Deploy Architecture Notes

- **Build & TypeScript**: Because Render runs with `NODE_ENV=production`, a plain `npm ci` omits `devDependencies` (including `typescript` and `@types/*`). Always use **`npm ci --include=dev && npm run build`** as the Render Build Command (pre-configured in [`render.yaml`](render.yaml)).
- **Health Checks**:
  - `/api/healthz` returns `200 OK` only when MongoDB Atlas is connected (`503` otherwise) and is configured as Render's `healthCheckPath`.
  - `/api/health` returns JSON diagnostics (`database`, `queue`, `telephony.mode`, `telephony.webhookReady`) for the frontend Platform & Safety dashboard.
- **Scheduling Queue**:
  - Single-instance Render deploys run cleanly with `REDIS_ENABLED="false"`, using CareVoice's MongoDB recovery/polling fallback (note: if running on Render Free tier, the instance sleeps after 15 min of inactivity; use Starter+ / Always-On or an external cron/Worker if time-critical reminders run 24/7).
  - For multi-instance horizontal scaling or strict BullMQ Redis queues, provision a Redis instance (Render Key Value or Upstash) and set `REDIS_ENABLED="true"` + `REDIS_URL`.
- **Telephony Safety Default**:
  - Keep `VOICE_PROVIDER_MODE="mock"` and `TELEPHONY_ENABLED="false"` on initial deploy until HTTPS health, MongoDB Atlas IP allowlisting, frontend CORS, and `PUBLIC_WEBHOOK_BASE_URL` are verified.

---

## 2. Step-by-Step Render Setup

### Option A: Blueprint Deploy (`render.yaml`)
1. Push your repository to GitHub/GitLab (**verify `.env` is ignored by `.gitignore` and never committed**).
2. In Render Dashboard -> **New +** -> **Blueprint**, select your repository (`render.yaml` is detected automatically).
3. Supply values for the `sync: false` environment variables listed in Section 3.
4. Click **Apply** and wait for the initial build and `/api/healthz` health check to turn green.

### Option B: Manual Web Service Setup
1. In Render Dashboard -> **New +** -> **Web Service**, connect your repository.
2. Configure Service Settings:
   - **Name**: `carevoice-backend`
   - **Runtime**: `Node` (`Node >= 20`, enforced via `engines` in `backend/package.json`)
   - **Root Directory**: `backend`
   - **Build Command**: `npm ci --include=dev && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/healthz`
3. Add all environment variables from Section 3.

### Post-Deploy Webhook & CORS Cutover
1. Once Render assigns your public HTTPS URL (e.g., `https://carevoice-backend.onrender.com`), set:
   - `PUBLIC_WEBHOOK_BASE_URL=https://carevoice-backend.onrender.com`
   - `FRONTEND_URL=https://your-frontend-domain.com` (comma-separated if multiple origins; trailing slashes are automatically normalized).
2. Verify `GET https://carevoice-backend.onrender.com/api/healthz` returns `200 OK` with `"database": { "connected": true }`.
3. Verify `GET https://carevoice-backend.onrender.com/api/health` shows `webhookReady: true`.
4. CareVoice automatically passes `webhook_config.url`:
   `https://<your-render-domain>/api/voice-agent/webhook/sarvam/<SARVAM_WEBHOOK_TOKEN>`
   inside every `POST https://apps.sarvam.ai/api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds` call.
5. In your **frontend hosting provider (e.g. Vercel)**, set:
   - `NEXT_PUBLIC_API_URL=https://carevoice-backend.onrender.com/api`
6. When ready for live calling verification, flip **only then**:
   - `VOICE_PROVIDER_MODE=sarvam`
   - `TELEPHONY_ENABLED=true`

---

## 3. Production Environment Variable Checklist (Backend Only)

> Never store secrets in frontend env vars or commit real `.env` files.

### Core Platform & Security
- [ ] `NODE_ENV=production`
- [ ] `MONGODB_URI` — MongoDB Atlas SRV string (ensure Render egress IPs or Atlas network access rules allow connection)
- [ ] `MONGODB_DB_NAME=carevoice` (use a separate DB name such as `carevoice_prod` if separating from dev)
- [ ] `FRONTEND_URL` — Exact frontend origin(s), e.g., `https://carevoice.vercel.app` (no secrets; comma-separated for multiple)
- [ ] `JWT_SECRET` — Strong random secret (>= 32+ chars; generate fresh for production via `openssl rand -hex 32`)
- [ ] `JWT_EXPIRES_IN=7d`
- [ ] `VOICE_AGENT_INTERNAL_TOKEN` — Strong random internal service token (>= 32+ chars; generate fresh for production)
- [ ] `ALLOW_DEV_DEMO_MODE=false`

### Queue & Scheduling
- [ ] `REDIS_ENABLED` — `"false"` for MongoDB fallback (single instance), or `"true"` with managed Redis
- [ ] `REDIS_URL` — Required only when `REDIS_ENABLED="true"` (`rediss://...` for TLS Redis)

### Sarvam AI Instant Outbound API & Webhook Security
- [ ] `VOICE_PROVIDER_MODE` — Keep `"mock"` on initial deploy; set `"sarvam"` only at go-live
- [ ] `TELEPHONY_ENABLED` — Keep `"false"` on initial deploy; set `"true"` only at go-live
- [ ] `SARVAM_API_BASE_URL=https://apps.sarvam.ai`
- [ ] `SARVAM_API_KEY` — Sarvam **Voice Agents Workspace API Key** generated in `https://apps.sarvam.ai` (**Settings -> API Key** inside your workspace, sent as `X-API-Key`; do **NOT** use a `dashboard.sarvam.ai` Core Model API subscription key, and store without quotes or spaces)
- [ ] `SARVAM_ORG_ID` — Sarvam Organization UUID
- [ ] `SARVAM_WORKSPACE_ID` — Sarvam Workspace UUID
- [ ] `SARVAM_AGENT_ID` — Sarvam Voice Agent App ID (`app_config.app_id`)
- [ ] `SARVAM_AGENT_VERSION=2` — Positive integer matching published Sarvam Agent version (`app_config.app_version`; verify published version in Sarvam workspace)
- [ ] `SARVAM_CONNECTION_ID` — Sarvam telephony connection UUID (`app_config.connection_config.connection_id`)
- [ ] `SARVAM_PHONE_NUMBER` — Registered Sarvam agent caller ID in strict E.164 format (e.g. `+917965860596`)
- [ ] `SARVAM_WEBHOOK_TOKEN` — High-entropy secret token (>= 24 chars, recommended `openssl rand -hex 32`) embedded in webhook URL path
- [ ] `PUBLIC_WEBHOOK_BASE_URL` — Deployed public HTTPS backend origin (e.g. `https://carevoice-backend.onrender.com`, no trailing `/api`)
- [ ] `SARVAM_WEBHOOK_SECRET` — Optional HMAC secret only if a gateway injects `X-Webhook-Signature`

### Optional Notification Adapters
- [ ] `WHATSAPP_ENABLED=false` (set `"true"` + `WHATSAPP_PROVIDER_URL` + `WHATSAPP_API_TOKEN` when configured)
- [ ] `SMS_ENABLED=false` (set `"true"` + `SMS_PROVIDER_URL` + `SMS_API_TOKEN` when configured)

