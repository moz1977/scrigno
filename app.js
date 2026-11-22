import { LocalStore, SupabaseStore, cloudConfigured, localBackup, uid } from "./store.js";
import { PLATFORMS, extractUrl, detectPlatform, cleanUrl, fetchMeta, tidyTitle } from "./links.js";

// ───────────────────────── Stato ─────────────────────────
const BOARD_COLORS = ["#eb5e34", "#e0a526", "#3f9d5a", "#2a8c8c", "#3d6fd6", "#7b55d6", "#c94c8f", "#6b6258"];

const state = {
  store: null,
  user: null,
  boards: [],
  items: [],
  view: { board: null, tag: null, platform: null, query: "" }, // board: null=home | "all" | "none" | id
  loading: true,
  error: "",
};

const params = new URLSearchParams(location.search);
const isPopup = params.get("popup") === "1";

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const normTag = (t) => norm(t).replace(/^#+/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// ───────────────────────── Avvio ─────────────────────────
async function boot() {
  state.store = cloudConfigured() ? new SupabaseStore() : new LocalStore();
  try {
    const { user } = await state.store.init();
    state.user = user;
    if (state.store.onAuthChange) {
      state.store.onAuthChange(async (u) => {
        const changed = (u?.id || null) !== (state.user?.id || null);
        state.user = u;
        if (changed) { await reload(); renderSettings(); }
      });
    }
  } catch (e) {
    state.error = "Connessione al cloud non riuscita: " + (e.message || e);
  }
  await reload();
  handleIncomingShare();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

async function reload() {
  state.loading = true;
  render();
  if (state.store.mode === "cloud" && !state.user) {
    state.boards = []; state.items = []; state.loading = false; render(); return;
  }
  try {
    const d = await state.store.load();
    state.boards = d.boards || [];
    state.items = (d.items || []).map((i) => ({ ...i, tags: i.tags || [] }));
    state.error = "";
  } catch (e) {
    state.error = "Impossibile caricare i dati: " + (e.message || e);
  }
  state.loading = false;
  render();
}

// Quando l'app torna in primo piano (es. dal telefono al PC), ricarica i dati del cloud.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.store?.mode === "cloud" && state.user && !anyDialogOpen()) reload();
});

// Link arrivati dal menu Condividi di Android o dal bookmarklet del PC.
function handleIncomingShare() {
  const raw = params.get("url") || params.get("text") || params.get("title") || "";
  const url = extractUrl(params.get("url")) || extractUrl(params.get("text")) || extractUrl(raw);
  if (!url) return;
  const title = tidyTitle(params.get("title") && !extractUrl(params.get("title")) ? params.get("title") : "");
  const keep = isPopup ? "?popup=1" : "";
  history.replaceState(null, "", location.pathname + keep);
  if (state.store.mode === "cloud" && !state.user) {
    sessionStorage.setItem("scrigno:pending", JSON.stringify({ url, title }));
    toast("Accedi per salvare il link");
    return;
  }
  openItemEditor(null, { url, title });
}

// ───────────────────────── Filtri e ricerca ─────────────────────────
function boardName(id) { return state.boards.find((b) => b.id === id)?.name || ""; }

