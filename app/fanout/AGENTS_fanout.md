# Fanout Bus Architecture

The fanout bus is a unified system for dispatching mesh radio events (decoded messages and raw packets) to external integrations. It replaces the previous scattered singleton MQTT publishers with a modular, configurable framework.

## Core Concepts

### FanoutModule (base.py)
Abstract base class that all integration modules implement:
- `start()` / `stop()` — lifecycle management
- `on_message(data)` — receive decoded messages
- `on_raw(data)` — receive raw packets
- `status` property — "connected" | "disconnected"

### FanoutManager (manager.py)
Singleton that owns all active modules and dispatches events:
- `load_from_db()` — startup: load enabled configs, instantiate modules
- `reload_config(id)` — CRUD: stop old, start new
- `remove_config(id)` — delete: stop and remove
- `broadcast_message(data)` — scope-check + dispatch `on_message`
- `broadcast_raw(data)` — scope-check + dispatch `on_raw`
- `stop_all()` — shutdown
- `get_statuses()` — health endpoint data

### Scope Matching
Each config has a `scope` JSON blob controlling what events reach it:
```json
{"messages": "all", "raw_packets": "all"}
{"messages": "none", "raw_packets": "all"}
{"messages": {"channels": ["key1"], "contacts": "all"}, "raw_packets": "none"}
```
Community MQTT always enforces `{"messages": "none", "raw_packets": "all"}`.

## Event Flow

```
Radio Event → packet_processor / event_handler
  → broadcast_event("message"|"raw_packet", data, realtime=True)
    → WebSocket broadcast (always)
    → FanoutManager.broadcast_message/raw (only if realtime=True)
      → scope check per module
      → module.on_message / on_raw
```

Setting `realtime=False` (used during historical decryption) skips fanout dispatch entirely.

## Current Module Types

### mqtt_private (mqtt_private.py)
Wraps `MqttPublisher` from `app/mqtt.py`. Config blob:
- `broker_host`, `broker_port`, `username`, `password`
- `use_tls`, `tls_insecure`, `topic_prefix`

### mqtt_community (mqtt_community.py)
Wraps `CommunityMqttPublisher` from `app/community_mqtt.py`. Config blob:
- `broker_host`, `broker_port`, `iata`, `email`
- Only publishes raw packets (on_message is a no-op)

## Adding a New Integration Type

1. Create `app/fanout/my_type.py` with a class extending `FanoutModule`
2. Register it in `manager.py` → `_register_module_types()`
3. Add validation in `app/routers/fanout.py` → `_VALID_TYPES` and validator function
4. Add frontend editor component in `SettingsFanoutSection.tsx`

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/fanout` | List all fanout configs |
| POST | `/api/fanout` | Create new config |
| PATCH | `/api/fanout/{id}` | Update config (triggers module reload) |
| DELETE | `/api/fanout/{id}` | Delete config (stops module) |

## Database

`fanout_configs` table (created in migration 36):
- `id` TEXT PRIMARY KEY
- `type`, `name`, `enabled`, `config` (JSON), `scope` (JSON)
- `sort_order`, `created_at`

Migration 36 also migrates existing `app_settings` MQTT columns into fanout rows.

## Key Files

- `app/fanout/base.py` — FanoutModule ABC
- `app/fanout/manager.py` — FanoutManager singleton
- `app/fanout/mqtt_private.py` — Private MQTT module
- `app/fanout/mqtt_community.py` — Community MQTT module
- `app/repository/fanout.py` — Database CRUD
- `app/routers/fanout.py` — REST API
- `app/websocket.py` — `broadcast_event()` dispatches to fanout
- `frontend/src/components/settings/SettingsFanoutSection.tsx` — UI
