locals {
  name = "${var.project}-${var.environment}"
}

data "aws_caller_identity" "current" {}

resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.alarm_email != null ? 1 : 0
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

module "network" {
  source              = "../modules/network"
  name                = local.name
  region              = var.region
  cidr_block          = var.vpc_cidr
  single_nat_gateway  = var.single_nat_gateway
  interface_endpoints = var.interface_endpoints
}

module "cluster" {
  source              = "../modules/ecs_cluster"
  name                = local.name
  vpc_id              = module.network.vpc_id
  public_subnet_ids   = module.network.public_subnet_ids
  certificate_arn     = var.certificate_arn
  deletion_protection = var.environment == "prod"
}

module "database" {
  source                     = "../modules/database"
  name                       = local.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.database_subnet_ids
  allowed_security_group_ids = [module.cluster.app_security_group_id]
  instance_class             = var.db_instance_class
  multi_az                   = var.db_multi_az
  deletion_protection        = var.db_deletion_protection
  backup_retention_days      = var.environment == "prod" ? 14 : 3
}

module "cache" {
  source                     = "../modules/cache"
  name                       = local.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.database_subnet_ids
  allowed_security_group_ids = [module.cluster.app_security_group_id]
  node_type                  = var.cache_node_type
  replicas                   = var.cache_replicas
}

module "jobs_queue" {
  source           = "../modules/queues"
  name             = "${local.name}-jobs"
  alarm_topic_arns = [aws_sns_topic.alarms.arn]
}

module "auth" {
  source              = "../modules/auth"
  name                = local.name
  app_name            = var.app_display_name
  deletion_protection = var.environment == "prod"
}

module "storage" {
  source        = "../modules/storage"
  bucket_name   = "${local.name}-photos-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.environment != "prod"
}

module "search" {
  source                     = "../modules/search"
  name                       = local.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnet_ids
  allowed_security_group_ids = [module.cluster.app_security_group_id]
  allowed_role_arns          = [module.api.task_role_arn, module.workers.task_role_arn]
  instance_type              = var.search_instance_type
  instance_count             = var.search_instance_count
  volume_size_gb             = var.search_volume_gb
  create_service_linked_role = var.create_opensearch_service_linked_role
  alarm_topic_arns           = [aws_sns_topic.alarms.arn]
}

module "push" {
  source                        = "../modules/push"
  name                          = local.name
  fcm_service_account_parameter = var.fcm_service_account_parameter
  apns_signing_key_parameter    = var.apns_signing_key_parameter
  apns_key_id                   = var.apns_key_id
  apns_team_id                  = var.apns_team_id
  apns_bundle_id                = var.apns_bundle_id
  apns_sandbox                  = var.apns_sandbox
}

# --- Application services -------------------------------------------------

locals {
  db_secret = module.database.master_user_secret_arn

  common_env = {
    NODE_ENV     = "production"
    LOG_LEVEL    = "info"
    AWS_REGION   = var.region
    DB_HOST      = module.database.endpoint
    DB_PORT      = tostring(module.database.port)
    DB_NAME      = module.database.database_name
    DATABASE_SSL = "true"
    REDIS_URL    = module.cache.redis_url

    SQS_JOBS_QUEUE_URL = module.jobs_queue.queue_url
    PHOTOS_BUCKET      = module.storage.bucket_name

    SEARCH_PROVIDER = "opensearch"
    OPENSEARCH_URL  = module.search.endpoint_url
    OPENSEARCH_AUTH = "aws"
  }

  api_env = {
    PORT                   = "3000"
    AUTH_PROVIDER          = "cognito"
    COGNITO_USER_POOL_ID   = module.auth.user_pool_id
    COGNITO_CLIENT_ID      = module.auth.client_id
    PHOTOS_PUBLIC_BASE_URL = "https://${module.storage.cdn_domain_name}"
  }

  worker_env = merge(
    {
      MODERATION_PROVIDER    = "rekognition"
      SELFIE_MATCH_THRESHOLD = tostring(var.selfie_match_threshold)
      OPENSEARCH_REPLICAS    = tostring(module.search.replicas)
      PUSH_PROVIDER          = "sns"
      SNS_APNS_PLATFORM      = module.push.apns_platform
    },
    # Each OS's push is optional until its credentials are in SSM.
    { for k, v in {
      SNS_ANDROID_APP_ARN = module.push.android_app_arn
      SNS_IOS_APP_ARN     = module.push.ios_app_arn
    } : k => v if v != null },
  )

  search_domain_arn = "arn:aws:es:${var.region}:${data.aws_caller_identity.current.account_id}:domain/${local.name}/*"
  search_actions    = ["es:ESHttpGet", "es:ESHttpHead", "es:ESHttpPost", "es:ESHttpPut", "es:ESHttpDelete"]

  # RDS-managed secret is JSON {username, password}; ECS extracts the keys.
  db_secrets = {
    DB_USER     = "${local.db_secret}:username::"
    DB_PASSWORD = "${local.db_secret}:password::"
  }
}

