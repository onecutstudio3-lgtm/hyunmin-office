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

  /* ---------- 봇 ---------- */
  const BOTS = {
    nari:    { name:"나리",   emoji:"🧡", face:"🧡", label:"오렌지",  color:"nari" },
    dali:    { name:"달이",   emoji:"💙", face:"💙", label:"블루",    color:"dali" },
    hark:    { name:"호크",   emoji:"🦅", face:"🦅", label:"Hark",    color:"dali" },
    claude:  { name:"클로드", emoji:"🤖", face:"🤖", label:"Claude",  color:"nari" },
    keyring: { name:"키링",   emoji:"🔑", face:"🔑", label:"Keyring", color:"dali" }
  };

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
    async insertMemo(text){
      const r = await fetch(this.base() + "/memos", {
        method:"POST",
        headers:this.headers({ "Content-Type":"application/json", "Prefer":"return=representation" }),
        body: JSON.stringify({ text:text })
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
  let currentView = load(LS.ui, {}).view || "room";
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
  async function refreshAll(quiet){
    try{
      const [ms, mm] = await Promise.all([ OfficeDB.selectMessages(), OfficeDB.selectMemos() ]);
      messages = ms || [];
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
    }
  }

  async function pollTick(){
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
  function msgKind(m){
    if (!m) return "system";
    if (m.sender === "user") return "user";
    if (m.sender === "nari") return "nari";
    if (m.sender === "dali") return "dali";
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
      const bot = me ? null : (BOTS[kind] || { name: esc(kind), emoji:"🤖", face:"🤖", label:"AI", color:"dali" });
      const el = document.createElement("div");
      el.className = "msg " + (me ? "me" : (kind === "nari" ? "nari" : "dali"));
      if (me){
        el.innerHTML = '<div class="body"><div class="bubble"></div><div class="foot">' + esc(hhmm(m.created_at)) + '</div></div>';
        el.querySelector(".bubble").textContent = m.text;
      } else {
        el.innerHTML =
          '<div class="face">' + bot.face + '</div>' +
          '<div class="body"><div class="who">' + bot.name +
            '<span class="badge ' + bot.color + '">' + bot.label + '</span>' +
            '<time>' + esc(hhmm(m.created_at)) + '</time></div>' +
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

  $$(".subtab").forEach(t => t.addEventListener("click", () => {
    $$(".subtab").forEach(x => x.setAttribute("aria-selected", "false"));
    t.setAttribute("aria-selected", "true");
    currentRoom = t.dataset.room;
    const meta = {
      all:  ["🏛️ 원컷 · 클립 · 스레드 · 블로그", "ON 2명"],
      nari: ["🧡 나리 · 1:1", "나리 활동 중"],
      dali: ["💙 달이 · 1:1", "달이 활동 중"]
    }[currentRoom];
    $("#roomTitle").textContent = meta[0];
    $("#roomOn").textContent = meta[1];
    $("#msgInput").placeholder = currentRoom === "all"
      ? "대장님, 지시를 한 줄로 (@all = 전원)"
      : "대장님, " + BOTS[currentRoom].name + "에게 한 줄 지시";
    renderRoom();
  }));

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

  /* ---------- 메모 ---------- */
  function renderMemos(){
    const list = $("#memoList"); if (!list) return;
    list.innerHTML = "";
    const count = $("#memoCount"); if (count) count.textContent = memos.length + "개";
    const empty = $("#memoEmpty"); if (empty) empty.style.display = memos.length ? "none" : "block";
    memos.forEach(m => {
      const el = document.createElement("div");
      el.className = "memo";
      el.innerHTML = '<div class="mt"></div><button class="del" aria-label="삭제">✕</button>';
      const when = (() => {
        const d = new Date(m.created_at || Date.now());
        return (d.getMonth()+1) + "." + d.getDate() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
      })();
      el.querySelector(".mt").innerHTML = '<div class="tx"></div><div class="when">' + esc(when) + '</div>';
      el.querySelector(".tx").textContent = m.text;
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
  }
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

  /* ---------- 봇 → 1:1 ---------- */
  $$("[data-open-room]").forEach(b => b.addEventListener("click", () => {
    const r = b.dataset.openRoom;
    setView("room");
    const target = $$(".subtab").find(t => t.dataset.room === r);
    if (target) target.click();
  }));

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

    renderRoom(); renderMemos(); renderTimeline(); renderStatus();
    setView(currentView || "room");

    await OfficeDB.init();
    renderStatus();
    await refreshAll(true);

    // Realtime 먼저 시도, 실패하면 5초 폴링
    const rt = await OfficeDB.connectRealtime((tbl, evt, row) => {
      if (tbl === "messages"){
        if (evt === "insert") upsertMessage(row);
        if (evt === "delete") removeMessage(row && row.id);
      } else {
        if (evt === "insert") upsertMemo(row);
        if (evt === "delete") removeMemo(row && row.id);
      }
    });
    if (!rt) OfficeDB.mode = (OfficeDB.mode === "local") ? "local" : "poll";
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
