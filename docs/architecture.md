# Architecture

The full product plan lives in the project plan doc. This page records what is
built in the repository and why.

## Runtime shape

```
Mobile app (Expo) ──HTTPS──> ALB ──> ECS Fargate: api (NestJS)  ──> RDS Postgres 16 + PostGIS
                                                    │            ──> ElastiCache (Valkey/Redis)
                                                    └─ SendMessage ──> SQS jobs ──> ECS Fargate: workers
Photos: app ──presigned PUT──> S3 (private) ──OAC──> CloudFront ──> app
```

- Region `ap-south-1` (Mumbai): lowest latency to Bengaluru, keeps personal data in India.
- Three AZs; tasks in private subnets; RDS and Redis in isolated subnets with no internet route.
- API is stateless and horizontally scaled (CPU target tracking). Workers scale separately.
- SQS gives at-least-once delivery: handlers must be idempotent on the job id. Five failed
  attempts move a message to the DLQ, which raises an alarm.

## Sizing for ~10k transactions/day

10k/day averages well under 1 request/second; evening and weekend peaks for a social app
can be 10 to 20x average. Production defaults (2 to 10 API tasks at 0.5 vCPU, `db.t4g.medium`
Multi-AZ, `cache.t4g.small` with a replica) handle roughly 50x that before the first scaling
decision, which is a read replica or a larger DB instance. Staging is single-AZ with one NAT.

## Conventions

- **Contracts**: request/response shapes live in `packages/shared` as zod schemas. The API
  produces them and the mobile app validates responses against them.
- **Health**: `/health` is liveness (no dependency calls, used by the ALB so a DB blip does not
  cycle every task); `/health/ready` checks Postgres/PostGIS and Redis and returns 503 when degraded.
- **Config**: every service validates its environment at boot with zod and refuses to start
  on bad config. In AWS, the DB password comes from the RDS-managed Secrets Manager secret.
- **Logs**: JSON (pino) in AWS with a request id propagated through `x-request-id`.
- **Versioning**: feature routes live under `/v1`; health stays unversioned.
- **Images**: multi-stage, non-root, built for `linux/arm64` (Graviton is about 20% cheaper).
- **Deploys**: ECS rolling deploys with circuit-breaker rollback. Terraform ignores the running
  image tag; CI owns deployments (added with the first deploy workflow).

## Accounts and login (milestone 2)

```
app ── POST /v1/auth/otp/start {phone} ──> API ── rate limits (Redis) ──> Cognito ──SMS──> phone
app ── POST /v1/auth/otp/verify {challengeId, code} ──> API ──> Cognito ──> tokens ──> app
app ── Authorization: Bearer <access token> ──> API (verifies JWT against Cognito JWKS)
```

- **Cognito, passwordless.** Choice-based auth (`USER_AUTH` + `SMS_OTP`, Essentials tier). New
  numbers go through `SignUp` -> `ConfirmSignUp`, and the confirmation session signs them in
  without a second SMS. Members never have a password.
- **The API proxies Cognito.** It is a confidential app client (client secret in Secrets
  Manager), so the app cannot call Cognito directly and every SMS passes our controls:
  Indian numbers only (`ALLOWED_PHONE_PREFIXES`), a 30 s resend cooldown, 5 codes per number
  per hour, 30 per IP per hour, 5 wrong codes per challenge. This is the main defence against
  SMS-pumping fraud, which would otherwise be a direct cost.
- **Challenges** live in Redis for 3 minutes keyed by a random `challengeId`; the Cognito
  session never reaches the device.
- **Tokens.** Access tokens (60 min) are verified locally with the cached JWKS, then mapped to
  `users` by `cognito_sub` on each request (one indexed lookup). The refresh token (90 days)
  is stored in the iOS Keychain / Android Keystore via expo-secure-store and wraps the
  Cognito token with the user's `sub`, which the refresh call's `SECRET_HASH` needs. The app
  refreshes transparently on a 401.
- **Every route requires auth** (global guard) unless marked `@Public()`.
- **Account deletion** (`DELETE /v1/me`, required by both app stores) deletes the Cognito user
  and the database rows, then a worker job purges all S3 objects for the account.
- **Local/dev** uses `AUTH_PROVIDER=dev` (fixed code, HS256 JWTs). Env validation refuses it
  in production.

## Profiles, photos and verification (milestone 2)

```
app ─POST /v1/me/photos─> API: reserve slot, presigned POST (10 MB, image/* only, 5 min)
app ─multipart POST────> S3 incoming/<user>/<photo>
app ─POST .../complete─> API: HeadObject, status=processing, SQS photo.process
worker: decode with sharp (rejects non-images, decompression bombs), auto-rotate,
        strip EXIF/GPS by re-encoding to JPEG, 1600px full + 400px thumb,
        Rekognition DetectModerationLabels -> public/photos/<user>/<photo>/{full,thumb}.jpg
        (CloudFront, immutable cache) or status=rejected with a reason
```

- A profile needs a name, birthday (18+ enforced; only age is ever shown), gender and at least
  **3 approved photos** (max 6) before anyone else can see it. `GET /v1/me` returns the
  onboarding state the app uses to route the member.
- **Presigned POST, not PUT,** so S3 enforces the size limit and content type itself.
- Uploads are re-encoded on the device first (HEIC -> JPEG, max 1600 px), so uploads are
  small and the server only accepts JPEG/PNG/WebP.
- Moderation blocks explicit content, violence, gore and hate symbols; swimwear is allowed.
  Labels are stored with the photo for appeals and threshold tuning.
- **Selfie verification**: the member takes a front-camera selfie; the worker checks for exactly
  one face, then `CompareFaces` against their approved photos. Similarity >= 95 sets
  `profiles.verified_at` (the verified badge). The selfie is deleted right after the check
  (biometric data, DPDP Act) and a lifecycle rule removes any abandoned ones after a day.
  Limited to 5 attempts per day.
- Photo URLs are public-but-unguessable CloudFront URLs (UUID paths), the norm for dating apps.
  Signed URLs are an option later if needed.
- Local/dev uses S3Mock and `MODERATION_PROVIDER=none` (approves everything; refused in
  production).

## Deliberately deferred

- Liveness detection for selfies (Rekognition Face Liveness needs a native SDK component;
  today's check is a still-photo face match). A manual review queue for failed checks.
- Cognito threat protection (Plus tier) and WAF on the API.
- Changing phone number.
- Custom domain + ACM certificate: needs a chosen app name/domain.
- WAF, RDS Proxy, OpenSearch, WebSocket chat: added in the milestones that need them.
- A dedicated least-privilege DB user for the app (currently the RDS master user).
