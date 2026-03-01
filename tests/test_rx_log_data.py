"""Tests for on_rx_log_data event handler integration.

Verifies that the primary RF packet entry point correctly extracts hex payload,
SNR, and RSSI from MeshCore events and passes them to process_raw_packet.
"""

from unittest.mock import AsyncMock, patch

import pytest


class TestOnRxLogData:
    """Test the on_rx_log_data event handler."""

    @pytest.mark.asyncio
    async def test_extracts_hex_and_calls_process_raw_packet(self):
        """Hex payload is converted to bytes and forwarded correctly."""
        from app.event_handlers import on_rx_log_data

        class MockEvent:
            payload = {
                "payload": "deadbeef01020304",
                "snr": 7.5,
                "rssi": -85,
            }

        with patch("app.event_handlers.process_raw_packet", new_callable=AsyncMock) as mock_process:
            await on_rx_log_data(MockEvent())

            mock_process.assert_called_once_with(
                raw_bytes=bytes.fromhex("deadbeef01020304"),
                snr=7.5,
                rssi=-85,
            )

    @pytest.mark.asyncio
    async def test_missing_payload_field_returns_early(self):
        """Event without 'payload' field is silently skipped."""
        from app.event_handlers import on_rx_log_data

        class MockEvent:
            payload = {"snr": 5.0, "rssi": -90}  # no 'payload' key

        with patch("app.event_handlers.process_raw_packet", new_callable=AsyncMock) as mock_process:
            await on_rx_log_data(MockEvent())

            mock_process.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_snr_rssi_passes_none(self):
        """Missing SNR and RSSI fields pass None to process_raw_packet."""
        from app.event_handlers import on_rx_log_data

        class MockEvent:
            payload = {"payload": "ff00"}

        with patch("app.event_handlers.process_raw_packet", new_callable=AsyncMock) as mock_process:
            await on_rx_log_data(MockEvent())

            mock_process.assert_called_once_with(
                raw_bytes=bytes.fromhex("ff00"),
                snr=None,
                rssi=None,
            )

    @pytest.mark.asyncio
    async def test_empty_hex_payload_produces_empty_bytes(self):
        """Empty hex string produces empty bytes (not an error)."""
        from app.event_handlers import on_rx_log_data

        class MockEvent:
            payload = {"payload": ""}

        with patch("app.event_handlers.process_raw_packet", new_callable=AsyncMock) as mock_process:
            await on_rx_log_data(MockEvent())

            mock_process.assert_called_once_with(
                raw_bytes=b"",
                snr=None,
                rssi=None,
            )

    @pytest.mark.asyncio
    async def test_invalid_hex_raises_valueerror(self):
        """Invalid hex payload raises ValueError (not silently swallowed)."""
        from app.event_handlers import on_rx_log_data

        class MockEvent:
            payload = {"payload": "not_valid_hex"}

        with pytest.raises(ValueError):
            await on_rx_log_data(MockEvent())
