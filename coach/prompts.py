# The words Pacer sends to the model, and the checks on what comes back.
# Shared by the proxy (proxy.py) and the scorer (eval.py), so the eval tests exactly what the app uses.
# The model never produces numbers that matter: it picks an intent or names plan edits, and code does the maths.

# Bring in JSON reading and writing.
import json
# Bring in file paths.
import pathlib
# Bring in regular expressions for tidying replies.
import re

# The folder this file is in.
HERE = pathlib.Path(__file__).parent
# The model the laptop runs.
MODEL = "qwen2.5:3b"
# Model settings shared by every call (changing num_ctx would reload the model, so it never changes).
OPTIONS = {"temperature": 0, "num_ctx": 2048, "top_k": 20}

# The in-run intents the app understands.
INTENTS = ["slower", "faster", "hold", "status", "pain", "none"]
# The reply shape for in-run requests: one intent and one short sentence.
INTENT_SCHEMA = {"type": "object", "required": ["intent", "say"], "properties": {"intent": {"enum": INTENTS}, "say": {"type": "string"}}}
# The reply shape for plan changes, written by the app's own code (v4/plans/edits.schema.json).
EDITS_SCHEMA = json.loads((HERE.parent / "v4" / "plans" / "edits.schema.json").read_text(encoding="utf8"))
# The edit names allowed.
OPS = EDITS_SCHEMA["properties"]["edits"]["items"]["properties"]["op"]["enum"]
# The session types a session may be swapped to.
SWAP_TO = EDITS_SCHEMA["properties"]["edits"]["items"]["properties"]["new_type"]["enum"]

# Instructions for the in-run assistant (kept identical between calls so the laptop can reuse its work).
INTENT_SYSTEM = (
    # What the job is.
    "You are the voice coach in a running app. The runner speaks mid-run; pick the one intent that fits.\n"
    # Each intent in plain words.
    "slower: struggling, too hard, tired, breathing hard, blowing up, can't hold it, wants an easier target.\n"
    # The opposite.
    "faster: too easy, feeling good or strong, wants a quicker or harder target, push me.\n"
    # Keeping things as they are.
    "hold: happy with the pace, keep it, this is fine.\n"
    # Questions about progress.
    "status: asks how they are doing, their pace, time, distance, or how far is left.\n"
    # Anything that hurts.
    "pain: a body part hurts: pain, injury, cramp, stitch, a tight or sore calf, knee or hamstring.\n"
    # Everything else.
    "none: anything not about their running (people, dogs, traffic, the view), or unclear.\n"
    # The reply format.
    "Reply as JSON: intent, and say: one short, warm sentence for the runner with no numbers."
# End of the in-run instructions.
)

# The verdicts a plan review can reach (the model picks one first, then the edits that carry it out).
VERDICTS = ["no_change", "ease_next_hard", "rest_soon", "cut_week", "skip_day", "harder_next"]

# Instructions for the post-run plan coach.
PLAN_SYSTEM = (
    # What the job is.
    "You are a careful running coach. Read the runner's feedback and choose ONE verdict:\n"
    # Most of the time nothing changes.
    "no_change: the run went as it should. Most feedback is this. A hard session that felt hard (6 to 8 out of 10) is normal; fresh legs and good energy are normal.\n"
    # Fatigue.
    "ease_next_hard: tired, heavy or dead legs, slept badly, low energy, much too hard, cut short, bonked, stale.\n"
    # Pain or illness.
    "rest_soon: pain, injury, or illness (cold, flu, fever, sore throat).\n"
    # Busy.
    "cut_week: busy, short of time, stressed, wants shorter runs.\n"
    # A day they can't run.
    "skip_day: can't run on a particular day (set day to that date).\n"
    # Too easy.
    "harder_next: a hard session felt too easy more than once.\n"
    # The edits.
    "Then give the edits that carry it out (none for no_change). Allowed edits: swap_session (session_id, new_type), "
    # More edits.
    "move_session (session_id, to_date in the same week), reduce_volume_pct (week, pct up to 10), shift_pace_zone (session_id, direction easier or harder). "
    # The rules.
    "Never change a test or race. Never put two hard days in a row.\n"
    # The reply format.
    "Reply as JSON: verdict, day (a date, or none), edits, and say: one or two short sentences to the runner explaining why, with no numbers."
# End of the plan instructions.
)


