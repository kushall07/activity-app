variable "bucket_name" {
  description = "Globally unique bucket name."
  type        = string
}

variable "upload_allowed_origins" {
  description = "Origins allowed to PUT via presigned URLs. Native apps send no Origin; keep for a future web client."
  type        = list(string)
  default     = ["*"]
}

variable "force_destroy" {
  type    = bool
  default = false
}
