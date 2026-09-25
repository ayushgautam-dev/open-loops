#input_type_name: ColdPitchSweepInput
#output_type_name: ColdPitchSweepResult
#function_name: cold_pitch_senders
#config_type_name: ColdPitchSweepConfig

"""Deterministic half of the weekly cold-pitch sweep.

Finds every counterparty who has written to the founder `min_pitches` or more
times and has never once been written back to, then drops a plain digest of who
they are and what they sent at /me/autopilot/cold-pitch-sweep/<date>-senders.md.
The workflow's agent node turns that digest into one unsubscribe or decline per
sender. Nothing is sent from here.
"""

import re
from datetime import date, datetime, timezone
from typing import List, Optional

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

# Senders whose address itself says "do not reply to me" — these get an
# unsubscribe rather than a written decline.
AUTOMATED_RE = re.compile(
    r"(no-?reply|do-?not-?reply|donotreply|notification|notifications|mailer-daemon"
    r"|postmaster|bounce|alerts?|newsletter|updates?|system|security|automated)",
    re.I,
)

# Extra addresses to leave out, on top of the owner's own (which are worked out from
# the mail they have actually sent — see `_own_addresses`). Empty by default: nothing
# here may name a particular person, because every clone of this pod runs this code.
DEFAULT_EXCLUDE_EMAILS: List[str] = []

# Platform automation, never a counterparty who can be unsubscribed from. The owner's
# own work domain is added at run time.
DEFAULT_EXCLUDE_DOMAINS = [
    "ops.lemma.work",
    "ops.asur.work",
]

# Mail providers anyone can sign up to: an owner on gmail.com must not exclude all of gmail.
PERSONAL_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com",
    "icloud.com", "me.com", "proton.me", "protonmail.com", "rediffmail.com", "aol.com",
}

DEFAULT_EXCLUDE_RELATIONSHIPS = [
    "investor",
    "partner",
    "teammate",
    "candidate",
    "client",
]


class ColdPitchSweepInput(BaseModel):
    min_pitches: Optional[int] = None
    as_of: Optional[str] = None


class ColdPitchSweepConfig(BaseModel):
    min_pitches: int = 3
    limit: int = 40
    exclude_emails: List[str] = DEFAULT_EXCLUDE_EMAILS
    exclude_domains: List[str] = DEFAULT_EXCLUDE_DOMAINS
    exclude_relationships: List[str] = DEFAULT_EXCLUDE_RELATIONSHIPS


class SenderInfo(BaseModel):
    email: str
    name: Optional[str] = None
    known_as: Optional[str] = None
    pitches: int
    first_seen: str
    last_seen: str
    days_since_last: int
    automated: bool
    recent_subjects: List[str] = []


class ColdPitchSweepResult(BaseModel):
    digest_path: str
    sender_count: int
    senders: List[SenderInfo]


def _sql_list(values: List[str]) -> str:
    # `not in ()` is invalid SQL, so an empty list becomes a value no address can equal
    if not values:
        return "''"
    return ", ".join("'" + v.replace("'", "''") + "'" for v in values)


def _own_addresses(pod) -> List[str]:
    """Every address that is the owner: the ones they send from, plus any address that
    writes in under the owner's own full name (a personal inbox mailing a work one).

    This used to be a hard-coded list of the author's addresses, which meant a clone
    of the pod excluded somebody else's inbox and treated its own owner as a cold
    pitcher whenever they wrote to themselves.
    """
    people = """jsonb_array_elements(case when jsonb_typeof(i.participants::jsonb) = 'array'
                                        then i.participants::jsonb else '[]'::jsonb end) p"""
    try:
        rows = pod.query(f"""
          with sent as (
            select lower(p->>'email') as email, lower(trim(p->>'name')) as name
            from interactions i, {people}
            where i.direction = 'outbound' and p->>'role' = 'from' and p->>'email' is not null
          ),
          -- a full name only ("First Last"): a bare first name is far too common to trust
          me as (select distinct name from sent where name like '% %')
          select email from sent
          union
          select lower(p->>'email') from interactions i, {people}
          where p->>'role' = 'from' and p->>'email' is not null
            and lower(trim(p->>'name')) in (select name from me)
        """).to_dict()["items"]
        return sorted({r["email"] for r in rows if r.get("email")})
    except Exception:
        return []


