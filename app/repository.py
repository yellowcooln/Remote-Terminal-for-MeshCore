import json
import logging
import sqlite3
import time
from hashlib import sha256
from typing import Any, Literal

from app.database import db
from app.decoder import PayloadType, extract_payload, get_packet_payload_type
from app.models import (
    AppSettings,
    BotConfig,
    Channel,
    Contact,
    ContactAdvertPath,
    ContactAdvertPathSummary,
    ContactNameHistory,
    Favorite,
    Message,
    MessagePath,
)

logger = logging.getLogger(__name__)


SECONDS_1H = 3600
SECONDS_24H = 86400
SECONDS_7D = 604800


class AmbiguousPublicKeyPrefixError(ValueError):
    """Raised when a public key prefix matches multiple contacts."""

    def __init__(self, prefix: str, matches: list[str]):
        self.prefix = prefix.lower()
        self.matches = matches
        super().__init__(f"Ambiguous public key prefix '{self.prefix}'")


class ContactRepository:
    @staticmethod
    async def upsert(contact: dict[str, Any]) -> None:
        await db.conn.execute(
            """
            INSERT INTO contacts (public_key, name, type, flags, last_path, last_path_len,
                                  last_advert, lat, lon, last_seen, on_radio, last_contacted,
                                  first_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(public_key) DO UPDATE SET
                name = COALESCE(excluded.name, contacts.name),
                type = CASE WHEN excluded.type = 0 THEN contacts.type ELSE excluded.type END,
                flags = excluded.flags,
                last_path = COALESCE(excluded.last_path, contacts.last_path),
                last_path_len = excluded.last_path_len,
                last_advert = COALESCE(excluded.last_advert, contacts.last_advert),
                lat = COALESCE(excluded.lat, contacts.lat),
                lon = COALESCE(excluded.lon, contacts.lon),
                last_seen = excluded.last_seen,
                on_radio = COALESCE(excluded.on_radio, contacts.on_radio),
                last_contacted = COALESCE(excluded.last_contacted, contacts.last_contacted),
                first_seen = COALESCE(contacts.first_seen, excluded.first_seen)
            """,
            (
                contact.get("public_key", "").lower(),
                contact.get("name"),
                contact.get("type", 0),
                contact.get("flags", 0),
                contact.get("last_path"),
                contact.get("last_path_len", -1),
                contact.get("last_advert"),
                contact.get("lat"),
                contact.get("lon"),
                contact.get("last_seen", int(time.time())),
                contact.get("on_radio"),
                contact.get("last_contacted"),
                contact.get("first_seen"),
            ),
        )
        await db.conn.commit()

    @staticmethod
    def _row_to_contact(row) -> Contact:
        """Convert a database row to a Contact model."""
        return Contact(
            public_key=row["public_key"],
            name=row["name"],
            type=row["type"],
            flags=row["flags"],
            last_path=row["last_path"],
            last_path_len=row["last_path_len"],
            last_advert=row["last_advert"],
            lat=row["lat"],
            lon=row["lon"],
            last_seen=row["last_seen"],
            on_radio=bool(row["on_radio"]),
            last_contacted=row["last_contacted"],
            last_read_at=row["last_read_at"],
            first_seen=row["first_seen"],
        )

    @staticmethod
    async def get_by_key(public_key: str) -> Contact | None:
        cursor = await db.conn.execute(
            "SELECT * FROM contacts WHERE public_key = ?", (public_key.lower(),)
        )
        row = await cursor.fetchone()
        return ContactRepository._row_to_contact(row) if row else None

    @staticmethod
    async def get_by_key_prefix(prefix: str) -> Contact | None:
        """Get a contact by key prefix only if it resolves uniquely.

        Returns None when no contacts match OR when multiple contacts match
        the prefix (to avoid silently selecting the wrong contact).
        """
        normalized_prefix = prefix.lower()
        cursor = await db.conn.execute(
            "SELECT * FROM contacts WHERE public_key LIKE ? ORDER BY public_key LIMIT 2",
            (f"{normalized_prefix}%",),
        )
        rows = list(await cursor.fetchall())
        if len(rows) != 1:
            return None
        return ContactRepository._row_to_contact(rows[0])

    @staticmethod
    async def _get_prefix_matches(prefix: str, limit: int = 2) -> list[Contact]:
        """Get contacts matching a key prefix, up to limit."""
        cursor = await db.conn.execute(
            "SELECT * FROM contacts WHERE public_key LIKE ? ORDER BY public_key LIMIT ?",
            (f"{prefix.lower()}%", limit),
        )
        rows = list(await cursor.fetchall())
        return [ContactRepository._row_to_contact(row) for row in rows]

    @staticmethod
    async def get_by_key_or_prefix(key_or_prefix: str) -> Contact | None:
        """Get a contact by exact key match, falling back to prefix match.

        Useful when the input might be a full 64-char public key or a shorter prefix.
        """
        contact = await ContactRepository.get_by_key(key_or_prefix)
        if contact:
            return contact

        matches = await ContactRepository._get_prefix_matches(key_or_prefix, limit=2)
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise AmbiguousPublicKeyPrefixError(
                key_or_prefix,
                [m.public_key for m in matches],
            )
        return None

    @staticmethod
    async def get_by_name(name: str) -> list[Contact]:
        """Get all contacts with the given exact name."""
        cursor = await db.conn.execute("SELECT * FROM contacts WHERE name = ?", (name,))
        rows = await cursor.fetchall()
        return [ContactRepository._row_to_contact(row) for row in rows]

    @staticmethod
    async def resolve_prefixes(prefixes: list[str]) -> dict[str, Contact]:
        """Resolve multiple key prefixes to contacts in a single query.

        Returns a dict mapping each prefix to its Contact, only for prefixes
        that resolve uniquely (exactly one match). Ambiguous or unmatched
        prefixes are omitted.
        """
        if not prefixes:
            return {}
        normalized = [p.lower() for p in prefixes]
        conditions = " OR ".join(["public_key LIKE ?"] * len(normalized))
        params = [f"{p}%" for p in normalized]
        cursor = await db.conn.execute(f"SELECT * FROM contacts WHERE {conditions}", params)
        rows = await cursor.fetchall()
        # Group by which prefix each row matches
        prefix_to_rows: dict[str, list] = {p: [] for p in normalized}
        for row in rows:
            pk = row["public_key"]
            for p in normalized:
                if pk.startswith(p):
                    prefix_to_rows[p].append(row)
        # Only include uniquely-resolved prefixes
        result: dict[str, Contact] = {}
        for p in normalized:
            if len(prefix_to_rows[p]) == 1:
                result[p] = ContactRepository._row_to_contact(prefix_to_rows[p][0])
        return result

    @staticmethod
    async def get_all(limit: int = 100, offset: int = 0) -> list[Contact]:
        cursor = await db.conn.execute(
            "SELECT * FROM contacts ORDER BY COALESCE(name, public_key) LIMIT ? OFFSET ?",
            (limit, offset),
        )
        rows = await cursor.fetchall()
        return [ContactRepository._row_to_contact(row) for row in rows]

    @staticmethod
    async def get_recent_non_repeaters(limit: int = 200) -> list[Contact]:
        """Get the most recently active non-repeater contacts.

        Orders by most recent activity (last_contacted or last_advert),
        excluding repeaters (type=2).
        """
        cursor = await db.conn.execute(
            """
            SELECT * FROM contacts
            WHERE type != 2
            ORDER BY COALESCE(last_contacted, 0) DESC, COALESCE(last_advert, 0) DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = await cursor.fetchall()
        return [ContactRepository._row_to_contact(row) for row in rows]

    @staticmethod
    async def update_path(public_key: str, path: str, path_len: int) -> None:
        await db.conn.execute(
            "UPDATE contacts SET last_path = ?, last_path_len = ?, last_seen = ? WHERE public_key = ?",
            (path, path_len, int(time.time()), public_key.lower()),
        )
        await db.conn.commit()

    @staticmethod
    async def set_on_radio(public_key: str, on_radio: bool) -> None:
        await db.conn.execute(
            "UPDATE contacts SET on_radio = ? WHERE public_key = ?",
            (on_radio, public_key.lower()),
        )
        await db.conn.commit()

    @staticmethod
    async def delete(public_key: str) -> None:
        normalized = public_key.lower()
        await db.conn.execute(
            "DELETE FROM contact_name_history WHERE public_key = ?", (normalized,)
        )
        await db.conn.execute(
            "DELETE FROM contact_advert_paths WHERE public_key = ?", (normalized,)
        )
        await db.conn.execute("DELETE FROM contacts WHERE public_key = ?", (normalized,))
        await db.conn.commit()

    @staticmethod
    async def update_last_contacted(public_key: str, timestamp: int | None = None) -> None:
        """Update the last_contacted timestamp for a contact."""
        ts = timestamp if timestamp is not None else int(time.time())
        await db.conn.execute(
            "UPDATE contacts SET last_contacted = ?, last_seen = ? WHERE public_key = ?",
            (ts, ts, public_key.lower()),
        )
        await db.conn.commit()

    @staticmethod
    async def update_last_read_at(public_key: str, timestamp: int | None = None) -> bool:
        """Update the last_read_at timestamp for a contact.

        Returns True if a row was updated, False if contact not found.
        """
        ts = timestamp if timestamp is not None else int(time.time())
        cursor = await db.conn.execute(
            "UPDATE contacts SET last_read_at = ? WHERE public_key = ?",
            (ts, public_key.lower()),
        )
        await db.conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def mark_all_read(timestamp: int) -> None:
        """Mark all contacts as read at the given timestamp."""
        await db.conn.execute("UPDATE contacts SET last_read_at = ?", (timestamp,))
        await db.conn.commit()

    @staticmethod
    async def get_by_pubkey_first_byte(hex_byte: str) -> list[Contact]:
        """Get contacts whose public key starts with the given hex byte (2 chars)."""
        cursor = await db.conn.execute(
            "SELECT * FROM contacts WHERE substr(public_key, 1, 2) = ?",
            (hex_byte.lower(),),
        )
        rows = await cursor.fetchall()
        return [ContactRepository._row_to_contact(row) for row in rows]


class ContactAdvertPathRepository:
    """Repository for recent unique advertisement paths per contact."""

    @staticmethod
    def _row_to_path(row) -> ContactAdvertPath:
        path = row["path_hex"] or ""
        next_hop = path[:2].lower() if len(path) >= 2 else None
        return ContactAdvertPath(
            path=path,
            path_len=row["path_len"],
            next_hop=next_hop,
            first_seen=row["first_seen"],
            last_seen=row["last_seen"],
            heard_count=row["heard_count"],
        )

    @staticmethod
    async def record_observation(
        public_key: str,
        path_hex: str,
        timestamp: int,
        max_paths: int = 10,
    ) -> None:
        """
        Upsert a unique advert path observation for a contact and prune to N most recent.
        """
        if max_paths < 1:
            max_paths = 1

        normalized_key = public_key.lower()
        normalized_path = path_hex.lower()
        path_len = len(normalized_path) // 2

        await db.conn.execute(
            """
            INSERT INTO contact_advert_paths
                (public_key, path_hex, path_len, first_seen, last_seen, heard_count)
            VALUES (?, ?, ?, ?, ?, 1)
            ON CONFLICT(public_key, path_hex) DO UPDATE SET
                last_seen = MAX(contact_advert_paths.last_seen, excluded.last_seen),
                path_len = excluded.path_len,
                heard_count = contact_advert_paths.heard_count + 1
            """,
            (normalized_key, normalized_path, path_len, timestamp, timestamp),
        )

        # Keep only the N most recent unique paths per contact.
        await db.conn.execute(
            """
            DELETE FROM contact_advert_paths
            WHERE public_key = ?
              AND path_hex NOT IN (
                  SELECT path_hex
                  FROM contact_advert_paths
                  WHERE public_key = ?
                  ORDER BY last_seen DESC, heard_count DESC, path_len ASC, path_hex ASC
                  LIMIT ?
              )
            """,
            (normalized_key, normalized_key, max_paths),
        )
        await db.conn.commit()

    @staticmethod
    async def get_recent_for_contact(public_key: str, limit: int = 10) -> list[ContactAdvertPath]:
        cursor = await db.conn.execute(
            """
            SELECT path_hex, path_len, first_seen, last_seen, heard_count
            FROM contact_advert_paths
            WHERE public_key = ?
            ORDER BY last_seen DESC, heard_count DESC, path_len ASC, path_hex ASC
            LIMIT ?
            """,
            (public_key.lower(), limit),
        )
        rows = await cursor.fetchall()
        return [ContactAdvertPathRepository._row_to_path(row) for row in rows]

    @staticmethod
    async def get_recent_for_all_contacts(
        limit_per_contact: int = 10,
    ) -> list[ContactAdvertPathSummary]:
        cursor = await db.conn.execute(
            """
            SELECT public_key, path_hex, path_len, first_seen, last_seen, heard_count
            FROM contact_advert_paths
            ORDER BY public_key ASC, last_seen DESC, heard_count DESC, path_len ASC, path_hex ASC
            """
        )
        rows = await cursor.fetchall()

        grouped: dict[str, list[ContactAdvertPath]] = {}
        for row in rows:
            key = row["public_key"]
            paths = grouped.get(key)
            if paths is None:
                paths = []
                grouped[key] = paths
            if len(paths) >= limit_per_contact:
                continue
            paths.append(ContactAdvertPathRepository._row_to_path(row))

        return [
            ContactAdvertPathSummary(public_key=key, paths=paths) for key, paths in grouped.items()
        ]


class ContactNameHistoryRepository:
    """Repository for contact name change history."""

    @staticmethod
    async def record_name(public_key: str, name: str, timestamp: int) -> None:
        """Record a name observation. Upserts: updates last_seen if name already known."""
        await db.conn.execute(
            """
            INSERT INTO contact_name_history (public_key, name, first_seen, last_seen)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(public_key, name) DO UPDATE SET
                last_seen = MAX(contact_name_history.last_seen, excluded.last_seen)
            """,
            (public_key.lower(), name, timestamp, timestamp),
        )
        await db.conn.commit()

    @staticmethod
    async def get_history(public_key: str) -> list[ContactNameHistory]:
        cursor = await db.conn.execute(
            """
            SELECT name, first_seen, last_seen
            FROM contact_name_history
            WHERE public_key = ?
            ORDER BY last_seen DESC
            """,
            (public_key.lower(),),
        )
        rows = await cursor.fetchall()
        return [
            ContactNameHistory(
                name=row["name"], first_seen=row["first_seen"], last_seen=row["last_seen"]
            )
            for row in rows
        ]


class ChannelRepository:
    @staticmethod
    async def upsert(key: str, name: str, is_hashtag: bool = False, on_radio: bool = False) -> None:
        """Upsert a channel. Key is 32-char hex string."""
        await db.conn.execute(
            """
            INSERT INTO channels (key, name, is_hashtag, on_radio)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                name = excluded.name,
                is_hashtag = excluded.is_hashtag,
                on_radio = excluded.on_radio
            """,
            (key.upper(), name, is_hashtag, on_radio),
        )
        await db.conn.commit()

    @staticmethod
    async def get_by_key(key: str) -> Channel | None:
        """Get a channel by its key (32-char hex string)."""
        cursor = await db.conn.execute(
            "SELECT key, name, is_hashtag, on_radio, last_read_at FROM channels WHERE key = ?",
            (key.upper(),),
        )
        row = await cursor.fetchone()
        if row:
            return Channel(
                key=row["key"],
                name=row["name"],
                is_hashtag=bool(row["is_hashtag"]),
                on_radio=bool(row["on_radio"]),
                last_read_at=row["last_read_at"],
            )
        return None

    @staticmethod
    async def get_all() -> list[Channel]:
        cursor = await db.conn.execute(
            "SELECT key, name, is_hashtag, on_radio, last_read_at FROM channels ORDER BY name"
        )
        rows = await cursor.fetchall()
        return [
            Channel(
                key=row["key"],
                name=row["name"],
                is_hashtag=bool(row["is_hashtag"]),
                on_radio=bool(row["on_radio"]),
                last_read_at=row["last_read_at"],
            )
            for row in rows
        ]

    @staticmethod
    async def delete(key: str) -> None:
        """Delete a channel by key."""
        await db.conn.execute(
            "DELETE FROM channels WHERE key = ?",
            (key.upper(),),
        )
        await db.conn.commit()

    @staticmethod
    async def update_last_read_at(key: str, timestamp: int | None = None) -> bool:
        """Update the last_read_at timestamp for a channel.

        Returns True if a row was updated, False if channel not found.
        """
        ts = timestamp if timestamp is not None else int(time.time())
        cursor = await db.conn.execute(
            "UPDATE channels SET last_read_at = ? WHERE key = ?",
            (ts, key.upper()),
        )
        await db.conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    async def mark_all_read(timestamp: int) -> None:
        """Mark all channels as read at the given timestamp."""
        await db.conn.execute("UPDATE channels SET last_read_at = ?", (timestamp,))
        await db.conn.commit()


class MessageRepository:
    @staticmethod
    def _parse_paths(paths_json: str | None) -> list[MessagePath] | None:
        """Parse paths JSON string to list of MessagePath objects."""
        if not paths_json:
            return None
        try:
            paths_data = json.loads(paths_json)
            return [MessagePath(**p) for p in paths_data]
        except (json.JSONDecodeError, TypeError, KeyError):
            return None

    @staticmethod
    async def create(
        msg_type: str,
        text: str,
        received_at: int,
        conversation_key: str,
        sender_timestamp: int | None = None,
        path: str | None = None,
        txt_type: int = 0,
        signature: str | None = None,
        outgoing: bool = False,
        sender_name: str | None = None,
        sender_key: str | None = None,
    ) -> int | None:
        """Create a message, returning the ID or None if duplicate.

        Uses INSERT OR IGNORE to handle the UNIQUE constraint on
        (type, conversation_key, text, sender_timestamp). This prevents
        duplicate messages when the same message arrives via multiple RF paths.

        The path parameter is converted to the paths JSON array format.
        """
        # Convert single path to paths array format
        paths_json = None
        if path is not None:
            paths_json = json.dumps([{"path": path, "received_at": received_at}])

        cursor = await db.conn.execute(
            """
            INSERT OR IGNORE INTO messages (type, conversation_key, text, sender_timestamp,
                                            received_at, paths, txt_type, signature, outgoing,
                                            sender_name, sender_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                msg_type,
                conversation_key,
                text,
                sender_timestamp,
                received_at,
                paths_json,
                txt_type,
                signature,
                outgoing,
                sender_name,
                sender_key,
            ),
        )
        await db.conn.commit()
        # rowcount is 0 if INSERT was ignored due to UNIQUE constraint violation
        if cursor.rowcount == 0:
            return None
        return cursor.lastrowid

    @staticmethod
    async def add_path(
        message_id: int, path: str, received_at: int | None = None
    ) -> list[MessagePath]:
        """Add a new path to an existing message.

        This is used when a repeat/echo of a message arrives via a different route.
        Returns the updated list of paths.
        """
        ts = received_at if received_at is not None else int(time.time())

        # Atomic append: use json_insert to avoid read-modify-write race when
        # multiple duplicate packets arrive concurrently for the same message.
        new_entry = json.dumps({"path": path, "received_at": ts})
        await db.conn.execute(
            """UPDATE messages SET paths = json_insert(
                COALESCE(paths, '[]'), '$[#]', json(?)
            ) WHERE id = ?""",
            (new_entry, message_id),
        )
        await db.conn.commit()

        # Read back the full list for the return value
        cursor = await db.conn.execute("SELECT paths FROM messages WHERE id = ?", (message_id,))
        row = await cursor.fetchone()
        if not row or not row["paths"]:
            return []

        try:
            all_paths = json.loads(row["paths"])
        except json.JSONDecodeError:
            return []

        return [MessagePath(**p) for p in all_paths]

    @staticmethod
    async def claim_prefix_messages(full_key: str) -> int:
        """Promote prefix-stored messages to the full conversation key.

        When a full key becomes known for a contact, any messages stored with
        only a prefix as conversation_key are updated to use the full key.
        """
        lower_key = full_key.lower()
        cursor = await db.conn.execute(
            """UPDATE messages SET conversation_key = ?
               WHERE type = 'PRIV' AND length(conversation_key) < 64
               AND ? LIKE conversation_key || '%'
               AND (
                   SELECT COUNT(*) FROM contacts
                   WHERE public_key LIKE messages.conversation_key || '%'
               ) = 1""",
            (lower_key, lower_key),
        )
        await db.conn.commit()
        return cursor.rowcount

    @staticmethod
    async def get_all(
        limit: int = 100,
        offset: int = 0,
        msg_type: str | None = None,
        conversation_key: str | None = None,
        before: int | None = None,
        before_id: int | None = None,
    ) -> list[Message]:
        query = "SELECT * FROM messages WHERE 1=1"
        params: list[Any] = []

        if msg_type:
            query += " AND type = ?"
            params.append(msg_type)
        if conversation_key:
            normalized_key = conversation_key
            # Prefer exact matching for full keys.
            if len(conversation_key) == 64:
                normalized_key = conversation_key.lower()
                query += " AND conversation_key = ?"
                params.append(normalized_key)
            elif len(conversation_key) == 32:
                normalized_key = conversation_key.upper()
                query += " AND conversation_key = ?"
                params.append(normalized_key)
            else:
                # Prefix match is only for legacy/partial key callers.
                query += " AND conversation_key LIKE ?"
                params.append(f"{conversation_key}%")

        if before is not None and before_id is not None:
            query += " AND (received_at < ? OR (received_at = ? AND id < ?))"
            params.extend([before, before, before_id])

        query += " ORDER BY received_at DESC, id DESC LIMIT ?"
        params.append(limit)
        if before is None or before_id is None:
            query += " OFFSET ?"
            params.append(offset)

        cursor = await db.conn.execute(query, params)
        rows = await cursor.fetchall()
        return [
            Message(
                id=row["id"],
                type=row["type"],
                conversation_key=row["conversation_key"],
                text=row["text"],
                sender_timestamp=row["sender_timestamp"],
                received_at=row["received_at"],
                paths=MessageRepository._parse_paths(row["paths"]),
                txt_type=row["txt_type"],
                signature=row["signature"],
                outgoing=bool(row["outgoing"]),
                acked=row["acked"],
            )
            for row in rows
        ]

    @staticmethod
    async def increment_ack_count(message_id: int) -> int:
        """Increment ack count and return the new value."""
        await db.conn.execute("UPDATE messages SET acked = acked + 1 WHERE id = ?", (message_id,))
        await db.conn.commit()
        cursor = await db.conn.execute("SELECT acked FROM messages WHERE id = ?", (message_id,))
        row = await cursor.fetchone()
        return row["acked"] if row else 1

    @staticmethod
    async def get_ack_and_paths(message_id: int) -> tuple[int, list[MessagePath] | None]:
        """Get the current ack count and paths for a message."""
        cursor = await db.conn.execute(
            "SELECT acked, paths FROM messages WHERE id = ?", (message_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return 0, None
        return row["acked"], MessageRepository._parse_paths(row["paths"])

    @staticmethod
    async def get_by_id(message_id: int) -> "Message | None":
        """Look up a message by its ID."""
        cursor = await db.conn.execute(
            """
            SELECT id, type, conversation_key, text, sender_timestamp, received_at,
                   paths, txt_type, signature, outgoing, acked
            FROM messages
            WHERE id = ?
            """,
            (message_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return None

        return Message(
            id=row["id"],
            type=row["type"],
            conversation_key=row["conversation_key"],
            text=row["text"],
            sender_timestamp=row["sender_timestamp"],
            received_at=row["received_at"],
            paths=MessageRepository._parse_paths(row["paths"]),
            txt_type=row["txt_type"],
            signature=row["signature"],
            outgoing=bool(row["outgoing"]),
            acked=row["acked"],
        )

    @staticmethod
    async def get_by_content(
        msg_type: str,
        conversation_key: str,
        text: str,
        sender_timestamp: int | None,
    ) -> "Message | None":
        """Look up a message by its unique content fields."""
        cursor = await db.conn.execute(
            """
            SELECT id, type, conversation_key, text, sender_timestamp, received_at,
                   paths, txt_type, signature, outgoing, acked
            FROM messages
            WHERE type = ? AND conversation_key = ? AND text = ?
              AND (sender_timestamp = ? OR (sender_timestamp IS NULL AND ? IS NULL))
            """,
            (msg_type, conversation_key, text, sender_timestamp, sender_timestamp),
        )
        row = await cursor.fetchone()
        if not row:
            return None

        paths = None
        if row["paths"]:
            try:
                paths_data = json.loads(row["paths"])
                paths = [
                    MessagePath(path=p["path"], received_at=p["received_at"]) for p in paths_data
                ]
            except (json.JSONDecodeError, KeyError):
                pass

        return Message(
            id=row["id"],
            type=row["type"],
            conversation_key=row["conversation_key"],
            text=row["text"],
            sender_timestamp=row["sender_timestamp"],
            received_at=row["received_at"],
            paths=paths,
            txt_type=row["txt_type"],
            signature=row["signature"],
            outgoing=bool(row["outgoing"]),
            acked=row["acked"],
        )

    @staticmethod
    async def get_unread_counts(name: str | None = None) -> dict:
        """Get unread message counts, mention flags, and last message times for all conversations.

        Args:
            name: User's display name for @[name] mention detection. If None, mentions are skipped.

        Returns:
            Dict with 'counts', 'mentions', and 'last_message_times' keys.
        """
        counts: dict[str, int] = {}
        mention_flags: dict[str, bool] = {}
        last_message_times: dict[str, int] = {}

        mention_token = f"@[{name}]" if name else None

        # Channel unreads
        cursor = await db.conn.execute(
            """
            SELECT m.conversation_key,
                   COUNT(*) as unread_count,
                   SUM(CASE
                           WHEN ? <> '' AND INSTR(LOWER(m.text), LOWER(?)) > 0 THEN 1
                           ELSE 0
                       END) > 0 as has_mention
            FROM messages m
            JOIN channels c ON m.conversation_key = c.key
            WHERE m.type = 'CHAN' AND m.outgoing = 0
              AND m.received_at > COALESCE(c.last_read_at, 0)
            GROUP BY m.conversation_key
            """,
            (mention_token or "", mention_token or ""),
        )
        rows = await cursor.fetchall()
        for row in rows:
            state_key = f"channel-{row['conversation_key']}"
            counts[state_key] = row["unread_count"]
            if mention_token and row["has_mention"]:
                mention_flags[state_key] = True

        # Contact unreads
        cursor = await db.conn.execute(
            """
            SELECT m.conversation_key,
                   COUNT(*) as unread_count,
                   SUM(CASE
                           WHEN ? <> '' AND INSTR(LOWER(m.text), LOWER(?)) > 0 THEN 1
                           ELSE 0
                       END) > 0 as has_mention
            FROM messages m
            JOIN contacts ct ON m.conversation_key = ct.public_key
            WHERE m.type = 'PRIV' AND m.outgoing = 0
              AND m.received_at > COALESCE(ct.last_read_at, 0)
            GROUP BY m.conversation_key
            """,
            (mention_token or "", mention_token or ""),
        )
        rows = await cursor.fetchall()
        for row in rows:
            state_key = f"contact-{row['conversation_key']}"
            counts[state_key] = row["unread_count"]
            if mention_token and row["has_mention"]:
                mention_flags[state_key] = True

        # Last message times for all conversations (including read ones)
        cursor = await db.conn.execute(
            """
            SELECT type, conversation_key, MAX(received_at) as last_message_time
            FROM messages
            GROUP BY type, conversation_key
            """
        )
        rows = await cursor.fetchall()
        for row in rows:
            prefix = "channel" if row["type"] == "CHAN" else "contact"
            state_key = f"{prefix}-{row['conversation_key']}"
            last_message_times[state_key] = row["last_message_time"]

        return {
            "counts": counts,
            "mentions": mention_flags,
            "last_message_times": last_message_times,
        }

    @staticmethod
    async def count_dm_messages(contact_key: str) -> int:
        """Count total DM messages for a contact."""
        cursor = await db.conn.execute(
            "SELECT COUNT(*) as cnt FROM messages WHERE type = 'PRIV' AND conversation_key = ?",
            (contact_key.lower(),),
        )
        row = await cursor.fetchone()
        return row["cnt"] if row else 0

    @staticmethod
    async def count_channel_messages_by_sender(sender_key: str) -> int:
        """Count channel messages sent by a specific contact."""
        cursor = await db.conn.execute(
            "SELECT COUNT(*) as cnt FROM messages WHERE type = 'CHAN' AND sender_key = ?",
            (sender_key.lower(),),
        )
        row = await cursor.fetchone()
        return row["cnt"] if row else 0

    @staticmethod
    async def get_most_active_rooms(sender_key: str, limit: int = 5) -> list[tuple[str, str, int]]:
        """Get channels where a contact has sent the most messages.

        Returns list of (channel_key, channel_name, message_count) tuples.
        """
        cursor = await db.conn.execute(
            """
            SELECT m.conversation_key, COALESCE(c.name, m.conversation_key) as channel_name,
                   COUNT(*) as cnt
            FROM messages m
            LEFT JOIN channels c ON m.conversation_key = c.key
            WHERE m.type = 'CHAN' AND m.sender_key = ?
            GROUP BY m.conversation_key
            ORDER BY cnt DESC
            LIMIT ?
            """,
            (sender_key.lower(), limit),
        )
        rows = await cursor.fetchall()
        return [(row["conversation_key"], row["channel_name"], row["cnt"]) for row in rows]


class RawPacketRepository:
    @staticmethod
    async def create(data: bytes, timestamp: int | None = None) -> tuple[int, bool]:
        """
        Create a raw packet with payload-based deduplication.

        Returns (packet_id, is_new) tuple:
        - is_new=True: New packet stored, packet_id is the new row ID
        - is_new=False: Duplicate payload detected, packet_id is the existing row ID

        Deduplication is based on the SHA-256 hash of the packet payload
        (excluding routing/path information).
        """
        ts = timestamp if timestamp is not None else int(time.time())

        # Compute payload hash for deduplication
        payload = extract_payload(data)
        if payload:
            payload_hash = sha256(payload).hexdigest()
        else:
            # For malformed packets, hash the full data
            payload_hash = sha256(data).hexdigest()

        # Check if this payload already exists
        cursor = await db.conn.execute(
            "SELECT id FROM raw_packets WHERE payload_hash = ?", (payload_hash,)
        )
        existing = await cursor.fetchone()

        if existing:
            # Duplicate - return existing packet ID
            logger.debug(
                "Duplicate payload detected (hash=%s..., existing_id=%d)",
                payload_hash[:12],
                existing["id"],
            )
            return (existing["id"], False)

        # New packet - insert with hash
        try:
            cursor = await db.conn.execute(
                "INSERT INTO raw_packets (timestamp, data, payload_hash) VALUES (?, ?, ?)",
                (ts, data, payload_hash),
            )
            await db.conn.commit()
            assert cursor.lastrowid is not None  # INSERT always returns a row ID
            return (cursor.lastrowid, True)
        except sqlite3.IntegrityError:
            # Race condition: another insert with same payload_hash happened between
            # our SELECT and INSERT. This is expected for duplicate packets arriving
            # close together. Query again to get the existing ID.
            logger.debug(
                "Duplicate packet detected via race condition (payload_hash=%s), dropping",
                payload_hash[:16],
            )
            cursor = await db.conn.execute(
                "SELECT id FROM raw_packets WHERE payload_hash = ?", (payload_hash,)
            )
            existing = await cursor.fetchone()
            if existing:
                return (existing["id"], False)
            # This shouldn't happen, but if it does, re-raise
            raise

    @staticmethod
    async def get_undecrypted_count() -> int:
        """Get count of undecrypted packets (those without a linked message)."""
        cursor = await db.conn.execute(
            "SELECT COUNT(*) as count FROM raw_packets WHERE message_id IS NULL"
        )
        row = await cursor.fetchone()
        return row["count"] if row else 0

    @staticmethod
    async def get_oldest_undecrypted() -> int | None:
        """Get timestamp of oldest undecrypted packet, or None if none exist."""
        cursor = await db.conn.execute(
            "SELECT MIN(timestamp) as oldest FROM raw_packets WHERE message_id IS NULL"
        )
        row = await cursor.fetchone()
        return row["oldest"] if row and row["oldest"] is not None else None

    @staticmethod
    async def get_all_undecrypted() -> list[tuple[int, bytes, int]]:
        """Get all undecrypted packets as (id, data, timestamp) tuples."""
        cursor = await db.conn.execute(
            "SELECT id, data, timestamp FROM raw_packets WHERE message_id IS NULL ORDER BY timestamp ASC"
        )
        rows = await cursor.fetchall()
        return [(row["id"], bytes(row["data"]), row["timestamp"]) for row in rows]

    @staticmethod
    async def mark_decrypted(packet_id: int, message_id: int) -> None:
        """Link a raw packet to its decrypted message."""
        await db.conn.execute(
            "UPDATE raw_packets SET message_id = ? WHERE id = ?",
            (message_id, packet_id),
        )
        await db.conn.commit()

    @staticmethod
    async def prune_old_undecrypted(max_age_days: int) -> int:
        """Delete undecrypted packets older than max_age_days. Returns count deleted."""
        cutoff = int(time.time()) - (max_age_days * 86400)
        cursor = await db.conn.execute(
            "DELETE FROM raw_packets WHERE message_id IS NULL AND timestamp < ?",
            (cutoff,),
        )
        await db.conn.commit()
        return cursor.rowcount

    @staticmethod
    async def purge_linked_to_messages() -> int:
        """Delete raw packets that are already linked to a stored message."""
        cursor = await db.conn.execute("DELETE FROM raw_packets WHERE message_id IS NOT NULL")
        await db.conn.commit()
        return cursor.rowcount

    @staticmethod
    async def get_undecrypted_text_messages() -> list[tuple[int, bytes, int]]:
        """Get all undecrypted TEXT_MESSAGE packets as (id, data, timestamp) tuples.

        Filters raw packets to only include those with PayloadType.TEXT_MESSAGE (0x02).
        These are direct messages that can be decrypted with contact ECDH keys.
        """
        cursor = await db.conn.execute(
            "SELECT id, data, timestamp FROM raw_packets WHERE message_id IS NULL ORDER BY timestamp ASC"
        )
        rows = await cursor.fetchall()

        # Filter for TEXT_MESSAGE packets
        result = []
        for row in rows:
            data = bytes(row["data"])
            payload_type = get_packet_payload_type(data)
            if payload_type == PayloadType.TEXT_MESSAGE:
                result.append((row["id"], data, row["timestamp"]))

        return result


class AppSettingsRepository:
    """Repository for app_settings table (single-row pattern)."""

    @staticmethod
    async def get() -> AppSettings:
        """Get the current app settings.

        Always returns settings - creates default row if needed (migration handles initial row).
        """
        cursor = await db.conn.execute(
            """
            SELECT max_radio_contacts, favorites, auto_decrypt_dm_on_advert,
                   sidebar_sort_order, last_message_times, preferences_migrated,
                   advert_interval, last_advert_time, bots
            FROM app_settings WHERE id = 1
            """
        )
        row = await cursor.fetchone()

        if not row:
            # Should not happen after migration, but handle gracefully
            return AppSettings()

        # Parse favorites JSON
        favorites = []
        if row["favorites"]:
            try:
                favorites_data = json.loads(row["favorites"])
                favorites = [Favorite(**f) for f in favorites_data]
            except (json.JSONDecodeError, TypeError, KeyError) as e:
                logger.warning(
                    "Failed to parse favorites JSON, using empty list: %s (data=%r)",
                    e,
                    row["favorites"][:100] if row["favorites"] else None,
                )
                favorites = []

        # Parse last_message_times JSON
        last_message_times: dict[str, int] = {}
        if row["last_message_times"]:
            try:
                last_message_times = json.loads(row["last_message_times"])
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning(
                    "Failed to parse last_message_times JSON, using empty dict: %s",
                    e,
                )
                last_message_times = {}

        # Parse bots JSON
        bots: list[BotConfig] = []
        if row["bots"]:
            try:
                bots_data = json.loads(row["bots"])
                bots = [BotConfig(**b) for b in bots_data]
            except (json.JSONDecodeError, TypeError, KeyError) as e:
                logger.warning(
                    "Failed to parse bots JSON, using empty list: %s (data=%r)",
                    e,
                    row["bots"][:100] if row["bots"] else None,
                )
                bots = []

        # Validate sidebar_sort_order (fallback to "recent" if invalid)
        sort_order = row["sidebar_sort_order"]
        if sort_order not in ("recent", "alpha"):
            sort_order = "recent"

        return AppSettings(
            max_radio_contacts=row["max_radio_contacts"],
            favorites=favorites,
            auto_decrypt_dm_on_advert=bool(row["auto_decrypt_dm_on_advert"]),
            sidebar_sort_order=sort_order,
            last_message_times=last_message_times,
            preferences_migrated=bool(row["preferences_migrated"]),
            advert_interval=row["advert_interval"] or 0,
            last_advert_time=row["last_advert_time"] or 0,
            bots=bots,
        )

    @staticmethod
    async def update(
        max_radio_contacts: int | None = None,
        favorites: list[Favorite] | None = None,
        auto_decrypt_dm_on_advert: bool | None = None,
        sidebar_sort_order: str | None = None,
        last_message_times: dict[str, int] | None = None,
        preferences_migrated: bool | None = None,
        advert_interval: int | None = None,
        last_advert_time: int | None = None,
        bots: list[BotConfig] | None = None,
    ) -> AppSettings:
        """Update app settings. Only provided fields are updated."""
        updates = []
        params: list[Any] = []

        if max_radio_contacts is not None:
            updates.append("max_radio_contacts = ?")
            params.append(max_radio_contacts)

        if favorites is not None:
            updates.append("favorites = ?")
            favorites_json = json.dumps([f.model_dump() for f in favorites])
            params.append(favorites_json)

        if auto_decrypt_dm_on_advert is not None:
            updates.append("auto_decrypt_dm_on_advert = ?")
            params.append(1 if auto_decrypt_dm_on_advert else 0)

        if sidebar_sort_order is not None:
            updates.append("sidebar_sort_order = ?")
            params.append(sidebar_sort_order)

        if last_message_times is not None:
            updates.append("last_message_times = ?")
            params.append(json.dumps(last_message_times))

        if preferences_migrated is not None:
            updates.append("preferences_migrated = ?")
            params.append(1 if preferences_migrated else 0)

        if advert_interval is not None:
            updates.append("advert_interval = ?")
            params.append(advert_interval)

        if last_advert_time is not None:
            updates.append("last_advert_time = ?")
            params.append(last_advert_time)

        if bots is not None:
            updates.append("bots = ?")
            bots_json = json.dumps([b.model_dump() for b in bots])
            params.append(bots_json)

        if updates:
            query = f"UPDATE app_settings SET {', '.join(updates)} WHERE id = 1"
            await db.conn.execute(query, params)
            await db.conn.commit()

        return await AppSettingsRepository.get()

    @staticmethod
    async def add_favorite(fav_type: Literal["channel", "contact"], fav_id: str) -> AppSettings:
        """Add a favorite, avoiding duplicates."""
        settings = await AppSettingsRepository.get()

        # Check if already favorited
        if any(f.type == fav_type and f.id == fav_id for f in settings.favorites):
            return settings

        new_favorites = settings.favorites + [Favorite(type=fav_type, id=fav_id)]
        return await AppSettingsRepository.update(favorites=new_favorites)

    @staticmethod
    async def remove_favorite(fav_type: Literal["channel", "contact"], fav_id: str) -> AppSettings:
        """Remove a favorite."""
        settings = await AppSettingsRepository.get()
        new_favorites = [
            f for f in settings.favorites if not (f.type == fav_type and f.id == fav_id)
        ]
        return await AppSettingsRepository.update(favorites=new_favorites)

    @staticmethod
    async def migrate_preferences_from_frontend(
        favorites: list[dict],
        sort_order: str,
        last_message_times: dict[str, int],
    ) -> tuple[AppSettings, bool]:
        """Migrate all preferences from frontend localStorage.

        This is a one-time migration. If already migrated, returns current settings
        without overwriting. Returns (settings, did_migrate) tuple.
        """
        settings = await AppSettingsRepository.get()

        if settings.preferences_migrated:
            # Already migrated, don't overwrite
            return settings, False

        # Convert frontend favorites format to Favorite objects
        new_favorites = []
        for f in favorites:
            if f.get("type") in ("channel", "contact") and f.get("id"):
                new_favorites.append(Favorite(type=f["type"], id=f["id"]))

        # Update with migrated preferences and mark as migrated
        settings = await AppSettingsRepository.update(
            favorites=new_favorites,
            sidebar_sort_order=sort_order if sort_order in ("recent", "alpha") else "recent",
            last_message_times=last_message_times,
            preferences_migrated=True,
        )

        return settings, True


class StatisticsRepository:
    @staticmethod
    async def _activity_counts(*, contact_type: int, exclude: bool = False) -> dict[str, int]:
        """Get time-windowed counts for contacts/repeaters heard."""
        now = int(time.time())
        op = "!=" if exclude else "="
        cursor = await db.conn.execute(
            f"""
            SELECT
                SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS last_hour,
                SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS last_24_hours,
                SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS last_week
            FROM contacts
            WHERE type {op} ? AND last_seen IS NOT NULL
            """,
            (now - SECONDS_1H, now - SECONDS_24H, now - SECONDS_7D, contact_type),
        )
        row = await cursor.fetchone()
        assert row is not None  # Aggregate query always returns a row
        return {
            "last_hour": row["last_hour"] or 0,
            "last_24_hours": row["last_24_hours"] or 0,
            "last_week": row["last_week"] or 0,
        }

    @staticmethod
    async def get_all() -> dict:
        """Aggregate all statistics from existing tables."""
        now = int(time.time())

        # Top 5 busiest channels in last 24h
        cursor = await db.conn.execute(
            """
            SELECT m.conversation_key, COALESCE(c.name, m.conversation_key) AS channel_name,
                   COUNT(*) AS message_count
            FROM messages m
            LEFT JOIN channels c ON m.conversation_key = c.key
            WHERE m.type = 'CHAN' AND m.received_at >= ?
            GROUP BY m.conversation_key
            ORDER BY COUNT(*) DESC
            LIMIT 5
            """,
            (now - SECONDS_24H,),
        )
        rows = await cursor.fetchall()
        busiest_channels_24h = [
            {
                "channel_key": row["conversation_key"],
                "channel_name": row["channel_name"],
                "message_count": row["message_count"],
            }
            for row in rows
        ]

        # Entity counts
        cursor = await db.conn.execute("SELECT COUNT(*) AS cnt FROM contacts WHERE type != 2")
        row = await cursor.fetchone()
        assert row is not None
        contact_count: int = row["cnt"]

        cursor = await db.conn.execute("SELECT COUNT(*) AS cnt FROM contacts WHERE type = 2")
        row = await cursor.fetchone()
        assert row is not None
        repeater_count: int = row["cnt"]

        cursor = await db.conn.execute("SELECT COUNT(*) AS cnt FROM channels")
        row = await cursor.fetchone()
        assert row is not None
        channel_count: int = row["cnt"]

        # Packet split
        cursor = await db.conn.execute(
            """
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN message_id IS NOT NULL THEN 1 ELSE 0 END) AS decrypted
            FROM raw_packets
            """
        )
        pkt_row = await cursor.fetchone()
        assert pkt_row is not None
        total_packets = pkt_row["total"] or 0
        decrypted_packets = pkt_row["decrypted"] or 0
        undecrypted_packets = total_packets - decrypted_packets

        # Message type counts
        cursor = await db.conn.execute("SELECT COUNT(*) AS cnt FROM messages WHERE type = 'PRIV'")
        row = await cursor.fetchone()
        assert row is not None
        total_dms: int = row["cnt"]

        cursor = await db.conn.execute("SELECT COUNT(*) AS cnt FROM messages WHERE type = 'CHAN'")
        row = await cursor.fetchone()
        assert row is not None
        total_channel_messages: int = row["cnt"]

        # Outgoing count
        cursor = await db.conn.execute("SELECT COUNT(*) AS cnt FROM messages WHERE outgoing = 1")
        row = await cursor.fetchone()
        assert row is not None
        total_outgoing: int = row["cnt"]

        # Activity windows
        contacts_heard = await StatisticsRepository._activity_counts(contact_type=2, exclude=True)
        repeaters_heard = await StatisticsRepository._activity_counts(contact_type=2)

        return {
            "busiest_channels_24h": busiest_channels_24h,
            "contact_count": contact_count,
            "repeater_count": repeater_count,
            "channel_count": channel_count,
            "total_packets": total_packets,
            "decrypted_packets": decrypted_packets,
            "undecrypted_packets": undecrypted_packets,
            "total_dms": total_dms,
            "total_channel_messages": total_channel_messages,
            "total_outgoing": total_outgoing,
            "contacts_heard": contacts_heard,
            "repeaters_heard": repeaters_heard,
        }
