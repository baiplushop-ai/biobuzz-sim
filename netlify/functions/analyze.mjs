// /api/analyze · ผู้ชมพิเศษให้ AI อ่านตัวเลขการเล่นของ "คนจริง" แล้วเขียนผลประเมินเป็นภาษาไทย
//   POST { key, mode:'full'|'brief', report } → { ok, text, model, via }
//   POST { op:'test', key }                   → { ok, primary, providers:[{ id, name, set, model, ok, ms, msg }] }  (หน้า home → ตั้งค่า)
// key = รหัสพิเศษ (ตรวจที่เซิร์ฟเวอร์ทุกครั้ง) คนอื่นจึงใช้ token ของเราไม่ได้ · ข้อมูลที่ส่งมาไม่มีชื่อผู้เล่นและไม่มีรหัสห้อง
//
// ตั้งค่าทั้งหมดที่ Netlify → Project configuration → Environment variables (ไม่เก็บในรีโป · ตั้งแล้วกด Deploy ใหม่ 1 ครั้ง)
//   ANTHROPIC_API_KEY  = คีย์ Claude API ของ Anthropic (ทางหลัก)
//   AI_MODEL           = รุ่นที่ใช้ผ่าน Anthropic (ไม่ตั้ง = claude-opus-5-5 · เช่น claude-sonnet-5-5, claude-haiku-5-5, claude-fable-5-2)
//   OPENROUTER_API_KEY = คีย์ OpenRouter (ทางสำรอง: ใช้เมื่อทางหลักใช้ไม่ได้ เช่น credit หมด คีย์ผิด หรือ AI ไม่ว่าง)
//   OPENROUTER_MODEL   = รุ่นที่ใช้ผ่าน OpenRouter (ไม่ตั้ง = anthropic/claude-opus-5.5)
//   AI_PRIMARY         = openrouter ถ้าอยากใช้ OpenRouter เป็นทางหลักแทน (ไม่ตั้ง = anthropic)
//   AI_HOURLY_LIMIT    = จำนวนครั้งสูงสุดต่อชั่วโมงทั้งเว็บ (ไม่ตั้ง = 120) กันค่าใช้จ่ายบานปลาย
// ตั้งแค่คีย์เดียวก็ใช้ได้ · ตั้งทั้งสองคีย์ = มีทางสำรองอัตโนมัติ
import Anthropic from '@anthropic-ai/sdk';
import { isMaster } from '../lib/master.mjs';

const MAX_BODY = 40000, BUDGET = 54000;  // function ทำงานได้ไม่เกิน 60 วิ
const env = k => (process.env[k] || '').trim();
// รุ่นที่รองรับระบบสำรองของ Anthropic เอง (ถ้ารุ่นหลักปฏิเสธคำขอ API จะส่งต่อให้รุ่นอื่นในคำขอเดียวกัน)
const FB_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const PROV = {
  anthropic: { name: 'Anthropic', key: () => env('ANTHROPIC_API_KEY'), model: () => /^claude-[a-z0-9.-]{3,40}$/.test(env('AI_MODEL')) ? env('AI_MODEL') : 'claude-opus-5-5' },
  openrouter: { name: 'OpenRouter', key: () => env('OPENROUTER_API_KEY'), model: () => /^[a-z0-9._-]{2,40}\/[a-z0-9.:_-]{2,60}$/i.test(env('OPENROUTER_MODEL')) ? env('OPENROUTER_MODEL') : 'anthropic/claude-opus-5.5' },
};
const order = () => (env('AI_PRIMARY').toLowerCase() === 'openrouter' ? ['openrouter', 'anthropic'] : ['anthropic', 'openrouter']).filter(p => PROV[p].key());

