# Organizer

A local-first work+life organizer for macOS, operated by Claude Code (voice in,
Claude edits the store) and viewed on the desktop — no browser tab.

- **Store**: `items.json` — plain JSON, one item per entry, status strictly
  open or done. Local only and gitignored; created empty by `install.sh`.
- **Brain**: `org.py` — the only writer. CRUD subcommands plus the widget feed
  (`feed`) and the reminder checker (`remind`). Run `./org.py -h`.
- **Desktop panel**: `ubersicht/organizer.jsx` — Übersicht widget with two
  tabs. Work Items (default): one-line rows, checkbox on the left, a status
  label on the right ("TD" gray by default; click it to toggle "IP" green),
  drag rows to reorder by importance (open items keep manual order; new
  items land on top), delete asks for a second click to confirm, click a row
  to expand its comment (accordion), closed
  items under a collapsible "closed" divider (collapsed by default),
  type-to-add input at the bottom with an "AI" toggle chip — when on, the
  text is sent to a headless Claude Code run that interprets it (e.g. "remind
  me in two hours to X") and edits the store itself. Each open row also has a
  dim "AI" badge: click to allow AI on that item (default is human-only),
  then "run" launches a detached `claude -p` goal run that works the task
  until it marks it done; the badge glows blue and the title tints while a
  run is active, and "stop" kills it. AI Runs tab: every run (input / goal /
  loop) with live state, latest activity line, age, and a stop control;
  loop runs show their cadence next to the state ("LOOP·15m") and an
  iteration counter, and repeat until the item is done, the model signals
  completion, or they are stopped.
  Click a row to expand the result and cost. Claude
  Sessions: project name, then the session title (from ai-title lines),
  last-used on the right, scrollable. Interacting needs Übersicht's one-time
  setup: set an interaction shortcut in its preferences and grant
  Accessibility access, then hold the shortcut while clicking. Position/size
  are the `top/right/width` values in its CSS.
- **Notifications**: the widget's `feed` command also runs the reminder check
  every 10 seconds; items whose `remind_at` has passed fire a native
  notification once (state in `.notified.json`, gitignored). No launchd job —
  background agents cannot read `~/Documents` without Full Disk Access, so the
  Übersicht process (which already has access) does the firing. Notifications
  are posted by `app/Organizer.app`, a tiny faceless Swift bundle built by
  `app/build.sh` (own name and icon; allow it in Notification settings on
  first run). If the bundle is missing, `org.py` falls back to `osascript`.
- **Sessions**: recent Claude Code sessions are read from
  `~/.claude/projects/*/*.jsonl` (title = last ai-title line, project = the
  enclosing git repo of the session's cwd).

## Install

```
brew install --cask ubersicht   # if not installed
curl -fsSL https://raw.githubusercontent.com/sholub-dev/organizer/master/install.sh | bash
```

The install always lives in `~/.organizer`; rerun the same command to
update. Running `./install.sh` from a manual clone installs the clone's code
to the same place (the clone itself stays a plain source checkout).

`install.sh` is idempotent: syncs the code into `~/.organizer` (never
touching the store or other local data there), creates an empty `items.json`
if missing, builds the notifier app (needs Xcode Command Line Tools; falls
back to `osascript` without them), symlinks the widget into Übersicht and
relaunches or refreshes it, and removes the legacy launchd job if present.

Two one-time macOS steps after that:

- **Interaction**: in Übersicht preferences set an interaction shortcut and
  grant Accessibility access; hold the shortcut while clicking the widget.
- **Notifications**: allow "Organizer" in System Settings > Notifications
  when the first reminder fires.

Your items live in `~/.organizer/items.json` — local only and gitignored,
nothing leaves your machine. To let Claude Code drive it by voice, just tell
it about `org.py` (or copy this repo's `CLAUDE.md`).
