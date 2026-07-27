"use strict";

/* Boukensha Log Viewer
 * Renders .boukensha/sessions/*.jsonl as a human-readable, live-updating
 * timeline. `server.rb` exposes the sessions directory over a tiny local
 * HTTP API; this script polls it — no folder/file picker, no permission
 * dialog, nothing to connect. Point a browser at this page and it just
 * starts following whatever session is newest.
 */

const PHASES = [
  "session_start",
  "iteration",
  "prompt",
  "tool_call",
  "tool_result",
  "response",
  "turn_end",
  "raw",
];

// Phases hidden by default: `prompt` repeats the full running transcript
// every iteration (noisy), `raw` is opt-in debug-only provider output.
const DEFAULT_HIDDEN_PHASES = new Set(["prompt", "raw"]);

const POLL_MS = 800;

const el = (id) => document.getElementById(id);

const timelineEl = el("timeline");
const emptyStateEl = el("empty-state");
const sessionSelectEl = el("session-select");
const followChk = el("chk-follow");
const autoscrollChk = el("chk-autoscroll");
const pauseBtn = el("btn-pause");
const clearBtn = el("btn-clear");
const liveIndicatorEl = el("live-indicator");
const searchEl = el("search");
const chipsEl = el("phase-chips");

const statSession = el("stat-session");
const statTask = el("stat-task");
const statIteration = el("stat-iteration");
const statElapsed = el("stat-elapsed");
const statToolCalls = el("stat-toolcalls");
const statTokens = el("stat-tokens");
const statCost = el("stat-cost");

/* ---------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------- */

const state = {
  currentFileName: null,
  offset: 0,
  leftover: "",
  paused: false,
  pollTimer: null,
  connected: false,
  activePhases: new Set(PHASES.filter((p) => !DEFAULT_HIDDEN_PHASES.has(p))),
  searchTerm: "",
  stats: {
    sessionId: null,
    tasks: new Set(),
    firstAt: null,
    lastAt: null,
    iteration: null,
    iterationMax: null,
    toolCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  },
};

/* ---------------------------------------------------------------------
 * Utilities
 * ------------------------------------------------------------------- */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Minimal, safe markdown: escapes first, then applies a handful of
