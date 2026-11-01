variable "name" {
  description = "Name prefix, e.g. activity-staging."
  type        = string
}

variable "region" {
  description = "AWS region (used for VPC endpoint service names)."
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR. Must be a /16."
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "Number of AZs to span (ap-south-1 has 3)."
  type        = number
  default     = 3
}

variable "single_nat_gateway" {
  description = "One shared NAT (cheaper, staging) vs one per AZ (HA, production)."
  type        = bool
  default     = false
}

variable "interface_endpoints" {
  description = "Interface VPC endpoints to create, e.g. [\"ecr.api\", \"ecr.dkr\", \"logs\", \"sqs\", \"secretsmanager\"]."
  type        = list(string)
  default     = []
}
