// Archiviazione dati: locale (browser) oppure Supabase (sincronizzata).
// Entrambe espongono la stessa interfaccia, così l'app non cambia.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const uid = () =>
  (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

const LOCAL_KEY = "scrigno:v1";

function readLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    if (d && Array.isArray(d.items) && Array.isArray(d.boards)) return d;
  } catch {}
  return { boards: [], items: [] };
}

export class LocalStore {
  constructor() { this.mode = "local"; this.data = readLocal(); }
  async init() { return { user: null }; }
  persist() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.data)); }
    catch (e) { throw new Error("Impossibile salvare nel browser: " + e.message); }
  }
  async load() { this.data = readLocal(); return structuredClone(this.data); }
  async saveItem(item) { upsert(this.data.items, item); this.persist(); return item; }
  async deleteItem(id) { this.data.items = this.data.items.filter((i) => i.id !== id); this.persist(); }
  async saveBoard(b) { upsert(this.data.boards, b); this.persist(); return b; }
  async deleteBoard(id) {
    this.data.boards = this.data.boards.filter((b) => b.id !== id);
    this.data.items.forEach((i) => { if (i.board_id === id) i.board_id = null; });
    this.persist();
  }
  async bulkImport({ boards = [], items = [] }) {
    boards.forEach((b) => upsert(this.data.boards, b));
    items.forEach((i) => upsert(this.data.items, i));
    this.persist();
  }
}

function upsert(arr, obj) {
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i >= 0) arr[i] = { ...arr[i], ...obj }; else arr.push(obj);
}

export class SupabaseStore {
  constructor() { this.mode = "cloud"; this.sb = null; this.user = null; }

  async init() {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    this.sb = createClient(supabaseBaseUrl(SUPABASE_URL), SUPABASE_ANON_KEY.trim(), {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const { data } = await this.sb.auth.getSession();
    this.user = data.session?.user || null;
    return { user: this.user };
  }

  onAuthChange(cb) {
    this.sb.auth.onAuthStateChange((_ev, session) => { this.user = session?.user || null; cb(this.user); });
  }

  async signIn(email) {
    const redirect = location.origin + location.pathname;
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    if (error) throw error;
  }

  // Anteprima letta dal server (funzione Edge "preview"). Restituisce null se non è installata.
  async preview(url) {
    if (this.previewUnavailable || !this.user) return null;
    const { data, error } = await this.sb.functions.invoke("preview", { body: { url } });
    if (error) {
      const status = error.context?.status;
      if (status === 404) this.previewUnavailable = true; // funzione non ancora pubblicata
      throw error;
    }
    return data;
  }

  async signOut() { await this.sb.auth.signOut(); this.user = null; }

  async load() {
    const [b, i] = await Promise.all([
      this.sb.from("boards").select("*").order("created_at", { ascending: true }),
      this.sb.from("items").select("*").order("created_at", { ascending: false }),
    ]);
    if (b.error) throw b.error;
    if (i.error) throw i.error;
    return { boards: b.data, items: i.data };
  }

  clean(obj, fields) {
    const o = { user_id: this.user.id };
    fields.forEach((f) => { if (obj[f] !== undefined) o[f] = obj[f]; });
    return o;
  }

  async saveItem(item) {
    const row = this.clean(item, ["id", "board_id", "url", "title", "thumbnail", "platform", "tags", "note", "created_at"]);
    const { error } = await this.sb.from("items").upsert(row);
    if (error) throw error;
    return item;
  }
  async deleteItem(id) {
    const { error } = await this.sb.from("items").delete().eq("id", id);
    if (error) throw error;
  }
  async saveBoard(b) {
    const row = this.clean(b, ["id", "name", "color", "created_at"]);
    const { error } = await this.sb.from("boards").upsert(row);
    if (error) throw error;
    return b;
  }
  async deleteBoard(id) {
    const { error } = await this.sb.from("boards").delete().eq("id", id);
    if (error) throw error;
  }
  async bulkImport({ boards = [], items = [] }) {
    if (boards.length) {
      const { error } = await this.sb.from("boards")
        .upsert(boards.map((b) => this.clean(b, ["id", "name", "color", "created_at"])));
      if (error) throw error;
    }
    for (let k = 0; k < items.length; k += 500) {
      const chunk = items.slice(k, k + 500)
        .map((i) => this.clean(i, ["id", "board_id", "url", "title", "thumbnail", "platform", "tags", "note", "created_at"]));
      const { error } = await this.sb.from("items").upsert(chunk);
      if (error) throw error;
    }
  }
}

// Accetta anche URL incollati "sporchi": con / finale, con /rest/v1/,
// oppure l'indirizzo della dashboard (supabase.com/dashboard/project/<id>).
export function supabaseBaseUrl(raw) {
  const s = String(raw || "").trim();
  try {
    const u = new URL(s.startsWith("http") ? s : "https://" + s);
    const ref = u.hostname.endsWith("supabase.com") && u.pathname.match(/\/project\/([a-z0-9]+)/i);
    if (ref) return `https://${ref[1]}.supabase.co`;
    return u.origin;
  } catch { return s.replace(/\/+$/, ""); }
}

export const cloudConfigured =() => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const localBackup = () => readLocal();
