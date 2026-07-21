import { run } from "uebersicht";

// the repo is found through this widget's symlink, so the clone can live anywhere
const ORG = `/usr/bin/python3 "$(dirname "$(readlink -f "$HOME/Library/Application Support/Übersicht/widgets/organizer.jsx")")/../org.py"`;

export const command = `${ORG} feed`;

export const refreshFrequency = 10000;

export const initialState = {
  output: "",
  tab: "work",
  expanded: null,
  editing: null,
  reminding: null,
  dragging: null,
  dragPos: null,
  confirmRm: null,
  showClosed: false,
  aiAdd: false,
};

export const updateState = (event, previousState) => {
  if (event.type === "UB/COMMAND_RAN") return { ...previousState, output: event.output };
  if (event.type === "SET_TAB") return { ...previousState, tab: event.tab };
  if (event.type === "TOGGLE_ITEM")
    return {
      ...previousState,
      expanded: previousState.expanded === event.id ? null : event.id,
      confirmRm: null,
    };
  if (event.type === "EDIT_ITEM") return { ...previousState, editing: event.id };
  if (event.type === "REMIND_ITEM")
    return { ...previousState, reminding: previousState.reminding === event.id ? null : event.id };
  if (event.type === "DRAG") return { ...previousState, dragging: event.id, dragPos: event.pos };
  if (event.type === "RM_ARM") return { ...previousState, confirmRm: event.id };
  if (event.type === "TOGGLE_CLOSED") return { ...previousState, showClosed: !previousState.showClosed };
  if (event.type === "TOGGLE_AI_ADD") return { ...previousState, aiAdd: !previousState.aiAdd };
  return previousState;
};

export const className = `
  top: 10px;
  right: 10px;
  width: 440px;
  box-sizing: border-box;
  padding: 14px 20px 16px;
  border-radius: 16px;
  background: rgba(24, 24, 28, 0.72);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-family: -apple-system, "SF Pro Text", Helvetica, sans-serif;
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  line-height: 1.5;

  .sessions::-webkit-scrollbar {
    display: none;
  }
`;

const dim = { color: "rgba(255,255,255,0.45)" };

const tabStyle = (active) => ({
  cursor: "pointer",
  marginRight: 18,
  paddingBottom: 3,
  fontSize: 12,
  color: active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.4)",
  borderBottom: active ? "1px solid rgba(255,255,255,0.7)" : "1px solid transparent",
});

