import json
import time
from typing import Any

from app.database import db
from app.models import Message, MessagePath


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
    async def get_channel_stats(conversation_key: str) -> dict:
        """Get channel message statistics: time-windowed counts, first message, unique senders, top senders.

        Returns a dict with message_counts, first_message_at, unique_sender_count, top_senders_24h.
        """
        import time as _time

        now = int(_time.time())
        t_1h = now - 3600
        t_24h = now - 86400
        t_48h = now - 172800
        t_7d = now - 604800

        cursor = await db.conn.execute(
            """
            SELECT COUNT(*) AS all_time,
                SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) AS last_1h,
                SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) AS last_24h,
                SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) AS last_48h,
                SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) AS last_7d,
                MIN(received_at) AS first_message_at,
                COUNT(DISTINCT sender_key) AS unique_sender_count
            FROM messages WHERE type = 'CHAN' AND conversation_key = ?
            """,
            (t_1h, t_24h, t_48h, t_7d, conversation_key),
        )
        row = await cursor.fetchone()
        assert row is not None  # Aggregate query always returns a row

        message_counts = {
            "last_1h": row["last_1h"] or 0,
            "last_24h": row["last_24h"] or 0,
            "last_48h": row["last_48h"] or 0,
            "last_7d": row["last_7d"] or 0,
            "all_time": row["all_time"] or 0,
        }

        cursor2 = await db.conn.execute(
            """
            SELECT COALESCE(sender_name, sender_key, 'Unknown') AS display_name,
                sender_key, COUNT(*) AS cnt
            FROM messages
            WHERE type = 'CHAN' AND conversation_key = ?
                AND received_at >= ? AND sender_key IS NOT NULL
            GROUP BY sender_key ORDER BY cnt DESC LIMIT 5
            """,
            (conversation_key, t_24h),
        )
        top_rows = await cursor2.fetchall()
        top_senders = [
            {
                "sender_name": r["display_name"],
                "sender_key": r["sender_key"],
                "message_count": r["cnt"],
            }
            for r in top_rows
        ]

        return {
            "message_counts": message_counts,
            "first_message_at": row["first_message_at"],
            "unique_sender_count": row["unique_sender_count"] or 0,
            "top_senders_24h": top_senders,
        }

    @staticmethod
    async def get_most_active_rooms(sender_key: str, limit: int = 5) -> list[tuple[str, str, int]]:
        """Get channels where a contact has sent the most messages.

        Returns list of (channel_key, channel_name, message_count) tuples.
        """
        cursor = await db.conn.execute(
            """
            SELECT m.conversation_key, COALESCE(c.name, m.conversation_key) AS channel_name,
                   COUNT(*) AS cnt
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