function filteredItems() {
  const { board, tag, platform, query } = state.view;
  let list = state.items;
  if (board === "none") list = list.filter((i) => !i.board_id);
  else if (board && board !== "all") list = list.filter((i) => i.board_id === board);
  if (tag) list = list.filter((i) => i.tags.includes(tag));
  if (platform) list = list.filter((i) => i.platform === platform);

  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (tokens.length) {
    list = list.filter((i) => {
      const hay = norm([i.title, i.note, i.url, boardName(i.board_id), PLATFORMS[i.platform]?.label, ...i.tags.map((t) => "#" + t)].join(" "));
      return tokens.every((t) => (t.startsWith("#") ? i.tags.some((g) => g.startsWith(t.slice(1))) : hay.includes(t)));
    });
  }
  return [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function tagCounts(items = state.items) {
  const m = new Map();
  items.forEach((i) => i.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function setView(patch) {
  Object.assign(state.view, patch);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ───────────────────────── Render ─────────────────────────
function render() {
  document.body.classList.toggle("popup", isPopup);
  $("#fab").hidden = state.store?.mode === "cloud" && !state.user;

  if (state.loading && !state.items.length) {
    app.innerHTML = `<div class="empty"><div class="spinner"></div></div>`;
    return;
  }
  if (state.store.mode === "cloud" && !state.user) { app.innerHTML = loginView(); bindLogin(app); return; }

  const { board, tag, platform, query } = state.view;
  const searching = Boolean(query.trim() || tag || platform);
  const items = filteredItems();
  let html = "";

  if (state.error) html += `<p class="notice error">${esc(state.error)}</p>`;

  if (!board && !searching) {
    html += boardsSection();
  } else {
    html += crumb();
  }

  html += filtersBar(board && board !== "all" ? state.items.filter((i) => (board === "none" ? !i.board_id : i.board_id === board)) : state.items);

  const heading = searching ? `${items.length} ${items.length === 1 ? "risultato" : "risultati"}` : (!board ? "Salvati di recente" : "");
  if (heading) html += `<h2 class="section-title">${esc(heading)}</h2>`;

  if (!state.items.length) html += welcome();
  else if (!items.length) html += `<div class="empty"><p>Nessun video corrisponde.</p><button class="btn ghost" data-act="clear">Azzera filtri</button></div>`;
  else html += `<div class="grid">${(!board && !searching ? items.slice(0, 24) : items).map(card).join("")}</div>`;

  if (!board && !searching && items.length > 24) {
    html += `<div class="more"><button class="btn ghost" data-act="board" data-id="all">Vedi tutti i ${items.length} video</button></div>`;
  }

  app.innerHTML = html;
}

function boardsSection() {
  const counts = new Map();
  state.items.forEach((i) => counts.set(i.board_id || "none", (counts.get(i.board_id || "none") || 0) + 1));
  const tiles = state.boards
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "it"))
    .map((b) => boardTile(b.id, b.name, b.color, counts.get(b.id) || 0));
  const none = counts.get("none");
  if (none && state.boards.length) tiles.push(boardTile("none", "Senza bacheca", "#9a9087", none));
  tiles.push(`<button class="board-tile add" data-act="new-board"><span class="plus">+</span><span class="board-name">Nuova bacheca</span></button>`);
  return `
    <div class="section-head">
      <h2 class="section-title">Bacheche</h2>
      ${state.items.length ? `<button class="link-btn" data-act="board" data-id="all">Tutti (${state.items.length})</button>` : ""}
    </div>
    <div class="boards">${tiles.join("")}</div>`;
}

function boardTile(id, name, color, count) {
  const thumbs = state.items
    .filter((i) => (id === "none" ? !i.board_id : i.board_id === id) && i.thumbnail)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 3);
  const cover = thumbs.length
    ? `<div class="mosaic m${thumbs.length}">${thumbs.map((t) => `<img src="${esc(t.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`).join("")}</div>`
    : `<div class="mosaic empty-cover"><span>${esc(name.slice(0, 1).toUpperCase())}</span></div>`;
  return `
    <button class="board-tile" style="--c:${esc(color || BOARD_COLORS[0])}" data-act="board" data-id="${esc(id)}">
      ${cover}
      <span class="board-name">${esc(name)}</span>
      <span class="board-count">${count} ${count === 1 ? "video" : "video"}</span>
    </button>`;
}

function crumb() {
  const { board } = state.view;
  let title = "Ricerca";
  let color = "";
  let editable = false;
  if (board === "all") title = "Tutti i video";
  else if (board === "none") title = "Senza bacheca";
  else if (board) {
    const b = state.boards.find((x) => x.id === board);
    title = b?.name || "Bacheca"; color = b?.color || ""; editable = Boolean(b);
  }
  return `
    <div class="crumb">
      <button class="icon-btn" data-act="home" aria-label="Torna alla home">←</button>
      ${color ? `<span class="dot" style="background:${esc(color)}"></span>` : ""}
      <h1>${esc(title)}</h1>
      ${editable ? `<button class="link-btn" data-act="edit-board" data-id="${esc(board)}">Modifica</button>` : ""}
    </div>`;
}

function filtersBar(scope) {
  const { tag, platform } = state.view;
  const plats = [...new Set(scope.map((i) => i.platform))].filter(Boolean);
  const tags = tagCounts(scope).slice(0, 30);
  if (plats.length < 2 && !tags.length && !platform && !tag) return "";
  const chips = [];
  if (plats.length > 1 || platform) {
    plats.forEach((p) => chips.push(
      `<button class="chip plat ${platform === p ? "on" : ""}" style="--pc:${PLATFORMS[p]?.color}" data-act="platform" data-id="${p}">${esc(PLATFORMS[p]?.label || p)}</button>`));
  }
  tags.forEach(([t, n]) => chips.push(
    `<button class="chip ${tag === t ? "on" : ""}" data-act="tag" data-id="${esc(t)}">#${esc(t)} <small>${n}</small></button>`));
  if (tag && !tags.some(([t]) => t === tag)) chips.unshift(`<button class="chip on" data-act="tag" data-id="${esc(tag)}">#${esc(tag)}</button>`);
  return `<div class="chips" role="toolbar" aria-label="Filtri">${chips.join("")}</div>`;
}

function card(i) {
  const p = PLATFORMS[i.platform] || PLATFORMS.web;
  const b = state.boards.find((x) => x.id === i.board_id);
  const title = i.title || hostOf(i.url);
  const thumb = i.thumbnail
    ? `<img src="${esc(i.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('noimg');this.remove()">`
    : "";
  return `
    <article class="card">
      <a class="thumb ${thumb ? "" : "noimg"}" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer" style="--pc:${p.color}" data-act="open" data-id="${esc(i.id)}">
        ${thumb}
        <span class="ph"><b>${esc(p.short)}</b></span>
        <span class="badge" style="--pc:${p.color}">${esc(p.label)}</span>
      </a>
      <div class="card-body">
        <h3 title="${esc(title)}">${esc(title)}</h3>
        ${i.note ? `<p class="note">${esc(i.note)}</p>` : ""}
        <div class="card-foot">
          <div class="mini-tags">
            ${b && state.view.board !== b.id ? `<button class="mini board" style="--c:${esc(b.color)}" data-act="board" data-id="${esc(b.id)}">${esc(b.name)}</button>` : ""}
            ${i.tags.slice(0, 4).map((t) => `<button class="mini" data-act="tag" data-id="${esc(t)}">#${esc(t)}</button>`).join("")}
          </div>
          <button class="icon-btn small" data-act="edit" data-id="${esc(i.id)}" aria-label="Modifica">⋯</button>
        </div>
      </div>
    </article>`;
}

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } }

function welcome() {
  return `
    <div class="welcome">
      <h2>Il tuo scrigno è vuoto</h2>
      <p>Salva qui i reel e i video che ti interessano, da qualsiasi social. Tre modi per farlo:</p>
      <ol>
        <li><b>Dal PC:</b> copia il link e premi <kbd>Ctrl</kbd>+<kbd>V</kbd> in questa pagina, oppure usa il <button class="link-btn" data-act="settings">bookmarklet</button>.</li>
        <li><b>Dal telefono Android:</b> installa l'app (menu di Chrome → <i>Installa app</i>), poi da Instagram/TikTok/YouTube premi <i>Condividi</i> → <i>Scrigno</i>.</li>
        <li><b>Ovunque:</b> tocca <b>Salva link</b> in basso a destra.</li>
      </ol>
      <button class="btn primary" data-act="add">Salva il primo video</button>
    </div>`;
}

function loginView() {
  return `
    <div class="welcome login">
      <h2>Accedi a Scrigno</h2>
      <p>Inserisci la tua email: riceverai un link per entrare, senza password. Usa la stessa email su PC e telefono per vedere gli stessi video.</p>
      <form id="login-form" class="row">
        <input type="email" name="email" placeholder="tu@email.it" required autocomplete="email" />
        <button class="btn primary" type="submit">Invia link</button>
      </form>
      ${state.error ? `<p class="notice error">${esc(state.error)}</p>` : ""}
    </div>`;
}

function bindLogin(root) {
  const f = $("#login-form", root);
  if (!f) return;
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = f.email.value.trim();
    const btn = f.querySelector("button");
    btn.disabled = true; btn.textContent = "Invio…";
    try {
      await state.store.signIn(email);
      f.outerHTML = `<p class="notice ok">Controlla la posta: ti abbiamo inviato il link di accesso a <b>${esc(email)}</b>.</p>`;
    } catch (err) {
      btn.disabled = false; btn.textContent = "Invia link";
      toast("Errore: " + (err.message || err));
    }
  });
}

// ───────────────────────── Interazioni ─────────────────────────
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const { act, id } = el.dataset;
  switch (act) {
    case "open": return; // il link si apre normalmente
    case "home": e.preventDefault(); $("#q").value = ""; return setView({ board: null, tag: null, platform: null, query: "" });
    case "board": return setView({ board: id, tag: null, platform: null });
    case "tag": return setView({ tag: state.view.tag === id ? null : id });
    case "platform": return setView({ platform: state.view.platform === id ? null : id });
    case "clear": $("#q").value = ""; return setView({ tag: null, platform: null, query: "" });
    case "edit": return openItemEditor(state.items.find((i) => i.id === id));
    case "add": return openItemEditor(null);
    case "new-board": return openBoardEditor(null);
    case "edit-board": return openBoardEditor(state.boards.find((b) => b.id === id));
    case "settings": return openSettings();
  }
});

$("#brand").addEventListener("click", (e) => {
  e.preventDefault();
  $("#q").value = "";
  setView({ board: null, tag: null, platform: null, query: "" });
});
$("#fab").addEventListener("click", () => openItemEditor(null));
$("#btn-settings").addEventListener("click", openSettings);

let qTimer;
$("#q").addEventListener("input", (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => setView({ query: e.target.value }), 120);
});

document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing && !anyDialogOpen()) { e.preventDefault(); $("#q").focus(); }
  if (e.key === "Escape" && document.activeElement === $("#q") && $("#q").value) { $("#q").value = ""; setView({ query: "" }); }
});

// Sul PC: incolla un link in qualunque punto della pagina per salvarlo subito.
document.addEventListener("paste", (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
  if (typing || anyDialogOpen()) return;
  const url = extractUrl(e.clipboardData?.getData("text"));
  if (url) { e.preventDefault(); openItemEditor(null, { url }); }
});

document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => {
    if (e.target === d || e.target.closest("[data-close]")) closeDialog(d);
  });
  d.addEventListener("cancel", (e) => { e.preventDefault(); closeDialog(d); });
});

function anyDialogOpen() { return [...document.querySelectorAll("dialog")].some((d) => d.open); }
function closeDialog(d) {
  d.close();
  if (isPopup && d.id === "dlg-item") window.close();
}

// ───────────────────────── Editor link ─────────────────────────
const fItem = $("#form-item");
let editing = null; // item in modifica (o null per nuovo)
let draftTags = [];
let metaSeq = 0;
let lastMetaUrl = "";
let draftThumb = "";

function fillBoardSelect(selected) {
  const sel = $("#sel-board");
  const opts = state.boards.slice().sort((a, b) => a.name.localeCompare(b.name, "it"))
    .map((b) => `<option value="${esc(b.id)}" ${b.id === selected ? "selected" : ""}>${esc(b.name)}</option>`);
  sel.innerHTML = `<option value="">— Nessuna —</option>${opts.join("")}<option value="__new">+ Nuova bacheca…</option>`;
  if (!selected) sel.value = "";
}

$("#sel-board").addEventListener("change", async (e) => {
  if (e.target.value !== "__new") return;
  e.target.value = "";
  openBoardEditor(null, (b) => { if (b) fillBoardSelect(b.id); });
});

function openItemEditor(item, prefill = {}) {
  if (state.store.mode === "cloud" && !state.user) { toast("Accedi prima di salvare"); return; }
  editing = item || null;
  fItem.reset();
  $("#item-title").textContent = item ? "Modifica video" : "Salva un video";
  $("#btn-del-item").hidden = !item;
  $("#dup-notice").hidden = true;
  fItem.url.value = item?.url || prefill.url || "";
  fItem.title.value = item?.title || prefill.title || "";
  fItem.note.value = item?.note || "";
  draftTags = [...(item?.tags || [])];
  draftThumb = item?.thumbnail || "";
  lastMetaUrl = item?.url || "";
  const defaultBoard = item ? item.board_id : (state.view.board && !["all", "none"].includes(state.view.board) ? state.view.board : "");
  fillBoardSelect(defaultBoard || "");
  renderTags();
  updatePreview();
  $("#dlg-item").showModal();
  if (!item && fItem.url.value) { onUrlChange(); setTimeout(() => fItem.title.focus(), 50); }
  else if (!item) setTimeout(() => fItem.url.focus(), 50);
}

function updatePreview(status = "") {
  const url = fItem.url.value.trim();
  const p = PLATFORMS[detectPlatform(url)] || PLATFORMS.web;
  const pv = $("#preview");
  pv.hidden = !url;
  $("#preview-badge").textContent = p.label;
  $("#preview-badge").style.setProperty("--pc", p.color);
  $("#preview-thumb").style.setProperty("--pc", p.color);
  $("#preview-thumb").innerHTML = draftThumb
    ? `<img src="${esc(draftThumb)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
    : `<b>${esc(p.short)}</b>`;
  $("#preview-status").textContent = status;
}

async function onUrlChange() {
  const raw = fItem.url.value.trim();
  const url = cleanUrl(extractUrl(raw) || raw);
  if (url !== raw) fItem.url.value = url;
  if (!url || url === lastMetaUrl) { updatePreview(); return; }
  lastMetaUrl = url;
  draftThumb = "";

  const dup = state.items.find((i) => i.url === url && i.id !== editing?.id);
  const n = $("#dup-notice");
  if (dup) {
    n.hidden = false;
    n.innerHTML = `Hai già salvato questo video${dup.board_id ? ` in <b>${esc(boardName(dup.board_id))}</b>` : ""}. <button type="button" class="link-btn" id="open-dup">Apri quello</button>`;
    $("#open-dup").onclick = () => { closeDialog($("#dlg-item")); openItemEditor(dup); };
  } else n.hidden = true;

  updatePreview("Cerco titolo e anteprima…");
  const seq = ++metaSeq;
  const meta = await fetchMeta(url);
  if (seq !== metaSeq) return;
  if (meta.thumbnail) draftThumb = meta.thumbnail;
  if (meta.title && !fItem.title.value.trim()) fItem.title.value = meta.title.slice(0, 300);
  const found = meta.title || meta.thumbnail;
  updatePreview(found ? (meta.author ? `di ${meta.author}` : "") : "Anteprima non disponibile: aggiungi tu un titolo");
}

fItem.url.addEventListener("change", onUrlChange);
fItem.url.addEventListener("paste", () => setTimeout(onUrlChange, 0));

$("#btn-paste").addEventListener("click", async () => {
  try {
    const t = await navigator.clipboard.readText();
    const url = extractUrl(t);
    if (!url) return toast("Negli appunti non c'è un link");
    fItem.url.value = url;
    onUrlChange();
  } catch { toast("Il browser non permette di leggere gli appunti: incolla con Ctrl+V"); fItem.url.focus(); }
});

// Tag
const tagEntry = $("#tag-entry");
function renderTags() {
  const box = $("#tags-input");
  box.querySelectorAll(".chip").forEach((c) => c.remove());
  draftTags.forEach((t) => {
    const c = document.createElement("span");
    c.className = "chip on";
    c.innerHTML = `#${esc(t)} <button type="button" aria-label="Rimuovi ${esc(t)}">×</button>`;
    c.querySelector("button").onclick = () => { draftTags = draftTags.filter((x) => x !== t); renderTags(); };
    box.insertBefore(c, tagEntry);
  });
  const all = tagCounts();
  $("#tag-list").innerHTML = all.map(([t]) => `<option value="${esc(t)}">`).join("");
  const sug = all.filter(([t]) => !draftTags.includes(t)).slice(0, 10);
  $("#tag-suggest").innerHTML = sug.map(([t]) => `<button type="button" class="chip" data-tag="${esc(t)}">+ ${esc(t)}</button>`).join("");
}
$("#tag-suggest").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tag]");
  if (b) { addTag(b.dataset.tag); }
});
function addTag(raw) {
  String(raw).split(/[,\s]+/).map(normTag).filter(Boolean).forEach((t) => { if (!draftTags.includes(t)) draftTags.push(t); });
  tagEntry.value = "";
  renderTags();
}
tagEntry.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === "," || e.key === " ") && tagEntry.value.trim()) { e.preventDefault(); addTag(tagEntry.value); }
  else if (e.key === "Enter") { e.preventDefault(); }
  else if (e.key === "Backspace" && !tagEntry.value && draftTags.length) { draftTags.pop(); renderTags(); }
});
tagEntry.addEventListener("input", () => { if (/[,\s]$/.test(tagEntry.value)) addTag(tagEntry.value); });
tagEntry.addEventListener("blur", () => { if (tagEntry.value.trim()) addTag(tagEntry.value); });
$("#tags-input").addEventListener("click", () => tagEntry.focus());

