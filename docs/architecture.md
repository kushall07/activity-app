# Architecture (milestone 1 foundation)

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

## Deliberately deferred

- Auth (Cognito phone OTP), profiles and photo upload API: milestone 2.
- Custom domain + ACM certificate: needs a chosen app name/domain.
- WAF, RDS Proxy, OpenSearch, WebSocket chat: added in the milestones that need them.
- A dedicated least-privilege DB user for the app (currently the RDS master user).