async def cold_pitch_senders(ctx: FunctionContext, data: ColdPitchSweepInput) -> ColdPitchSweepResult:
    pod = ctx.pod or Pod.from_env()
    cfg = ctx.config or ColdPitchSweepConfig()

    own = _own_addresses(pod)
    exclude_emails = sorted({e.lower() for e in (cfg.exclude_emails or [])} | set(own))
    # the owner's work domain (never a public mail provider) is theirs too
    own_domains = {e.split("@")[1] for e in own if "@" in e} - PERSONAL_DOMAINS

    minimum = int(data.min_pitches or cfg.min_pitches or 3)
    as_of = (data.as_of or datetime.now(timezone.utc).date().isoformat())[:10]

    sql = f"""
    with m as (
      select i.occurred_at, i.subject, i.direction,
             lower((select p->>'email'
                    from jsonb_array_elements(
                           case when jsonb_typeof(i.participants::jsonb) = 'array'
                                then i.participants::jsonb else '[]'::jsonb end) p
                    where p->>'email' is not null
                      and ((i.direction = 'inbound'  and p->>'role' = 'from')
                        or (i.direction = 'outbound' and p->>'role' = 'to'))
                    limit 1)) as counterparty
      from interactions i
      where i.direction in ('inbound', 'outbound')
    )
    select counterparty as email,
           count(*) filter (where direction = 'inbound')  as pitches,
           min(occurred_at)::date as first_seen,
           max(occurred_at)::date as last_seen,
           (array_agg(subject order by occurred_at desc)
              filter (where direction = 'inbound' and subject is not null))[1:3] as recent_subjects
    from m
    where counterparty is not null
      and counterparty not in ({_sql_list(exclude_emails)})
    group by counterparty
    having count(*) filter (where direction = 'inbound') >= {minimum}
       and count(*) filter (where direction = 'outbound') = 0
    order by pitches desc, last_seen desc
    limit {int(cfg.limit or 40)}
    """
    rows = pod.query(sql).to_dict()["items"]
    exclude_domains = tuple(
        {d.lower().lstrip("@") for d in (cfg.exclude_domains or DEFAULT_EXCLUDE_DOMAINS)} | own_domains
    )
    rows = [
        r for r in rows
        if not (r.get("email") or "").lower().endswith(tuple("@" + d for d in exclude_domains))
    ]

    known = {}
    try:
        for p in pod.query(
            "select lower(email) as email, name, relationship from people where email is not null"
        ).to_dict()["items"]:
            known[p["email"]] = p
    except Exception:
        known = {}

    excluded_rel = {r.lower() for r in (cfg.exclude_relationships or DEFAULT_EXCLUDE_RELATIONSHIPS)}
    today = date.fromisoformat(as_of)

    senders: List[SenderInfo] = []
    for r in rows:
        email = (r.get("email") or "").lower()
        person = known.get(email)
        relationship = (person or {}).get("relationship")
        if relationship and relationship.lower() in excluded_rel:
            continue
        last_seen = r.get("last_seen")
        days = (today - date.fromisoformat(str(last_seen)[:10])).days if last_seen else 0
        senders.append(
            SenderInfo(
                email=email,
                name=(person or {}).get("name"),
                known_as=relationship,
                pitches=int(r.get("pitches") or 0),
                first_seen=str(r.get("first_seen"))[:10],
                last_seen=str(last_seen)[:10],
                days_since_last=days,
                automated=bool(AUTOMATED_RE.search(email.split("@")[0])),
                recent_subjects=[s for s in (r.get("recent_subjects") or []) if s][:3],
            )
        )

    digest_path = f"/me/autopilot/cold-pitch-sweep/{as_of}-senders.md"
    pod.files.write_text(digest_path, _digest_markdown(senders, as_of, minimum))

    return ColdPitchSweepResult(
        digest_path=digest_path,
        sender_count=len(senders),
        senders=senders,
    )
