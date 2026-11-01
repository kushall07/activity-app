output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "user_pool_tier" {
  value = aws_cognito_user_pool.this.user_pool_tier
}

output "client_id" {
  value = aws_cognito_user_pool_client.api.id
}

output "client_auth_flows" {
  value = aws_cognito_user_pool_client.api.explicit_auth_flows
}

output "client_secret_arn" {
  value = aws_secretsmanager_secret.client_secret.arn
}

output "deletion_protection" {
  value = aws_cognito_user_pool.this.deletion_protection
}
