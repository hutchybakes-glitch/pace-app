# Starts everything the phone needs, in order, and keeps it running:
#   1. Ollama (started if it isn't running) with qwen2.5:3b, loaded and kept in memory
#   2. the proxy (proxy.py) on this laptop
#   3. a free Cloudflare quick tunnel (no account): a public https address that reaches the proxy
#   4. the address posted to a private ntfy.sh topic (free, no account) so the phone finds it by itself
#   5. a check through the tunnel, as the phone would make it
# The laptop is kept awake while this window is open. Close the window (or press Ctrl+C) to stop.

# Bring in hashing (the private topic name comes from the pairing code).
import hashlib
# Bring in JSON.
import json
# Bring in operating-system details.
import os
# Bring in file paths.
import pathlib
# Bring in regular expressions (to spot the tunnel address).
import re
# Bring in running other programs.
import subprocess
# Bring in system details (Windows or not).
import sys
# Bring in threads.
import threading
# Bring in timing.
import time
# Bring in web requests.
import urllib.request

# Quieten the model downloader's warnings about Windows file links and sign-in (neither is needed).
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
# Quieten its progress bars too.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
# Hide its "unauthenticated requests" notice (public models need no account).
os.environ.setdefault("HF_HUB_VERBOSITY", "error")
# Bring in warnings, to hide the rest of the downloader's chatter.
import warnings
# Ignore warnings from the downloader.
warnings.filterwarnings("ignore", module="huggingface_hub")

# Bring in the proxy.
import proxy
# Bring in the model name.
import prompts

# The folder this file is in.
HERE = pathlib.Path(__file__).parent
# Where cloudflared is kept.
CLOUDFLARED = HERE / "bin" / ("cloudflared.exe" if os.name == "nt" else "cloudflared")
# The relay that tells the phone the tunnel address (free, no account; set "relay": "" in config.json to turn it off).
RELAY = proxy.CFG.get("relay", "https://ntfy.sh")
# The tunnel address once known.
STATE = {"url": None, "posted": 0, "live": None}


# Print a line with the time.
def say(msg):
    # Time, then the message.
    print(time.strftime("%H:%M:%S"), msg, flush=True)


# The private topic the address is posted to (anyone without the pairing code can't work it out).
def topic():
    # A hash of the pairing code.
    return "pacer-" + hashlib.sha256(("pacer:" + proxy.norm_code(proxy.CFG["code"])).encode()).hexdigest()[:32]


# Fetch JSON from a web address.
def get_json(url, timeout=5, headers=None):
    # Make the request.
    req = urllib.request.Request(url, headers=headers or {})
    # Read and parse the answer.
    with urllib.request.urlopen(req, timeout=timeout) as r:
        # Parse it.
        return json.load(r)