// well-known token replacements. No raw user HTML ever reaches the DOM.
function mdLite(str) {
  let s = escapeHtml(str);
  s = s
    .replace(/^#### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^## (.*)$/gm, "<h3>$1</h3>")
    .replace(/^# (.*)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br>");
  return s;
}

function jsonBlock(value) {
  const text = escapeHtml(JSON.stringify(value, null, 2));
  return `<pre class="json">${text}</pre>`;
}

function truncatable(rawText, html, limit = 480) {
  if (rawText.length <= limit) return html;
  const shortHtml = mdLite(rawText.slice(0, limit)) + "…";
  const id = `t${Math.random().toString(36).slice(2)}`;
  return `
    <div class="truncatable" id="${id}">
      <div class="short">${shortHtml}</div>
      <div class="full" style="display:none">${html}</div>
      <span class="toggle-more" data-target="${id}">show more</span>
    </div>`;
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

function fmtElapsed(ms) {
  if (ms == null || Number.isNaN(ms)) return "–";
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtCost(n) {
  return `$${n.toFixed(6)}`;
}

/* ---------------------------------------------------------------------
 * Phase chip filter bar
 * ------------------------------------------------------------------- */

function buildChips() {
  chipsEl.innerHTML = "";
  for (const phase of PHASES) {
    const chip = document.createElement("span");
    chip.className = "chip" + (state.activePhases.has(phase) ? " active" : "");
    chip.textContent = phase;
    chip.dataset.phase = phase;
    chip.style.borderColor = `var(--c-${phase})`;
    if (state.activePhases.has(phase)) chip.style.background = `var(--c-${phase})`;
    chip.addEventListener("click", () => {
      if (state.activePhases.has(phase)) {
        state.activePhases.delete(phase);
      } else {
        state.activePhases.add(phase);
      }
      buildChips();
      applyFilters();
    });
    chipsEl.appendChild(chip);
  }
}

function applyFilters() {
  const term = state.searchTerm.trim().toLowerCase();
  const cards = timelineEl.querySelectorAll(".card, .session-switch");
  cards.forEach((card) => {
    const isMarker = card.classList.contains("session-switch");
    const phase = card.dataset.phase;
    let visible = true;
    if (!isMarker && phase && !state.activePhases.has(phase)) visible = false;
    if (visible && term && !card.dataset.searchText.includes(term)) visible = false;
    card.classList.toggle("hidden-by-filter", !visible);
  });
}

/* ---------------------------------------------------------------------
 * Stats
 * ------------------------------------------------------------------- */

function resetStats() {
  state.stats = {
    sessionId: null,
    tasks: new Set(),
    firstAt: null,
    lastAt: null,
    iteration: null,
    iterationMax: null,
    toolCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  };
  renderStats();
}

function updateStats(entry) {
  const s = state.stats;
  if (entry.session_id) s.sessionId = entry.session_id;
  if (entry.at) {
    if (!s.firstAt) s.firstAt = entry.at;
    s.lastAt = entry.at;
  }
  if (entry.phase === "iteration") {
    s.iteration = entry.n;
    s.iterationMax = entry.max;
  }
  if (entry.phase === "tool_call") {
    s.toolCalls += 1;
  }
  if (entry.phase === "response") {
    if (entry.task) s.tasks.add(entry.task);
    s.tokensIn += entry.input_tokens || 0;
    s.tokensOut += entry.output_tokens || 0;
    s.costUsd += entry.cost_usd || 0;
  }
  renderStats();
}

function renderStats() {
  const s = state.stats;
  statSession.textContent = s.sessionId || "–";
  statTask.textContent = s.tasks.size ? [...s.tasks].join(", ") : "–";
  statIteration.textContent = s.iteration ? `${s.iteration} / ${s.iterationMax ?? "?"}` : "–";
  statElapsed.textContent =
    s.firstAt && s.lastAt ? fmtElapsed(new Date(s.lastAt) - new Date(s.firstAt)) : "–";
  statToolCalls.textContent = String(s.toolCalls);
  statTokens.textContent = `${s.tokensIn} / ${s.tokensOut}`;
  statCost.textContent = fmtCost(s.costUsd);
}

/* ---------------------------------------------------------------------
 * Card rendering per phase
 * ------------------------------------------------------------------- */

function badge(phase, label) {
  return `<span class="badge" style="background:var(--c-${phase})">${label || phase}</span>`;
}

function renderMessages(messages) {
  return messages
    .map((m) => {
      let content = m.content;
      let contentHtml;
      if (typeof content === "string") {
        contentHtml = truncatable(content, mdLite(content));
      } else {
        const asText = JSON.stringify(content, null, 2);
        contentHtml = truncatable(asText, jsonBlock(content));
      }
      return `<div class="msg"><strong>${escapeHtml(m.role)}:</strong> ${contentHtml}</div>`;
    })
    .join("");
}

function buildCard(entry) {
  const phase = entry.phase;
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.phase = phase;
  card.style.borderLeftColor = `var(--c-${phase})`;
  card.dataset.searchText = JSON.stringify(entry).toLowerCase();

  let title = phase;
  let meta = fmtTime(entry.at);
  let body = "";

  switch (phase) {
    case "session_start": {
      title = "session start";
      body = `<div>Session <code>${escapeHtml(entry.session_id)}</code> started.</div>`;
      break;
    }
    case "iteration": {
      title = `iteration ${entry.n} / ${entry.max}`;
      body = "";
      break;
    }
    case "prompt": {
      title = `prompt · ${entry.message_count} message(s)`;
      meta += ` · tools: ${(entry.tools || []).join(", ") || "none"}`;
      body = renderMessages(entry.messages || []);
      break;
    }
    case "tool_call": {
      title = `tool_call → ${entry.name}`;
      body = jsonBlock(entry.args);
      break;
    }
    case "tool_result": {
      title = `tool_result ← ${entry.name}`;
      const resultText =
        typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result, null, 2);
      const html =
        typeof entry.result === "string" ? mdLite(entry.result) : jsonBlock(entry.result);
      body = truncatable(resultText, html);
      break;
    }
    case "response": {
      title = "response";
      const bits = [];
      if (entry.task) bits.push(entry.task);
      if (entry.provider) bits.push(entry.provider);
      if (entry.model) bits.push(entry.model);
      if (bits.length) meta += ` · ${bits.join(" / ")}`;
      if (typeof entry.cost_usd === "number") meta += ` · ${fmtCost(entry.cost_usd)}`;
      if (typeof entry.input_tokens === "number")
        meta += ` · ${entry.input_tokens}→${entry.output_tokens} tok`;
      const text = entry.text || "";
      body = truncatable(text, mdLite(text), 800);
      break;
    }
    case "turn_end": {
      title = `turn end · ${entry.reason}`;
      body = `<div>iterations: ${entry.iterations ?? "–"}${
        entry.tokens != null ? ` · tokens: ${entry.tokens}` : ""
      }</div>`;
      break;
    }
    case "raw": {
      title = "raw (debug)";
      body = jsonBlock(entry.data ?? entry);
      break;
    }
    default: {
      title = phase || "unknown";
      body = jsonBlock(entry);
    }
  }

  card.innerHTML = `
    <div class="card-head">
      ${badge(phase)}
      <span class="card-title">${escapeHtml(title)}</span>
      <span class="card-meta">${escapeHtml(meta)}</span>
    </div>
    <div class="card-body">${body}</div>
  `;

  return card;
}

function appendEntry(entry) {
  emptyStateEl.style.display = "none";
  const card = buildCard(entry);
  timelineEl.appendChild(card);
  updateStats(entry);
  applyFiltersToCard(card);
  if (autoscrollChk.checked) {
    timelineEl.scrollTop = timelineEl.scrollHeight;
  }
}

function applyFiltersToCard(card) {
  const term = state.searchTerm.trim().toLowerCase();
  let visible = state.activePhases.has(card.dataset.phase);
  if (visible && term && !card.dataset.searchText.includes(term)) visible = false;
  card.classList.toggle("hidden-by-filter", !visible);
}

// Delegate "show more/less" clicks for truncated content.
timelineEl.addEventListener("click", (evt) => {
  const target = evt.target;
  if (!target.classList || !target.classList.contains("toggle-more")) return;
  const wrap = el(target.dataset.target);
  if (!wrap) return;
  const short = wrap.querySelector(".short");
  const full = wrap.querySelector(".full");
  const expanded = full.style.display !== "none";
  full.style.display = expanded ? "none" : "block";
  short.style.display = expanded ? "block" : "none";
  target.textContent = expanded ? "show more" : "show less";
});

function insertSessionSwitchMarker(name) {
  const marker = document.createElement("div");
  marker.className = "session-switch";
  marker.dataset.phase = "__marker__";
  marker.dataset.searchText = name.toLowerCase();
  marker.textContent = `— now tailing ${name} —`;
  timelineEl.appendChild(marker);
}

function clearTimeline({ keepFileContext = false } = {}) {
  timelineEl.innerHTML = "";
  timelineEl.appendChild(emptyStateEl);
  emptyStateEl.style.display = "flex";
  resetStats();
  if (!keepFileContext) {
    state.currentFileName = null;
  }
}

/* ---------------------------------------------------------------------
 * Line parsing
 * ------------------------------------------------------------------- */

function processChunk(text) {
  const combined = state.leftover + text;
  const lines = combined.split("\n");
  state.leftover = lines.pop(); // last element may be a partial line
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      appendEntry(entry);
    } catch (err) {
      console.warn("Skipping unparsable log line:", trimmed, err);
    }
  }
}

/* ---------------------------------------------------------------------
 * Server polling — no picker, no permission, fully automatic.
 * ------------------------------------------------------------------- */

function setLive(status, text) {
  liveIndicatorEl.classList.remove("live", "paused", "idle", "error");
  liveIndicatorEl.classList.add(status);
  liveIndicatorEl.querySelector(".live-text").textContent = text;
}

async function fetchSessionList() {
  const res = await fetch("/api/sessions", { cache: "no-store" });
  if (!res.ok) throw new Error(`sessions list failed: ${res.status}`);
  return res.json();
}

async function switchToFile(name) {
  if (state.currentFileName) {
    insertSessionSwitchMarker(name);
  }
  state.currentFileName = name;
  state.offset = 0;
  state.leftover = "";
  resetStats();
  await tailCurrentFile(); // pull in whatever already exists immediately
}

async function tailCurrentFile() {
  if (!state.currentFileName) return;
  const url = `/api/sessions/${encodeURIComponent(state.currentFileName)}/tail?offset=${state.offset}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    if (res.status === 404) return; // file rotated away between list and tail; next tick recovers
    throw new Error(`tail failed: ${res.status}`);
  }
  const newSize = Number(res.headers.get("X-File-Size") || state.offset);
  const text = await res.text();
  state.offset = newSize;
  if (text) processChunk(text);
}

async function refreshSessionListAndFollow() {
  const files = await fetchSessionList(); // already newest-first from the server

  const previousValue = sessionSelectEl.value;
  sessionSelectEl.innerHTML = "";
  if (files.length === 0) {
    sessionSelectEl.innerHTML = '<option value="">waiting for sessions…</option>';
    return;
  }
  for (const f of files) {
    const opt = document.createElement("option");
    opt.value = f.name;
    opt.textContent = f.name;
    sessionSelectEl.appendChild(opt);
  }

  if (followChk.checked) {
    const newest = files[0];
    if (newest.name !== state.currentFileName) {
      sessionSelectEl.value = newest.name;
      await switchToFile(newest.name);
    } else {
      sessionSelectEl.value = newest.name;
    }
  } else if (previousValue && files.some((f) => f.name === previousValue)) {
    sessionSelectEl.value = previousValue;
  }
}

async function pollTick() {
  if (state.paused) return;
  try {
    await refreshSessionListAndFollow();
    await tailCurrentFile();
    if (!state.connected) {
      state.connected = true;
      setLive("live", "live");
    }
  } catch (err) {
    console.error("Poll error (is server.rb running?):", err);
    state.connected = false;
    setLive("error", "server unreachable");
  }
}

function startPolling() {
  stopPolling();
  pollTick();
  state.pollTimer = setInterval(pollTick, POLL_MS);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

/* ---------------------------------------------------------------------
 * Control wiring
 * ------------------------------------------------------------------- */

sessionSelectEl.addEventListener("change", async () => {
  const name = sessionSelectEl.value;
  if (!name || name === state.currentFileName) return;
  followChk.checked = false;
  clearTimeline({ keepFileContext: true });
  await switchToFile(name);
});

pauseBtn.addEventListener("click", () => {
  state.paused = !state.paused;
  pauseBtn.textContent = state.paused ? "Resume" : "Pause";
  setLive(state.paused ? "paused" : "live", state.paused ? "paused" : "live");
});

clearBtn.addEventListener("click", () => {
  clearTimeline();
});

searchEl.addEventListener("input", () => {
  state.searchTerm = searchEl.value;
  applyFilters();
});

/* ---------------------------------------------------------------------
 * Init — starts polling immediately, no user action required.
 * ------------------------------------------------------------------- */

buildChips();
resetStats();
setLive("idle", "connecting…");
startPolling();
