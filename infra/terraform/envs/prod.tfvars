environment = "prod"

vpc_cidr            = "10.30.0.0/16"
single_nat_gateway  = false
interface_endpoints = ["ecr.api", "ecr.dkr", "logs", "sqs", "secretsmanager"]

# Sized for ~10k transactions/day with 10x headroom (see docs/architecture.md).
db_instance_class      = "db.t4g.medium"
db_multi_az            = true
db_deletion_protection = true

cache_node_type = "cache.t4g.small"
cache_replicas  = 1

api_min_count    = 2
api_max_count    = 10
worker_min_count = 2
worker_max_count = 6
