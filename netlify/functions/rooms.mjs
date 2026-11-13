// /api/rooms · รายชื่อห้องออนไลน์ที่เปิดอยู่ (หน้าเล่นออนไลน์ + หน้าแรก Drive Team Academy)
// เกมยังต่อกันแบบ P2P เหมือนเดิม ไฟล์นี้เก็บแค่ "ป้ายห้อง" ที่ host ส่งมาทุกไม่กี่วินาที (ชื่อ host ผู้เล่น คะแนน เวลา) ใน Netlify Blobs
//   GET  /api/rooms[?loc=1]           → { now, rooms: [...] }  ไม่ส่งรหัสห้องออกไป (ต้องรู้รหัสถึงเข้าชมได้)
//   POST { op:'beat', tok, code, info } host อัปเดตป้ายห้อง · tok = ความลับของ host (id ห้อง = hash ของ tok คนอื่นจึงเขียนทับไม่ได้)
//   POST { op:'del', tok }              host ปิดห้อง
//   POST { op:'key', id, key }          ขอเข้าชม: key ต้องเป็นรหัสห้องของห้องนั้น หรือรหัสพิเศษ (เข้าชมได้ทุกห้อง) → { ok, code }
// รหัสพิเศษ (เข้าชมได้ทุกห้อง): ตรวจด้วย ../lib/master.mjs (เก็บแค่ hash · เปลี่ยนได้ด้วย WATCH_MASTER_KEY)
import { isMaster } from '../lib/master.mjs';
const TTL = 45e3;  // host เงียบไปนานกว่านี้ = ถือว่าห้องปิดแล้ว (ปิดแท็บ / เน็ตหลุด)
const KIND = ['tele', 'full', 'free'], ST = ['lobby', 'play', 'res'], TYPE = ['human', 'bot', 'none'];

const store = async () => globalThis.__roomStore || (await import('@netlify/blobs')).getStore({ name: 'live-rooms', consistency: 'strong' });
const json = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v) || 0));
const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
const clean = i => ({
  host: str(i?.host, 16) || 'host', st: ST.includes(i?.st) ? i.st : 'lobby', kind: KIND.includes(i?.kind) ? i.kind : 'tele',
  sl: (Array.isArray(i?.sl) ? i.sl : []).slice(0, 4).map(s => ({ t: TYPE.includes(s?.t) ? s.t : 'none', n: str(s?.n, 16) })),
  sc: [int(i?.sc?.[0], -999, 9999), int(i?.sc?.[1], -999, 9999)], el: Math.max(0, Math.min(1e5, +i?.el || 0)), run: !!i?.run, free: !!i?.free,
  nv: int(i?.nv, 0, 50), np: int(i?.np, 0, 50), t0: int(i?.t0, 0, 9e15), loc: !!i?.loc });

export default async req => {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false, why: 'cross-site' }, 403);
  let st; try { st = await store(); } catch { return json({ ok: false, why: 'store' }, 503); }
  const now = Date.now();
  if (req.method === 'GET') {
    const loc = new URL(req.url).searchParams.get('loc') === '1';
    const { blobs } = await st.list({ prefix: 'r/' });
    const all = await Promise.all(blobs.slice(0, 60).map(async b => [b.key, await st.get(b.key, { type: 'json' }).catch(() => null)]));
    const rooms = [];
    for (const [k, r] of all) {
      if (!r || now - r.at > TTL) { st.delete(k).catch(() => {}); continue; }
      if (!!r.info.loc !== loc) continue;  // ห้องทดสอบในเครื่อง (?net=local) ไม่ปนกับห้องจริง
      const { loc: _, ...info } = r.info; rooms.push({ id: k.slice(2), at: r.at, ...info });
    }
    rooms.sort((a, b) => (a.st === 'play' ? 0 : 1) - (b.st === 'play' ? 0 : 1) || b.at - a.at);
    // CDN ของ Netlify จำคำตอบไว้ 2 วิ: หลายเครื่องเปิดหน้ารายการพร้อมกันก็เรียก function ไม่ถี่ (เบราว์เซอร์ไม่จำ)
    return json({ ok: true, now, rooms }, 200, { 'cache-control': 'public, max-age=0, must-revalidate', 'netlify-cdn-cache-control': 'public, s-maxage=2, stale-while-revalidate=2' });
  }
  if (req.method !== 'POST') return json({ ok: false, why: 'method' }, 405);
  let d; try { const t = await req.text(); if (t.length > 4096) throw 0; d = JSON.parse(t); } catch { return json({ ok: false, why: 'body' }, 400); }
  const tok = typeof d?.tok === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(d.tok) ? d.tok : '';
  if (d?.op === 'beat') {
    if (!tok || !/^\d{6}$/.test(d.code || '')) return json({ ok: false, why: 'bad' }, 400);
    const id = await sha(tok); await st.setJSON('r/' + id, { at: now, code: d.code, info: clean(d.info) });
    return json({ ok: true, id });
  }
  if (d?.op === 'del') { if (tok) await st.delete('r/' + await sha(tok)).catch(() => {}); return json({ ok: true }); }
  if (d?.op === 'key') {
    const id = typeof d.id === 'string' && /^[0-9a-f]{16}$/.test(d.id) ? d.id : '', key = str(d.key, 128);
    const r = id && await st.get('r/' + id, { type: 'json' }).catch(() => null);
    if (!r || now - r.at > TTL) return json({ ok: false, why: 'gone' }, 404);
    if (key && key === r.code) return json({ ok: true, code: r.code, master: false });
    if (key && await isMaster(key)) return json({ ok: true, code: r.code, master: true });
    await new Promise(ok => setTimeout(ok, 400));  // เดารหัสรัว ๆ ไม่ได้เร็ว
    return json({ ok: false, why: 'key' }, 403);
  }
  return json({ ok: false, why: 'op' }, 400);
};

export const config = { path: '/api/rooms' };
