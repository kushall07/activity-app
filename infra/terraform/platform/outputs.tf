output "api_url" {
  description = "Point the mobile app's EXPO_PUBLIC_API_URL here (or at the custom domain CNAME'd to it)."
  value       = "${var.certificate_arn != null ? "https" : "http"}://${module.cluster.alb_dns_name}"
}

output "ecr_repository_urls" {
  value = module.cluster.ecr_repository_urls
}

output "cluster_name" {
  value = module.cluster.cluster_name
}

output "api_service_name" {
  value = module.api.service_name
}

output "workers_service_name" {
  value = module.workers.service_name
}

output "database_endpoint" {
  value = module.database.endpoint
}

output "database_secret_arn" {
  value = module.database.master_user_secret_arn
}

output "redis_url" {
  value = module.cache.redis_url
}

output "jobs_queue_url" {
  value = module.jobs_queue.queue_url
}

output "photos_bucket" {
  value = module.storage.bucket_name
}

output "photos_cdn_domain" {
  value = module.storage.cdn_domain_name
}

output "private_subnet_ids" {
  description = "For running the one-off migration task."
  value       = module.network.private_subnet_ids
}

output "app_security_group_id" {
  value = module.cluster.app_security_group_id
}

output "cognito_user_pool_id" {
  value = module.auth.user_pool_id
}

output "cognito_client_id" {
  value = module.auth.client_id
}
