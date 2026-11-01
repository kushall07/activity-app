variable "name" {
  description = "Resource name prefix, e.g. activity-prod."
  type        = string
}

variable "app_name" {
  description = "Product name shown in the OTP SMS."
  type        = string
  default     = "Activity"
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "access_token_minutes" {
  type    = number
  default = 60
}

variable "refresh_token_days" {
  description = "How long a member stays signed in without a new OTP."
  type        = number
  default     = 90
}

variable "sms_sender_id" {
  description = <<-EOT
    DLT-registered sender ID for India (TRAI rules require it for A2P SMS). Null until the
    sender ID and the OTP templates below are registered with a DLT operator and in
    AWS End User Messaging SMS.
  EOT
  type        = string
  default     = null
}
