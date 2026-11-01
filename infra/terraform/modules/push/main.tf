# Mobile push through Amazon SNS: one platform application per OS. The worker
# creates an endpoint per device token on first send.
#
# Credentials never go in tfvars or state-visible variables: put them in SSM
# Parameter Store as SecureStrings first (see infra/terraform/README.md), then
# point these variables at the parameter names. Each OS is optional so the
# stack applies before the Firebase project and Apple key exist.

locals {
  android_enabled = var.fcm_service_account_parameter != null
  ios_enabled     = var.apns_signing_key_parameter != null
}

data "aws_ssm_parameter" "fcm" {
  count           = local.android_enabled ? 1 : 0
  name            = var.fcm_service_account_parameter
  with_decryption = true
}

data "aws_ssm_parameter" "apns" {
  count           = local.ios_enabled ? 1 : 0
  name            = var.apns_signing_key_parameter
  with_decryption = true
}

resource "aws_sns_platform_application" "android" {
  count               = local.android_enabled ? 1 : 0
  name                = "${var.name}-android"
  platform            = "GCM"
  platform_credential = data.aws_ssm_parameter.fcm[0].value
}

resource "aws_sns_platform_application" "ios" {
  count                    = local.ios_enabled ? 1 : 0
  name                     = "${var.name}-ios"
  platform                 = var.apns_sandbox ? "APNS_SANDBOX" : "APNS"
  platform_credential      = data.aws_ssm_parameter.apns[0].value
  platform_principal       = var.apns_key_id
  apple_platform_team_id   = var.apns_team_id
  apple_platform_bundle_id = var.apns_bundle_id

  lifecycle {
    precondition {
      condition     = var.apns_key_id != null && var.apns_team_id != null && var.apns_bundle_id != null
      error_message = "iOS push needs apns_key_id, apns_team_id and apns_bundle_id."
    }
  }
}
