# Passwordless phone sign-in. The API is the only app client (confidential, with a
# secret): it proxies OTP start/verify so every SMS goes through its rate limits.
# Cognito sends the SMS through SNS / End User Messaging using the role below.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Not a secret: binds the role to this pool (confused-deputy protection with SourceAccount).
  sms_external_id = "${var.name}-cognito-sms"
}

data "aws_iam_policy_document" "cognito_sms_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["cognito-idp.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [local.sms_external_id]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "cognito_sms" {
  name               = "${var.name}-cognito-sms"
  assume_role_policy = data.aws_iam_policy_document.cognito_sms_assume.json
}

data "aws_iam_policy_document" "cognito_sms" {
  statement {
    actions   = ["sns:Publish"]
    resources = ["*"] # SMS publishing to phone numbers has no resource ARN.
  }
}

resource "aws_iam_role_policy" "cognito_sms" {
  role   = aws_iam_role.cognito_sms.id
  policy = data.aws_iam_policy_document.cognito_sms.json
}

resource "aws_cognito_user_pool" "this" {
  name                = "${var.name}-users"
  deletion_protection = var.deletion_protection ? "ACTIVE" : "INACTIVE"

  # Essentials tier is required for choice-based sign-in (USER_AUTH with SMS_OTP).
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["phone_number"]
  auto_verified_attributes = ["phone_number"]

  sign_in_policy {
    # Cognito always requires PASSWORD to be listed; members never get a password,
    # and the app client below does not allow password flows.
    allowed_first_auth_factors = ["PASSWORD", "SMS_OTP"]
  }

  username_configuration {
    case_sensitive = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_phone_number"
      priority = 1
    }
  }

  # India DLT: these texts must match the registered templates exactly.
  sms_verification_message   = "{####} is your ${var.app_name} code. Do not share it with anyone."
  sms_authentication_message = "{####} is your ${var.app_name} code. Do not share it with anyone."

  sms_configuration {
    external_id    = local.sms_external_id
    sns_caller_arn = aws_iam_role.cognito_sms.arn
    sns_region     = data.aws_region.current.region
  }

  schema {
    name                = "phone_number"
    attribute_data_type = "String"
    mutable             = true
    required            = true
    string_attribute_constraints {
      min_length = 8
      max_length = 16
    }
  }

  lifecycle {
    # Schema attributes cannot be changed after creation.
    ignore_changes = [schema]
  }
}

resource "aws_cognito_user_pool_client" "api" {
  name         = "${var.name}-api"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret               = true
  explicit_auth_flows           = ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  enable_token_revocation       = true
  auth_session_validity         = 5
  access_token_validity         = var.access_token_minutes
  id_token_validity             = var.access_token_minutes
  refresh_token_validity        = var.refresh_token_days
  prevent_user_existence_errors = "LEGACY" # the API needs UserNotFound to choose sign-up vs sign-in

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# The API reads the client secret from Secrets Manager at task start.
resource "aws_secretsmanager_secret" "client_secret" {
  name                    = "${var.name}/cognito-api-client-secret"
  recovery_window_in_days = var.deletion_protection ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "client_secret" {
  secret_id     = aws_secretsmanager_secret.client_secret.id
  secret_string = aws_cognito_user_pool_client.api.client_secret
}
