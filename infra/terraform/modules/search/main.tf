# Amazon OpenSearch Service for the Explore feed (geo + filter queries over upcoming plans).
# Postgres stays the source of truth: workers index plans here, the API falls back to
# PostGIS if this domain is unavailable. VPC-only, IAM-authenticated, encrypted.

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  multi_az = var.instance_count > 1
}

resource "aws_security_group" "this" {
  name        = "${var.name}-search"
  description = "OpenSearch HTTPS from application tasks only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "from_app" {
  count                        = length(var.allowed_security_group_ids)
  security_group_id            = aws_security_group.this.id
  referenced_security_group_id = var.allowed_security_group_ids[count.index]
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  description                  = "HTTPS from app"
}

# VPC domains need this account-wide role. It may already exist (created by the
# console or another stack); set create_service_linked_role = false then.
resource "aws_iam_service_linked_role" "opensearch" {
  count            = var.create_service_linked_role ? 1 : 0
  aws_service_name = "opensearchservice.amazonaws.com"
}

resource "aws_opensearch_domain" "this" {
  domain_name    = var.name
  engine_version = var.engine_version

  cluster_config {
    instance_type          = var.instance_type
    instance_count         = var.instance_count
    zone_awareness_enabled = local.multi_az
    dynamic "zone_awareness_config" {
      for_each = local.multi_az ? [1] : []
      content {
        availability_zone_count = min(var.instance_count, 3)
      }
    }
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = var.volume_size_gb
  }

  vpc_options {
    subnet_ids         = slice(var.subnet_ids, 0, local.multi_az ? min(var.instance_count, 3) : 1)
    security_group_ids = [aws_security_group.this.id]
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-PFS-2023-10"
  }

  software_update_options {
    auto_software_update_enabled = true
  }

  off_peak_window_options {
    enabled = true
    off_peak_window {
      window_start_time {
        hours   = 20 # 01:30 IST
        minutes = 0
      }
    }
  }

  depends_on = [aws_iam_service_linked_role.opensearch]
}

# Only the API and worker task roles may call the domain (SigV4).
data "aws_iam_policy_document" "access" {
  statement {
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = var.allowed_role_arns
    }
    actions   = ["es:ESHttpGet", "es:ESHttpHead", "es:ESHttpPost", "es:ESHttpPut", "es:ESHttpDelete"]
    resources = ["arn:aws:es:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:domain/${var.name}/*"]
  }
}

resource "aws_opensearch_domain_policy" "this" {
  domain_name     = aws_opensearch_domain.this.domain_name
  access_policies = data.aws_iam_policy_document.access.json
}

resource "aws_cloudwatch_metric_alarm" "cluster_red" {
  alarm_name          = "${var.name}-search-red"
  alarm_description   = "OpenSearch has unassigned primary shards. The feed is serving from PostGIS."
  namespace           = "AWS/ES"
  metric_name         = "ClusterStatus.red"
  dimensions          = { DomainName = aws_opensearch_domain.this.domain_name, ClientId = data.aws_caller_identity.current.account_id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_topic_arns
}

resource "aws_cloudwatch_metric_alarm" "jvm_pressure" {
  alarm_name          = "${var.name}-search-jvm"
  alarm_description   = "OpenSearch JVM memory pressure is high: scale the instance type up."
  namespace           = "AWS/ES"
  metric_name         = "JVMMemoryPressure"
  dimensions          = { DomainName = aws_opensearch_domain.this.domain_name, ClientId = data.aws_caller_identity.current.account_id }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = var.alarm_topic_arns
}

resource "aws_cloudwatch_metric_alarm" "low_storage" {
  alarm_name          = "${var.name}-search-storage"
  alarm_description   = "OpenSearch free storage is low (MB)."
  namespace           = "AWS/ES"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DomainName = aws_opensearch_domain.this.domain_name, ClientId = data.aws_caller_identity.current.account_id }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.volume_size_gb * 1024 * 0.25
  comparison_operator = "LessThanOrEqualToThreshold"
  alarm_actions       = var.alarm_topic_arns
}
