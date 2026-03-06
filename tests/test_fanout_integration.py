"""Integration tests: real MQTT capture broker + real fanout modules.

Spins up a minimal in-process MQTT 3.1.1 broker on a random port, creates
fanout configs in an in-memory DB, starts real MqttPrivateModule instances
via the FanoutManager, and verifies that PUBLISH packets arrive (or don't)
based on enabled/disabled state and scope settings.
"""

import asyncio
import json
import struct

import pytest

import app.repository.fanout as fanout_mod
from app.database import Database
from app.fanout.manager import FanoutManager
from app.repository.fanout import FanoutConfigRepository

# ---------------------------------------------------------------------------
# Minimal async MQTT 3.1.1 capture broker
# ---------------------------------------------------------------------------


class MqttCaptureBroker:
    """Tiny TCP server that speaks just enough MQTT to capture PUBLISH packets."""

    def __init__(self):
        self.published: list[tuple[str, dict]] = []
        self._server: asyncio.Server | None = None
        self.port: int = 0

    async def start(self) -> int:
        self._server = await asyncio.start_server(self._handle_client, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]
        return self.port

    async def stop(self):
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def wait_for(self, count: int, timeout: float = 5.0) -> list[tuple[str, dict]]:
        """Block until *count* messages captured, or timeout."""
        deadline = asyncio.get_event_loop().time() + timeout
        while len(self.published) < count:
            if asyncio.get_event_loop().time() >= deadline:
                break
            await asyncio.sleep(0.02)
        return list(self.published)

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            while True:
                first = await reader.readexactly(1)
                pkt_type = (first[0] & 0xF0) >> 4
                rem_len = await self._read_varlen(reader)
                payload = await reader.readexactly(rem_len) if rem_len else b""

                if pkt_type == 1:  # CONNECT -> CONNACK
                    writer.write(b"\x20\x02\x00\x00")
                    await writer.drain()
                elif pkt_type == 3:  # PUBLISH (QoS 0)
                    topic_len = struct.unpack("!H", payload[:2])[0]
                    topic = payload[2 : 2 + topic_len].decode()
                    body = payload[2 + topic_len :]
                    try:
                        data = json.loads(body)
                    except Exception:
                        data = {}
                    self.published.append((topic, data))
                elif pkt_type == 12:  # PINGREQ -> PINGRESP
                    writer.write(b"\xd0\x00")
                    await writer.drain()
                elif pkt_type == 14:  # DISCONNECT
                    break
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass
        finally:
            writer.close()

    @staticmethod
    async def _read_varlen(reader: asyncio.StreamReader) -> int:
        value, shift = 0, 0
        while True:
            b = (await reader.readexactly(1))[0]
            value |= (b & 0x7F) << shift
            if not (b & 0x80):
                return value
            shift += 7


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def mqtt_broker():
    broker = MqttCaptureBroker()
    await broker.start()
    yield broker
    await broker.stop()


