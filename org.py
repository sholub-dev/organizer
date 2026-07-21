#!/usr/bin/env python3
"""Organizer: local JSON store rendered by an Ubersicht desktop panel.

Items are binary: open or done. Open items carry a display-only status label:
unset means TODO, "IN_PROGRESS" otherwise (the widget cycles it on click).

Commands:
  add TITLE [--note N] [--remind ISO]            create item (open, at top)
  done ID | open ID | rm ID                      complete / reopen / delete
  up ID | down ID | move ID POS                  reorder within the open list
  note ID TEXT | remind_set ID ISO | title ID TEXT | status ID TEXT   (empty TEXT/ISO clears)
  list [--all]                                   print items (--all includes done)
  feed                                           JSON feed (Ubersicht widget); also fires reminders
  remind                                         fire due notifications
  sessions                                       recent Claude Code sessions
  ai ID on|off                                   allow AI to work this item (default: off)
  ai_input TEXT                                  headless Claude interprets TEXT and edits the store
  ai_run ID [--mode goal|loop] [--every 15m] [--prompt TEXT]
                                                 headless Claude works the item until done;
                                                 loop mode repeats at the given cadence
  ai_stop RUN_ID                                 stop a running AI run
"""
import datetime
import glob
import json
import os
import re
import signal
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(ROOT, "items.json")
NOTIFIED = os.path.join(ROOT, ".notified.json")
NOTIFIER = os.path.join(ROOT, "app", "Organizer.app", "Contents", "MacOS", "organizer")
CLAUDE_PROJECTS = os.path.expanduser("~/.claude/projects")
RUNS = os.path.join(ROOT, "runs.json")
RUNS_DIR = os.path.join(ROOT, "runs")

DONE_SHOWN_DAYS = 7
RUNS_KEPT = 30
AI_LIMITS = ["--max-turns", "100", "--max-budget-usd", "10"]


def now():
    return datetime.datetime.now().isoformat(timespec="minutes")


def load():
    try:
        with open(STORE) as f:
            items = json.load(f)["items"]
    except (OSError, ValueError, KeyError):
        return []
    for i in items:
        if "done" not in i:  # legacy stores kept open/done in "status"
            i["done"] = i.pop("status", "open") == "done"
    return items


def save(items):
    tmp = STORE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"items": items}, f, indent=2)
        f.write("\n")
    os.replace(tmp, STORE)
    # no forced Uebersicht refresh — it remounts the widget (visible blink);
    # the widget polls every 10s and updates in place instead


def find(items, item_id):
    for i in items:
        if i["id"] == item_id:
            return i
    sys.exit(f"no item with id {item_id}")


def next_id(items):
    used = {i["id"] for i in items}
    n = 1
    while str(n) in used:
        n += 1
    return str(n)


def to_ts(ts):
    if isinstance(ts, str):
        try:
            return datetime.datetime.fromisoformat(ts).timestamp()
        except ValueError:
            return None
    return ts


def fmt_span(d):
    if d < 3600:
        return f"{max(1, int(d / 60))}m"
    if d < 86400:
        return f"{int(d / 3600)}h"
    return f"{int(d / 86400)}d"


def age(ts):
    ts = to_ts(ts)
    return "" if ts is None else fmt_span(datetime.datetime.now().timestamp() - ts)


def parse_remind(s):
    try:
        return datetime.datetime.fromisoformat(s).isoformat(timespec="minutes")
    except ValueError:
        sys.exit(f"bad --remind value {s!r}, use ISO like 2026-07-12T09:00")


def is_done(i):
    return i["done"]


def visible(items):
    cutoff = (datetime.datetime.now() - datetime.timedelta(days=DONE_SHOWN_DAYS)).isoformat()
    open_items = [i for i in items if not is_done(i)]  # store order = manual order
    done_items = [i for i in items if is_done(i) and i.get("updated", "") >= cutoff]
    done_items.sort(key=lambda i: i.get("updated", ""), reverse=True)
    return open_items + done_items


