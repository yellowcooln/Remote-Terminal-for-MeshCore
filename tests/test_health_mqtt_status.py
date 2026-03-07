"""Tests for health endpoint fanout status fields.

Verifies that build_health_data correctly reports fanout module statuses
via the fanout_manager.
"""

from unittest.mock import patch

import pytest

from app.routers.health import build_health_data


class TestHealthFanoutStatus:
    """Test fanout_statuses in build_health_data."""

    @pytest.mark.asyncio
    async def test_no_fanout_modules_returns_empty(self, test_db):
        """fanout_statuses should be empty dict when no modules are running."""
        with patch("app.fanout.manager.fanout_manager") as mock_fm:
            mock_fm.get_statuses.return_value = {}
            data = await build_health_data(True, "TCP: 1.2.3.4:4000")

        assert data["fanout_statuses"] == {}

    @pytest.mark.asyncio
    async def test_fanout_statuses_reflect_manager(self, test_db):
        """fanout_statuses should return whatever the manager reports."""
        mock_statuses = {
            "uuid-1": {"name": "Private MQTT", "type": "mqtt_private", "status": "connected"},
            "uuid-2": {
                "name": "Community MQTT",
                "type": "mqtt_community",
                "status": "disconnected",
            },
        }
        with patch("app.fanout.manager.fanout_manager") as mock_fm:
            mock_fm.get_statuses.return_value = mock_statuses
            data = await build_health_data(True, "Serial: /dev/ttyUSB0")

        assert data["fanout_statuses"] == mock_statuses

    @pytest.mark.asyncio
    async def test_health_status_ok_when_connected(self, test_db):
        """Health status is 'ok' when radio is connected."""
        with patch(
            "app.routers.health.RawPacketRepository.get_oldest_undecrypted", return_value=None
        ):
            data = await build_health_data(True, "Serial: /dev/ttyUSB0")

        assert data["status"] == "ok"
        assert data["radio_connected"] is True
        assert data["connection_info"] == "Serial: /dev/ttyUSB0"

    @pytest.mark.asyncio
    async def test_health_status_degraded_when_disconnected(self, test_db):
        """Health status is 'degraded' when radio is disconnected."""
        with patch(
            "app.routers.health.RawPacketRepository.get_oldest_undecrypted", return_value=None
        ):
            data = await build_health_data(False, None)

        assert data["status"] == "degraded"
        assert data["radio_connected"] is False
        assert data["connection_info"] is None