fItem.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (tagEntry.value.trim()) addTag(tagEntry.value);
  const url = cleanUrl(extractUrl(fItem.url.value) || fItem.url.value.trim());
  if (!/^https?:\/\//i.test(url)) { toast("Inserisci un link valido"); fItem.url.focus(); return; }
  const boardId = fItem.board_id.value && fItem.board_id.value !== "__new" ? fItem.board_id.value : null;
  const item = {
    id: editing?.id || uid(),
    url,
    title: fItem.title.value.trim(),
    note: fItem.note.value.trim(),
    tags: draftTags,
    board_id: boardId,
    platform: detectPlatform(url),
    thumbnail: draftThumb || "",
    created_at: editing?.created_at || new Date().toISOString(),
  };
  const btn = $("#btn-save-item");
  btn.disabled = true;
  try {
    await state.store.saveItem(item);
    const k = state.items.findIndex((x) => x.id === item.id);
    if (k >= 0) state.items[k] = item; else state.items.unshift(item);
    $("#dlg-item").close();
    render();
    toast(editing ? "Modifiche salvate" : "Salvato nello scrigno ✓");
    if (isPopup) setTimeout(() => window.close(), 900);
  } catch (err) {
    toast("Errore nel salvataggio: " + (err.message || err));
  } finally { btn.disabled = false; }
});