def session_meta(path):
    """Last ai-title + cwd from the file tail; fall back to first user prompt."""
    title = cwd = None
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            fh.seek(max(0, size - 262144))
            for line in fh.read().decode("utf-8", "replace").splitlines():
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get("type") == "ai-title" and d.get("aiTitle"):
                    title = d["aiTitle"]
                cwd = d.get("cwd") or cwd
        if not title:
            with open(path) as fh:
                for i, line in enumerate(fh):
                    if i > 120:
                        break
                    try:
                        d = json.loads(line)
                    except ValueError:
                        continue
                    cwd = cwd or d.get("cwd")
                    if d.get("type") == "ai-title" and d.get("aiTitle"):
                        title = d["aiTitle"]
                        break
                    if not title and d.get("type") == "user":
                        c = d.get("message", {}).get("content")
                        if isinstance(c, str) and c.strip() and not c.startswith("<"):
                            title = " ".join(c.split())
    except OSError:
        pass
    return title, cwd


def recent_sessions(n=5):
    files = glob.glob(os.path.join(CLAUDE_PROJECTS, "*", "*.jsonl"))
    files.sort(key=os.path.getmtime, reverse=True)
    out = []
    for f in files:
        if len(out) >= n:
            break
        title, cwd = session_meta(f)
        if not title:
            continue
        cwd = cwd or os.path.expanduser("~")
        out.append({"id": os.path.basename(f)[:-6], "title": title[:70], "project": project_of(cwd),
                    "age": age(os.path.getmtime(f)), "cwd": cwd})
    return out


def project_of(cwd):
    home = os.path.expanduser("~")
    if cwd == home:
        return "home"
    d = cwd
    while d not in ("/", home):
        if os.path.exists(os.path.join(d, ".git")):
            return os.path.basename(d)
        d = os.path.dirname(d)
    return os.path.basename(cwd)


# ---- AI runs ----

def claude_bin():
    from shutil import which
    for c in (which("claude"), os.path.expanduser("~/.local/bin/claude"),
              os.path.expanduser("~/.claude/local/claude"), "/opt/homebrew/bin/claude"):
        if c and os.path.exists(c):
            return c
    sys.exit("claude CLI not found")


def load_runs():
    try:
        with open(RUNS) as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def save_runs(runs):
    tmp = RUNS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(runs, f, indent=2)
        f.write("\n")
    os.replace(tmp, RUNS)


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def run_info(r):
    """State + latest activity, parsed from the tail of the run's stream-json log."""
    info = {"state": "running", "activity": "", "result": None, "cost": None}
    try:
        path = os.path.join(RUNS_DIR, r["log"])
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            fh.seek(max(0, size - 65536))
            lines = fh.read().decode("utf-8", "replace").splitlines()
    except OSError:
        lines = []
    for line in lines:
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") == "assistant":
            for b in d.get("message", {}).get("content", []):
                if b.get("type") == "text" and b.get("text", "").strip():
                    info["activity"] = " ".join(b["text"].split())[:160]
                elif b.get("type") == "tool_use":
                    arg = (b.get("input") or {}).get("command") or ""
                    info["activity"] = " ".join(f"{b.get('name', 'tool')} {arg}".split())[:160]
        elif d.get("type") == "result":
            info["state"] = "failed" if d.get("is_error") else "done"
            info["result"] = " ".join((d.get("result") or "").split())[:400]
            info["cost"] = d.get("total_cost_usd")
    if alive(r["pid"]):
        info["state"] = "running"
    elif r.get("stopped"):
        info["state"] = "stopped"
    elif info["state"] == "running":
        info["state"] = "failed"  # died without emitting a result event
    return info


def parse_every(s):
    m = re.fullmatch(r"(\d+)([smh]?)", s.strip())
    if not m:
        sys.exit(f"bad --every value {s!r}, use forms like 30s / 15m / 2h")
    return int(m.group(1)) * {"s": 1, "m": 60, "h": 3600}[m.group(2) or "m"]