data "aws_iam_policy_document" "api_task" {
  statement {
    sid       = "EnqueueJobs"
    actions   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
    resources = [module.jobs_queue.queue_arn]
  }
  statement {
    # Presigned POSTs are signed with the task role, so it needs PutObject itself.
    sid     = "PhotoUploads"
    actions = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = [
      "${module.storage.bucket_arn}/incoming/*",
      "${module.storage.bucket_arn}/verification/*",
      "${module.storage.bucket_arn}/public/*",
    ]
  }
  statement {
    sid       = "CheckUploads"
    actions   = ["s3:ListBucket"] # lets HeadObject return 404 instead of 403 for missing uploads
    resources = [module.storage.bucket_arn]
  }
  statement {
    sid       = "ManageMembers"
    actions   = ["cognito-idp:AdminDeleteUser"]
    resources = [module.auth.user_pool_arn]
  }
  statement {
    sid       = "QueryPlans"
    actions   = local.search_actions
    resources = [local.search_domain_arn]
  }
}

module "api" {
  source                 = "../modules/ecs_service"
  name                   = "${local.name}-api"
  cluster_arn            = module.cluster.cluster_arn
  vpc_id                 = module.network.vpc_id
  subnet_ids             = module.network.private_subnet_ids
  security_group_ids     = [module.cluster.app_security_group_id]
  image                  = "${module.cluster.ecr_repository_urls["api"]}:${var.image_tag}"
  port                   = 3000
  health_check_path      = "/health"
  listener_arn           = module.cluster.listener_arn
  min_count              = var.api_min_count
  max_count              = var.api_max_count
  environment            = merge(local.common_env, local.api_env)
  secrets                = merge(local.db_secrets, { COGNITO_CLIENT_SECRET = module.auth.client_secret_arn })
  secret_arns            = [local.db_secret, module.auth.client_secret_arn]
  task_policy_json       = data.aws_iam_policy_document.api_task.json
  enable_execute_command = var.environment != "prod"
}

data "aws_iam_policy_document" "worker_task" {
  statement {
    sid = "ConsumeJobs"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes",
      "sqs:SendMessage",
    ]
    resources = [module.jobs_queue.queue_arn]
  }
  statement {
    sid       = "ProcessPhotos"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${module.storage.bucket_arn}/*"]
  }
  statement {
    sid       = "PurgeDeletedMembers"
    actions   = ["s3:ListBucket"]
    resources = [module.storage.bucket_arn]
  }
  statement {
    # Rekognition image APIs do not support resource-level permissions.
    sid       = "ModerateAndVerify"
    actions   = ["rekognition:DetectModerationLabels", "rekognition:DetectFaces", "rekognition:CompareFaces"]
    resources = ["*"]
  }
  statement {
    sid       = "IndexPlans"
    actions   = local.search_actions
    resources = [local.search_domain_arn]
  }
  statement {
    sid       = "RegisterPushDevices"
    actions   = ["sns:CreatePlatformEndpoint"]
    resources = ["arn:aws:sns:${var.region}:${data.aws_caller_identity.current.account_id}:app/*/${local.name}-*"]
  }
  statement {
    sid = "SendPush"
    actions = [
      "sns:Publish",
      "sns:GetEndpointAttributes",
      "sns:SetEndpointAttributes",
      "sns:DeleteEndpoint",
    ]
    resources = ["arn:aws:sns:${var.region}:${data.aws_caller_identity.current.account_id}:endpoint/*/${local.name}-*/*"]
  }
}

module "workers" {
  source                 = "../modules/ecs_service"
  name                   = "${local.name}-workers"
  cluster_arn            = module.cluster.cluster_arn
  vpc_id                 = module.network.vpc_id
  subnet_ids             = module.network.private_subnet_ids
  security_group_ids     = [module.cluster.app_security_group_id]
  image                  = "${module.cluster.ecr_repository_urls["workers"]}:${var.image_tag}"
  port                   = null
  cpu                    = 256
  memory                 = 512
  min_count              = var.worker_min_count
  max_count              = var.worker_max_count
  environment            = merge(local.common_env, local.worker_env)
  secrets                = local.db_secrets
  secret_arns            = [local.db_secret]
  task_policy_json       = data.aws_iam_policy_document.worker_task.json
  enable_execute_command = var.environment != "prod"
}

# --- Alarms -----------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name}-api-5xx"
  alarm_description   = "API is returning server errors."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = module.cluster.alb_arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 25
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${local.name}-db-cpu"
  alarm_description   = "Database CPU sustained above 75%: time to scale up or optimise queries."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = local.name }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 75
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}
