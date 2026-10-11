# The laptop coach's front door: a small web server that stands between the internet and Ollama.
# Only the Pacer app (with the secret pairing code) gets in, and only to these endpoints:
#   GET  /health  - is the laptop up, is the model loaded, is voice available
#   POST /warm    - load the model (and Whisper) now, so the first reply during a run is quick
#   POST /intent  - text spoken mid-run -> {intent, say}
#   POST /voice   - a short WAV recording -> Whisper text -> {text, intent, say}
#   POST /plan    - post-run feedback + the next days of the plan -> {edits, say}
#   POST /log     - the app reports what happened (accepted, rejected, applied) for future fine-tuning
# Ollama itself is never exposed: it only listens on this laptop.
# Uses only Python's standard library; Whisper (faster-whisper) is optional and adds voice.

# Bring in hashing and constant-time comparison for the secret code.
import hmac
# Bring in JSON reading and writing.
import json
# Bring in file paths.
import pathlib
# Bring in secure random numbers for the pairing code.
import secrets
# Bring in threads (one request at a time reaches the model).
import threading
# Bring in timing.
import time
# Bring in unique ids for each exchange.
import uuid
# Bring in WAV reading for voice clips.
import wave
# Bring in in-memory files.
import io
# Bring in calls to Ollama.
import urllib.request
# Bring in the web server pieces.
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Bring in the prompts and reply checks shared with the eval.
import prompts

# The folder this file is in.
HERE = pathlib.Path(__file__).parent
# Where settings (the pairing code) are kept: never shared, never committed.
CONFIG = HERE / "config.json"
# Where every exchange is logged for future fine-tuning.
DATA = HERE / "data"
# Ollama's address (only reachable from this laptop).
OLLAMA = "http://127.0.0.1:11434"
# The web pages allowed to call this server.
ORIGINS = {"https://hutchybakes-glitch.github.io", "http://localhost:8765", "http://127.0.0.1:8765"}
# Largest request accepted (a voice clip of about 15 seconds).
MAX_BODY = 600_000
# Letters for the pairing code (no 0/O or 1/I/L to mix up).
ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

# One model call at a time (the laptop has no spare memory for two).
MODEL_LOCK = threading.Lock()
# One log write at a time.
LOG_LOCK = threading.Lock()
# Failed sign-in times, to slow down anyone guessing the code.
FAILS = []
# Whisper, once loaded.
WHISPER = {"model": None, "state": "off", "error": None}
# Plan reviews in progress or finished, by job id (a review takes up to a minute, so the phone checks back).
JOBS = {}


# Read the settings, creating a pairing code the first time.
def load_config():
    # Use the saved settings if there are any.
    if CONFIG.exists():
        # Read them.
        cfg = json.loads(CONFIG.read_text(encoding="utf8"))
    # Otherwise start fresh.
    else:
        # Empty settings.
        cfg = {}
    # Make a pairing code if there is none: four groups of four letters (about 79 bits of randomness).
    if not cfg.get("code"):
        # Sixteen random letters from the safe alphabet, in groups of four.
        cfg["code"] = "-".join("".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(4))
    # The port this server listens on.
    cfg.setdefault("port", 8787)
    # Save the settings.
    CONFIG.write_text(json.dumps(cfg, indent=1), encoding="utf8")
    # Hand them back.
    return cfg


# The settings, loaded once.
CFG = load_config()


# The code as the phone sends it: capitals, no dashes or spaces.
def norm_code(c):
    # Keep only letters and digits, in capitals.
    return "".join(ch for ch in str(c).upper() if ch.isalnum())


# Add one line to a log file in the data folder.
def log(name, record):
    # Make the data folder if needed.
    DATA.mkdir(exist_ok=True)
    # One writer at a time.
    with LOG_LOCK:
        # Append the record as one JSON line.
        with open(DATA / name, "a", encoding="utf8") as f:
            # Write it.
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


