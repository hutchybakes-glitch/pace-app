# Scores the model on 30 feedback scenarios (coach/eval_cases.json), using exactly the prompts the app uses.
#   16 in-run phrases: did it pick the right intent?
#   14 post-run reviews: are the proposed plan edits valid, within the rules, and the right kind of change?
# Run:  .venv\Scripts\python eval.py            (all cases, the app's model)
#       .venv\Scripts\python eval.py --model llama3.2:3b --only plan
# Results are printed and saved to coach/data/eval-<date>.json, to compare models (or a fine-tuned one later).

# Bring in command-line options.
import argparse
# Bring in JSON.
import json
# Bring in file paths.
import pathlib
# Bring in timing.
import time

# The prompts and reply checks the app uses.
import prompts
# The model call the proxy uses.
import proxy

# The folder this file is in.
HERE = pathlib.Path(__file__).parent
# The scenarios.
CASES = json.loads((HERE / "eval_cases.json").read_text(encoding="utf8"))
# The plan the post-run cases are about.
WINDOW = CASES["window"]
# Session types by id, for the checks.
TYPE = {s["id"]: s["type"] for s in WINDOW}


# Is an edit an easing one (less running, or easier)?
def easing(e):
    # Cutting the week.
    if e["op"] == "reduce_volume_pct":
        # Always easing.
        return True
    # Moving to an easier zone.
    if e["op"] == "shift_pace_zone":
        # Easier only.
        return e.get("direction") == "easier"
    # Swapping a running day for rest, recovery or easy running.
    return e["op"] == "swap_session" and e.get("new_type") in ("rest", "recovery", "easy") and TYPE.get(e.get("session_id")) != "rest"


# Is an edit a harder one?
def harder(e):
    # A harder zone, or swapping to a hard or longer session.
    return (e["op"] == "shift_pace_zone" and e.get("direction") == "harder") or (e["op"] == "swap_session" and e.get("new_type") in ("sub", "hills", "long"))


# Does a set of edits do what the scenario expects? (the same checks as tests/v4/rules.test.js)
def meets(expect, edits):
    # The easing edits.
    ez = [e for e in edits if easing(e)]
    # The harder edits.
    hd = [e for e in edits if harder(e)]
    # Nothing should change.
    if expect == "none":
        # No edits at all.
        return not edits
    # Some easing, nothing harder.
    if expect == "ease":
        # At least one easing edit.
        return bool(ez) and not hd
    # Ease the next hard session (Tuesday or Thursday) or cut the week.
    if expect == "ease_next_hard":
        # An easing edit on one of them, nothing harder.
        return not hd and any(e["op"] == "reduce_volume_pct" or e.get("session_id") in ("3-1", "3-3") for e in ez)
    # Rest in the next day or two.
    if expect == "rest_soon":
        # Sunday's or Tuesday's session swapped to rest or recovery.
        return not hd and any(e["op"] == "swap_session" and e.get("new_type") in ("rest", "recovery") and e.get("session_id") in ("2-6", "3-1") for e in edits)
    # Make something harder, nothing easier.
    if expect == "harder":
        # A harder edit and no easing.
        return bool(hd) and not ez
    # Anything but easing.
    if expect == "not_easier":
        # No easing edits.
        return not ez
    # Less running this week.
    if expect == "cut_week":
        # Some easing, nothing harder.
        return bool(ez) and not hd
    # Do something about Tuesday (move it, rest it, swap it) but not make it harder.
    if expect == "touch_3_1":
        # An edit on Tuesday's session.
        return any(e.get("session_id") == "3-1" and not harder(e) for e in edits)
    # A scenario with an unknown expectation is a mistake in the file.
    raise ValueError(f"unknown expectation {expect}")


# The plan's rules, checked on the window after the edits: no back-to-back hard days, cuts of 10 % or less.
def rule_breaks(edits):
    # Start from the plan as it is.
    days = [dict(s) for s in WINDOW]
    # Problems found.
    out = []
    # Apply each edit to the copy.
    for e in edits:
        # Find the session it names.
        d = next((x for x in days if x["id"] == e.get("session_id")), None)
        # Swapping changes the type and whether it's hard.
        if e["op"] == "swap_session" and d:
            # The new type.
            d["type"] = e.get("new_type")
            # Hard types.
            d["hard"] = d["type"] in ("sub", "hills")
        # Moving swaps two days' sessions.
        if e["op"] == "move_session" and d:
            # The day it moves to.
            to = next((x for x in days if x["date"] == e.get("to_date")), None)
            # Only within the window.
            if to:
                # Swap what's on each day.
                d["type"], to["type"], d["hard"], to["hard"] = to["type"], d["type"], to["hard"], d["hard"]
        # Cuts bigger than 10 % are capped by the app.
        if e["op"] == "reduce_volume_pct" and (e.get("pct") or 0) > 10:
            # Note it.
            out.append(f"cut of {e.get('pct')} % (the app caps it at 10 %)")
    # Look at each pair of days.
    for a, b in zip(days, days[1:]):
        # Two hard days in a row.
        if a["hard"] and b["hard"]:
            # Note it.
            out.append(f"hard days back to back: {a['id']} and {b['id']}")
    # Everything found.
    return out


