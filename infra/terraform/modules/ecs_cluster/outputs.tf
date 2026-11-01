output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "ecr_repository_urls" {
  value = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "app_security_group_id" {
  value = aws_security_group.app.id
}

output "alb_arn_suffix" {
  value = aws_lb.this.arn_suffix
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "listener_arn" {
  description = "Listener that app services attach routing rules to (HTTPS when available)."
  value       = local.has_certificate ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
}
