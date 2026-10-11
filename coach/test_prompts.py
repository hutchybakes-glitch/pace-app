# Tests for coach/prompts.py: the checks on the model's replies, with no model needed.
# Run: python -m unittest coach/test_prompts.py

# Bring in JSON.
import json
# Bring in file paths.
import pathlib
# Bring in sys so this folder can be found when run from anywhere.
import sys
# Bring in the standard test runner.
import unittest

# Make "import prompts" work whichever folder the tests are run from.
sys.path.insert(0, str(pathlib.Path(__file__).parent))
# The module under test.
import prompts

# The plan window the eval uses.
WINDOW = json.loads((pathlib.Path(__file__).parent / "eval_cases.json").read_text(encoding="utf8"))["window"]


# All the reply checks.
class PromptTests(unittest.TestCase):

    # Sentences with numbers are dropped (code gives the numbers), and replies stay short.
    def test_clean_say(self):
        # The numeric sentence goes, the rest stays.
        self.assertEqual(prompts.clean_say("Ease off to 5:30 per km. You've got this!"), "You've got this!")
        # Long replies are cut at a word.
        self.assertLessEqual(len(prompts.clean_say("word " * 100)), 161)

    # Intent replies: known intents only; anything else is "none".
    def test_parse_intent(self):
        # A good reply.
        self.assertEqual(prompts.parse_intent('{"intent":"slower","say":"Easy now."}')["intent"], "slower")
        # An invented intent.
        self.assertEqual(prompts.parse_intent('{"intent":"sprint","say":""}')["intent"], "none")
        # Not JSON at all.
        self.assertFalse(prompts.parse_intent("slower please")["valid"])

    # Plan replies: unknown sessions and edits are dropped.
    def test_parse_edits_drops_unknown(self):
        # One real edit, one on a made-up session, one made-up edit.
        out = prompts.parse_edits(json.dumps({"edits": [{"op": "swap_session", "session_id": "3-1", "new_type": "easy"}, {"op": "swap_session", "session_id": "default", "new_type": "rest"}, {"op": "delete_week"}], "say": "ok"}), WINDOW)
        # Only the real one is kept.
        self.assertEqual(out["edits"], [{"op": "swap_session", "session_id": "3-1", "new_type": "easy"}])
        # The other two are reported.
        self.assertEqual(len(out["dropped"]), 2)

    # A verdict the edits don't carry out is fixed by code.
    def test_verdict_reconciled(self):
        # "No change" with an edit: the edit goes.
        self.assertEqual(prompts.parse_edits(json.dumps({"verdict": "no_change", "day": "none", "edits": [{"op": "reduce_volume_pct", "week": 4, "pct": 10}], "say": ""}), WINDOW)["edits"], [])
        # "Skip Tuesday" with no edits: Tuesday becomes rest.
        self.assertEqual(prompts.parse_edits(json.dumps({"verdict": "skip_day", "day": "2026-10-27", "edits": [], "say": ""}), WINDOW)["edits"], [{"op": "swap_session", "session_id": "3-1", "new_type": "rest"}])
        # Pain: the next running days rest (Sunday's long run here).
        self.assertEqual(prompts.parse_edits(json.dumps({"verdict": "rest_soon", "day": "none", "edits": [], "say": ""}), WINDOW)["edits"], [{"op": "swap_session", "session_id": "2-6", "new_type": "rest"}])
        # Edits that already carry it out are kept as the model gave them.
        good = [{"op": "swap_session", "session_id": "3-1", "new_type": "recovery"}]
        # The model's own choice stands.
        self.assertEqual(prompts.parse_edits(json.dumps({"verdict": "ease_next_hard", "day": "none", "edits": good, "say": ""}), WINDOW)["edits"], good)

    # The per-request reply shape only allows the window's sessions, dates and weeks.
    def test_schema_for_window(self):
        # The shape for the eval window.
        sch = prompts.edits_schema_for(WINDOW)
        # The fields of one edit.
        props = sch["properties"]["edits"]["items"]["properties"]
        # Session ids are the window's.
        self.assertEqual(props["session_id"]["enum"], [w["id"] for w in WINDOW])
        # The verdict comes first.
        self.assertEqual(list(sch["properties"])[0], "verdict")

    # The facts line: effort against target, and named days.
    def test_facts(self):
        # A sub-threshold session at 7 out of 10, and Tuesday named.
        f = prompts.facts({"session": "sub", "rpe": 7, "note": "can't run Tuesday"}, WINDOW)
        # Effort as planned.
        self.assertIn("as planned", f)
        # Tuesday's date.
        self.assertIn("2026-10-27", f)


# Run the tests when this file is run directly.
if __name__ == "__main__":
    # Hand over to the standard runner.
    unittest.main()
