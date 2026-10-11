# Pace calculator for the laptop side of Pacer: a line-for-line twin of v4/js/pace.js.
# Paces are seconds per km and distances are metres unless a name says otherwise.
# Both versions are checked against the same cases in tests/v4/pace_cases.json.

# Bring in maths functions (exp, sqrt, isfinite).
import math
# Bring in regular expressions for reading times, paces and distances.
import re

# One mile in metres.
MILE = 1609.344
# The standard race distances in metres, by short name.
DISTANCES = {"1500m": 1500, "mile": MILE, "3k": 3000, "5k": 5000, "10k": 10000, "15k": 15000, "10mile": 10 * MILE, "half": 21097.5, "marathon": 42195}
# Friendly names for the standard distances.
DIST_NAMES = {"1500m": "1500 m", "mile": "Mile", "3k": "3K", "5k": "5K", "10k": "10K", "15k": "15K", "10mile": "10 miles", "half": "Half marathon", "marathon": "Marathon"}


# Convert kilometres to miles.
def km_to_miles(km):
    # Kilometres times 1000 gives metres; divide by metres per mile.
    return km * 1000 / MILE


# Convert miles to kilometres.
def miles_to_km(mi):
    # Miles times metres per mile gives metres; divide by 1000 for km.
    return mi * MILE / 1000


# Convert a pace in seconds per km to seconds per mile.
def per_km_to_per_mile(s):
    # A mile is 1.609344 km, so it takes that many times as long.
    return s * MILE / 1000


# Convert a pace in seconds per mile to seconds per km.
def per_mile_to_per_km(s):
    # Undo the mile conversion.
    return s * 1000 / MILE


# Convert a pace in seconds per km to a speed in km/h.
def pace_to_kmh(s):
    # 3600 seconds in an hour divided by seconds per km gives km per hour.
    return 3600 / s


# Convert a speed in km/h to a pace in seconds per km.
def kmh_to_pace(kmh):
    # Seconds in an hour divided by km per hour gives seconds per km.
    return 3600 / kmh


# Convert a pace in seconds per km to a speed in miles per hour.
def pace_to_mph(s):
    # Seconds in an hour divided by seconds per mile gives miles per hour.
    return 3600 / per_km_to_per_mile(s)


# Convert a speed in miles per hour to a pace in seconds per km.
def mph_to_pace(mph):
    # Seconds per mile, then converted to seconds per km.
    return per_mile_to_per_km(3600 / mph)


# Read "41:30", "1:31:35" or "41:30.5" (or a number of seconds) and return seconds, or None.
def parse_duration(x):
    # A number is already seconds: accept it if it is a positive finite number.
    if isinstance(x, (int, float)) and not isinstance(x, bool):
        # Positive and finite means it is a usable time.
        return float(x) if math.isfinite(x) and x > 0 else None
    # Match optional hours, then minutes and seconds (seconds may have decimals).
    m = re.match(r"^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$", str(x if x is not None else "").strip())
    # No match means it is not a time.
    if not m:
        # Tell the caller it could not be read.
        return None
    # Seconds of 60 or more are invalid.
    if float(m.group(3)) >= 60:
        # Reject it.
        return None
    # When hours are given, minutes of 60 or more are invalid.
    if m.group(1) is not None and int(m.group(2)) >= 60:
        # Reject it.
        return None
    # Add up hours, minutes and seconds.
    return int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


# Turn seconds into "41:30" or "1:31:35", rounded to the second.
def format_duration(s):
    # Round to whole seconds the way JavaScript does (halves go up).
    s = math.floor(s + 0.5)
    # Whole hours.
    h = s // 3600
    # Whole minutes left over.
    m = s % 3600 // 60
    # Seconds left over, always two digits.
    x = str(s % 60).zfill(2)
    # Show hours only when there are any.
    return f"{h}:{str(m).zfill(2)}:{x}" if h else f"{m}:{x}"


# Read "4:40/km", "7:30/mi", "7:30 per mile" or "4:40" (in the default unit) and return seconds per km.
def parse_pace(x, unit="km"):
    # Match minutes:seconds, an optional "/" or "per", and an optional unit.
    m = re.match(r"^(\d{1,2}):(\d{2})\s*(?:/|per\s*)?\s*(km|k|kilometre|kilometer|mi|mile)?$", str(x if x is not None else "").strip().lower())
    # Not a pace, or seconds of 60 or more.
    if not m or int(m.group(2)) >= 60:
        # Tell the caller it could not be read.
        return None
    # Total seconds per unit.
    s = int(m.group(1)) * 60 + int(m.group(2))
    # Work out the unit: written units starting with "m" are miles, otherwise use the default.
    u = ("mi" if m.group(3).startswith("m") else "km") if m.group(3) else unit
    # Convert miles to km if needed.
    return per_mile_to_per_km(s) if u == "mi" else float(s)


