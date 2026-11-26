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
      const q = "?select=*&order=created_at.asc&limit=" + (limit || 300);
      const r = await fetch(this.base() + "/messages" + q, { headers:this.headers(), cache:"no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
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
    save(LS.msgs, messages.slice(-300));
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
      return;
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
      const cp = '<button class="copy" type="button" data-copy="' + esc(m.id) + '" aria-label="본문 복사">복사</button>';
      if (me){
        el.innerHTML = '<div class="body"><div class="bubble"></div><div class="foot"><span>' + esc(hhmm(m.created_at)) + '</span>' + cp + '</div></div>';
        el.querySelector(".bubble").textContent = m.text;
      } else {
        el.innerHTML =
          '<div class="face">' + bot.face + '</div>' +
          '<div class="body"><div class="who">' + bot.name +
            '<span class="badge ' + bot.color + '">' + bot.label + '</span>' +
            '<time>' + esc(hhmm(m.created_at)) + '</time>' + cp + '</div>' +
          '<div class="bubble"></div></div>';
        el.querySelector(".bubble").textContent = m.text;
      }
      chat.appendChild(el);
    });
    scrollChat();
  }
  function scrollChat(){
    const c = $("#chat"); if (!c) return;
    requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
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

  async function sendMessage(){
    const input = $("#msgInput");
    const text = input.value.trim();
    if (!text){ input.focus(); return; }
    const row = {
      room: currentRoom === "all" ? "all" : currentRoom,
      sender: "user",
      role: "user",
      text: text
    };
    input.value = "";
    try{
      const saved = await OfficeDB.insertMessage(row);
      if (saved && saved.id) upsertMessage(saved);
      else { renderRoom(); }
      toast("보냈습니다 · 공용 DB에 저장됨");
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
  $("#plusBtn").addEventListener("click", () => {
    toast("첨부는 다음 버전에서 열립니다 · 지금은 텍스트로 지시해 주세요");
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
    const ok = await copyText(m.text);
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
    renderRoom(); renderMemos(); renderTimeline(); renderStatus();
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
