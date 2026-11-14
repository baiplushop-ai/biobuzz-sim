// /api/academy · ผลฝึก Drive Team Academy ของนักเรียนแต่ละคน: ซิงก์จากเครื่องนักเรียนขึ้นเซิร์ฟเวอร์ โค้ชดูรวมทุกคนได้ในหน้าเดียว
// เก็บใน Netlify Blobs (store "academy") 1 กล่องต่อ 1 ชื่อผู้ฝึก (a/<sha256 ของชื่อ>) · เปลี่ยนเครื่องแล้วดึงผลของตัวเองกลับมาได้
//   POST { op:'check', key }                            → { ok }
//   POST { op:'push',  key, name, team, state, report } → { ok, at }      ทับกล่องของชื่อนี้ (เครื่องรวมของเดิมก่อนส่งแล้ว)
//   POST { op:'mine',  key, name }                      → { ok, state, at } state = null ถ้ายังไม่เคยส่ง
//   POST { op:'list',  key }                            → { ok, items:[{ name, team, at, report }] }   (ไม่ส่ง state เพื่อให้เบา)
//   POST { op:'dump',  key }                            → { ok, items:[{ name, team, at, state, report }] }  รหัสพิเศษเท่านั้น (สำรองข้อมูล)
//   POST { op:'del',   key, name }                      → { ok }
// key = รหัสทีม (SCOUT_KEY) หรือรหัสพิเศษ · ข้อมูลถูกตรวจรูปอีกครั้งที่หน้าเว็บก่อนแสดงทุกครั้ง
import { okTeamKey } from '../lib/teamkey.mjs';
import { isMaster } from '../lib/master.mjs';

const MAX_BODY = 400000, MAX_STUDENTS = 200;
const store = async () => globalThis.__roomStore || (await import('@netlify/blobs')).getStore({ name: 'academy', consistency: 'strong' });
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const T = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const norm = n => T(n, 60).toLowerCase().replace(/\s+/g, ' ');
// รายการสำหรับหน้ารวมของโค้ช: ตัดข้อความยาว ๆ ที่หน้ารวมไม่ใช้ (ชื่อบท ข้อความคำถาม ประวัติรายรอบ) ให้คำตอบเบา
const slim = r => !isObj(r) ? null : { ...r, roles: Object.fromEntries(Object.entries(isObj(r.roles) ? r.roles : {}).map(([k, x]) => [k, isObj(x) ? { ...x, drills: (Array.isArray(x.drills) ? x.drills : []).map(d => isObj(d) ? { id: d.id, passed: d.passed, scn: d.scn, wrong: (Array.isArray(d.wrong) ? d.wrong : []).map(w => ({ q: w?.q, n: w?.n })) } : null) } : x])),
  sim: Object.fromEntries(Object.entries(isObj(r.sim) ? r.sim : {}).map(([k, e]) => [k, isObj(e) ? { last: e.last, best: e.best, tries: e.tries, passes: e.passes, streak: e.streak } : e])) };
const idOf = async n => 'a/' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm(n))))].slice(0, 16).map(x => x.toString(16).padStart(2, '0')).join('');

export default async req => {
  if (req.method !== 'POST') return json({ ok: false, why: 'method' }, 405);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false, why: 'cross-site' }, 403);
  let d; try { const t = await req.text(); if (t.length > MAX_BODY) return json({ ok: false, why: 'big' }, 413); d = JSON.parse(t); } catch { return json({ ok: false, why: 'body' }, 400); }
  if (!(await okTeamKey(d?.key))) { await new Promise(ok => setTimeout(ok, 400)); return json({ ok: false, why: 'key' }, 403); }
  if (d.op === 'check') return json({ ok: true });
  let st; try { st = await store(); } catch { return json({ ok: false, why: 'store' }, 503); }
  const all = async withState => {
    const { blobs } = await st.list({ prefix: 'a/' });
    const rows = await Promise.all(blobs.slice(0, MAX_STUDENTS).map(b => st.get(b.key, { type: 'json' }).catch(() => null)));
    return rows.filter(isObj).map(v => ({ name: T(v.name, 60), team: T(v.team, 60), at: +v.at || 0, report: withState ? v.report || null : slim(v.report), ...(withState ? { state: v.state || null } : {}) })).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  };
  if (d.op === 'list') return json({ ok: true, items: await all(false) });
  if (d.op === 'dump') { if (!(await isMaster(d.key))) return json({ ok: false, why: 'key' }, 403); return json({ ok: true, items: await all(true) }); }
  if (!norm(d.name)) return json({ ok: false, why: 'name' }, 400);
  const id = await idOf(d.name);
  if (d.op === 'mine') { const v = await st.get(id, { type: 'json' }).catch(() => null); return json({ ok: true, state: isObj(v) && isObj(v.state) ? v.state : null, at: isObj(v) ? +v.at || 0 : 0 }); }
  if (d.op === 'del') { await st.delete(id).catch(() => {}); return json({ ok: true }); }
  if (d.op === 'push') {
    if (!isObj(d.state) || !isObj(d.report) || d.report.type !== 'dta-biobuzz-report') return json({ ok: false, why: 'data' }, 400);
    const { blobs } = await st.list({ prefix: 'a/' });
    if (blobs.length >= MAX_STUDENTS && !blobs.some(b => b.key === id)) return json({ ok: false, why: 'full' }, 507);
    const at = Date.now(); await st.setJSON(id, { name: T(d.name, 60).replace(/\s+/g, ' '), team: T(d.team, 60), at, state: d.state, report: d.report });
    return json({ ok: true, at });
  }
  return json({ ok: false, why: 'op' }, 400);
};

export const config = { path: '/api/academy' };