const oneLine = { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const reload = (dispatch) =>
  run(`${ORG} feed`).then((output) => dispatch({ type: "UB/COMMAND_RAN", output }));

const checkbox = (i, dispatch) => (
  <span
    data-btn
    onClick={(e) => {
      e.stopPropagation();
      run(`${ORG} ${i.done ? "open" : "done"} ${i.id}`).then(() => reload(dispatch));
    }}
    style={{
      width: 14,
      height: 14,
      flexShrink: 0,
      alignSelf: "center",
      marginRight: 10,
      border: "1px solid rgba(255,255,255,0.35)",
      borderRadius: 4,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 10,
      color: "#7fd77f",
      cursor: "pointer",
    }}
  >
    {i.done ? "✓" : ""}
  </span>
);

const deleteBtn = (i, confirmRm, dispatch) => (
  <span
    data-btn
    onClick={(e) => {
      e.stopPropagation();
      if (confirmRm !== i.id) return dispatch({ type: "RM_ARM", id: i.id });
      dispatch({ type: "RM_ARM", id: null });
      run(`${ORG} rm ${i.id}`).then(() => reload(dispatch));
    }}
    style={{
      ...(confirmRm === i.id ? { color: "#ff5f56" } : dim),
      flexShrink: 0,
      marginLeft: 10,
      cursor: "pointer",
      fontSize: confirmRm === i.id ? 11 : 14,
    }}
  >
    {confirmRm === i.id ? "rm?" : "×"}
  </span>
);

const editBtn = (i, editing, dispatch) => (
  <span
    data-btn
    onClick={(e) => {
      e.stopPropagation();
      editing === i.id ? saveEdit(i, e, dispatch) : dispatch({ type: "EDIT_ITEM", id: i.id });
    }}
    style={{ ...dim, flexShrink: 0, marginLeft: 10, cursor: "pointer", fontSize: 12 }}
  >
    ✎
  </span>
);

let dragMoved = false; // suppresses the click that follows a drag's mouseup

const startDrag = (i, e, openIds, dispatch) => {
  if (i.done || e.button !== 0 || e.target.closest("[data-btn],input,textarea")) return;
  e.preventDefault(); // a drag must not start a text selection
  const startY = e.clientY;
  const from = openIds.indexOf(i.id);
  const base = openIds.filter((id) => id !== i.id); // insertion positions are indices in this
  let pos = from;
  const rowAt = (ev) =>
    document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => el.getAttribute && el.getAttribute("data-item"));
  const onMove = (ev) => {
    if (!dragMoved && Math.abs(ev.clientY - startY) < 5) return;
    dragMoved = true;
    const row = rowAt(ev);
    const id = row && row.getAttribute("data-item");
    if (id && id !== i.id && base.includes(id)) {
      const r = row.getBoundingClientRect();
      pos = base.indexOf(id) + (ev.clientY < r.top + r.height / 2 ? 0 : 1);
    }
    dispatch({ type: "DRAG", id: i.id, pos });
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    setTimeout(() => (dragMoved = false), 0);
    const clear = () => dispatch({ type: "DRAG", id: null, pos: null });
    if (!dragMoved || pos === from) return clear();
    // keep the preview until the committed order is refetched, else the old order flashes
    run(`${ORG} move ${i.id} ${pos}`)
      .then(() => reload(dispatch))
      .then(clear, clear);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};

const esc = (s) => s.replace(/'/g, "'\\''");

const isOverdue = (i) => i.remind_at && !i.done && new Date(i.remind_at) <= new Date();

const saveEdit = (i, e, dispatch) => {
  const box = e.target.closest("[data-item]");
  const title = box.querySelector('[data-f="title"]').value.trim();
  const note = box.querySelector('[data-f="note"]').value.trim();
  const cmds = [];
  if (title && title !== i.title) cmds.push(`${ORG} title ${i.id} '${esc(title)}'`);
  if (note !== (i.note || "")) cmds.push(`${ORG} note ${i.id} '${esc(note)}'`);
  const close = () => {
    dispatch({ type: "EDIT_ITEM", id: null });
    reload(dispatch);
  };
  cmds.length ? run(cmds.join(" && ")).then(close) : close();
};

const editField = (i, field, dispatch) => {
  const props = {
    "data-f": field,
    defaultValue: field === "note" ? i.note || "" : i.title,
    placeholder: field,
    autoFocus: field === "title",
    onClick: (e) => e.stopPropagation(),
    onKeyDown: (e) => {
      if (e.key === "Escape") dispatch({ type: "EDIT_ITEM", id: null });
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        saveEdit(i, e, dispatch);
      }
    },
    style: {
      flex: 1,
      minWidth: 0,
      boxSizing: "border-box",
      padding: "1px 6px",
      margin: "-2px 0 -2px -7px", // cancel padding+border so the field occupies the text's exact footprint

      background: "rgba(255,255,255,0.07)",
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: 4,
      color: "rgba(255,255,255,0.92)",
      fontSize: field === "title" ? 13 : 12,
      fontFamily: "inherit",
      lineHeight: 1.5,
      outline: "none",
      resize: "none",
      overflow: "hidden",
    },
  };
  if (field === "title") return <input {...props} />;
  const fit = (el) => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };
  return <textarea {...props} rows={1} ref={(el) => el && fit(el)} onInput={(e) => fit(e.target)} />;
};

const statusBtn = (i, dispatch) => {
  const inProg = i.status === "IN_PROGRESS";
  return (
    <span
      data-btn
      onClick={(e) => {
        e.stopPropagation();
        run(`${ORG} status ${i.id} '${inProg ? "" : "IN_PROGRESS"}'`).then(() => reload(dispatch));
      }}
      style={{
        flexShrink: 0,
        marginLeft: 12,
        cursor: "pointer",
        fontSize: 9,
        letterSpacing: "0.05em",
        color: inProg ? "#7fd77f" : "rgba(255,255,255,0.45)",
      }}
    >
      {inProg ? "IP" : "TD"}
    </span>
  );
};

