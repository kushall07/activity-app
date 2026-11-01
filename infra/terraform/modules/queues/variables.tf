variable "name" {
  type = string
}

variable "visibility_timeout_seconds" {
  description = "Must exceed the longest job runtime."
  type        = number
  default     = 60
}

variable "max_receive_count" {
  type    = number
  default = 5
}

variable "alarm_topic_arns" {
  type    = list(string)
  default = []
}