# Ask Ollama for a reply in an exact JSON shape; returns the raw text and timings.
def chat(messages, schema, max_tokens, timeout=90):
    # The request: our model, kept loaded forever, replying in the given shape.
    body = {"model": prompts.MODEL, "messages": messages, "stream": False, "format": schema, "keep_alive": -1, "options": {**prompts.OPTIONS, "num_predict": max_tokens}}
    # Package it for Ollama.
    req = urllib.request.Request(OLLAMA + "/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
    # One model call at a time.
    with MODEL_LOCK:
        # Note the start time.
        t0 = time.time()
        # Send it and read the answer.
        with urllib.request.urlopen(req, timeout=timeout) as r:
            # Parse Ollama's reply.
            out = json.load(r)
    # The text and how long it took.
    return out["message"]["content"], {"ms": round((time.time() - t0) * 1000), "prompt_tokens": out.get("prompt_eval_count"), "tokens": out.get("eval_count")}


# Load the model into memory and keep it there.
def warm_model():
    # A tiny in-run request loads the model and leaves the in-run instructions ready for reuse (same settings as real calls, so it is not reloaded).
    chat(prompts.intent_messages("ok"), prompts.INTENT_SCHEMA, 8)


# Is the model in memory right now?
def model_loaded():
    # Ask Ollama which models are loaded.
    try:
        # Read the list.
        with urllib.request.urlopen(OLLAMA + "/api/ps", timeout=3) as r:
            # Look for ours.
            return any(m.get("name", "").startswith(prompts.MODEL) for m in json.load(r).get("models", []))
    # Ollama not answering.
    except OSError:
        # Not loaded.
        return False


# Load Whisper in the background (voice works once it is ready).
def load_whisper():
    # Only once.
    if WHISPER["state"] in ("loading", "ready"):
        # Nothing to do.
        return
    # Mark it as loading.
    WHISPER["state"] = "loading"
    # Try to load faster-whisper's small English model.
    try:
        # Bring in faster-whisper (installed by start.bat).
        from faster_whisper import WhisperModel
        # The base English model, compressed to run fast on a CPU.
        WHISPER["model"] = WhisperModel("base.en", device="cpu", compute_type="int8")
        # Ready for voice.
        WHISPER["state"] = "ready"
    # Not installed, or the download failed.
    except Exception as e:  # noqa: BLE001
        # Remember why, and carry on without voice.
        WHISPER.update(state="unavailable", error=str(e)[:200])


# Turn a WAV recording into text.
def transcribe(data):
    # Bring in numpy (installed with faster-whisper).
    import numpy as np
    # Open the WAV from memory.
    with wave.open(io.BytesIO(data)) as w:
        # It must be 16-bit mono at 16 kHz, as the app records.
        if w.getsampwidth() != 2 or w.getnchannels() != 1 or w.getframerate() != 16000:
            # Say what was wrong.
            raise ValueError("expected 16 kHz mono 16-bit WAV")
        # Read the samples as numbers between -1 and 1.
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    # Transcribe, nudged towards running words.
    segs, _ = WHISPER["model"].transcribe(audio, language="en", beam_size=1, without_timestamps=True, condition_on_previous_text=False, initial_prompt="Running coach: slower, faster, struggling, too easy, how am I doing, keep this pace.")
    # Join the pieces of text.
    return " ".join(s.text.strip() for s in segs).strip()


# What the model makes of something said mid-run.
def run_intent(text, source):
    # A fresh id for this exchange.
    xid = uuid.uuid4().hex[:12]
    # The messages for the model.
    msgs = prompts.intent_messages(text)
    # Ask the model (short reply: JSON plus one sentence).
    raw, meta = chat(msgs, prompts.INTENT_SCHEMA, 48, timeout=25)
    # Check the reply.
    out = prompts.parse_intent(raw)
    # Log the whole exchange for fine-tuning later.
    log("exchanges.jsonl", {"id": xid, "ts": time.time(), "task": "intent", "source": source, "messages": msgs + [{"role": "assistant", "content": raw}], "parsed": out, "model": prompts.MODEL, **meta})
    # The reply for the phone.
    return {"id": xid, "intent": out["intent"], "say": out["say"], "valid": out["valid"], "ms": meta["ms"]}


# A plan review (run on its own thread): ask the model, check the reply, log it, store the result.
def plan_job(xid, req):
    # Any failure is stored for the phone to see.
    try:
        # The next days of the plan, as the phone sent them (at most 14).
        window = list(req.get("window") or [])[:14]
        # The messages for the model.
        msgs = prompts.plan_messages(dict(req.get("feedback") or {}), window, req.get("week"))
        # Ask the model (JSON edits plus a sentence or two).
        out_raw, meta = chat(msgs, prompts.edits_schema_for(window), 220, timeout=120)
        # Check the reply.
        out = prompts.parse_edits(out_raw, window, (req.get("feedback") or {}).get("session"))
        # Log the whole exchange for fine-tuning later.
        log("exchanges.jsonl", {"id": xid, "ts": time.time(), "task": "plan", "messages": msgs + [{"role": "assistant", "content": out_raw}], "parsed": out, "model": prompts.MODEL, **meta})
        # The result, ready for the phone.
        JOBS[xid] = {"status": "done", "id": xid, **out, "ms": meta["ms"]}
    # The model failed or was too slow.
    except (OSError, ValueError, KeyError) as e:
        # Tell the phone, which falls back to its own rules.
        JOBS[xid] = {"status": "error", "id": xid, "error": str(e)[:200]}


# The request handler: one instance per request.
class Handler(BaseHTTPRequestHandler):
    # Name sent in replies.
    server_version = "PacerCoach/1"
    # Keep connections open between requests (quicker through the tunnel).
    protocol_version = "HTTP/1.1"
    # Whether this request's body has been read (if not, the connection must close after replying).
    body_read = False

    # Keep the console quiet apart from a short line per request.
    def log_message(self, fmt, *args):
        # Print the time and the request line.
        print(time.strftime("%H:%M:%S"), self.command, self.path.split("?")[0], *args[1:2])

    # The CORS headers, for allowed web pages only.
    def cors(self):
        # The page asking.
        origin = self.headers.get("Origin", "")
        # Only allowed pages get the go-ahead.
        if origin in ORIGINS:
            # Let that page read the reply.
            self.send_header("Access-Control-Allow-Origin", origin)
            # Caches must keep replies for different pages apart.
            self.send_header("Vary", "Origin")

    # Send a JSON reply.
    def reply(self, code, obj):
        # The reply as bytes.
        body = json.dumps(obj).encode()
        # The status line.
        self.send_response(code)
        # CORS for the app.
        self.cors()
        # It is JSON.
        self.send_header("Content-Type", "application/json")
        # Never cache.
        self.send_header("Cache-Control", "no-store")
        # Its length.
        self.send_header("Content-Length", str(len(body)))
        # End of headers.
        self.end_headers()
        # The body.
        self.wfile.write(body)
        # An unread request body would confuse the next request on this connection, so close it.
        if not self.body_read and int(self.headers.get("Content-Length") or 0):
            # Close after this reply.
            self.close_connection = True

    # The browser's check before a cross-site request.
    def do_OPTIONS(self):
        # No content.
        self.send_response(204)
        # CORS for the app.
        self.cors()
        # The methods allowed.
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        # The headers the app sends.
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        # Remember this for ten minutes.
        self.send_header("Access-Control-Max-Age", "600")
        # Nothing else.
        self.send_header("Content-Length", "0")
        # End of headers.
        self.end_headers()

    # Is the caller allowed in? (the secret code, with slow-down after repeated failures)
    def authorised(self):
        # Forget failures older than ten minutes.
        now = time.time()
        # Keep only recent failures.
        FAILS[:] = [t for t in FAILS if now - t < 600]
        # After 20 recent failures, refuse everything for a while.
        if len(FAILS) >= 20:
            # Too many guesses.
            self.reply(429, {"error": "too many attempts, wait ten minutes"})
            # Not allowed.
            return False
        # The code sent as "Authorization: Bearer CODE".
        sent = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        # Compare in constant time so the code can't be guessed letter by letter.
        if hmac.compare_digest(norm_code(sent).encode(), norm_code(CFG["code"]).encode()):
            # Allowed.
            return True
        # Count the failure.
        FAILS.append(now)
        # Say no.
        self.reply(401, {"error": "wrong pairing code"})
        # Not allowed.
        return False

    # Read the request body (within the size limit).
    def body(self):
        # How big it says it is.
        n = int(self.headers.get("Content-Length") or 0)
        # Note that the body is being dealt with.
        self.body_read = True
        # Refuse anything too big (and close, as the body is left unread).
        if n > MAX_BODY:
            # Close after replying.
            self.close_connection = True
            # Too big.
            raise ValueError("request too large")
        # Read it.
        return self.rfile.read(n) if n else b""

    # GET requests: only /health.
    def do_GET(self):
        # The endpoint asked for.
        path = self.path.split("?")[0]
        # Only /health and /job are here.
        if path not in ("/health", "/job"):
            # Not found.
            return self.reply(404, {"error": "not found"})
        # Check the code.
        if not self.authorised():
            # Already answered.
            return
        # A plan review: is it done yet?
        if path == "/job":
            # The job id from "?id=…".
            jid = self.path.partition("id=")[2][:20]
            # Unknown job.
            if jid not in JOBS:
                # Not found.
                return self.reply(404, {"error": "no such job"})
            # Its state (and result once done).
            return self.reply(200, JOBS[jid])
        # Report what is ready.
        self.reply(200, {"ok": True, "model": prompts.MODEL, "loaded": model_loaded(), "voice": WHISPER["state"], "time": time.time()})

    # POST requests: the coach's endpoints.
    def do_POST(self):
        # The endpoint asked for.
        path = self.path.split("?")[0]
        # Only these exist.
        if path not in ("/warm", "/intent", "/voice", "/plan", "/log"):
            # Not found.
            return self.reply(404, {"error": "not found"})
        # Check the code.
        if not self.authorised():
            # Already answered.
            return
        # Handle it, turning any failure into a clear error.
        try:
            # Read the body.
            raw = self.body()
            # Load the model and Whisper.
            if path == "/warm":
                # Start Whisper loading in the background.
                threading.Thread(target=load_whisper, daemon=True).start()
                # Load the model now.
                warm_model()
                # Report.
                return self.reply(200, {"ok": True, "loaded": model_loaded(), "voice": WHISPER["state"]})
            # A voice clip: transcribe, then read the intent.
            if path == "/voice":
                # Voice needs Whisper.
                if WHISPER["state"] != "ready":
                    # Start loading it for next time.
                    threading.Thread(target=load_whisper, daemon=True).start()
                    # Tell the phone to use its own fallback for now.
                    return self.reply(503, {"error": "voice not ready", "voice": WHISPER["state"]})
                # Time the transcription.
                t0 = time.time()
                # Speech to text.
                text = transcribe(raw)
                # How long that took.
                stt_ms = round((time.time() - t0) * 1000)
                # Nothing heard.
                if not text:
                    # Say so.
                    return self.reply(200, {"text": "", "intent": "none", "say": "", "stt_ms": stt_ms})
                # Read the intent from the words.
                return self.reply(200, {"text": text, "stt_ms": stt_ms, **run_intent(text, "voice")})
            # Everything else is JSON.
            req = json.loads(raw or b"{}")
            # Text from the phone (typed, dictated, or a recognised phrase).
            if path == "/intent":
                # Read the intent.
                return self.reply(200, run_intent(str(req.get("text", ""))[:300], req.get("source", "text")))
            # A plan review: start it in the background and hand back a job id to check on.
            if path == "/plan":
                # A fresh id for this exchange (and its job).
                xid = uuid.uuid4().hex[:12]
                # Forget old jobs (keep the last 30).
                for old in list(JOBS)[:-30]:
                    # Drop it.
                    JOBS.pop(old, None)
                # Mark it as running.
                JOBS[xid] = {"status": "running", "id": xid}
                # Do the review on its own thread.
                threading.Thread(target=plan_job, args=(xid, req), daemon=True).start()
                # Reply straight away.
                return self.reply(202, {"job": xid})
            # The phone reports an outcome (accepted, rejected, which edits passed the rules).
            log("outcomes.jsonl", {"ts": time.time(), **{k: req.get(k) for k in ("id", "task", "outcome", "applied", "rejected", "edits", "note")}})
            # Thanks.
            return self.reply(200, {"ok": True})
        # A request we could not handle.
        except (ValueError, KeyError) as e:
            # Bad request.
            return self.reply(400, {"error": str(e)[:200]})
        # Ollama not answering, or too slow.
        except OSError as e:
            # Service unavailable: the phone falls back to its own rules.
            return self.reply(503, {"error": "model unavailable: " + str(e)[:160]})


# Start the server (blocks until stopped).
def serve(port=None):
    # Listen on this laptop only: the tunnel brings the internet to it.
    srv = ThreadingHTTPServer(("127.0.0.1", port or CFG["port"]), Handler)
    # Serve until stopped.
    srv.serve_forever()


# Run the server on its own when this file is run directly.
if __name__ == "__main__":
    # Say how to reach it.
    print(f"Pacer coach on http://127.0.0.1:{CFG['port']}  code {CFG['code']}")
    # Serve.
    serve()