const store = async () => globalThis.__roomStore || (await import('@netlify/blobs')).getStore({ name: 'ai-usage', consistency: 'strong' });
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const SYS = `คุณเป็นโค้ช Drive Team ของทีม FTC ในไทย ช่วยครูประเมินนักเรียนที่ฝึกขับหุ่นใน simulator เกม BIOBUZZ (FTC ฤดูกาล 2026-27)
ข้อมูลที่ได้เป็นตัวเลขที่ระบบวัดจากการขับของ "คนจริง" แต่ละคน (Bot ถูกตัดออกแล้ว) ระบุด้วยตำแหน่ง R1 R2 B1 B2 ไม่มีชื่อจริง
หน้าที่: บอกว่าแต่ละคน "ตั้งใจเล่น" หรือ "เล่นมั่ว / ไม่ตั้งใจ" และฝีมือเป็นอย่างไร พร้อมคำแนะนำการฝึกที่ทำได้จริง

หลักการ:
- อ้างตัวเลขจากข้อมูลทุกครั้งที่สรุป ห้ามเดาหรือแต่งข้อมูลที่ไม่มี ถ้าข้อมูลน้อย (teleopSec ต่ำ หรือ end ไม่ใช่ 'end') ให้บอกว่าความมั่นใจต่ำ
- แยก "ไม่ตั้งใจ" ออกจาก "ตั้งใจแต่ยังไม่เก่ง": คนที่ขยับสม่ำเสมอ เก็บลูก หันเข้าหา CELL ตอนยิง แต่ยิงไม่ค่อยเข้า = ตั้งใจแต่ต้องฝึก
- สัญญาณเล่นมั่ว: หมุนวนอยู่กับที่ วิ่งวนไร้ทิศทาง เปลี่ยนทิศกลับไปมาถี่ (จอยกระตุก) ยิงตอนไม่ได้หันเข้าหา CELL ชนผนังบ่อย จอดนิ่งนานกลางแมตช์ ถือลูกค้างไม่ยิง
- ping สูง (> 180 ms) หรือ miss มาก ทำให้การขับดูกระตุกได้ ให้เผื่อไว้ก่อนสรุปว่ามั่ว
- every20s ใช้ดูแนวโน้ม เช่น ช่วงท้ายขยับน้อยลง = ล้าหรือเลิกพยายาม · scoreEvery10s = คะแนนระหว่างแมตช์
- previousMatches (ถ้ามี) = แมตช์ก่อนหน้าของคนเดียวกัน (matchesAgo 1 = ล่าสุด) ให้บอกว่าดีขึ้น แย่ลง หรือเท่าเดิม ในเรื่องใด
- กติกาที่ใช้ได้: ถือลูกไม่เกิน 4 ลูก (G407) · ใส่ NECTAR ใน FLOWER ได้เมื่อเหลือ ≤ 1:00 (G410) · PIN ไม่เกิน 3 วิ (G421)
  "วงยิงของทีม" และ "หยุดนิ่งก่อนยิง" เป็นแนวฝึกของทีม ไม่ใช่กติกา FTC ห้ามเรียกว่าผิดกติกา
- คะแนน intent / skill (0-100) เป็นค่าประมาณจากระบบ ใช้ประกอบ ไม่ต้องยึดตายตัว
- ใช้ภาษาไทยที่สุภาพ เป็นกันเอง ให้กำลังใจ ผู้อ่านคือครู/โค้ช และอาจอ่านให้นักเรียนฟัง ศัพท์เกมใช้ภาษาอังกฤษ (HIVE, CELL, POLLEN, NECTAR, FLOWER, PARK, TELEOP)`;

const FULL = `เขียนผลประเมินตามรูปแบบนี้ (Markdown ง่าย ๆ ไม่มีตาราง):
## สรุปภาพรวม
2-3 บรรทัด
## <ตำแหน่ง> (<ทีม>)
**ความตั้งใจ:** ระดับ + เหตุผลที่อ้างตัวเลข
**ฝีมือ:** ระดับ + เหตุผลที่อ้างตัวเลข
**เทียบแมตช์ก่อนหน้า:** ดีขึ้น/แย่ลงเรื่องใด (ถ้าไม่มี previousMatches เขียนว่า "ยังไม่มีข้อมูลเทียบ")
- จุดเด่น: ...
- ต้องปรับ: ...
- แบบฝึกที่แนะนำ: 1-2 ข้อที่ทำได้ทันที
ทำครบทุกคนในข้อมูล คนละไม่เกินประมาณ 120 คำ`;
const BRIEF = `นี่คือข้อมูลระหว่างแมตช์ (ยังไม่จบ) สรุปสั้นมาก คนละ 1 บรรทัด รูปแบบ:
- **<ตำแหน่ง>** 🟢/🟡/🔴 สิ่งที่เห็นชัดที่สุดตอนนี้ (อ้างตัวเลข 1 ตัว) → คำแนะนำสั้น ๆ ที่โค้ชพูดได้ทันที
ไม่เกิน 30 คำต่อคน ไม่ต้องมีหัวข้อหรือคำนำ`;

