#input_type_name: SourcesInput
#output_type_name: SourcesResult
#function_name: sources_status

# What the Settings and onboarding screens show: every source this product can read,
# whether it is installed for the org, and whether *you* have connected it.
#
# Being unconnected is a normal state, not an error. Every source is optional and
# skippable — someone with no Granola still gets a working product from mail alone.

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext, Pod

# app id -> (label, why it matters, leaned on heavily, shown during onboarding)
#
# Order is the order they appear. The first three are the onboarding set, and Gmail
# is deliberately first: it is the one source that makes the product work on its own.
# Anything added later lands below them and stays out of onboarding, which should
# never grow into a list somebody has to read.
KNOWN = [
    ("gmail", "Gmail", "Threads, who spoke last, and what was asked of you.", True, True),
    ("google_calendar", "Google Calendar", "Who you are meeting, and what was agreed but never booked.", True, True),
    ("granola", "Granola", "Meeting notes and action items — where a promise made out loud gets written down. Sign in with your own Granola account; the free plan is enough.", False, True),
    ("googlemeet", "Google Meet", "Call transcripts, where Meet recorded one.", False, False),
    ("slack", "Slack", "The channels you invited the app to, where the day's asks land.", False, False),
]


class SourcesInput(BaseModel):
    pass


class SourceOut(BaseModel):
    app: str
    label: str
    why: str
    important: bool
    # Shown on the first-run screen. Everything else lives in Settings.
    onboarding: bool = False
    # Position within its group, so the client never has to know the order.
    order: int = 0
    installed: bool = False
    self_installable: bool = False
    connected: bool = False
    account_label: str | None = None


class SourcesResult(BaseModel):
    sources: list[SourceOut] = Field(default_factory=list)
    connected_count: int = 0
    onboarding_connected_count: int = 0
    errors: list[str] = Field(default_factory=list)


# Sources `connect_source` can install by itself, so a freshly cloned pod never
# sends anybody to an admin console. Kept in step with INSTALL over there.
SELF_INSTALLABLE = {"gmail", "google_calendar", "googlemeet", "granola"}


async def sources_status(ctx: FunctionContext, data: SourcesInput) -> SourcesResult:
    pod = Pod.from_env()
    res = SourcesResult()

    installed: set[str] = set()
    accounts: dict[str, str] = {}
    by_account_id: dict[str, str] = {}
    try:
        st = pod.connectors.status()
        # An MCP install is named by its auth config, not its connector id: Granola and a
        # transcript server both report connector_id "mcp". Indexing on connector_id alone
        # filed Granola under "mcp" and left it looking permanently disconnected.
        for a in (st.get("installed_apps") or st.get("apps") or []):
            if not isinstance(a, dict):
                continue
            for k in ("connector_id", "auth_config_name", "name"):
                v = a.get(k)
                if v:
                    installed.add(str(v).lower())
        for a in (st.get("connected_accounts") or st.get("accounts") or []):
            if not isinstance(a, dict) or a.get("status") != "CONNECTED":
                continue
            label = a.get("display_name") or a.get("email") or ""
            cid = str(a.get("connector_id") or "").lower()
            if cid:
                accounts.setdefault(cid, label)
            by_account_id[str(a.get("id"))] = label

    except Exception as exc:
        res.errors.append(f"connector status unavailable: {str(exc)[:160]}")

    # `status()` names an account only by connector_id, and every MCP server shares the
    # id "mcp" — so Granola and the transcript server are indistinguishable there. The
    # auth config is what carries the real name, so join through it.
    try:
        cfgs = pod.connectors.auth_configs.list().to_dict()
        cfg_items = cfgs.get("items", cfgs) if isinstance(cfgs, dict) else cfgs
        by_cfg_id = {str(c.get("id")): str(c.get("name", "")).lower() for c in cfg_items}

        accts = pod.connectors.accounts.list().to_dict()
        acct_items = accts.get("items", accts) if isinstance(accts, dict) else accts
        for a in acct_items:
            if a.get("status") != "CONNECTED":
                continue
            name = by_cfg_id.get(str(a.get("auth_config_id")))
            if name:
                accounts.setdefault(name, by_account_id.get(str(a.get("id")), "") or a.get("email") or "")
    except Exception as exc:
        res.errors.append(f"account names unavailable: {str(exc)[:120]}")

    for i, (app, label, why, important, onboarding) in enumerate(KNOWN):
        connected = app in accounts
        res.sources.append(SourceOut(
            app=app, label=label, why=why, important=important,
            onboarding=onboarding, order=i,
            # "Installed" means the organisation has it. Not being installed is
            # normal and not a blocker: connect_source sets it up on the way past.
            installed=app in installed or connected,
            self_installable=app in SELF_INSTALLABLE,
            connected=connected,
            account_label=accounts.get(app) or None,
        ))
    res.connected_count = sum(1 for s in res.sources if s.connected)
    res.onboarding_connected_count = sum(
        1 for s in res.sources if s.connected and s.onboarding)
    return res
