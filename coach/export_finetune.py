# Turns the coach's logs into training data for fine-tuning a LoRA later (for example with Unsloth on
# Kaggle's free GPUs). Nothing is trained here.
#   Laptop log:  coach/data/exchanges.jsonl (every prompt and reply) + coach/data/outcomes.jsonl (what you did)
#   Phone log:   the "Coach log" file from Pacer > Settings (optional; pass its path)
# Writes coach/data/finetune/:
#   train.jsonl     chat examples {"messages": [system, user, assistant]} you kept (accepted, not undone)
#   rejected.jsonl  replies you turned down or undid (for preference tuning later, e.g. DPO)
#   stats.json      counts
# Run:  .venv\Scripts\python export_finetune.py [path\to\pacer-coach-log.jsonl]

# Bring in command-line options.
import argparse
# Bring in JSON.
import json
# Bring in file paths.
import pathlib

# The prompts, to rebuild examples from the phone's log in exactly the app's format.
import prompts

# The folder this file is in.
HERE = pathlib.Path(__file__).parent
# The laptop's logs.
DATA = HERE / "data"


# Read a JSON Lines file (missing file: nothing).
def read_jsonl(path):
    # No file, no lines.
    if not path.exists():
        # Empty.
        return []
    # One JSON object per non-empty line.
    return [json.loads(line) for line in path.read_text(encoding="utf8").splitlines() if line.strip()]


# Build the training files.
def main():
    # The options.
    ap = argparse.ArgumentParser(description="Export the coach's logs as fine-tuning data")
    # Phone logs, if any.
    ap.add_argument("phone_logs", nargs="*", help="Coach log files exported from Pacer's Settings")
    # Read them.
    args = ap.parse_args()
    # Every model exchange.
    exchanges = read_jsonl(DATA / "exchanges.jsonl")
    # The last outcome reported for each exchange.
    outcome = {}
    # Read the outcomes in order, so later ones win.
    for o in read_jsonl(DATA / "outcomes.jsonl"):
        # Keep it by exchange id.
        outcome[o.get("id")] = o
    # Examples kept, examples rejected.
    train, rejected = [], []
    # Counts for the summary.
    stats = {"exchanges": len(exchanges), "intent_kept": 0, "plan_kept": 0, "rejected": 0, "phone_rules": 0, "skipped": 0}
    # Look at each exchange.
    for x in exchanges:
        # What happened to it.
        o = outcome.get(x["id"], {}).get("outcome")
        # The prompt (system and user messages).
        prompt = [m for m in x["messages"] if m["role"] != "assistant"]
        # An in-run intent you didn't undo: keep the model's own answer.
        if x["task"] == "intent" and o == "applied" and x["parsed"].get("valid"):
            # The answer as the model should give it.
            answer = json.dumps({"intent": x["parsed"]["intent"], "say": x["parsed"]["say"]})
            # Keep it.
            train.append({"messages": prompt + [{"role": "assistant", "content": answer}], "meta": {"id": x["id"], "task": "intent"}})
            # Count it.
            stats["intent_kept"] += 1
        # A plan review you accepted: keep only the edits that passed the app's rules.
        elif x["task"] == "plan" and o == "accepted":
            # The edits that were applied.
            applied = outcome[x["id"]].get("applied") or []
            # The answer as the model should have given it.
            answer = json.dumps({"edits": applied, "say": x["parsed"].get("say", "")})
            # Keep it.
            train.append({"messages": prompt + [{"role": "assistant", "content": answer}], "meta": {"id": x["id"], "task": "plan"}})
            # Count it.
            stats["plan_kept"] += 1
        # Turned down or undone: keep for preference tuning.
        elif o in ("rejected", "undone"):
            # The model's reply as it was.
            rejected.append({"messages": x["messages"], "meta": {"id": x["id"], "task": x["task"], "outcome": o, "why": outcome[x["id"]].get("rejected")}})
            # Count it.
            stats["rejected"] += 1
        # No outcome yet (for example the phone was offline).
        else:
            # Skip it.
            stats["skipped"] += 1
    # The phone's own log: things said while the laptop was away, understood by the phone's rules.
    for p in args.phone_logs:
        # Each event in it.
        for ev in read_jsonl(pathlib.Path(p)):
            # Only spoken or typed requests the phone handled itself, and not undone.
            if ev.get("type") == "intent" and ev.get("by") == "rules" and ev.get("text"):
                # The same prompt the laptop would have used, and the phone's answer as the label.
                train.append({"messages": prompts.intent_messages(ev["text"]) + [{"role": "assistant", "content": json.dumps({"intent": ev["intent"], "say": ""})}], "meta": {"task": "intent", "source": "phone-rules"}})
                # Count it.
                stats["phone_rules"] += 1
    # Where the files go.
    out = DATA / "finetune"
    # Make the folder.
    out.mkdir(parents=True, exist_ok=True)
    # Write the training examples.
    (out / "train.jsonl").write_text("".join(json.dumps(t, ensure_ascii=False) + "\n" for t in train), encoding="utf8")
    # Write the rejected replies.
    (out / "rejected.jsonl").write_text("".join(json.dumps(t, ensure_ascii=False) + "\n" for t in rejected), encoding="utf8")
    # Write the counts.
    (out / "stats.json").write_text(json.dumps(stats, indent=1), encoding="utf8")
    # Say what was written.
    print(json.dumps(stats), "->", out)


# Run when started directly.
if __name__ == "__main__":
    # Export.
    main()
