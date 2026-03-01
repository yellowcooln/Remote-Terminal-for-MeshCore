"""MQTT publisher for forwarding mesh network events to an MQTT broker."""

from __future__ import annotations

import asyncio
import json
import logging
import ssl
from typing import Any

import aiomqtt

from app.models import AppSettings

logger = logging.getLogger(__name__)

# Reconnect backoff: start at 5s, cap at 30s
_BACKOFF_MIN = 5
_BACKOFF_MAX = 30


class MqttPublisher:
    """Manages an MQTT connection and publishes mesh network events."""

    def __init__(self) -> None:
        self._client: aiomqtt.Client | None = None
        self._task: asyncio.Task[None] | None = None
        self._settings: AppSettings | None = None
        self._settings_version: int = 0
        self._version_event: asyncio.Event = asyncio.Event()
        self.connected: bool = False

    async def start(self, settings: AppSettings) -> None:
        """Start the background connection loop."""
        self._settings = settings
        self._settings_version += 1
        self._version_event.set()
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._connection_loop())

    async def stop(self) -> None:
        """Cancel the background task and disconnect."""
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        self._client = None
        self.connected = False

    async def restart(self, settings: AppSettings) -> None:
        """Called when MQTT settings change — stop + start."""
        await self.stop()
        await self.start(settings)

    async def publish(self, topic: str, payload: dict[str, Any]) -> None:
        """Publish a JSON payload. Drops silently if not connected."""
        if self._client is None or not self.connected:
            return
        try:
            await self._client.publish(topic, json.dumps(payload))
        except Exception as e:
            logger.warning("MQTT publish failed on %s: %s", topic, e)
            self.connected = False
            # Wake the connection loop so it exits the wait and reconnects
            self._settings_version += 1
            self._version_event.set()

    def _mqtt_configured(self) -> bool:
        """Check if MQTT is configured (broker host is set)."""
        return bool(self._settings and self._settings.mqtt_broker_host)

    async def _connection_loop(self) -> None:
        """Background loop: connect, wait, reconnect on failure."""
        from app.websocket import broadcast_error, broadcast_success

        backoff = _BACKOFF_MIN

        while True:
            if not self._mqtt_configured():
                self.connected = False
                self._client = None
                # Wait until settings change (which might configure MQTT)
                self._version_event.clear()
                try:
                    await self._version_event.wait()
                except asyncio.CancelledError:
                    return
                continue

            settings = self._settings
            assert settings is not None  # guaranteed by _mqtt_configured()
            version_at_connect = self._settings_version

            try:
                tls_context = self._build_tls_context(settings)

                async with aiomqtt.Client(
                    hostname=settings.mqtt_broker_host,
                    port=settings.mqtt_broker_port,
                    username=settings.mqtt_username or None,
                    password=settings.mqtt_password or None,
                    tls_context=tls_context,
                ) as client:
                    self._client = client
                    self.connected = True
                    backoff = _BACKOFF_MIN

                    broadcast_success(
                        "MQTT connected",
                        f"{settings.mqtt_broker_host}:{settings.mqtt_broker_port}",
                    )
                    _broadcast_mqtt_health()

                    # Wait until cancelled or settings version changes.
                    # The 60s timeout is a housekeeping wake-up; actual connection
                    # liveness is handled by paho-mqtt's keepalive mechanism.
                    while self._settings_version == version_at_connect:
                        self._version_event.clear()
                        try:
                            await asyncio.wait_for(self._version_event.wait(), timeout=60)
                        except asyncio.TimeoutError:
                            continue

            except asyncio.CancelledError:
                self.connected = False
                self._client = None
                return

            except Exception as e:
                self.connected = False
                self._client = None

                broadcast_error(
                    "MQTT connection failure",
                    "Please correct the settings or disable.",
                )
                _broadcast_mqtt_health()
                logger.warning("MQTT connection error: %s (reconnecting in %ds)", e, backoff)

                try:
                    await asyncio.sleep(backoff)
                except asyncio.CancelledError:
                    return
                backoff = min(backoff * 2, _BACKOFF_MAX)

    @staticmethod
    def _build_tls_context(settings: AppSettings) -> ssl.SSLContext | None:
        """Build TLS context from settings, or None if TLS is disabled."""
        if not settings.mqtt_use_tls:
            return None
        ctx = ssl.create_default_context()
        if settings.mqtt_tls_insecure:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        return ctx


# Module-level singleton
mqtt_publisher = MqttPublisher()


def _broadcast_mqtt_health() -> None:
    """Push updated health (including mqtt_status) to all WS clients."""
    from app.radio import radio_manager
    from app.websocket import broadcast_health

    broadcast_health(radio_manager.is_connected, radio_manager.connection_info)


def mqtt_broadcast(event_type: str, data: dict[str, Any]) -> None:
    """Fire-and-forget MQTT publish, matching broadcast_event's pattern."""
    if event_type not in ("message", "raw_packet"):
        return
    if not mqtt_publisher.connected or mqtt_publisher._settings is None:
        return
    asyncio.create_task(_mqtt_maybe_publish(event_type, data))


async def _mqtt_maybe_publish(event_type: str, data: dict[str, Any]) -> None:
    """Check settings and build topic, then publish."""
    settings = mqtt_publisher._settings
    if settings is None:
        return

    try:
        if event_type == "message" and settings.mqtt_publish_messages:
            topic = _build_message_topic(settings.mqtt_topic_prefix, data)
            await mqtt_publisher.publish(topic, data)

        elif event_type == "raw_packet" and settings.mqtt_publish_raw_packets:
            topic = _build_raw_packet_topic(settings.mqtt_topic_prefix, data)
            await mqtt_publisher.publish(topic, data)

    except Exception as e:
        logger.warning("MQTT broadcast error: %s", e)


def _build_message_topic(prefix: str, data: dict[str, Any]) -> str:
    """Build MQTT topic for a decrypted message."""
    msg_type = data.get("type", "")
    conversation_key = data.get("conversation_key", "unknown")

    if msg_type == "PRIV":
        return f"{prefix}/dm:{conversation_key}"
    elif msg_type == "CHAN":
        return f"{prefix}/gm:{conversation_key}"
    return f"{prefix}/message:{conversation_key}"


def _build_raw_packet_topic(prefix: str, data: dict[str, Any]) -> str:
    """Build MQTT topic for a raw packet."""
    info = data.get("decrypted_info")
    if info and isinstance(info, dict):
        contact_key = info.get("contact_key")
        channel_key = info.get("channel_key")
        if contact_key:
            return f"{prefix}/raw/dm:{contact_key}"
        if channel_key:
            return f"{prefix}/raw/gm:{channel_key}"
    return f"{prefix}/raw/unrouted"