# Turn seconds per km into "4:40/km" or "7:30/mi".
def format_pace(s, unit="km"):
    # Convert to the chosen unit and round to the second (halves go up, as in JavaScript).
    v = math.floor((per_km_to_per_mile(s) if unit == "mi" else s) + 0.5)
    # Minutes, then two-digit seconds, then the unit.
    return f"{v // 60}:{str(v % 60).zfill(2)}/{unit}"


# Read "10k", "5 km", "6.2 mi", "400m", "half", "marathon" or "mile" and return metres, or None.
def parse_distance(x):
    # Lower case with all spaces removed.
    t = re.sub(r"\s+", "", str(x if x is not None else "").strip().lower())
    # Distances that have names.
    named = {"1500m": 1500, "mile": MILE, "1mile": MILE, "5k": 5000, "10k": 10000, "15k": 15000, "10mile": 10 * MILE, "10miles": 10 * MILE, "half": 21097.5, "halfmarathon": 21097.5, "marathon": 42195}
    # A named distance is returned straight away.
    if t in named:
        # Its length in metres.
        return named[t]
    # Otherwise a number followed by a unit.
    m = re.match(r"^(\d+(?:\.\d+)?)(km|k|mi|miles?|m)$", t)
    # Anything else is not a distance.
    if not m:
        # Tell the caller it could not be read.
        return None
    # The number part.
    n = float(m.group(1))
    # Metres as given.
    if m.group(2) == "m":
        # Already metres.
        return n
    # Miles start with "mi"; everything else here is km.
    return n * MILE if m.group(2).startswith("mi") else n * 1000


# Oxygen cost (ml/kg/min) of running at v metres per minute (Daniels and Gilbert).
def vo2(v):
    # Their fitted curve.
    return -4.60 + 0.182258 * v + 0.000104 * v * v


# The fraction of VO2max a runner can hold for t minutes (Daniels and Gilbert).
def pct_max(t):
    # Their fitted curve.
    return 0.8 + 0.1894393 * math.exp(-0.012778 * t) + 0.2989558 * math.exp(-0.1932605 * t)


# VDOT (a fitness score) from a race: d metres in s seconds.
def vdot(d, s):
    # Race time in minutes.
    t = s / 60
    # Oxygen cost of the race speed divided by the fraction that can be held that long.
    return vo2(d / t) / pct_max(t)


# The race time in seconds over d metres that a VDOT predicts.
def race_time(v, d):
    # Fastest possible guess: 100 seconds per km.
    lo = d / 1000 * 100
    # Slowest possible guess: 1200 seconds per km.
    hi = d / 1000 * 1200
    # Halve the range 60 times (VDOT falls as the time gets longer).
    for _ in range(60):
        # Try the middle.
        m = (lo + hi) / 2
        # Too fast for this VDOT means the answer is slower.
        if vdot(d, m) > v:
            # Move the fast end up.
            lo = m
        # Otherwise the answer is faster.
        else:
            # Move the slow end down.
            hi = m
    # The middle of the final tiny range.
    return (lo + hi) / 2


# The pace (seconds per km) that costs a fraction f of a VDOT.
def pace_at_pct(v, f):
    # Quadratic term of the oxygen cost curve.
    a = 0.000104
    # Linear term of the oxygen cost curve.
    b = 0.182258
    # Constant term, moved over so the curve equals f times VDOT.
    c = -4.60 - f * v
    # Solve the quadratic for the speed in metres per minute.
    vel = (-b + math.sqrt(b * b - 4 * a * c)) / (2 * a)
    # Seconds per km from metres per minute.
    return 60000 / vel


# Riegel's formula: the time over d2 from a time t1 over d1.
def riegel(d1, t1, d2, k=1.06):
    # Time grows a little faster than distance.
    return t1 * (d2 / d1) ** k


# Predicted time over `to` metres from a race of d metres in s seconds.
def predict(d, s, to):
    # Through VDOT, as Daniels does.
    return race_time(vdot(d, s), to)


# Predictions for every standard distance from one race.
def predictions(d, s):
    # Fitness from the race.
    v = vdot(d, s)
    # One entry per standard distance, by VDOT and by Riegel.
    return [{"id": k, "name": DIST_NAMES[k], "d": m, "time": race_time(v, m), "riegel": riegel(d, s, m), "pace": race_time(v, m) / (m / 1000)} for k, m in DISTANCES.items()]