const hourly = () => Math.max(1, Math.min(2000, parseInt(env('AI_HOURLY_LIMIT') || '120', 10) || 120));
async function quota(n = 1) {  // นับครั้งที่เรียก AI ใน 1 ชม. ที่ผ่านมา (ทั้งเว็บ)
  try {
    const st = await store(), now = Date.now(), o = (await st.get('ai/h', { type: 'json' }).catch(() => null)) || { t: [] };
    const t = (Array.isArray(o.t) ? o.t : []).filter(x => now - x < 3600e3);
    if (t.length + n > hourly()) return false;
    for (let i = 0; i < n; i++) t.push(now); await st.setJSON('ai/h', { t }); return true;
  } catch { return true; }  // ที่เก็บโควตาใช้ไม่ได้ชั่วคราว = ไม่บล็อกครู (ยังต้องมีรหัสพิเศษ)
}
class AIErr extends Error { constructor(why, msg, status, retry = true) { super(msg); Object.assign(this, { why, status, retry }); } }  // retry = ลองทางสำรองได้

async function viaAnthropic(model, content, maxTok, effort, ms) {
  const client = new Anthropic({ apiKey: PROV.anthropic.key(), timeout: ms, maxRetries: 0 });
  const params = { model, max_tokens: maxTok, system: SYS, output_config: { effort }, messages: [{ role: 'user', content }] };
  if (FB_MODELS.has(model)) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  let r;
  try { r = await client.beta.messages.create(params); }
  catch (e) {
    const m = String(e?.message || '').replace(/\s+/g, ' ').slice(0, 160);
    if (e instanceof Anthropic.AuthenticationError) throw new AIErr('aikey', 'คีย์ไม่ถูกต้องหรือถูกยกเลิก', 502);
    if (e instanceof Anthropic.PermissionDeniedError) throw new AIErr('perm', 'บัญชีนี้ใช้รุ่น ' + model + ' ไม่ได้', 502);
    if (e instanceof Anthropic.NotFoundError) throw new AIErr('model', 'ไม่พบรุ่น ' + model + ' (ตรวจ AI_MODEL)', 502);
    if (e instanceof Anthropic.BadRequestError) throw new AIErr('bad', /credit|balance/i.test(m) ? 'credit หมด / ไม่พอ' : m, 502);  // credit หมดตอบเป็น 400
    if (e instanceof Anthropic.RateLimitError) throw new AIErr('ai', 'ถูกจำกัดความถี่ (rate limit)', 429);
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AIErr('timeout', 'ตอบไม่ทันเวลา', 504, false);
    if (e instanceof Anthropic.APIConnectionError) throw new AIErr('conn', 'ต่อไม่ได้', 502);
    if (e instanceof Anthropic.APIError) throw new AIErr('api', `ขัดข้อง (${e.status ?? '?'})`, 503);
    throw new AIErr('err', m, 500);
  }
  if (r.stop_reason === 'refusal') throw new AIErr('refusal', 'AI ไม่ตอบคำขอนี้', 422, false);
  const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { text, model: r.model, cut: r.stop_reason === 'max_tokens' };
}
async function viaOpenRouter(model, content, maxTok, effort, ms) {
  let q, d;
  try {
    q = await fetch((env('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1') + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(ms),
      headers: { authorization: 'Bearer ' + PROV.openrouter.key(), 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTok, reasoning: { effort }, messages: [{ role: 'system', content: SYS }, { role: 'user', content }] }) });
    d = await q.json().catch(() => null);
  } catch (e) { throw e?.name === 'TimeoutError' ? new AIErr('timeout', 'ตอบไม่ทันเวลา', 504, false) : new AIErr('conn', 'ต่อไม่ได้', 502); }
  const em = String(d?.error?.message || '').replace(/\s+/g, ' ').slice(0, 160);
  if (!q.ok || d?.error) {
    const s = q.ok ? (+d?.error?.code || 502) : q.status;
    if (s === 401) throw new AIErr('aikey', 'คีย์ไม่ถูกต้องหรือถูกยกเลิก', 502);
    if (s === 402) throw new AIErr('credit', 'credit หมด / ไม่พอ (เติมที่ openrouter.ai)', 502);
    if (s === 404) throw new AIErr('model', 'ไม่พบรุ่น ' + model + ' (ตรวจ OPENROUTER_MODEL)', 502);
    if (s === 429) throw new AIErr('ai', 'ถูกจำกัดความถี่ (rate limit)', 429);
    if (s === 403) throw new AIErr('refusal', 'AI ไม่ตอบคำขอนี้', 422, false);
    throw new AIErr('api', `ขัดข้อง (${s})${em ? ' · ' + em : ''}`, 503);
  }
  const c = d?.choices?.[0], text = typeof c?.message?.content === 'string' ? c.message.content.trim() : '';
  if (c?.finish_reason === 'content_filter') throw new AIErr('refusal', 'AI ไม่ตอบคำขอนี้', 422, false);
  return { text, model: String(d?.model || model), cut: c?.finish_reason === 'length' };
}
const run = (p, ...a) => (p === 'anthropic' ? viaAnthropic : viaOpenRouter)(PROV[p].model(), ...a);

