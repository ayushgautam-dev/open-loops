#input_type_name: GuardInput
#output_type_name: GuardResult
#function_name: backfill_guard

"""Should a mail-triggered Loose Ends run stand down?

New mail rows fire Loose Ends one run per row, as the row's owner. That is right for
the two emails that arrive while somebody works, and wrong for a first-run import,
which lands hundreds of rows at once — hundreds of runs chewing the same rows. First
run used to stop that by switching the shared trigger off, which paused mail reading
for everyone in the pod while one person set up.

Now first run writes `settings.backfill_until` for its own person instead, and each
triggered run checks it here first. Only that person's triggered runs stand down;
first run reads their mail itself, in a few deliberate passes. Settings are private
per person, so this can only ever see the run owner's own flag.
"""

from datetime import datetime, timezone

from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod


class GuardInput(BaseModel):
    pass


class GuardResult(BaseModel):
    skip: bool = False
    reason: str = ""


def _when(value: str) -> datetime | None:
    try:
        d = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


async def backfill_guard(ctx: FunctionContext, data: GuardInput) -> GuardResult:
    pod = ctx.pod or Pod.from_env()
    try:
        rows = pod.query(
            "select value from settings where key = 'backfill_until' "
            "order by updated_at desc limit 1").to_dict()["items"]
    except Exception as exc:
        # when in doubt, read the mail — a missed extraction is worse than a busy minute
        return GuardResult(reason=f"could not read settings: {str(exc)[:120]}")
    until = _when(rows[0].get("value")) if rows else None
    if until and until > datetime.now(timezone.utc):
        return GuardResult(skip=True, reason=f"first-run import in progress until {until.isoformat()}")
    return GuardResult(reason="no import in progress")
