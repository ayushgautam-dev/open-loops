#input_type_name: SyncSlackInput
#output_type_name: SyncSlackResult
#function_name: sync_slack

# Slack -> the interaction ledger. One interaction per conversation per day, because
# a Slack channel is a rolling stream rather than a set of discrete messages: a day's
# exchange in one channel is the unit a person would actually think about.
#
# Scope is honest and deliberate: the app reads only the channels it was invited to.
# Direct messages need a user-level Slack connection rather than an app, so they are
# out of reach today and we do not pretend otherwise.
#
# Polled rather than pushed, once or twice a day. Slack is the one source where near
# real time is not worth the noise.

import re
import time
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod


class SyncSlackInput(BaseModel):
    days: int = 2
    max_conversations: int = 25
    include_channels: bool = True
    batch_size: int = 10


class SyncSlackResult(BaseModel):
    conversations: int = 0
    shaped: int = 0
    recorded: int = 0
    skipped_duplicate: int = 0
    files_written: int = 0
    note: str = ""
    errors: list[str] = Field(default_factory=list)


def _unwrap(resp: dict) -> dict:
    r = resp.get("result", resp) if isinstance(resp, dict) else {}
    inner = r.get("data", r) if isinstance(r, dict) else {}
    return inner if isinstance(inner, dict) else {}


def _clean(text: str) -> str:
    t = re.sub(r"<@([A-Z0-9]+)\|([^>]+)>", r"@\2", text or "")
    t = re.sub(r"<@([A-Z0-9]+)>", r"@\1", t)
    t = re.sub(r"<(https?://[^|>]+)\|([^>]+)>", r"\2", t)
    t = re.sub(r"<(https?://[^>]+)>", r"\1", t)
    return t.strip()


async def sync_slack(ctx: FunctionContext, data: SyncSlackInput) -> SyncSlackResult:
    pod = Pod.from_env()
    res = SyncSlackResult()

    def call(op: str, payload: dict) -> dict:
        return _unwrap(pod.connectors.execute("slack", op, payload).to_dict())

    try:
        me = call("auth_test", {})
        my_id = me.get("user_id") or ""
    except Exception as exc:
        res.errors.append(f"slack identity failed: {str(exc)[:180]}")
        res.note = "Slack is not connected, or the connection needs re-authorising."
        return res

    types = "im,mpim" + (",public_channel,private_channel" if data.include_channels else "")
    try:
        convs = call("users_conversations", {
            "types": types, "limit": max(data.max_conversations, 100),
            "exclude_archived": True,
        }).get("channels") or []
    except Exception as exc:
        res.errors.append(str(exc)[:180])
        return res

    res.conversations = len(convs)
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

    def user_email(uid: str) -> str:
        try:
            u = call("users_info", {"user": uid}).get("user") or {}
            return ((u.get("profile") or {}).get("email") or "").strip().lower()
        except Exception:
            return ""

    interactions: list[dict] = []
    for c in convs[: data.max_conversations]:
        cid = c.get("id")
        if not cid:
            continue
        try:
            msgs = call("conversations_history",
                        {"channel": cid, "oldest": oldest, "limit": 50}).get("messages") or []
        except Exception:
            continue

        real = [m for m in msgs
                if m.get("type", "message") == "message" and not m.get("subtype") and m.get("text")]
        if not real:
            continue
        real.sort(key=lambda m: float(m.get("ts") or 0))

        label = c.get("name") or ("direct message" if c.get("is_im") else cid)
        # Group a conversation by day: one Slack channel on one day is one thing to read.
        by_day: dict[str, list] = {}
        for m in real:
            day = datetime.fromtimestamp(float(m.get("ts") or 0), timezone.utc).strftime("%Y-%m-%d")
            by_day.setdefault(day, []).append(m)

        for day, day_msgs in by_day.items():
            lines, speakers = [], []
            for m in day_msgs:
                uid = m.get("user") or ""
                who = user_name(uid)
                if uid and uid != my_id and who not in speakers:
                    speakers.append(who)
                stamp = datetime.fromtimestamp(
                    float(m.get("ts") or 0), timezone.utc).strftime("%H:%M")
                lines.append(f"[{stamp}] {who}: {_clean(m.get('text', ''))}")

            others = [m.get("user") for m in day_msgs
                      if m.get("user") and m.get("user") != my_id]
            counterpart = user_email(others[0]) if len(set(others)) == 1 and others else ""
            last_ts = float(day_msgs[-1].get("ts") or 0)

            interactions.append({
                "kind": "message",
                "source": "slack",
                "external_id": f"slack:{cid}:{day}",
                "thread_ref": f"slack:{cid}",
                "occurred_at": datetime.fromtimestamp(last_ts, timezone.utc).isoformat(),
                "subject": f"#{label} — {day}" if not c.get("is_im") else f"Slack with {speakers[0] if speakers else 'someone'} — {day}",
                "body": "\n".join(lines)[:15000],
                "direction": "inbound" if others else "outbound",
                "addressed_to_me": True,
                "person_email": counterpart,
                "company_domain": counterpart.split("@")[-1] if "@" in counterpart else None,
                "participants": [{"name": s, "role": "speaker"} for s in speakers[:12]],
            })

    res.shaped = len(interactions)
    for i in range(0, len(interactions), data.batch_size):
        chunk = interactions[i:i + data.batch_size]
        try:
            out = pod.functions.run("record_interaction", {"interactions": chunk}).to_dict()
        except Exception as exc:
            res.errors.append(f"batch at {i}: {str(exc)[:150]}")
            continue
        d = out.get("output_data") or {}
        res.recorded += d.get("created", 0)
        res.skipped_duplicate += d.get("skipped_duplicate", 0)
        res.files_written += d.get("files_written", 0)

    if not interactions:
        res.note = ("Nothing new in the channels the app was invited to. Add it to the "
                    "channels where work actually gets asked for.")
    return res