def spawn_run(kind, prompt, flags, cwd, item_id=None, label="", every=None):
    os.makedirs(RUNS_DIR, exist_ok=True)
    runs = load_runs()
    rid = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    while any(r["id"] == rid for r in runs):
        rid += "x"
    log = rid + ".jsonl"
    rec = {"id": rid, "kind": kind, "item_id": item_id, "label": label[:70],
           "pid": 0, "log": log, "started": now(), "prompt": prompt, "flags": flags, "dir": cwd}
    if every:
        rec.update(every=every, secs=parse_every(every))
    runs.insert(0, rec)
    for old in runs[RUNS_KEPT:]:
        try:
            os.remove(os.path.join(RUNS_DIR, old["log"]))
        except OSError:
            pass
    save_runs(runs[:RUNS_KEPT])  # the loop worker reads its record, so save before spawning
    with open(os.path.join(RUNS_DIR, log), "w") as out:
        if kind == "loop":
            cmd = [sys.executable, os.path.abspath(__file__), "ai_loop_worker", rid]
        else:
            cmd = [claude_bin(), "-p", prompt, "--output-format", "stream-json", "--verbose"] + AI_LIMITS + flags
        rec["pid"] = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT,
                                      stdin=subprocess.DEVNULL, cwd=cwd,
                                      start_new_session=True).pid
    save_runs(runs[:RUNS_KEPT])
    print(f"run {rid} started (pid {rec['pid']})")


def cmd_ai_loop_worker(args):
    """Supervisor for loop runs: /loop in `claude -p` dies with the process, so the
    cadence lives here — one claude invocation per iteration, resuming the session."""
    r = next((x for x in load_runs() if x["id"] == args.run_id), None)
    if not r:
        sys.exit(f"no run {args.run_id}")
    log = os.path.join(RUNS_DIR, r["log"])
    sid = None
    n = 0
    while True:
        off = os.path.getsize(log)
        prompt = r["prompt"] if n == 0 else f"Next iteration of the recurring check: {r['prompt']}"
        # prompt must come right after -p: variadic flags like --allowedTools would swallow it
        cmd = ([claude_bin(), "-p", prompt, "--output-format", "stream-json", "--verbose"]
               + AI_LIMITS + list(r["flags"]))
        if sid:
            cmd += ["--resume", sid]
        with open(log, "a") as out:
            subprocess.run(cmd, stdout=out, stderr=subprocess.STDOUT,
                           stdin=subprocess.DEVNULL, cwd=r["dir"])
        n += 1
        result = None
        with open(log) as fh:
            fh.seek(off)
            for line in fh:
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get("session_id"):
                    sid = d["session_id"]
                if d.get("type") == "result":
                    result = d.get("result") or ""
        runs = load_runs()
        me = next((x for x in runs if x["id"] == r["id"]), None)
        if me:
            me["iters"] = n
            save_runs(runs)
        if result is None or "LOOP_DONE" in result:
            break
        item = next((i for i in load() if i["id"] == r.get("item_id")), None)
        if item is None or is_done(item):
            break
        time.sleep(r["secs"])


def cmd_ai_input(args):
    text = args.text.strip()
    if not text:
        sys.exit("empty input")
    prompt = (f"{text}\n\n(Organizer voice/typed input; now is {now()}. Act on it via ./org.py "
              f"per CLAUDE.md: create/update items with a clean short title, reminders as ISO "
              f"timestamps. Do not ask questions.)")
    spawn_run("input", prompt,
              ["--allowedTools", "Bash(./org.py *)", "--permission-mode", "dontAsk"],
              ROOT, label=text)


def cmd_ai_run(args):
    item = find(load(), args.id)
    if is_done(item):
        sys.exit("item is done")
    if not item.get("ai"):
        sys.exit(f"item {args.id} is not AI-enabled; run: ./org.py ai {args.id} on")
    org = os.path.join(ROOT, "org.py")
    cwd = ROOT
    for line in (item.get("note") or "").splitlines():
        if line.strip().lower().startswith("dir:"):
            d = os.path.expanduser(line.split(":", 1)[1].strip())
            if os.path.isdir(d):
                cwd = d
    task = args.prompt or item["title"] + (" — " + item["note"] if item.get("note") else "")
    if args.mode == "loop":
        prompt = (f"Recurring check, one iteration per invocation (cadence {args.every}): {task}\n\n"
                  f"Do exactly one iteration now, then stop. If the objective is conclusively "
                  f"finished and no further iterations are needed, run: {org} done {item['id']} "
                  f"and end your reply with LOOP_DONE.")
    else:
        prompt = (f"/goal organizer item {item['id']} is marked done\n\nTask: {task}\n\n"
                  f"Work autonomously until genuinely complete, then run: {org} done {item['id']}\n"
                  f"Leave a short progress note along the way: {org} note {item['id']} 'TEXT'")
    flags = ["--permission-mode", "auto", "--allowedTools", f"Bash({org} *)"]
    if cwd != ROOT:
        flags += ["--add-dir", ROOT]
    spawn_run(args.mode, prompt, flags, cwd, item_id=item["id"], label=item["title"],
              every=args.every if args.mode == "loop" else None)