@pytest.fixture
async def integration_db():
    """In-memory DB with fanout_configs, wired into the repository module.

    Database.connect() runs all migrations which create the fanout_configs
    table, so no manual DDL is needed here.
    """
    test_db = Database(":memory:")
    await test_db.connect()

    original_db = fanout_mod.db
    fanout_mod.db = test_db
    try:
        yield test_db
    finally:
        fanout_mod.db = original_db
        await test_db.disconnect()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _wait_connected(manager: FanoutManager, config_id: str, timeout: float = 5.0):
    """Poll until the module reports 'connected'."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        entry = manager._modules.get(config_id)
        if entry and entry[0].status == "connected":
            return
        await asyncio.sleep(0.05)
    raise TimeoutError(f"Module {config_id} did not connect within {timeout}s")


def _private_config(port: int, prefix: str) -> dict:
    return {"broker_host": "127.0.0.1", "broker_port": port, "topic_prefix": prefix}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestFanoutMqttIntegration:
    """End-to-end: real capture broker <-> real fanout modules."""

    @pytest.mark.asyncio
    async def test_both_enabled_both_receive(self, mqtt_broker, integration_db):
        """Two enabled integrations with different prefixes both receive messages."""
        from unittest.mock import patch

        cfg_a = await FanoutConfigRepository.create(
            config_type="mqtt_private",
            name="Alpha",
            config=_private_config(mqtt_broker.port, "alpha"),
            scope={"messages": "all", "raw_packets": "all"},
            enabled=True,
        )
        cfg_b = await FanoutConfigRepository.create(
            config_type="mqtt_private",
            name="Beta",
            config=_private_config(mqtt_broker.port, "beta"),
            scope={"messages": "all", "raw_packets": "all"},
            enabled=True,
        )

        manager = FanoutManager()
        with (
            patch("app.mqtt_base._broadcast_health"),
            patch("app.websocket.broadcast_success"),
            patch("app.websocket.broadcast_error"),
            patch("app.websocket.broadcast_health"),
        ):
            try:
                await manager.load_from_db()
                await _wait_connected(manager, cfg_a["id"])
                await _wait_connected(manager, cfg_b["id"])

                await manager.broadcast_message(
                    {"type": "PRIV", "conversation_key": "pk1", "text": "hello"}
                )

                messages = await mqtt_broker.wait_for(2)
            finally:
                await manager.stop_all()

        topics = {m[0] for m in messages}
        assert "alpha/dm:pk1" in topics
        assert "beta/dm:pk1" in topics

    @pytest.mark.asyncio
    async def test_one_disabled_only_enabled_receives(self, mqtt_broker, integration_db):
        """Disabled integration must not publish any messages."""
        from unittest.mock import patch

        cfg_on = await FanoutConfigRepository.create(
            config_type="mqtt_private",
            name="Enabled",
            config=_private_config(mqtt_broker.port, "on"),
            scope={"messages": "all", "raw_packets": "all"},
            enabled=True,
        )
        await FanoutConfigRepository.create(
            config_type="mqtt_private",
            name="Disabled",
            config=_private_config(mqtt_broker.port, "off"),
            scope={"messages": "all", "raw_packets": "all"},
            enabled=False,
        )

        manager = FanoutManager()
        with (
            patch("app.mqtt_base._broadcast_health"),
            patch("app.websocket.broadcast_success"),
            patch("app.websocket.broadcast_error"),
            patch("app.websocket.broadcast_health"),
        ):
            try:
                await manager.load_from_db()
                await _wait_connected(manager, cfg_on["id"])

                # Only 1 module should be loaded
                assert len(manager._modules) == 1

                await manager.broadcast_message(
                    {"type": "PRIV", "conversation_key": "pk1", "text": "hello"}
                )

                await mqtt_broker.wait_for(1)
                await asyncio.sleep(0.2)  # extra time to catch stray messages
            finally:
                await manager.stop_all()

        assert len(mqtt_broker.published) == 1
        assert mqtt_broker.published[0][0] == "on/dm:pk1"

    @pytest.mark.asyncio
    async def test_both_disabled_nothing_published(self, mqtt_broker, integration_db):
        """Both disabled -> zero messages published."""
        from unittest.mock import patch

        await FanoutConfigRepository.create(
            config_type="mqtt_private",
            name="A",
            config=_private_config(mqtt_broker.port, "a"),
            scope={"messages": "all", "raw_packets": "all"},
            enabled=False,
        )
        await FanoutConfigRepository.create(
            config_type="mqtt_private",
            name="B",
            config=_private_config(mqtt_broker.port, "b"),
            scope={"messages": "all", "raw_packets": "all"},
            enabled=False,
        )

        manager = FanoutManager()
        with (
            patch("app.mqtt_base._broadcast_health"),
            patch("app.websocket.broadcast_success"),
            patch("app.websocket.broadcast_error"),
            patch("app.websocket.broadcast_health"),
        ):
            try:
                await manager.load_from_db()
                assert len(manager._modules) == 0

                await manager.broadcast_message(
                    {"type": "PRIV", "conversation_key": "pk1", "text": "hello"}
                )
                await asyncio.sleep(0.3)
            finally:
                await manager.stop_all()

        assert len(mqtt_broker.published) == 0

    @pytest.mark.asyncio
    async def test_disable_after_enable_stops_publishing(self, mqtt_broker, integration_db):
        """Disabling a live integration stops its publishing immediately."""
        from unittest.mock import patch

        cfg = await FanoutConfigRepository.create(
            config_type="mqtt_private",
            name="Toggle",
            config=_private_config(mqtt_broker.port, "toggle"),
            scope={"messages": "all", "raw_packets": "all"},
            enabled=True,
        )

        manager = FanoutManager()
        with (
            patch("app.mqtt_base._broadcast_health"),
            patch("app.websocket.broadcast_success"),
            patch("app.websocket.broadcast_error"),
            patch("app.websocket.broadcast_health"),
        ):
            try:
                await manager.load_from_db()
                await _wait_connected(manager, cfg["id"])

                # Publishes while enabled
                await manager.broadcast_message(
                    {"type": "PRIV", "conversation_key": "pk1", "text": "msg1"}
                )
                await mqtt_broker.wait_for(1)
                assert len(mqtt_broker.published) == 1

                # Disable via DB + reload
                await FanoutConfigRepository.update(cfg["id"], enabled=False)
                await manager.reload_config(cfg["id"])
                assert cfg["id"] not in manager._modules

                # Should NOT publish after disable
                await manager.broadcast_message(
                    {"type": "PRIV", "conversation_key": "pk2", "text": "msg2"}
                )
                await asyncio.sleep(0.3)
            finally:
                await manager.stop_all()

        # Only the first message
        assert len(mqtt_broker.published) == 1
        assert mqtt_broker.published[0][0] == "toggle/dm:pk1"

    @pytest.mark.asyncio
    async def test_scope_messages_only_no_raw(self, mqtt_broker, integration_db):
        """Module with raw_packets=none receives messages but not raw packets."""
        from unittest.mock import patch

        cfg = await FanoutConfigRepository.create(
            config_type="mqtt_private",
            name="Messages Only",
            config=_private_config(mqtt_broker.port, "msgsonly"),
            scope={"messages": "all", "raw_packets": "none"},
            enabled=True,
        )

        manager = FanoutManager()
        with (
            patch("app.mqtt_base._broadcast_health"),
            patch("app.websocket.broadcast_success"),
            patch("app.websocket.broadcast_error"),
            patch("app.websocket.broadcast_health"),
        ):
            try:
                await manager.load_from_db()
                await _wait_connected(manager, cfg["id"])

                await manager.broadcast_message(
                    {"type": "PRIV", "conversation_key": "pk1", "text": "hi"}
                )
                await manager.broadcast_raw({"data": "aabbccdd"})

                await mqtt_broker.wait_for(1)
                await asyncio.sleep(0.2)
            finally:
                await manager.stop_all()

        assert len(mqtt_broker.published) == 1
        assert "dm:pk1" in mqtt_broker.published[0][0]

    @pytest.mark.asyncio
    async def test_scope_raw_only_no_messages(self, mqtt_broker, integration_db):
        """Module with messages=none receives raw packets but not decoded messages."""
        from unittest.mock import patch

        cfg = await FanoutConfigRepository.create(
            config_type="mqtt_private",
            name="Raw Only",
            config=_private_config(mqtt_broker.port, "rawonly"),
            scope={"messages": "none", "raw_packets": "all"},
            enabled=True,
        )

        manager = FanoutManager()
        with (
            patch("app.mqtt_base._broadcast_health"),
            patch("app.websocket.broadcast_success"),
            patch("app.websocket.broadcast_error"),
            patch("app.websocket.broadcast_health"),
        ):
            try:
                await manager.load_from_db()
                await _wait_connected(manager, cfg["id"])

                await manager.broadcast_message(
                    {"type": "PRIV", "conversation_key": "pk1", "text": "hi"}
                )
                await manager.broadcast_raw({"data": "aabbccdd"})

                await mqtt_broker.wait_for(1)
                await asyncio.sleep(0.2)
            finally:
                await manager.stop_all()

        assert len(mqtt_broker.published) == 1
        assert "raw/" in mqtt_broker.published[0][0]
