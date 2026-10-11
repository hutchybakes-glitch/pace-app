# Pacer laptop coach

Pacer v4 (https://hutchybakes-glitch.github.io/pace-app/v4/) gets an AI coach that runs on **your own laptop**: qwen2.5:3b in Ollama, reached from your iPhone over mobile data. Everything is free and open source, and nothing needs an account or a card.

**Who does what:**
- **The model (qwen2.5:3b)** understands what you say ("I'm really struggling") and suggests plan changes as strict JSON. It never produces a number that matters.
- **Pacer's own code** does all the maths:
  - the pace calculator (`v4/js/pace.js`, with its Python twin `pace.py`), for zones, predictions and the bounded slower/faster step;
  - the plan rules (`v4/js/plandoc.js`), which check every change before you see it.
- **The phone works alone** if the laptop can't be reached: the buttons, a keyword matcher (`v4/js/intents.js`) and a rule-based plan coach.

## Setup (once)

1. On the laptop, check you have:
   - **Python 3**. If not, install it free from python.org and tick "Add to PATH".
   - **Ollama** with `qwen2.5:3b`. Both are already installed here. If the model is ever missing, `start.bat` downloads it (about 2 GB).
2. **Double-click `coach\start.bat`.** The first start takes a few minutes. It:
   - sets up Python's private folder (`.venv`);
   - installs Whisper (voice);
   - downloads `cloudflared` (about 55 MB) and the Whisper model (about 140 MB).
3. **Note the pairing code** the window shows, for example `X2NB-Y65C-X7QK-N92Z`. It's kept in `coach\config.json`, so it stays the same every time you start.
4. On the iPhone, **open Pacer v4 in Safari**, then tap Share → **Add to Home Screen**.
5. **Open Pacer from the home screen.** Tap ⚙︎ Settings → **Laptop coach (AI)**, type the pairing code (any case, dashes optional) and tap **Test the link**. It should say "Connected" and show how the AI read a test phrase.

## Every run

1. **Laptop:** double-click `start.bat`.
   - Wait for **"Phone link OK"**. That usually takes 20–30 seconds.
   - Keep it plugged in, and leave the window open. The coach keeps the laptop awake while it runs.
   - If you close the lid, set Windows' lid action to "Do nothing" first: Control Panel → Power Options → "Choose what closing the lid does".
2. **Phone:** start your run as usual. Pacer wakes the model as the run starts, so replies come back in about 5–8 s.
3. **During the run,** use the big buttons above Pause:
   - **🐢 Slower / 🐇 Faster** moves your target about 12 s/mile (7.5 s/km) per tap. It stays inside the session's pace zone, and easy runs only ever slow down. The new target is spoken back to you, and **Undo** takes it back.
   - **📍 How am I?** gives your distance, time, the gap to the pacer, your pace and the target.
   - **🎙 Talk:** speak after the tap. Recording stops by itself after a pause. Whisper on the laptop turns it into words, and the AI picks the intent.
4. **After the run,** fill in "How did it feel?". Add a note if you like, such as "slept badly", "can't run Tuesday" or "knee sore".
   - The coach reviews the next ten days and lists the changes it suggests. It takes up to about 30 s.
   - Anything that breaks the plan's rules is shown as left out, with the reason.
   - **Accept** applies the changes as a new plan revision; **Keep my plan** leaves it as it is.
   - The Plan tab has **Ask the coach** for weekly check-ins, the revision history with **Undo**, and the plan as JSON.

## Try the coach without running (sim mode)

1. Start `start.bat` on the laptop.
2. Open https://hutchybakes-glitch.github.io/pace-app/v4/?sim=1. If you haven't entered the pairing code in this browser yet, enter it in ⚙︎ Settings → Laptop coach (AI). A Safari tab and the home-screen app keep separate settings.
3. On Today, tap **Load the demo plan** on the 🧠 Coach demo card. It sets up a pretend 10K plan that is four weeks in, with the sessions so far marked as run.
4. Fill in how your latest run felt, for example 6/10, legs Heavy, energy Low, note "legs very tired", and tap Save. The AI answers in about 30–45 s with its suggested changes.
5. Tap **Accept**, then **See the plan** to see the new revision. Undo is on the Plan tab.

In sim mode the plan, goal and coach changes are kept under separate `pacer:sim:` keys, so your real plan is never touched. **End the demo** clears it.

## How the phone reaches the laptop (and why this way)

Phone (mobile data) → `https://….trycloudflare.com` → **cloudflared** on the laptop → **proxy.py** (`127.0.0.1:8787`) → **Ollama** (`127.0.0.1:11434`, never exposed)

**Cloudflare Quick Tunnel.** This is free, needs no account and no card, and `cloudflared` is open source (Apache 2.0). It gives a real HTTPS address, which the HTTPS app needs. Limits:
- at most 200 requests in flight at once (Pacer makes one at a time);
- no Server-Sent Events (not used);
- a new random address every start;
- meant for testing, with no uptime guarantee.

I chose it over Tailscale Funnel, which needs an account sign-up, and over a fixed Cloudflare tunnel, which needs an account and a domain.

**Finding the new address each time.** `run.py` posts it to a private topic on **ntfy.sh**. That's free, needs no account, and is open source (Apache 2.0 / GPLv2).
- The topic name is a hash of your pairing code, so only someone who knows the code can work it out.
- Only the address is posted, never the code.
- ntfy.sh's free tier is rate-limited. Pacer posts once per start and again every 6 hours. Messages are kept for 12 hours.
- To avoid ntfy, put `"relay": ""` in `config.json` and paste the **Address** line into Settings → Laptop address instead.

**Security.**
- **The proxy is the only thing reachable from outside.** Every request must carry the pairing code: about 79 bits of randomness, compared in constant time. Twenty wrong codes in ten minutes lock it out for ten minutes.
- **Only these endpoints exist:** `/health`, `/warm`, `/intent`, `/voice`, `/plan` (a job that's polled through `/job`) and `/log`. The phone can't send arbitrary prompts, pick a model, or reach any other Ollama function.
- **Only Pacer's web address can call it from a browser.** The CORS allowlist is `hutchybakes-glitch.github.io`, plus `localhost:8765` for testing.
- **Requests are capped at 600 kB,** and voice clips are never stored.

## Voice on the iPhone (what works, and why)

- **Speaking back works** in home-screen web apps. It's unlocked by the Start tap, as Pacer v3 already does.
- **Safari's own speech recognition doesn't work** in home-screen web apps: Apple turns it off there. See WebKit bug 225298, open since 2021.

So Pacer records a short clip itself, using the microphone, which home-screen apps can use. The laptop transcribes it with Whisper `base.en` (faster-whisper, MIT): about 2 s for a short phrase, then about 5 s for the AI.

If the laptop is away, 🎙 uses the browser's recognition where it exists (Safari in a tab, Chrome). Otherwise it opens a text box: tap the **keyboard's 🎙** to dictate, which is Apple's dictation and works offline on recent iPhones. The phone's keyword matcher then understands it.

iOS asks for microphone permission the first time you tap 🎙 each time the app is opened. Keep the screen on during runs, as before: web apps pause when the screen locks.

## Files

| File | What it is |
|---|---|
| `start.bat` | One double-click: sets up and starts everything |
| `run.py` | Starts Ollama if needed, keeps the model loaded, starts the proxy and the tunnel, and posts the address |
| `proxy.py` | The token-protected server in front of Ollama (Python standard library only) |
| `prompts.py` | The exact prompts, the reply shapes (Ollama is held to them), and the checks on replies |
| `pace.py` / `test_pace.py` | The pace calculator, a twin of `v4/js/pace.js`. Both pass the shared cases in `tests/v4/pace_cases.json` |
| `eval.py` / `eval_cases.json` | 30 feedback scenarios with expected outcomes, to score a model |
| `export_finetune.py` | Turns the logs into chat-format training data for a LoRA (nothing is trained) |
| `data/` | `exchanges.jsonl` (every prompt and reply), `outcomes.jsonl` (what you did with them), eval results |

## Scoring and fine-tuning later

- **Score a model:** `.venv\Scripts\python eval.py`. Add `--model llama3.2:3b` to compare another model, or `--only plan`.
- **Make training data:** `.venv\Scripts\python export_finetune.py "path\to\pacer-coach-log.jsonl"`.
  - Get the phone's log from Settings → Laptop coach → **Coach log**.
  - It writes `data/finetune/train.jsonl`: `{"messages":[system,user,assistant]}`, kept only for replies you accepted and didn't undo. That's the format Unsloth / TRL fine-tuning notebooks on Kaggle's free GPUs take.
  - It also writes `rejected.jsonl`, the replies you turned down, for preference tuning later.

## How qwen2.5:3b scores today (`eval.py`, this laptop, 11 Oct 2026)

| | First version | Now |
|---|---|---|
| In-run intents (16) | 14 right, 16 valid JSON, ~5 s each | **15 right**, 16 valid JSON, ~5.5 s each |
| Post-run plan reviews (14) | 7 right, 14 valid JSON, ~31 s each | **12 right**, 14 valid JSON, ~39 s each |

What made the difference:
- **The reply grammar is built for each request.** The model can only name sessions, dates and weeks that are in the plan it was shown; it once invented `"default"`.
- **It reaches a verdict first** (no change, ease the next hard session, rest first, lighter week, skip a day, step it up), and only then writes the edits. Code checks that the edits carry the verdict out and fills in the standard edits when they don't.
- **Code gives it facts:** whether the effort matched the session's target, and which date a weekday named in your note is.

Still missed:
- "Tough but I did it" (7/10 on sub-threshold) still gets a lighter week, though it should get no change.
- "Felt easy again" isn't stepped up; the coach stays cautious.

The phone's rule-based fallback meets all 14 plan scenarios and all 16 in-run phrases (`tests/v4/rules.test.js`, `tests/v4/intents.test.js`). Those are a useful target for a fine-tuned model.
