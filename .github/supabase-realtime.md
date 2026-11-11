# Realtime · 2026-11-11 12:33 UTC

## Состояние сервисов
```json
[
  {
    "name": "auth",
    "healthy": true,
    "status": "ACTIVE_HEALTHY",
    "info": {
      "name": "GoTrue",
      "version": "v2.197.0",
      "description": "GoTrue is a user registration and authentication API"
    }
  },
  {
    "name": "db",
    "healthy": true,
    "status": "ACTIVE_HEALTHY"
  },
  {
    "name": "realtime",
    "healthy": true,
    "status": "ACTIVE_HEALTHY",
    "info": {
      "healthy": true,
      "db_connected": true,
      "replication_connected": true,
      "connected_cluster": 2,
      "node": "realtime@2600:1f18:67fc:ac07:858:e8aa:f1f:b428",
      "region": "us-east-1"
    }
  },
  {
    "name": "rest",
    "healthy": true,
    "status": "ACTIVE_HEALTHY",
    "info": {
      "db_schema": "public,graphql_public"
    }
  },
  {
    "name": "storage",
    "healthy": true,
    "status": "ACTIVE_HEALTHY"
  }
]
```

## Настройки Realtime (до)
```json
{
  "private_only": null,
  "connection_pool": 2,
  "postgres_changes_pool": null,
  "max_concurrent_users": 200,
  "max_events_per_second": 100,
  "max_bytes_per_second": 100000,
  "max_channels_per_client": 100,
  "max_joins_per_second": 100,
  "max_presence_events_per_second": 20,
  "max_payload_size_in_kb": 256,
  "suspend": false,
  "presence_enabled": false,
  "admin_suspended_at": null
}
```
