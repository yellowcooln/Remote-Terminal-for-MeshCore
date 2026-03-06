"""Tests for the --disable-bots (MESHCORE_DISABLE_BOTS) startup flag.

Verifies that when disable_bots=True:
- run_bot_for_message() exits immediately without any work
- POST /api/fanout with type=bot returns 403
- Health endpoint includes bots_disabled=True
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.bot import run_bot_for_message
from app.config import Settings
from app.models import BotConfig
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


class TestDisableBotsBotExecution:
    """Test that run_bot_for_message exits immediately when bots are disabled."""

    @pytest.mark.asyncio
    async def test_returns_immediately_when_disabled(self):
        """No settings load, no semaphore, no bot execution."""
        with patch("app.bot.server_settings", MagicMock(disable_bots=True)):
            with patch("app.repository.AppSettingsRepository") as mock_repo:
                mock_repo.get = AsyncMock()

                await run_bot_for_message(
                    sender_name="Alice",
                    sender_key="ab" * 32,
                    message_text="Hello",
                    is_dm=True,
                    channel_key=None,
                )

                # Should never even load settings
                mock_repo.get.assert_not_called()

    @pytest.mark.asyncio
    async def test_runs_normally_when_not_disabled(self):
        """Bots execute normally when disable_bots is False."""
        with patch("app.bot.server_settings", MagicMock(disable_bots=False)):
            with patch("app.repository.AppSettingsRepository") as mock_repo:
                mock_settings = MagicMock()
                mock_settings.bots = [
                    BotConfig(id="1", name="Echo", enabled=True, code="def bot(**k): return 'echo'")
                ]
                mock_repo.get = AsyncMock(return_value=mock_settings)

                with (
                    patch("app.bot.asyncio.sleep", new_callable=AsyncMock),
                    patch("app.bot.execute_bot_code", return_value="echo") as mock_exec,
                    patch("app.bot.process_bot_response", new_callable=AsyncMock),
                ):
                    await run_bot_for_message(
                        sender_name="Alice",
                        sender_key="ab" * 32,
                        message_text="Hello",
                        is_dm=True,
                        channel_key=None,
                    )

                    mock_exec.assert_called_once()


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
