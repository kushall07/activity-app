variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "allowed_security_group_ids" {
  type = list(string)
}

variable "engine_version" {
  type    = string
  default = "8.0"
}

variable "node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "replicas" {
  description = "Read replicas; >= 1 enables Multi-AZ automatic failover."
  type        = number
  default     = 1
}

variable "snapshot_retention_days" {
  type    = number
  default = 3
}
