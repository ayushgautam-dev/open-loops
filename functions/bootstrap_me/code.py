#input_type_name: BootstrapInput
#output_type_name: BootstrapResult
#function_name: bootstrap_me

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod

# Every table in this pod is row-level secured, so a newly added member starts with a
# genuinely empty app — no tracks, no stages, no voice document. This seeds *their own*
# copy of the defaults.
#
# It runs under the caller's delegated identity, so every row it writes is owned by
# them. It is idempotent: it only creates what is missing, so the app can call it on
# every launch without risk of duplicates.

# Starting points only. Every person runs these differently (or not at all), so the
# defaults are the few steps almost everyone has, with both endings explicit — a single
# "Closed" used to mean both "won" and "they said no". Lem renames and adds stages to match
# the process it actually sees in the person's mail (see the notice skill: "Stages are the
# round's own"), and the refresh autopilot keeps them true.
DEFAULT_TRACKS = [
    {
        "slug": "hiring", "name": "Hiring", "card_shape": "individual",
        "position": 0, "color": "#7c5cff",
        "stages": [
            ("In touch", "You have reached out to them, or they to you, about the role.", False),
            ("Talking", "There is a live conversation — an assignment, interview or call.", False),
            ("Offer", "You have told them an offer is coming, or sent it.", False),
            ("Joined", "They accepted and are joining. Terminal — needs explicit evidence.", True),
            ("Not moving ahead", "Either side said no. Terminal — needs explicit evidence.", True),
        ],
    },
    {
        "slug": "sales", "name": "Sales", "card_shape": "organisation",
        "position": 1, "color": "#14b8a6",
        "stages": [
            ("In touch", "A real prospect with a stated need — not a cold pitch.", False),
            ("Demo", "They have seen the product.", False),
            ("Proposal", "Pricing, a proposal or an LOI is on the table.", False),
            ("Won", "Signed or paying. Terminal — needs explicit evidence.", True),
            ("Lost", "They said no or went with someone else. Terminal — needs explicit evidence.", True),
        ],
    },
    {
        "slug": "fundraising", "name": "Fundraising", "card_shape": "organisation",
        "position": 2, "color": "#d9922a",
        "stages": [
            ("In touch", "An introduction or first contact with the investor.", False),
            ("Pitched", "A pitch meeting has happened or the deck went over.", False),
            ("Diligence", "They are digging in — data room, references, partner meeting.", False),
            ("Committed", "Terms or a commitment. Terminal — needs explicit evidence.", True),
            ("Passed", "They passed. Terminal — needs explicit evidence.", True),
        ],
    },
]

DEFAULT_SOURCES = [
    ("Gmail", "email"),
    ("Google Calendar", "calendar"),
    ("Slack", "messaging"),
    ("Granola", "notes"),
    ("Fireflies", "notes"),
]

DEFAULT_VOICE = """Warm, direct, and short. Lead with the point.
Sign off with just my first name.
Never say "I hope this email finds you well", "circling back", or "per my last email".
Prefer three sentences to six. Ask one clear question, not three.
"""


class BootstrapInput(BaseModel):
    include_examples: bool = True   # seed the three default tracks


class BootstrapResult(BaseModel):
    already_set_up: bool = False
    tracks_created: int = 0
    stages_created: int = 0
    sources_created: int = 0
    settings_created: int = 0
    notes: list[str] = Field(default_factory=list)


async def bootstrap_me(ctx: FunctionContext, data: BootstrapInput) -> BootstrapResult:
    pod = Pod.from_env()
    res = BootstrapResult()

    def rows(sql: str) -> list[dict]:
        return pod.query(sql).to_dict()["items"]

    # Every read below is RLS-scoped to the caller, so "none" means none *for them*.
    mine = {r["slug"] for r in rows("select slug from tracks")}

    if data.include_examples:
        for spec in DEFAULT_TRACKS:
            if spec["slug"] in mine:
                continue
            track = pod.table("tracks").create({
                "slug": spec["slug"], "name": spec["name"],
                "card_shape": spec["card_shape"], "position": spec["position"],
                "color": spec["color"], "archived": False,
            })
            res.tracks_created += 1
            for i, (name, definition, terminal) in enumerate(spec["stages"]):
                pod.table("stages").create({
                    "track_id": track["id"], "name": name, "definition": definition,
                    "position": i, "is_terminal": terminal,
                })
                res.stages_created += 1

    existing_sources = {r["name"] for r in rows("select name from sources")}
    for name, kind in DEFAULT_SOURCES:
        if name not in existing_sources:
            pod.table("sources").create({"name": name, "kind": kind, "status": "not connected"})
            res.sources_created += 1

    existing_keys = {r["key"] for r in rows("select key from settings")}
    if "voice_doc" not in existing_keys:
        pod.table("settings").create({"key": "voice_doc", "value": DEFAULT_VOICE})
        res.settings_created += 1
    if "onboarded_at" not in existing_keys:
        pod.table("settings").create({"key": "onboarded_at", "value": ""})
        res.settings_created += 1

    res.already_set_up = (
        res.tracks_created == 0 and res.sources_created == 0 and res.settings_created == 0
    )
    if res.already_set_up:
        res.notes.append("Nothing to do — this member is already set up.")
    else:
        res.notes.append(
            f"Seeded {res.tracks_created} tracks, {res.stages_created} stages, "
            f"{res.sources_created} sources for {ctx.user_email}."
        )
        pod.table("activity_events").create({
            "icon": "settings",
            "what": "Set up your Open Loops workspace",
            "reason": f"Created your own tracks, stages and settings. "
                      f"Nothing here is shared with anyone else in the org.",
            "happened_at": __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc).isoformat(),
        })
    return res
