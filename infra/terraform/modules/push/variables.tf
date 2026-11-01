variable "name" {
  type = string
}

variable "fcm_service_account_parameter" {
  description = "SSM SecureString holding the Firebase service account JSON (FCM HTTP v1). Null: no Android push."
  type        = string
  default     = null
}

variable "apns_signing_key_parameter" {
  description = "SSM SecureString holding the APNs auth key (.p8 contents). Null: no iOS push."
  type        = string
  default     = null
}

variable "apns_key_id" {
  description = "Key ID of the APNs auth key."
  type        = string
  default     = null
}

variable "apns_team_id" {
  description = "Apple developer team ID."
  type        = string
  default     = null
}

variable "apns_bundle_id" {
  description = "iOS bundle identifier the pushes are for."
  type        = string
  default     = null
}

variable "apns_sandbox" {
  description = "true for development builds (APNS_SANDBOX), false for TestFlight and the App Store."
  type        = bool
  default     = false
}
