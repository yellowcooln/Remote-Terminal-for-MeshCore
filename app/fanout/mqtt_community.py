"""Fanout module wrapping the community MQTT publisher."""

from __future__ import annotations

import logging
import re
from typing import Any

from app.community_mqtt import CommunityMqttPublisher, _format_raw_packet
from app.fanout.base import FanoutModule
from app.models import AppSettings

logger = logging.getLogger(__name__)

_IATA_RE = re.compile(r"^[A-Z]{3}$")


def _config_to_settings(config: dict) -> AppSettings:
    """Map a fanout config blob to AppSettings for the CommunityMqttPublisher."""
    return AppSettings(
        community_mqtt_enabled=True,
        community_mqtt_broker_host=config.get("broker_host", "mqtt-us-v1.letsmesh.net"),
        community_mqtt_broker_port=config.get("broker_port", 443),
        community_mqtt_iata=config.get("iata", ""),
        community_mqtt_email=config.get("email", ""),
    )


class MqttCommunityModule(FanoutModule):
    """Wraps a CommunityMqttPublisher for community packet sharing."""

    def __init__(self, config_id: str, config: dict) -> None:
        super().__init__(config_id, config)
        self._publisher = CommunityMqttPublisher()

    async def start(self) -> None:
        settings = _config_to_settings(self.config)
        await self._publisher.start(settings)

    async def stop(self) -> None:
        await self._publisher.stop()

    async def on_message(self, data: dict) -> None:
        # Community MQTT only publishes raw packets, not decoded messages.
        pass

    async def on_raw(self, data: dict) -> None:
        if not self._publisher.connected or self._publisher._settings is None:
            return
        await _publish_community_packet(self._publisher, self.config, data)

    @property
    def status(self) -> str:
        if self._publisher._is_configured():
            return "connected" if self._publisher.connected else "disconnected"
        return "disconnected"


async def _publish_community_packet(
    publisher: CommunityMqttPublisher,
    config: dict,
    data: dict[str, Any],
) -> None:
    """Format and publish a raw packet to the community broker."""
    try:
        from app.keystore import get_public_key
        from app.radio import radio_manager

        public_key = get_public_key()
        if public_key is None:
            return

        pubkey_hex = public_key.hex().upper()

        device_name = ""
        if radio_manager.meshcore and radio_manager.meshcore.self_info:
            device_name = radio_manager.meshcore.self_info.get("name", "")

        packet = _format_raw_packet(data, device_name, pubkey_hex)
        iata = config.get("iata", "").upper().strip()
        if not _IATA_RE.fullmatch(iata):
            logger.debug("Community MQTT: skipping publish — no valid IATA code configured")
            return
        topic = f"meshcore/{iata}/{pubkey_hex}/packets"

        await publisher.publish(topic, packet)

    except Exception as e:
        logger.warning("Community MQTT broadcast error: %s", e)