# Make sure Ollama is running, starting it if needed.
def ensure_ollama():
    # Is it answering already?
    try:
        # Ask its version.
        v = get_json(proxy.OLLAMA + "/api/version")
        # It is.
        say(f"Ollama {v.get('version')} is running")
        # Done.
        return
    # Not answering.
    except OSError:
        # Start it.
        say("Starting Ollama…")
    # Keep models loaded and only answer this laptop.
    env = {**os.environ, "OLLAMA_KEEP_ALIVE": "-1", "OLLAMA_HOST": "127.0.0.1:11434"}
    # Start "ollama serve" without a window of its own.
    subprocess.Popen(["ollama", "serve"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    # Wait up to a minute for it to answer.
    for _ in range(60):
        # Try again.
        try:
            # Ask its version.
            get_json(proxy.OLLAMA + "/api/version")
            # It's up.
            say("Ollama started")
            # Done.
            return
        # Not yet.
        except OSError:
            # Wait a second.
            time.sleep(1)
    # It never answered.
    raise SystemExit("Ollama didn't start. Is it installed? (https://ollama.com, free)")


# Make sure the model has been downloaded.
def ensure_model():
    # The models on this laptop.
    names = [m["name"] for m in get_json(proxy.OLLAMA + "/api/tags").get("models", [])]
    # Already here.
    if any(n.startswith(prompts.MODEL) for n in names):
        # Nothing to do.
        return
    # Download it (about 2 GB, free).
    say(f"Downloading {prompts.MODEL} (about 2 GB, once)…")
    # Ollama's own downloader.
    subprocess.run(["ollama", "pull", prompts.MODEL], check=True)


# Keep the laptop from sleeping while this runs (Windows only).
def keep_awake():
    # Only on Windows.
    if os.name != "nt":
        # Nothing to do elsewhere.
        return
    # Bring in access to Windows functions.
    import ctypes
    # "Keep the system running until told otherwise".
    ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)


# Download cloudflared once (free, open source, from Cloudflare's GitHub releases).
def ensure_cloudflared():
    # Already here.
    if CLOUDFLARED.exists():
        # Nothing to do.
        return
    # Make the folder.
    CLOUDFLARED.parent.mkdir(exist_ok=True)
    # The Windows download.
    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    # Say what's happening.
    say("Downloading cloudflared (about 55 MB, once)…")
    # Download it.
    urllib.request.urlretrieve(url, CLOUDFLARED)


# Post the tunnel address to the private topic so the phone can find it.
def post_url(url):
    # Turned off in the settings.
    if not RELAY:
        # Nothing to do.
        return
    # Try to post it.
    try:
        # A small JSON message with the address.
        req = urllib.request.Request(f"{RELAY}/{topic()}", json.dumps({"url": url, "at": int(time.time())}).encode(), {"Title": "pacer"})
        # Send it.
        urllib.request.urlopen(req, timeout=10).read()
        # Remember when.
        STATE["posted"] = time.time()
        # Say so.
        say("Address posted for the phone to find")
    # The relay can't be reached.
    except OSError as e:
        # Carry on: the address can be typed into the app instead.
        say(f"Couldn't post the address ({e}); type it into the app instead")


# Run the tunnel, restarting it if it stops; post each new address.
def tunnel_loop(port):
    # Forever.
    while True:
        # Start a quick tunnel to the proxy.
        p = subprocess.Popen([str(CLOUDFLARED), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        # Read its messages as they come.
        for line in p.stdout:
            # Look for the public address.
            m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            # Found a new one.
            if m and m.group(0) != STATE["url"]:
                # Remember it.
                STATE["url"] = m.group(0)
                # Once it answers, post it (in the background, so the tunnel's messages keep being read).
                threading.Thread(target=go_live, args=(STATE["url"],), daemon=True).start()
        # The tunnel stopped.
        say("Tunnel stopped; restarting in 5 s…")
        # Forget the old address.
        STATE["url"] = None
        # Wait a moment.
        time.sleep(5)


# Wait until a new address really works, then post it (posting too early can leave the phone's network
# remembering "no such address" for minutes).
def go_live(url):
    # New addresses take a few seconds to appear.
    time.sleep(8)
    # Try for up to three minutes.
    for _ in range(36):
        # Stop if a newer address has replaced this one.
        if STATE["url"] != url:
            # Nothing more to do.
            return
        # Ask the proxy's health through the tunnel, as the phone would.
        try:
            # With the pairing code.
            h = get_json(url + "/health", 10, {"Authorization": "Bearer " + proxy.CFG["code"], "Origin": "https://hutchybakes-glitch.github.io"})
            # It works: say so.
            say(f"Phone link OK · model {'loaded' if h.get('loaded') else 'loading'} · voice {h.get('voice')}")
            # Remember it's live.
            STATE["live"] = url
            # Tell the phone where to find it.
            post_url(url)
            # Done.
            return
        # Not yet.
        except OSError:
            # Wait and retry.
            time.sleep(5)
    # Still not answering.
    say("The tunnel isn't answering; check the internet connection")


# Re-post the address every six hours (the relay forgets after twelve).
def repost_loop():
    # Forever.
    while True:
        # Check every minute.
        time.sleep(60)
        # Time to post again.
        if STATE["url"] and time.time() - STATE["posted"] > 6 * 3600:
            # Post it.
            post_url(STATE["url"])


# Wait (up to four minutes) until the phone link works.
def wait_live():
    # Check every second.
    for _ in range(240):
        # Live.
        if STATE.get("live"):
            # Stop waiting.
            return
        # Not yet.
        time.sleep(1)


# Load the model and Whisper in the background.
def warm():
    # Load Whisper (for voice) if it's installed.
    threading.Thread(target=proxy.load_whisper, daemon=True).start()
    # Load the model into memory.
    try:
        # A tiny request does it.
        t0 = time.time()
        # Load.
        proxy.warm_model()
        # Say how long it took.
        say(f"{prompts.MODEL} loaded and kept in memory ({time.time() - t0:.0f} s)")
    # Failed to load.
    except OSError as e:
        # Say so.
        say(f"Couldn't load the model: {e}")


# Start everything.
def main():
    # Show the title.
    print("\n  PACER LAPTOP COACH\n  ==================\n")
    # Ollama first.
    ensure_ollama()
    # Then the model.
    ensure_model()
    # Then the tunnel program.
    ensure_cloudflared()
    # Keep the laptop awake.
    keep_awake()
    # The proxy's port.
    port = proxy.CFG["port"]
    # Start the proxy.
    threading.Thread(target=proxy.serve, args=(port,), daemon=True).start()
    # Load the model and Whisper.
    threading.Thread(target=warm, daemon=True).start()
    # Start the tunnel.
    threading.Thread(target=tunnel_loop, args=(port,), daemon=True).start()
    # Keep the address fresh.
    threading.Thread(target=repost_loop, daemon=True).start()
    # The pairing code, big and clear.
    print(f"\n  Pairing code:  {proxy.CFG['code']}\n  (Pacer > Settings > Laptop coach. Enter it once.)\n", flush=True)
    # Wait for the phone link.
    wait_live()
    # Show the address too, for typing in by hand if needed.
    print(f"\n  Address: {STATE['url']}\n  Leave this window open while you run. Close it to stop.\n", flush=True)
    # Wait until stopped.
    try:
        # Sleep in long naps.
        while True:
            # A minute at a time.
            time.sleep(60)
    # Ctrl+C.
    except KeyboardInterrupt:
        # Say goodbye.
        say("Stopping")


# Run when started directly.
if __name__ == "__main__":
    # Start.
    main()
