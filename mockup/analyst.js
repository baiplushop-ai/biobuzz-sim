// ผู้ชมพิเศษ (เข้าชมด้วยรหัสพิเศษ): วิเคราะห์การเล่นของ "คนจริง" ทีละคน แบบ real time · ไม่วิเคราะห์ Bot
// คำนวณในเครื่องผู้ชมเครื่องนี้เครื่องเดียว จากข้อมูลที่ผู้ชมได้รับอยู่แล้ว: ไม่แก้ฝั่ง host ไม่ส่งข้อมูลเพิ่มในห้อง
// ผู้เล่นทุกเครื่องจึงไม่ช้าลงและไม่เห็นผลนี้ · ปุ่ม AI ส่งสรุปตัวเลข (ไม่มีชื่อผู้เล่น) ไป /api/analyze จากเครื่องนี้โดยตรง
// เกณฑ์ทุกตัวเป็นค่าประมาณของ simulator ไว้ช่วยโค้ชดู ไม่ใช่กติกา (วงยิง / หยุดนิ่งก่อนยิง = แนวฝึกของทีม)
(() => {
  const MK = 'bb-mk', MK_TTL = 12 * 3600e3, AI_API = '/api/analyze', BUCKET = 20, SID = ['R1', 'R2', 'B1', 'B2'];
  const SLOT_TH = { R1: 'แดง 1', R2: 'แดง 2', B1: 'น้ำเงิน 1', B2: 'น้ำเงิน 2' }, KIND_TH = { tele: 'TELEOP 2:00', full: 'แมตช์เต็ม', free: 'ซ้อมอิสระ' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), r1 = v => Math.round(v * 10) / 10, pc = v => Math.round(v * 100);
  const fmtEl = el => el == null ? '—' : el < 30 ? 'AUTO ' + Math.floor(el) + ' วิ' : (() => { const r = Math.max(0, 158 - el); return Math.floor(r / 60) + ':' + String(Math.floor(r % 60)).padStart(2, '0'); })();  // เวลาที่เหลือในแมตช์ (แบบนาฬิกาบนจอ)
  const fgroup = fs => { const c = {}; for (const f of fs) { const k = f.rule + (f.sev === 'MAJOR' ? ' MAJOR' : f.sev === 'MINOR' ? ' MINOR' : ' เตือน'); c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => n > 1 ? `${k} ×${n}` : k).join(', '); };  // FOUL ซ้ำ = รวมเป็น ×จำนวน
  const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  // รหัสพิเศษเก็บในเครื่องนี้ 12 ชม. (ใช้ยืนยันกับเซิร์ฟเวอร์ตอนกดให้ AI วิเคราะห์) · กด “ออกจากโหมดผู้ชมพิเศษ” เพื่อลบ
  const key = {
    get() { try { const o = JSON.parse(localStorage.getItem(MK) || 'null'); if (o && typeof o.k === 'string' && o.exp > Date.now()) return o.k; localStorage.removeItem(MK); } catch {} return ''; },
    set(k) { try { localStorage.setItem(MK, JSON.stringify({ k: String(k).slice(0, 40), exp: Date.now() + MK_TTL })); } catch {} },
    clear() { try { localStorage.removeItem(MK); } catch {} },
  };

  let M = null, P = {}, reports = [], cur = -1, uiT = 0, panelEl = null;
  // โหมด: rec = แนะนำ (ตัวเลขสด + AI เมื่อกด) · live = AI สรุปสั้นทุก ~5 วิตลอดแมตช์ (นับหลังคำตอบก่อนหน้ามาถึง ไม่ยิงซ้อนกัน) + วิเคราะห์ละเอียดเองตอนจบ
  const MODE_KEY = 'bb-ana-mode', LIVE_GAP = 5000;
  let mode = 'rec'; try { if (localStorage.getItem(MODE_KEY) === 'live') mode = 'live'; } catch {}
  const LV = { busy: false, at: 0, list: [], msg: '', off: '' };
  let autoEnd = true; try { autoEnd = localStorage.getItem('bb-ana-auto') !== '0'; } catch {}
  // ประวัติแมตช์ (เก็บในเครื่องนี้เท่านั้น) ไว้เทียบกับแมตช์ก่อนหน้าของผู้เล่นชื่อเดียวกัน
  const HK = 'bb-ana-hist', HMAX = 60, nkey = n => String(n || '').trim().toLowerCase();
  let HC = null;  // อ่านจาก localStorage ครั้งเดียว แล้วใช้ค่าในหน่วยความจำ (แผงอัปเดตทุก 0.5 วิ)
  const hist = { load() { if (HC) return HC; try { const a = JSON.parse(localStorage.getItem(HK) || '[]'); HC = Array.isArray(a) ? a.filter(h => h && Array.isArray(h.players)) : []; } catch { HC = []; } return HC; },
    save(a) { HC = a.slice(-HMAX); try { localStorage.setItem(HK, JSON.stringify(HC)); } catch {} }, clear() { HC = []; try { localStorage.removeItem(HK); } catch {} } };
  const summ = r => ({ ts: r.ts, kind: r.kind, end: r.end, score: r.score, players: r.players.filter(p => !p.bot && p.intent != null && p.m.T >= 40).map(p => ({ name: p.name, id: p.id, al: p.alliance, i: p.intent, s: p.skill, v: p.v,
    acc: p.m.acc, shots: p.m.shots, hits: p.m.hits, cyc: p.m.cycAvg, mv: p.m.mv, idle: p.m.idleN, wall: p.m.wallPm, fouls: p.fouls.length, T: p.m.T })) });
  const prevOf = (name, before) => !nkey(name) ? [] : hist.load().filter(h => h.ts < before).flatMap(h => h.players.filter(q => nkey(q.name) === nkey(name)).map(q => ({ ...q, ts: h.ts }))).slice(-5);
  const newP = (r, el) => ({ id: r.id, al: r.al, name: r.name, T: 0, mv: 0, spin: 0, path: 0, win: null, stSum: 0, stN: 0, aimless: 0,
    idle: 0, idleN: 0, idleMax: 0, hold: 0, holdN: 0, holdMax: 0, rev: 0, revCd: 0, vh: [], pick: 0, load: null, drops: [], shotsEv: [],
    s0: null, h0: null, c0: null, hit0: null, wall0: null, shots: 0, hits: 0, cyc: [], hitN: 0, wallN: 0, lastShots: null,
    bk: [], fouls: [], ping: 0, miss: 0, from: el, to: el, human: true, gone: false, ser: [], serT: 0 });

  function reset(meta = {}) { M = { kind: meta.kind || '', code: meta.code || '', ts: Date.now(), lastEl: null, endEl: null, done: false, startEl: null, score: { red: 0, blue: 0 } }; P = {}; Object.assign(LV, { busy: false, at: 0, list: [], msg: '', off: '' }); }

  function bucketOf(p) { const i = Math.floor(p.T / BUCKET); while (p.bk.length <= i) p.bk.push({ t: 0, mv: 0, pick: 0, shots: 0, walls: 0, coll: 0 }); return p.bk[i]; }
  function endIdle(p) { if (p.idle >= 6) { p.idleN++; p.idleMax = Math.max(p.idleMax, p.idle); } p.idle = 0; }
  function endHold(p) { if (p.hold >= 25) { p.holdN++; } p.holdMax = Math.max(p.holdMax, p.hold); p.hold = 0; }

  // f: ภาพรวมสนามในเฟรมนี้ (index.html สร้างให้จากข้อมูลที่เครื่องผู้ชมมีอยู่แล้ว)
  function feed(f) {
    if (!M || M.done || !f || !Array.isArray(f.robots)) return;
    M.score = f.score || M.score; M.kind = f.kind || M.kind;
    const play = f.run && (f.ph === 'teleop'), dtRaw = M.lastEl == null ? 0 : f.el - M.lastEl, dt = play && dtRaw > 0 && dtRaw < 0.5 ? dtRaw : 0;
    M.lastEl = f.el;
    for (const r of f.robots) {
      if (!SID.includes(r.id)) continue;
      let p = P[r.id];
      // Bot: คำนวณคะแนนไว้เทียบในแผง (ไม่ส่งให้ AI ไม่เก็บประวัติ) · คนออกกลางแมตช์ (Bot ขับแทน) = เก็บผลของคนไว้ หยุดนับต่อ
      if (!r.human && p && !p.bot) { p.gone = true; continue; }
      if (r.human && p?.bot) p = null;  // คนกลับมาขับตำแหน่งที่เคยเป็น Bot = เริ่มนับใหม่เป็นของคน
      if (!p) p = P[r.id] = Object.assign(newP(r, f.el), { bot: !r.human });
      p.name = p.bot ? 'Bot' : r.name || p.name; p.gone = false; p.ping = r.ping || 0; p.miss = r.miss || 0;
      p.fouls = (f.fouls || []).filter(x => x.by === r.id).map(x => ({ rule: x.rule, sev: x.sev, pts: x.pts, rem: Math.round(x.rem) }));
      if (play && p.s0 == null) { p.s0 = r.shots; p.h0 = r.hits; p.c0 = r.cyc.length; p.hit0 = r.hitN; p.wall0 = r.wallN; p.lastShots = r.shots; M.startEl ??= f.el; }
      const spd = Math.hypot(r.vx, r.vz), w = Math.abs(r.w);
      // ลูกในหุ่นลดลง = ยิง / วาง / คาย · จำตำแหน่งตอนนั้นไว้ แล้วจับคู่กับจำนวนนัดยิงที่ host นับ
      if (p.load != null && r.load < p.load) for (let k = p.load - r.load; k > 0; k--) p.drops.push({ el: f.el, d: r.d, brg: r.brg, v: spd, w, gmin: r.gmin, gmax: r.gmax, used: false });
      if (p.load != null && r.load > p.load && play) { p.pick += r.load - p.load; bucketOf(p).pick += r.load - p.load; }
      p.load = r.load;
      if (p.drops.length > 40) p.drops.splice(0, p.drops.length - 40);
      if (p.lastShots != null && r.shots > p.lastShots) {
        for (let k = r.shots - p.lastShots; k > 0; k--) {
          const dr = [...p.drops].reverse().find(x => !x.used && f.el - x.el < 2) || { el: f.el, d: r.d, brg: r.brg, v: spd, w, gmin: r.gmin, gmax: r.gmax };
          dr.used = true;
          if (p.s0 != null && dr.el >= (M.startEl ?? 0)) {
            p.shotsEv.push({ el: r1(dr.el), d: +dr.d.toFixed(2), gate: dr.d >= dr.gmin && dr.d <= dr.gmax, still: dr.v <= 0.1 && dr.w <= 0.17, aim: dr.brg <= 37, v: +dr.v.toFixed(2) });
            if (play) bucketOf(p).shots++;
          }
          endIdle(p); endHold(p);
        }
      }
      p.lastShots = r.shots; p.shots = r.shots; p.hits = r.hits; p.cyc = r.cyc;
      if (play) {
        const b = bucketOf(p); p.to = f.el;
        if (r.hitN > p.hitN && p.hitN) b.coll += r.hitN - p.hitN; if (r.wallN > p.wallN && p.wallN) b.walls += r.wallN - p.wallN;
      }
      p.hitN = r.hitN; p.wallN = r.wallN;
      if (!dt || r.dead) continue;
      const b = bucketOf(p); p.T += dt; b.t += dt;
      const moving = spd > 0.12 || w > 0.6; if (moving) { p.mv += dt; b.mv += dt; }
      if (w > 1.6 && spd < 0.25) p.spin += dt;
      p.path += spd * dt;
      // ความตรงของเส้นทาง: ทุก 2 วิ เทียบระยะกระจัดกับระยะที่วิ่งจริง (วนไปมา = ค่าต่ำ)
      if (!p.win) p.win = { x: r.x, z: r.z, path: 0, t: 0 };
      p.win.path += spd * dt; p.win.t += dt;
      if (p.win.t >= 2) { if (p.win.path > 0.3) { const s = Math.hypot(r.x - p.win.x, r.z - p.win.z) / p.win.path; p.stSum += s; p.stN++; if (s < 0.3 && p.win.path > 0.8) p.aimless++; } p.win = { x: r.x, z: r.z, path: 0, t: 0 }; }
      // เปลี่ยนทิศกลับหัวกะทันหัน (ภายใน ~0.3 วิ ขณะวิ่งเร็ว) = จอยกระตุกไปมา
      p.vh.push([f.el, r.vx, r.vz]); while (p.vh.length > 2 && f.el - p.vh[0][0] > 0.35) p.vh.shift();
      p.revCd -= dt; const o = p.vh[0];
      if (p.revCd <= 0 && f.el - o[0] > 0.2) { const so = Math.hypot(o[1], o[2]); if (so > 0.35 && spd > 0.35 && (o[1] * r.vx + o[2] * r.vz) / (so * spd) < -0.5) { p.rev++; p.revCd = 0.6; } }
      // จอดนิ่งนาน (ไม่นับช่วง 12 วิสุดท้ายที่มักจอด PARK)
      if (!moving && f.rem > 12) p.idle += dt; else endIdle(p);
      if (r.load > 0) p.hold += dt; else endHold(p);
      if (p.T >= 20 && p.T - p.serT >= 10) { p.serT = p.T; const c = calc(p); p.ser.push({ el: r1(f.el), i: c.intent, s: c.skill }); if (p.ser.length > 40) p.ser.shift(); }  // คะแนนทุก 10 วิ (กราฟตอนจบ)
    }
    if (mode === 'live' && play && !LV.busy && !LV.off && Date.now() - LV.at > LIVE_GAP && Object.values(P).some(p => !p.gone && !p.bot && p.T >= 20)) liveAsk();
    if (performance.now() - uiT > 500) { uiT = performance.now(); paintPanel(); }
  }
  async function liveAsk() {
    const k = key.get(); if (!k) { LV.off = 'ไม่พบรหัสพิเศษในเครื่องนี้'; return; }
    LV.busy = true; LV.at = Date.now(); const s = snapshot(), el = M?.lastEl;
    const [code, res] = await callAI(k, 'brief', s);
    LV.busy = false; LV.at = Date.now();
    if (res?.ok && typeof res.text === 'string') { LV.list.push({ el, at: Date.now(), text: res.text.slice(0, 4000) }); if (LV.list.length > 40) LV.list.shift(); LV.msg = ''; }
    else { LV.msg = aiErr(code, res); if ([403, 501, 413].includes(code) || (code === 429 && res?.why !== 'ai') || ['aikey', 'perm', 'model', 'bad', 'credit', 'fail', 'nokey', 'policy'].includes(res?.why)) LV.off = LV.msg; }  // แก้เองไม่ได้ = หยุดเรียกซ้ำ (ไม่เปลืองโควตา)
    paintPanel();
  }

  // ---- คำนวณคะแนนความตั้งใจ / ฝีมือ ----
  function calc(p) {
    const min = Math.max(p.T, 1) / 60, sh = p.shotsEv, n = sh.length, tShots = p.s0 == null ? 0 : p.shots - p.s0, tHits = p.h0 == null ? 0 : p.hits - p.h0;
    const cyc = p.c0 == null ? [] : p.cyc.slice(p.c0), cycAvg = cyc.length ? cyc.reduce((a, b) => a + b, 0) / cyc.length : 0;
    const share = f => n ? sh.filter(f).length / n : 0;
    const mvS = p.T ? p.mv / p.T : 0, spinS = p.T ? p.spin / p.T : 0, straight = p.stN ? p.stSum / p.stN : 0;
    const coll = p.hit0 == null ? 0 : p.hitN - p.hit0, walls = p.wall0 == null ? 0 : p.wallN - p.wall0;
    const major = p.fouls.filter(f => f.sev === 'MAJOR').length, minor = p.fouls.filter(f => f.sev === 'MINOR').length;
    const m = { T: Math.round(p.T), mv: pc(mvS), spin: pc(spinS), straight: pc(straight), aimless: p.aimless, path: r1(p.path),
      shots: tShots, hits: tHits, acc: tShots ? pc(tHits / tShots) : null, gate: n ? pc(share(s => s.gate)) : null, still: n ? pc(share(s => s.still)) : null, aim: n ? pc(share(s => s.aim)) : null,
      pickPm: r1(p.pick / min), shotPm: r1(tShots / min), hitPm: r1(tHits / min), cyc: cyc.length, cycAvg: r1(cycAvg),
      collPm: r1(coll / min), wallPm: r1(walls / min), coll, walls, revPm: r1(p.rev / min), idleN: p.idleN + (p.idle >= 6 ? 1 : 0), idleMax: Math.round(Math.max(p.idleMax, p.idle)),
      holdN: p.holdN + (p.hold >= 25 ? 1 : 0), holdMax: Math.round(Math.max(p.holdMax, p.hold)), major, minor, ping: Math.round(p.ping), miss: p.miss };
    // ความตั้งใจ: ขยับสม่ำเสมอ + เส้นทางมีเป้าหมาย + ทำงานกับลูก + หันเข้าหา CELL ตอนยิง · หักเมื่อจอยกระตุก ชนผนัง จอดนิ่งนาน
    const act = cl((mvS - 0.15) / 0.45), purp = cl((straight - 0.3) / 0.4) - cl(spinS * 2), work = cl((p.pick + tShots) / min / 10);
    const aimI = n >= 2 ? share(s => s.aim) : p.T < 40 ? 0.5 : 0;
    const pen = m.idleN * 6 + Math.max(0, m.revPm - 6) * 2 + m.wallPm * 4 + p.aimless * 1.5;
    const intent = Math.round(cl(100 * (0.25 * act + 0.25 * cl(purp) + 0.25 * work + 0.25 * aimI) - pen, 0, 100));
    // ฝีมือ: แม่น + ยิงในวงของทีม + cycle เร็ว + ทำแต้มต่อนาที + เล่นสะอาด
    const acc = tShots >= 3 ? tHits / tShots : tShots ? 0.4 : 0, gate = n ? share(s => s.gate) : 0, cyF = cyc.length ? cl((35 - cycAvg) / 20) : 0;
    const clean = 1 - cl(major * 0.5 + minor * 0.2 + m.collPm * 0.1 + m.wallPm * 0.1);
    const skill = Math.round(100 * (0.3 * acc + 0.2 * gate + 0.2 * cyF + 0.15 * cl(m.hitPm / 4) + 0.15 * clean));
    let v, vt;
    if (p.T < 20) { v = 'wait'; vt = '⏳ กำลังเก็บข้อมูล'; }
    else if (mvS < 0.12 && work < 0.1) { v = 'afk'; vt = '⚪ แทบไม่ได้ขับ'; }
    else if (intent >= 65) { v = 'good'; vt = '🟢 ตั้งใจเล่น'; }
    else if (intent >= 40) { v = 'mid'; vt = '🟡 ตั้งใจบ้าง ไม่สม่ำเสมอ'; }
    else { v = 'bad'; vt = '🔴 น่าจะเล่นมั่ว / ไม่ตั้งใจ'; }
    const sl = p.T < 20 ? '—' : skill >= 65 ? 'ดี' : skill >= 40 ? 'พอใช้' : 'ต้องฝึก';
    // เหตุผล: เรียงจากสัญญาณที่เด่นที่สุด
    const R = [];
    if (m.ping > 180 || m.miss > 3) R.push([9, `⚠ เน็ตช้า (ping ${m.ping} ms) อาจทำให้ดูเหมือนขับมั่ว`]);
    if (m.idleN) R.push([6 + m.idleN, `จอดนิ่งเกิน 6 วิ ${m.idleN} ครั้ง (นานสุด ${m.idleMax} วิ)`]);
    if (m.spin >= 12) R.push([m.spin / 3, `หมุนวนอยู่กับที่ ${m.spin}% ของเวลา`]);
    if (p.aimless >= 2) R.push([4 + p.aimless, `วิ่งวนไปมาไร้ทิศทาง ${p.aimless} ช่วง`]);
    if (m.revPm > 6) R.push([m.revPm / 2, `เปลี่ยนทิศกลับไปมากะทันหัน ${m.revPm} ครั้ง/นาที (จอยกระตุก)`]);
    if (m.wallPm >= 1) R.push([m.wallPm * 3, `ชนผนัง ${m.wallPm} ครั้ง/นาที`]);
    if (m.collPm >= 1.5) R.push([m.collPm * 2, `ชนหุ่นอื่น ${m.collPm} ครั้ง/นาที`]);
    if (m.holdN) R.push([5, `ถือลูกค้างนานไม่ยิง ${m.holdN} ครั้ง (นานสุด ${m.holdMax} วิ)`]);
    if (n >= 3 && m.aim < 60) R.push([7, `หันไม่ตรง CELL ตอนยิง ${100 - m.aim}% ของนัด (ยิงทิ้ง)`]);
    if (n >= 3 && m.gate < 50) R.push([5, `ยิงนอกวงของทีม ${100 - m.gate}% ของนัด`]);
    if (n >= 3 && m.still < 50) R.push([3, `ยิงขณะยังไม่หยุดนิ่ง ${100 - m.still}% ของนัด`]);
    if (major + minor) R.push([4 + major * 3, `FOUL ${p.fouls.length} ครั้ง: ${fgroup(p.fouls)}`]);
    if (p.T >= 40 && tShots === 0 && p.pick === 0) R.push([8, 'ยังไม่เก็บลูกและไม่ยิงเลย']);
    if (tShots >= 3 && m.acc >= 60) R.push([2, `ยิงแม่น ${m.acc}% (${tHits}/${tShots})`]);
    if (cyc.length >= 2 && cycAvg <= 22) R.push([2, `cycle เร็ว เฉลี่ย ${m.cycAvg} วิ (${cyc.length} รอบ)`]);
    if (mvS >= 0.6 && straight >= 0.65) R.push([1.5, `ขับมีเป้าหมาย เส้นทางตรง ${m.straight}%`]);
    if (!R.length && p.T >= 20) R.push([0, 'ยังไม่พบสัญญาณผิดปกติ']);
    return { m, intent: p.T < 20 ? null : intent, skill: p.T < 20 ? null : skill, v, vt, sl, why: R.sort((a, b) => b[0] - a[0]).map(x => x[1]) };
  }

  function snapshot(fin) {
    const players = SID.filter(id => P[id]).map(id => { const p = P[id], c = calc(p);
      return { id, alliance: p.al, name: p.name, gone: p.gone, bot: !!p.bot, ...c, ser: p.ser.slice(), prev: p.bot ? [] : prevOf(p.name, M?.ts || Date.now()), bk: p.bk.map(b => ({ t: Math.round(b.t), mv: b.t ? pc(b.mv / b.t) : 0, pick: b.pick, shots: b.shots, walls: b.walls, coll: b.coll })), fouls: p.fouls, shotsEv: p.shotsEv.slice(-40), park: fin?.park ? !!fin.park[id] : null, from: r1(p.from), to: r1(p.to) }; });
    return { v: 1, ts: M?.ts || Date.now(), at: Date.now(), kind: M?.kind || '', score: fin?.score || M?.score || { red: 0, blue: 0 }, end: fin?.reason || 'live', startEl: M?.startEl, endEl: M?.lastEl, players, ai: null };
  }

  // ---- แผงด้านขวา (real time) ----
  const css = `
.anaP { margin:0 0 8px; border:1px solid rgba(245,197,24,.5); border-radius:10px; padding:8px 10px; background:rgba(245,197,24,.06) }
.anaP h4 { margin:0 0 4px !important; color:var(--yel,#f5c518) !important } .anaP .anaHd { display:flex; align-items:center; gap:6px; flex-wrap:wrap }
.anaP .anaHd button, .anaD button { font:inherit; font-size:12px; font-weight:700; padding:3px 9px; border-radius:6px; border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.1); color:inherit; cursor:pointer; width:auto; margin:0 }
.anaD button.go { background:var(--yel,#f5c518); color:#111; border-color:transparent } .anaD button:disabled { opacity:.5; cursor:default }
.anaC { border-top:1px solid rgba(255,255,255,.1); padding:4px 0 2px; font-size:11px; line-height:1.3 } .anaC .nm { font-weight:700; font-size:12px }
.anaC .r { color:var(--red,#e4453c) } .anaC .b { color:#6aa2ff } .anaC .vt { font-weight:700 } .anaC .mut, .anaD .mut { color:var(--mut,#9aa4b2) }
.anaBar { display:flex; align-items:center; gap:6px; margin:2px 0 } .anaBar span { width:54px; flex:0 0 54px; color:var(--mut,#9aa4b2) } .anaBar i { flex:1; height:7px; border-radius:4px; background:rgba(255,255,255,.12); overflow:hidden; display:block }
.anaBar i b { display:block; height:100% } .anaBar em { width:24px; text-align:right; font-style:normal; font-weight:700 }
.anaC ul, .anaD ul { margin:3px 0 0; padding-left:16px } .anaC li { margin:1px 0 }
.anaD { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.55); padding:14px; font-family:Sarabun,system-ui,sans-serif; color:#e9edf3 }
.anaD .bx { background:#151a22; border:1px solid rgba(245,197,24,.55); border-radius:14px; width:min(1500px,100%); max-height:100%; overflow:auto; padding:12px 16px }
.anaD .gr4 { display:grid; gap:10px; margin:8px 0 } .anaD .cd { container-type:inline-size } .anaD .cdT, .anaD .cdC { display:grid; gap:4px 12px; align-items:start }
@container (min-width:460px) { .anaD .cdT { grid-template-columns:minmax(180px,240px) 1fr } .anaD .cdC { grid-template-columns:1fr 1fr; align-items:end } } .anaD .cd ul { font-size:12px } .anaD .cd .anaBig b { font-size:26px }
.anaD .ai.cols { columns:3 300px; column-gap:22px } .anaD .ai.cols h4 { break-after:avoid } .anaD .ai.cols > b:first-child { column-span:all; display:block }
.anaD h2 { margin:0 0 4px; color:var(--yel,#f5c518); font-size:22px } .anaD h3 { margin:0 0 4px; font-size:16px } .anaD .meta { font-size:13px; color:var(--mut,#9aa4b2) }
.anaD .gr { display:grid; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); gap:10px; margin:10px 0 } .anaD .cd { border:1px solid rgba(255,255,255,.14); border-radius:10px; padding:9px 11px; font-size:13px }
.anaD table { width:100%; border-collapse:collapse; font-size:12px; margin:4px 0 } .anaD td { padding:2px 0; border-bottom:1px solid rgba(255,255,255,.07) } .anaD td:last-child { text-align:right; font-weight:700 }
.anaD .tr { display:flex; gap:2px; align-items:flex-end; height:26px; margin:4px 0 } .anaD .tr i { flex:1; background:#3ec97a; min-height:2px; border-radius:2px 2px 0 0; display:block }
.anaD .ai { border:1px solid rgba(106,162,255,.5); border-radius:10px; padding:9px 12px; margin:8px 0; font-size:14px; line-height:1.5; background:rgba(106,162,255,.06) } .anaD .ai h4 { margin:8px 0 2px; font-size:14px; color:#9cc0ff }
.anaD .ft { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:10px } .anaD .sp { flex:1 } .anaD .err { color:#ff7b6b; font-weight:700 } .anaD select { font:inherit; font-size:12px }
.anaT { border-top:1px solid rgba(255,255,255,.1); padding:4px 0 } .anaT > summary { cursor:pointer; font-size:13px; padding:2px 0 } .anaT > summary .mut { font-size:11px; font-variant-numeric:tabular-nums }
.anaT .anaC:first-of-type { border-top:0 } .anaW > summary { margin:2px 0 }
.anaBig { display:grid; grid-template-columns:1fr 1fr; gap:5px; margin:3px 0 2px } .anaBig > div { border:1px solid rgba(255,255,255,.12); border-left-width:4px; border-radius:7px; padding:2px 7px 3px; background:rgba(255,255,255,.04) }
.anaBig .lb { display:block; font-size:10px; color:var(--mut,#9aa4b2) } .anaBig b { font-size:27px; line-height:1; font-weight:800; font-variant-numeric:tabular-nums; color:#e9edf3 } .anaBig em { font-style:normal; font-size:12px; font-weight:700; margin-left:4px }
.anaBig i { display:block; height:4px; border-radius:2px; background:rgba(255,255,255,.12); margin-top:3px; overflow:hidden } .anaBig i s { display:block; height:100%; text-decoration:none }
@media (max-width:700px) { .anaD .bx { padding:12px } .anaD .gr, .anaD .gr4 { grid-template-columns:1fr !important } }`;
  const addCss = () => { if (document.getElementById('anaCss')) return; const s = document.createElement('style'); s.id = 'anaCss'; s.textContent = css; document.head.appendChild(s); };
  const col = v => v == null ? '#9aa4b2' : v >= 65 ? '#3ec97a' : v >= 40 ? '#f5c518' : '#ff7b6b';
  const bar = (t, v) => `<div class="anaBar"><span>${t}</span><i><b style="width:${v ?? 0}%;background:${col(v)}"></b></i><em style="color:${col(v)}">${v ?? '—'}</em></div>`;
  const who = p => `<span class="${p.alliance === 'red' ? 'r' : 'b'}">${esc(SLOT_TH[p.id] || p.id)}</span> · ${esc(p.name || '')}`;

  // ---- กราฟ (SVG ในตัว ใช้ได้ทั้งในหน้าและไฟล์ที่บันทึก) · สี 2 ชุดผ่านการตรวจตาบอดสีบนพื้นมืด · ข้อความใช้สีตัวอักษรปกติ ----
  const CI = '#3987e5', CS = '#d95926', GRID = 'rgba(255,255,255,.12)', INK = '#e9edf3', MUTE = '#9aa4b2', SURF = '#151a22';
  const legend = () => `<div style="display:flex;gap:12px;font-size:11px;color:${MUTE};margin:6px 0 2px"><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${CI};vertical-align:-1px"></i> ความตั้งใจ</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${CS};vertical-align:-1px"></i> ฝีมือ</span></div>`;
  function lineSvg(ser) {
    if (!ser || ser.length < 2) return '';
    const W = 300, H = 104, L = 24, R = 62, T = 8, B = 18, x0 = ser[0].el, x1 = ser.at(-1).el;
    const X = t => L + (t - x0) / Math.max(1, x1 - x0) * (W - L - R), Y = v => T + (100 - v) / 100 * (H - T - B);
    const path = k => ser.map((p, i) => `${i ? 'L' : 'M'}${X(p.el).toFixed(1)},${Y(p[k]).toFixed(1)}`).join('');
    const grid = [0, 40, 65, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${GRID}" ${v === 40 || v === 65 ? 'stroke-dasharray="3 3"' : ''}/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end" font-size="9" fill="${MUTE}">${v}</text>`).join('');
    const e = ser.at(-1); let yi = Y(e.i), ys = Y(e.s); if (Math.abs(yi - ys) < 14) { const m = (yi + ys) / 2, d = yi <= ys ? -7 : 7; yi = m + d; ys = m - d; }
    const hit = ser.map(p => `<circle cx="${X(p.el)}" cy="${Y(Math.max(p.i, p.s))}" r="7" fill="transparent"><title>เวลา ${fmtEl(p.el)} · ตั้งใจ ${p.i} · ฝีมือ ${p.s}</title></circle>`).join('');
    return `${legend()}<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="คะแนนความตั้งใจและฝีมือระหว่างแมตช์ ล่าสุด ตั้งใจ ${e.i} ฝีมือ ${e.s}" style="display:block;max-width:440px">${grid}
      <path d="${path('i')}" fill="none" stroke="${CI}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><path d="${path('s')}" fill="none" stroke="${CS}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(e.el)}" cy="${Y(e.i)}" r="4" fill="${CI}" stroke="${SURF}" stroke-width="2"/><circle cx="${X(e.el)}" cy="${Y(e.s)}" r="4" fill="${CS}" stroke="${SURF}" stroke-width="2"/>
      <text x="${X(e.el) + 8}" y="${yi + 3}" font-size="10" fill="${INK}">ตั้งใจ ${e.i}</text><text x="${X(e.el) + 8}" y="${ys + 3}" font-size="10" fill="${INK}">ฝีมือ ${e.s}</text>
      <text x="${L}" y="${H - 4}" font-size="9" fill="${MUTE}">${fmtEl(x0)}</text><text x="${W - R}" y="${H - 4}" font-size="9" fill="${MUTE}" text-anchor="end">${fmtEl(x1)} (เวลาที่เหลือ)</text>${hit}</svg>`;
  }
  function barsSvg(items) {  // items: [{ lab, i, s, cur }] เรียงเก่า → ใหม่
    const W = 300, H = 104, L = 24, R = 6, T = 14, B = 20, n = items.length, gw = (W - L - R) / n, bw = Math.min(16, gw * 0.32), Y = v => T + (100 - v) / 100 * (H - T - B), base = Y(0);
    const rb = (x, v, c, t) => { const y = Math.min(Y(v), base - 2), h = base - y, r = Math.min(4, h / 2, bw / 2); return `<path d="M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${base}Z" fill="${c}"><title>${t}</title></path>`; };
    const grid = [0, 40, 65, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${GRID}" ${v === 40 || v === 65 ? 'stroke-dasharray="3 3"' : ''}/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end" font-size="9" fill="${MUTE}">${v}</text>`).join('');
    const g = items.map((it, k) => { const cx = L + gw * k + gw / 2, xi = cx - bw - 1, xs = cx + 1;
      return rb(xi, it.i ?? 0, CI, `${it.lab} · ตั้งใจ ${it.i ?? '—'}`) + rb(xs, it.s ?? 0, CS, `${it.lab} · ฝีมือ ${it.s ?? '—'}`) +
        (it.cur ? `<text x="${xi + bw / 2}" y="${Y(it.i ?? 0) - 3}" font-size="9" fill="${INK}" text-anchor="middle">${it.i}</text><text x="${xs + bw / 2}" y="${Y(it.s ?? 0) - 3}" font-size="9" fill="${INK}" text-anchor="middle">${it.s}</text>` : '') +
        `<text x="${cx}" y="${H - 5}" font-size="9" fill="${it.cur ? INK : MUTE}" text-anchor="middle" ${it.cur ? 'font-weight="700"' : ''}>${esc(it.lab)}</text>`; }).join('');
    return `${legend()}<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="เทียบคะแนนกับแมตช์ก่อนหน้า" style="display:block;max-width:440px">${grid}${g}</svg>`;
  }
  function cmpBlock(p) {
    if (p.intent == null) return '';
    const prev = p.prev || [];
    if (!prev.length) return `<div class="mut" style="font-size:11px;margin-top:4px">ยังไม่มีแมตช์ก่อนหน้าของ “${esc(p.name || '')}” ในเครื่องนี้ไว้เทียบ</div>`;
    const avg = k => Math.round(prev.reduce((a, q) => a + (q[k] ?? 0), 0) / prev.length), di = p.intent - avg('i'), ds = p.skill - avg('s');
    const sg = d => `<b style="color:${d >= 5 ? '#3ec97a' : d <= -5 ? '#ff7b6b' : INK}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}</b>`;
    const items = [...prev.map((q, i) => ({ lab: `−${prev.length - i}`, i: q.i, s: q.s, t: q.ts })), { lab: 'แมตช์นี้', i: p.intent, s: p.skill, cur: true }];
    const accP = prev.filter(q => q.acc != null), accD = p.m.acc != null && accP.length ? p.m.acc - Math.round(accP.reduce((a, q) => a + q.acc, 0) / accP.length) : null;
    return `<div style="margin-top:8px;font-size:12px"><b>เทียบแมตช์ก่อนหน้า</b> <span class="mut">(${prev.length} แมตช์ · ชื่อเดียวกันในเครื่องนี้)</span><br>เทียบค่าเฉลี่ย: ตั้งใจ ${sg(di)} · ฝีมือ ${sg(ds)}${accD != null ? ` · ความแม่น ${sg(accD)}%` : ''}</div>${barsSvg(items)}`;
  }

  function mount(el) {
    addCss(); panelEl = el;
    if (!el.dataset.tg) { el.dataset.tg = '1'; el.addEventListener('toggle', e => { const k = e.target?.dataset?.k; if (!k || !(k in OPEN) || OPEN[k] === e.target.open) return; OPEN[k] = e.target.open; try { localStorage.setItem('bb-ana-open', JSON.stringify(OPEN)); } catch {} if (k === 'why') el.querySelectorAll('details[data-k="why"]').forEach(d => { d.open = OPEN.why; }); }, true); }  // toggle ไม่ bubble = ดักแบบ capture
    paintPanel();
  }
  // คะแนนตัวใหญ่ (สด) · ลูกศร = เปลี่ยนจากเมื่อ ~10 วิก่อน · สีขอบ/แถบ = ระดับ (เขียว ≥ 65 · เหลือง 40–64 · แดง < 40) คู่กับข้อความระดับเสมอ
  function big(p) {
    const last = p.ser?.at(-1), tile = (lb, v, k) => { const d = v != null && last ? v - last[k] : 0;
      return `<div style="border-left-color:${col(v)}"><span class="lb">${lb}</span><b>${v ?? '—'}</b>${Math.abs(d) >= 3 ? `<em style="color:${d > 0 ? '#3ec97a' : '#ff7b6b'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</em>` : ''}<i><s style="width:${v ?? 0}%;background:${col(v)}"></s></i></div>`; };
    return `<div class="anaBig" aria-label="คะแนนความตั้งใจ ${p.intent ?? 'ยังไม่มี'} ฝีมือ ${p.skill ?? 'ยังไม่มี'}">${tile('ความตั้งใจ', p.intent, 'i')}${tile('ฝีมือ', p.skill, 's')}</div>`;
  }
  function setMode(v) { mode = v === 'live' ? 'live' : 'rec'; try { localStorage.setItem(MODE_KEY, mode); } catch {} if (mode === 'live') { LV.off = ''; LV.at = Date.now() - LIVE_GAP + 3000; } paintPanel(); }
  // แผงด้านขวา: ครบ 4 หุ่น แยกทีมแดง / น้ำเงิน (หุบได้แยกทีม) · ข้อความเหตุผล และการตั้งค่า หุบได้ · จำสถานะไว้ในเครื่อง
  const OPEN = { red: true, blue: true, why: true, ctl: false }; try { Object.assign(OPEN, JSON.parse(localStorage.getItem('bb-ana-open') || '{}')); } catch {}
  const op = k => OPEN[k] ? 'open' : '';
  function card(p) {
    if (p.bot) return `<div class="anaC"><div class="nm">${who(p)} <span class="mut" style="font-weight:400;font-size:11px">🤖 Bot · อ้างอิง (ไม่ส่งให้ AI)</span></div>${big(p)}</div>`;
    return `<div class="anaC"><div class="nm">${who(p)}${p.gone ? ' <span class="mut" style="font-weight:400">(ออกแล้ว → Bot)</span>' : ''}</div>${big(p)}<div class="vt">${p.vt} <span class="mut" style="font-weight:400">· ฝีมือ ${p.sl}</span></div>
      <details class="anaW" data-k="why" ${op('why')}><summary class="mut" style="cursor:pointer;font-size:11px">ข้อความ (${p.why.length})</summary>
      <div class="mut">ยิง ${p.m.hits}/${p.m.shots}${p.m.acc != null ? ` (${p.m.acc}%)` : ''} · ขยับ ${p.m.mv}% · เก็บ ${p.m.pickPm}/นาที${p.m.cyc ? ` · cycle ${p.m.cycAvg} วิ` : ''}</div>
      <ul>${p.why.slice(0, 2).map(w => `<li>${esc(w)}</li>`).join('')}</ul></details></div>`;
  }
  function paintPanel() {
    if (!panelEl || !panelEl.isConnected) return;
    const s = snapshot(), teams = ['red', 'blue'].map(c => {
      const ps = s.players.filter(p => p.alliance === c), short = ps.map(p => `${p.id} ${p.bot ? '🤖' : p.intent ?? '…'}${p.bot ? '' : '·' + (p.skill ?? '…')}`).join(' · ');
      return `<details class="anaT" data-k="${c}" ${op(c)}><summary><b class="${c === 'red' ? 'r' : 'b'}">${c === 'red' ? '🔴 ทีมแดง' : '🔵 ทีมน้ำเงิน'}</b> <span class="mut">${short || 'ไม่มีหุ่น'}</span></summary>${ps.map(card).join('') || '<div class="anaC mut">ยังไม่มีข้อมูล (รอแมตช์เริ่ม)</div>'}</details>`; }).join('');
    const dyn = `${teams}
      ${mode === 'live' ? `<div class="anaC"><b style="color:#9cc0ff">🤖 AI สด</b> <span class="mut">${LV.busy ? 'กำลังวิเคราะห์…' : LV.off ? 'หยุดแล้ว: ' + esc(LV.off) : LV.list.length ? `ล่าสุดเวลา ${fmtEl(LV.list.at(-1).el)}` : 'รอข้อมูลครบ 20 วิ'}</span>${LV.msg && !LV.off ? `<div style="color:#ff7b6b">${esc(LV.msg)}</div>` : ''}
        ${LV.list.length ? `<div style="margin-top:3px;line-height:1.45">${mdLite(LV.list.at(-1).text)}</div>` : ''}</div>` : ''}`, ck = mode + '|' + autoEnd, box = panelEl.querySelector('.anaDyn');
    if (box && panelEl.dataset.ck === ck) { box.innerHTML = dyn; return; }  // อัปเดตเฉพาะคะแนน: เมนูโหมดไม่หุบเองระหว่างเลือก
    panelEl.dataset.ck = ck;
    panelEl.innerHTML = `<div class="anaP"><div class="anaHd"><h4>📊 วิเคราะห์ผู้เล่น (เห็นเฉพาะคุณ)</h4><span style="flex:1"></span><button data-ana="open">รายงาน + AI</button></div><div class="anaDyn">${dyn}</div>
      <details class="anaT" data-k="ctl" ${op('ctl')}><summary class="mut">⚙️ ตั้งค่าการวิเคราะห์ · ${mode === 'live' ? 'AI สดตลอดแมตช์' : 'แนะนำ'}</summary><div class="anaC" style="border:0"><label style="display:flex;gap:6px;align-items:center;margin:0">โหมด <select data-ana="mode" style="font:inherit;font-size:12px;flex:1"><option value="rec" ${mode === 'rec' ? 'selected' : ''}>แนะนำ: ตัวเลขสด + AI เมื่อกด</option><option value="live" ${mode === 'live' ? 'selected' : ''}>AI สดตลอดแมตช์ (ทุก ~5 วิ)</option></select></label>
        <div class="mut" style="font-size:11px;margin-top:2px">${mode === 'live' ? 'AI สรุปสั้นทุก ~5 วิ (หลังคำตอบก่อนหน้ามาถึง) และสรุปละเอียดตอนจบ · ประมาณ 15–25 ครั้ง/แมตช์' : `ระหว่างแมตช์ไม่เรียก AI · ${autoEnd ? 'AI สรุปตอนจบให้เอง 1 ครั้ง' : 'กด “รายงาน + AI” เมื่อต้องการ'}`}</div>
        ${mode === 'rec' ? `<label style="display:flex;gap:6px;align-items:center;margin:3px 0 0;font-size:12px"><input type="checkbox" data-ana="auto" ${autoEnd ? 'checked' : ''}> ให้ AI สรุปผลตอนจบแมตช์อัตโนมัติ</label>` : ''}
        <div class="mut" style="font-size:11px;margin-top:4px">เกณฑ์เป็นค่าประมาณของ simulator ไว้ช่วยโค้ชดู ไม่ใช่กติกา · ผู้เล่นไม่เห็นแผงนี้ · คำนวณในเครื่องนี้ ไม่ทำให้เครื่องผู้เล่นช้า · Bot แสดงไว้เทียบเท่านั้น</div></div></details></div>`;
    panelEl.querySelector('[data-ana="open"]').onclick = () => openDlg(null);
    panelEl.querySelector('[data-ana="mode"]').onchange = e => setMode(e.target.value);
    const au = panelEl.querySelector('[data-ana="auto"]'); if (au) au.onchange = e => { autoEnd = e.target.checked; try { localStorage.setItem('bb-ana-auto', autoEnd ? '1' : '0'); } catch {} paintPanel(); };
  }

  function finish(fin = {}) {
    if (!M || M.done) return null; M.done = true; M.endEl = M.lastEl;
    for (const p of Object.values(P)) { endIdle(p); endHold(p); }
    const s = snapshot(fin); if (!s.players.some(p => !p.bot)) return null;  // ไม่มีคนจริงเลย = ไม่ต้องมีรายงาน
    s.aiLive = LV.list.map(x => ({ el: x.el, text: x.text }));
    { const sm = summ(s); if (sm.players.length) hist.save([...hist.load(), sm]); }  // เก็บไว้เทียบแมตช์ถัดไป
    reports.push(s); if (reports.length > 20) reports.shift(); cur = reports.length - 1; openDlg(cur);
    if ((autoEnd || mode === 'live') && !LV.off && s.players.some(p => !p.bot && p.intent != null)) askAI(s);  // จบแมตช์: AI สรุปผล + เทียบแมตช์ก่อนหน้าให้เลย
    return s;
  }

  // ---- กล่องรายงาน (เปิดค้างจนกว่าจะกดปิดเอง) ----
  let dlg = null, live = null, aiBusy = false, aiMsg = '';
  const rep = () => cur >= 0 && reports[cur] ? reports[cur] : live;
  function openDlg(i) { addCss(); if (i == null) { live = snapshot(); cur = -1; } aiMsg = ''; paintDlg(); }
  function closeDlg() { dlg?.remove(); dlg = null; }
  // รายงานพอดี 1 หน้าจอ (ไม่ต้องเลื่อน): วัดความสูงจริง ถ้าเกินจอให้ย่อทั้งกล่องลง (ไม่ต่ำกว่า 50% · จอเล็กมากค่อยเลื่อนได้)
  function fitDlg() {
    const bx = dlg?.querySelector('.bx'); if (!bx) return;
    const aw = innerWidth - 24, ah = innerHeight - 24;
    Object.assign(bx.style, { zoom: '', width: '', maxHeight: 'none', overflow: 'visible' });
    let z = 1;
    for (let k = 0; k < 4; k++) {  // ย่อแล้วกล่องแคบลงด้วย = ขยายความกว้างกลับให้เต็มจอ แล้ววัดใหม่ (กว้างขึ้น = เตี้ยลง = ย่อน้อยลง)
      const h = bx.scrollHeight * z; if (h <= ah) break;
      z = Math.max(0.5, Math.floor(z * ah / h * 100) / 100);
      Object.assign(bx.style, { zoom: String(z), width: Math.min(1500 / z, aw / z) + 'px' });
      if (z === 0.5) break;
    }
    Object.assign(bx.style, z < 1 ? { maxHeight: Math.floor(ah / z) + 'px', overflow: 'auto' } : { width: '', maxHeight: '', overflow: '' });
  }
  addEventListener('resize', () => { if (dlg) fitDlg(); });
  function mdLite(t) {  // ข้อความจาก AI: escape ก่อน แล้วแปลงหัวข้อ / รายการ / ตัวหนาแบบง่าย
    return esc(t).split('\n').map(l => { l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      if (/^#{1,4}\s/.test(l)) return `<h4>${l.replace(/^#{1,4}\s/, '')}</h4>`; if (/^\s*[-•*]\s/.test(l)) return `<div style="padding-left:14px;text-indent:-10px">• ${l.replace(/^\s*[-•*]\s/, '')}</div>`; return l.trim() ? `<div>${l}</div>` : ''; }).join('');
  }
  function body(r, forFile) {
    const sc = r.score || {}, t = new Date(r.ts);
    const head = `<div class="meta">${esc(t.toLocaleString('th-TH'))} · ${esc(KIND_TH[r.kind] || r.kind || '')} · สกอร์ <b style="color:#e4453c">${sc.red ?? 0}</b> – <b style="color:#6aa2ff">${sc.blue ?? 0}</b> · ${r.end === 'end' ? 'จบแมตช์' : r.end === 'lost' ? 'ห้องปิด / หลุดก่อนจบ (ข้อมูลไม่ครบแมตช์)' : 'ระหว่างแมตช์ (ข้อมูลถึงตอนนี้)'}</div>`;
    const hum = r.players.filter(p => !p.bot), bots = r.players.filter(p => p.bot);
    const botBox = bots.length ? `<details class="cd" style="margin:0 0 10px"><summary style="cursor:pointer"><b>🤖 Bot ${bots.length} ตัว</b> <span class="mut">(อ้างอิงไว้เทียบ ไม่ประเมิน ไม่ส่งให้ AI)</span></summary><div class="gr">${bots.map(p => `<div>${who(p)}${big(p)}</div>`).join('')}</div></details>` : '';
    const cards = hum.map(p => { const m = p.m, tr = p.bk.length ? `<div class="mut" style="font-size:11px;margin-top:4px">การขยับทุก 20 วิ (ช่วงหลังตกลง = ล้า / เลิกพยายาม)</div><div class="tr">${p.bk.map(b => `<i title="${b.mv}% · เก็บ ${b.pick} · ยิง ${b.shots}" style="height:${Math.max(4, b.mv)}%;background:${CI}"></i>`).join('')}</div>` : '';
      const rows = [['เวลา TELEOP ที่เก็บข้อมูล', fmt(m.T)], ['เวลาที่ขยับ', m.mv + '%'], ['ความตรงของเส้นทาง', m.straight + '%'], ['หมุนวนอยู่กับที่', m.spin + '%'],
        ['ยิง / เข้า', `${m.hits}/${m.shots}${m.acc != null ? ` (${m.acc}%)` : ''}`], ['ยิงในวงของทีม', m.gate != null ? m.gate + '%' : '—'], ['หยุดนิ่งก่อนยิง', m.still != null ? m.still + '%' : '—'], ['หันตรง CELL ตอนยิง', m.aim != null ? m.aim + '%' : '—'],
        ['เก็บลูก', m.pickPm + ' /นาที'], ['cycle', m.cyc ? `${m.cyc} รอบ · เฉลี่ย ${m.cycAvg} วิ` : '—'], ['ชนผนัง / ชนหุ่น', `${m.walls} / ${m.coll} ครั้ง`], ['เปลี่ยนทิศกะทันหัน', m.revPm + ' /นาที'],
        ['จอดนิ่งเกิน 6 วิ', m.idleN ? `${m.idleN} ครั้ง (นานสุด ${m.idleMax} วิ)` : '—'], ['ถือลูกค้างเกิน 25 วิ', m.holdN ? `${m.holdN} ครั้ง` : '—'], ['FOUL', p.fouls.length ? esc(fgroup(p.fouls)) : 'ไม่มี'],
        ['PARK ตอนจบ', p.park == null ? '—' : p.park ? 'ใช่' : 'ไม่'], ['ping เฉลี่ย', m.ping ? m.ping + ' ms' : '—']];
      const li = w => `<li>${esc(w)}</li>`, more = p.why.slice(4);
      return `<div class="cd"><h3 class="anaC" style="border:0;padding:0">${who(p)}${p.gone ? ' <span class="mut">(ออกกลางแมตช์ → Bot)</span>' : ''}</h3>
        <div style="font-weight:700;font-size:13px">${p.vt} · ฝีมือ ${p.sl}</div>
        <div class="cdT"><div>${big(p)}</div><div><ul>${p.why.slice(0, 4).map(li).join('')}</ul>${more.length ? (forFile ? `<ul>${more.map(li).join('')}</ul>` : `<details><summary class="mut" style="cursor:pointer;font-size:11px">อีก ${more.length} ข้อ</summary><ul>${more.map(li).join('')}</ul></details>`) : ''}</div></div>
        <div class="cdC"><div>${lineSvg(p.ser)}</div><div>${cmpBlock(p)}</div></div>${tr}<details ${forFile ? 'open' : ''}><summary class="mut" style="cursor:pointer;font-size:12px">📋 ตัวเลขทั้งหมด</summary><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table></details></div>`; }).join('');
    const lv = r.aiLive?.length ? `<details class="ai"><summary style="cursor:pointer"><b>🤖 AI สดระหว่างแมตช์</b> <span class="mut" style="font-size:12px">${r.aiLive.length} ครั้ง</span></summary>${r.aiLive.map(x => `<h4>เวลาในแมตช์ ${fmtEl(x.el)}</h4>${mdLite(x.text)}`).join('')}</details>` : '';
    const ai = r.ai ? `<div class="ai cols"><b>🤖 ผลวิเคราะห์จาก AI</b> <span class="mut" style="font-size:12px">${esc(r.ai.model || '')} · ${esc(new Date(r.ai.at).toLocaleTimeString('th-TH'))}</span>${mdLite(r.ai.text)}</div>` : '';
    return head + (hum.length ? `<div class="gr4" style="grid-template-columns:repeat(${forFile ? 'auto-fill' : hum.length}, minmax(${forFile ? '300px' : '0'}, 1fr))">${cards}</div>` : '<p class="mut">ไม่มีคนจริงในแมตช์นี้ (Bot ไม่วิเคราะห์)</p>') + ai + lv + botBox +
      `<p class="mut" style="font-size:12px">เกณฑ์เป็นค่าประมาณของ simulator ไว้ช่วยโค้ชดู ไม่ใช่กติกา FTC · “วงยิง” และ “หยุดนิ่งก่อนยิง” เป็นแนวฝึกของทีม${forFile ? '' : ' · ผู้เล่นไม่เห็นรายงานนี้'}</p>`;
  }
  function paintDlg() {
    const r = rep(); if (!r) return;
    if (!dlg) { dlg = document.createElement('div'); dlg.className = 'anaD'; document.body.appendChild(dlg); dlg.addEventListener('toggle', fitDlg, true); }
    const opts = reports.map((x, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>แมตช์ ${i + 1} · ${new Date(x.ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · ${x.score.red}-${x.score.blue}</option>`).join('');
    dlg.innerHTML = `<div class="bx" role="dialog" aria-label="ผลประเมินผู้เล่น"><h2>📊 ผลประเมินผู้เล่น</h2><div class="meta">เห็นเฉพาะผู้ชมพิเศษเครื่องนี้ · ผู้เล่นและ host ไม่ได้รับข้อมูลนี้</div>
      ${body(r)}
      <div class="ft"><button class="go" data-a="ai" ${aiBusy || !r.players.some(p => !p.bot) ? 'disabled' : ''}>${aiBusy ? '🤖 AI กำลังวิเคราะห์… (ไม่เกิน 1 นาที)' : r.ai ? '🤖 ให้ AI วิเคราะห์ใหม่' : '🤖 ให้ AI วิเคราะห์ละเอียด'}</button>
        <span class="${/ไม่|ผิด|เกิน|หลุด/.test(aiMsg) ? 'err' : 'mut'}" style="font-size:13px">${esc(aiMsg)}</span>
      <button data-a="html">💾 บันทึกไฟล์ (.html)</button><button data-a="json">💾 ข้อมูลดิบ (.json)</button>
        ${cur < 0 ? '<button data-a="refresh">🔄 อัปเดตตัวเลขล่าสุด</button>' : ''}${reports.length > 1 || (cur < 0 && reports.length) ? `<select data-a="pick"><option value="-1" ${cur < 0 ? 'selected' : ''}>ตอนนี้ (สด)</option>${opts}</select>` : ''}
        <span class="sp"></span><button data-a="hclear" title="ลบประวัติที่ใช้เทียบแมตช์ก่อนหน้า (เก็บในเครื่องนี้)">🗑 ล้างประวัติเทียบ (${hist.load().length})</button><button data-a="logout" title="ลบรหัสพิเศษออกจากเครื่องนี้">🚪 ออกจากโหมดผู้ชมพิเศษ</button><button class="go" data-a="close">✕ ปิด</button></div></div>`;
    const on = (a, fn) => { const b = dlg.querySelector(`[data-a="${a}"]`); if (b) b[a === 'pick' ? 'onchange' : 'onclick'] = fn; };
    fitDlg(); requestAnimationFrame(fitDlg);
    on('close', closeDlg); on('html', () => save(r, 'html')); on('json', () => save(r, 'json')); on('ai', () => askAI(r));
    on('refresh', () => { live = snapshot(); paintDlg(); });
    on('hclear', () => { if (!confirm('ลบประวัติแมตช์ที่ใช้เทียบทั้งหมดในเครื่องนี้?\n(รายงานที่เปิดอยู่ไม่หาย)')) return; hist.clear(); paintDlg(); });
    on('pick', e => { cur = +e.target.value; if (cur < 0) live = snapshot(); aiMsg = ''; paintDlg(); });
    on('logout', () => { if (!confirm('ลบรหัสพิเศษออกจากเครื่องนี้?\nแผงวิเคราะห์จะหายไปตั้งแต่ห้องถัดไป (ต้องใส่รหัสพิเศษใหม่)')) return; key.clear(); aiMsg = 'ลบรหัสพิเศษออกจากเครื่องนี้แล้ว'; paintDlg(); });
  }
  function save(r, kind) {
    const d = new Date(r.ts), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const txt = kind === 'json' ? JSON.stringify(r, null, 2) : `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BIOBUZZ ผลประเมินผู้เล่น ${stamp}</title>
<style>body{margin:0;background:#151a22;color:#e9edf3;font-family:Sarabun,system-ui,sans-serif}${css.replace(/\.anaD \{[^}]*\}/, '.anaD{padding:16px}')}@media print{body,.anaD .bx{background:#fff;color:#000}.anaD .cd,.anaD .ai{border-color:#999}}</style></head>
<body><div class="anaD" style="position:static;background:none"><div class="bx" style="max-height:none"><h2>📊 BIOBUZZ ผลประเมินผู้เล่น</h2>${body(r, true)}</div></div></body></html>`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: kind === 'json' ? 'application/json' : 'text/html' }));
    a.download = `biobuzz-analysis-${stamp}.${kind}`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // ส่งให้ AI เฉพาะตัวเลข: ไม่มีชื่อผู้เล่น ไม่มีรหัสห้อง (ชื่อจับคู่กลับในเครื่องนี้ด้วยตำแหน่ง R1 / B1 …)
  const forAI = r => ({ kind: r.kind, end: r.end, score: r.score, window: { from: r.startEl, to: r.endEl }, players: r.players.filter(p => !p.bot).map(p => ({ id: p.id, alliance: p.alliance, leftMidMatch: p.gone, verdict: p.v, intent: p.intent, skill: p.skill, metrics: p.m, notes: p.why, every20s: p.bk, fouls: p.fouls, park: p.park, shots: p.shotsEv,
    scoreEvery10s: p.ser, previousMatches: (p.prev || []).map((q, i, a) => ({ matchesAgo: a.length - i, intent: q.i, skill: q.s, verdict: q.v, acc: q.acc, shots: q.shots, hits: q.hits, cycAvg: q.cyc, moving: q.mv, idleN: q.idle, wallPm: q.wall, fouls: q.fouls, teleopSec: q.T })) })) });
  async function askAI(r) {
    if (aiBusy) return; const k = key.get(); if (!k) { aiMsg = 'ไม่พบรหัสพิเศษในเครื่องนี้ (หมดอายุ 12 ชม.) ออกแล้วเข้าชมใหม่ด้วยรหัสพิเศษ'; return paintDlg(); }
    aiBusy = true; aiMsg = ''; if (dlg) paintDlg();
    const [code, res] = await callAI(k, 'full', r);
    aiBusy = false;
    if (res?.ok && typeof res.text === 'string') { r.ai = { text: res.text.slice(0, 20000), model: String(res.model || '') + (res.via ? ' · ' + res.via : ''), at: Date.now() }; aiMsg = 'เสร็จแล้ว · บันทึกไฟล์ได้ทันที (ผล AI รวมอยู่ในไฟล์)'; }
    else aiMsg = aiErr(code, res);
    if (dlg) paintDlg();
  }
  // รุ่น AI และคีย์ตั้งที่ Netlify (OPENROUTER_API_KEY · OPENROUTER_MODEL) · ทดสอบได้ที่หน้า home → ตั้งค่า
  async function callAI(k, kind, r) {
    try { const q = await fetch(AI_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: k, mode: kind, report: forAI(r) }), signal: AbortSignal.timeout(70000) }); return [q.status, await q.json().catch(() => null)]; }
    catch { return [0, null]; }
  }
  const aiErr = (code, res) => (code !== 403 && typeof res?.msg === 'string' && res.msg ? res.msg.slice(0, 200) : null) || ({ 403: 'รหัสพิเศษไม่ถูกต้อง', 501: 'ยังไม่ได้ตั้งคีย์ AI ใน Netlify (OPENROUTER_API_KEY)', 429: res?.why === 'ai' ? 'AI ไม่ว่าง ลองใหม่อีกครั้งในอีกสักครู่' : 'เรียก AI ถี่เกินโควตา (ต่อชั่วโมง) ลองใหม่ภายหลัง', 413: 'ข้อมูลใหญ่เกินไป', 422: 'AI ไม่ตอบคำขอนี้' }[code]
    || (code === 504 || !code ? 'AI ตอบไม่ทันเวลา / เน็ตหลุด ลองกดใหม่' : 'เรียก AI ไม่ได้ (' + code + ') ลองใหม่ภายหลัง'));

  window.BBAna = { key, reset, feed, mount, finish, setMode, get mode() { return mode; }, open: () => openDlg(null), close: closeDlg, get reports() { return reports; }, get live() { return M ? snapshot() : null; }, calcOf: id => P[id] ? calc(P[id]) : null };
})();
