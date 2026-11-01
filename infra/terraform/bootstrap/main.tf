# One-time, per AWS account. Run with local state by an admin:
#   terraform init && terraform apply -var github_repository=kushall07/activity-app
# Creates the remote-state bucket and an IAM role GitHub Actions assumes via
# OIDC (no long-lived AWS keys in GitHub).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "activity", ManagedBy = "terraform", Stack = "bootstrap" }
  }
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "github_repository" {
  description = "owner/repo allowed to assume the deploy role."
  type        = string
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "state" {
  bucket = "activity-tfstate-${data.aws_caller_identity.current.account_id}"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Only the main branch and the protected deployment environments may deploy.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repository}:ref:refs/heads/main",
        "repo:${var.github_repository}:environment:staging",
        "repo:${var.github_repository}:environment:prod",
      ]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "activity-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

# Broad because it applies Terraform. Tighten to a permissions boundary once the
# resource set stabilises.
resource "aws_iam_role_policy_attachment" "github_deploy" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

output "state_bucket" {
  value = aws_s3_bucket.state.id
}

output "github_deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN secret in GitHub."
  value       = aws_iam_role.github_deploy.arn
}
