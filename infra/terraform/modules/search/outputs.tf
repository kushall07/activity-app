output "endpoint_url" {
  description = "HTTPS endpoint for the API and workers."
  value       = "https://${aws_opensearch_domain.this.endpoint}"
}

output "domain_arn" {
  value = aws_opensearch_domain.this.arn
}

output "instance_count" {
  value = aws_opensearch_domain.this.cluster_config[0].instance_count
}

output "zone_awareness_enabled" {
  value = aws_opensearch_domain.this.cluster_config[0].zone_awareness_enabled
}

output "encrypted_at_rest" {
  value = aws_opensearch_domain.this.encrypt_at_rest[0].enabled
}

output "replicas" {
  description = "Index replicas the workers should create: one per extra node, capped at 1."
  value       = min(var.instance_count - 1, 1)
}