$("#btn-del-item").addEventListener("click", async () => {
  if (!editing || !(await ask("Eliminare questo video dallo scrigno?"))) return;
  try {
    await state.store.deleteItem(editing.id);
    state.items = state.items.filter((i) => i.id !== editing.id);
    $("#dlg-item").close();
    render();
    toast("Eliminato");
  } catch (err) { toast("Errore: " + (err.message || err)); }
});

// ───────────────────────── Editor bacheca ─────────────────────────
const fBoard = $("#form-board");
let editingBoard = null;
let onBoardCreated = null;
let boardColor = BOARD_COLORS[0];

function renderSwatches() {
  $("#swatches").innerHTML = BOARD_COLORS.map((c) =>
    `<button type="button" class="swatch ${c === boardColor ? "on" : ""}" style="background:${c}" data-c="${c}" aria-label="Colore ${c}"></button>`).join("");
}
$("#swatches").addEventListener("click", (e) => {
  const s = e.target.closest("[data-c]");
  if (s) { boardColor = s.dataset.c; renderSwatches(); }
});

function openBoardEditor(b, onCreated = null) {
  editingBoard = b || null;
  onBoardCreated = onCreated;
  fBoard.reset();
  $("#board-title").textContent = b ? "Modifica bacheca" : "Nuova bacheca";
  $("#btn-del-board").hidden = !b;
  fBoard.name.value = b?.name || "";
  boardColor = b?.color || BOARD_COLORS[state.boards.length % BOARD_COLORS.length];
  renderSwatches();
  $("#dlg-board").showModal();
  setTimeout(() => fBoard.name.focus(), 50);
}

