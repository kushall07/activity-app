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

## Plans and the Explore feed (milestone 3)

```
app ─POST /v1/plans──> API: validate, insert plan (version=1) ─SQS plan.index─> worker
worker: read plan from Postgres -> index or delete in OpenSearch (external version) -> indexed_version
app ─GET /v1/plans?lat&lng&filters─> API: OpenSearch (ids) ─or─ PostGIS (ids) ─> Postgres (page, filters re-checked)
```

- **A plan** is a host offering 1 to 10 seats for an activity at a time and place: who can
  join (genders, optional seats per gender, age range, level, date/friends/either,
  verified-only), cost split and a short note. Posting needs a complete profile and the
  verified badge; a host can have 5 upcoming plans and post 10 a day. Notes and place
  names are rejected if they contain phone numbers, emails or handles, so contact
  happens in the app after a match.
- **Places are public.** A plan is at a listed venue (admins curate venues; partner
  portal in milestone 5) or at a named place in one of 20 Bengaluru neighbourhoods,
  optionally with a pin. We never ask for an address. Plans outside Bengaluru are refused.
- **Activities** are reference data (37 at launch across sport, shows, workshops, food,
  outdoors, art, science and games), seeded by migration; the slug is the stable id.
- **Postgres is the source of truth; OpenSearch is an index.** Every change bumps
  `plans.version` and enqueues `plan.index`. The worker reads the current row and writes it
  with external versioning (`external_gte`), so retries and out-of-order jobs converge on the
  latest state. If an enqueue is lost or OpenSearch is down, a sweeper in the workers
  (one at a time via a Postgres advisory lock) indexes every plan with
  `version > indexed_version` every 30 s, and hourly drops documents for ended plans.
- **The feed reads ids from search and details from Postgres.** OpenSearch (or the PostGIS
  query when it errors or takes over 1.5 s) returns ordered plan ids; the page is then read
  from Postgres with the same filters re-applied. A stale index entry can only drop an
  item, never show a cancelled plan or one the viewer should not see, and profile edits
  never need a reindex. The index holds only filter and sort fields, no personal data.
- **Hard filters** (identical in both paths, tested against both): plan open and not
  started, seats left, within the radius, viewer's gender wanted, viewer's age in range,
  not the viewer's own plan, verified-only plans hidden from unverified members. Optional
  filters: activities, categories, time window, intent (date or friends also match
  either), budget (plans with no stated cost are kept).
- **Keyset pagination.** The cursor holds the last item's sort key (start time or
  distance, plus id), so pages do not shift while plans are posted, and either path can
  continue the other's cursor.
- **Sizing.** At ~10k transactions/day there are a few thousand upcoming plans: one shard,
  one replica. Prod runs two Graviton data nodes across two AZs (`m7g.medium.search`),
  staging one `t3.small.search`. The domain is VPC-only, encrypted, TLS 1.2+, and only the
  API and worker task roles can call it (SigV4). PostGIS alone would serve this load; the
  index is there for ranking and text search in milestone 4 and to keep feed reads off the
  primary database as traffic grows.
- **Mobile.** Tabs for Explore, Post, My plans and Profile. Explore uses coarse location
  when allowed and inside Bengaluru, otherwise the member's neighbourhood. Times are always
  shown in IST. Posting is four steps (what, when and where, who, cost) and the same
  screen edits a plan.

## Requests, matching, chat and push (milestone 4)

```
app ─POST /v1/plans/:id/requests─> API: hard filters, score, insert (plan row locked) ─push.send─> host
host ─POST /v1/requests/:id/accept─> API: one transaction: request accepted, seats_taken+1,
     status full?, version+1, chat created/joined, system message ─> plan.index, socket fan-out, push
app ═wss /v1/ws═> any API task ─Redis PUBLISH realtime:v1─> every task ─> members' open sockets
worker: push.send ─> SNS CreatePlatformEndpoint (once per token) ─> Publish ─> FCM / APNs
```

- **"I'm in".** One request per member per plan (a "no" is final and the plan leaves their
  feed). Hard filters are the feed's (audience, seats, not started, verified-only) plus
  blocks either way and seats per gender on group plans. Abuse and fairness: 5 requests a
  member a day, 20 waiting requests a plan, and a request expires after 24 h or at the
  plan's start. Reads treat a past-expiry request as expired at once; a worker sweeper
  stores the status every minute.