# Tidy a sentence for the runner: no numbers (code gives those), short, one line.
def clean_say(text, limit=160):
    # Make sure it is text, on one line.
    t = " ".join(str(text or "").split())
    # Split into sentences.
    parts = re.split(r"(?<=[.!?])\s+", t)
    # Keep only sentences without digits.
    keep = [p for p in parts if not re.search(r"\d", p)]
    # Join what is left.
    t = " ".join(keep).strip()
    # Cut very long replies at a word boundary.
    if len(t) > limit:
        # Trim and add an ellipsis.
        t = t[:limit].rsplit(" ", 1)[0] + "…"
    # The tidy sentence.
    return t


# The messages for an in-run request.
def intent_messages(text):
    # The fixed instructions, then what the runner said.
    return [{"role": "system", "content": INTENT_SYSTEM}, {"role": "user", "content": f'Runner said: "{str(text)[:300]}"'}]


# Read the model's in-run reply into a checked intent.
def parse_intent(raw):
    # Try to read the JSON.
    try:
        # Parse it.
        d = json.loads(raw)
    # Anything that is not JSON.
    except (ValueError, TypeError):
        # Treat it as unclear.
        return {"intent": "none", "say": "", "valid": False}
    # Only accept a known intent.
    intent = d.get("intent") if isinstance(d, dict) and d.get("intent") in INTENTS else "none"
    # The checked reply.
    return {"intent": intent, "say": clean_say(d.get("say") if isinstance(d, dict) else ""), "valid": isinstance(d, dict) and d.get("intent") in INTENTS}


# The reply shape for one plan review: session ids, dates and weeks can only be ones in the plan shown,
# so the model can't invent them (Ollama holds its output to this shape as it writes).
def edits_schema_for(window):
    # A deep copy of the general shape.
    sch = json.loads(json.dumps(EDITS_SCHEMA))
    # The fields of one edit.
    props = sch["properties"]["edits"]["items"]["properties"]
    # Only sessions in the window (rest days can't be swapped to rest, but can become a run).
    props["session_id"] = {"enum": [w["id"] for w in window] or ["none"]}
    # Only dates in the window.
    props["to_date"] = {"enum": [w["date"] for w in window] or ["none"]}
    # Only weeks in the window.
    props["week"] = {"enum": sorted({w["week"] for w in window}) or [1]}
    # Cuts of 1 to 10 %.
    props["pct"] = {"type": "integer", "minimum": 1, "maximum": 10}
    # The verdict first, then the day it's about, then the edits and the explanation (the model writes them in this order).
    sch["properties"] = {"verdict": {"enum": VERDICTS}, "day": {"enum": [w["date"] for w in window] + ["none"]}, **sch["properties"]}
    # All four are needed.
    sch["required"] = ["verdict", "day", "edits", "say"]
    # The shape.
    return sch


# The effort each session type should feel (1-10), as in the app's plan (v4/js/training.js).
RPE_TARGET = {"easy": (2, 4), "recovery": (1, 3), "strides": (2, 4), "hillsprints": (3, 5), "long": (3, 5), "sub": (5, 7), "hills": (7, 8), "rehearsal": (7, 8), "sharpener": (6, 7), "test": (9, 10), "race": (9, 10)}
# Full day names by their short form.
DAY_NAMES = {"Mon": "monday", "Tue": "tuesday", "Wed": "wednesday", "Thu": "thursday", "Fri": "friday", "Sat": "saturday", "Sun": "sunday"}


