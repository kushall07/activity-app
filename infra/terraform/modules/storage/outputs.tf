output "bucket_name" {
  value = aws_s3_bucket.photos.id
}

output "bucket_arn" {
  value = aws_s3_bucket.photos.arn
}

output "cdn_domain_name" {
  value = aws_cloudfront_distribution.photos.domain_name
}

output "cdn_distribution_arn" {
  value = aws_cloudfront_distribution.photos.arn
}
