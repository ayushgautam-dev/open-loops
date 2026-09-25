#input_type_name: EnrichFacesInput
#output_type_name: EnrichFacesResult
#function_name: enrich_faces

import hashlib
import re
from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

# Fills in company logos and person avatars so the app shows faces instead of initials.
#
# Where the pictures come from, in order of quality:
#   1. Slack profile photos — real faces, for anyone in the connected workspace. This is
#      the only source that yields actual photographs, so it runs first.
#   2. Gravatar, keyed on the email we already hold. Requested with d=404 so the app's
#      initials fallback shows rather than a meaningless grey silhouette.
#   3. Company logo, from the company's own domain via Google's favicon service. The app
#      renders this as a small badge on the person's avatar, never as their face.
#
# Google Contacts was tried and dropped: every one of its photo URLs is the default
# silhouette, so it adds nothing but requests.
#
# Nothing is scraped and no extra account is needed. Only URLs are stored, never images,
# and the app falls back to initials on its own if a URL 404s.

FREE_MAIL = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
    "yahoo.com", "yahoo.co.in", "icloud.com", "me.com", "proton.me",
    "protonmail.com", "aol.com", "gmx.com", "mail.com", "zoho.com",
    "rediffmail.com", "fastmail.com", "hey.com", "pm.me", "duck.com",
}


class EnrichFacesInput(BaseModel):
    refresh: bool = False   # True = recompute even where a URL already exists
    limit: int = 500


class EnrichFacesResult(BaseModel):
    companies_updated: int = 0
    people_updated: int = 0
    skipped: int = 0
    notes: list[str] = []


def _domain(raw: str | None) -> str:
    d = (raw or "").strip().lower()
    if "@" in d:
        d = d.split("@")[-1]
    d = re.sub(r"^https?://", "", d).split("/")[0]
    if d.startswith("www."):
        d = d[4:]
    return d if re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", d or "") else ""


def _logo_url(domain: str) -> str:
    # Google's favicon service resolves any live domain and returns a generic globe
    # when it can't — good enough, and the app treats a broken image as "no logo".
    return f"https://www.google.com/s2/favicons?domain={domain}&sz=128"


def _slack_photos(pod) -> dict[str, str]:
    """email -> real profile photo, for everyone in the connected Slack workspace."""
    out: dict[str, str] = {}
    try:
        resp = pod.connectors.execute("slack", "users_list", {"limit": 400}).to_dict()
        r = resp.get("result", resp)
        body = r.get("data", r) if isinstance(r, dict) else {}
        members = body.get("members") or r.get("members") or []
    except Exception:
        return out                      # Slack not connected — not an error here
    for m in members:
        if m.get("deleted") or m.get("is_bot"):
            continue
        prof = m.get("profile") or {}
        email = (prof.get("email") or "").strip().lower()
        img = prof.get("image_512") or prof.get("image_192") or prof.get("image_72") or ""
        # Slack hands out gravatar/blank placeholders too; those are not real faces.
        if email and img and "secure.gravatar" not in img and "/avatar/" not in img:
            out[email] = img
    return out


def _avatar_url(email: str) -> str:
    # Gravatar with d=404 so the app's initials fallback shows when there's no photo,
    # rather than a meaningless default silhouette.
    h = hashlib.sha256(email.strip().lower().encode()).hexdigest()
    return f"https://www.gravatar.com/avatar/{h}?s=200&d=404"


async def enrich_faces(ctx: FunctionContext, data: EnrichFacesInput) -> EnrichFacesResult:
    pod = Pod.from_env()
    res = EnrichFacesResult()

    def rows(sql: str) -> list[dict]:
        return pod.query(sql).to_dict()["items"]

    # ---- companies: logo from their own domain ----
    for c in rows(f"select id, name, domain, logo_url from companies limit {data.limit}"):
        if c.get("logo_url") and not data.refresh:
            res.skipped += 1
            continue
        dom = _domain(c.get("domain"))
        if not dom or dom in FREE_MAIL:
            res.skipped += 1
            continue
        pod.table("companies").update(c["id"], {"logo_url": _logo_url(dom)})
        res.companies_updated += 1

    # ---- people: a real Slack photo where one exists, else gravatar ----
    slack = _slack_photos(pod)
    from_slack = 0
    for p in rows(f"select id, email, company_id, avatar_url from people limit {data.limit}"):
        if p.get("avatar_url") and not data.refresh:
            res.skipped += 1
            continue
        email = (p.get("email") or "").strip().lower()
        if not email or "@" not in email:
            res.skipped += 1
            continue
        url = slack.get(email)
        if url:
            from_slack += 1
        else:
            url = _avatar_url(email)
        pod.table("people").update(p["id"], {"avatar_url": url})
        res.people_updated += 1

    res.notes.append(
        f"{res.companies_updated} logos, {res.people_updated} avatars "
        f"({from_slack} real photos from Slack), {res.skipped} left alone."
    )
    return res
