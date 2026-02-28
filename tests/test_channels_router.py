"""Tests for the channels router sync endpoint.

Verifies that POST /api/channels/sync correctly reads channel slots
from the radio and upserts them into the database.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from meshcore import EventType

from app.database import Database
from app.radio import radio_manager
from app.repository import ChannelRepository


@pytest.fixture
async def test_db():
    """Create an in-memory test database with schema + migrations."""
    import app.repository as repo_module

    db = Database(":memory:")
    await db.connect()

    original_db = repo_module.db
    repo_module.db = db

    try:
        yield db
    finally:
        repo_module.db = original_db
        await db.disconnect()


@pytest.fixture(autouse=True)
def _reset_radio_state():
    """Save/restore radio_manager state so tests don't leak."""
    prev = radio_manager._meshcore
    prev_lock = radio_manager._operation_lock
    yield
    radio_manager._meshcore = prev
    radio_manager._operation_lock = prev_lock


@pytest.fixture
def client():
    """Create an httpx AsyncClient for testing the app."""
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _make_channel_info(name: str, secret: bytes):
    """Create a mock channel info response."""
    result = MagicMock()
    result.type = EventType.CHANNEL_INFO
    result.payload = {
        "channel_name": name,
        "channel_secret": secret,
    }
    return result


def _make_empty_channel():
    """Create a mock empty channel response."""
    result = MagicMock()
    result.type = EventType.CHANNEL_INFO
    result.payload = {
        "channel_name": "\x00\x00\x00\x00",
        "channel_secret": b"",
    }
    return result


def _make_error_response():
    """Create a mock error response (channel slot unused)."""
    result = MagicMock()
    result.type = EventType.ERROR
    result.payload = {}
    return result


@asynccontextmanager
async def _noop_radio_operation(mc):
    """No-op radio_operation context manager that yields mc."""
    yield mc