const AI_BLUE = "#6fb7ff";

const aiControls = (i, dispatch) => {
  const act = (cmd) => (e) => {
    e.stopPropagation();
    run(`${ORG} ${cmd}`).then(() => reload(dispatch));
  };
  const base = { flexShrink: 0, cursor: "pointer", fontSize: 9, letterSpacing: "0.05em" };
  return [
    <span
      key="ai"
      data-btn
      onClick={i.run ? undefined : act(`ai ${i.id} ${i.ai ? "off" : "on"}`)}
      style={{
        ...base,
        marginLeft: 10,
        color: i.run ? AI_BLUE : i.ai ? "rgba(111,183,255,0.75)" : "rgba(255,255,255,0.2)",
        textShadow: i.run ? "0 0 6px rgba(111,183,255,0.9)" : "none",
      }}
    >
      AI
    </span>,
    i.ai && !i.run && (
      <span key="go" data-btn onClick={act(`ai_run ${i.id}`)} style={{ ...base, marginLeft: 6, ...dim }}>
        run
      </span>
    ),
    i.run && (
      <span key="stop" data-btn onClick={act(`ai_stop ${i.run}`)} style={{ ...base, marginLeft: 6, color: "#ff5f56" }}>
        stop
      </span>
    ),
  ];
};

const remindBtn = (i, dispatch) => (
  <span
    data-btn
    onClick={(e) => {
      e.stopPropagation();
      dispatch({ type: "REMIND_ITEM", id: i.id });
    }}
    style={{
      flexShrink: 0,
      marginLeft: 10,
      cursor: "pointer",
      fontSize: 12,
      color: !i.remind_at ? "rgba(255,255,255,0.45)" : isOverdue(i) ? "#ff5f56" : "#ffb454",
      textShadow: isOverdue(i) ? "0 0 6px rgba(255,95,86,0.9)" : "none",
    }}
  >
    ◷
  </span>
);

const pad2 = (n) => String(n).padStart(2, "0");
const fmtLocal = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

const setRemind = (i, val, dispatch) => {
  run(`${ORG} remind_set ${i.id} '${esc(val)}'`).then(() => {
    dispatch({ type: "REMIND_ITEM", id: i.id });
    reload(dispatch);
  });
};

const preset = (label, onClick) => (
  <span
    key={label}
    data-btn
    onClick={onClick}
    style={{
      ...dim,
      cursor: "pointer",
      fontSize: 11,
      padding: "0 8px",
      marginLeft: 6,
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: 9,
      flexShrink: 0,
    }}
  >
    {label}
  </span>
);

const remindMenu = (i, dispatch) => {
  const inH = (h) => {
    const d = new Date();
    d.setHours(d.getHours() + h);
    return fmtLocal(d);
  };
  const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return fmtLocal(d);
  };
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ display: "flex", alignItems: "center", padding: "2px 0 5px 26px", cursor: "default" }}
    >
      <input
        defaultValue={(i.remind_at || "").replace("T", " ")}
        placeholder="2026-07-12 09:00"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") dispatch({ type: "REMIND_ITEM", id: i.id });
          if (e.key === "Enter") setRemind(i, e.target.value.trim().replace(" ", "T"), dispatch);
        }}
        style={{
          width: 130,
          flexShrink: 0,
          boxSizing: "border-box",
          padding: "1px 6px",
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 4,
          color: "rgba(255,255,255,0.92)",
          fontSize: 12,
          fontFamily: "inherit",
          outline: "none",
        }}
      />
      {preset("1h", () => setRemind(i, inH(1), dispatch))}
      {preset("3h", () => setRemind(i, inH(3), dispatch))}
      {preset("tomorrow 9:00", () => setRemind(i, tomorrow(), dispatch))}
      {i.remind_at && preset("clear", () => setRemind(i, "", dispatch))}
    </div>
  );
};

