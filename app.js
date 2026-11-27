/* =========================================================
   박현민 AI 오피스 — 2차 버전
   공용 DB: Supabase (hyunmin-office) · Realtime + 폴링 백업
   ========================================================= */
(function(){
  "use strict";

  /* ---------- 공용 DB 접속 정보 (공개용 anon 키 / service_role 아님) ---------- */
  const SUPABASE_URL = "https://xwylmxghvlvhgizrjhqm.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3eWxteGdodmx2aGdpenJqaHFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2Mjg4OTAsImV4cCI6MjExMTIwNDg5MH0.2iC75Pdls9nxCXvAh3uLs0dxaKUvzjd6l1s96lIcNtY";
  const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
  const POLL_MS = 5000;

  const LS = {
    msgs: "hmo.messages.v2",
    memos: "hmo.memos.v2",
    cfg: "hmo.cfg.v1",
    prefs: "hmo.prefs.v1",
    ui: "hmo.ui.v1",
    queue: "hmo.queue.v1"
  };
  const $ = (s, r) => (r||document).querySelector(s);
  const $$ = (s, r) => Array.from((r||document).querySelectorAll(s));

  function load(key, fallback){
    try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch(e){ return fallback; }
  }
  function save(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch(e){ toast("저장 공간이 부족합니다"); return false; }
  }
  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  /* =========================================================
     사진 첨부 · 인용 답장 — 본문 규약
       사진   : ![첨부사진](data:image/jpeg;base64,…)   (또는 https:// 이미지 주소)
       답장   : [[reply:발신자|원문요약]]\n실제 답장
     DB 스키마는 그대로 두고 text 안에서만 약속한다.
     ========================================================= */
  const PHOTO_RE = /!\[([^\]\n]{0,80})\]\((data:image\/(?:jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s)]+)\)/g;
  const PHOTO_DATA_RE = /!\[[^\]\n]{0,80}\]\(data:image\/(?:jpeg|jpg|png|webp|gif);base64,[^)]*\)/g;
  const REPLY_RE = /^\[\[reply:([^\]\n|]{1,40})\|([^\]\n]{0,80})\]\]\n?/;
  const MAX_PHOTOS = 3;
  const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

  function stripPhotos(t){ return String(t == null ? "" : t).replace(PHOTO_DATA_RE, "📷 사진"); }
  function splitReply(t){
    const s = String(t == null ? "" : t);
    const m = s.match(REPLY_RE);
    if (!m) return { who:"", summary:"", rest:s };
    return { who:m[1], summary:m[2], rest:s.slice(m[0].length) };
  }
  function oneLine(t){ return String(t == null ? "" : t).replace(/\s+/g, " ").trim(); }
  function summaryOf(t){ return oneLine(stripPhotos(t)).slice(0, 50); }
  function copyable(t){
    const p = splitReply(t);
    const head = p.who ? ("↩️ " + p.who + (p.summary ? ": " + p.summary : "") + "\n") : "";
    return (head + String(p.rest || "").replace(PHOTO_DATA_RE, "[사진]")).trim();
  }
  function photoParts(photos){
    const out = [];
    (photos || []).forEach(u => {
      const m = String(u || "").match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
      if (!m) return;
      const mt = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
      out.push({ inlineData: { mimeType: mt, data: m[2] } });
    });
    return out;
  }

  /* ---------- 봇 (4명 체제: 나리 · 달이 · 제이 · 주노) ---------- */
  const BOTS = {
    nari:    { name:"나리", emoji:"🧡", face:"🧡", label:"오렌지", color:"nari",   what:"원컷스튜디오 · 클립 · 스레드 · 크몽" },
    dali:    { name:"달이", emoji:"💙", face:"💙", label:"블루",   color:"dali",   what:"블로그 · 당근 · 스마트스토어 · 체험단" },
    keyring: { name:"제이", emoji:"🔑", face:"🔑", label:"골드",   color:"gold",   what:"지시 기록 · 보고 정리" },
    juno:    { name:"주노", emoji:"🟣", face:"🟣", label:"퍼플",   color:"violet", what:"오피스 · 코드 · 배포" }
  };

  /* 예전 멤버(혜민·뮤즈·호크·클로드)가 남긴 옛 글은 이름만 살려 읽기 전용으로 그린다.
     탭·맵 데스크·봇 목록에는 넣지 않는다. */
  const LEGACY = {
    hyemin: { name:"혜민",   emoji:"🌸", face:"🌸", label:"핑크",    color:"pink",   what:"" },
    muse:   { name:"뮤즈",   emoji:"🪄", face:"🪄", label:"바이올렛", color:"violet", what:"" },
    hark:   { name:"호크",   emoji:"🦅", face:"🦅", label:"Hark",    color:"dali",   what:"" },
    claude: { name:"클로드", emoji:"🤖", face:"🤖", label:"Claude",  color:"nari",   what:"" }
  };

  /* ---------- 방 (대회의실 + 1:1 네 개) ---------- */
  const ROOMS = [
    { id:"all",     emoji:"🏛️", title:"🏛️ 대회의실 · 전원", nowTitle:"대회의실",   now:"원컷 · 클립 · 스레드 · 블로그 한 번에 지시", tone:"" },
    { id:"nari",    emoji:"🧡", title:"🧡 나리 · 1:1",   nowTitle:"나리 지휘실", now:"클립 · 스레드 · 크몽 · 콜드메일", tone:"n" },
    { id:"dali",    emoji:"💙", title:"💙 달이 · 1:1",   nowTitle:"달이 라운지", now:"블로그 · 당근 · 스마트스토어 · 체험단", tone:"d" },
    { id:"keyring", emoji:"🔑", title:"🔑 제이 · 1:1",   nowTitle:"제이 데스크", now:"지시 기록 · 보고 정리", tone:"g" },
    { id:"juno",    emoji:"🟣", title:"🟣 주노 · 1:1",   nowTitle:"주노 데스크", now:"오피스 · 코드 · 배포", tone:"v" }
  ];

  function localDateKey(d){
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  }
  function pad2(n){ return String(n).padStart(2,"0"); }
  function hhmm(iso){
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return "";
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function nowTime(){ return hhmm(null); }

  /* =========================================================
     공용 DB 어댑터 (Supabase REST + Realtime)
     ========================================================= */
  const OfficeDB = {
    mode: "local",          // realtime | poll | local
    client: null,
    channel: null,
    lastError: "",

    cfg(){
      const c = load(LS.cfg, {});
      return {
        url: (c.supabaseUrl || SUPABASE_URL).replace(/\/+$/,""),
        key: c.supabaseKey || SUPABASE_ANON_KEY
      };
    },
    base(){ return this.cfg().url + "/rest/v1"; },
    headers(extra){
      const k = this.cfg().key;
      return Object.assign({ "apikey":k, "Authorization":"Bearer " + k }, extra || {});
    },

    async init(){
      this.client = null;
      try{ await this.ping(); this.mode = "poll"; }
      catch(e){ this.mode = "local"; this.lastError = String(e && e.message || e); }
      return this.mode;
    },
    async ping(){
      const r = await fetch(this.base() + "/messages?select=id&limit=1", { headers:this.headers(), cache:"no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return true;
    },

    async selectMessages(limit){
      const q = "?select=*&order=created_at.desc&limit=" + (limit || 300);
      const r = await fetch(this.base() + "/messages" + q, { headers:this.headers(), cache:"no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const rows = await r.json();
      return Array.isArray(rows) ? rows.reverse() : rows;
    },
    async selectMemos(){
      const r = await fetch(this.base() + "/memos?select=*&order=created_at.desc&limit=100", { headers:this.headers(), cache:"no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    },
    async insertMessage(row){
      const r = await fetch(this.base() + "/messages", {
        method:"POST",
        headers:this.headers({ "Content-Type":"application/json", "Prefer":"return=representation" }),
        body: JSON.stringify(row)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      return Array.isArray(d) ? d[0] : d;
    },
    /* 완료 표시는 UPDATE 권한이 없어서(anon은 select·insert·delete만) 같은 내용을 새 행으로 넣고 옛 행을 지운다.
       created_at을 그대로 넘겨 시간 순서는 유지한다. */
    async insertMemo(text, createdAt){
      const payload = { text:text };
      if (createdAt) payload.created_at = createdAt;
      const r = await fetch(this.base() + "/memos", {
        method:"POST",
        headers:this.headers({ "Content-Type":"application/json", "Prefer":"return=representation" }),
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      return Array.isArray(d) ? d[0] : d;
    },
    async deleteMessage(id){
      const r = await fetch(this.base() + "/messages?id=eq." + encodeURIComponent(id), { method:"DELETE", headers:this.headers() });
      if (!r.ok) throw new Error("HTTP " + r.status);
    },
    async deleteMemo(id){
      const r = await fetch(this.base() + "/memos?id=eq." + encodeURIComponent(id), { method:"DELETE", headers:this.headers() });
      if (!r.ok) throw new Error("HTTP " + r.status);
    },

    /* Realtime 구독 (supabase-js 를 그때그때 불러온다) */
    async connectRealtime(onChange){
      const ok = await loadSDK();
      if (!ok) return false;
      try{
        const c = this.cfg();
        this.client = window.supabase.createClient(c.url, c.key, { auth:{ persistSession:false, autoRefreshToken:false } });
        const ch = this.client.channel("hyunmin-office");
        ["messages","memos"].forEach(tbl => {
          ch.on("postgres_changes", { event:"INSERT", schema:"public", table:tbl }, p => onChange(tbl, "insert", p.new));
          ch.on("postgres_changes", { event:"DELETE", schema:"public", table:tbl }, p => onChange(tbl, "delete", p.old));
        });
        this.channel = ch;
        await new Promise(resolve => {
          ch.subscribe(status => {
            if (status === "SUBSCRIBED"){ OfficeDB.mode = "realtime"; resolve(true); }
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"){ resolve(false); }
          });
          setTimeout(() => resolve(OfficeDB.mode === "realtime"), 6000);
        });
        return OfficeDB.mode === "realtime";
      }catch(e){
        this.lastError = String(e && e.message || e);
        return false;
      }
    }
  };
  window.OfficeDB = OfficeDB;

  function loadSDK(){
    if (window.supabase && window.supabase.createClient) return Promise.resolve(true);
    return new Promise(resolve => {
      const s = document.createElement("script");
      s.src = SDK_URL;
      s.async = true;
      s.onload = () => resolve(!!(window.supabase && window.supabase.createClient));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      setTimeout(() => resolve(!!(window.supabase && window.supabase.createClient)), 8000);
    });
  }

  /* ---------- 상태 ---------- */
  let messages = load(LS.msgs, []);
  let memos = load(LS.memos, []);
  let currentRoom = "all";
  let currentView = load(LS.ui, {}).view || "map";
  let pollTimer = null;
  const seenMsg = new Set();
  const seenMemo = new Set();

  function cacheAll(){
    // 사진 base64는 기기 저장공간(localStorage)을 금방 넘치게 하므로, 캐시본에서는 자리만 남긴다.
    // 원본은 공용 DB에서 다시 받아오고, 화면에 그려지는 messages 배열은 그대로 둔다.
    save(LS.msgs, messages.slice(-300).map(m => {
      if (!m || !m.text || String(m.text).indexOf("data:image/") === -1) return m;
      return Object.assign({}, m, { text: String(m.text).replace(PHOTO_DATA_RE, "📷 사진(오프라인 생략)") });
    }));
    save(LS.memos, memos.slice(0,100));
  }

  function upsertMessage(row, opts){
    if (!row || !row.id) return false;
    if (seenMsg.has(row.id)) return false;
    seenMsg.add(row.id);
    messages.push(row);
    messages.sort((a,b) => String(a.created_at||"").localeCompare(String(b.created_at||"")));
    if (!(opts && opts.noRender)){ renderRoom(); renderStatus(); }
    cacheAll();
    return true;
  }
  function removeMessage(id){
    if (!id) return;
    seenMsg.delete(id);
    messages = messages.filter(m => m.id !== id);
    renderRoom(); cacheAll();
  }
  function upsertMemo(row){
    if (!row || !row.id || seenMemo.has(row.id)) return false;
    seenMemo.add(row.id);
    memos.unshift(row);
    memos.sort((a,b) => String(b.created_at||"").localeCompare(String(a.created_at||"")));
    renderMemos(); cacheAll();
    return true;
  }
  function removeMemo(id){
    if (!id) return;
    seenMemo.delete(id);
    memos = memos.filter(m => m.id !== id);
    renderMemos(); cacheAll();
  }

  function resetSeen(){
    seenMsg.clear(); seenMemo.clear();
  }

  /* ---------- 동기화 ---------- */
  let refreshing = false;
  async function refreshAll(quiet){
    if (refreshing) return false;          // 화면 복귀·폴링이 겹쳐도 요청은 한 번만
    refreshing = true;
    try{
      const [ms, mm] = await Promise.all([ OfficeDB.selectMessages(), OfficeDB.selectMemos() ]);
      const pendingLocal = messages.filter(m => String(m.id || "").indexOf("local-") === 0);
      messages = (ms || []).concat(pendingLocal);
      messages.sort((a,b) => String(a.created_at||"").localeCompare(String(b.created_at||"")));
      memos = mm || [];
      resetSeen();
      messages.forEach(m => m.id && seenMsg.add(m.id));
      memos.forEach(m => m.id && seenMemo.add(m.id));
      OfficeDB.mode = (OfficeDB.mode === "realtime") ? "realtime" : "poll";
      cacheAll();
      renderRoom(); renderMemos(); renderStatus();
      if (!quiet) toast("불러왔습니다 · " + nowTime());
      return true;
    }catch(e){
      OfficeDB.lastError = String(e && e.message || e);
      if (OfficeDB.mode !== "realtime") OfficeDB.mode = "local";
      renderStatus();
      return false;
    } finally {
      refreshing = false;
    }
  }

  async function pollTick(){
    if (document.hidden) return;           // 화면이 꺼져 있는 동안에는 요청하지 않는다(복귀하면 바로 따라잡음)
    try{
      const ms = await OfficeDB.selectMessages();
      let changed = false;
      (ms || []).forEach(row => { if (upsertMessage(row, {noRender:true})) changed = true; });
      const mm = await OfficeDB.selectMemos();
      (mm || []).forEach(row => { if (upsertMemo(row)) changed = true; });
      if (changed){ renderRoom(); renderMemos(); }
      if (OfficeDB.mode !== "realtime"){ OfficeDB.mode = "poll"; renderStatus(); }
      flushQueue();
    }catch(e){
      OfficeDB.lastError = String(e && e.message || e);
      if (OfficeDB.mode !== "realtime"){ OfficeDB.mode = "local"; renderStatus(); }
    }
  }

  function startPolling(){
    if (pollTimer) clearTimeout(pollTimer);
    const wait = (OfficeDB.mode === "realtime") ? 30000 : POLL_MS;
    pollTimer = setTimeout(async () => {
      await pollTick();
      startPolling();
    }, wait);
  }

  /* 전송 실패분 재시도 큐 */
  function queuePush(row, localId){ const q = load(LS.queue, []); q.push(Object.assign({ localId: localId || null }, row)); save(LS.queue, q); }
  async function flushQueue(){
    const q = load(LS.queue, []);
    if (!q.length) return;
    const left = [];
    for (const item of q){
      const localId = item.localId;
      const payload = { room:item.room, sender:item.sender, role:item.role, text:item.text };
      try{
        const saved = await OfficeDB.insertMessage(payload);
        if (saved && saved.id){ if (localId) removeMessage(localId); upsertMessage(saved); }
      }catch(e){ left.push(item); }
    }
    save(LS.queue, left);
  }

  /* ---------- Realtime 구독 점검·복구 ---------- */
  let rtBusy = false;
  function onRealtimeRow(tbl, evt, row){
    if (tbl === "messages"){
      if (evt === "insert") upsertMessage(row);
      if (evt === "delete") removeMessage(row && row.id);
    } else {
      if (evt === "insert") upsertMemo(row);
      if (evt === "delete") removeMemo(row && row.id);
    }
  }
  async function ensureRealtime(){
    if (rtBusy) return false;
    if (OfficeDB.channel && (OfficeDB.channel.state === "joined" || OfficeDB.channel.state === "joining")) return true;
    rtBusy = true;
    try{
      if (OfficeDB.channel){
        try{ OfficeDB.client && OfficeDB.client.removeChannel(OfficeDB.channel); }catch(e){}
        OfficeDB.channel = null;
      }
      const ok = await OfficeDB.connectRealtime(onRealtimeRow);
      if (ok) OfficeDB.mode = "realtime";
      else if (OfficeDB.mode === "realtime") OfficeDB.mode = "poll";
      renderStatus();
      return ok;
    } finally {
      rtBusy = false;
    }
  }

  /* ---------- 폰 화면 복귀 즉시 동기화 (visibilitychange · focus · pageshow · online) ---------- */
  let resumeTimer = null;
  function resumeSync(why){
    if (document.hidden) return;
    clearTimeout(resumeTimer);                 // 짧은 디바운스로 중복 요청 방지
    resumeTimer = setTimeout(async () => {
      await refreshAll(true);
      flushQueue();
      ensureRealtime();                        // 구독이 끊겼으면 다시 붙인다
    }, 220);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) resumeSync("visible"); });
  window.addEventListener("focus", () => resumeSync("focus"));
  window.addEventListener("pageshow", e => { if (e.persisted) resumeSync("pageshow"); });
  window.addEventListener("online", () => resumeSync("online"));

  /* ---------- 화면 전환 ---------- */
  const TABS = { map:"map", room:"room", dash:"dash", cal:"cal", ai:"ai", memo:"memo" };
  function setView(v, opts){
    if (!document.getElementById("view-" + v)) v = "room";
    currentView = v;
    $$(".view").forEach(el => el.classList.toggle("on", el.id === "view-" + v));
    const tabFor = TABS[v];
    $$(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.view === tabFor)));
    const navFor = (v === "room") ? "room" : (v === "memo" ? "memo" : (v === "bots" ? "bots" : null));
    $$(".navbtn").forEach(b => b.setAttribute("aria-selected", String(b.dataset.nav === (navFor || ""))));
    if (v === "cal") renderTimeline();
    if (v === "bots") renderStatus();
    const ui = load(LS.ui, {}); ui.view = v; save(LS.ui, ui);
    window.scrollTo({ top:0, behavior:"smooth" });
    if (v === "room") scrollChat();
  }
  $$(".tab").forEach(t => t.addEventListener("click", () => setView(t.dataset.view)));
  $$(".navbtn").forEach(b => b.addEventListener("click", () => setView(b.dataset.nav)));

  /* ---------- 상태 표시 ---------- */
  function statusText(){
    if (OfficeDB.mode === "realtime") return "공용 DB 연결됨 · 실시간 동기화";
    if (OfficeDB.mode === "poll") return "공용 DB 연결됨 · 5초 동기화";
    return "오프라인 · 이 기기에만 저장";
  }
  function renderStatus(){
    const txt = statusText();
    const ok = OfficeDB.mode === "realtime" || OfficeDB.mode === "poll";
    const badge = $("#dbBadge");
    if (badge){ badge.textContent = txt; badge.className = "v " + (ok ? "ok" : "warn"); }
    const note = $("#dbNote");
    if (note) note.textContent = ok ? "메시지는 공용 DB에 저장됩니다" : "연결을 기다리는 중 · 보낸 글은 이 기기에 보관됩니다";
    const dbState = $("#dbState");
    if (dbState){ dbState.textContent = txt; dbState.className = "v " + (ok ? "ok" : "warn"); }
    const sheetState = $("#sheetDbState");
    if (sheetState) sheetState.textContent = txt;
    const dot = $("#syncDot");
    if (dot) dot.style.background = ok ? "var(--green)" : "#C7893E";
  }

  /* ---------- 회의실 ---------- */
  function botMeta(kind){
    return BOTS[kind] || LEGACY[kind] || { name:String(kind || "AI"), emoji:"🤖", face:"🤖", label:"AI", color:"dali", what:"" };
  }
  function msgKind(m){
    if (!m) return "system";
    if (m.sender === "user") return "user";
    if (BOTS[m.sender] || LEGACY[m.sender]) return m.sender;   // nari·dali·keyring·juno
    return "system";
  }
  function renderRoom(){
    const chat = $("#chat");
    if (!chat) return;
    const shown = messages.filter(m => (m.room || "all") === currentRoom);
    chat.innerHTML = "";
    if (!shown.length){
      chat.innerHTML = '<div class="empty">아직 대화가 없습니다<br>아래에 한 줄 지시를 남겨보세요</div>';
    }
    shown.forEach(m => {
      const kind = msgKind(m);
      if (kind === "system"){
        const el = document.createElement("div");
        el.className = "sysline";
        el.textContent = m.text;
        chat.appendChild(el);
        return;
      }
      const me = kind === "user";
      const bot = me ? null : botMeta(kind);
      const el = document.createElement("div");
      el.className = "msg " + (me ? "me" : kind);
      el.dataset.id = m.id || "";
      const cp = '<button class="copy" type="button" data-copy="' + esc(m.id) + '" aria-label="본문 복사">복사</button>' +
        '<button class="rbtn" type="button" data-reply="' + esc(m.id) + '" aria-label="이 글에 답장">↩️ 답장</button>';
      if (me){
        el.innerHTML = '<div class="body"><div class="bubble"></div><div class="foot"><span>' + esc(hhmm(m.created_at)) + '</span>' + cp + '</div></div>';
        renderBubble(el.querySelector(".bubble"), m.text);
      } else {
        el.innerHTML =
          '<div class="face">' + bot.face + '</div>' +
          '<div class="body"><div class="who">' + bot.name +
            '<span class="badge ' + bot.color + '">' + bot.label + '</span>' +
            '<time>' + esc(hhmm(m.created_at)) + '</time>' + cp + '</div>' +
          '<div class="bubble"></div></div>';
        renderBubble(el.querySelector(".bubble"), m.text);
      }
      chat.appendChild(el);
    });
    renderAiLive(chat);          // 즉시 답변 로딩 · 오류 안내(DB에 남기지 않음)
    scrollChat();
  }
  function scrollChat(){
    const c = $("#chat"); if (!c) return;
    requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
  }

  /* 말풍선 본문: 인용 박스 + 텍스트 + 사진(안전한 DOM 생성만 한다) */
  function renderBubble(box, raw){
    if (!box) return;
    box.innerHTML = "";
    const p = splitReply(raw);
    if (p.who){
      const q = document.createElement("div");
      q.className = "quote";
      q.textContent = "↩️ " + p.who + (p.summary ? ": " + p.summary : "에게 답장");
      box.appendChild(q);
    }
    const rest = String(p.rest || "");
    let last = 0, mm;
    PHOTO_RE.lastIndex = 0;
    while ((mm = PHOTO_RE.exec(rest)) !== null){
      if (mm.index > last) box.appendChild(document.createTextNode(rest.slice(last, mm.index)));
      const img = document.createElement("img");
      img.className = "photo";
      const src = mm[2];                 // 루프 변수(mm)는 끝나면 null이 되므로 값으로 붙잡아 둔다
      img.src = src;
      img.alt = mm[1] || "첨부사진";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("click", () => openLightbox(src));
      box.appendChild(img);
      last = mm.index + mm[0].length;
    }
    if (last < rest.length) box.appendChild(document.createTextNode(rest.slice(last)));
    if (!box.childNodes.length) box.appendChild(document.createTextNode(rest));
  }

  /* ---------- 방 탭: 대회의실 + 1:1 (ROOMS 기준으로 생성) ---------- */
  const ROOM_BY_ID = {};
  ROOMS.forEach(r => { ROOM_BY_ID[r.id] = r; });
  ROOM_BY_ID.all.on = "ON " + Object.keys(BOTS).length + "명";

  function roomTabLabel(r){
    const b = BOTS[r.id];
    return (r.emoji || (b && b.emoji) || "🤖") + " " + (b ? b.name : r.id);
  }
  function buildSubtabs(){
    const wrap = $("#subtabScroll");
    if (!wrap) return;
    wrap.innerHTML = "";
    ROOMS.filter(r => r.id !== "all").forEach(r => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "subtab";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", "false");
      b.dataset.room = r.id;
      b.textContent = roomTabLabel(r);
      wrap.appendChild(b);
    });
  }

  function selectRoom(room){
    if (!ROOM_BY_ID[room]) room = "all";
    currentRoom = room;
    $$(".subtab").forEach(x => x.setAttribute("aria-selected", String(x.dataset.room === room)));
    const meta = ROOM_BY_ID[room];
    const bot = BOTS[room];
    const tn = $("#roomTitle");
    if (tn) tn.textContent = meta.title || (roomTabLabel(meta) + " · 1:1");
    const on = $("#roomOn");
    if (on) on.textContent = meta.on || (bot ? bot.name + " 활동 중" : "");
    const rule = $("#roomRule");
    if (rule) rule.style.display = (room === "all") ? "" : "none";
    const input = $("#msgInput");
    if (input) input.placeholder = (room === "all")
      ? "대장님, 지시를 한 줄로 (@all = 전원)"
      : "대장님, " + (bot ? bot.name : room) + "에게 한 줄 지시";
    const sel = $$(".subtab").find(x => x.dataset.room === room);
    if (sel && sel.scrollIntoView){ try{ sel.scrollIntoView({ block:"nearest", inline:"nearest" }); }catch(e){} }
    renderRoom();
  }

  const subtabsEl = $(".subtabs");
  if (subtabsEl) subtabsEl.addEventListener("click", e => {
    const t = e.target && e.target.closest ? e.target.closest(".subtab") : null;
    if (t && t.dataset.room) selectRoom(t.dataset.room);
  });

  /* ---------- 사진 첨부 · 인용 답장 상태 ---------- */
  let pendingPhotos = [];   // [{ dataUrl, bytes, name }]
  let replyTarget = null;   // { id, who, summary }

  function dataUrlBytes(u){
    const s = String(u || "");
    const i = s.indexOf(",");
    if (i < 0) return 0;
    return Math.round((s.length - i - 1) * 3 / 4);
  }
  function kbText(n){ return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + "MB" : Math.max(1, Math.round(n / 1024)) + "KB"; }

  function updateAttachStrip(){
    const strip = $("#attachStrip");
    if (!strip) return;
    strip.innerHTML = "";
    strip.hidden = !pendingPhotos.length;
    pendingPhotos.forEach((p, idx) => {
      const chip = document.createElement("div");
      chip.className = "attach-chip";
      const im = document.createElement("img");
      im.src = p.dataUrl; im.alt = p.name || "첨부 사진";
      const sz = document.createElement("span");
      sz.className = "sz"; sz.textContent = kbText(p.bytes);
      const x = document.createElement("button");
      x.type = "button"; x.className = "x"; x.textContent = "✕";
      x.setAttribute("aria-label", "이 사진 빼기");
      x.addEventListener("click", () => { pendingPhotos.splice(idx, 1); updateAttachStrip(); });
      chip.appendChild(im); chip.appendChild(sz); chip.appendChild(x);
      strip.appendChild(chip);
    });
  }

  function updateReplyBar(){
    const bar = $("#replyBar"), txt = $("#replyBarText");
    if (!bar || !txt) return;
    bar.hidden = !replyTarget;
    if (replyTarget){
      txt.textContent = "↩️ " + replyTarget.who + "에게 답장" + (replyTarget.summary ? ': "' + replyTarget.summary + '"' : "");
    }
  }
  const replyCancelBtn = $("#replyCancel");
  if (replyCancelBtn) replyCancelBtn.addEventListener("click", () => {
    replyTarget = null; updateReplyBar();
    const input = $("#msgInput"); if (input) input.focus();
  });

  /* 사진 크게 보기 */
  function openLightbox(src){
    const lb = $("#lightbox"), im = $("#lightboxImg");
    if (!lb || !im) return;
    im.src = src; lb.hidden = false;
  }
  function closeLightbox(){
    const lb = $("#lightbox"), im = $("#lightboxImg");
    if (!lb || !im) return;
    lb.hidden = true; im.removeAttribute("src");
  }
  const lbEl = $("#lightbox");
  if (lbEl) lbEl.addEventListener("click", e => { if (e.target === lbEl) closeLightbox(); });
  const lbX = $("#lightboxClose");
  if (lbX) lbX.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeLightbox(); });

  /* ---------- 사진 고르기 → Canvas 리사이즈·압축(긴 변 900px · JPEG 0.72 · 150KB 안팎) ---------- */
  function readAsDataURL(file){
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("파일을 읽지 못했습니다"));
      fr.readAsDataURL(file);
    });
  }
  function loadImage(src){
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("사진을 열지 못했습니다"));
      im.src = src;
    });
  }
  async function compressPhoto(file){
    const src = await readAsDataURL(file);
    const im = await loadImage(src);
    let w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    if (!w || !h) throw new Error("사진 크기를 읽지 못했습니다");
    const pick = Math.min(1, 900 / Math.max(w, h));
    let tw = Math.max(1, Math.round(w * pick)), th = Math.max(1, Math.round(h * pick));
    let q = 0.72, out = "";
    for (let step = 0; step < 4; step++){
      const cv = document.createElement("canvas");
      cv.width = tw; cv.height = th;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, tw, th);
      ctx.drawImage(im, 0, 0, tw, th);
      out = cv.toDataURL("image/jpeg", q);
      if (dataUrlBytes(out) <= 150 * 1024) break;
      if (q > 0.5){ q = Math.round((q - 0.1) * 100) / 100; }
      else { tw = Math.max(1, Math.round(tw * 0.8)); th = Math.max(1, Math.round(th * 0.8)); q = 0.7; }
    }
    return { dataUrl: out, bytes: dataUrlBytes(out), name: file.name || "사진" };
  }

  const photoInput = $("#photoInput");
  const plusBtn = $("#plusBtn");
  if (plusBtn && photoInput) plusBtn.addEventListener("click", () => photoInput.click());
  if (photoInput) photoInput.addEventListener("change", async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    for (const f of files){
      if (pendingPhotos.length >= MAX_PHOTOS){ toast("사진은 한 번에 " + MAX_PHOTOS + "장까지 붙일 수 있습니다"); break; }
      if (!/^image\//i.test(String(f.type || ""))){ toast("사진 파일만 붙일 수 있습니다"); continue; }
      if (f.size > MAX_PHOTO_BYTES){ toast("12MB가 넘는 사진은 붙이지 못합니다 · 더 작은 사진으로"); continue; }
      try{
        toast("사진을 줄이는 중…");
        pendingPhotos.push(await compressPhoto(f));
        updateAttachStrip();
      }catch(err){ toast((err && err.message) || "사진을 붙이지 못했습니다"); }
    }
  });

  /* 말풍선 [↩️ 답장] */
  document.addEventListener("click", e => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-reply]") : null;
    if (!btn) return;
    const m = messages.find(x => String(x.id) === String(btn.dataset.reply));
    if (!m){ toast("답장할 글을 찾지 못했습니다"); return; }
    const kind = msgKind(m);
    const who = kind === "user" ? "대장님" : botMeta(kind).name;
    replyTarget = { id:m.id, who:who, summary: summaryOf(splitReply(m.text).rest) };
    updateReplyBar();
    const input = $("#msgInput"); if (input) input.focus();
  });

  async function sendMessage(){
    const input = $("#msgInput");
    const typed = input.value.trim();
    const photos = pendingPhotos.slice();
    const reply = replyTarget;
    if (!typed && !photos.length){ input.focus(); return; }

    let body = typed;
    if (photos.length){
      body = (typed ? typed + "\n\n" : "") + photos.map(p => "![첨부사진](" + p.dataUrl + ")").join("\n");
    }
    if (reply){
      const who = String(reply.who || "").replace(/[|\]\n]/g, " ").slice(0, 20).trim();
      const sum = String(reply.summary || "").replace(/[|\]\n]/g, " ").slice(0, 50).trim();
      body = "[[reply:" + who + "|" + sum + "]]\n" + body;
    }

    const row = {
      room: currentRoom === "all" ? "all" : currentRoom,
      sender: "user",
      role: "user",
      text: body
    };
    input.value = "";
    aiNotice = null;                       // 지난 오류 안내는 새 지시와 함께 지운다
    pendingPhotos = []; updateAttachStrip();
    replyTarget = null; updateReplyBar();
    const photoUrls = photos.map(p => p.dataUrl);
    try{
      const saved = await OfficeDB.insertMessage(row);
      if (saved && saved.id) upsertMessage(saved);
      else { renderRoom(); }
      toast("보냈습니다 · 공용 DB에 저장됨");
      queueInstant(row.room, body, photoUrls);   // ⚡ 즉시 채팅이 켜져 있으면 바로 답변 생성(사진도 함께 넘김)
    }catch(e){
      const localId = "local-" + Date.now();
      queuePush(row, localId);
      const local = Object.assign({ id:localId, created_at:new Date().toISOString() }, row);
      upsertMessage(local);
      toast("연결이 끊겨 이 기기에 보관했습니다 · 연결되면 다시 올립니다");
    }
  }
  $("#sendBtn").addEventListener("click", sendMessage);
  $("#msgInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.isComposing){ e.preventDefault(); sendMessage(); }
  });

  /* =========================================================
     ⚡ 즉시 채팅 — Google Gemini 를 브라우저에서 직접 호출
     키는 localStorage(hmo_gemini_key)에만 저장 · 코드·저장소에 절대 넣지 않는다
     ========================================================= */
  const AI_KEY_LS = "hmo_gemini_key";
  const AI_ON_LS  = "hmo_instant_ai_enabled";
  const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

  let aiPending = null;      // { room, text } 답변 준비 중 표시
  let aiNotice = null;       // { room, text } 오류 안내(DB에 남기지 않음)

  function aiKey(){
    try{ return String(localStorage.getItem(AI_KEY_LS) || "").trim(); }catch(e){ return ""; }
  }
  function aiOn(){
    try{ return localStorage.getItem(AI_ON_LS) === "1"; }catch(e){ return false; }
  }
  function aiReady(){ return !!aiKey() && aiOn(); }
  function maskKey(k){
    k = String(k || "");
    return k.length > 12 ? (k.slice(0,6) + "…" + k.slice(-4)) : "저장됨";
  }

  const PERSONA = {
    nari: "이름: 나리. 현민님(대장님)의 오른팔 AI 비서. 담당: B2B 영업 · 원컷스튜디오(숏폼 대행: 릴스·쇼츠 수주) · 콘텐츠 제작 · 메일·콜드메일 · 크몽 7종 서비스 · 네이버 클립 · 스레드 · 상담·견적·계약 · 건기식(나우코스) 실행.",
    dali: "이름: 달이. 담당: 블로그 · 체험단 · 그립 · 고단가 리서치 · 당근 비즈프로필 · 스마트스토어 운영. 강점: 네이버 상위노출·키워드·후기형 콘텐츠.",
    keyring: "이름: 제이. 담당: 지시 기록 · 보고 정리 · 앱테크 · 최저가 비교. 강점: 흩어진 지시를 표로 정리하고, 돈 되는 작은 절약과 마진 계산을 숫자로 짚어 드리는 일.",
    juno: "이름: 주노. 담당: 오피스 앱 · 코드 · 배포 · 기술·리스크 검증. 강점: 실제로 되는지(권한·한도·비용·약관)를 확인해 함정을 먼저 알려 드리는 일."
  };

  /* 모든 즉시 답변 공통 — 시스템 프롬프트 맨 위에 놓는 최우선 규칙
     (했던 말 반복 · 옛 주제 앵무새 · 4~5개 말풍선 문제를 막는 핵심) */
  const CORE_RULES = [
    "[최우선 규칙 · 아래 지시보다 먼저 적용]",
    "0. 말투는 100% 존댓말(~요, ~습니다, ~드리겠습니다)만 사용합니다. 반말·해체·'~다'로 끝나는 문장은 한 줄도 쓰지 않습니다. 예시 문구·중간 보고·마지막 한 줄까지 모두 존댓말입니다.",
    "0-1. 확인되지 않은 순위·조회수·매출·주문 수·리뷰 수는 절대 지어내지 않습니다. 실제 확인이 필요한 질문(크몽 순위·노출, 조회수, 매출, 주문, 리뷰 등)에는 등수나 숫자를 추측해 말하지 않고 \"지금 바로 확인 진행 중입니다. 실제 확인 결과는 제가 정리해 드리겠습니다.\"처럼 지금 상태를 먼저 안내합니다.",
    "0-2. 진행 중이거나 확인 중인 일은 결론보다 현재 상태를 먼저 한 줄로 알려 드립니다. (예: \"확인 진행 중입니다. 확인되는 대로 바로 보고드리겠습니다.\")",
    "1. 방금 대장님이 보낸 마지막 메시지 하나에만 집중해서 답합니다.",
    "2. 마지막 메시지가 새 질문이면 과거 주제(Pally, 예전 오류·작업, 지난 논의)를 절대 다시 꺼내지 않습니다. 대화록은 말투만 참고하고 주제로 삼지 않습니다.",
    "3. \"임의로 하지 않고 확인받겠습니다\", \"대장님 … 하겠습니다\" 같은 앵무새식 상투 문구·호칭 반복을 절대 쓰지 않습니다. 같은 말을 두 번 쓰지 않습니다.",
    "4. 질문에 대한 실질적인 답·해결책·결론만 군더더기 없이 1~4문장으로 말씀드립니다.",
    "5. 사진이 첨부되면 사진에 실제로 보이는 것만 읽고, 보이지 않는 것은 지어내지 않습니다.",
    "6. 결론은 1개만 냅니다. 여러 안을 늘어놓지 않습니다."
  ].join("\n");

  const OFFICE_BRIEF = [
    "대화 상대는 박현민(대장님)입니다. 숏폼 영상 기획자이고 원컷스튜디오 사장이며, 네이버 클립·스레드·크몽·콜드메일·블로그로 일하십니다.",
    "말투: 반드시 정중하고 자연스러운 존댓말(~요, ~습니다, ~드리겠습니다)만 사용합니다. 반말은 절대 금지입니다. 짧고 실무적으로 말하되, 마크다운 기호(#, **, 표)는 쓰지 않고 줄바꿈과 '·'로만 정리합니다.",
    "과장하지 않습니다. 모르는 것은 모른다고 말씀드리고, 확인되지 않은 숫자·순위는 지어내지 않습니다.",
    "돈이 나가는 일·다른 사람에게 나가는 일은 임의로 결정하지 않습니다. 그런 지시일 때만 마지막 한 줄로 확인을 구합니다."
  ].join("\n");

  const DUTIES = [
    "나리(nari): B2B 영업 · 원컷스튜디오(릴스·쇼츠 수주) · 콘텐츠 제작 · 메일·콜드메일 · 크몽 · 네이버 클립 · 스레드 · 상담·견적·계약 · 건기식(나우코스)",
    "달이(dali): 블로그 · 체험단 · 그립 · 고단가 리서치 · 당근 비즈프로필 · 스마트스토어 · 네이버 상위노출·키워드",
    "제이(keyring): 지시 기록 · 보고 정리 · 앱테크 · 최저가 비교 · 마진 계산",
    "주노(juno): 오피스 앱 · 코드 · 배포 · 기술·리스크 검증"
  ].join("\n");

  /* 대회의실 기본값: 담당자 1명이 결론 1개 */
  const ONE_BRIEF = [
    CORE_RULES,
    "",
    OFFICE_BRIEF,
    "",
    "[대회의실] 답은 담당자 1명이 결론 1개만 냅니다.",
    DUTIES,
    "지시에 가장 맞는 담당자 1명을 골라 그 사람으로서 답합니다. 인사말·이름 붙이기·여러 안 나열은 금지입니다.",
    '출력은 {"sender":"nari|dali|juno|keyring","text":"1~4문장"} JSON 객체 하나만. 코드블록·설명 금지. text는 반드시 존댓말(~요, ~습니다)로 씁니다.'
  ].join("\n");

  /* 대회의실 예외: '다들 의견 내봐·토론해·각자 말해봐'라고 명시했을 때만 최대 4명 */
  const TEAM_BRIEF = [
    CORE_RULES,
    "",
    OFFICE_BRIEF,
    "",
    "[대회의실 · 여러 명 요청] 대장님이 여러 명의 의견을 명시적으로 요청하셨습니다.",
    DUTIES,
    "지시와 관련된 사람만 최대 4명, 각자 자기 영역 관점에서 1~2줄입니다. 같은 말 반복·인사말·이름 붙이기는 금지입니다.",
    '출력은 {"messages":[{"sender":"nari|dali|juno|keyring","text":"..."}]} JSON 하나만. 4개를 넘기지 않습니다. 각 text는 반드시 존댓말(~요, ~습니다)로 씁니다.'
  ].join("\n");

  function setAiPending(room, t){ aiPending = t ? { room:room, text:t } : null; renderRoom(); }
  function setAiNotice(room, t){ aiNotice = t ? { room:room, text:t } : null; renderRoom(); }

  function renderAiLive(chat){
    if (aiNotice && aiNotice.room === currentRoom){
      const box = document.createElement("div");
      box.className = "ai-notice";
      box.innerHTML = '<span class="nt"></span><button class="nx" type="button" aria-label="안내 닫기">✕</button>';
      box.querySelector(".nt").textContent = aiNotice.text;
      box.querySelector(".nx").addEventListener("click", () => { aiNotice = null; renderRoom(); });
      chat.appendChild(box);
    }
    if (aiPending && aiPending.room === currentRoom){
      const el = document.createElement("div");
      el.className = "ai-typing";
      el.innerHTML = '<span class="tt"></span><span class="dots"><i></i><i></i><i></i></span>';
      el.querySelector(".tt").textContent = aiPending.text;
      chat.appendChild(el);
    }
  }

  function renderAiState(){
    const key = aiKey();
    const on = !!key && aiOn();
    const chip = $("#aiPillChip"), pill = $("#serverPill");
    if (chip) chip.textContent = on ? "⚡ 즉시" : "서버";
    if (pill){
      pill.classList.toggle("live", on);
      pill.setAttribute("aria-label", on ? "AI 설정 · 즉시 채팅 켜짐" : "AI 설정 · 즉시 채팅 꺼짐");
    }
    const badge = $("#instantBadge");
    if (badge){
      badge.textContent = on ? "⚡ 즉시 채팅 ON" : "서버(5분)";
      badge.className = "instant-badge" + (on ? " on" : "");
    }
    const tg = $("#aiToggle");
    if (tg) tg.setAttribute("aria-checked", String(on));
    const st = $("#aiKeyState");
    if (st) st.textContent = key ? ("저장됨 · " + maskKey(key)) : "키 없음";
  }

  async function fetchWithTimeout(url, opts, ms){
    const ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    let timer = null;
    if (ctl && ms) timer = setTimeout(() => { try{ ctl.abort(); }catch(e){} }, ms);
    try{
      return await fetch(url, Object.assign({ cache:"no-store" }, opts || {}, ctl ? { signal:ctl.signal } : {}));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function aiErr(code, msg){ const e = new Error(msg || code); e.code = code; return e; }

  /* 사용 가능한 Gemini flash 모델 자동 탐색 (404 방지) */
  async function discoverGeminiModel(key){
    const res = await fetchWithTimeout(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=50",
      { method:"GET", headers:{ "x-goog-api-key": key } },
      20000
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) return null;
    const list = (data && data.models) || [];
    const usable = list
      .filter(m => m && m.name && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map(m => String(m.name).replace(/^models\//, ""));
    return usable.find(n => /^gemini-3\.5-flash-lite$/i.test(n))
      || usable.find(n => /^gemini-3\.8-flash$/i.test(n))
      || usable.find(n => /^gemini-3\.6-flash$/i.test(n))
      || usable.find(n => /gemini-3.*flash/i.test(n))
      || usable.find(n => /flash-latest/i.test(n))
      || usable[0] || null;
  }

  /* Gemini REST 호출: 성공 모델 캐시 + thinking 최소화(속도 3배) + 신규 3.x 우선 */
  const AI_MODEL_LS = "hmo_gemini_model";
  async function callGemini(body){
    const key = aiKey();
    if (!key) throw aiErr("NO_KEY", "Gemini 키 없음");
    let cached = "";
    try{ cached = localStorage.getItem(AI_MODEL_LS) || ""; }catch(e){}
    const baseModels = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"];
    const ordered = cached ? [cached].concat(baseModels.filter(m => m !== cached)) : baseModels;
    const attempts = [];
    ordered.forEach((m, idx) => {
      attempts.push({ model: m, thinkBudget: idx === 0 ? 0 : null });
    });
    let last = null;
    let dropSchema = false;
    let discoveredTried = false;
    for (let i = 0; i < attempts.length; i++){
      const a = attempts[i];
      const payload = JSON.parse(JSON.stringify(body));
      const gc = payload.generationConfig || (payload.generationConfig = {});
      if (a.thinkBudget === 0){ gc.thinkingConfig = { thinkingBudget:0 }; }
      if (dropSchema){ delete gc.responseSchema; }
      try{
        const res = await fetchWithTimeout(
          GEMINI_BASE + a.model + ":generateContent",
          { method:"POST", headers:{ "Content-Type":"application/json", "x-goog-api-key": key }, body: JSON.stringify(payload) },
          45000
        );
        const data = await res.json().catch(() => null);
        if (!res.ok){
          const er = (data && data.error) || {};
          const reasons = (er.details || []).map(d => d && d.reason).filter(Boolean);
          const e = new Error(er.message || ("HTTP " + res.status));
          e.status = res.status;
          e.reason = reasons[0] || er.status || "";
          if (res.status === 400 && /API_KEY/i.test(String(e.reason) + " " + String(e.message))) e.fatal = true;
          if (res.status === 401 || res.status === 403) e.fatal = true;
          if (res.status === 400 && gc.thinkingConfig && !attempts.some(x => x.model === a.model && x.thinkBudget === null)){
            attempts.splice(i + 1, 0, { model: a.model, thinkBudget: null });
          }
          if (res.status === 400 && gc.responseSchema) dropSchema = true;
          throw e;
        }
        const cand = (data && data.candidates && data.candidates[0]) || null;
        const parts = (cand && cand.content && cand.content.parts) || [];
        const text = parts.map(p => (p && p.text) || "").join("").trim();
        if (!text){
          const e = new Error("빈 응답" + ((cand && cand.finishReason) ? " (" + cand.finishReason + ")" : ""));
          e.status = 0;
          e.reason = (cand && cand.finishReason) || "EMPTY";
          throw e;
        }
        try{ localStorage.setItem(AI_MODEL_LS, a.model); }catch(err){}
        return text;
      }catch(e){
        last = e;
        if (e && e.fatal) throw e;
        if (i === attempts.length - 1 && !discoveredTried && e && e.status === 404){
          discoveredTried = true;
          const found = await discoverGeminiModel(key).catch(() => null);
          if (found && !attempts.some(x => x.model === found)){
            attempts.push({ model: found, thinkBudget: null });
          }
        }
      }
    }
    throw last || new Error("Gemini 호출 실패");
  }

  function aiErrorMessage(e){
    const s = (e && e.status) || 0;
    const r = String((e && e.reason) || "");
    const m = String((e && e.message) || "");
    if (e && e.code === "NO_KEY") return "Gemini 키가 없습니다 · ⚙️ AI에서 키를 먼저 저장해 주세요.";
    if (e && e.code === "FORMAT") return "답변 형식을 읽지 못했습니다 · 한 번 더 보내 주세요.";
    if (s === 400 && /API_KEY/i.test(r)) return "Gemini 키가 올바르지 않습니다 · ⚙️ AI에서 키를 다시 확인해 주세요.";
    if (s === 401 || s === 403) return "키 인증 실패(" + s + "): " + m.slice(0, 80);
    if (s === 429) return "Gemini 무료 한도를 넘었습니다 · 잠시 뒤 다시 보내거나 5분 서버 답변을 기다려 주세요.";
    if (s === 404) return "Gemini 모델 없음(404): " + m.slice(0, 80);
    if (s >= 500) return "Gemini 서버가 잠시 불안정합니다 · 조금 뒤 다시 시도해 주세요.";
    if (/abort|timeout/i.test(m)) return "응답이 너무 늦습니다(60초) · 다시 보내 주세요.";
    if (/Failed to fetch|NetworkError|Load failed|ERR_/i.test(m)) return "구글에 연결하지 못했습니다 · 인터넷 연결을 확인해 주세요.";
    if (/빈 응답/.test(m)) return "Gemini가 빈 답변을 돌려줬습니다 · 한 번 더 보내 주세요. (" + (r || "EMPTY") + ")";
    return "즉시 답변을 만들지 못했습니다 · " + (m || "알 수 없는 오류");
  }

  /* 최근 대화 몇 건만 간결히 (사진 base64는 빼고 자리만 남긴다)
     길게 넣으면 옛 주제를 다시 꺼내므로 기본 6건 · 메시지당 140자로 자른다 */
  function transcript(room, limit){
    const rows = messages
      .filter(m => (m.room || "all") === room)
      .slice(-(limit || 6));
    return rows.map(m => {
      const who = (m.sender === "user") ? "대장님" : botMeta(m.sender).name;
      const p = splitReply(m.text);
      const body = stripPhotos(p.rest).replace(/\s+/g, " ").trim().slice(0, 140);
      return who + ": " + (p.who ? "(" + p.who + "에게 답장) " : "") + body;
    }).join("\n") || "(없음)";
  }

  /* 이번 지시 문장: 인용 답장 맥락을 앞에 세우고 사진은 [사진 첨부]로 줄인다 */
  function promptText(raw){
    const p = splitReply(raw);
    const head = p.who
      ? "[인용 답장] " + p.who + "의 글 \"" + p.summary + "\"에 대장님이 답장하는 중입니다. 이 맥락을 이어서 답해 주세요.\n"
      : "";
    return head + stripPhotos(p.rest).trim();
  }

  async function askOne(room, text, photos){
    const bot = BOTS[room];
    if (!bot) throw aiErr("NO_ROOM", "1:1 방이 아닙니다");
    const system = CORE_RULES + "\n\n" + PERSONA[room] + "\n\n" + OFFICE_BRIEF +
      "\n\n지금은 '" + bot.name + "' 1:1 방입니다. 대화록은 말투 참고용입니다. 대장님의 마지막 지시 하나에 너(" + bot.name + ")로서 답합니다." +
      " 모든 문장을 정중한 존댓말(~요, ~습니다, ~드리겠습니다)로만 쓰고, 반말은 한 문장도 쓰지 않습니다." +
      " 바로 쓸 수 있는 순서·문장으로 1~4문장입니다. 첫머리에 네 이름을 다시 붙이지 않습니다. 실행이 필요하면 '제가 지금 할 수 있는 것'과 '대장님이 해 주실 것'을 구분해 적습니다." +
      " 확인되지 않은 순위·조회수·매출 같은 수치는 지어내지 않고 \"지금 바로 확인 진행 중입니다. 실제 확인 결과는 제가 정리해 드리겠습니다.\"처럼 현재 상태를 먼저 알립니다." +
      " 사진이 함께 오면 사진에 실제로 보이는 것만 짚고 답합니다.";
    const prompt = "[대화록 · " + bot.name + " 방 · 최근 6건 — 말투 참고용. 주제는 무시]\n" + transcript(room, 6) +
      "\n\n[대장님 마지막 지시]\n" + promptText(text) + "\n\n위 마지막 지시 하나에만 존댓말로 답해 주세요.";
    return await callGemini({
      systemInstruction: { parts:[{ text: system }] },
      contents: [{ role:"user", parts: [{ text: prompt }].concat(photoParts(photos)) }],
      generationConfig: { temperature:0.85, maxOutputTokens: 1200 }
    });
  }

  /* 대회의실: 기본은 담당자 1명 · 결론 1개.
     '다들 의견 내봐 · 토론해 · 각자 말해봐'처럼 명시했을 때만 최대 4명. */
  const MULTI_RE = /(다들|모두|전원)\s*(의견|말|한번|각자|얘기)|의견\s*(내|내봐|좀|다)|토론|각자\s*(말|의견|정리|발언)/;
  const NAME_RULES = [["nari", /나리/], ["dali", /달이/], ["keyring", /제이|키링/], ["juno", /주노/]];

  /* 마지막 메시지 본문(인용 답장 머리말·사진은 뺀다) */
  function lastBody(raw){ return stripPhotos(splitReply(raw).rest).trim(); }

  /* 대장님이 특정 봇을 지목했으면 그 봇 (두 명 이상 섞이면 null → 모델이 고른다) */
  function pickNamedBot(raw){
    const body = lastBody(raw);
    const hits = NAME_RULES.filter(r => r[1].test(body)).map(r => r[0]);
    return hits.length === 1 ? hits[0] : null;
  }

  async function askAll(text, photos){
    const named = pickNamedBot(text);
    if (!named && MULTI_RE.test(lastBody(text))) return await askTeam(text, photos);
    return [await askConclusion(text, photos, named)];
  }

  /* 기본 경로: 가장 적합한 담당자 1명이 결론 1개(JSON 객체 하나) */
  async function askConclusion(text, photos, named){
    const who = named
      ? BOTS[named].name + "(" + named + ")가 맡습니다. sender는 \"" + named + "\"."
      : "지시에 가장 맞는 담당자 1명이 맡습니다. 그 담당자를 sender에 넣습니다.";
    const prompt = "[대화록 · 대회의실 · 최근 6건 — 말투 참고용. 주제는 무시]\n" + transcript("all", 6) +
      "\n\n[대장님 마지막 지시]\n" + promptText(text) +
      "\n\n---\n위 마지막 지시 하나에만 답합니다. " + who +
      " 결론 1개만 1~4문장이고, 인사말·이름·상투적 되묻기 없이 바로 답합니다." +
      " 모든 문장은 정중한 존댓말(~요, ~습니다)입니다. 반말은 금지입니다." +
      " 확인되지 않은 순위·수치는 지어내지 않고 '확인 진행 중' 상태를 먼저 알립니다." +
      '\n출력은 {"sender":"nari|dali|juno|keyring","text":"..."} JSON 객체 하나만. 코드블록·설명 금지.';
    try{
      const raw = await callGemini({
        systemInstruction: { parts:[{ text: ONE_BRIEF }] },
        contents: [{ role:"user", parts: [{ text: prompt }].concat(photoParts(photos)) }],
        generationConfig: { temperature:0.7, maxOutputTokens: 600, responseMimeType:"application/json" }
      });
      const row = parseOne(raw, named || "nari");
      if (named) row.sender = named;      // 대장님이 지목한 봇으로 고정
      return row;
    }catch(e){
      if (e && (e.fatal || e.status === 401 || e.status === 403 || e.status === 429)) throw e;
      const plain = await askOne(named || "nari", text, photos);
      return { sender: named || "nari", text: plain };
    }
  }

  /* 예외 경로: 여러 명 의견(최대 4개) */
  async function askTeam(text, photos){
    const prompt = "[대화록 · 대회의실 · 최근 6건 — 말투 참고용. 주제는 무시]\n" + transcript("all", 6) +
      "\n\n[대장님 마지막 지시]\n" + promptText(text) +
      "\n\n---\n대장님이 여러 명 의견을 요청하셨습니다. 관련된 사람 최대 4명이 각 1~2줄입니다." +
      " 모든 문장은 정중한 존댓말(~요, ~습니다)이고 반말은 금지입니다. 확인되지 않은 순위·수치는 지어내지 않습니다." +
      '\n출력은 {"messages":[{"sender":"nari|dali|juno|keyring","text":"..."}]} JSON 하나만. 4개를 넘기지 않습니다.';
    try{
      const raw = await callGemini({
        systemInstruction: { parts:[{ text: TEAM_BRIEF }] },
        contents: [{ role:"user", parts: [{ text: prompt }].concat(photoParts(photos)) }],
        generationConfig: { temperature:0.75, maxOutputTokens: 900, responseMimeType:"application/json" }
      });
      return parsePlan(raw);
    }catch(e){
      if (e && (e.fatal || e.status === 401 || e.status === 403 || e.status === 429)) throw e;
      const single = await askOne("nari", text, photos);
      return [{ sender:"nari", text: single }];
    }
  }

  function parseLoose(raw){
    const txt = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try{ return JSON.parse(txt); }catch(e){}
    const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
    if (a >= 0 && b > a){ try{ return JSON.parse(txt.slice(a, b + 1)); }catch(e2){} }
    return null;
  }

  function normSender(v){
    const raw = String(v || "").trim().toLowerCase();
    if (BOTS[raw]) return raw;
    if (/나리/.test(raw)) return "nari";
    if (/달이/.test(raw)) return "dali";
    if (/제이|키링/.test(raw)) return "keyring";
    if (/주노/.test(raw)) return "juno";
    return null;
  }

  /* JSON이 아니면 본문 글로 본다 */
  function plainText(raw){
    const txt = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const c = txt.charAt(0);
    return (c === "{" || c === "[") ? "" : txt;
  }

  /* 1명 결론 파싱 — 어떤 형태로 와도 말풍선 1개로 접는다 */
  function parseOne(raw, fallbackSender){
    const data = parseLoose(raw);
    let first = null;
    if (Array.isArray(data)) first = data[0];
    else if (data && typeof data === "object"){
      if (Array.isArray(data.messages)) first = data.messages[0] || null;
      else if (data.sender || data.text || data.answer) first = data;
    }
    let sender = null, body = "";
    if (first && typeof first === "object"){
      sender = normSender(first.sender || first.from || first.name || first.speaker);
      body = String(first.text || first.answer || first.content || "").trim();
    } else if (typeof first === "string"){
      body = first.trim();
    }
    if (!body) body = plainText(raw);
    if (!body) throw aiErr("FORMAT", "결론 형식을 읽지 못했습니다");
    return { sender: sender || fallbackSender || "nari", text: body };
  }

  function parsePlan(raw){
    const data = parseLoose(raw);
    const list = (data && Array.isArray(data.messages)) ? data.messages : (Array.isArray(data) ? data : []);
    const out = [];
    list.forEach(it => {
      if (!it) return;
      const body = String((typeof it === "string") ? it : (it.text || it.answer || "")).trim();
      if (!body) return;
      const sender = (typeof it === "string") ? null : normSender(it.sender || it.from || it.name);
      out.push({ sender: sender || "nari", text: body });
    });
    if (!out.length) throw aiErr("FORMAT", "의견 형식을 읽지 못했습니다");
    return out.slice(0, 4);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* 답변을 messages 에 0.5초 간격으로 차례로 올린다(채팅처럼 보이게) */
  async function insertBotRows(room, rows){
    let added = 0;
    for (let i = 0; i < rows.length; i++){
      if (i > 0) await sleep(120);
      try{
        const saved = await OfficeDB.insertMessage({
          room: room, sender: rows[i].sender, role: "assistant", text: rows[i].text
        });
        if (saved && saved.id) upsertMessage(saved);
        else renderRoom();
        added++;
      }catch(e){
        if (added) toast("일부 답변만 저장했습니다 · " + (e.message || "오류"));
        else toast("답변을 공용 DB에 저장하지 못했습니다 · " + (e.message || "오류"));
        break;
      }
    }
    return added;
  }

  let aiBusy = false;
  const aiQueue = [];

  function queueInstant(room, text, photos){
    if (!aiReady()) return false;                 // 꺼져 있으면 기존 5분 서버 흐름 그대로
    if (!BOTS[room] && room !== "all") return false;
    aiQueue.push({ room: room, text: text, photos: photos || [] });
    drainAiQueue();
    return true;
  }

  async function drainAiQueue(){
    if (aiBusy) return;
    aiBusy = true;
    try{
      while (aiQueue.length){
        const job = aiQueue.shift();
        await runInstant(job.room, job.text, job.photos);
      }
    } finally {
      aiBusy = false;
    }
  }

  async function runInstant(room, text, photos){
    const isAll = room === "all";
    const who = isAll ? "4명" : (BOTS[room] ? BOTS[room].name : "AI");
    const named = isAll ? pickNamedBot(text) : null;
    const multi = !!isAll && !named && MULTI_RE.test(lastBody(text));
    aiNotice = null;
    setAiPending(room, isAll
      ? (multi ? "🤖 다들 의견 정리 중…" : "🤖 결론 정리 중…")
      : "🤖 " + who + "가 답을 쓰는 중…");
    try{
      let rows = null;
      if (isAll) rows = await askAll(text, photos);
      else rows = [{ sender: room, text: await askOne(room, text, photos) }];

      if (isAll) setAiPending(room, multi ? "🤖 의견 올리는 중…" : "🤖 결론 올리는 중…");
      else setAiPending(room, null);

      const n = await insertBotRows(room, rows);
      setAiPending(room, null);
      if (n) toast(isAll ? (multi ? ("대회의실 의견 " + n + "개 도착 · " + nowTime()) : ("대회의실 결론 도착 · " + nowTime())) : (who + " 즉시 답변 · " + nowTime()));
    }catch(e){
      try{ console.warn("[instant-ai]", e); }catch(err){}
      setAiPending(room, null);
      const msg = aiErrorMessage(e);
      setAiNotice(room, "⚠️ " + msg);
      toast(msg);
    }
  }

  /* ---------- 설정 시트: Gemini 키 저장/삭제 · 즉시 채팅 토글 ---------- */
  const aiToggleEl = $("#aiToggle");
  if (aiToggleEl) aiToggleEl.addEventListener("click", () => {
    if (!aiKey()){ toast("먼저 Gemini 키를 저장해 주세요"); return; }
    const next = !aiOn();
    try{ localStorage.setItem(AI_ON_LS, next ? "1" : "0"); }catch(e){ toast("설정을 저장하지 못했습니다"); return; }
    renderAiState();
    toast(next ? "⚡ 즉시 채팅 ON · 이제 보내면 바로 답합니다" : "즉시 채팅 OFF · 5분 서버 답변으로 돌아갑니다");
  });

  const geminiSaveEl = $("#geminiSave");
  if (geminiSaveEl) geminiSaveEl.addEventListener("click", () => {
    const inp = $("#geminiKey");
    const v = inp ? String(inp.value || "").trim() : "";
    if (!v){ toast(aiKey() ? "이미 키가 저장되어 있습니다 · 바꿀 때만 입력하세요" : "Gemini API 키를 넣어 주세요"); return; }
    if (!/^(AIza|AQ\.)[0-9A-Za-z_\-\.]{20,}$/.test(v)){ toast("키 형식이 올바르지 않습니다 · AIza 또는 AQ. 키를 넣어 주세요"); return; }
    try{
      localStorage.setItem(AI_KEY_LS, v);
      localStorage.setItem(AI_ON_LS, "1");
    }catch(e){ toast("이 기기에 저장하지 못했습니다 · 저장 공간을 확인해 주세요"); return; }
    if (inp){ inp.value = ""; inp.placeholder = "저장된 키를 쓰는 중 · 바꿀 때만 입력"; }
    renderAiState();
    toast("키를 이 기기에 저장했습니다 · 즉시 채팅 ON");
  });

  const geminiClearEl = $("#geminiClear");
  if (geminiClearEl) geminiClearEl.addEventListener("click", () => {
    if (!aiKey()){ toast("저장된 키가 없습니다"); return; }
    if (!confirm("이 기기에 저장한 Gemini 키를 지울까요?\n지워도 공용 DB의 대화는 그대로 남습니다.")) return;
    try{ localStorage.removeItem(AI_KEY_LS); localStorage.setItem(AI_ON_LS, "0"); }catch(e){}
    const inp = $("#geminiKey");
    if (inp){ inp.value = ""; inp.placeholder = "AIza... 또는 AQ... (Google AI Studio 발급)"; }
    renderAiState();
    toast("키를 지웠습니다 · 서버(5분) 답변으로 돌아갑니다");
  });

  const aiTestEl = $("#aiTest");
  if (aiTestEl) aiTestEl.addEventListener("click", async () => {
    const inp = $("#geminiKey");
    const typed = inp ? String(inp.value || "").trim() : "";
    if (typed && !/^(AIza|AQ\.)[0-9A-Za-z_\-\.]{20,}$/.test(typed)){ toast("키 형식이 올바르지 않습니다 · AIza 또는 AQ. 키를 넣어 주세요"); return; }
    if (!typed && !aiKey()){ toast("먼저 키를 저장해 주세요"); return; }
    const label = aiTestEl.textContent;
    aiTestEl.disabled = true;
    aiTestEl.textContent = "확인 중…";
    const oldKey = aiKey();
    try{
      if (typed) localStorage.setItem(AI_KEY_LS, typed);   // 저장 전에 임시로 써 보고
      const t = await callGemini({
        contents: [{ role:"user", parts:[{ text:"핑. '연결됨'이라고만 답해." }] }],
        generationConfig: { temperature:0, maxOutputTokens: 24 }
      });
      if (typed) { try{ localStorage.setItem(AI_ON_LS, "1"); }catch(err){} if (inp) inp.value = ""; }
      toast("✅ Gemini 연결됨 · 바로 사용 가능해요!");
    }catch(e){
      if (typed && !oldKey){ try{ localStorage.removeItem(AI_KEY_LS); }catch(err){} }
      if (typed && oldKey){ try{ localStorage.setItem(AI_KEY_LS, oldKey); }catch(err){} }
      toast("❌ " + aiErrorMessage(e));
    } finally {
      aiTestEl.disabled = false;
      aiTestEl.textContent = label;
      renderAiState();
    }
  });

  /* ---------- 캘린더 ---------- */
  const ROUTINE = [
    { t:"08:30", title:"원컷 스레드 (일상)", d:"반말 · 5대 규칙", who:"nari" },
    { t:"09:00", title:"크몽 문의 확인", d:"7종 상태 · 루키광고", who:"nari" },
    { t:"10:00", title:"콜드메일 25통", d:"평일만 · 누계 178행", who:"nari" },
    { t:"12:00", title:"원컷 스레드 (점심)", d:"일상 톤 · 짧게", who:"nari" },
    { t:"14:00", title:"크몽 순위 점검", d:"노출 · 키워드", who:"nari" },
    { t:"19:30", title:"네이버 클립 1편", d:"제작 → 배달", who:"nari" },
    { t:"20:00", title:"크몽 저녁 확인", d:"문의 · 답변", who:"nari" },
    { t:"20:30", title:"원컷 블로그 1편", d:"원컷스튜디오 브랜드", who:"dali" },
    { t:"21:00", title:"건기식 스레드", d:"나우코스 · 1회", who:"nari" },
    { t:"21:30", title:"원컷 스레드 (일내용)", d:"하루 마무리", who:"nari" }
  ];

  function renderTimeline(){
    const tl = $("#timeline"); if (!tl) return;
    const d = new Date();
    const nowMin = d.getHours()*60 + d.getMinutes();
    let nextFound = false;
    tl.innerHTML = "";
    ROUTINE.forEach(item => {
      const [h,m] = item.t.split(":").map(Number);
      const mins = h*60 + m;
      const past = mins < nowMin - 30;
      const isNext = !past && !nextFound;
      if (isNext) nextFound = true;
      const el = document.createElement("div");
      el.className = "tl-item" + (past ? " past" : "") + (isNext ? " next" : "");
      el.innerHTML =
        '<div class="tl-time">' + item.t + '</div>' +
        '<div class="tl-line"></div>' +
        '<div class="tl-body"><div class="t">' + esc(item.title) +
          (isNext ? '<span class="now">다음</span>' : '') +
        '</div><div class="d">' + esc(item.d) +
          ' <span class="assignee ' + (item.who === "nari" ? "n" : "d") + '">' + BOTS[item.who].name + '</span>' +
        '</div></div>';
      tl.appendChild(el);
    });
    const dd = new Date();
    const label = (dd.getMonth()+1) + "." + dd.getDate() + " (" + "일월화수목금토"[dd.getDay()] + ")";
    const tlLabel = $("#todayLabel"); if (tlLabel) tlLabel.textContent = label;
  }
  $$(".day").forEach(b => b.addEventListener("click", () => {
    $$(".day").forEach(x => x.classList.remove("now"));
    b.classList.add("now");
    toast(b.dataset.day === "0" ? "오늘 루틴입니다" : "지난·다음 날 루틴은 다음 버전에서 열립니다");
    renderTimeline();
  }));

  /* ---------- 메모 · 진행 현황 ---------- */
  function parseMemo(text){
    const raw = String(text == null ? "" : text);
    const hit = raw.match(/^\s*\[\s*(완료|완료됨|done)\s*\]\s*/i);
    if (!hit) return { done:false, body:raw.trim() };
    return { done:true, body:raw.slice(hit[0].length).trim() };
  }
  function whenLabel(iso){
    const d = new Date(iso || Date.now());
    if (isNaN(d.getTime())) return "";
    return (d.getMonth()+1) + "." + d.getDate() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function renderMemos(){
    const list = $("#memoList"); if (!list) return;
    list.innerHTML = "";
    const count = $("#memoCount"); if (count) count.textContent = memos.length + "개";
    const empty = $("#memoEmpty"); if (empty) empty.style.display = memos.length ? "none" : "block";
    memos.forEach(m => {
      const p = parseMemo(m.text);
      const el = document.createElement("div");
      el.className = "memo" + (p.done ? " done" : "");
      el.innerHTML = '<div class="mt"></div>' +
        '<div class="acts">' +
          '<button class="chk' + (p.done ? " on" : "") + '" data-memo-done="' + esc(m.id) + '" data-memo-state="' + (p.done ? "0" : "1") + '" aria-label="' + (p.done ? "완료 취소" : "완료 표시") + '">' + (p.done ? "✓" : "○") + '</button>' +
          '<button class="del" aria-label="삭제">✕</button>' +
        '</div>';
      el.querySelector(".mt").innerHTML = '<div class="tx"></div><div class="when">' + esc(whenLabel(m.created_at)) + (p.done ? ' <b class="dtag">완료</b>' : '') + '</div>';
      el.querySelector(".tx").textContent = p.body;
      el.querySelector(".del").addEventListener("click", async () => {
        if (!confirm("이 메모를 지울까요? 공용 DB에서도 지워집니다.")) return;
        try{
          if (String(m.id).indexOf("local-") !== 0) await OfficeDB.deleteMemo(m.id);
          removeMemo(m.id);
          toast("메모를 지웠습니다");
        }catch(e){ toast("지우지 못했습니다 · " + (e.message || "오류")); }
      });
      list.appendChild(el);
    });
    renderProgress();
  }

  /* 완료 표시: UPDATE 권한이 없어서 같은 글을 새 행으로 넣고 옛 행을 지운다(created_at 유지) */
  async function setMemoDone(id, done){
    const m = memos.find(x => String(x.id) === String(id));
    if (!m) return;
    const body = parseMemo(m.text).body;
    const nextText = done ? "[완료] " + body : body;
    if (String(id).indexOf("local-") === 0){
      m.text = nextText; renderMemos(); cacheAll(); return;
    }
    try{
      const saved = await OfficeDB.insertMemo(nextText, m.created_at);
      if (!saved || !saved.id){ toast("바꾸지 못했습니다 · 다시 시도해 주세요"); return; }
      try{ await OfficeDB.deleteMemo(m.id); }catch(e){}
      removeMemo(m.id);
      upsertMemo(saved);
      toast(done ? "완료로 옮겼습니다 · " + whenLabel(saved.created_at) : "다시 진행중으로 옮겼습니다");
    }catch(e){
      toast("바꾸지 못했습니다 · " + (e.message || "오류"));
    }
  }

  function progressData(){
    const rows = memos.map(m => {
      const p = parseMemo(m.text);
      return { id:m.id, body:p.body, done:p.done, created_at:m.created_at };
    });
    return {
      run: rows.filter(x => !x.done && x.body),
      done: rows.filter(x => x.done && x.body)
    };
  }

  function renderProgress(){
    if (!$("#progCard")) return;
    const data = progressData();
    const run = data.run, done = data.done;
    const set = (sel, v) => { const el = $(sel); if (el) el.textContent = String(v); };
    set("#progRun", run.length);
    set("#progDone", done.length);

    const peek = $("#progPeek");
    if (peek){
      peek.style.display = "block";
      if (run.length) peek.textContent = "최근 · " + run[0].body;
      else if (done.length) peek.textContent = "진행중 0건 · 완료 " + done.length + "건";
      else peek.textContent = "메모에 지시를 적으면 여기에서 진행중/완료로 나뉘어 보입니다";
    }

    const runList = $("#progRunList"), doneList = $("#progDoneList");
    const empty = $("#progEmpty");
    if (runList) runList.innerHTML = "";
    if (doneList) doneList.innerHTML = "";
    if (empty) empty.style.display = (run.length + done.length) ? "none" : "block";

    const addItem = (host, it) => {
      if (!host) return;
      const el = document.createElement("div");
      el.className = "prog-item" + (it.done ? " done" : "");
      const chk = document.createElement("button");
      chk.type = "button";
      chk.className = "pchk" + (it.done ? " on" : "");
      chk.dataset.memoDone = String(it.id);
      chk.dataset.memoState = it.done ? "0" : "1";
      chk.setAttribute("aria-label", it.done ? "완료 취소" : "완료 표시");
      chk.textContent = it.done ? "✓" : "○";
      const tx = document.createElement("div"); tx.className = "ptx"; tx.textContent = it.body;
      const w = document.createElement("div"); w.className = "pwhen"; w.textContent = whenLabel(it.created_at);
      el.appendChild(chk); el.appendChild(tx); el.appendChild(w);
      host.appendChild(el);
    };
    run.slice(0, 8).forEach(it => addItem(runList, it));
    done.slice(0, 8).forEach(it => addItem(doneList, it));
    const more = $("#progMore");
    if (more) more.textContent = (run.length + done.length > 16) ? "… 메모 탭에서 전체 " + (run.length + done.length) + "건 보기" : "";
  }

  const progToggle = $("#progToggle"), progBody = $("#progBody");
  function setProgOpen(open){
    if (!progBody || !progToggle) return;
    progBody.hidden = !open;
    progToggle.setAttribute("aria-expanded", String(!!open));
    const ui = load(LS.ui, {}); ui.progOpen = !!open; save(LS.ui, ui);
  }
  if (progToggle) progToggle.addEventListener("click", () => setProgOpen(progBody.hidden));

  /* 메모 완료 토글(메모 탭 · 진행 현황 패널 공통) */
  document.addEventListener("click", e => {
    const b = e.target && e.target.closest ? e.target.closest("[data-memo-done]") : null;
    if (!b) return;
    setMemoDone(b.dataset.memoDone, b.dataset.memoState === "1");
  });

  /* ---------- 말풍선 [복사] ---------- */
  async function copyText(text){
    const t = String(text == null ? "" : text);
    try{
      if (navigator.clipboard && window.isSecureContext){ await navigator.clipboard.writeText(t); return true; }
    }catch(e){}
    try{
      const ta = document.createElement("textarea");
      ta.value = t; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.left = "0"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, t.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    }catch(e){ return false; }
  }
  document.addEventListener("click", async e => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-copy]") : null;
    if (!btn) return;
    const m = messages.find(x => String(x.id) === String(btn.dataset.copy));
    if (!m){ toast("복사할 글을 찾지 못했습니다"); return; }
    const ok = await copyText(copyable(m.text));
    if (!ok){ toast("복사하지 못했습니다 · 길게 눌러 선택해 주세요"); return; }
    const label = btn.dataset.label || btn.textContent;
    btn.dataset.label = label;
    btn.textContent = "복사됨 ✓";
    btn.classList.add("done");
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.textContent = label; btn.classList.remove("done"); }, 1500);
    try{ if (navigator.vibrate) navigator.vibrate(8); }catch(err){}
  });

  async function addMemo(){
    const ta = $("#memoInput");
    const text = ta.value.trim();
    if (!text){ ta.focus(); return; }
    ta.value = "";
    try{
      const saved = await OfficeDB.insertMemo(text);
      if (saved && saved.id) upsertMemo(saved);
      toast("메모를 공용 DB에 저장했습니다");
    }catch(e){
      const local = { id:"local-m-" + Date.now(), text:text, created_at:new Date().toISOString() };
      upsertMemo(local);
      toast("연결이 끊겨 이 기기에 저장했습니다");
    }
  }
  $("#memoAdd").addEventListener("click", addMemo);
  $("#memoInput").addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter"){ e.preventDefault(); addMemo(); }
  });

  /* ---------- 설정 시트 ---------- */
  const scrim = $("#scrim"), sheet = $("#sheet");
  function openSheet(){
    const cfg = load(LS.cfg, {});
    $("#sbUrl").value = cfg.supabaseUrl || SUPABASE_URL;
    $("#sbKey").value = cfg.supabaseKey || SUPABASE_ANON_KEY;
    const gk = $("#geminiKey");
    if (gk){
      gk.value = "";
      gk.placeholder = aiKey() ? "저장된 키를 쓰는 중 · 바꿀 때만 입력" : "AIza... 또는 AQ... (Google AI Studio 발급)";
    }
    renderAiState();
    renderStatus();
    scrim.classList.add("on"); sheet.classList.add("on");
    sheet.setAttribute("aria-hidden", "false");
  }
  function closeSheet(){ scrim.classList.remove("on"); sheet.classList.remove("on"); sheet.setAttribute("aria-hidden", "true"); }
  $("#serverPill").addEventListener("click", openSheet);
  $("#serverPill").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openSheet(); });
  $("#openSettings2").addEventListener("click", openSheet);
  $("#sheetClose").addEventListener("click", closeSheet);
  scrim.addEventListener("click", closeSheet);

  $("#saveDb").addEventListener("click", async () => {
    const url = $("#sbUrl").value.trim(), key = $("#sbKey").value.trim();
    if (!url || !key){ toast("URL과 anon 키를 모두 넣어 주세요"); return; }
    save(LS.cfg, { supabaseUrl:url.replace(/\/+$/,""), supabaseKey:key, savedAt: Date.now() });
    await OfficeDB.init();
    const ok = await refreshAll(true);
    closeSheet();
    toast(ok ? "연결했습니다 · " + statusText() : "주소를 확인해 주세요 · " + (OfficeDB.lastError || "연결 실패"));
  });

  $("#resetAll").addEventListener("click", () => {
    if (!confirm("이 기기에 캐시된 대화·메모·설정을 지울까요? 공용 DB의 내용은 그대로 남습니다.")) return;
    Object.values(LS).forEach(k => { try{ localStorage.removeItem(k); }catch(e){} });
    location.reload();
  });

  $("#installHelp").addEventListener("click", () => {
    toast("크롬: ⋮ → 홈 화면에 추가 · 삼성 인터넷: ≡ → 페이지 추가 후 홈 화면");
  });

  /* ---------- 새로고침 ---------- */
  $("#refreshBtn").addEventListener("click", async () => {
    const btn = $("#refreshBtn");
    btn.classList.add("spin");
    setTimeout(() => btn.classList.remove("spin"), 620);
    const ok = await refreshAll(true);
    toast(ok ? "새로고침 완료 · " + nowTime() : "연결 실패 · " + (OfficeDB.lastError || "네트워크"));
  });

  /* ---------- 봇 → 1:1 (동적으로 그리는 버튼까지 위임으로 처리) ---------- */
  document.addEventListener("click", e => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-open-room]") : null;
    if (!btn) return;
    enterRoom(btn.dataset.openRoom || "all");
  });

  /* ---------- 봇 목록 (BOTS 기준) ---------- */
  function renderBots(){
    const list = $("#botList");
    if (!list) return;
    list.innerHTML = "";
    const keys = Object.keys(BOTS);
    keys.forEach(k => {
      const b = BOTS[k];
      const hasRoom = !!ROOM_BY_ID[k];
      const el = document.createElement("div");
      el.className = "bot " + k;
      const face = document.createElement("div"); face.className = "face"; face.textContent = b.face;
      const body = document.createElement("div"); body.style.flex = "1"; body.style.minWidth = "0";
      const who = document.createElement("div"); who.className = "who"; who.textContent = b.name + " ";
      const badge = document.createElement("span"); badge.className = "badge " + b.color; badge.textContent = b.label;
      who.appendChild(badge);
      const what = document.createElement("div"); what.className = "what"; what.textContent = b.what || "";
      body.appendChild(who); body.appendChild(what);
      const go = document.createElement("button");
      go.type = "button";
      go.className = "go";
      go.dataset.openRoom = hasRoom ? k : "all";
      go.textContent = hasRoom ? "1:1 열기" : "대회의실";
      el.appendChild(face); el.appendChild(body); el.appendChild(go);
      list.appendChild(el);
    });
    const hint = $("#botCount");
    if (hint) hint.textContent = keys.length + "명 등록 · " + (ROOMS.length - 1) + "개 1:1 방";
  }

  /* ---------- 지금 본부에서는 (ROOMS 기준) ---------- */
  function renderNow(){
    const box = $("#nowList");
    if (!box) return;
    box.innerHTML = "";
    ROOMS.forEach(r => {
      const b = BOTS[r.id];
      const row = document.createElement("div"); row.className = "now-row";
      const ico = document.createElement("div");
      ico.className = "ico" + (r.tone ? " " + r.tone : "");
      ico.textContent = r.emoji || (b ? b.emoji : "🤖");
      const body = document.createElement("div"); body.className = "body";
      const t = document.createElement("div"); t.className = "t";
      t.textContent = r.nowTitle || (b ? b.name : r.id);
      const d = document.createElement("div"); d.className = "d"; d.textContent = r.now || "";
      body.appendChild(t); body.appendChild(d);
      const go = document.createElement("button"); go.type = "button"; go.className = "go";
      go.dataset.openRoom = r.id; go.textContent = "입장 →";
      row.appendChild(ico); row.appendChild(body); row.appendChild(go);
      box.appendChild(row);
    });
    const hint = $("#nowHint");
    if (hint) hint.textContent = ROOMS.length + "개 방 · " + Object.keys(BOTS).length + "명";
  }

  /* ---------- 절약 모드 토글 ---------- */
  const prefs = load(LS.prefs, { night:true, digest:false, lite:true });
  $$(".toggle").forEach(t => {
    const k = t.dataset.pref;
    t.setAttribute("aria-checked", String(!!prefs[k]));
    t.addEventListener("click", () => {
      prefs[k] = !prefs[k];
      t.setAttribute("aria-checked", String(prefs[k]));
      save(LS.prefs, prefs);
    });
  });

  /* ---------- 맵: 본부 오피스 ---------- */
  const officeEl = $("#officeMap");
  const moveBtn = $("#moveToggle");

  function applyMovePref(){
    const on = prefs.move !== false;
    if (officeEl) officeEl.classList.toggle("paused", !on);
    if (moveBtn){
      moveBtn.classList.toggle("off", !on);
      moveBtn.setAttribute("aria-pressed", String(on));
    }
    const st = $("#moveState"); if (st) st.textContent = on ? "ON" : "OFF";
  }
  if (moveBtn) moveBtn.addEventListener("click", () => {
    prefs.move = (prefs.move === false);   // OFF 상태에서 누르면 다시 ON
    save(LS.prefs, prefs);
    applyMovePref();
    toast(prefs.move ? "봇들이 다시 움직입니다" : "움직임을 멈췄습니다");
  });

  function clockText(){
    const d = new Date();
    let h = d.getHours();
    const ap = h < 12 ? "오전" : "오후";
    h = h % 12; if (h === 0) h = 12;
    return ap + " " + h + ":" + pad2(d.getMinutes());
  }
  function tickClock(){ const c = $("#officeClock"); if (c) c.textContent = clockText(); }
  setInterval(tickClock, 20000);

  const botCountEl = $("#botOnCount");
  if (botCountEl) botCountEl.textContent = String(Object.keys(BOTS).length);
  const roomCountEl = $("#roomCount");
  if (roomCountEl) roomCountEl.textContent = String(ROOMS.length);

  function enterRoom(room){
    if (!ROOM_BY_ID[room]) room = "all";
    setView("room");
    selectRoom(room);
  }
  $$(".hotspot").forEach(h => {
    const go = () => enterRoom(h.dataset.hot || "all");
    h.addEventListener("click", go);
    h.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " "){ e.preventDefault(); go(); }
    });
  });

  /* ---------- 토스트 ---------- */
  let toastTimer;
  function toast(msg){
    const el = $("#toast"); if (!el) return;
    el.textContent = msg; el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2600);
  }
  window.hmoToast = toast;

  /* ---------- 부팅 ---------- */
  (async function boot(){
    const d0 = new Date();
    const todayText = (d0.getMonth()+1) + "월 " + d0.getDate() + "일 " + "일월화수목금토"[d0.getDay()] + "요일";
    const tt = $("#todayText"); if (tt) tt.textContent = todayText;

    buildSubtabs(); selectRoom(currentRoom);
    renderBots(); renderNow();
    renderRoom(); renderMemos(); renderTimeline(); renderStatus(); renderAiState();
    tickClock(); applyMovePref();
    setProgOpen(!!load(LS.ui, {}).progOpen);
    // 맵 개편 첫 실행에는 본부 오피스를 먼저 보여준다 (한 번만)
    const ui0 = load(LS.ui, {});
    if (!ui0.mapIntro){ ui0.mapIntro = true; ui0.view = "map"; save(LS.ui, ui0); currentView = "map"; }
    setView(currentView || "map");

    await OfficeDB.init();
    renderStatus();
    await refreshAll(true);

    // Realtime 먼저 시도, 실패하면 5초 폴링
    const rt = await ensureRealtime();
    if (!rt && OfficeDB.mode === "realtime") OfficeDB.mode = "poll";
    renderStatus();
    startPolling();          // 실시간이 붙어도 30초 안전망 + 미전송분 재시도
    flushQueue();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(()=>{});
      });
    }
  })();
})();