def cmd_ai_stop(args):
    runs = load_runs()
    for r in runs:
        if r["id"] == args.run_id:
            try:
                os.killpg(r["pid"], signal.SIGTERM)
            except OSError:
                pass
            r["stopped"] = True
            save_runs(runs)
            print(f"stopped {r['id']}")
            return
    sys.exit(f"no run {args.run_id}")


# ---- commands ----

def cmd_add(args):
    items = load()
    item = {"id": next_id(items), "title": args.title, "done": False,
            "created": now(), "updated": now()}
    if args.note:
        item["note"] = args.note
    if args.remind:
        item["remind_at"] = parse_remind(args.remind)
    items.insert(0, item)
    save(items)
    print(f"added {item['id']}: {args.title}")


def mutate(item_id, msg_verb, fn, touch=True):
    items = load()
    item = find(items, item_id)
    fn(item, items)
    if touch and item in items:
        item["updated"] = now()
    save(items)
    print(f"{msg_verb} {item_id}: {item['title']}")


def place(item_id, pos):
    items = load()
    item = find(items, item_id)
    if is_done(item):
        sys.exit("cannot move a done item")
    open_items = [i for i in items if not is_done(i)]
    done_items = [i for i in items if is_done(i)]
    open_items.remove(item)
    open_items.insert(max(0, min(pos, len(open_items))), item)
    save(open_items + done_items)
    print(f"moved {item_id}: {item['title']}")


def move(item_id, delta):
    items = load()
    item = find(items, item_id)
    if is_done(item):
        sys.exit("cannot move a done item")
    open_items = [i for i in items if not is_done(i)]
    place(item_id, open_items.index(item) + delta)


def cmd_list(args):
    items = load()
    shown = items if args.all else [i for i in items if not is_done(i)]
    if not shown:
        print("no items")
        return
    for i in shown:
        extra = " — " + i["note"] if i.get("note") else ""
        remind = f"  remind {i['remind_at']}" if i.get("remind_at") else ""
        status = f"  ({i['status']})" if i.get("status") else ""
        mark = "x" if is_done(i) else " "
        print(f"{i['id']:>3}  [{mark}]  {i['title']}{status}{extra}{remind}")


def cmd_feed(_):
    cmd_remind(None)
    autos, active = [], {}
    for r in load_runs():
        info = run_info(r)
        if info["state"] == "running" and r.get("item_id"):
            active[r["item_id"]] = r["id"]
        autos.append({"id": r["id"], "kind": r["kind"], "item_id": r.get("item_id"),
                      "label": r["label"], "state": info["state"], "age": age(r["started"]),
                      "activity": info["activity"], "result": info["result"],
                      "cost": info["cost"], "every": r.get("every"), "iters": r.get("iters")})
    print(json.dumps({
        "items": [{"id": i["id"], "title": i["title"], "note": i.get("note"),
                   "done": is_done(i), "remind_at": i.get("remind_at"),
                   "status": i.get("status"), "ai": bool(i.get("ai")),
                   "run": active.get(i["id"])}
                  for i in visible(load())],
        "sessions": recent_sessions(20),
        "automations": autos,
    }))


def notify(title):
    try:
        if os.path.exists(NOTIFIER):
            subprocess.run([NOTIFIER, "Organizer", title], capture_output=True, timeout=10)
        else:
            body = json.dumps(title)
            subprocess.run(["osascript", "-e",
                            f'display notification {body} with title "Organizer" sound name "Glass"'],
                           capture_output=True, timeout=10)
    except subprocess.TimeoutExpired:
        pass


