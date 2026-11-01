# Infrastructure (Terraform)

Written and tested offline; **not applied yet**.

```
bootstrap/   one-time per AWS account: remote-state bucket + GitHub OIDC deploy role
platform/    the whole environment (network, RDS, cache, SQS, S3/CloudFront, ECS, ALB, alarms)
modules/     network, database, cache, queues, storage, auth (Cognito), ecs_cluster, ecs_service
envs/        per-environment variables (staging.tfvars, prod.tfvars) and backend config
```

One `platform` configuration serves both environments, so staging and prod cannot drift
structurally; they differ only in `envs/*.tfvars`.

## Checks (run in CI, no AWS access needed)

```bash
cd infra/terraform
terraform fmt -check -recursive
cd platform && terraform init -backend=false && terraform validate && terraform test
```

`terraform test` plans both environments with a mocked AWS provider and asserts the HA
settings (3 AZs, NAT per AZ, Multi-AZ DB with deletion protection in prod) and the
Cognito setup (Essentials tier, passwordless-only client, deletion protection in prod).

## What is needed to deploy

1. An AWS account (ideally separate accounts for staging and prod under AWS Organizations)
   and an admin who can run the bootstrap once.
2. A domain for the API (for the ACM certificate). Until then the ALB serves HTTP only.
3. **SMS for OTP login (India).** TRAI rules require DLT registration before any A2P SMS
   is delivered: register the business entity, a sender ID and the OTP text (it must match
   `sms_authentication_message` in `modules/auth`, e.g. "{####} is your Activity code. Do not
   share it with anyone.") with a DLT operator, then add the sender ID and template in AWS End
   User Messaging SMS and request to leave the SMS sandbox. Until then, OTPs only reach phone
   numbers verified in the SMS sandbox. Expect this to take 1 to 3 weeks; start early.
4. Cognito Essentials tier (needed for passwordless SMS OTP) bills per monthly active user
   beyond the free tier, plus the SMS cost per OTP (roughly Rs 0.15 to 0.25 each in India).
5. **Push notifications (optional per OS; the stack applies without them).**
   - Android: a Firebase project with the app (`com.activityapp.mobile`) added; download its
     `google-services.json` into `apps/mobile/` and set `android.googleServicesFile` in
     `app.json`; create a service account key with the Firebase Cloud Messaging role and store
     the JSON: `aws ssm put-parameter --type SecureString --name /activity/staging/push/fcm --value file://key.json`.
   - iOS: an Apple Developer account; create an APNs auth key (.p8) and store it:
     `aws ssm put-parameter --type SecureString --name /activity/staging/push/apns-key --value file://AuthKey.p8`.
   - Then set `fcm_service_account_parameter`, `apns_signing_key_parameter`, `apns_key_id`,
     `apns_team_id` and `apns_bundle_id` in `envs/<env>.tfvars` (staging can set
     `apns_sandbox = true` for development builds) and apply.

## First apply

```bash
# 1. Bootstrap (admin credentials, local state)
cd infra/terraform/bootstrap
terraform init
terraform apply -var github_repository=kushall07/activity-app
# Put ACCOUNT_ID into envs/*.s3.tfbackend; save github_deploy_role_arn as a GitHub secret.

# 2. Platform
cd ../platform
terraform init -backend-config=../envs/staging.s3.tfbackend
terraform apply -var-file=../envs/staging.tfvars

# 3. Push the first images to the ECR repos in the outputs (tag: bootstrap), then run
#    migrations as a one-off task:
aws ecs run-task --cluster <cluster_name> --launch-type FARGATE \
  --task-definition activity-staging-api \
  --network-configuration "awsvpcConfiguration={subnets=[<private_subnet_ids>],securityGroups=[<app_security_group_id>]}" \
  --overrides '{"containerOverrides":[{"name":"app","command":["node","dist/database/migrate.js"]}]}'
```

## Rough monthly cost (ap-south-1, on-demand)

|              | staging                | prod                   |
| ------------ | ---------------------- | ---------------------- |
| NAT gateways | 1                      | 3                      |
| RDS          | db.t4g.small single-AZ | db.t4g.medium Multi-AZ |
| ElastiCache  | 1 x t4g.micro          | 2 x t4g.small          |
| Fargate      | 2 small tasks          | 4+ tasks               |
| Ballpark     | ~$150                  | ~$550 to $700          |

Check with the AWS Pricing Calculator before applying; NAT data and Fargate hours dominate.