# Training zones as fractions of VDOT, slowest to quickest (target, and the lo and hi limits).
ZONES = [
    # Recovery: very easy.
    {"id": "recovery", "name": "Recovery", "lo": 0.56, "hi": 0.62, "target": 0.60, "feel": "very easy, barely running"},
    # Easy: conversational.
    {"id": "easy", "name": "Easy", "lo": 0.62, "hi": 0.72, "target": 0.67, "feel": "conversational"},
    # Steady: about marathon effort.
    {"id": "steady", "name": "Steady", "lo": 0.74, "hi": 0.82, "target": 0.78, "feel": "marathon effort, relaxed but working"},
    # Sub-threshold: the Norwegian method's main gear.
    {"id": "subthreshold", "name": "Sub-threshold", "lo": 0.83, "hi": 0.87, "target": 0.855, "feel": "comfortably hard, never straining"},
    # Threshold: about one hour race effort.
    {"id": "threshold", "name": "Threshold", "lo": 0.87, "hi": 0.90, "target": 0.88, "feel": "the pace you could hold for about an hour"},
    # Interval: about 3K to 5K effort.
    {"id": "interval", "name": "Interval", "lo": 0.95, "hi": 1.00, "target": 0.98, "feel": "hard, about 3K-5K effort"},
    # Repetition: about mile effort.
    {"id": "repetition", "name": "Repetition", "lo": 1.04, "hi": 1.10, "target": 1.07, "feel": "fast and relaxed, about mile effort"},
# End of the zone list.
]
# Every zone name, including race pace.
ZONE_IDS = [z["id"] for z in ZONES] + ["race"]
# Race pace may be 1.5 % either side of the prediction.
RACE_TOL = 0.015


# Every zone's paces (seconds per km) for a VDOT: target, fast limit and slow limit.
def zones(v, race_dist=10000, race_target=None):
    # Start with an empty set of zones.
    out = {}
    # Work out each zone from its fractions of VDOT.
    for z in ZONES:
        # Quicker fraction gives the fast limit, slower fraction the slow limit.
        out[z["id"]] = {"id": z["id"], "name": z["name"], "target": pace_at_pct(v, z["target"]), "fast": pace_at_pct(v, z["hi"]), "slow": pace_at_pct(v, z["lo"]), "feel": z["feel"]}
    # Race pace comes from the goal time if given, otherwise the prediction.
    rp = (race_target or race_time(v, race_dist)) / (race_dist / 1000)
    # The race zone sits 1.5 % either side.
    out["race"] = {"id": "race", "name": "Race pace", "target": rp, "fast": rp * (1 - RACE_TOL), "slow": rp * (1 + RACE_TOL), "feel": "goal race effort"}
    # All the zones.
    return out


# Everything from one race result: VDOT, zones and predictions.
def from_race(d, s, race_dist=10000, race_target=None):
    # Fitness from the race.
    v = vdot(d, s)
    # Bundle it all together.
    return {"vdot": v, "zones": zones(v, race_dist, race_target), "predictions": predictions(d, s)}


# Which zone a pace falls in (the nearest zone target if it falls between zones).
def zone_of(pace, z):
    # Every zone except race pace.
    lst = [x for x in z.values() if x["id"] != "race"]
    # The first zone whose limits contain the pace.
    for x in lst:
        # Inside the fast and slow limits.
        if x["fast"] <= pace <= x["slow"]:
            # This is the zone.
            return x["id"]
    # Otherwise the zone with the nearest target.
    return min(lst, key=lambda x: abs(x["target"] - pace))["id"]


# Seconds per mile for one in-run step (about 7.5 seconds per km).
STEP_PER_MILE = 12


# One step slower (direction +1) or faster (direction -1), kept inside the zone's limits.
def step_pace(pace, direction, zone, steps=1, only_slower=False, per_mile=STEP_PER_MILE):
    # Easy runs may only slow down.
    if direction < 0 and only_slower:
        # No change, and say why.
        return {"pace": pace, "changed": False, "limit": "easy", "by": 0}
    # Where the step would land with no limits.
    want = pace + direction * steps * per_mile_to_per_km(per_mile)
    # Quickest allowed pace (never forces a jump if already outside the zone).
    lo = min(zone["fast"], pace)
    # Slowest allowed pace.
    hi = max(zone["slow"], pace)
    # Keep the new pace inside the limits.
    nxt = max(lo, min(hi, want))
    # Note which limit stopped the change, if any.
    limit = "fast" if direction < 0 and nxt <= lo + 0.01 and want < lo else "slow" if direction > 0 and nxt >= hi - 0.01 and want > hi else None
    # The new pace, whether it changed, the limit hit, and by how much.
    return {"pace": nxt, "changed": abs(nxt - pace) > 0.05, "limit": limit, "by": nxt - pace}
