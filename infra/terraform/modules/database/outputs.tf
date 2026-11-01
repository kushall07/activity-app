output "endpoint" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "database_name" {
  value = aws_db_instance.this.db_name
}

output "master_username" {
  value = aws_db_instance.this.username
}

output "master_user_secret_arn" {
  description = "Secrets Manager secret holding {username, password}."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "kms_key_arn" {
  value = aws_kms_key.this.arn
}

output "security_group_id" {
  value = aws_security_group.this.id
}

output "multi_az" {
  value = aws_db_instance.this.multi_az
}

output "deletion_protection" {
  value = aws_db_instance.this.deletion_protection
}
