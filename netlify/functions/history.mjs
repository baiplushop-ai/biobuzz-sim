// /api/history · ประวัติการฝึก: รายงานผลประเมินผู้เล่น + Replay ที่ผู้ชมพิเศษบันทึกไว้ เปิดดูย้อนหลังได้จากทุกเครื่อง
// ทุกคำขอต้องใช้รหัสพิเศษ (ตรวจที่เซิร์ฟเวอร์) · เก็บใน Netlify Blobs (store "history") ไม่เปิดสาธารณะ
//   POST { op:'save', key, id, report } → { ok, entry }   บันทึก / อัปเดตรายงานเดิม (id เดิม)
//   POST { op:'list', key }             → { ok, items }    รายการย่อ (ใหม่ → เก่า)
//   POST { op:'get',  key, id }         → { ok, report }
//   POST { op:'del',  key, id }         → { ok }
// รายการย่อมี c = ตัวเลขสรุปของผู้เล่นแต่ละคน ให้แผงวิเคราะห์ใช้เทียบกับแมตช์ก่อนหน้าได้จากทุกเครื่อง (ไม่ต้องโหลดรายงานเต็ม)
// เก็บสูงสุด 300 รายการ (เกินแล้วลบอันเก่าสุดเอง) · รายงาน 1 แมตช์พร้อม Replay ≈ 1 MB
import { isMaster } from '../lib/master.mjs';

const MAX_ITEMS = 300, MAX_BODY = 5.5e6;
const store = async () => globalThis.__roomStore || (await import('@netlify/blobs')).getStore({ name: 'history', consistency: 'strong' });
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const T = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const N = v => Number.isFinite(+v) ? +v : 0;
const ID = /^[A-Za-z0-9_-]{8,48}$/, VS = ['wait', 'afk', 'good', 'mid', 'bad'];
// รายการย่อสำหรับหน้ารายการ (สร้างที่เซิร์ฟเวอร์ ไม่เชื่อค่าที่ส่งมาโดยตรง)
const entryOf = (id, r, size) => ({
  id, at: Date.now(), ts: N(r.ts), kind: ['tele', 'full', 'free'].includes(r.kind) ? r.kind : '', end: ['end', 'lost', 'live'].includes(r.end) ? r.end : 'end',
  score: { red: N(r.score?.red), blue: N(r.score?.blue) }, replay: !!(r.replay && Array.isArray(r.replay.frames) && r.replay.frames.length), ai: !!(r.ai && typeof r.ai.text === 'string'), size,
  players: (Array.isArray(r.players) ? r.players : []).slice(0, 8).map(p => ({ id: T(p?.id, 2), name: T(p?.name, 24), bot: p?.bot === true, intent: p?.intent == null ? null : N(p.intent), skill: p?.skill == null ? null : N(p.skill), v: VS.includes(p?.v) ? p.v : 'wait' })),
  c: cmpOf(r),
});
// เหมือน summ() ใน analyst.js: เฉพาะคนจริงที่มีคะแนนและเล่นอย่างน้อย 40 วิ
function cmpOf(r) {
  return (Array.isArray(r.players) ? r.players : []).filter(p => p && p.bot !== true && p.intent != null && p.m && N(p.m.T) >= 40).slice(0, 8).map(p => ({
    name: T(p.name, 24), id: T(p.id, 2), al: p.alliance === 'blue' ? 'blue' : 'red', i: N(p.intent), s: N(p.skill), v: VS.includes(p.v) ? p.v : 'wait',
    acc: p.m.acc == null ? null : N(p.m.acc), shots: N(p.m.shots), hits: N(p.m.hits), cyc: N(p.m.cycAvg), mv: N(p.m.mv), idle: N(p.m.idleN), wall: N(p.m.wallPm), fouls: Array.isArray(p.fouls) ? p.fouls.length : 0, T: N(p.m.T) }));
}

export default async req => {
  if (req.method !== 'POST') return json({ ok: false, why: 'method' }, 405);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false, why: 'cross-site' }, 403);
  let t, d; try { t = await req.text(); if (t.length > MAX_BODY) return json({ ok: false, why: 'big' }, 413); d = JSON.parse(t); } catch { return json({ ok: false, why: 'body' }, 400); }
  if (!(await isMaster(d?.key))) { await new Promise(ok => setTimeout(ok, 400)); return json({ ok: false, why: 'key' }, 403); }
  let st; try { st = await store(); } catch { return json({ ok: false, why: 'store' }, 503); }
  const idx = async () => { const v = await st.get('idx', { type: 'json' }).catch(() => null); return Array.isArray(v?.items) ? v.items : []; };
  if (d.op === 'list') {
    const items = await idx(), old = items.filter(x => !Array.isArray(x.c)).slice(0, 10);
    // รายการที่บันทึกก่อน v5.0 ยังไม่มี c: เติมให้ทีละ 10 รายการต่อครั้งที่เปิดรายการ
    if (old.length) { for (const x of old) { const r = await st.get('h/' + x.id, { type: 'json' }).catch(() => null); x.c = r ? cmpOf(r) : []; } await st.setJSON('idx', { items }); }
    return json({ ok: true, items: items.sort((a, b) => b.ts - a.ts) });
  }
  if (!ID.test(d.id || '')) return json({ ok: false, why: 'id' }, 400);
  if (d.op === 'get') { const r = await st.get('h/' + d.id, { type: 'json' }).catch(() => null); return r ? json({ ok: true, report: r }) : json({ ok: false, why: 'gone' }, 404); }
  if (d.op === 'del') { await st.delete('h/' + d.id).catch(() => {}); const items = (await idx()).filter(x => x.id !== d.id); await st.setJSON('idx', { items }); return json({ ok: true }); }
  if (d.op === 'save') {
    const r = d.report; if (!r || typeof r !== 'object' || !Array.isArray(r.players) || !r.players.length) return json({ ok: false, why: 'report' }, 400);
    await st.setJSON('h/' + d.id, r);
    const e = entryOf(d.id, r, t.length); let items = (await idx()).filter(x => x.id !== d.id); items.push(e); items.sort((a, b) => b.ts - a.ts);
    for (const old of items.slice(MAX_ITEMS)) await st.delete('h/' + old.id).catch(() => {});  // เกินจำนวน = ลบอันเก่าสุด
    items = items.slice(0, MAX_ITEMS); await st.setJSON('idx', { items });
    return json({ ok: true, entry: e });
  }
  return json({ ok: false, why: 'op' }, 400);
};

export const config = { path: '/api/history' };