def cmd_remind(_):
    try:
        with open(NOTIFIED) as f:
            notified = json.load(f)
    except (OSError, ValueError):
        notified = {}
    fired = False
    for i in load():
        due = i.get("remind_at")
        if not due or is_done(i) or notified.get(i["id"]) == due:
            continue
        if datetime.datetime.fromisoformat(due) <= datetime.datetime.now():
            notify(i["title"])
            notified[i["id"]] = due
            fired = True
    if fired:
        with open(NOTIFIED, "w") as f:
            json.dump(notified, f)


def main():
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add")
    a.add_argument("title")
    a.add_argument("--note")
    a.add_argument("--remind")
    a.set_defaults(fn=cmd_add)

    for name in ("done", "open", "rm", "up", "down"):
        c = sub.add_parser(name)
        c.add_argument("id")
    for name in ("note", "title", "status"):
        c = sub.add_parser(name)
        c.add_argument("id")
        c.add_argument("text")
    mv = sub.add_parser("move")
    mv.add_argument("id")
    mv.add_argument("pos", type=int)
    r = sub.add_parser("remind_set", aliases=["remind-at"])
    r.add_argument("id")
    r.add_argument("when")

    ai = sub.add_parser("ai")
    ai.add_argument("id")
    ai.add_argument("flag", choices=["on", "off"])
    ain = sub.add_parser("ai_input")
    ain.add_argument("text")
    ain.set_defaults(fn=cmd_ai_input)
    ar = sub.add_parser("ai_run")
    ar.add_argument("id")
    ar.add_argument("--mode", choices=["goal", "loop"], default="goal")
    ar.add_argument("--every", default="10m")
    ar.add_argument("--prompt")
    ar.set_defaults(fn=cmd_ai_run)
    ast = sub.add_parser("ai_stop")
    ast.add_argument("run_id")
    ast.set_defaults(fn=cmd_ai_stop)
    alw = sub.add_parser("ai_loop_worker")
    alw.add_argument("run_id")
    alw.set_defaults(fn=cmd_ai_loop_worker)

    ls = sub.add_parser("list")
    ls.add_argument("--all", action="store_true")
    ls.set_defaults(fn=cmd_list)
    for name, fn in (("feed", cmd_feed), ("remind", cmd_remind)):
        sub.add_parser(name).set_defaults(fn=fn)
    se = sub.add_parser("sessions")
    se.set_defaults(fn=lambda _: print(json.dumps(recent_sessions(), indent=2)))

    args = p.parse_args()
    if args.cmd == "done":
        mutate(args.id, "done", lambda i, _: i.update(done=True))
    elif args.cmd == "open":
        mutate(args.id, "reopen", lambda i, _: i.update(done=False))
    elif args.cmd == "rm":
        mutate(args.id, "rm", lambda i, items: items.remove(i))
    elif args.cmd in ("up", "down"):
        move(args.id, -1 if args.cmd == "up" else 1)
    elif args.cmd == "move":
        place(args.id, args.pos)
    elif args.cmd == "note":
        mutate(args.id, "note",
               lambda i, _: i.update(note=args.text) if args.text else i.pop("note", None),
               touch=False)
    elif args.cmd == "title":
        mutate(args.id, "retitle", lambda i, _: i.update(title=args.text), touch=False)
    elif args.cmd == "status":
        mutate(args.id, "status",
               lambda i, _: i.update(status=args.text) if args.text else i.pop("status", None),
               touch=False)
    elif args.cmd == "ai":
        mutate(args.id, "ai",
               lambda i, _: i.update(ai=True) if args.flag == "on" else i.pop("ai", None),
               touch=False)
    elif args.cmd in ("remind_set", "remind-at"):
        mutate(args.id, "remind",
               lambda i, _: i.update(remind_at=parse_remind(args.when)) if args.when
               else i.pop("remind_at", None),
               touch=False)
    else:
        args.fn(args)


if __name__ == "__main__":
    main()
