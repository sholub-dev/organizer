# Organizer

Personal work+life task list. The live install is always `~/.organizer` —
that is where the widget's code and the store live; a git checkout is just
the source, deployed there by `./install.sh`. The store is `items.json`
(local only, gitignored); every mutation MUST go through the live install's
`org.py` (it writes atomically; the desktop widget picks changes up within
10 seconds by polling).

```
./org.py add "Title" [--note N] [--remind 2026-07-12T09:00]
./org.py done ID | open ID | rm ID | note ID TEXT | title ID TEXT
./org.py status ID IN_PROGRESS            # empty string resets to TODO
./org.py up ID | down ID | move ID POS    # reorder open items (importance)
./org.py remind_set ID 2026-07-12T09:00   # empty string clears
./org.py list [--all]
./org.py ai ID on|off                     # allow AI to work this item (default off)
./org.py ai_input "TEXT"                  # headless Claude interprets TEXT, edits the store
./org.py ai_run ID [--mode goal|loop] [--every 15m]   # headless Claude works the item
./org.py ai_stop RUN_ID
```

AI runs are detached `claude -p` processes spawned by `org.py`. Loop runs are
a detached `org.py ai_loop_worker` supervisor instead: `/loop` dies with a
`-p` process, so the worker re-invokes `claude -p` at the chosen cadence
(resuming the same session) until the item is done, the model replies
LOOP_DONE, or the run is stopped. The runs' only
state is `runs.json` + `runs/` logs (both gitignored, never in `items.json`
beyond the per-item `ai` flag). The "AI working" look in the widget is derived
from the registry, not stored on the item. An item with a `dir: /path` line in
its note runs its AI work in that directory.

Items are strictly binary: open or done. The only extra state is a two-value
status label on open items — TODO (unset, the default) or IN_PROGRESS —
toggled by clicking it in the widget. No other statuses, stages, sections, or
priorities — do not add any. Open items keep a manual order
(store order = display order, new items on top); reorder with up/down. Recently completed items stay
visible (checked) for 7 days, then drop out of views (they stay in the store).

Never commit or push without being asked.
