#input_type_name: PendingInput
#output_type_name: PendingResult
#function_name: pending_interactions

# Hands the extractor its work: interactions nobody has read yet, with their body
# text pulled back out of the file store, so the agent gets everything in one call.
#
# This is the whole reason the ledger exists. The extractor no longer knows or cares
# whether something came from Gmail, Granola, Meet or Slack — it reads rows.

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod

MAX_BODY = 12000


class PendingInput(BaseModel):
    limit: int = 25
    body_chars: int = MAX_BODY
    # Set when re-running an improved extractor over history that was already read.
    include_extracted: bool = False


class PendingItem(BaseModel):
    id: str
    kind: str
    source: str
    occurred_at: str | None = None
    subject: str | None = None
    direction: str | None = None
    addressed_to_me: bool = True
    thread_ref: str | None = None
    person_email: str | None = None
    participants: list[dict] = Field(default_factory=list)
    body: str = ""


class ExistingLoop(BaseModel):
    person_email: str
    kind: str
    obligation: str


class PendingResult(BaseModel):
    items: list[PendingItem] = Field(default_factory=list)
    remaining: int = 0
    # Loops already open with the same people. The extractor must read these before
    # writing, so the same obligation phrased differently does not become a second row.
    already_open: list[ExistingLoop] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


def _counterpart(participants: list, direction: str | None, me: str) -> str:
    if not isinstance(participants, list):
        return ""
    def em(p):
        return (p.get("email") or "").strip().lower() if isinstance(p, dict) else ""
    if direction == "outbound":
        for p in participants:
            if isinstance(p, dict) and p.get("role") == "to" and em(p) and em(p) != me:
                return em(p)
    for p in participants:
        if isinstance(p, dict) and p.get("role") == "from" and em(p) and em(p) != me:
            return em(p)
    for p in participants:
        if em(p) and em(p) != me:
            return em(p)
    return ""


async def pending_interactions(ctx: FunctionContext, data: PendingInput) -> PendingResult:
    pod = Pod.from_env()
    res = PendingResult()
    me = (ctx.user_email or "").lower()

    def rows(sql: str) -> list[dict]:
        return pod.query(sql).to_dict()["items"]

    where = "" if data.include_extracted else "where extracted_at is null"
    limit = max(1, min(60, data.limit))

    found = rows(
        f"select id, kind, source, occurred_at, subject, direction, addressed_to_me, "
        f"thread_ref, participants, body_ref from interactions {where} "
        f"order by occurred_at desc limit {limit}"
    )
    total = rows(f"select count(*) as n from interactions {where}")
    res.remaining = max(0, int(total[0]["n"]) - len(found)) if total else 0

    for r in found:
        parts = r.get("participants") or []
        body = ""
        ref = r.get("body_ref")
        if ref:
            try:
                body = pod.files.download(ref).decode("utf-8", "replace")[: data.body_chars]
            except Exception as exc:
                res.errors.append(f"body unreadable for {str(r['id'])[:8]}: {str(exc)[:80]}")
        res.items.append(PendingItem(
            id=str(r["id"]),
            kind=r.get("kind") or "email",
            source=r.get("source") or "gmail",
            occurred_at=str(r.get("occurred_at") or "") or None,
            subject=r.get("subject"),
            direction=r.get("direction"),
            addressed_to_me=bool(r.get("addressed_to_me", True)),
            thread_ref=r.get("thread_ref"),
            person_email=_counterpart(parts, r.get("direction"), me) or None,
            participants=parts if isinstance(parts, list) else [],
            body=body,
        ))

    # What is already outstanding with these same people. Word-overlap matching used to
    # decide this and got it wrong whenever the wording differed — "share the hiring
    # decision" and "decide next steps and let him know" are one obligation, and became
    # two rows. So the judgment moves to the agent, and this is what it judges against.
    emails = sorted({i.person_email for i in res.items if i.person_email})
    if emails:
        quoted = ",".join("'" + e.replace("'", "''") + "'" for e in emails[:60])
        try:
            for r in rows(
                f"select p.email as person_email, l.kind, l.obligation "
                f"from loops l join people p on p.id = l.person_id "
                f"where l.status = 'open' and p.email in ({quoted})"
            ):
                res.already_open.append(ExistingLoop(
                    person_email=r.get("person_email") or "",
                    kind=r.get("kind") or "",
                    obligation=r.get("obligation") or "",
                ))
        except Exception as exc:
            res.errors.append(f"could not read open loops: {str(exc)[:100]}")

    return res
