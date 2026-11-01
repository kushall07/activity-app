variable "project" {
  type    = string
  default = "activity"
}

variable "environment" {
  description = "staging or prod."
  type        = string
  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be staging or prod."
  }
}

variable "region" {
  description = "Mumbai: lowest latency for Bengaluru users and keeps personal data in India (DPDP Act)."
  type        = string
  default     = "ap-south-1"
}

variable "vpc_cidr" {
  type = string
}

variable "single_nat_gateway" {
  type = bool
}

variable "interface_endpoints" {
  type    = list(string)
  default = []
}

variable "db_instance_class" {
  type = string
}

variable "db_multi_az" {
  type = bool
}

variable "db_deletion_protection" {
  type = bool
}

variable "cache_node_type" {
  type = string
}

variable "cache_replicas" {
  type = number
}

variable "api_min_count" {
  type = number
}

variable "api_max_count" {
  type = number
}

variable "worker_min_count" {
  type = number
}

variable "worker_max_count" {
  type = number
}

variable "certificate_arn" {
  description = "ACM certificate for the API hostname; null until a domain is chosen."
  type        = string
  default     = null
}

variable "image_tag" {
  description = "Bootstrap image tag for the first apply. CI deploys new tags afterwards."
  type        = string
  default     = "bootstrap"
}

variable "alarm_email" {
  description = "Email subscribed to operational alarms (confirm the subscription after apply)."
  type        = string
  default     = null
}

variable "app_display_name" {
  description = "Product name used in OTP texts. Must match the DLT-registered SMS template."
  type        = string
  default     = "Activity"
}

variable "selfie_match_threshold" {
  description = "Rekognition face similarity (0-100) a selfie needs to earn the verified badge."
  type        = number
  default     = 95
  validation {
    condition     = var.selfie_match_threshold >= 80 && var.selfie_match_threshold <= 100
    error_message = "selfie_match_threshold must be between 80 and 100."
  }
}