- **Scoring** ranks the host's stack with the plan doc's weights: distance from the
  member's neighbourhood (25), level and interest fit (20), verified badge (20), intent
  (15), new-member boost (10). "Past chemistry" joins with ratings. The score is computed
  once, at request time, and the top three reasons ("Also intermediate", "Lives nearby")
  are stored with it so the stack is a single indexed read.
- **Seats never oversell.** Accept, auto-accept, leave and cancel all lock the plan row
  (`select ... for update`) and update `plans.seats_taken`, `status` and `version` in the
  same transaction as the request; `plans_seats_check` backs this up. The e2e suite fires
  five accepts at a two-seat plan in parallel. The version bump drives the search index.
- **Auto-accept** (host option) admits verified members who pass every filter straight away.
- **Chat: one per plan**, created on the first accept, members are the host plus everyone
  accepted. Leaving the plan removes access. Messages live in Postgres (`messages`, identity
  id per message, index on `(chat_id, id)`), next to the membership they are authorised
  against. Sends are idempotent on a client-generated id, so a retry after a dropped
  connection never duplicates.
- **WebSocket on the API service, not API Gateway + Lambda + DynamoDB** (the plan doc's
  first sketch). At launch scale (hundreds of concurrent sockets, tens of messages a second
  at peak) the API tasks handle sockets easily behind the existing ALB, and keeping one
  codebase means chat uses the same auth, rate limits and data as everything else. Fan-out
  across tasks is one Redis pub/sub channel. Revisit when concurrent sockets pass ~50k or
  messages reach hundreds of millions: move sockets to API Gateway WebSocket and partition
  or move `messages`.
- **Socket protocol.** First frame is `{type:"auth", token}` (tokens stay out of ALB logs);
  then `send`/`ack`, `message`, `read`, `chat` (members changed) and `ping`. The server pings
  every 25 s (ALB idle timeout is 60 s) and drops dead sockets. Deploys close sockets with
  1012; the app reconnects with jittered backoff and fetches `GET messages?after=<last id>`.
  REST covers history and is the send fallback while the socket is down.
- **Presence** (for push decisions) is a Redis sorted set per member of live connection ids
  scored by expiry, refreshed by heartbeats, so a crashed task's sockets age out on their
  own. Chat pushes go only to members with no live socket.
- **Push through SNS**, not Expo's service: the app registers the native FCM/APNs token
  (`PUT /v1/me/devices`), the worker creates an SNS endpoint on first send and publishes an
  FCM v1 or APNs payload. Dead tokens (`EndpointDisabled`) are deleted. Push is best effort:
  enqueue failures never fail a request, and a failed device is logged rather than retried
  (a retry would re-notify every other device). Notifications: new request (host), accepted
  (member), chat message (offline members, collapsed per chat), plan cancelled (members).
  Declines are not pushed. Platform credentials live in SSM and are optional per OS.
- **Blocks** hide the two members from each other in the feed, plan details and requests,
  and decline waiting requests between them. Reports and the rest of safety are milestone 6.
- Deleting an account gives back seats on upcoming plans the member had joined.

## Deliberately deferred

- Liveness detection for selfies (Rekognition Face Liveness needs a native SDK component;
  today's check is a still-photo face match). A manual review queue for failed checks.
- Cognito threat protection (Plus tier) and WAF on the API.
- Changing phone number.
- Custom domain + ACM certificate: needs a chosen app name/domain.
- WAF, RDS Proxy: added in the milestones that need them.
- Place search with a maps provider (Google Places or Amazon Location) and a map pin
  picker; today a custom place is a name plus a neighbourhood.
- Push notifications for new plans in followed activities (needs "follow an activity").
- "For you" ranking of the Explore feed with the match score (the feed sorts by time or distance today).
- Premium tier lifting the 5 requests a day (milestone 5 with payments).
- Typing indicators, photos in chat, and deleting SNS endpoints when an account is deleted
  (they are disabled by the OS once the app is gone).
- Closing ended plans in the database (they read as completed); done with check-in in milestone 6.
- A dedicated least-privilege DB user for the app (currently the RDS master user).