# Facts worked out by code to help the model read the feedback (it still makes the call).
def facts(feedback, window):
    # The facts found.
    out = []
    # The session type and effort given.
    kind, rpe = feedback.get("session"), feedback.get("rpe")
    # Compare the effort with what the session should feel like.
    if kind in RPE_TARGET and isinstance(rpe, (int, float)):
        # The target range.
        lo, hi = RPE_TARGET[kind]
        # Say how it compares.
        out.append(f"Effort {rpe}/10 was {'as planned' if lo <= rpe <= hi else 'harder than planned' if rpe > hi else 'easier than planned'} for {kind} (target {lo}-{hi}).")
    # The note, in lower case.
    note = str(feedback.get("note") or "").lower()
    # Any day of the week the note names, with its date in the plan.
    for w in window[1:8]:
        # The day's full name.
        name = DAY_NAMES.get(w["day"], "")
        # Named in the note.
        if name and name in note:
            # Say which date it is.
            out.append(f"The note mentions {name.title()}: that is {w['date']} ({w['type']}).")
    # All the facts, one line.
    return " ".join(out)


# The messages for a plan review: feedback on the run and the next days of the plan.
def plan_messages(feedback, window, week=None):
    # The plan as one compact line per session.
    lines = [f'{s["id"]} {s["date"]} {s["day"]} wk{s["week"]} {s["type"]}{" HARD" if s.get("hard") else ""} {s["km"]}km zone={s.get("zone")}' for s in window]
    # Feedback fields that matter, in words.
    f = {k: feedback.get(k) for k in ("session", "rpe", "how", "legs", "energy", "pain", "where", "note") if feedback.get(k) not in (None, "")}
    # Everything the coach is shown.
    user = "Feedback: " + json.dumps(f) + "\nFacts: " + (facts(feedback, window) or "none") + "\nPlan (id date day week type km zone):\n" + "\n".join(lines)
    # Add this week's distance if given.
    if week:
        # Distance so far and planned.
        user += f'\nThis week: {week.get("done_km")} of {week.get("km")} km.'
    # The fixed instructions, then the case.
    return [{"role": "system", "content": PLAN_SYSTEM}, {"role": "user", "content": user}]


# Is an edit an easing one (less running, or easier)?
def is_easing(e, types):
    # Cutting the week, an easier zone, or a running day swapped for rest, recovery or easy running.
    return e["op"] == "reduce_volume_pct" or (e["op"] == "shift_pace_zone" and e.get("direction") == "easier") or (e["op"] == "swap_session" and e.get("new_type") in ("rest", "recovery", "easy") and types.get(e.get("session_id")) != "rest")


# Is an edit a harder one?
def is_harder(e):
    # A harder zone, or a swap to a hard or long session.
    return (e["op"] == "shift_pace_zone" and e.get("direction") == "harder") or (e["op"] == "swap_session" and e.get("new_type") in ("sub", "hills", "long"))


# The week that most of the next seven days belong to.
def busiest_week(window):
    # The weeks of the next seven days.
    weeks = [s["week"] for s in window[:7]]
    # The most common (week 1 if the window is empty).
    return max(set(weeks), key=weeks.count) if weeks else 1


# The standard edits for a verdict (used when the model's own edits don't carry it out).
def standard_edits(verdict, window, day=None, session=None):
    # Sessions that can be changed: not rest, not a test or race.
    open_ = [s for s in window if s["type"] not in ("rest", "test", "race")]
    # Where each session falls in the window (0 = today).
    pos = {s["id"]: i for i, s in enumerate(window)}
    # Ease the next hard session within four days, or cut the week.
    if verdict == "ease_next_hard":
        # The next hard session soon.
        h = next((s for s in open_ if s.get("hard") and pos[s["id"]] < 4), None)
        # Swap it for an easy run, or cut the week if there isn't one.
        return [{"op": "swap_session", "session_id": h["id"], "new_type": "easy"}] if h else [{"op": "reduce_volume_pct", "week": busiest_week(window), "pct": 10}]
    # Rest the next two days (or make the next hard session a recovery run if both are rest days).
    if verdict == "rest_soon":
        # Running days in the next two days.
        soon = [s for s in open_ if pos[s["id"]] < 2]
        # Rest them if there are any.
        if soon:
            # One swap each.
            return [{"op": "swap_session", "session_id": s["id"], "new_type": "rest"} for s in soon]
        # Otherwise the next hard session in three days.
        h = next((s for s in open_ if s.get("hard") and pos[s["id"]] < 3), None)
        # Make it a recovery run.
        return [{"op": "swap_session", "session_id": h["id"], "new_type": "recovery"}] if h else []
    # A tenth off the coming week.
    if verdict == "cut_week":
        # The week most of the next seven days are in.
        return [{"op": "reduce_volume_pct", "week": busiest_week(window), "pct": 10}]
    # Rest on the day they can't run.
    if verdict == "skip_day":
        # The session on that day.
        s = next((x for x in open_ if x["date"] == day), None)
        # Rest it.
        return [{"op": "swap_session", "session_id": s["id"], "new_type": "rest"}] if s else []
    # The next session of the same kind a zone harder.
    if verdict == "harder_next":
        # The next session like the one that felt easy, or the next hard one.
        s = next((x for x in open_ if x["type"] == session), None) or next((x for x in open_ if x.get("hard")), None)
        # One zone harder.
        return [{"op": "shift_pace_zone", "session_id": s["id"], "direction": "harder"}] if s else []
    # No change.
    return []


