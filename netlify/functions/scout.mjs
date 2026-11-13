// /api/scout · ข้อมูล Scouting ของทีม (หลายเครื่องช่วยกันจด) เก็บใน Netlify Blobs
// แต่ละเครื่องเขียนเฉพาะ "กล่องของตัวเอง" (s/<event>/d/<device>) จึงไม่ทับข้อมูลของเครื่องอื่น · ตอนดึงรวมทุกกล่องให้
//   POST { op:'check', key }                              → { ok }
//   POST { op:'push',  key, ev, dev, name, recs, pit }    → { ok, at }     ส่งข้อมูลทั้งหมดของเครื่องนี้ (ทับกล่องเดิมของเครื่องนี้)
//   POST { op:'pull',  key, ev }                          → { ok, devices:[{ dev, name, at, recs, pit }], pick }
//   POST { op:'pick',  key, ev, pick:{ ver, list, taken } } → { ok, pick } · ver ไม่ตรงของล่าสุด = 409 พร้อม pick ล่าสุด
// key = รหัสทีม Scouting (ตั้งที่ Netlify → Environment variables: SCOUT_KEY) หรือรหัสพิเศษของผู้ดูแล
import { isMaster } from '../lib/master.mjs';

const store = async () => globalThis.__roomStore || (await import('@netlify/blobs')).getStore({ name: 'scout', consistency: 'strong' });
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const T = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const N = (v, lo = 0, hi = 999) => Math.max(lo, Math.min(hi, Math.round(+v) || 0));
const B = v => v === true || v === 1;
const pick1 = (v, list, d) => list.includes(v) ? v : d;
const okKey = async k => { if (typeof k !== 'string' || !k || k.length > 128) return false; const sk = (process.env.SCOUT_KEY || '').trim(); return (sk && k.trim() === sk) || isMaster(k); };
const EV = /^[a-z0-9-]{3,40}$/, DEV = /^[A-Za-z0-9_-]{8,40}$/, TEAM = /^\d{1,6}$/;

// บันทึก 1 แมตช์ของ 1 หุ่น (บังคับชนิดและช่วงค่าทุกช่อง)
const cleanRec = r => ({
  id: /^[A-Za-z0-9_-]{6,40}$/.test(r?.id || '') ? r.id : '', at: N(r?.at, 0, 9e15), del: B(r?.del),
  match: N(r?.match, 0, 999), team: TEAM.test(String(r?.team ?? '')) ? String(r.team) : '', alliance: pick1(r?.alliance, ['red', 'blue'], 'red'), scout: T(r?.scout, 24), noShow: B(r?.noShow),
  aLeave: B(r?.aLeave), aPark: B(r?.aPark), aCell: N(r?.aCell, 0, 40), aMiss: N(r?.aMiss, 0, 40),
  tCell: N(r?.tCell, 0, 120), tMiss: N(r?.tMiss, 0, 120), tFlowerP: N(r?.tFlowerP, 0, 40), tFlowerN: N(r?.tFlowerN, 0, 16), tips: N(r?.tips, 0, 20),
  park: pick1(r?.park, ['yes', 'try', 'no'], 'no'), defense: pick1(r?.defense, ['none', 'some', 'main'], 'none'), shotZone: pick1(r?.shotZone, ['', 'near', 'mid', 'far', 'mix'], ''),
  minor: N(r?.minor, 0, 30), major: N(r?.major, 0, 30), card: pick1(r?.card, ['none', 'yellow', 'red'], 'none'), broke: pick1(r?.broke, ['none', 'part', 'dead'], 'none'),
  rDrive: N(r?.rDrive, 0, 5), rSpeed: N(r?.rSpeed, 0, 5), rDef: N(r?.rDef, 0, 5), note: T(r?.note, 400),
});
// ข้อมูลหุ่นจากการเดิน pit (1 รายการต่อทีมต่อเครื่อง)
const cleanPit = p => ({
  team: TEAM.test(String(p?.team ?? '')) ? String(p.team) : '', at: N(p?.at, 0, 9e15), name: T(p?.name, 60),
  drive: pick1(p?.drive, ['', 'mecanum', 'tank', 'swerve', 'other'], ''), auto: pick1(p?.auto, ['', 'none', 'leave', 'preload', 'more'], ''),
  flower: pick1(p?.flower, ['', 'yes', 'no'], ''), park: pick1(p?.park, ['', 'yes', 'no'], ''), launcher: T(p?.launcher, 60), note: T(p?.note, 400),
});
const cleanPick = p => ({
  ver: N(p?.ver, 0, 1e9), at: Date.now(), by: T(p?.by, 24),
  list: (Array.isArray(p?.list) ? p.list : []).slice(0, 80).map(x => ({ team: TEAM.test(String(x?.team ?? '')) ? String(x.team) : '', tier: pick1(x?.tier, ['1', '2', '3', 'x'], '2'), note: T(x?.note, 120) })).filter(x => x.team),
  taken: (Array.isArray(p?.taken) ? p.taken : []).slice(0, 80).map(String).filter(t => TEAM.test(t)),
});

export default async req => {
  if (req.method !== 'POST') return json({ ok: false, why: 'method' }, 405);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false, why: 'cross-site' }, 403);
  let d; try { const t = await req.text(); if (t.length > 400000) return json({ ok: false, why: 'big' }, 413); d = JSON.parse(t); } catch { return json({ ok: false, why: 'body' }, 400); }
  if (!(await okKey(d?.key))) { await new Promise(ok => setTimeout(ok, 400)); return json({ ok: false, why: 'key' }, 403); }
  if (d.op === 'check') return json({ ok: true });
  if (!EV.test(d.ev || '')) return json({ ok: false, why: 'ev' }, 400);
  let st; try { st = await store(); } catch { return json({ ok: false, why: 'store' }, 503); }
  const base = `s/${d.ev}/`;
  if (d.op === 'push') {
    if (!DEV.test(d.dev || '')) return json({ ok: false, why: 'dev' }, 400);
    const recs = (Array.isArray(d.recs) ? d.recs : []).slice(0, 600).map(cleanRec).filter(r => r.id && (r.del || r.team));
    const pit = (Array.isArray(d.pit) ? d.pit : []).slice(0, 120).map(cleanPit).filter(p => p.team);
    const at = Date.now(); await st.setJSON(base + 'd/' + d.dev, { at, name: T(d.name, 24), recs, pit });
    return json({ ok: true, at, n: recs.length });
  }
  if (d.op === 'pull') {
    const { blobs } = await st.list({ prefix: base + 'd/' });
    const devices = (await Promise.all(blobs.slice(0, 60).map(async b => { const v = await st.get(b.key, { type: 'json' }).catch(() => null); return v && { dev: b.key.slice((base + 'd/').length), ...v }; }))).filter(Boolean);
    const pick = await st.get(base + 'pick', { type: 'json' }).catch(() => null);
    return json({ ok: true, now: Date.now(), devices, pick: pick || null });
  }
  if (d.op === 'pick') {
    const cur = await st.get(base + 'pick', { type: 'json' }).catch(() => null), np = cleanPick(d.pick);
    if (cur && np.ver !== cur.ver) return json({ ok: false, why: 'conflict', pick: cur }, 409);  // มีคนแก้ก่อนหน้า = ส่งของล่าสุดกลับไปให้รวมใหม่
    np.ver = (cur?.ver || 0) + 1; await st.setJSON(base + 'pick', np);
    return json({ ok: true, pick: np });
  }
  return json({ ok: false, why: 'op' }, 400);
};

export const config = { path: '/api/scout' };
