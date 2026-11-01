variable "bucket_name" {
  description = "Globally unique bucket name."
  type        = string
}

variable "upload_allowed_origins" {
  description = "Origins allowed to upload via presigned POST. Native apps send no Origin; keep for a future web client."
  type        = list(string)
  default     = ["*"]
}

variable "force_destroy" {
  type    = bool
  default = false
}
