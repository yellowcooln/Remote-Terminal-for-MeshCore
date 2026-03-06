"""REST API for fanout config CRUD."""

import logging
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.repository.fanout import FanoutConfigRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/fanout", tags=["fanout"])

# Valid types in Phase 1
_VALID_TYPES = {"mqtt_private", "mqtt_community"}

_IATA_RE = re.compile(r"^[A-Z]{3}$")


class FanoutConfigCreate(BaseModel):
    type: str = Field(description="Integration type: 'mqtt_private' or 'mqtt_community'")
    name: str = Field(min_length=1, description="User-assigned label")
    config: dict = Field(default_factory=dict, description="Type-specific config blob")
    scope: dict = Field(default_factory=dict, description="Scope controls")
    enabled: bool = Field(default=True, description="Whether enabled on creation")


class FanoutConfigUpdate(BaseModel):
    name: str | None = Field(default=None, description="Updated label")
    config: dict | None = Field(default=None, description="Updated config blob")
    scope: dict | None = Field(default=None, description="Updated scope controls")
    enabled: bool | None = Field(default=None, description="Enable/disable toggle")


def _validate_mqtt_private_config(config: dict) -> None:
    """Validate mqtt_private config blob."""
    if not config.get("broker_host"):
        raise HTTPException(status_code=400, detail="broker_host is required for mqtt_private")
    port = config.get("broker_port", 1883)
    if not isinstance(port, int) or port < 1 or port > 65535:
        raise HTTPException(status_code=400, detail="broker_port must be between 1 and 65535")


def _validate_mqtt_community_config(config: dict) -> None:
    """Validate mqtt_community config blob."""
    iata = config.get("iata", "")
    if iata and not _IATA_RE.fullmatch(iata.upper().strip()):
        raise HTTPException(
            status_code=400,
            detail="IATA code must be exactly 3 uppercase alphabetic characters",
        )


def _enforce_scope(config_type: str, scope: dict) -> dict:
    """Enforce type-specific scope constraints. Returns normalized scope."""
    if config_type == "mqtt_community":
        # Community MQTT always: no messages, all raw packets
        return {"messages": "none", "raw_packets": "all"}
    # For mqtt_private, validate scope values
    messages = scope.get("messages", "all")
    if messages not in ("all", "none") and not isinstance(messages, dict):
        messages = "all"
    raw_packets = scope.get("raw_packets", "all")
    if raw_packets not in ("all", "none"):
        raw_packets = "all"
    return {"messages": messages, "raw_packets": raw_packets}


@router.get("")
async def list_fanout_configs() -> list[dict]:
    """List all fanout configs."""
    return await FanoutConfigRepository.get_all()


@router.post("")
async def create_fanout_config(body: FanoutConfigCreate) -> dict:
    """Create a new fanout config."""
    if body.type not in _VALID_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid type '{body.type}'. Must be one of: {', '.join(sorted(_VALID_TYPES))}",
        )

    # Only validate config when creating as enabled — disabled configs
    # are drafts the user hasn't finished configuring yet.
    if body.enabled:
        if body.type == "mqtt_private":
            _validate_mqtt_private_config(body.config)
        elif body.type == "mqtt_community":
            _validate_mqtt_community_config(body.config)

    scope = _enforce_scope(body.type, body.scope)

    cfg = await FanoutConfigRepository.create(
        config_type=body.type,
        name=body.name,
        config=body.config,
        scope=scope,
        enabled=body.enabled,
    )

    # Start the module if enabled
    if cfg["enabled"]:
        from app.fanout.manager import fanout_manager

        await fanout_manager.reload_config(cfg["id"])

    logger.info("Created fanout config %s (type=%s, name=%s)", cfg["id"], body.type, body.name)
    return cfg


@router.patch("/{config_id}")
async def update_fanout_config(config_id: str, body: FanoutConfigUpdate) -> dict:
    """Update a fanout config. Triggers module reload."""
    existing = await FanoutConfigRepository.get(config_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Fanout config not found")

    kwargs = {}
    if body.name is not None:
        kwargs["name"] = body.name
    if body.enabled is not None:
        kwargs["enabled"] = body.enabled
    if body.config is not None:
        kwargs["config"] = body.config
    if body.scope is not None:
        kwargs["scope"] = _enforce_scope(existing["type"], body.scope)

    # Validate config when the result will be enabled
    will_be_enabled = body.enabled if body.enabled is not None else existing["enabled"]
    if will_be_enabled:
        config_to_validate = body.config if body.config is not None else existing["config"]
        if existing["type"] == "mqtt_private":
            _validate_mqtt_private_config(config_to_validate)
        elif existing["type"] == "mqtt_community":
            _validate_mqtt_community_config(config_to_validate)

    updated = await FanoutConfigRepository.update(config_id, **kwargs)
    if updated is None:
        raise HTTPException(status_code=404, detail="Fanout config not found")

    # Reload the module to pick up changes
    from app.fanout.manager import fanout_manager

    await fanout_manager.reload_config(config_id)

    logger.info("Updated fanout config %s", config_id)
    return updated


@router.delete("/{config_id}")
async def delete_fanout_config(config_id: str) -> dict:
    """Delete a fanout config."""
    existing = await FanoutConfigRepository.get(config_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Fanout config not found")

    # Stop the module first
    from app.fanout.manager import fanout_manager

    await fanout_manager.remove_config(config_id)
    await FanoutConfigRepository.delete(config_id)

    logger.info("Deleted fanout config %s", config_id)
    return {"deleted": True}
