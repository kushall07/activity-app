# Offline plan tests with a mocked AWS provider: no credentials or AWS calls.
# Run: terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_region" {
    defaults = { region = "ap-south-1" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:ap-south-1:123456789012:secret:rds-db", kms_key_id = "", secret_status = "active" }]
    }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:ap-south-1:123456789012:cluster/activity" }
  }
}

run "prod_is_highly_available" {
  command = plan
  variables {
    environment            = "prod"
    vpc_cidr               = "10.30.0.0/16"
    single_nat_gateway     = false
    db_instance_class      = "db.t4g.medium"
    db_multi_az            = true
    db_deletion_protection = true
    cache_node_type        = "cache.t4g.small"
    cache_replicas         = 1
    api_min_count          = 2
    api_max_count          = 10
    worker_min_count       = 2
    worker_max_count       = 6
    search_instance_type   = "m7g.medium.search"
    search_instance_count  = 2
  }

  assert {
    condition     = length(module.network.private_subnet_ids) == 3
    error_message = "Prod must span three AZs."
  }
  assert {
    condition     = module.network.nat_gateway_count == 3
    error_message = "Prod needs one NAT gateway per AZ."
  }
  assert {
    condition     = module.database.multi_az && module.database.deletion_protection
    error_message = "Prod database must be Multi-AZ with deletion protection."
  }
  assert {
    condition     = module.push.android_app_arn == null && module.push.ios_app_arn == null
    error_message = "Push platform applications are only created once their credentials are configured."
  }
  assert {
    condition     = module.auth.deletion_protection == "ACTIVE"
    error_message = "Prod user pool must have deletion protection."
  }
  assert {
    condition     = module.auth.user_pool_tier == "ESSENTIALS"
    error_message = "SMS_OTP sign-in needs the Essentials tier."
  }
  assert {
    condition     = toset(module.auth.client_auth_flows) == toset(["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"])
    error_message = "The API client must only allow passwordless USER_AUTH and refresh."
  }
  assert {
    condition     = module.search.instance_count == 2 && module.search.zone_awareness_enabled
    error_message = "Prod search must run two data nodes across AZs."
  }
  assert {
    condition     = module.search.encrypted_at_rest && module.search.replicas == 1
    error_message = "Prod search must be encrypted with one replica per shard."
  }
}

run "staging_is_cost_optimised" {
  command = plan
  variables {
    environment            = "staging"
    vpc_cidr               = "10.20.0.0/16"
    single_nat_gateway     = true
    db_instance_class      = "db.t4g.small"
    db_multi_az            = false
    db_deletion_protection = false
    cache_node_type        = "cache.t4g.micro"
    cache_replicas         = 0
    api_min_count          = 1
    api_max_count          = 3
    worker_min_count       = 1
    worker_max_count       = 2
    search_instance_type   = "t3.small.search"
    search_instance_count  = 1
  }

  assert {
    condition     = module.network.nat_gateway_count == 1
    error_message = "Staging shares a single NAT gateway."
  }
  assert {
    condition     = !module.database.multi_az
    error_message = "Staging database is single-AZ to save cost."
  }
  assert {
    condition     = module.auth.deletion_protection == "INACTIVE"
    error_message = "Staging user pool can be torn down."
  }
  assert {
    condition     = module.search.instance_count == 1 && !module.search.zone_awareness_enabled && module.search.replicas == 0
    error_message = "Staging search is a single node with no replicas."
  }
}

run "rejects_unknown_environment" {
  command = plan
  variables {
    environment            = "dev"
    vpc_cidr               = "10.40.0.0/16"
    single_nat_gateway     = true
    db_instance_class      = "db.t4g.small"
    db_multi_az            = false
    db_deletion_protection = false
    cache_node_type        = "cache.t4g.micro"
    cache_replicas         = 0
    api_min_count          = 1
    api_max_count          = 1
    worker_min_count       = 1
    worker_max_count       = 1
    search_instance_type   = "t3.small.search"
    search_instance_count  = 1
  }
  expect_failures = [var.environment]
}
