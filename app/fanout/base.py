"""Base class for fanout integration modules."""

from __future__ import annotations


class FanoutModule:
    """Base class for all fanout integrations.

    Each module wraps a specific integration (MQTT, webhook, etc.) and
    receives dispatched messages/packets from the FanoutManager.

    Subclasses must override the ``status`` property.
    """

    def __init__(self, config_id: str, config: dict, *, name: str = "") -> None:
        self.config_id = config_id
        self.config = config
        self.name = name

    async def start(self) -> None:
        """Start the module (e.g. connect to broker). Override for persistent connections."""

    async def stop(self) -> None:
        """Stop the module (e.g. disconnect from broker)."""

    async def on_message(self, data: dict) -> None:
        """Called for decoded messages (DM/channel). Override if needed."""

    async def on_raw(self, data: dict) -> None:
        """Called for raw RF packets. Override if needed."""

    @property
    def status(self) -> str:
        """Return 'connected', 'disconnected', or 'error'."""
        raise NotImplementedError
