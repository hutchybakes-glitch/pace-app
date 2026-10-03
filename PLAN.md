# Pace — Gradient Pacing Run App: Build Plan

## Context
- Existing app: single `index.html` (vanilla JS), hosted on Netlify, used as an iPhone home-screen web app in Safari.
- Current features: current pace (30 s rolling, refreshed every 5 s), average pace, time, distance, km splits, screen wake lock.
- Constraints: iOS Safari web app. GPS stops when the screen locks, so the screen stays on during runs. No build step, no backend, no paid APIs.

## Goal
Load a route, auto-segment it by gradient, set a target pace, and get live colour feedback against a gradient-adjusted target. Show a per-km chart during the run, and export an interactive report afterwards.

---

## 1. Project structure (no build step, ES modules)
```
index.html        UI shell + screens (Setup, Run, Summary)
css/app.css
js/app.js         state machine + screen wiring
js/gps.js         watchPosition, filtering, rolling pace
js/route.js       GPX parse, resample, smooth, segment
js/pacing.js      grade→effort model, target per segment/km
js/match.js       snap live position to route distance
js/chart.js       per-km bar chart (SVG, hand-drawn)
js/storage.js     IndexedDB autosave of runs
js/report.js      builds self-contained HTML report
js/sim.js         simulated run (replay GPX at a set pace) for desk testing
manifest.json + sw.js   PWA: offline cache, icon
tests/*.test.js   node --test for route/pacing/match (pure functions)
```
Deploy: push to a GitHub repo connected to the existing Netlify site, so every push auto-deploys and the URL stays the same.

## 2. Route loading & gradient segmentation (`route.js`)
1. Parse GPX (`trkpt`/`rtept`, lat, lon, ele) from a file picker (iOS Files app).
2. If there's no elevation, fetch it from the Open-Meteo elevation API (batches of 100 coords) and cache it with the route.
3. Resample to a point every 10 m along the route (cumulative haversine distance).
4. Smooth elevation with a moving average (~60 m window) to kill GPS/DEM noise.
5. Classify each 10 m step by local grade: **UP** > +2 %, **DOWN** < −2 %, else **FLAT** (thresholds configurable).
6. Merge consecutive same-class steps into segments.
7. **Chunking rule:** any segment shorter than 250 m (configurable) merges into the neighbour with the closest grade. Repeat until stable. The result is a few meaningful climbs, descents and flats, not jittery micro-segments.
8. Segment grade = net elevation change / length.
9. Save each route (name, points, segments) in IndexedDB so it can be reused.

## 3. Pacing model (`pacing.js`)
- Effort factor per segment, f(g), where g is grade in % (coefficients editable in settings):
  - uphill: `1 + 0.033·g`
  - downhill: `1 + 0.018·g` down to −10 %; below −10 %, the benefit tapers back towards 1 (braking)
- User inputs a **target average pace** (or finish time; convert between them).
- Total time T = target pace × route distance.
- Solve the base pace b so that Σ(len_i · b · f_i) = T, then segment target = b · f_i. This gives even effort, and the average still equals the target.
- Per-km target = time-weighted average of the segment targets falling in that km (used by the chart).
- Unit tests check: flat route gives target pace everywhere, totals sum to T, and climbs are slower than descents.

## 4. Where am I on the route? (`match.js`)
- Snap each GPS fix to the nearest point on the resampled route, searching only a forward window (e.g. −50 m to +300 m from the last matched distance). This stops it jumping on out-and-back or looping routes.
- Route distance = matched distance, which corrects GPS distance drift.
- If off-route by > 40 m, show an "Off route" banner and fall back to GPS distance until it re-snaps.
- If no route is loaded, the app runs exactly like today (free run).

## 5. Run screen
- **Background colour = status**, comparing current pace (20 s rolling) to the current segment target with sensitivity S (default ±5 s/km, set pre-run):
  - green: within ±S
  - red: outside ±S
  - optional amber band from S to 2S (setting)
  - hysteresis: change colour only after 2 consecutive readings, to avoid flicker
- Big: current pace. Below it: **target pace + segment type** (e.g. "4:30 ▲ climb, 420 m left").
- Next-segment preview (e.g. "Next: ▼ descent 600 m, target 4:05").
- Current-km average pace (resets each km), overall average, time, distance.
- **Plan delta:** "+0:12 behind" / "−0:05 ahead" against cumulative target time at the current route distance.
- Text stays high-contrast (white with a dark shadow) on both green and red.

## 6. Live per-km chart (`chart.js`, SVG)
- One bar per km = actual average pace for that km; the current km updates live.
- Target band per km = target ± S, drawn as two lines (or a shaded band); it steps per km as the gradient changes.
- Bar is green if inside the band, red if outside.
- Y axis is inverted (faster = taller) so "above the band" means too fast. Label it clearly.
- Fits phone width; scrolls horizontally for long routes.

## 7. Recording & storage (`storage.js`)
- Every accepted fix is saved: t, lat, lon, accuracy, GPS distance, route distance, segment id, current pace, target pace, in/out of band.
- Autosave to IndexedDB every 10 s, so a crash, reload or accidental close loses at most 10 s. On launch, offer "Resume unfinished run?".
- Run history list on the Setup screen.

## 8. Post-run report (`report.js`)
- Generates **one self-contained HTML file** with the data embedded as JSON, opening offline on any device.
- Contents:
  - summary: time, distance, average pace vs target, % of time in band
  - map of the route coloured by in/out of band (Leaflet + OSM tiles from CDN)
  - elevation profile with segments shaded
  - pace vs target line chart
  - per-km bar chart (same as live)
  - segment table: target, actual, delta
- Interactive: hovering on the chart highlights the position on the map.
- Delivered via `navigator.share({files})` (iOS share sheet → Files, AirDrop, email), with a download-link fallback.
- Also export CSV and GPX of the recorded run.

## 9. Desk testing (`sim.js`)
- `?sim=1` mode replays a loaded GPX at a chosen pace with noise and deliberate surges, at 10× speed.
- Lets the whole app be tested in a desktop browser without running.

---

## Build phases (one Claude Code session each; commit after each)
1. **Restructure:** split the current file into modules plus manifest/service worker; behaviour unchanged. Set up the GitHub → Netlify auto-deploy.
2. **Route + segmentation + pacing:** pure functions with node tests. Setup screen shows the route, elevation profile and segment list with targets.
3. **Matching + live target + colour feedback + sim mode.**
4. **Live per-km chart.**
5. **Recording, autosave, resume, history.**
6. **Report export.**
7. **Polish:** settings screen (thresholds, coefficients, sensitivity, amber on/off), then a field test.

## Acceptance checks
- Free run (no route) works exactly as today.
- A flat route gives the same target everywhere; a hilly route's segment targets average to the input pace.
- No segment shorter than the minimum length; a typical hilly 10 km has roughly 5–15 segments.
- Sim run: colour, plan delta and chart all react correctly to surges.
- Reloading mid-run resumes without losing data.
- Report opens offline from the Files app on iPhone.

## Later ideas (not in scope)
- Voice cues via `speechSynthesis` ("climb starting, target 4:40").
- Personalised gradient coefficients learned from past runs.
- Native SwiftUI version for screen-off tracking.
