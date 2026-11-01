variable "name" {
  description = "Service name, e.g. activity-staging-api."
  type        = string
}

variable "cluster_arn" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "image" {
  description = "Initial container image. Later deploys come from CI and are ignored by Terraform."
  type        = string
}

variable "container_name" {
  type    = string
  default = "app"
}

variable "port" {
  description = "Container port behind the ALB. Null for services without HTTP (workers)."
  type        = number
  default     = null
}

variable "health_check_path" {
  type    = string
  default = "/health"
}

variable "listener_arn" {
  type    = string
  default = null
}

variable "listener_rule_priority" {
  type    = number
  default = 100
}

variable "cpu" {
  type    = number
  default = 512
}

variable "memory" {
  type    = number
  default = 1024
}

variable "cpu_architecture" {
  description = "ARM64 (Graviton) is ~20% cheaper; images must be built for linux/arm64."
  type        = string
  default     = "ARM64"
}

variable "min_count" {
  type    = number
  default = 2
}

variable "max_count" {
  type    = number
  default = 10
}

variable "cpu_target_percent" {
  type    = number
  default = 60
}

variable "environment" {
  description = "Plain environment variables."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Env var name => Secrets Manager ARN (optionally with :json-key:: suffix)."
  type        = map(string)
  default     = {}
}

variable "secret_arns" {
  description = "Secret ARNs the execution role may read."
  type        = list(string)
  default     = []
}

variable "secret_kms_key_arns" {
  type    = list(string)
  default = []
}

variable "task_policy_json" {
  description = "IAM policy for the application itself (least privilege per service)."
  type        = string
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "enable_execute_command" {
  description = "Allow `aws ecs execute-command` for debugging."
  type        = bool
  default     = false
}
