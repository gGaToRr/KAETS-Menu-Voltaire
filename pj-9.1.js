// ==UserScript==
// @name         KAETS Menu — Projet Voltaire
// @namespace    kaets-menu
// @version      9.3.0
// @description  Mod menu Projet Voltaire — by kaets0ner (local + backend fallback)
// @match        *://*/*
// @grant        none
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONSTANTES
  // ═══════════════════════════════════════════════════════════════════════════
  const VERSION = "9.3.0";
  const BRAND = "KAETS";

  // AES (niveaux PV)
  const KEY_B64 = "RW5jcnlwdCBvciBvYmZ1cw==";
  const IV = new Uint8Array(16);

  const SEL = {
    word: "div.r-184en5c.r-lrvibr",
    dndItem: "div.r-1q8sk3r.r-6dt33c",
    dndSel: "div.r-6dt33c",
    dndCol: "div.r-18u37iz.r-1wtj0ep.r-1wzrnnt",
    dndZone: "div.r-vacyoi",
  };

  // Palette menu (dark + violet)
  const C = {
    accent: "#a855f7",
    accentDim: "#7c3aed",
    accentBright: "#c084fc",
    bg: "#09090b",
    bgCard: "#18181b",
    bgHover: "#27272a",
    border: "#3f3f46",
    text: "#fafafa",
    textDim: "#a1a1aa",
    textMuted: "#71717a",
    success: "#22c55e",
    error: "#ef4444",
    warn: "#f59e0b",
  };

  // Palette Compare (style PV : marine + jaune)
  const PV = {
    navy: "#0b3360",
    navyDark: "#072548",
    accent: "#f6a623",
    bg: "#ffffff",
    bgSoft: "#f5f7fb",
    border: "#dde3ef",
    text: "#1a2b45",
    textDim: "#5b6a82",
  };

  // Storage keys
  const LS = {
    settings: "kaets_v9_settings",
    dump: "kaets_v9_dump",
    popupShown: "kaets_v9_popup_shown",
    popupDismissed: "kaets_v9_popup_dismissed",
  };

  // Backend (sert /dump). Override : localStorage.setItem("kaets_backend_url", "https://…")
  const BACKEND_URL = localStorage.getItem("kaets_backend_url") || "http://localhost:8000";

  // GitHub repo : cible du bouton ⭐ et URL de détection pour la gate
  const GITHUB_REPO_URL = "https://github.com/gGaToRr/KAETS-Menu-Voltaire";
  const GITHUB_REPO_PATH = "/gGaToRr/KAETS-Menu-Voltaire";
  // Cibles de redirection après "Let's cheat"
  const PV_TARGET_URL = "https://apprentissage.appli3.projet-voltaire.fr/selection-module";
  const PV_LOGIN_URL = "https://compte.groupe-voltaire.fr/login";

  // ═══════════════════════════════════════════════════════════════════════════
  //  ETAT
  // ═══════════════════════════════════════════════════════════════════════════
  const state = {
    menuOpen: false,
    page: "home",
    pageHistory: [],
    lastSentence: "",
    lastAnswer: "—",
    aaLock: false,
    currentExercise: null,
    currentExerciseType: null,
  };

  const DEFAULTS = {
    overlay: { enabled: false, position: "bottom-left", opacity: 85, fontSize: 14, width: 300, compare: false },
    autoAnswer: { enabled: false, delay: 150, autoNext: true },
    silent: { enabled: false, color: "#a855f7", thickness: 2, offset: 3, style: "solid" },
  };

  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(LS.settings) || "null");
      if (!stored) return structuredClone(DEFAULTS);
      const merged = structuredClone(DEFAULTS);
      for (const k of Object.keys(stored)) {
        if (typeof stored[k] === "object" && stored[k]) merged[k] = { ...merged[k], ...stored[k] };
        else merged[k] = stored[k];
      }
      return merged;
    } catch { return structuredClone(DEFAULTS); }
  }
  function saveSettings() { localStorage.setItem(LS.settings, JSON.stringify(settings)); }
  let settings = loadSettings();

  // Index live (XHR/fetch intercept) + base dump (backend /dump, cache localStorage)
  const index = {};
  let dumpIndex = {};
  let dumpMeta = { present: false, exercises: 0, ts: 0 };
  window._kaetsIndex = index;
  window._kaetsDump = dumpIndex;
  let levelMeta = { title: "—", rules: 0, exercises: 0 };

  // ═══════════════════════════════════════════════════════════════════════════
  //  AES — DECHIFFREMENT DES NIVEAUX PV
  // ═══════════════════════════════════════════════════════════════════════════
  let _cryptoKey = null;
  async function getKey() {
    if (_cryptoKey) return _cryptoKey;
    const raw = Uint8Array.from(atob(KEY_B64), (c) => c.charCodeAt(0));
    _cryptoKey = await crypto.subtle.importKey("raw", raw, { name: "AES-CBC" }, false, ["decrypt"]);
    return _cryptoKey;
  }
  async function decryptLevel(buf) {
    const dec = await crypto.subtle.decrypt({ name: "AES-CBC", iv: IV }, await getKey(), buf);
    const text = new TextDecoder().decode(dec).replace(/\0+$/, "");
    return JSON.parse(text.slice(0, text.lastIndexOf("}") + 1));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  NORMALISATION TEXTE
  // ═══════════════════════════════════════════════════════════════════════════
  function normText(s) {
    if (!s) return "";
    return s
      .replace(/[’‘`´]/g, "'")
      .replace(/[“”„]/g, '"')
      .replace(/[‑‐‒–—―]/g, "-")
      .replace(/ /g, " ")
      .replace(/[«»]/g, "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/\s+/g, " ").trim();
  }

  function normSentence(parts) {
    let o = "";
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      o += (p.before || "") + (p.text || "") + (p.after || "");
      if (!p.noSpaceAfter && i < parts.length - 1 && !parts[i + 1].before) o += " ";
    }
    return o.trim().replace(/\s+/g, " ");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  INDEX LIVE — CONSTRUCTION DEPUIS LES NIVEAUX PV INTERCEPTES
  // ═══════════════════════════════════════════════════════════════════════════
  function buildIndex(level) {
    let n = 0;
    for (const rule of level.rules || []) {
      for (const ex of rule.exercises || []) {
        if (ex.type === "click_on_word") {
          const key = normSentence(ex.sentence || []);
          let answers = (ex.sentence || []).filter((p) => p.correction && p.clue).map((p) => p.text);
          if (!answers.length) answers = (ex.sentence || []).filter((p) => p.correction).map((p) => p.text);
          index[key] = { answers, type: "click", id: ex.id };
          n++;
        } else if (ex.type === "click_on_mistake") {
          const key = (ex.sentence || []).map((p) => p.text).join(" ").trim().replace(/\s+/g, " ");
          const answers = ex.hasMistake ? (ex.sentence || []).filter((p) => p.mistake).map((p) => p.text) : [];
          index[key] = { answers, type: "click", id: ex.id };
          n++;
        } else if (ex.type === "drag_and_drop") {
          for (const col of ex.columns || []) {
            const lbl = col.instruction.replace(/<[^>]+>/g, "").trim();
            for (const w of col.words || []) {
              const k = w.replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " ");
              index[k] = { answers: [lbl], type: "dnd", id: ex.id };
              n++;
            }
          }
        }
      }
    }
    levelMeta = { title: level.title || "?", rules: level.rules?.length || 0, exercises: n };
    window._kaetsLevel = level;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BASE DUMP — cache localStorage + fetch backend
  // ═══════════════════════════════════════════════════════════════════════════
  function loadDumpFromLS() {
    try {
      const raw = localStorage.getItem(LS.dump);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && typeof data.index === "object") {
        dumpIndex = data.index;
        dumpMeta = data.meta || { present: true, exercises: Object.keys(dumpIndex).length, ts: 0 };
        window._kaetsDump = dumpIndex;
        console.log(`[KAETS] dump local (${dumpMeta.exercises} exercices)`);
      }
    } catch (e) { console.warn("[KAETS] dump LS corrompu :", e.message); }
  }

  function saveDumpToLS() {
    try {
      localStorage.setItem(LS.dump, JSON.stringify({ index: dumpIndex, meta: dumpMeta }));
    } catch (e) {
      console.warn("[KAETS] LS quota dépassé pour dump :", e.message);
    }
  }

  function clearDump() {
    dumpIndex = {};
    dumpMeta = { present: false, exercises: 0, ts: 0 };
    window._kaetsDump = dumpIndex;
    localStorage.removeItem(LS.dump);
  }

  async function fetchDump() {
    try {
      const r = await fetch(BACKEND_URL + "/dump", { signal: AbortSignal.timeout(15000) });
      if (!r.ok) {
        console.warn("[KAETS] backend dump HTTP", r.status);
        return { ok: false, error: "HTTP " + r.status };
      }
      const data = await r.json();
      const exos = data.exercises || [];
      const next = {};
      for (const ex of exos) {
        if (!ex.sentence) continue;
        next[ex.sentence] = { answers: ex.answers || [], type: ex.type, id: ex.id };
      }
      dumpIndex = next;
      dumpMeta = { present: true, exercises: exos.length, ts: Date.now() };
      window._kaetsDump = dumpIndex;
      saveDumpToLS();
      console.log(`[KAETS] dump charge — ${exos.length} exercices`);
      return { ok: true, exercises: exos.length };
    } catch (e) {
      console.warn("[KAETS] backend offline :", e.message);
      return { ok: false, error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  XHR / FETCH INTERCEPT
  // ═══════════════════════════════════════════════════════════════════════════
  function tryParseExercises(data) {
    if (data instanceof ArrayBuffer) {
      decryptLevel(data).then(buildIndex).catch(() => {});
      return;
    }
    let obj = data;
    if (typeof data === "string") { try { obj = JSON.parse(data); } catch { return; } }
    if (!obj || typeof obj !== "object") return;
    const hasEx = (o) => Array.isArray(o?.rules) && o.rules.some((r) => (r.exercises || []).some((e) => /click_on_mistake|click_on_word|drag_and_drop/.test(e.type)));
    const unwrap = (o) => {
      if (hasEx(o)) return o;
      for (const v of Object.values(o)) { if (typeof v === "object" && v) { const r = unwrap(v); if (r) return r; } }
      return null;
    };
    const level = unwrap(obj);
    if (level) buildIndex(level);
  }

  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...r) { this._pvUrl = u; return _origOpen.call(this, m, u, ...r); };
  XMLHttpRequest.prototype.send = function (...a) {
    if (!this._pvUrl) return _origSend.call(this, ...a);
    if (/levels\/\d+\.json/.test(this._pvUrl)) {
      this.responseType = "arraybuffer";
      this.addEventListener("load", () => tryParseExercises(this.response));
    } else if (/projet-voltaire|appli3/i.test(this._pvUrl)) {
      this.addEventListener("load", () => {
        if (this.responseText) tryParseExercises(this.responseText);
      });
    }
    return _origSend.call(this, ...a);
  };

  const _origFetch = window.fetch;
  window.fetch = function (input, ...a) {
    const url = typeof input === "string" ? input : input?.url || "";
    const p = _origFetch.call(this, input, ...a);
    if (/projet-voltaire|appli3/i.test(url)) {
      p.then((r) => r.clone().text().then((t) => tryParseExercises(t)).catch(() => {})).catch(() => {});
    }
    return p;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  CLICK SIMULATION
  // ═══════════════════════════════════════════════════════════════════════════
  function simulateClick(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const t of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(t, opts));
    }
  }

  function clickButton(regex) {
    const btn = [...document.querySelectorAll("button")].find((b) => b.offsetParent && regex.test(b.innerText?.trim()));
    if (btn) { simulateClick(btn); return true; }
    return false;
  }

  function clickSuivant() { return clickButton(/suivant|continuer/i); }

  function waitAndNext(cb) {
    let attempts = 0;
    const t = setInterval(() => {
      attempts++;
      if (clickSuivant()) { clearInterval(t); setTimeout(cb, settings.autoAnswer.delay); return; }
      if (attempts >= 40) { clearInterval(t); cb(); }
    }, 100);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FIND TARGET
  // ═══════════════════════════════════════════════════════════════════════════
  function findTarget(answer) {
    const norm = (s) => s.trim().replace(/\s+/g, " ");
    const normL = (s) => norm(s).toLowerCase();
    const normU = (s) => normL(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
    const stripP = (s) => s.replace(/[;:!?,.…\xab\xbb“”()]/g, "").trim();

    const ansN = norm(answer), ansL = ansN.toLowerCase(), ansU = normU(answer), ansStrip = stripP(ansL);
    const words = [...document.querySelectorAll(SEL.word)].filter((w) => w.innerText.trim().length > 0);

    let m = words.find((w) => norm(w.innerText) === ansN);
    if (m) return m;
    m = words.find((w) => normL(w.innerText) === ansL);
    if (m) return m;
    m = words.find((w) => normU(w.innerText) === ansU);
    if (m) return m;
    if (ansStrip.length >= 2) { m = words.find((w) => stripP(normL(w.innerText)) === ansStrip); if (m) return m; }

    const ansWords = ansL.split(" ");
    for (let i = 0; i < words.length; i++) {
      let combined = "";
      for (let j = i; j < Math.min(i + ansWords.length + 2, words.length); j++) {
        if (j > i) { const pr = words[j - 1].getBoundingClientRect(), cr = words[j].getBoundingClientRect(); if (Math.abs(cr.top - pr.top) > 80) break; }
        combined = normL(combined + " " + words[j].innerText).trim();
        if (combined === ansL) return words[i];
        if (combined.length > ansL.length) break;
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FUZZY MATCH (logique original.js + fallback exact sur la base)
  // ═══════════════════════════════════════════════════════════════════════════
  function fuzzyMatch(s) {
    if (index[s]) return index[s];           // exact sur l'index live
    if (dumpIndex[s]) return dumpIndex[s];   // exact sur la base (fallback)
    // Fuzzy : exclusivement sur l'index live (comme original)
    let best = null, bs = 0;
    const sw = new Set(s.split(" "));
    for (const [k, d] of Object.entries(index)) {
      const kw = k.split(" ");
      const score = kw.filter((w) => sw.has(w)).length / kw.length;
      if (score > bs && score > 0.65) { bs = score; best = d; }
    }
    return best;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HIGHLIGHT SILENT
  // ═══════════════════════════════════════════════════════════════════════════
  function clearHighlights() {
    document.querySelectorAll("[data-khl]").forEach((el) => {
      if (el.dataset.khlRemove) { el.remove(); return; }
      el.style.textDecoration = "";
      el.style.textUnderlineOffset = "";
      delete el.dataset.khl;
    });
  }

  function applyHighlight(el) {
    const s = settings.silent;
    el.style.textDecoration = `underline ${s.style} ${s.color} ${s.thickness}px`;
    el.style.textUnderlineOffset = s.offset + "px";
    el.dataset.khl = "1";
  }

  function highlightAnswer(answers) {
    clearHighlights();
    if (!answers.length) {
      const btn = [...document.querySelectorAll("button")].find((b) => b.innerText && /pas de faute/i.test(b.innerText));
      if (btn) applyHighlight(btn);
      return;
    }
    for (const a of answers) {
      const t = findTarget(a);
      if (!t) continue;
      [t, ...t.querySelectorAll(SEL.word)].forEach(applyHighlight);
    }
  }

  function highlightDnd(results) {
    clearHighlights();
    const colRow = document.querySelector(SEL.dndCol);
    const colLabels = colRow ? [...colRow.children].map((c) => c.innerText.trim()) : [];
    const norm = (s) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

    for (const { el, answer } of results) {
      const ansN = norm(answer);
      let idx = colLabels.findIndex((l) => norm(l) === ansN);
      if (idx === -1) {
        const aw = ansN.split(" ").filter((w) => w.length > 2);
        let best = -1, bs = 0;
        colLabels.forEach((l, i) => { const lw = norm(l).split(" "); const sc = aw.filter((w) => lw.some((x) => x.includes(w) || w.includes(x))).length; if (sc > bs) { bs = sc; best = i; } });
        idx = best;
      }
      const badge = document.createElement("div");
      badge.textContent = idx === -1 ? "?" : String(idx + 1);
      badge.dataset.khl = "1";
      badge.dataset.khlRemove = "1";
      Object.assign(badge.style, {
        position: "absolute", top: "2px", right: "4px",
        background: "transparent", color: settings.silent.color, fontWeight: "bold", fontSize: "12px",
        zIndex: "99999", pointerEvents: "none", fontFamily: "monospace", textShadow: "0 0 3px #000",
      });
      const parent = el.closest(SEL.dndItem) || el;
      if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
      parent.appendChild(badge);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  AUTOANSWER
  // ═══════════════════════════════════════════════════════════════════════════
  function doAutoAnswer(answers) {
    if (state.aaLock) return;
    state.aaLock = true;
    const unlock = () => { state.aaLock = false; state.lastSentence = ""; };

    if (!answers.length) {
      const btn = [...document.querySelectorAll("button")].find((b) => b.offsetParent && /pas de faute/i.test(b.innerText));
      if (btn) simulateClick(btn);
      if (settings.autoAnswer.autoNext) waitAndNext(unlock); else unlock();
      return;
    }

    let target = null;
    for (const a of answers) { target = findTarget(a); if (target) break; }
    if (target) {
      simulateClick(target);
      setTimeout(() => { if (target.firstElementChild) simulateClick(target.firstElementChild); }, 30);
      if (settings.autoAnswer.autoNext) setTimeout(() => waitAndNext(unlock), 180);
      else setTimeout(unlock, 180);
    } else { unlock(); }
  }

  async function doAutoDnD(results) {
    if (state.aaLock) return;
    state.aaLock = true;
    try {
      const colRow = document.querySelector(SEL.dndCol);
      if (!colRow) { state.aaLock = false; return; }
      const colLabels = [...colRow.children].map((c) => c.innerText.trim());
      const zones = [...document.querySelectorAll(SEL.dndZone)];
      const norm = (s) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

      for (const { el, answer } of results) {
        if (!document.body.contains(el)) continue;
        const ansN = norm(answer);
        let idx = colLabels.findIndex((l) => norm(l) === ansN);
        if (idx === -1) {
          const aw = ansN.split(" ").filter((w) => w.length > 2);
          let best = -1, bs = 0;
          colLabels.forEach((l, i) => { const lw = norm(l).split(" "); const sc = aw.filter((w) => lw.some((x) => x.includes(w) || w.includes(x))).length; if (sc > bs) { bs = sc; best = i; } });
          idx = best;
        }
        if (idx === -1 || !zones[idx]) continue;
        simulateClick(el);
        await new Promise((r) => setTimeout(r, 40));
        simulateClick(zones[idx]);
        await new Promise((r) => setTimeout(r, 40));
      }
      await new Promise((r) => setTimeout(r, 40));
      clickButton(/valider/i);
      await new Promise((r) => setTimeout(r, settings.autoAnswer.delay));
      if (settings.autoAnswer.autoNext) clickSuivant();
    } catch (e) { console.warn("[KAETS DnD]", e); }
    finally { await new Promise((r) => setTimeout(r, 200)); state.aaLock = false; state.lastSentence = ""; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOOKUP PRINCIPAL
  // ═══════════════════════════════════════════════════════════════════════════
  function lookup() {
    const isDnd = document.querySelectorAll(SEL.dndSel).length > 0;

    if (isDnd) {
      const items = [...document.querySelectorAll(SEL.dndItem)].map((el) => {
        const p = [...el.children].find((c) => c.className === "css-g5y9jx" && !c.children.length);
        return { el, text: (p || el).innerText.trim().replace(/\s+/g, " ") };
      }).filter((t) => t.text.length > 3);
      if (!items.length) return;
      const key = items.map((i) => i.text).join("|");
      if (key === state.lastSentence) return;
      state.lastSentence = key;
      state.currentExercise = key;
      state.currentExerciseType = "dnd";
      clearHighlights();
      const results = items.map(({ el, text }) => { const m = fuzzyMatch(text); return m ? { phrase: text, answer: m.answers[0], el } : null; }).filter(Boolean);
      if (results.length === items.length) {
        updateLiveOverlay(results.map((r) => `${r.phrase.slice(0, 20)} → ${r.answer}`).join("\n"), "dnd");
        state.lastAnswer = results.map((r) => r.answer).join(", ");
        if (settings.silent.enabled) highlightDnd(results);
        else if (settings.autoAnswer.enabled) setTimeout(() => doAutoDnD(results), settings.autoAnswer.delay);
      }
    } else {
      const allWords = [...document.querySelectorAll(SEL.word)].filter((w) => w.innerText.trim().length > 0);
      const words = allWords.filter((w, i, a) => i === 0 || w.innerText.trim() !== a[i - 1].innerText.trim());
      if (!words.length) return;
      const s = words.map((w) => w.innerText.trim()).join(" ").replace(/\s+/g, " ").trim();
      if (!s || s === state.lastSentence) return;
      state.lastSentence = s;
      state.currentExercise = s;
      state.currentExerciseType = "click";
      clearHighlights();

      const data = fuzzyMatch(s);
      if (data) {
        const noFault = data.type === "click" && !data.answers.length;
        const display = noFault ? "PAS DE FAUTE" : data.answers.map((a) => `« ${a} »`).join(" | ");
        state.lastAnswer = display;
        updateLiveOverlay(display, data.type, noFault);
        if (settings.silent.enabled) highlightAnswer(data.answers);
        else if (settings.autoAnswer.enabled) setTimeout(() => doAutoAnswer(data.answers), settings.autoAnswer.delay);
        return;
      }
      updateLiveOverlay("—", "none");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LIVE OVERLAY
  // ═══════════════════════════════════════════════════════════════════════════
  function updateLiveOverlay(text, type, noFault = false) {
    const el = document.getElementById("kv9-live-answer");
    if (!el) return;
    if (type === "none") { el.innerHTML = `<span style="color:${C.textMuted}">En attente…</span>`; return; }
    if (type === "dnd") {
      el.innerHTML = text.split("\n").map((l) => `<div style="font-size:12px;color:${C.text};margin:2px 0;">${l}</div>`).join("");
    } else {
      el.innerHTML = `<div style="color:${noFault ? C.warn : C.accent};font-size:${settings.overlay.fontSize}px;font-weight:600;">${text}</div>`;
    }
  }

  function applyOverlay() {
    const el = document.getElementById("kv9-live");
    if (!el) return;
    el.style.display = settings.overlay.enabled ? "block" : "none";
    const p = settings.overlay.position;
    el.style.top = p.startsWith("top") ? "20px" : "auto";
    el.style.bottom = p.startsWith("bottom") ? "20px" : "auto";
    el.style.left = p.endsWith("left") ? "20px" : "auto";
    el.style.right = p.endsWith("right") ? "20px" : "auto";
    const alpha = Math.round(settings.overlay.opacity * 2.55).toString(16).padStart(2, "0");
    Object.assign(el.style, {
      position: "fixed", zIndex: "2147483646",
      background: C.bg + alpha, border: `1px solid ${C.border}`,
      borderRadius: "8px", padding: "12px 16px",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      width: settings.overlay.width + "px",
      backdropFilter: "blur(12px)",
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  COMPARE — bouton sur la page PV + carte de résultat
  // ═══════════════════════════════════════════════════════════════════════════
  function escapeHTML(s) {
    return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function extractCurrentQuestionFromDOM() {
    const isDnd = document.querySelectorAll(SEL.dndSel).length > 0;
    if (isDnd) {
      const items = [...document.querySelectorAll(SEL.dndItem)]
        .map((el) => el.innerText.trim().replace(/\s+/g, " "))
        .filter((t) => t.length > 0);
      if (!items.length) return null;
      return { type: "dnd", text: items.join(" | "), items };
    }
    const words = [...document.querySelectorAll(SEL.word)].filter((w) => w.innerText.trim().length > 0);
    if (!words.length) return null;
    const s = words.map((w) => w.innerText.trim()).join(" ").replace(/\s+/g, " ").trim();
    return { type: "click", text: s };
  }

  function searchDumpForSentence(sentence) {
    if (!sentence) return null;
    const keys = Object.keys(dumpIndex);
    if (!keys.length) return null;
    const target = normText(sentence);
    if (!target || target.length < 2) return null;

    const mk = (s, mode) => ({ ex: { sentence: s, ...dumpIndex[s] }, mode });

    // 1) exact normalisé
    for (const s of keys) {
      if (normText(s) === target) return mk(s, "exact");
    }
    // 2) substring
    for (const s of keys) {
      const n = normText(s);
      if (!n) continue;
      if (n.includes(target) || target.includes(n)) return mk(s, "substring");
    }
    // 3) regex sur 4–6 mots significatifs
    const words = target.split(/\s+/).filter((w) => w.length >= 3).slice(0, 6);
    if (words.length >= 2) {
      const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      try {
        const re = new RegExp(escaped.join(".{0,40}?"), "i");
        for (const s of keys) {
          if (re.test(normText(s))) return mk(s, "regex");
        }
      } catch {}
    }
    // 4) score par mots communs
    const sw = new Set(words);
    if (sw.size >= 2) {
      let best = null, bs = 0;
      for (const s of keys) {
        const nw = normText(s).split(/\s+/);
        if (nw.length < 2) continue;
        const score = nw.filter((w) => sw.has(w)).length / nw.length;
        if (score > bs && score >= 0.6) { bs = score; best = s; }
      }
      if (best) return mk(best, "fuzzy");
    }
    return null;
  }

  function renderCompareCardContent(current, found) {
    const header = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${PV.textDim};font-weight:700;">Compare KAETS</div>
        <div id="kv9-cmp-close" style="cursor:pointer;color:${PV.textDim};font-size:18px;line-height:1;padding:0 4px;">×</div>
      </div>
    `;
    const phrase = `
      <div style="font-size:11px;color:${PV.textDim};margin-bottom:4px;">Question détectée</div>
      <div style="background:${PV.bgSoft};border:1px solid ${PV.border};border-radius:8px;padding:8px 10px;margin-bottom:12px;color:${PV.text};">
        ${escapeHTML((current?.text || "").slice(0, 240))}
      </div>
    `;
    if (!found) {
      return header + phrase + `<div style="color:${PV.textDim};font-style:italic;">Aucune correspondance trouvée dans la base.</div>`;
    }
    const ex = found.ex;
    const answers = Array.isArray(ex.answers) ? ex.answers : [];
    const noFault = ex.type === "click" && answers.length === 0;
    const ansHTML = noFault
      ? `<div style="color:${PV.accent};font-weight:700;">PAS DE FAUTE</div>`
      : answers.map((a) => `<div style="color:${PV.navy};font-weight:700;padding:4px 0;">« ${escapeHTML(a)} »</div>`).join("");
    const modeBadge = { exact: "exact", substring: "inclus", regex: "regex", fuzzy: "approché" }[found.mode] || found.mode;
    const typeBadge = ex.type === "dnd" ? "Drag & drop" : ex.type === "click" ? "Cliquer" : ex.type;
    return header + phrase + `
      <div style="font-size:11px;color:${PV.textDim};margin-bottom:4px;">Réponse trouvée</div>
      <div style="background:#f8fbff;border:1px solid ${PV.border};border-radius:8px;padding:10px 12px;">
        ${ansHTML}
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
          <span style="background:${PV.navy};color:#fff;font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;">${typeBadge}</span>
          <span style="background:${PV.bgSoft};color:${PV.navy};font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid ${PV.border};">match ${modeBadge}</span>
          ${ex.id ? `<span style="color:${PV.textDim};font-size:10px;padding:2px 4px;">#${escapeHTML(String(ex.id))}</span>` : ""}
        </div>
      </div>
    `;
  }

  function onCompareClick() {
    const card = document.getElementById("kv9-cmp-card");
    if (!card) return;
    if (card.style.display === "block") {
      card.style.opacity = "0";
      card.style.transform = "translateY(6px)";
      setTimeout(() => { card.style.display = "none"; }, 180);
      return;
    }
    const current = extractCurrentQuestionFromDOM();
    let content;
    if (!current) {
      content = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${PV.textDim};font-weight:700;">Compare KAETS</div>
          <div id="kv9-cmp-close" style="cursor:pointer;color:${PV.textDim};font-size:18px;line-height:1;padding:0 4px;">×</div>
        </div>
        <div style="color:${PV.textDim};">Aucune question détectée sur cette page.</div>
      `;
    } else if (!Object.keys(dumpIndex).length) {
      content = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${PV.textDim};font-weight:700;">Compare KAETS</div>
          <div id="kv9-cmp-close" style="cursor:pointer;color:${PV.textDim};font-size:18px;line-height:1;padding:0 4px;">×</div>
        </div>
        <div style="color:${PV.textDim};">Base locale vide. Ouvre le menu puis <b>Database → Recharger</b>.</div>
      `;
    } else {
      const found = searchDumpForSentence(current.text);
      content = renderCompareCardContent(current, found);
    }
    card.innerHTML = content;
    card.style.display = "block";
    requestAnimationFrame(() => {
      card.style.opacity = "1";
      card.style.transform = "translateY(0)";
    });
    document.getElementById("kv9-cmp-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      onCompareClick();
    });
  }

  function ensureCompareButton() {
    if (!settings.overlay.compare) {
      document.getElementById("kv9-cmp-btn")?.remove();
      document.getElementById("kv9-cmp-card")?.remove();
      return;
    }
    if (document.getElementById("kv9-cmp-btn")) return;

    const btn = document.createElement("button");
    btn.id = "kv9-cmp-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Comparer avec la base KAETS");
    btn.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${PV.accent};margin-right:8px;vertical-align:middle;"></span>Compare`;
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "24px", right: "24px",
      zIndex: "2147483640",
      background: PV.bg,
      color: PV.navy,
      border: `1px solid ${PV.border}`,
      borderRadius: "999px",
      padding: "10px 18px",
      fontFamily: "Inter, 'Helvetica Neue', Arial, sans-serif",
      fontSize: "13px",
      fontWeight: "600",
      letterSpacing: "0.2px",
      cursor: "pointer",
      boxShadow: "0 4px 14px rgba(11,51,96,0.12), 0 1px 3px rgba(0,0,0,0.05)",
      transition: "transform .15s ease, box-shadow .15s ease, background .15s ease",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.background = PV.bgSoft;
      btn.style.boxShadow = "0 6px 18px rgba(11,51,96,0.18), 0 2px 4px rgba(0,0,0,0.06)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = PV.bg;
      btn.style.boxShadow = "0 4px 14px rgba(11,51,96,0.12), 0 1px 3px rgba(0,0,0,0.05)";
    });
    btn.addEventListener("click", onCompareClick);
    document.body.appendChild(btn);

    const card = document.createElement("div");
    card.id = "kv9-cmp-card";
    Object.assign(card.style, {
      position: "fixed",
      bottom: "78px", right: "24px",
      zIndex: "2147483640",
      width: "320px",
      maxHeight: "60vh",
      overflowY: "auto",
      background: PV.bg,
      color: PV.text,
      border: `1px solid ${PV.border}`,
      borderRadius: "14px",
      padding: "14px 16px",
      boxShadow: "0 12px 32px rgba(11,51,96,0.18), 0 2px 6px rgba(0,0,0,0.06)",
      fontFamily: "Inter, 'Helvetica Neue', Arial, sans-serif",
      fontSize: "13px",
      lineHeight: "1.5",
      display: "none",
      transform: "translateY(6px)",
      opacity: "0",
      transition: "opacity .18s ease, transform .18s ease",
    });
    document.body.appendChild(card);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UI HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  const el = (tag, styles = {}, html = "") => { const e = document.createElement(tag); Object.assign(e.style, styles); if (html) e.innerHTML = html; return e; };
  const div = (styles = {}, html = "") => el("div", styles, html);

  function mkSection(title) {
    return div({
      padding: "6px 16px 4px", fontSize: "9px", color: C.textMuted,
      letterSpacing: "2.5px", textTransform: "uppercase", fontWeight: "600",
      background: C.bg, borderBottom: `1px solid ${C.border}22`,
    }, title);
  }

  function mkRow(label, right = "", color = C.text, onClick = null) {
    const row = div({
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 16px", borderBottom: `1px solid ${C.border}33`,
      cursor: onClick ? "pointer" : "default", transition: "background .15s",
    });
    row.addEventListener("mouseenter", () => (row.style.background = C.bgHover));
    row.addEventListener("mouseleave", () => (row.style.background = "transparent"));
    if (onClick) row.addEventListener("click", onClick);
    const l = div({ color, fontSize: "12px", fontWeight: "500" }); l.textContent = label;
    const r = div({ color: C.textDim, fontSize: "11px" }); r.innerHTML = right;
    row.append(l, r);
    return row;
  }

  function mkInfo(label, value, valueColor = C.accent) {
    const row = div({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", borderBottom: `1px solid ${C.border}22` });
    const l = div({ color: C.textDim, fontSize: "11px" }); l.textContent = label;
    const v = div({ color: valueColor, fontSize: "12px", fontWeight: "600", fontVariantNumeric: "tabular-nums" }); v.textContent = value;
    row.append(l, v);
    return row;
  }

  function mkToggle(label, isOn, onChange) {
    const row = div({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${C.border}33`, cursor: "pointer", transition: "background .15s" });
    row.addEventListener("mouseenter", () => (row.style.background = C.bgHover));
    row.addEventListener("mouseleave", () => (row.style.background = "transparent"));
    const l = div({ color: C.text, fontSize: "12px", fontWeight: "500" }); l.textContent = label;
    const sw = div({ width: "36px", height: "20px", borderRadius: "10px", background: isOn ? C.accent : C.border, position: "relative", transition: "background .2s", cursor: "pointer" });
    const knob = div({ width: "16px", height: "16px", borderRadius: "50%", background: "#fff", position: "absolute", top: "2px", left: isOn ? "18px" : "2px", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" });
    sw.appendChild(knob);
    row.append(l, sw);
    row.addEventListener("click", () => onChange(!isOn));
    return row;
  }

  function mkSlider(label, value, min, max, step, unit, onChange) {
    const wrap = div({ padding: "8px 16px", borderBottom: `1px solid ${C.border}22` });
    const top = div({ display: "flex", justifyContent: "space-between", marginBottom: "6px" });
    const l = div({ color: C.text, fontSize: "11px" }); l.textContent = label;
    const v = div({ color: C.accent, fontSize: "11px", fontWeight: "600", fontVariantNumeric: "tabular-nums" }); v.textContent = value + (unit || "");
    top.append(l, v);
    const inp = document.createElement("input");
    inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
    Object.assign(inp.style, { width: "100%", accentColor: C.accent, cursor: "pointer", height: "4px" });
    inp.addEventListener("input", () => { v.textContent = inp.value + (unit || ""); onChange(Number(inp.value)); });
    wrap.append(top, inp);
    return wrap;
  }

  function mkSelect(label, options, current, onChange) {
    const row = div({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", borderBottom: `1px solid ${C.border}22` });
    const l = div({ color: C.text, fontSize: "11px" }); l.textContent = label;
    const sel = document.createElement("select");
    Object.assign(sel.style, { background: C.bgCard, color: C.accent, border: `1px solid ${C.border}`, fontSize: "10px", padding: "3px 6px", borderRadius: "4px", cursor: "pointer" });
    for (const [val, lbl] of options) {
      const o = document.createElement("option"); o.value = val; o.textContent = lbl;
      if (val === current) o.selected = true; sel.appendChild(o);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    row.append(l, sel);
    return row;
  }

  function mkColor(label, value, onChange) {
    const row = div({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", borderBottom: `1px solid ${C.border}22` });
    const l = div({ color: C.text, fontSize: "11px" }); l.textContent = label;
    const inp = document.createElement("input"); inp.type = "color"; inp.value = value;
    Object.assign(inp.style, { border: "none", background: "none", cursor: "pointer", width: "32px", height: "22px" });
    inp.addEventListener("input", () => onChange(inp.value));
    row.append(l, inp);
    return row;
  }

  function mkBtn(label, color = C.accent, onClick = null) {
    const btn = div({ padding: "9px 16px", margin: "8px 16px", borderRadius: "6px", background: color + "22", border: `1px solid ${color}44`, color, fontSize: "11px", fontWeight: "600", textAlign: "center", cursor: "pointer", transition: "all .15s" });
    btn.textContent = label;
    btn.addEventListener("mouseenter", () => { btn.style.background = color + "33"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = color + "22"; });
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PAGES
  // ═══════════════════════════════════════════════════════════════════════════
  const PAGES = [
    { id: "autoanswer", label: "AutoAnswer", icon: "⚡" },
    { id: "silent", label: "Silent Mode", icon: "👁" },
    { id: "overlay", label: "Overlay", icon: "◫" },
    { id: "database", label: "Database", icon: "▦" },
    { id: "levels", label: "Niveau", icon: "≡" },
  ];

  function navigate(page) { state.pageHistory.push(state.page); state.page = page; renderPage(); }
  function goBack() { state.page = state.pageHistory.pop() || "home"; renderPage(); }

  function renderPage() {
    const c = document.getElementById("kv9-content");
    if (!c) return;
    c.innerHTML = "";

    const page = state.page;
    const subtitle = document.getElementById("kv9-subtitle");
    if (subtitle) subtitle.textContent = page === "home" ? "INSERT pour ouvrir/fermer" : page.toUpperCase();

    if (page !== "home") c.appendChild(mkRow("← Retour", "", C.accent, goBack));

    if (page === "home") return renderHome(c);
    if (page === "autoanswer") return renderAutoAnswer(c);
    if (page === "silent") return renderSilent(c);
    if (page === "overlay") return renderOverlay(c);
    if (page === "database") return renderDatabase(c);
    if (page === "levels") return renderLevels(c);
  }

  // ─── HOME ───────────────────────────────────────────────────────────────────
  function renderHome(c) {
    const statusRow = div({ padding: "10px 16px 6px", display: "flex", gap: "6px", flexWrap: "wrap" });
    const mkBadge = (label, on, color) => {
      const b = div({
        padding: "3px 8px", borderRadius: "4px", fontSize: "9px", fontWeight: "600",
        letterSpacing: "0.5px",
        background: on ? color + "22" : C.bgCard, color: on ? color : C.textMuted,
        border: `1px solid ${on ? color + "44" : C.border}33`,
      });
      b.textContent = label;
      return b;
    };
    statusRow.append(
      mkBadge("AA", settings.autoAnswer.enabled, C.success),
      mkBadge("SILENT", settings.silent.enabled, C.accent),
      mkBadge("OV", settings.overlay.enabled, C.warn),
      mkBadge("CMP", settings.overlay.compare, PV.accent),
      mkBadge(`${dumpMeta.exercises} db`, dumpMeta.present, C.accentBright),
      mkBadge(`${Object.keys(index).length} idx`, Object.keys(index).length > 0, C.accentBright),
    );
    c.appendChild(statusRow);

    if (state.lastAnswer !== "—") {
      c.appendChild(mkSection("Dernière réponse"));
      const ansDiv = div({ padding: "8px 16px", color: C.accent, fontSize: "13px", fontWeight: "600", wordBreak: "break-word" });
      ansDiv.textContent = state.lastAnswer;
      c.appendChild(ansDiv);
    }

    c.appendChild(mkSection("Modules"));
    for (const p of PAGES) {
      let badge = "›";
      if (p.id === "autoanswer" && settings.autoAnswer.enabled) badge = `<span style="color:${C.success};font-size:10px;">ON</span>`;
      else if (p.id === "silent" && settings.silent.enabled) badge = `<span style="color:${C.accent};font-size:10px;">ON</span>`;
      c.appendChild(mkRow(`${p.icon}  ${p.label}`, badge, C.text, () => navigate(p.id)));
    }
  }

  // ─── AUTOANSWER ─────────────────────────────────────────────────────────────
  function renderAutoAnswer(c) {
    c.appendChild(mkSection("Moteur"));
    c.appendChild(mkToggle("AutoAnswer", settings.autoAnswer.enabled, (v) => {
      settings.autoAnswer.enabled = v;
      if (v) settings.silent.enabled = false;
      saveSettings(); renderPage();
    }));
    c.appendChild(mkToggle("Question suivante automatique", settings.autoAnswer.autoNext, (v) => { settings.autoAnswer.autoNext = v; saveSettings(); renderPage(); }));

    c.appendChild(mkSection("Vitesse"));
    c.appendChild(mkSlider("Délai", settings.autoAnswer.delay, 10, 2000, 10, "ms", (v) => { settings.autoAnswer.delay = v; saveSettings(); }));

    const presets = div({ padding: "8px 16px", display: "flex", gap: "6px" });
    const speeds = [["Instant", 10], ["Rapide", 80], ["Normal", 300], ["Lent", 1000]];
    for (const [label, ms] of speeds) {
      const active = settings.autoAnswer.delay === ms;
      const btn = div({ padding: "4px 10px", borderRadius: "4px", fontSize: "10px", fontWeight: "500", background: active ? C.accent + "33" : C.bgCard, color: active ? C.accent : C.textDim, border: `1px solid ${active ? C.accent + "55" : C.border}44`, cursor: "pointer", transition: "all .15s" });
      btn.textContent = label;
      btn.addEventListener("click", () => { settings.autoAnswer.delay = ms; saveSettings(); renderPage(); });
      presets.appendChild(btn);
    }
    c.appendChild(presets);

    c.appendChild(mkSection("Info"));
    const info = div({ padding: "8px 16px", color: C.textMuted, fontSize: "10px", lineHeight: "1.5" });
    info.textContent = "Clique automatiquement la bonne réponse ou 'Pas de faute'. Désactive le mode Silent. Raccourci clavier : F9.";
    c.appendChild(info);
  }

  // ─── SILENT ─────────────────────────────────────────────────────────────────
  function renderSilent(c) {
    c.appendChild(mkSection("Mode"));
    c.appendChild(mkToggle("Silent", settings.silent.enabled, (v) => {
      settings.silent.enabled = v;
      if (v) settings.autoAnswer.enabled = false;
      saveSettings(); renderPage();
    }));
    const desc = div({ padding: "8px 16px", color: C.textMuted, fontSize: "10px", lineHeight: "1.5" });
    desc.textContent = "Souligne la bonne réponse discrètement, sans cliquer.";
    c.appendChild(desc);

    c.appendChild(mkSection("Style"));
    c.appendChild(mkColor("Couleur", settings.silent.color, (v) => { settings.silent.color = v; saveSettings(); }));
    c.appendChild(mkSlider("Épaisseur", settings.silent.thickness, 1, 6, 1, "px", (v) => { settings.silent.thickness = v; saveSettings(); }));
    c.appendChild(mkSlider("Décalage", settings.silent.offset, 0, 10, 1, "px", (v) => { settings.silent.offset = v; saveSettings(); }));
    c.appendChild(mkSelect("Style de ligne", [
      ["solid", "Plein"], ["dashed", "Tirets"], ["dotted", "Pointillés"], ["wavy", "Ondulé"], ["double", "Double"],
    ], settings.silent.style, (v) => { settings.silent.style = v; saveSettings(); }));

    c.appendChild(mkSection("Aperçu"));
    const preview = div({ padding: "12px 16px", textAlign: "center" });
    const word = div({ display: "inline", fontSize: "18px", fontWeight: "600", color: "#fff", fontFamily: "serif" });
    word.textContent = "Exemple";
    word.style.textDecoration = `underline ${settings.silent.style} ${settings.silent.color} ${settings.silent.thickness}px`;
    word.style.textUnderlineOffset = settings.silent.offset + "px";
    preview.appendChild(word);
    c.appendChild(preview);
  }

  // ─── OVERLAY (avec COMPARE) ────────────────────────────────────────────────
  function renderOverlay(c) {
    c.appendChild(mkSection("Affichage"));
    c.appendChild(mkToggle("Afficher l'overlay", settings.overlay.enabled, (v) => { settings.overlay.enabled = v; saveSettings(); applyOverlay(); renderPage(); }));
    c.appendChild(mkSelect("Position", [
      ["bottom-left", "Bas gauche"], ["bottom-right", "Bas droite"],
      ["top-left", "Haut gauche"], ["top-right", "Haut droite"],
    ], settings.overlay.position, (v) => { settings.overlay.position = v; saveSettings(); applyOverlay(); }));

    c.appendChild(mkSection("Apparence"));
    c.appendChild(mkSlider("Opacité", settings.overlay.opacity, 10, 100, 5, "%", (v) => { settings.overlay.opacity = v; saveSettings(); applyOverlay(); }));
    c.appendChild(mkSlider("Taille texte", settings.overlay.fontSize, 10, 24, 1, "px", (v) => { settings.overlay.fontSize = v; saveSettings(); applyOverlay(); }));
    c.appendChild(mkSlider("Largeur", settings.overlay.width, 180, 500, 10, "px", (v) => { settings.overlay.width = v; saveSettings(); applyOverlay(); }));

    c.appendChild(mkSection("Compare"));
    c.appendChild(mkToggle("Afficher le bouton Compare sur la page", settings.overlay.compare, (v) => {
      settings.overlay.compare = v;
      saveSettings();
      ensureCompareButton();
      renderPage();
    }));
    const cmpDesc = div({ padding: "8px 16px", color: C.textMuted, fontSize: "10px", lineHeight: "1.5" });
    cmpDesc.innerHTML = `Ajoute un bouton discret sur la page Projet Voltaire. Au clic, la question affichée est recherchée dans la base locale (regex) et la réponse apparaît dans une carte. <span style="color:${C.textDim}">Indépendant de l'Overlay.</span>`;
    c.appendChild(cmpDesc);
    c.appendChild(mkInfo("Base locale", dumpMeta.present ? `${dumpMeta.exercises} exercices` : "absente", dumpMeta.present ? C.success : C.error));

    c.appendChild(mkBtn("Réinitialiser l'overlay", C.warn, () => {
      settings.overlay = structuredClone(DEFAULTS.overlay);
      saveSettings(); applyOverlay(); ensureCompareButton(); renderPage();
    }));
  }

  // ─── DATABASE ───────────────────────────────────────────────────────────────
  function renderDatabase(c) {
    c.appendChild(mkSection("Base locale"));
    c.appendChild(mkInfo("Statut", dumpMeta.present ? "chargée" : "absente", dumpMeta.present ? C.success : C.error));
    c.appendChild(mkInfo("Exercices", String(dumpMeta.exercises), C.accentBright));

    c.appendChild(mkSection("Index live (XHR/fetch PV)"));
    c.appendChild(mkInfo("Entrées", String(Object.keys(index).length)));
    c.appendChild(mkInfo("Niveau courant", levelMeta.title));

    c.appendChild(mkSection("Actions"));
    const dlStatus = div({ padding: "4px 16px", fontSize: "10.5px", color: C.textDim, minHeight: "16px" });
    c.appendChild(mkBtn("Recharger depuis le serveur", C.accent, async () => {
      dlStatus.textContent = "Téléchargement…"; dlStatus.style.color = C.warn;
      const res = await fetchDump();
      if (res.ok) { dlStatus.textContent = `OK — ${res.exercises} exercices stockés.`; dlStatus.style.color = C.success; renderPage(); }
      else { dlStatus.textContent = "Échec : " + (res.error || "?"); dlStatus.style.color = C.error; }
    }));
    c.appendChild(dlStatus);
    c.appendChild(mkBtn("Supprimer la base locale", C.error, () => {
      if (!confirm("Supprimer la base locale (elle sera retéléchargée à la prochaine connexion) ?")) return;
      clearDump();
      renderPage();
    }));

    const note = div({ padding: "10px 16px", color: C.textMuted, fontSize: "10px", lineHeight: "1.5" });
    note.textContent = "La base est téléchargée depuis le serveur à la connexion et stockée dans localStorage. Elle sert de fallback à l'index live et est utilisée par la fonction Compare.";
    c.appendChild(note);
  }

  // ─── LEVELS ────────────────────────────────────────────────────────────────
  function renderLevels(c) {
    c.appendChild(mkSection("Niveau courant"));
    c.appendChild(mkInfo("Titre", levelMeta.title));
    c.appendChild(mkInfo("Règles", String(levelMeta.rules)));
    c.appendChild(mkInfo("Exercices", String(levelMeta.exercises)));
    c.appendChild(mkInfo("Indexé total", String(Object.keys(index).length)));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  POPUP REMERCIEMENT + TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  function isPopupDismissed() { return localStorage.getItem(LS.popupDismissed) === "1"; }
  function setPopupDismissedFlag() { localStorage.setItem(LS.popupDismissed, "1"); }
  function wasPopupShown() { return localStorage.getItem(LS.popupShown) === "1"; }
  function setPopupShownFlag() { localStorage.setItem(LS.popupShown, "1"); }
  function isPopupOpen() { return !!document.getElementById("kv9-popup-overlay"); }

  // Consomme ?kaets_dismissed=1 transmis depuis la gate GitHub
  function checkDismissalParam() {
    try {
      const url = new URL(location.href);
      if (url.searchParams.get("kaets_dismissed") === "1") {
        setPopupDismissedFlag();
        url.searchParams.delete("kaets_dismissed");
        history.replaceState({}, "", url.toString());
        console.log("[KAETS] popup dismissed (token URL)");
      }
    } catch {}
  }

  async function testBackend() {
    try {
      const r = await fetch(BACKEND_URL + "/health", { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { ok: false, msg: `HTTP ${r.status}` };
      const d = await r.json();
      return { ok: !!d.dump_present, msg: `Backend OK · ${d.dump_exercises || 0} exos` };
    } catch (e) {
      return { ok: false, msg: "Backend injoignable" };
    }
  }

  function testClient() {
    const lsOk = (() => { try { localStorage.setItem("_kt", "1"); localStorage.removeItem("_kt"); return true; } catch { return false; } })();
    const cryptoOk = typeof crypto !== "undefined" && !!crypto.subtle;
    const tmOk = typeof GM_info !== "undefined" || /Tampermonkey|Violentmonkey|Greasemonkey/i.test(navigator.userAgent);
    const fetchOk = typeof fetch === "function";
    const items = [
      { name: `KAETS Menu v${VERSION}`, ok: true },
      { name: "localStorage", ok: lsOk },
      { name: "WebCrypto (AES)", ok: cryptoOk },
      { name: "Gestionnaire userscript", ok: tmOk },
      { name: "fetch()", ok: fetchOk },
      { name: `Index live (${Object.keys(index).length})`, ok: true },
      { name: `Base dump (${dumpMeta.exercises})`, ok: dumpMeta.present },
    ];
    return { ok: items.every((i) => i.ok), items };
  }

  function closeThankYouPopup() {
    const ov = document.getElementById("kv9-popup-overlay");
    if (!ov) return;
    if (ov._kaetsWatchInterval) clearInterval(ov._kaetsWatchInterval);
    if (ov._kaetsMsgListener) window.removeEventListener("message", ov._kaetsMsgListener);
    ov.remove();
  }

  function buildThankYouPopup() {
    if (document.getElementById("kv9-popup-overlay")) return;

    const ov = div({
      position: "fixed", inset: "0", zIndex: "2147483646",
      background: "rgba(0,0,0,0.25)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      animation: "kv9-fadein .2s ease-out",
    });
    ov.id = "kv9-popup-overlay";

    const card = div({
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: "16px",
      boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px ${C.accent}33`,
      padding: "28px 26px 22px", width: "min(420px, 92vw)", maxHeight: "92vh", overflowY: "auto",
      color: C.text, position: "relative",
    });

    // Bouton X pour fermer
    const closeBtn = div({
      position: "absolute", top: "10px", right: "12px",
      width: "26px", height: "26px", borderRadius: "50%",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", color: C.textMuted, fontSize: "20px", fontWeight: "300",
      transition: "all .15s", lineHeight: "1",
    });
    closeBtn.textContent = "×";
    closeBtn.addEventListener("mouseenter", () => { closeBtn.style.color = C.text; closeBtn.style.background = C.bgHover; });
    closeBtn.addEventListener("mouseleave", () => { closeBtn.style.color = C.textMuted; closeBtn.style.background = "transparent"; });
    closeBtn.addEventListener("click", closeThankYouPopup);
    card.appendChild(closeBtn);

    const header = div({ textAlign: "center", marginBottom: "18px" });
    header.innerHTML = `
      <div style="font-size:34px;margin-bottom:6px;">💜</div>
      <h2 style="margin:0 0 6px;font-size:18px;color:${C.accentBright};letter-spacing:3px;font-weight:800;">MERCI !</h2>
      <p style="margin:0;color:${C.textDim};font-size:11.5px;line-height:1.6;">
        Merci d'utiliser <b style="color:${C.text};">KAETS Menu</b>.<br>
        Teste ta config et soutiens le projet pour débloquer l'accès.
      </p>
    `;
    card.appendChild(header);

    // État de progression des 3 étapes
    const steps = { backend: false, client: false, star: false };

    // Indicateur des 3 étapes
    const checks = div({
      display: "flex", justifyContent: "space-around", gap: "6px",
      margin: "0 0 14px", padding: "10px 8px",
      borderRadius: "8px", background: C.bgCard, border: `1px solid ${C.border}44`,
      fontSize: "10px", letterSpacing: "1px",
    });
    const mkCheck = (id, label) => {
      const c = div({
        flex: "1", textAlign: "center", color: C.textMuted,
        transition: "color .25s",
      });
      c.id = "kv9-step-" + id;
      c.innerHTML = `<div style="font-size:18px;margin-bottom:3px;">○</div><div>${label}</div>`;
      return c;
    };
    checks.append(mkCheck("backend", "BACKEND"), mkCheck("client", "CLIENT"), mkCheck("star", "STAR"));
    card.appendChild(checks);

    const markStep = (id, ok) => {
      steps[id] = ok;
      const c = document.getElementById("kv9-step-" + id);
      if (!c) return;
      c.style.color = ok ? C.success : C.textMuted;
      c.firstElementChild.textContent = ok ? "✓" : "○";
      maybeShowFinalState();
    };

    const status = div({
      minHeight: "32px", marginBottom: "12px",
      padding: "8px 12px", borderRadius: "8px",
      background: C.bgCard, border: `1px solid ${C.border}44`,
      fontSize: "11px", color: C.textDim, lineHeight: "1.7",
      fontFamily: "'JetBrains Mono', monospace",
    });
    status.id = "kv9-popup-status";
    status.textContent = "Prêt.";
    card.appendChild(status);

    const setStatus = (html, color = C.textDim) => {
      status.innerHTML = html;
      status.style.color = color;
    };

    const btnRow = div({ display: "flex", flexDirection: "column", gap: "8px" });

    const mkBtn = (label, color, onClick) => {
      const b = div({
        padding: "11px 14px", borderRadius: "8px",
        background: color + "1a", border: `1px solid ${color}55`, color,
        fontSize: "12px", fontWeight: "700", textAlign: "center", cursor: "pointer",
        letterSpacing: "0.5px", transition: "all .15s",
      });
      b.innerHTML = label;
      b.addEventListener("mouseenter", () => { b.style.background = color + "2a"; b.style.borderColor = color + "88"; });
      b.addEventListener("mouseleave", () => { b.style.background = color + "1a"; b.style.borderColor = color + "55"; });
      b.addEventListener("click", onClick);
      return b;
    };

    btnRow.appendChild(mkBtn("🐳  Tester le serveur backend", C.accent, async () => {
      setStatus("Vérification du backend…", C.warn);
      const r = await testBackend();
      setStatus(r.msg, r.ok ? C.success : C.error);
      markStep("backend", r.ok);
    }));

    btnRow.appendChild(mkBtn("⚙  Tester le client", C.accentBright, () => {
      const r = testClient();
      const lines = r.items.map((i) =>
        `<span style="color:${i.ok ? C.success : C.error};">${i.ok ? "✓" : "✗"}</span> ${i.name}`
      ).join("<br>");
      setStatus(lines, r.ok ? C.success : C.warn);
      markStep("client", r.ok);
    }));

    btnRow.appendChild(mkBtn("⭐  Star sur GitHub", PV.accent, () => {
      // PAS de "noopener" : on a besoin du opener pour recevoir le postMessage de la gate.
      window.open(GITHUB_REPO_URL, "_blank");
      setStatus("Onglet GitHub ouvert. Star le dépôt puis clique « LET'S CHEAT ».", C.textDim);
    }));

    card.appendChild(btnRow);

    // Zone d'état final (cachée tant que toutes les étapes ne sont pas validées)
    const finalRow = div({
      display: "none", marginTop: "12px",
      padding: "10px 14px", borderRadius: "10px",
      background: C.success + "1a", border: `1px solid ${C.success}55`,
      color: C.success, fontSize: "12px", fontWeight: "700",
      textAlign: "center", letterSpacing: "1px",
      animation: "kv9-fadein .25s ease-out",
    });
    finalRow.id = "kv9-popup-final";
    finalRow.textContent = "🎉  TOUT EST OK — Profite bien !";
    card.appendChild(finalRow);

    function maybeShowFinalState() {
      if (steps.backend && steps.client && steps.star) {
        finalRow.style.display = "block";
        setStatus("Toutes les étapes sont validées.", C.success);
      }
    }

    // Watcher : détecte le passage par la gate GitHub (flag posé par Let's Cheat)
    const watch = setInterval(() => {
      if (isPopupDismissed() && !steps.star) markStep("star", true);
    }, 800);
    ov._kaetsWatchInterval = watch;

    // Listener postMessage : la gate GitHub envoie un message au moment du LET'S CHEAT
    // → fonctionne cross-origin même si la redirection finale tombe sur un autre sous-domaine.
    const onMsg = (e) => {
      if (e.origin !== "https://github.com") return;
      if (e.data && e.data.kaets_dismissed === 1) {
        setPopupDismissedFlag();
        markStep("star", true);
      }
    };
    window.addEventListener("message", onMsg);
    ov._kaetsMsgListener = onMsg;

    ov.appendChild(card);
    document.body.appendChild(ov);
  }

  function maybeShowPopup() {
    if (wasPopupShown()) return false;
    setPopupShownFlag();
    buildThankYouPopup();
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  GATE GITHUB — bloque la page tant que le repo n'est pas starré
  // ═══════════════════════════════════════════════════════════════════════════
  function isOnGitHubRepo() {
    return location.hostname === "github.com" &&
      location.pathname.toLowerCase().startsWith(GITHUB_REPO_PATH.toLowerCase());
  }

  function isRepoStarred() {
    // Méthode fiable : présence d'un form qui POSTe vers /unstar
    for (const f of document.querySelectorAll("form")) {
      const a = f.getAttribute("action") || "";
      if (/\/unstar(\/|\?|$)/.test(a)) return true;
    }
    if (document.querySelector('[aria-label^="Unstar"]')) return true;
    if (document.querySelector('[aria-label*="Unstar this"]')) return true;
    return false;
  }

  function findGitHubStarBtn() {
    // 1) Forms qui POSTent vers /star ou /unstar — sélecteur le plus stable
    for (const f of document.querySelectorAll("form")) {
      const a = f.getAttribute("action") || "";
      if (/\/(un)?star(\/|\?|$)/.test(a)) {
        const btn = f.querySelector('button[type="submit"]') || f.querySelector("button");
        if (btn && btn.offsetParent !== null) return btn;
      }
    }
    // 2) Fallback : aria-label / data-attributes
    const candidates = [
      'button[aria-label^="Star "]',
      'button[aria-label^="Unstar"]',
      'button[aria-label*="Star this"]',
      'button[data-hydro-click*="STAR_BUTTON"]',
      'button.starring-container__container-button',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  // Layout des 4 bandes qui couvrent tout sauf la zone du bouton Star.
  // La page reste en place, le bouton GitHub natif reste cliquable.
  function layoutGateStrips(star) {
    if (!star) return;
    const r = star.getBoundingClientRect();
    const m = 24; // marge généreuse autour du bouton
    const vw = window.innerWidth, vh = window.innerHeight;
    const top = Math.max(0, r.top - m);
    const bottom = Math.min(vh, r.bottom + m);
    const left = Math.max(0, r.left - m);
    const right = Math.min(vw, r.right + m);

    const set = (id, css) => {
      const el = document.getElementById(id);
      if (!el) return;
      Object.assign(el.style, css);
    };
    set("kv9-strip-top", { top: "0px", left: "0px", width: vw + "px", height: top + "px" });
    set("kv9-strip-bot", { top: bottom + "px", left: "0px", width: vw + "px", height: Math.max(0, vh - bottom) + "px" });
    set("kv9-strip-l",   { top: top + "px", left: "0px", width: left + "px", height: (bottom - top) + "px" });
    set("kv9-strip-r",   { top: top + "px", left: right + "px", width: Math.max(0, vw - right) + "px", height: (bottom - top) + "px" });

    // Halo autour du bouton
    const halo = document.getElementById("kv9-strip-halo");
    if (halo) {
      Object.assign(halo.style, {
        top: (r.top - 4) + "px",
        left: (r.left - 4) + "px",
        width: (r.width + 8) + "px",
        height: (r.height + 8) + "px",
      });
    }
  }

  // Décide vers quelle URL rediriger après le Let's Cheat
  async function postStarRedirect() {
    // 1) Pose le flag localement sur github.com → la gate ne réapparaît plus
    //    quand l'utilisateur revient sur le repo.
    setPopupDismissedFlag();
    // 2) Notifie l'onglet d'origine (popup PV) via postMessage — cross-origin OK.
    try { window.opener?.postMessage({ kaets_dismissed: 1 }, "*"); } catch {}
    // 3) Token URL → le flag est aussi posé sur le domaine PV de destination.
    const dismissed = (u) => u + (u.includes("?") ? "&" : "?") + "kaets_dismissed=1";
    try {
      const r = await fetch(PV_TARGET_URL, {
        method: "HEAD",
        credentials: "include",
        mode: "cors",
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        window.location.href = dismissed(PV_TARGET_URL);
        return;
      }
    } catch {}
    window.location.href = dismissed(PV_LOGIN_URL);
  }

  function buildGitHubGate() {
    if (document.getElementById("kv9-gh-gate")) return;

    const star = findGitHubStarBtn();
    if (!star) {
      // Pas encore trouvé (DOM pas prêt) — retry sous peu, sans rien bloquer.
      setTimeout(buildGitHubGate, 400);
      return;
    }

    // Scroll vers le bouton s'il est hors viewport
    try {
      const r = star.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) {
        star.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch {}

    // Bloque scroll de la page
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    // Container racine
    const ov = div({
      position: "fixed", inset: "0", zIndex: "2147483640",
      pointerEvents: "none",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      color: C.text,
    });
    ov.id = "kv9-gh-gate";

    // 4 bandes qui couvrent tout sauf la zone du bouton
    const stripCss = {
      position: "fixed",
      background: "rgba(10,12,16,0.65)",
      backdropFilter: "blur(8px) grayscale(0.4)",
      WebkitBackdropFilter: "blur(8px) grayscale(0.4)",
      pointerEvents: "auto",  // bloque les clics sous la bande
    };
    ["top", "bot", "l", "r"].forEach((side) => {
      const s = div(stripCss);
      s.id = "kv9-strip-" + side;
      s.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
      s.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
      ov.appendChild(s);
    });

    // Halo (visuel uniquement)
    const halo = div({
      position: "fixed", pointerEvents: "none", zIndex: "2147483639",
      borderRadius: "10px",
      boxShadow: `0 0 0 4px ${PV.accent}, 0 0 36px 12px ${PV.accent}cc, 0 0 120px 30px ${PV.accent}55`,
      transition: "all .2s ease",
    });
    halo.id = "kv9-strip-halo";
    ov.appendChild(halo);

    const card = div({
      position: "fixed", bottom: "30px", left: "50%", transform: "translateX(-50%)",
      zIndex: "2147483641",
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: "16px",
      boxShadow: `0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px ${C.accent}66`,
      padding: "24px 24px 20px", width: "min(460px, 92vw)", textAlign: "center",
      pointerEvents: "auto",
    });
    card.innerHTML = `
      <div style="font-size:42px;margin-bottom:4px;animation:kv9-pulse 2s ease-in-out infinite;">⭐</div>
      <h2 style="margin:0 0 8px;font-size:17px;letter-spacing:3px;color:${C.accentBright};font-weight:800;">SOUTIENS LE PROJET</h2>
      <p style="margin:0 0 14px;color:${C.textDim};font-size:12px;line-height:1.6;">
        Clique sur le vrai bouton <b style="color:${PV.accent};">Star ⭐</b> de GitHub
        <span style="color:${C.textMuted};">(entouré en jaune)</span> pour débloquer le menu.<br>
        <span style="color:${C.textMuted};font-size:10.5px;">Tu dois être connecté à GitHub.</span>
      </p>
    `;

    const status = div({
      marginBottom: "14px", padding: "9px 12px",
      borderRadius: "8px", background: C.bgCard, border: `1px solid ${C.border}44`,
      fontSize: "11px", color: C.warn, letterSpacing: "0.3px",
    });
    status.id = "kv9-gate-status";
    status.textContent = "⏳ En attente du ⭐ officiel…";
    card.appendChild(status);

    const btnCheat = div({
      padding: "13px 18px", borderRadius: "10px",
      background: C.bgCard, border: `1px solid ${C.border}`, color: C.textMuted,
      fontSize: "13px", fontWeight: "800", textAlign: "center",
      letterSpacing: "2px", transition: "all .25s", opacity: "0.45",
      cursor: "not-allowed", userSelect: "none",
    });
    btnCheat.id = "kv9-gate-cheat";
    btnCheat.textContent = "🔒  LET'S CHEAT";
    card.appendChild(btnCheat);

    ov.appendChild(card);
    document.body.appendChild(ov);

    // Layout initial + handlers de resize/scroll
    layoutGateStrips(star);
    const relayout = () => layoutGateStrips(findGitHubStarBtn() || star);
    window.addEventListener("resize", relayout);
    window.addEventListener("scroll", relayout, true);

    // Hook click sur le bouton Star → ouvre les strips pendant 4s + cooldown
    function attachStarClickHandler(btn) {
      if (!btn || btn._kaetsClickHooked) return;
      btn._kaetsClickHooked = true;
      btn.addEventListener("click", () => {
        // Libère temporairement les strips pour ne pas gêner les confirmations GitHub
        ["kv9-strip-top", "kv9-strip-bot", "kv9-strip-l", "kv9-strip-r"].forEach((id) => {
          const s = document.getElementById(id);
          if (s) s.style.pointerEvents = "none";
        });
        let remaining = 4;
        status.style.color = C.warn;
        status.textContent = `⏳ Star envoyée — vérification dans ${remaining}s…`;
        const cd = setInterval(() => {
          remaining--;
          if (remaining > 0) {
            status.textContent = `⏳ Vérification dans ${remaining}s…`;
          } else {
            clearInterval(cd);
            // Restaure le blocage des strips
            ["kv9-strip-top", "kv9-strip-bot", "kv9-strip-l", "kv9-strip-r"].forEach((id) => {
              const s = document.getElementById(id);
              if (s) s.style.pointerEvents = "auto";
            });
            // Le poll prendra le relais pour détecter isRepoStarred()
          }
        }, 1000);
      }, { capture: true });
    }
    attachStarClickHandler(star);

    // Polling : détecte le star posé via le vrai bouton GitHub + re-layout
    const poll = setInterval(() => {
      relayout();
      attachStarClickHandler(findGitHubStarBtn()); // re-hook si GitHub a re-rendu
      if (isRepoStarred()) {
        clearInterval(poll);
        status.style.color = C.success;
        status.innerHTML = "✓ Star détectée — accès débloqué !";
        btnCheat.style.opacity = "1";
        btnCheat.style.cursor = "pointer";
        btnCheat.style.background = C.accent + "22";
        btnCheat.style.borderColor = C.accent;
        btnCheat.style.color = C.accent;
        btnCheat.style.pointerEvents = "auto";
        btnCheat.textContent = "⚡  LET'S CHEAT";
        btnCheat.onmouseenter = () => { btnCheat.style.background = C.accent + "33"; };
        btnCheat.onmouseleave = () => { btnCheat.style.background = C.accent + "22"; };
        btnCheat.onclick = () => {
          status.style.color = C.warn;
          status.textContent = "Vérification de ta session Projet Voltaire…";
          btnCheat.style.opacity = "0.6";
          btnCheat.style.pointerEvents = "none";
          postStarRedirect();
        };
      }
    }, 800);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONSTRUCTION DE L'UI
  // ═══════════════════════════════════════════════════════════════════════════
  function buildUI() {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes kv9-gradient { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
      @keyframes kv9-pulse { 0%,100%{opacity:.6} 50%{opacity:1} }
      @keyframes kv9-fadein { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
      #kv9-menu { animation: kv9-fadein .2s ease-out; }
      #kv9-menu::-webkit-scrollbar { width: 4px; }
      #kv9-menu::-webkit-scrollbar-track { background: transparent; }
      #kv9-menu::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
      #kv9-content::-webkit-scrollbar { width: 3px; }
      #kv9-content::-webkit-scrollbar-track { background: transparent; }
      #kv9-content::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
      .kv9-letter { display:inline-block; animation: kv9-pulse 2s ease-in-out infinite; }
    `;
    document.head.appendChild(style);

    const menu = div({
      display: "none", position: "fixed", top: "40px", left: "40px",
      zIndex: "2147483647", width: "300px",
      background: C.bg, border: `1px solid ${C.border}`,
      borderRadius: "12px", overflow: "hidden",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      boxShadow: `0 8px 32px rgba(0,0,0,.5), 0 0 1px ${C.accent}55`,
    });
    menu.id = "kv9-menu";

    const header = div({
      background: `linear-gradient(135deg, ${C.bg}, #1a0a2e, ${C.bg})`,
      backgroundSize: "200% 200%",
      animation: "kv9-gradient 6s ease infinite",
      padding: "14px 16px 10px", textAlign: "center",
      borderBottom: `1px solid ${C.border}44`,
      position: "relative", overflow: "hidden",
    });
    const brandText = BRAND.split("").map((ch, i) => {
      const delay = (i * 0.15).toFixed(2);
      return `<span class="kv9-letter" style="animation-delay:${delay}s;color:${C.accentBright};font-size:20px;font-weight:800;letter-spacing:4px;">${ch}</span>`;
    }).join("");
    const brand = div({ position: "relative", zIndex: "1" });
    brand.innerHTML = brandText;
    header.appendChild(brand);

    const sub = div({ color: C.textMuted, fontSize: "9px", letterSpacing: "2px", marginTop: "4px", position: "relative", zIndex: "1" });
    sub.id = "kv9-subtitle";
    sub.textContent = "INSERT pour ouvrir/fermer";
    header.appendChild(sub);
    menu.appendChild(header);

    const content = div({ minHeight: "220px", maxHeight: "480px", overflowY: "auto" });
    content.id = "kv9-content";
    menu.appendChild(content);

    const footer = div({ borderTop: `1px solid ${C.border}22`, padding: "6px 0", textAlign: "center", background: C.bg });
    footer.innerHTML = `<span style="color:${C.textMuted};font-size:8px;letter-spacing:1.5px;">v${VERSION} · by kaets0ner</span>`;
    menu.appendChild(footer);
    document.body.appendChild(menu);

    const live = div({ display: "none", position: "fixed", zIndex: "2147483646" });
    live.id = "kv9-live";
    live.innerHTML = `
      <div style="font-size:9px;font-weight:600;letter-spacing:2px;color:${C.textMuted};margin-bottom:8px;">
        KAETS <span style="color:${C.accent}">LIVE</span>
      </div>
      <div id="kv9-live-answer" style="color:${C.textMuted};font-size:13px;">En attente…</div>
    `;
    document.body.appendChild(live);

    renderPage();
    applyOverlay();
    ensureCompareButton();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  TOGGLE / RACCOURCIS
  // ═══════════════════════════════════════════════════════════════════════════
  function toggleMenu() {
    state.menuOpen = !state.menuOpen;
    let m = document.getElementById("kv9-menu");
    if (!m || !document.getElementById("kv9-content")) {
      document.getElementById("kv9-menu")?.remove();
      document.getElementById("kv9-live")?.remove();
      buildUI();
      m = document.getElementById("kv9-menu");
    }
    if (m) {
      m.style.display = state.menuOpen ? "block" : "none";
      if (state.menuOpen) {
        renderPage();
        // Popup de bienvenue : une seule fois (premier démarrage), non-bloquant
        maybeShowPopup();
      } else {
        closeThankYouPopup();
      }
    }
  }

  function showFlash(text, color = C.accent) {
    const flash = div({
      position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
      background: C.bg, border: `1px solid ${color}`, color,
      fontFamily: "'JetBrains Mono', monospace", fontSize: "16px", fontWeight: "700",
      padding: "12px 28px", zIndex: "2147483647", letterSpacing: "2px",
      boxShadow: `0 0 30px ${color}44`, borderRadius: "8px", pointerEvents: "none",
      animation: "kv9-fadein .15s ease-out",
    });
    flash.textContent = text;
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = "0"; flash.style.transition = "opacity .3s"; }, 800);
    setTimeout(() => flash.remove(), 1100);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Insert" || e.key === "*") { e.preventDefault(); toggleMenu(); }
    if (e.key === "F9") {
      e.preventDefault();
      settings.autoAnswer.enabled = !settings.autoAnswer.enabled;
      if (settings.autoAnswer.enabled) settings.silent.enabled = false;
      saveSettings();
      showFlash(settings.autoAnswer.enabled ? "AUTOANSWER ON" : "AUTOANSWER OFF", settings.autoAnswer.enabled ? C.success : C.error);
      if (state.page === "autoanswer" || state.page === "home") renderPage();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  INITIALISATION
  // ═══════════════════════════════════════════════════════════════════════════
  checkDismissalParam();

  if (isOnGitHubRepo() && !isPopupDismissed()) {
    // Sur le repo GitHub avant validation : gate full-screen, on saute l'UI PV
    window.addEventListener("load", () => {
      buildGitHubGate();
      // Re-tente l'injection si GitHub re-rend la page (Turbo navigation)
      const reinject = setInterval(() => {
        if (isPopupDismissed()) { clearInterval(reinject); return; }
        if (!document.getElementById("kv9-gh-gate")) buildGitHubGate();
      }, 2000);
      window.addEventListener("beforeunload", () => clearInterval(reinject));
    });
  } else {
    loadDumpFromLS();
    window.addEventListener("load", () => {
      buildUI();
      fetchDump();
      new MutationObserver(() => { lookup(); ensureCompareButton(); }).observe(document.body, { childList: true, subtree: true });
      setInterval(() => { lookup(); ensureCompareButton(); }, 800);
    });
  }

})();