# Run every scenario and score it.
def main():
    # The options.
    ap = argparse.ArgumentParser(description="Score the coach model on the 30 scenarios")
    # Which model to test.
    ap.add_argument("--model", default=prompts.MODEL)
    # Only one kind of case.
    ap.add_argument("--only", choices=["intent", "plan"])
    # Read the options.
    args = ap.parse_args()
    # Use the chosen model.
    prompts.MODEL = args.model
    # Every result.
    rows = []
    # The in-run cases.
    if args.only in (None, "intent"):
        # Each one.
        for c in CASES["intent"]:
            # Start the clock.
            t0 = time.time()
            # Ask the model.
            raw, meta = proxy.chat(prompts.intent_messages(c["text"]), prompts.INTENT_SCHEMA, 48)
            # Check the reply.
            got = prompts.parse_intent(raw)
            # Score it.
            ok = got["valid"] and got["intent"] == c["expect"]
            # Keep the details.
            rows.append({"kind": "intent", "case": c["text"], "expect": c["expect"], "got": got["intent"], "say": got["say"], "valid": got["valid"], "ok": ok, "s": round(time.time() - t0, 1)})
            # Show progress.
            print(f"{'PASS' if ok else 'FAIL'}  intent  {c['text'][:44]:44}  want {c['expect']:7} got {got['intent']:7} {rows[-1]['s']:5.1f} s")
    # The post-run cases.
    if args.only in (None, "plan"):
        # Each one.
        for c in CASES["plan"]:
            # Start the clock.
            t0 = time.time()
            # Ask the model.
            raw, meta = proxy.chat(prompts.plan_messages(c["feedback"], WINDOW), prompts.edits_schema_for(WINDOW), 220, timeout=180)
            # Check the reply (unknown sessions and edits are dropped, as the phone does).
            got = prompts.parse_edits(raw, WINDOW, c["feedback"].get("session"))
            # Rule problems in what's left.
            breaks = rule_breaks(got["edits"])
            # Score it: valid JSON, nothing dropped, no rules broken (beyond capping), and the right kind of change.
            ok = got["valid"] and not got["dropped"] and not [b for b in breaks if "back to back" in b] and meets(c["expect"], got["edits"])
            # Keep the details.
            rows.append({"kind": "plan", "case": c["name"], "expect": c["expect"], "verdict": got.get("verdict"), "fixed": got.get("fixed"), "edits": got["edits"], "dropped": got["dropped"], "breaks": breaks, "say": got["say"], "valid": got["valid"], "ok": ok, "s": round(time.time() - t0, 1)})
            # Show progress.
            print(f"{'PASS' if ok else 'FAIL'}  plan    {c['name'][:44]:44}  want {c['expect']:14} {rows[-1]['s']:5.1f} s  {got.get('verdict') or '-':14} {'(code fixed) ' if got.get('fixed') else ''}{json.dumps(got['edits'])[:80]}{'  DROPPED ' + str(got['dropped']) if got['dropped'] else ''}")
    # Totals by kind.
    summary = {}
    # For each kind of case.
    for k in ("intent", "plan"):
        # Its rows.
        r = [x for x in rows if x["kind"] == k]
        # Only if there were any.
        if r:
            # Passes, valid JSON, and average time.
            summary[k] = {"passed": sum(x["ok"] for x in r), "of": len(r), "valid_json": sum(x["valid"] for x in r), "mean_s": round(sum(x["s"] for x in r) / len(r), 1)}
            # For plans: how often code had to replace the model's edits to match its verdict.
            if k == "plan":
                # Count them.
                summary[k]["code_fixed"] = sum(bool(x.get("fixed")) for x in r)
    # Print the totals.
    print("\n" + "  ".join(f"{k}: {v['passed']}/{v['of']} right, {v['valid_json']}/{v['of']} valid JSON, {v['mean_s']} s each" for k, v in summary.items()))
    # Where to save the results.
    out = proxy.DATA / f"eval-{time.strftime('%Y%m%d-%H%M')}-{args.model.replace(':', '_')}.json"
    # Make the folder if needed.
    proxy.DATA.mkdir(exist_ok=True)
    # Save everything.
    out.write_text(json.dumps({"model": args.model, "at": time.strftime("%Y-%m-%d %H:%M"), "summary": summary, "rows": rows}, indent=1), encoding="utf8")
    # Say where.
    print(f"Saved {out}")


# Run when started directly.
if __name__ == "__main__":
    # Score the model.
    main()