const itemRow = (i, { expanded, editing, reminding, dragging, confirmRm }, dispatch, closed, openIds) => (
  <div
    key={i.id}
    data-item={i.id}
    onClick={() => {
      if (dragMoved || !i.note) return;
      dispatch({ type: "TOGGLE_ITEM", id: i.id });
    }}
    onMouseDown={(e) => startDrag(i, e, openIds, dispatch)}
    style={{
      cursor: i.note ? "pointer" : "default",
      opacity: dragging === i.id ? 0.35 : 1,
      background: dragging === i.id ? "rgba(255,255,255,0.08)" : "transparent",
      borderRadius: 5,
    }}
  >
    <div style={{ display: "flex", alignItems: "baseline", padding: "3px 0", opacity: closed ? 0.45 : 1 }}>
      {checkbox(i, dispatch)}
      {editing === i.id ? (
        editField(i, "title", dispatch)
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            textDecoration: closed ? "line-through" : "none",
            color: i.run ? "#9ecbff" : undefined,
          }}
        >
          {i.title}
        </span>
      )}
      {!closed && statusBtn(i, dispatch)}
      {!closed && aiControls(i, dispatch)}
      {remindBtn(i, dispatch)}
      {editBtn(i, editing, dispatch)}
      {deleteBtn(i, confirmRm, dispatch)}
    </div>
    {editing === i.id && (
      <div style={{ display: "flex", padding: "0 0 5px 26px" }}>{editField(i, "note", dispatch)}</div>
    )}
    {reminding === i.id && remindMenu(i, dispatch)}
    {i.remind_at && (
      <div style={{ padding: "0 0 3px 26px", fontSize: 12, color: isOverdue(i) ? "#ff5f56" : "#ffb454" }}>
        due {i.remind_at.replace("T", " ")}
      </div>
    )}
    {editing !== i.id && expanded === i.id && i.note && (
      <div style={{ ...dim, padding: "0 0 5px 26px", fontSize: 12, whiteSpace: "pre-wrap" }}>{i.note}</div>
    )}
  </div>
);

const addInput = (aiAdd, dispatch) => (
  <div style={{ display: "flex", alignItems: "center", marginTop: 10 }}>
    <input
      placeholder={aiAdd ? "tell the AI what you need" : "add item"}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || !e.target.value.trim()) return;
        const el = e.target;
        const text = esc(el.value.trim());
        run(`${ORG} ${aiAdd ? "ai_input" : "add"} '${text}'`).then(() => {
          el.value = "";
          reload(dispatch);
        });
      }}
      style={{
        flex: 1,
        minWidth: 0,
        boxSizing: "border-box",
        padding: "5px 9px",
        background: "rgba(255,255,255,0.07)",
        border: `1px solid ${aiAdd ? "rgba(111,183,255,0.45)" : "rgba(255,255,255,0.1)"}`,
        borderRadius: 6,
        color: "rgba(255,255,255,0.92)",
        fontSize: 12.5,
        fontFamily: "inherit",
        outline: "none",
      }}
    />
    <span
      data-btn
      onClick={() => dispatch({ type: "TOGGLE_AI_ADD" })}
      style={{
        flexShrink: 0,
        marginLeft: 8,
        padding: "1px 8px",
        cursor: "pointer",
        fontSize: 10,
        letterSpacing: "0.05em",
        border: `1px solid ${aiAdd ? AI_BLUE : "rgba(255,255,255,0.2)"}`,
        borderRadius: 9,
        color: aiAdd ? AI_BLUE : "rgba(255,255,255,0.45)",
      }}
    >
      AI
    </span>
  </div>
);