class TestSyncChannelsFromRadio:
    """Test POST /api/channels/sync."""

    @pytest.mark.asyncio
    async def test_sync_channels_basic(self, test_db, client):
        """Sync creates channels from radio slots."""
        secret_a = bytes.fromhex("0123456789abcdef0123456789abcdef")
        secret_b = bytes.fromhex("fedcba9876543210fedcba9876543210")

        mock_mc = MagicMock()

        async def mock_get_channel(idx):
            if idx == 0:
                return _make_channel_info("#general", secret_a)
            if idx == 1:
                return _make_channel_info("Private", secret_b)
            return _make_empty_channel()

        mock_mc.commands.get_channel = AsyncMock(side_effect=mock_get_channel)
        radio_manager._meshcore = mock_mc

        with (
            patch("app.dependencies.radio_manager") as mock_dep_rm,
            patch("app.routers.channels.radio_manager") as mock_ch_rm,
        ):
            mock_dep_rm.is_connected = True
            mock_dep_rm.meshcore = mock_mc
            mock_ch_rm.radio_operation = lambda desc: _noop_radio_operation(mock_mc)

            response = await client.post("/api/channels/sync?max_channels=5")

        assert response.status_code == 200
        data = response.json()
        assert data["synced"] == 2

        # Verify channels in DB
        channels = await ChannelRepository.get_all()
        assert len(channels) == 2

        keys = {ch.key for ch in channels}
        assert secret_a.hex().upper() in keys
        assert secret_b.hex().upper() in keys

    @pytest.mark.asyncio
    async def test_sync_skips_empty_channels(self, test_db, client):
        """Empty channel slots are skipped during sync."""
        secret = bytes.fromhex("aabbccddaabbccddaabbccddaabbccdd")
        mock_mc = MagicMock()

        async def mock_get_channel(idx):
            if idx == 0:
                return _make_channel_info("#test", secret)
            return _make_empty_channel()

        mock_mc.commands.get_channel = AsyncMock(side_effect=mock_get_channel)
        radio_manager._meshcore = mock_mc

        with (
            patch("app.dependencies.radio_manager") as mock_dep_rm,
            patch("app.routers.channels.radio_manager") as mock_ch_rm,
        ):
            mock_dep_rm.is_connected = True
            mock_dep_rm.meshcore = mock_mc
            mock_ch_rm.radio_operation = lambda desc: _noop_radio_operation(mock_mc)

            response = await client.post("/api/channels/sync?max_channels=5")

        assert response.status_code == 200
        assert response.json()["synced"] == 1

    @pytest.mark.asyncio
    async def test_sync_hashtag_flag(self, test_db, client):
        """Channels starting with # are marked as hashtag channels."""
        secret = bytes.fromhex("1122334455667788aabbccddeeff0011")
        mock_mc = MagicMock()

        async def mock_get_channel(idx):
            if idx == 0:
                return _make_channel_info("#hashtag-room", secret)
            return _make_empty_channel()

        mock_mc.commands.get_channel = AsyncMock(side_effect=mock_get_channel)
        radio_manager._meshcore = mock_mc

        with (
            patch("app.dependencies.radio_manager") as mock_dep_rm,
            patch("app.routers.channels.radio_manager") as mock_ch_rm,
        ):
            mock_dep_rm.is_connected = True
            mock_dep_rm.meshcore = mock_mc
            mock_ch_rm.radio_operation = lambda desc: _noop_radio_operation(mock_mc)

            response = await client.post("/api/channels/sync?max_channels=3")

        assert response.status_code == 200

        channel = await ChannelRepository.get_by_key(secret.hex().upper())
        assert channel is not None
        assert channel.is_hashtag is True
        assert channel.name == "#hashtag-room"
        assert channel.on_radio is True

    @pytest.mark.asyncio
    async def test_sync_marks_channels_on_radio(self, test_db, client):
        """Synced channels have on_radio=True."""
        secret = bytes.fromhex("aabbccddaabbccddaabbccddaabbccdd")
        mock_mc = MagicMock()

        async def mock_get_channel(idx):
            if idx == 0:
                return _make_channel_info("MyChannel", secret)
            return _make_empty_channel()

        mock_mc.commands.get_channel = AsyncMock(side_effect=mock_get_channel)
        radio_manager._meshcore = mock_mc

        with (
            patch("app.dependencies.radio_manager") as mock_dep_rm,
            patch("app.routers.channels.radio_manager") as mock_ch_rm,
        ):
            mock_dep_rm.is_connected = True
            mock_dep_rm.meshcore = mock_mc
            mock_ch_rm.radio_operation = lambda desc: _noop_radio_operation(mock_mc)

            await client.post("/api/channels/sync?max_channels=3")

        channel = await ChannelRepository.get_by_key(secret.hex().upper())
        assert channel.on_radio is True

    @pytest.mark.asyncio
    async def test_sync_requires_connection(self, test_db, client):
        """Sync returns 503 when radio is not connected."""
        with patch("app.dependencies.radio_manager") as mock_rm:
            mock_rm.is_connected = False
            mock_rm.meshcore = None

            response = await client.post("/api/channels/sync")

        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_sync_key_normalized_uppercase(self, test_db, client):
        """Channel keys are normalized to uppercase hex."""
        secret = bytes.fromhex("aabbccddaabbccddaabbccddaabbccdd")
        mock_mc = MagicMock()

        async def mock_get_channel(idx):
            if idx == 0:
                return _make_channel_info("Test", secret)
            return _make_empty_channel()

        mock_mc.commands.get_channel = AsyncMock(side_effect=mock_get_channel)
        radio_manager._meshcore = mock_mc

        with (
            patch("app.dependencies.radio_manager") as mock_dep_rm,
            patch("app.routers.channels.radio_manager") as mock_ch_rm,
        ):
            mock_dep_rm.is_connected = True
            mock_dep_rm.meshcore = mock_mc
            mock_ch_rm.radio_operation = lambda desc: _noop_radio_operation(mock_mc)

            await client.post("/api/channels/sync?max_channels=3")

        channel = await ChannelRepository.get_by_key("AABBCCDDAABBCCDDAABBCCDDAABBCCDD")
        assert channel is not None
