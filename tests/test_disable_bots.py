"""Tests for the --disable-bots (MESHCORE_DISABLE_BOTS) startup flag.

Verifies that when disable_bots=True:
- POST /api/fanout with type=bot returns 403
- Health endpoint includes bots_disabled=True
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.routers.fanout import FanoutConfigCreate, create_fanout_config
from app.routers.health import build_health_data


class TestDisableBotsConfig:
    """Test the disable_bots configuration field."""

    def test_disable_bots_defaults_to_false(self):
        s = Settings(serial_port="", tcp_host="", ble_address="")
        assert s.disable_bots is False

    def test_disable_bots_can_be_set_true(self):
        s = Settings(serial_port="", tcp_host="", ble_address="", disable_bots=True)
        assert s.disable_bots is True


class TestDisableBotsFanoutEndpoint:
    """Test that bot creation via fanout router is rejected when bots are disabled."""

    @pytest.mark.asyncio
    async def test_bot_create_returns_403_when_disabled(self, test_db):
        """POST /api/fanout with type=bot returns 403."""
        with patch("app.routers.fanout.server_settings", MagicMock(disable_bots=True)):
            with pytest.raises(HTTPException) as exc_info:
                await create_fanout_config(
                    FanoutConfigCreate(
                        type="bot",
                        name="Test Bot",
                        config={"code": "def bot(**k): pass"},
                        enabled=False,
                    )
                )

            assert exc_info.value.status_code == 403
            assert "disabled" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_mqtt_create_allowed_when_bots_disabled(self, test_db):
        """Non-bot fanout configs can still be created when bots are disabled."""
        with patch("app.routers.fanout.server_settings", MagicMock(disable_bots=True)):
            # Create as disabled so fanout_manager.reload_config is not called
            result = await create_fanout_config(
                FanoutConfigCreate(
                    type="mqtt_private",
                    name="Test MQTT",
                    config={"broker_host": "localhost", "broker_port": 1883},
                    enabled=False,
                )
            )
            assert result["type"] == "mqtt_private"


class TestDisableBotsHealthEndpoint:
    """Test that bots_disabled is exposed in health data."""

    @pytest.mark.asyncio
    async def test_health_includes_bots_disabled_true(self, test_db):
        with patch("app.routers.health.settings", MagicMock(disable_bots=True, database_path="x")):
            with patch("app.routers.health.os.path.getsize", return_value=0):
                data = await build_health_data(True, "TCP: 1.2.3.4:4000")

        assert data["bots_disabled"] is True

    @pytest.mark.asyncio
    async def test_health_includes_bots_disabled_false(self, test_db):
        with patch("app.routers.health.settings", MagicMock(disable_bots=False, database_path="x")):
            with patch("app.routers.health.os.path.getsize", return_value=0):
                data = await build_health_data(True, "TCP: 1.2.3.4:4000")

        assert data["bots_disabled"] is False
