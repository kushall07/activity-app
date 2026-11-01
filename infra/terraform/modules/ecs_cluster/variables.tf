variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "app_port" {
  type    = number
  default = 3000
}

variable "repositories" {
  description = "ECR repositories to create (one per deployable image)."
  type        = list(string)
  default     = ["api", "workers"]
}

variable "certificate_arn" {
  description = "ACM certificate for the API domain. Null until DNS is set up."
  type        = string
  default     = null
}

variable "deletion_protection" {
  type    = bool
  default = true
}