async function createBoard(name, color) {
  const existing = state.boards.find((b) => norm(b.name) === norm(name));
  if (existing) return existing;
  const b = { id: uid(), name, color: color || BOARD_COLORS[state.boards.length % BOARD_COLORS.length], created_at: new Date().toISOString() };
  try {
    await state.store.saveBoard(b);
    state.boards.push(b);
    return b;
  } catch (err) { toast("Errore: " + (err.message || err)); return null; }
}

fBoard.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = fBoard.name.value.trim();
  if (!name) return;
  if (editingBoard) {
    const b = { ...editingBoard, name, color: boardColor };
    try {
      await state.store.saveBoard(b);
      Object.assign(editingBoard, b);
    } catch (err) { return toast("Errore: " + (err.message || err)); }
  } else {
    const b = await createBoard(name, boardColor);
    if (onBoardCreated) { onBoardCreated(b); onBoardCreated = null; }
  }
  $("#dlg-board").close();
  render();
});

$("#btn-del-board").addEventListener("click", async () => {
  if (!editingBoard) return;
  const n = state.items.filter((i) => i.board_id === editingBoard.id).length;
  if (!(await ask(`Eliminare la bacheca "${editingBoard.name}"?${n ? ` I ${n} video al suo interno non vengono cancellati: finiscono in "Senza bacheca".` : ""}`))) return;
  try {
    await state.store.deleteBoard(editingBoard.id);
    state.boards = state.boards.filter((b) => b.id !== editingBoard.id);
    state.items.forEach((i) => { if (i.board_id === editingBoard.id) i.board_id = null; });
    $("#dlg-board").close();
    setView({ board: null });
  } catch (err) { toast("Errore: " + (err.message || err)); }
});