export const render = (state, dispatch) => {
  const { output, tab } = state;
  let data;
  try {
    data = JSON.parse(output);
  } catch (e) {
    return <div style={dim}>waiting for data…</div>;
  }
  let open = data.items.filter((i) => !i.done);
  const closed = data.items.filter((i) => i.done);
  const openIds = open.map((i) => i.id);
  const dragged = state.dragging != null && open.find((i) => i.id === state.dragging);
  if (dragged && state.dragPos != null) {
    open = open.filter((i) => i.id !== dragged.id); // preview: show the order the drop would commit
    open.splice(state.dragPos, 0, dragged);
  }
  return (
    <div>
      <div style={{ display: "flex", marginBottom: 10 }}>
        <span style={tabStyle(tab === "work")} onClick={() => dispatch({ type: "SET_TAB", tab: "work" })}>
          Work Items
        </span>
        <span style={tabStyle(tab === "ai")} onClick={() => dispatch({ type: "SET_TAB", tab: "ai" })}>
          AI Runs
        </span>
        <span style={tabStyle(tab === "sessions")} onClick={() => dispatch({ type: "SET_TAB", tab: "sessions" })}>
          Claude Sessions
        </span>
      </div>

      {tab === "work" && (
        <div>
          {open.map((i) => itemRow(i, state, dispatch, false, openIds))}
          {open.length === 0 && <div style={dim}>nothing open</div>}
          {closed.length > 0 && (
            <div
              onClick={() => dispatch({ type: "TOGGLE_CLOSED" })}
              style={{
                ...dim,
                borderTop: "1px solid rgba(255,255,255,0.1)",
                margin: "8px 0 4px",
                paddingTop: 5,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                cursor: "pointer",
              }}
            >
              {state.showClosed ? "▾" : "▸"} closed ({closed.length})
            </div>
          )}
          {state.showClosed && closed.map((i) => itemRow(i, state, dispatch, true, openIds))}
          {addInput(state.aiAdd, dispatch)}
        </div>
      )}

      {tab === "ai" && (
        <div className="sessions" style={{ maxHeight: 340, overflowY: "auto" }}>
          {(data.automations || []).length === 0 && <div style={dim}>no AI runs yet</div>}
          {(data.automations || []).map((r) => {
            const detail = r.state === "running" ? r.activity : r.result || r.activity;
            return (
              <div
                key={r.id}
                onClick={() => dispatch({ type: "TOGGLE_ITEM", id: r.id })}
                style={{ padding: "3px 0", cursor: detail ? "pointer" : "default" }}
              >
                <div style={{ display: "flex", alignItems: "baseline" }}>
                  <span
                    style={{
                      flexShrink: 0,
                      marginRight: 8,
                      fontSize: 10,
                      letterSpacing: "0.05em",
                      color:
                        r.state === "running"
                          ? AI_BLUE
                          : r.state === "done"
                          ? "#7fd77f"
                          : r.state === "stopped"
                          ? "rgba(255,255,255,0.4)"
                          : "#ff5f56",
                      textShadow: r.state === "running" ? "0 0 6px rgba(111,183,255,0.9)" : "none",
                    }}
                  >
                    {(r.state === "running" ? r.kind : r.state).toUpperCase()}
                    {r.state === "running" && r.every ? `·${r.every}` : ""}
                  </span>
                  <span style={oneLine}>{r.label}</span>
                  {r.every && (
                    <span style={{ ...dim, flexShrink: 0, marginLeft: 10, fontSize: 11 }}>
                      {"×"}{r.iters || 0}
                    </span>
                  )}
                  {r.state === "running" && (
                    <span
                      data-btn
                      onClick={(e) => {
                        e.stopPropagation();
                        run(`${ORG} ai_stop ${r.id}`).then(() => reload(dispatch));
                      }}
                      style={{ flexShrink: 0, marginLeft: 10, cursor: "pointer", fontSize: 10, color: "#ff5f56" }}
                    >
                      stop
                    </span>
                  )}
                  <span style={{ ...dim, flexShrink: 0, marginLeft: 12 }}>{r.age}</span>
                </div>
                {detail && (
                  <div
                    style={{
                      ...dim,
                      fontSize: 11,
                      ...(state.expanded === r.id
                        ? { whiteSpace: "pre-wrap", overflowWrap: "break-word" }
                        : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
                    }}
                  >
                    {detail}
                    {state.expanded === r.id && r.cost != null ? `  ($${r.cost.toFixed(2)})` : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "sessions" && (
        <div className="sessions" style={{ maxHeight: 340, overflowY: "auto" }}>
          {data.sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => dispatch({ type: "TOGGLE_ITEM", id: s.id })}
              style={{ display: "flex", alignItems: "baseline", padding: "3px 0", cursor: "pointer" }}
            >
              <span style={{ fontWeight: 600, flexShrink: 0, marginRight: 8 }}>{s.project}</span>
              <span
                style={
                  state.expanded === s.id
                    ? { flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "break-word", color: "rgba(255,255,255,0.65)" }
                    : { ...oneLine, color: "rgba(255,255,255,0.65)" }
                }
              >
                {s.title}
              </span>
              <span style={{ ...dim, flexShrink: 0, marginLeft: 12 }}>{s.age}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
