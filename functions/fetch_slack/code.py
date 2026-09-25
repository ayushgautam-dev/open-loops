#input_type_name: FetchSlackInput
#output_type_name: FetchSlackResult
#function_name: fetch_slack

import re
import time
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod

# Deterministic Slack pull, shaped exactly like fetch_recent_emails so the extractor
# reasons about Slack and email the same way. Reads only the conversations the calling
# user is already in (DMs, MPIMs, and channels they belong to). No judgment here.
#
# Degrades quietly: if Slack isn't connected yet, returns connected=False with an empty
# digest rather than raising, so the daily refresh keeps working.


class FetchSlackInput(BaseModel):
    days: int = 14
    max_conversations: int = 40
    messages_per_conversation: int = 8
    snippet_chars: int = 400
    include_channels: bool = True   # False = DMs and group DMs only


class DigestMessage(BaseModel):
    from_name: str
    from_id: str
    direction: str        # "sent" (from me) | "recv"
    date: str             # YYYY-MM-DD
    snippet: str


class DigestConversation(BaseModel):
    thread_ref: str       # slack:<channel_id>
    channel: str          # #eng, or the DM counterparty's name
    kind: str             # dm | group | channel
    participants: list[str]
    message_count: int
    last_date: str
    last_direction: str
    messages: list[DigestMessage]


class FetchSlackResult(BaseModel):
    connected: bool
    my_slack_id: str = ""
    my_name: str = ""
    conversation_count: int = 0
    conversations: list[DigestConversation] = Field(default_factory=list)
    note: str = ""


def _unwrap(resp: dict) -> dict:
    """Connector responses nest the Slack body under result/data in various shapes."""
    r = resp.get("result", resp) if isinstance(resp, dict) else {}
    if isinstance(r, dict) and isinstance(r.get("data"), dict):
        inner = r["data"]
        # Slack's own envelope has ok/messages/channels at this level
        if any(k in inner for k in ("ok", "messages", "channels", "user", "members")):
            return inner
    return r if isinstance(r, dict) else {}


def _date(ts: str | float) -> str:
    try:
        return time.strftime("%Y-%m-%d", time.gmtime(float(ts)))
    except (TypeError, ValueError):
        return ""


def _clean(text: str, limit: int) -> str:
    t = text or ""
    t = re.sub(r"<@([A-Z0-9]+)\|([^>]+)>", r"@\2", t)   # <@U123|priya> -> @priya
    t = re.sub(r"<@([A-Z0-9]+)>", r"@\1", t)
    t = re.sub(r"<(https?://[^|>]+)\|([^>]+)>", r"\2", t)  # keep link text
    t = re.sub(r"<(https?://[^>]+)>", r"\1", t)
    return re.sub(r"\s+", " ", t).strip()[:limit]


async def fetch_slack(ctx: FunctionContext, data: FetchSlackInput) -> FetchSlackResult:
    pod = Pod.from_env()

    def call(op: str, payload: dict) -> dict:
        return _unwrap(pod.connectors.execute("slack", op, payload).to_dict())

    # ---- identity (also our connectivity probe) ----
    try:
        me = call("auth_test", {})
    except Exception as exc:  # not connected / no account / scope missing
        return FetchSlackResult(
            connected=False,
            note=f"Slack is not connected yet ({type(exc).__name__}). "
                 "Connect it in Settings, then this runs on the next refresh.",
        )
    my_id = me.get("user_id") or me.get("user") or ""
    if not my_id:
        return FetchSlackResult(
            connected=False,
            note="Slack responded without an identity — the connection needs re-authorising.",
        )

    # ---- conversations the user is in ----
    types = "im,mpim" + (",public_channel,private_channel" if data.include_channels else "")
    convs = call("users_conversations", {
        "types": types,
        "limit": max(data.max_conversations, 100),
        "exclude_archived": True,
    }).get("channels") or []

    oldest = str(time.time() - data.days * 86400)
    names: dict[str, str] = {}

    def user_name(uid: str) -> str:
        if not uid:
            return "someone"
        if uid not in names:
            try:
                u = call("users_info", {"user": uid}).get("user") or {}
                prof = u.get("profile") or {}
                names[uid] = (prof.get("real_name") or prof.get("display_name")
                              or u.get("real_name") or u.get("name") or uid)
            except Exception:
                names[uid] = uid
        return names[uid]

    shaped: list[DigestConversation] = []
    for c in convs[: data.max_conversations]:
        cid = c.get("id")
        if not cid:
            continue
        is_im, is_mpim = bool(c.get("is_im")), bool(c.get("is_mpim"))
        kind = "dm" if is_im else "group" if is_mpim else "channel"
        try:
            msgs = call("conversations_history", {
                "channel": cid, "oldest": oldest, "limit": 50,
            }).get("messages") or []
        except Exception:
            continue

        real = [m for m in msgs if m.get("type", "message") == "message" and not m.get("subtype")]
        if not real:
            continue
        real.sort(key=lambda m: float(m.get("ts") or 0))

        participants: set[str] = set()
        shaped_msgs: list[DigestMessage] = []
        for m in real[-data.messages_per_conversation:]:
            uid = m.get("user") or m.get("bot_id") or ""
            nm = user_name(uid) if uid != my_id else "you"
            if uid and uid != my_id:
                participants.add(nm)
            shaped_msgs.append(DigestMessage(
                from_name=nm,
                from_id=uid,
                direction="sent" if uid == my_id else "recv",
                date=_date(m.get("ts", 0)),
                snippet=_clean(m.get("text", ""), data.snippet_chars),
            ))

        last = real[-1]
        label = ("#" + c.get("name", "")) if kind == "channel" else (
            user_name(c.get("user") or "") if is_im else ", ".join(sorted(participants)) or "group"
        )
        shaped.append(DigestConversation(
            thread_ref=f"slack:{cid}",
            channel=label,
            kind=kind,
            participants=sorted(participants)[:8],
            message_count=len(real),
            last_date=_date(last.get("ts", 0)),
            last_direction="sent" if (last.get("user") == my_id) else "recv",
            messages=shaped_msgs,
        ))

    shaped.sort(key=lambda x: x.last_date, reverse=True)
    return FetchSlackResult(
        connected=True,
        my_slack_id=my_id,
        my_name=me.get("user") or "",
        conversation_count=len(shaped),
        conversations=shaped,
        note="" if shaped else "Connected, but no conversations in the window.",
    )