export default async req => {
  if (req.method !== 'POST') return json({ ok: false, why: 'method' }, 405);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false, why: 'cross-site' }, 403);
  let d; try { const t = await req.text(); if (t.length > MAX_BODY) return json({ ok: false, why: 'big' }, 413); d = JSON.parse(t); } catch { return json({ ok: false, why: 'body' }, 400); }
  if (!(await isMaster(d?.key))) { await new Promise(ok => setTimeout(ok, 400)); return json({ ok: false, why: 'key' }, 403); }
  const ps = order();

  if (d.op === 'test') {  // ทดสอบทุกทางที่ตั้งคีย์ไว้พร้อมกัน (คำถามสั้นมาก ใช้ token น้อย)
    const set = ps.filter(Boolean);
    if (set.length && !(await quota(set.length))) return json({ ok: false, why: 'quota', msg: `เกินโควตา ${hourly()} ครั้ง/ชม.` }, 429);
    const providers = await Promise.all(['anthropic', 'openrouter'].map(async id => {
      const P = PROV[id], o = { id, name: P.name, set: !!P.key(), model: P.model(), ok: false, ms: 0, msg: '' };
      if (!o.set) { o.msg = `ยังไม่ได้ตั้ง ${id === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENROUTER_API_KEY'}`; return o; }
      const t0 = Date.now();
      try { const r = await run(id, 'ทดสอบการเชื่อมต่อ ตอบกลับคำเดียวว่า OK', 600, 'low', 25000); o.ok = !!r.text; o.model = r.model || o.model; o.msg = o.ok ? 'ใช้งานได้' : 'ไม่ได้ข้อความกลับมา'; }
      catch (e) { o.msg = e instanceof AIErr ? e.message : 'ทดสอบไม่ผ่าน'; }
      o.ms = Date.now() - t0; return o;
    }));
    return json({ ok: providers.some(p => p.ok), primary: ps[0] || null, providers });
  }

  if (!ps.length) return json({ ok: false, why: 'nokey', msg: 'ยังไม่ได้ตั้งคีย์ AI ใน Netlify (ANTHROPIC_API_KEY หรือ OPENROUTER_API_KEY)' }, 501);
  if (!d.report || typeof d.report !== 'object' || !Array.isArray(d.report.players) || !d.report.players.length) return json({ ok: false, why: 'report' }, 400);
  if (!(await quota())) return json({ ok: false, why: 'quota', msg: `เกินโควตา ${hourly()} ครั้ง/ชม.` }, 429);
  const brief = d.mode === 'brief', content = `${brief ? BRIEF : FULL}\n\nข้อมูล (JSON):\n${JSON.stringify(d.report)}`;
  const t0 = Date.now(), fails = [];
  for (const p of ps) {
    const left = BUDGET - (Date.now() - t0); if (left < 8000) break;
    try {
      const r = await run(p, content, brief ? 2000 : 8000, brief ? 'low' : 'medium', left);
      if (!r.text) { fails.push(`${PROV[p].name}: ไม่ได้ข้อความกลับมา`); continue; }
      return json({ ok: true, via: PROV[p].name, model: r.model, ms: Date.now() - t0, fallback: fails.length ? fails : undefined, text: r.text + (r.cut ? '\n\n(ข้อความยาวเกินกำหนด ถูกตัดท้าย)' : '') });
    } catch (e) {
      const er = e instanceof AIErr ? e : new AIErr('err', 'ขัดข้อง', 500);
      fails.push(`${PROV[p].name}: ${er.message}`);
      if (!er.retry) return json({ ok: false, why: er.why, msg: fails.join(' · ') }, er.status);
    }
  }
  return json({ ok: false, why: 'fail', msg: fails.join(' · ') || 'AI ไม่ตอบ' }, 502);
};

export const config = { path: '/api/analyze' };
