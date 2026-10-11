# Tests for coach/pace.py: the same cases the JavaScript calculator passes (tests/v4/pace_cases.json),
# plus checks against Daniels' published tables. Run: python -m unittest coach/test_pace.py

# Bring in JSON reading for the shared cases.
import json
# Bring in file paths.
import pathlib
# Bring in the standard test runner.
import unittest
# Bring in sys so this folder can be found when run from anywhere.
import sys

# Make "import pace" work whichever folder the tests are run from.
sys.path.insert(0, str(pathlib.Path(__file__).parent))
# The calculator under test.
import pace as P

# Load the cases the JavaScript calculator wrote.
CASES = json.loads((pathlib.Path(__file__).parent.parent / "tests" / "v4" / "pace_cases.json").read_text(encoding="utf8"))


# All the calculator checks.
class PaceTests(unittest.TestCase):

    # VDOT from a race matches the JavaScript version.
    def test_vdot_matches_js(self):
        # Every race case.
        for c in CASES["vdot"]:
            # Same to nine decimal places.
            self.assertAlmostEqual(P.vdot(c["d"], c["s"]), c["vdot"], places=9)

    # Race time from VDOT matches the JavaScript version.
    def test_race_time_matches_js(self):
        # Every VDOT and distance case.
        for c in CASES["raceTime"]:
            # Same to a millionth of a second.
            self.assertAlmostEqual(P.race_time(c["v"], c["d"]), c["s"], places=6)

    # Riegel predictions match the JavaScript version.
    def test_riegel_matches_js(self):
        # Every Riegel case.
        for c in CASES["riegel"]:
            # Same to nine decimal places.
            self.assertAlmostEqual(P.riegel(c["d"], c["s"], c["to"]), c["t"], places=9)

    # Every zone's target, fast and slow paces match the JavaScript version.
    def test_zones_match_js(self):
        # Every VDOT case, with and without a goal time.
        for c in CASES["zones"] + CASES["zonesGoal"]:
            # The zones the Python calculator gives.
            z = P.zones(c["v"], c["raceDist"], c.get("raceTarget"))
            # Every zone in the case.
            for k, want in c["zones"].items():
                # Every pace in the zone.
                for f in ("target", "fast", "slow"):
                    # Same to nine decimal places.
                    self.assertAlmostEqual(z[k][f], want[f], places=9, msg=f"{c['v']} {k} {f}")

    # Unit conversions match the JavaScript version.
    def test_units_match_js(self):
        # Map the JavaScript names to the Python functions.
        fns = {"perKmToPerMile": P.per_km_to_per_mile, "perMileToPerKm": P.per_mile_to_per_km, "kmToMiles": P.km_to_miles, "milesToKm": P.miles_to_km, "paceToKmh": P.pace_to_kmh, "kmhToPace": P.kmh_to_pace, "paceToMph": P.pace_to_mph, "mphToPace": P.mph_to_pace}
        # Every conversion and its cases.
        for name, pairs in CASES["units"].items():
            # Every input and expected output.
            for x, y in pairs:
                # Same to nine decimal places.
                self.assertAlmostEqual(fns[name](x), y, places=9, msg=name)

    # Reading and writing times, paces and distances matches the JavaScript version.
    def test_parsing_matches_js(self):
        # Every time to read.
        for x, y in CASES["parseDuration"]:
            # Same answer, including None for nonsense.
            self.assertEqual(P.parse_duration(x), y, x)
        # Every time to write.
        for x, y in CASES["formatDuration"]:
            # Same text.
            self.assertEqual(P.format_duration(x), y)
        # Every pace to read.
        for x, u, y in CASES["parsePace"]:
            # None must match None exactly.
            if y is None:
                # Both say it is not a pace.
                self.assertIsNone(P.parse_pace(x, u), x)
            # Otherwise compare the numbers.
            else:
                # Same to nine decimal places.
                self.assertAlmostEqual(P.parse_pace(x, u), y, places=9, msg=x)
        # Every pace to write.
        for x, u, y in CASES["formatPace"]:
            # Same text.
            self.assertEqual(P.format_pace(x, u), y)
        # Every distance to read.
        for x, y in CASES["parseDistance"]:
            # None must match None exactly.
            if y is None:
                # Both say it is not a distance.
                self.assertIsNone(P.parse_distance(x), x)
            # Otherwise compare the numbers.
            else:
                # Same to nine decimal places.
                self.assertAlmostEqual(P.parse_distance(x), y, places=9, msg=x)

    # The in-run step matches the JavaScript version.
    def test_step_matches_js(self):
        # Every step case.
        for c in CASES["stepPace"]:
            # Take the step with the case's zone limits.
            o = P.step_pace(c["pace"], c["dir"], {"fast": c["zoneFast"], "slow": c["zoneSlow"]}, only_slower=c["onlySlower"])
            # Same new pace.
            self.assertAlmostEqual(o["pace"], c["out"]["pace"], places=9)
            # Same limit reached (or none).
            self.assertEqual(o["limit"], c["out"]["limit"])
            # Same verdict on whether it changed.
            self.assertEqual(o["changed"], c["out"]["changed"])

    # Predictions agree with Daniels' published table to within 12 seconds.
    def test_daniels_table(self):
        # VDOT 50: 5K, 10K, half and marathon from Daniels' Running Formula.
        table = {"5k": "19:57", "10k": "41:21", "half": "1:31:35", "marathon": "3:10:49"}
        # Every distance in the table.
        for k, t in table.items():
            # Within 12 seconds of the book.
            self.assertLess(abs(P.race_time(50, P.DISTANCES[k]) - P.parse_duration(t)), 12, k)
        # Threshold pace for VDOT 50 is about 4:15 per km.
        self.assertLess(abs(P.zones(50)["threshold"]["target"] - 255), 4)

    # A step is at most 12 seconds per mile and easy runs never speed up.
    def test_step_rules(self):
        # Zones for VDOT 50.
        z = P.zones(50)
        # One step slower on sub-threshold.
        s = P.step_pace(z["subthreshold"]["target"], 1, z["subthreshold"])
        # It moved, but by no more than 12 seconds per mile.
        self.assertTrue(0 < s["by"] <= P.per_mile_to_per_km(12) + 0.01)
        # Asking an easy run to go faster.
        e = P.step_pace(z["easy"]["target"], -1, z["easy"], only_slower=True)
        # Nothing changes.
        self.assertFalse(e["changed"])


# Run the tests when this file is run directly.
if __name__ == "__main__":
    # Hand over to the standard runner.
    unittest.main()