# Do the edits carry out the verdict?
def carries_out(verdict, edits, window, day=None):
    # Session types by id.
    types = {s["id"]: s["type"] for s in window}
    # The easing edits.
    ez = [e for e in edits if is_easing(e, types)]
    # The harder edits.
    hd = [e for e in edits if is_harder(e)]
    # Fatigue, pain, illness or a busy week: some easing and nothing harder.
    if verdict in ("ease_next_hard", "rest_soon", "cut_week"):
        # Easing only.
        return bool(ez) and not hd
    # A day they can't run: something (not harder) done about that day's session.
    if verdict == "skip_day":
        # The ids on that day.
        ids = {s["id"] for s in window if s["date"] == day}
        # An edit on one of them.
        return any(e.get("session_id") in ids and not is_harder(e) for e in edits)
    # Too easy: something harder and nothing easier.
    if verdict == "harder_next":
        # Harder only.
        return bool(hd) and not ez
    # No change: no edits.
    return not edits


# Read the model's plan reply into checked edits (the phone checks the rules again on the real plan).
def parse_edits(raw, window, feedback_session=None):
    # Try to read the JSON.
    try:
        # Parse it.
        d = json.loads(raw)
    # Anything that is not JSON.
    except (ValueError, TypeError):
        # No edits, and say it was not usable.
        return {"edits": [], "say": "", "valid": False, "dropped": ["not JSON"]}
    # The session ids the coach was shown.
    ids = {s["id"] for s in window}
    # Edits kept and edits dropped.
    kept, dropped = [], []
    # Look at each proposed edit.
    for e in (d.get("edits") or [])[:4] if isinstance(d, dict) else []:
        # It must be an object with a known edit name.
        if not isinstance(e, dict) or e.get("op") not in OPS:
            # Drop it and say why.
            dropped.append(f"unknown edit {e!r}")
            # Next edit.
            continue
        # Edits on a session must name one the coach was shown.
        if e["op"] != "reduce_volume_pct" and e.get("session_id") not in ids:
            # Drop it and say why.
            dropped.append(f"unknown session {e.get('session_id')!r}")
            # Next edit.
            continue
        # Keep only the fields that edit uses.
        use = {"swap_session": ["session_id", "new_type"], "move_session": ["session_id", "to_date"], "reduce_volume_pct": ["week", "pct"], "shift_pace_zone": ["session_id", "direction"]}[e["op"]]
        # The tidy edit.
        kept.append({"op": e["op"], **{k: e.get(k) for k in use}})
    # The verdict (a reply without one is taken at its word).
    verdict = d.get("verdict") if isinstance(d, dict) and d.get("verdict") in VERDICTS else None
    # The day it's about, if any.
    day = d.get("day") if isinstance(d, dict) and d.get("day") not in (None, "none") else None
    # Whether code had to step in.
    fixed = False
    # Edits that don't carry out the verdict are replaced by the standard edits for it.
    if verdict and not carries_out(verdict, kept, window, day):
        # The standard edits.
        kept = standard_edits(verdict, window, day, feedback_session)
        # Note it.
        fixed = True
    # The checked reply.
    return {"verdict": verdict, "day": day, "edits": kept, "say": clean_say(d.get("say") if isinstance(d, dict) else "", 240), "valid": isinstance(d, dict) and isinstance(d.get("edits"), list), "dropped": dropped, "fixed": fixed}
