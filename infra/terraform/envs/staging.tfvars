environment = "staging"

vpc_cidr           = "10.20.0.0/16"
single_nat_gateway = true

db_instance_class      = "db.t4g.small"
db_multi_az            = false
db_deletion_protection = false

cache_node_type = "cache.t4g.micro"
cache_replicas  = 0

api_min_count    = 1
api_max_count    = 3
worker_min_count = 1
worker_max_count = 2
