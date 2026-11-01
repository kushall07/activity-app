variable "name" {
  description = "Domain name (3-28 lowercase characters)."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Private subnets, one per AZ; the first N are used for N-AZ domains."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  type = list(string)
}

variable "allowed_role_arns" {
  description = "IAM roles allowed to query and index (API and worker task roles)."
  type        = list(string)
}

variable "engine_version" {
  type    = string
  default = "OpenSearch_2.19"
}

variable "instance_type" {
  type    = string
  default = "m7g.medium.search"
}

variable "instance_count" {
  description = "Data nodes. 2+ spreads them across AZs with a replica of each shard."
  type        = number
  default     = 2
}

variable "volume_size_gb" {
  type    = number
  default = 20
}

variable "create_service_linked_role" {
  type    = bool
  default = true
}

variable "alarm_topic_arns" {
  type    = list(string)
  default = []
}
