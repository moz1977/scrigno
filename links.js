// Riconoscimento link, pulizia URL e recupero di titolo/miniatura.

export const PLATFORMS = {
  youtube:   { label: "YouTube",   color: "#ff0033", short: "YT" },
  instagram: { label: "Instagram", color: "#d62976", short: "IG" },
  tiktok:    { label: "TikTok",    color: "#111111", short: "TT" },
  facebook:  { label: "Facebook",  color: "#1877f2", short: "FB" },
  x:         { label: "X",         color: "#222222", short: "X"  },
  threads:   { label: "Threads",   color: "#333333", short: "TH" },
  pinterest: { label: "Pinterest", color: "#e60023", short: "PI" },
  reddit:    { label: "Reddit",    color: "#ff4500", short: "RE" },
  vimeo:     { label: "Vimeo",     color: "#17d5ff", short: "VI" },
  linkedin:  { label: "LinkedIn",  color: "#0a66c2", short: "IN" },
  web:       { label: "Web",       color: "#6b6258", short: "WWW" },
};

/** Trova il primo URL in un testo (le app spesso condividono "testo + link"). */
export function extractUrl(text) {
  if (!text) return "";
  const m = String(text).match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0].replace(/[),.;!?]+$/, "");
  const bare = String(text).trim();
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(bare)) return "https://" + bare;
  return "";
}

export function detectPlatform(url) {
  let h = "";
  try { h = new URL(url).hostname.replace(/^www\.|^m\.|^mobile\./, ""); } catch { return "web"; }
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(h)) return "youtube";
  if (/(^|\.)instagram\.com$|^instagr\.am$/.test(h)) return "instagram";
  if (/(^|\.)tiktok\.com$/.test(h)) return "tiktok";
  if (/(^|\.)facebook\.com$|^fb\.watch$|^fb\.com$/.test(h)) return "facebook";
  if (/^(x|twitter)\.com$/.test(h)) return "x";
  if (/(^|\.)threads\.(net|com)$/.test(h)) return "threads";
  if (/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/.test(h)) return "pinterest";
  if (/(^|\.)reddit\.com$|^redd\.it$/.test(h)) return "reddit";
  if (/(^|\.)vimeo\.com$/.test(h)) return "vimeo";
  if (/(^|\.)linkedin\.com$/.test(h)) return "linkedin";
  return "web";
}

const TRACKING = /^(utm_\w+|igsh|igshid|si|fbclid|gclid|is_from_webapp|sender_device|_r|_t|share_\w+|ref|ref_src|feature|mibextid|rdid)$/i;

/** Rimuove i parametri di tracciamento: così lo stesso video ha sempre lo stesso URL. */
export function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    const p = detectPlatform(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (p === "youtube" && (k === "v" || k === "t" || k === "list")) continue;
      if (TRACKING.test(k) || (p === "x" && k === "s")) u.searchParams.delete(k);
    }
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("?")) s = s.slice(0, -1);
    return s;
  } catch { return raw; }
}

export function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("youtu.be")) return u.pathname.slice(1).split("/")[0];
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{6,})/);
    return m ? m[2] : "";
  } catch { return ""; }
}

async function getJson(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j && !j.error ? j : null;
  } catch { return null; } finally { clearTimeout(t); }
}

/**
 * Prova a recuperare titolo e miniatura. Funziona bene con YouTube, TikTok
 * e Vimeo; Instagram e Facebook di solito non lo permettono dal browser,
 * quindi in quel caso il titolo lo scrivi tu (o arriva dal bookmarklet).
 */
export async function fetchMeta(url) {
  const platform = detectPlatform(url);
  const out = { title: "", thumbnail: "", author: "" };
  const enc = encodeURIComponent(url);

  if (platform === "youtube") {
    const id = youtubeId(url);
    if (id) out.thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }

  let j = null;
  if (platform === "tiktok") j = await getJson(`https://www.tiktok.com/oembed?url=${enc}`);
  else if (platform === "vimeo") j = await getJson(`https://vimeo.com/api/oembed.json?url=${enc}`);
  if (!j) j = await getJson(`https://noembed.com/embed?url=${enc}`);

  if (j) {
    out.title = j.title || "";
    out.author = j.author_name || "";
    if (!out.thumbnail && j.thumbnail_url) out.thumbnail = j.thumbnail_url;
  }
  return out;
}

/** Pulisce il titolo della pagina passato dal bookmarklet (es. "… | Instagram"). */
export function tidyTitle(t) {
  if (!t) return "";
  return String(t)
    .replace(/\s*[|•·-]\s*(Instagram|TikTok|YouTube|Facebook|X|Threads|Pinterest|Reddit)\s*$/i, "")
    .replace(/\s+on Instagram:\s*/i, ": ")
    .replace(/^\(\d+\)\s*/, "")
    .trim()
    .slice(0, 300);
}
