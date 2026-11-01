output "android_app_arn" {
  value = local.android_enabled ? aws_sns_platform_application.android[0].arn : null
}

output "ios_app_arn" {
  value = local.ios_enabled ? aws_sns_platform_application.ios[0].arn : null
}

output "apns_platform" {
  value = var.apns_sandbox ? "APNS_SANDBOX" : "APNS"
}