// ───────────────────────── Impostazioni ─────────────────────────
function bookmarkletCode() {
  const appUrl = location.origin + location.pathname;
  const js = `(function(){var u=${JSON.stringify(appUrl)}+'?popup=1&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title);window.open(u,'scrigno','width=480,height=760');})();`;
  return "javascript:" + encodeURI(js);
}

function openSettings() { renderSettings(); $("#dlg-settings").showModal(); }

function renderSettings() {
  const el = $("#settings-content");
  if (!el) return;
  const cloud = state.store.mode === "cloud";
  const localCount = cloud ? localBackup().items.length : 0;
  el.innerHTML = `
    <section class="set">
      <h3>Sincronizzazione</h3>
      ${cloud
        ? (state.user
            ? `<p>Collegato come <b>${esc(state.user.email)}</b>. I video sono sincronizzati tra PC e telefono.</p>
               <button class="btn ghost" id="btn-logout">Esci</button>`
            : `<p>Accedi per sincronizzare i tuoi video.</p>`)
        : `<p><b>Modalità locale:</b> i video sono salvati solo in questo browser. Per vederli anche sul telefono (e viceversa) collega Supabase, gratuito: istruzioni nel file <code>README.md</code>.</p>`}
      ${cloud && state.user && localCount ? `<p class="notice">In questo browser ci sono ${localCount} video salvati in modalità locale. <button class="link-btn" id="btn-migrate">Caricali nel cloud</button></p>` : ""}
    </section>

    <section class="set">
      <h3>Salvare dal PC con un clic</h3>
      <p>Trascina questo pulsante nella barra dei preferiti del browser. Quando guardi un video su Instagram, YouTube, TikTok… cliccalo: si apre Scrigno con il link (e il titolo) già compilati.</p>
      <p><a class="bookmarklet" href="${esc(bookmarkletCode())}" onclick="event.preventDefault()" title="Trascinami nella barra dei preferiti">＋ Salva in Scrigno</a></p>
      <p class="muted small">Barra dei preferiti nascosta? <kbd>Ctrl</kbd>+<kbd>Maiusc</kbd>+<kbd>B</kbd>. In alternativa: copia il link e premi <kbd>Ctrl</kbd>+<kbd>V</kbd> in questa pagina.</p>
    </section>

    <section class="set">
      <h3>Salvare dal telefono</h3>
      <p>Apri Scrigno in Chrome su Android → menu ⋮ → <i>Installa app</i> (o <i>Aggiungi a schermata Home</i>). Da quel momento, nelle app social premi <i>Condividi</i> e scegli <b>Scrigno</b>.</p>
    </section>

    <section class="set">
      <h3>Backup</h3>
      <p>${state.items.length} video, ${state.boards.length} bacheche.</p>
      <div class="row wrap">
        <button class="btn ghost" id="btn-export">Esporta (JSON)</button>
        <button class="btn ghost" id="btn-import">Importa…</button>
      </div>
    </section>`;

  $("#btn-logout", el)?.addEventListener("click", async () => { await state.store.signOut(); $("#dlg-settings").close(); reload(); });
  $("#btn-export", el).addEventListener("click", exportData);
  $("#btn-import", el).addEventListener("click", () => $("#file-import").click());
  $("#btn-migrate", el)?.addEventListener("click", async () => {
    try {
      await state.store.bulkImport(localBackup());
      toast("Dati locali caricati nel cloud ✓");
      await reload(); renderSettings();
    } catch (err) { toast("Errore: " + (err.message || err)); }
  });
}

