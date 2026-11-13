// รายชื่อห้องออนไลน์ที่เปิดอยู่ตอนนี้ (ใช้ร่วมกัน: หน้าเล่นออนไลน์ใน simulator + หน้าแรก Drive Team Academy)
// ข้อมูลมาจาก /api/rooms (host ส่งป้ายห้องทุก 5 วิระหว่างแข่ง) · เวลาในแมตช์เดินต่อในเครื่องทุก 1 วิ ระหว่างรอข้อมูลรอบถัดไป
// ไม่มีรหัสห้องในรายการ: กด “เข้าชม” แล้วใส่รหัสห้อง (หรือรหัสพิเศษของผู้ดูแล) ให้ถูก ถึงได้รหัสไปต่อเข้าห้องแบบผู้ชม
(() => {
  const API = '/api/rooms', FAST = 5000, SLOW = 30000;
  const AUTO = 30, TRANS = 8, LEN = 158, SID = ['R1', 'R2', 'B1', 'B2'];
  const KIND = { tele: 'TELEOP 2:00', full: 'แมตช์เต็ม', free: 'ซ้อมอิสระ' };
  const st = { data: null, err: '', skew: 0, mounts: new Set(), counts: new Set(), t: null, tk: null, open: null, key: '', msg: '', busy: false, loc: false };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const css = `
.lrW { --lr-red:var(--red,#e4453c); --lr-blu:var(--blu,var(--blue,#3a7bd5)); --lr-ok:var(--grn,var(--ok,#3ec97a)); --lr-acc:var(--yel,var(--acc,#f5c518)); --lr-mut:var(--mut,#9aa4b2); --lr-line:var(--line,rgba(127,127,127,.3)); --lr-bg:var(--surface2,rgba(255,255,255,.05)); font-size:14px; line-height:1.4 }
.lrW .lrHead { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:0 0 6px } .lrW .lrHead h4 { margin:0; font-size:15px } .lrW .lrHint { font-size:12px; color:var(--lr-mut) }
.lrW .lrList { display:flex; flex-direction:column; gap:6px } .lrW .lrList.cap { max-height:var(--lr-max,300px); overflow:auto; padding-right:2px }
.lrW .lrRow { border:1px solid var(--lr-line); border-radius:10px; padding:7px 10px; background:var(--lr-bg) } .lrW .lrRow.play { border-color:color-mix(in srgb, var(--lr-red) 55%, var(--lr-line)) }
.lrW .lrTop { display:flex; align-items:center; gap:10px; flex-wrap:wrap }
.lrW .lrB { font-size:11px; font-weight:800; padding:2px 8px; border-radius:999px; letter-spacing:.5px; white-space:nowrap; display:inline-flex; align-items:center; gap:5px }
.lrW .lrB.play { background:var(--lr-red); color:#fff } .lrW .lrB.lobby { background:color-mix(in srgb, var(--lr-acc) 25%, transparent); color:var(--lr-acc); border:1px solid var(--lr-acc) } .lrW .lrB.res { background:color-mix(in srgb, var(--lr-mut) 25%, transparent); color:var(--lr-mut) }
.lrW .lrB.play i { width:7px; height:7px; border-radius:50%; background:#fff; animation:lrBlink 1.2s ease-in-out infinite }
@keyframes lrBlink { 50% { opacity:.25 } } @media (prefers-reduced-motion: reduce) { .lrW .lrB.play i { animation:none } }
.lrW .lrHost { font-weight:700 } .lrW .lrK { font-size:12px; color:var(--lr-mut) }
.lrW .lrClock { font-variant-numeric:tabular-nums; font-weight:700; white-space:nowrap } .lrW .lrClock small { font-weight:600; color:var(--lr-mut); font-size:11px; margin-left:4px }
.lrW .lrSc { font-size:18px; font-weight:800; font-variant-numeric:tabular-nums; white-space:nowrap } .lrW .lrSc .r { color:var(--lr-red) } .lrW .lrSc .b { color:var(--lr-blu) } .lrW .lrSc span { color:var(--lr-mut); font-weight:400; margin:0 4px }
.lrW .lrV { font-size:12px; color:var(--lr-mut); white-space:nowrap } .lrW .lrSp { flex:1 }
.lrW .lrTeams { display:flex; gap:6px 10px; flex-wrap:wrap; font-size:13px; margin-top:3px } .lrW .lrTeams .r { color:var(--lr-red) } .lrW .lrTeams .b { color:var(--lr-blu) } .lrW .lrTeams em { font-style:normal; color:var(--lr-mut) }
.lrW button { font:inherit; font-size:13px; font-weight:700; border-radius:8px; padding:4px 12px; cursor:pointer; border:1px solid var(--lr-line); background:var(--lr-bg); color:inherit; width:auto; margin:0 }
.lrW button.go { background:var(--lr-acc); color:#111; border-color:transparent } .lrW button:disabled { opacity:.55; cursor:default }
.lrW .lrKey { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:7px; padding-top:7px; border-top:1px dashed var(--lr-line) }
.lrW .lrKey input { font:inherit; font-size:15px; font-weight:700; letter-spacing:2px; padding:4px 8px; width:220px; max-width:100%; border-radius:6px; border:1px solid var(--lr-line) }
.lrW .lrKey input::placeholder { letter-spacing:0; font-weight:400; font-size:13px }
.lrW .lrErr { font-size:13px; font-weight:700; color:var(--bad,#ff7b6b) } .lrW .lrNote { font-size:12px; color:var(--lr-mut) }
.lrW .lrEmpty { font-size:13px; color:var(--lr-mut); padding:6px 2px }`;
  const addCss = () => { if (document.getElementById('lrCss')) return; const s = document.createElement('style'); s.id = 'lrCss'; s.textContent = css; document.head.appendChild(s); };
  const live = () => { for (const m of st.mounts) if (!m.el.isConnected) st.mounts.delete(m); return [...st.mounts]; };
  const seen = () => document.visibilityState !== 'hidden' && live().some(m => m.el.offsetParent !== null);
  const rooms = () => (st.data?.rooms || []);
  // เวลาในแมตช์ตอนนี้: เวลาที่ host ส่งมา + เวลาที่ผ่านไปนับจากนั้น (ปรับนาฬิกาเครื่องให้ตรงเซิร์ฟเวอร์) · ไม่เดินเกิน 20 วิ ถ้า host เงียบไป
  const elNow = r => r.st === 'play' && r.run && !r.free ? r.el + Math.min(20, Math.max(0, (Date.now() + st.skew - r.at) / 1000)) : r.el;
  const clock = r => {
    if (r.st === 'lobby') return 'รอเริ่มแมตช์'; if (r.st === 'res') return 'จบแมตช์แล้ว'; if (r.free) return '∞<small>ซ้อมอิสระ</small>';
    const e = elNow(r), t = e < AUTO ? fmt(AUTO - e) + '<small>AUTO</small>' : e < AUTO + TRANS ? fmt(AUTO + TRANS - e) + '<small>ช่วงเปลี่ยน</small>' : e >= LEN ? '0:00<small>หมดเวลา</small>' : fmt(LEN - e) + '<small>TELEOP</small>';
    return t + (r.run ? '' : '<small>· หยุดอยู่</small>');
  };
  const team = (r, a, cls, ico) => { const s = r.sl.slice(a, a + 2).map((x, i) => x.t === 'none' ? '' : `${SID[a + i]} ${x.t === 'bot' ? '🤖 Bot' : x.n ? '🧑 ' + esc(x.n) : '<em>ว่าง</em>'}`).filter(Boolean); return `<span class="${cls}">${ico} ${s.join(' · ') || '<em>—</em>'}</span>`; };
  const row = r => {
    const hum = r.sl.filter(x => x.t === 'human'), inN = hum.filter(x => x.n).length, open = st.open === r.id;
    const badge = r.st === 'play' ? '<span class="lrB play"><i></i>LIVE</span>' : r.st === 'res' ? '<span class="lrB res">🏁 จบแมตช์</span>' : `<span class="lrB lobby">⏳ รอผู้เล่น ${inN}/${hum.length}</span>`;
    return `<div class="lrRow ${r.st}" data-rid="${esc(r.id)}"><div class="lrTop">${badge}<span class="lrHost" title="เจ้าของห้อง (host)">🏠 ${esc(r.host)}</span><span class="lrK">${esc(KIND[r.kind] || '')}</span>
      <span class="lrSp"></span>${r.st === 'lobby' ? '' : `<span class="lrSc" title="คะแนน RED – BLUE"><b class="r">${r.sc[0]}</b><span>–</span><b class="b">${r.sc[1]}</b></span>`}
      <span class="lrClock" data-clk="${esc(r.id)}">${clock(r)}</span><span class="lrV" title="เครื่องที่ต่ออยู่ (ผู้เล่น + ผู้ชม) ไม่นับ host">🔗 ${r.np} · 👁 ${r.nv}</span>
      <button class="${open ? '' : 'go'}" data-watch="${esc(r.id)}">${open ? 'ปิด' : '👁 เข้าชม'}</button></div>
      <div class="lrTeams">${team(r, 0, 'r', '🔴')}<em>vs</em>${team(r, 2, 'b', '🔵')}</div>
      ${open ? `<div class="lrKey"><input data-key placeholder="รหัสห้อง 6 หลัก" maxlength="128" autocomplete="off" value="${esc(st.key)}"><button class="go" data-go ${st.busy ? 'disabled' : ''}>${st.busy ? 'กำลังตรวจ…' : 'เข้าชม'}</button>
        ${st.msg ? `<span class="lrErr">${esc(st.msg)}</span>` : '<span class="lrNote">ขอรหัสห้องจาก host · เข้าเป็นผู้ชม ไม่รบกวนผู้เล่น</span>'}</div>` : ''}</div>`;
  };
  function paint() {
    const list = rooms(), nP = list.filter(r => r.st === 'play').length;
    for (const fn of st.counts) try { fn(nP, list.length, !!st.data) } catch {}
    for (const m of live()) {
      const ae = document.activeElement, foc = ae?.dataset && 'key' in ae.dataset && m.el.contains(ae), pos = foc ? ae.selectionStart : 0, sc = m.el.querySelector('.lrList')?.scrollTop || 0;
      const body = !st.data ? `<div class="lrEmpty">${st.err ? '⚠ ' + esc(st.err) : 'กำลังโหลดรายการห้อง…'}</div>` : list.length ? list.map(row).join('') : '<div class="lrEmpty">ยังไม่มีห้องออนไลน์เปิดอยู่ตอนนี้ · สร้างห้องได้ที่หน้าเล่นออนไลน์</div>';
      m.el.innerHTML = `<div class="lrW">${m.opt.title === false ? '' : `<div class="lrHead"><h4>${m.opt.title || '📡 ห้องออนไลน์ตอนนี้'} (${list.length}${nP ? ` · กำลังแข่ง ${nP}` : ''})</h4><span class="lrHint">อัปเดตอัตโนมัติ · กด “เข้าชม” แล้วใส่รหัสห้องเพื่อดูการแข่งสด${st.err && st.data ? ' · ⚠ ' + esc(st.err) : ''}</span></div>`}
        <div class="lrList${m.opt.max ? ' cap' : ''}" style="${m.opt.max ? `--lr-max:${+m.opt.max}px` : ''}">${body}</div></div>`;
      const L = m.el.querySelector('.lrList'); if (L) L.scrollTop = sc;
      m.el.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => { const id = b.dataset.watch; st.open = st.open === id ? null : id; st.key = ''; st.msg = ''; paint(); if (st.open) m.el.querySelector('[data-key]')?.focus(); });
      const inp = m.el.querySelector('[data-key]'); if (!inp) continue;
      inp.oninput = () => { st.key = inp.value; };
      inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(m); } };
      m.el.querySelector('[data-go]').onclick = () => go(m);
      if (foc) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch {} }
    }
  }
  async function go(m) {
    const id = st.open, key = st.key.trim(); if (!id || st.busy) return; if (!key) { st.msg = 'ใส่รหัสห้องก่อน'; return paint(); }
    st.busy = true; st.msg = ''; paint();
    let d = null, code = 0;
    try { const r = await fetch(API, { method: 'POST', body: JSON.stringify({ op: 'key', id, key }), signal: AbortSignal.timeout(8000) }); code = r.status; d = await r.json().catch(() => null); } catch {}
    st.busy = false;
    // รหัสพิเศษถูก: จำไว้ในเครื่องนี้ 12 ชม. ให้หน้า simulator เปิดแผงวิเคราะห์ผู้เล่น (เห็นเฉพาะเครื่องนี้) และใช้ยืนยันตอนเรียก AI
    if (d?.ok && d.master) try { localStorage.setItem('bb-mk', JSON.stringify({ k: key.slice(0, 128), exp: Date.now() + 12 * 3600e3 })); } catch {}
    // บัตรผ่านครั้งเดียว: แผงวิเคราะห์เปิดเฉพาะการเข้าชมครั้งที่ใส่รหัสพิเศษ (ห้องนี้ ภายใน 2 นาที) · เข้าด้วยรหัสห้อง = ลบบัตรทิ้ง ไม่เห็นแผงแม้เครื่องเดียวกัน
    if (d?.ok) try { if (d.master && /^\d{6}$/.test(d.code)) localStorage.setItem('bb-ana-ticket', JSON.stringify({ code: d.code, exp: Date.now() + 120e3 })); else localStorage.removeItem('bb-ana-ticket'); } catch {}
    if (d?.ok && /^\d{6}$/.test(d.code)) { const room = rooms().find(r => r.id === id); st.open = null; st.key = ''; st.msg = ''; paint(); m.opt.onWatch?.(d.code, room, !!d.master); return; }
    st.msg = code === 403 ? 'รหัสไม่ถูกต้อง' : code === 404 ? 'ห้องนี้ปิดไปแล้ว' : 'ตรวจรหัสไม่ได้ (เน็ต / เซิร์ฟเวอร์) ลองใหม่'; paint();
    if (code === 404) refresh();
  }
  async function refresh() {
    try {
      const r = await fetch(API + (st.loc ? '?loc=1' : ''), { cache: 'no-store', signal: AbortSignal.timeout(6000) });
      const d = r.ok ? await r.json() : null; if (!d?.ok || !Array.isArray(d.rooms)) throw new Error(r.status === 404 ? 'เว็บนี้ยังไม่มีบริการรายชื่อห้อง' : 'โหลดรายการห้องไม่ได้');
      st.data = d; st.err = ''; st.skew = (+d.now || Date.now()) - Date.now();
      if (st.open && !d.rooms.some(x => x.id === st.open)) { st.open = null; st.msg = ''; }
    } catch (e) { st.err = e?.name === 'TimeoutError' || e instanceof TypeError ? 'โหลดรายการห้องไม่ได้ (เน็ต)' : e?.message || 'โหลดรายการห้องไม่ได้'; }
    paint();
  }
  // เรียกรายการถี่ (5 วิ) เฉพาะตอนรายการแสดงอยู่บนจอ · ซ่อนอยู่ / สลับแท็บ = 30 วิ (นับจำนวนห้องบนปุ่ม) หรือหยุด
  function loop() {
    clearTimeout(st.t); st.t = null;
    const fast = seen(); if (!fast && (!st.counts.size || document.visibilityState === 'hidden')) return;
    st.t = setTimeout(async () => { await refresh(); loop(); }, fast ? FAST : SLOW);
  }
  function tick() {  // นาฬิกาในแถวเดินทุก 1 วิ (แก้เฉพาะตัวเลข ไม่วาดใหม่ทั้งรายการ ช่องรหัสที่กำลังพิมพ์จึงไม่หาย)
    for (const m of live()) m.el.querySelectorAll('[data-clk]').forEach(el => { const r = rooms().find(x => x.id === el.dataset.clk); if (r) el.innerHTML = clock(r); });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden' && (seen() || st.counts.size)) refresh().then(loop); else loop(); });
  window.LiveRooms = {
    mount(el, opt = {}) {
      if (!el) return; addCss(); st.loc = !!opt.loc; for (const m of st.mounts) if (m.el === el) st.mounts.delete(m);
      st.mounts.add({ el, opt }); paint(); st.tk ||= setInterval(tick, 1000);
      if (!st.data || Date.now() + st.skew - (st.data.now || 0) > 2500) refresh().then(loop); else loop();
    },
    onCount(fn, loc) { st.loc = !!loc; st.counts.add(fn); refresh().then(loop); },
    refresh: () => refresh().then(loop), state: st,
  };
})();