function exportData() {
  const data = { app: "scrigno", version: 1, exported_at: new Date().toISOString(), boards: state.boards, items: state.items };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `scrigno-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("#file-import").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.items)) throw new Error("file non valido");
    const boards = (d.boards || []).filter((b) => b && b.id && b.name);
    const items = d.items.filter((i) => i && i.id && i.url).map((i) => ({ ...i, tags: i.tags || [], platform: i.platform || detectPlatform(i.url) }));
    await state.store.bulkImport({ boards, items });
    await reload();
    renderSettings();
    toast(`Importati ${items.length} video ✓`);
  } catch (err) { toast("Importazione non riuscita: " + (err.message || err)); }
});

// ───────────────────────── Conferma ─────────────────────────
function ask(text, okLabel = "Elimina") {
  const d = $("#dlg-confirm");
  $("#confirm-text").textContent = text;
  $("#confirm-ok").textContent = okLabel;
  return new Promise((resolve) => {
    const form = d.querySelector("form");
    const onSubmit = (e) => { e.preventDefault(); cleanup(); d.close(); resolve(true); };
    const onClose = () => { cleanup(); resolve(false); };
    const cleanup = () => { form.removeEventListener("submit", onSubmit); d.removeEventListener("close", onClose); };
    form.addEventListener("submit", onSubmit);
    d.addEventListener("close", onClose);
    d.showModal();
  });
}

// ───────────────────────── Toast ─────────────────────────
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); setTimeout(() => (t.hidden = true), 250); }, 2600);
}

// Dopo il login, completa un salvataggio rimasto in sospeso.
async function resumePending() {
  const p = sessionStorage.getItem("scrigno:pending");
  if (p && state.user) { sessionStorage.removeItem("scrigno:pending"); try { openItemEditor(null, JSON.parse(p)); } catch {} }
}

boot().then(resumePending);
