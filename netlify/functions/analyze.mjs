// /api/analyze · ผู้ชมพิเศษให้ AI อ่านตัวเลขการเล่นของ "คนจริง" แล้วเขียนผลประเมินเป็นภาษาไทย
//   POST { key, mode:'full'|'brief', report } → { ok, text, model, via }
//   POST { op:'test', key }                   → { ok, primary, providers:[{ id, name, set, model, ok, ms, msg }] }  (หน้า home → ตั้งค่า)
// key = รหัสพิเศษ (ตรวจที่เซิร์ฟเวอร์ทุกครั้ง) คนอื่นจึงใช้ token ของเราไม่ได้ · ข้อมูลที่ส่งมาไม่มีชื่อผู้เล่นและไม่มีรหัสห้อง
//
// ตั้งค่าทั้งหมดที่ Netlify → Project configuration → Environment variables (ไม่เก็บในรีโป · ตั้งแล้วกด Deploy ใหม่ 1 ครั้ง)
//   OPENROUTER_API_KEY = คีย์ OpenRouter (จำเป็น · ใช้ทางนี้ทางเดียว · ค่าใช้จ่ายตัดจาก credit ที่เติมไว้ใน OpenRouter)
//   OPENROUTER_FREE_MODEL = รุ่นฟรีที่ลองก่อน (ไม่ตั้ง = google/gemma-4-31b-it:free · ใส่ off = ไม่ใช้รุ่นฟรี)
//                        รุ่นฟรีจำกัด 20 ครั้ง/นาที และ 50 ครั้ง/วัน (เคยซื้อ credit รวม ≥ $10 = 1,000 ครั้ง/วัน) · เต็มโควตาหรือใช้ไม่ได้ = ใช้รุ่นเสียเงินต่ออัตโนมัติ
//   OPENROUTER_MODEL   = รุ่นเสียเงิน (ไม่ตั้ง = anthropic/claude-haiku-5.5 เร็วและถูก · ละเอียดขึ้นใช้ anthropic/claude-sonnet-5.5 หรือ anthropic/claude-opus-5.5)
//   AI_HOURLY_LIMIT    = จำนวนครั้งสูงสุดต่อชั่วโมงทั้งเว็บ (ไม่ตั้ง = 600 · โหมด AI สดใช้ ~15–25 ครั้ง/แมตช์) กันค่าใช้จ่ายบานปลาย
import { isMaster } from '../lib/master.mjs';

const MAX_BODY = 90000, BUDGET = 54000;  // function ทำงานได้ไม่เกิน 60 วิ
const env = k => (process.env[k] || '').trim();
// คีย์ที่วางมาเกิน (เครื่องหมายคำพูด, "Bearer ", ช่องว่าง/ขึ้นบรรทัดใหม่) = ตัดออกให้เอง
const cleanKey = k => k.replace(/^["'\s]+|["'\s]+$/g, '').replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
// รูปร่างของคีย์ไว้ช่วยหาสาเหตุ (ไม่ส่งตัวคีย์): ขึ้นต้นถูกไหม ยาวเท่าไร 4 ตัวท้าย · ตัวคีย์ไม่ออกจากเซิร์ฟเวอร์
const keyShape = raw => { const k = cleanKey(raw); return { prefixOk: /^sk-or-/.test(k), prefix: /^sk-or-/.test(k) ? k.slice(0, 9) : '', len: k.length, last4: k.length > 12 ? k.slice(-4) : '', fixed: k !== raw.trim() }; };
const PROV = {
  openrouter: { name: 'OpenRouter', key: () => cleanKey(env('OPENROUTER_API_KEY')), model: () => /^[a-z0-9._-]{2,40}\/[a-z0-9.:_-]{2,60}$/i.test(env('OPENROUTER_MODEL')) ? env('OPENROUTER_MODEL') : 'anthropic/claude-haiku-5.5',
    free: () => { const v = env('OPENROUTER_FREE_MODEL'); return /^(off|none|no|0)$/i.test(v) ? '' : /^[a-z0-9._-]{2,40}\/[a-z0-9.:_-]{2,60}$/i.test(v) ? v : 'google/gemma-4-31b-it:free'; } },
};
const order = () => ['openrouter'].filter(p => PROV[p].key());

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
- คะแนน intent / skill (0-100) เป็นค่าประมาณจากระบบ ใช้ประกอบ ไม่ต้องยึดตายตัว (ไม่ใช่แต้มในเกม)
- ข้อมูลมีเฉพาะคนจริง หุ่นที่ไม่มีในข้อมูลคือ Bot ที่ตัดออกโดยตั้งใจ ห้ามพูดถึงว่าขาดข้อมูล

ความหมายของช่องข้อมูล (metrics):
T = วินาที TELEOP ที่วัด · mv = % เวลาที่หุ่นขยับ · spin = % เวลาหมุนวนอยู่กับที่ · straight = % ความตรงของเส้นทาง (สูง = มีเป้าหมาย)
aimless = จำนวนช่วง 2 วิที่วิ่งวนไร้ทิศทาง · path = ระยะทางที่วิ่ง (เมตร) · shots / hits = ยิง / เข้า CELL ใน TELEOP · acc = % ยิงเข้า
gate = % นัดที่ยิงในวงของทีม · still = % นัดที่ "หยุดนิ่งก่อนยิง" (ไม่ใช่การจอดนิ่ง) · aim = % นัดที่หันเข้าหา CELL ตอนยิง
pickPm = ลูกที่เก็บต่อนาที · cyc / cycAvg = จำนวนรอบเก็บ→ยิง / วินาทีเฉลี่ยต่อรอบ · wallPm / collPm = ชนผนัง / ชนหุ่นต่อนาที
revPm = เปลี่ยนทิศกลับหัวกะทันหันต่อนาที · idleN / idleMax = จอดนิ่งเกิน 6 วิ (ครั้ง / นานสุด วิ) · holdN / holdMax = ถือลูกค้างเกิน 25 วิ (ครั้ง / นานสุด วิ)
major / minor = จำนวน FOUL · ping = ms · notes = ข้อสังเกตที่ระบบสรุปไว้แล้ว
every20s: ทุก 20 วิของ TELEOP (mv %, pick เก็บ, shots ยิง, walls, coll) · scoreEvery10s: el = เวลาในแมตช์, i = คะแนนความตั้งใจ, s = คะแนนฝีมือ (ของระบบ)
events[]: ไทม์ไลน์ของผู้เล่น · t = เวลาที่เหลือบนนาฬิกา (เช่น 1:42) · k = pick (เก็บลูก n = จำนวนในหุ่น) / shot (d = ระยะถึง HIVE ม., gate / still / aim / hit = จริงหรือไม่) / foul (rule, sev, why) / idle (จอดนิ่ง sec วิ) / lzIn / lzOut (เข้า/ออก LOADING ZONE ช่วงท้าย)
zones = % ของเวลา: own ฝั่งตัวเอง, opp ฝั่งคู่แข่ง, ring อยู่ในวงยิงของทีม, lz ใน LOADING ZONE ของทีม, wall ติดผนัง · teamRing = วงยิงของทีม [ใกล้สุด, ไกลสุด] ม.
endgame = 30 วิสุดท้าย (moving %, inLoadingZone %, shots, hits) · park = จอด PARK ตอนจบหรือไม่ · scoreTimeline = สกอร์ทีมทุก 10 วิ
benchmark = ค่าเฉลี่ยของ Bot ในแมตช์เดียวกัน ใช้เทียบว่าผู้เล่นช้า/เร็ว แม่น/พลาดกว่ามาตรฐานแค่ไหน · drills = บทฝึกในเว็บ (id, title) ให้เลือกแนะนำจากรายการนี้เท่านั้น
last20s / recentEvents (โหมดสด) = ข้อมูล 20 วิล่าสุด ใช้บอกสิ่งที่ควรพูดตอนนี้
- ใช้ภาษาไทยที่สุภาพ เป็นกันเอง ให้กำลังใจ ผู้อ่านคือครู/โค้ช และอาจอ่านให้นักเรียนฟัง ศัพท์เกมใช้ภาษาอังกฤษ (HIVE, CELL, POLLEN, NECTAR, FLOWER, PARK, TELEOP)`;

const FULL = `เขียนผลประเมินที่ครูนำไปใช้ได้ทันที (Markdown ง่าย ๆ ไม่มีตาราง ไม่ต้องทวนตัวเลขทุกตัว เลือกเฉพาะหลักฐานที่สำคัญ):
## สรุปสำหรับครู
- ใครน่าห่วงที่สุดและเพราะอะไร · ใครทำได้ดีที่สุด · ความมั่นใจของผล (สูง/กลาง/ต่ำ + เหตุผลสั้น ๆ)
## <ตำแหน่ง> (<ทีม>)
**ความตั้งใจ:** ระดับ + หลักฐาน 2-3 ข้อ (อ้างตัวเลขหรือเหตุการณ์พร้อมเวลา)
**ฝีมือ:** ระดับ + หลักฐาน เทียบกับ benchmark ถ้ามี (เช่น cycle ช้ากว่า Bot กี่วินาที)
**จังหวะที่ควรดูซ้ำ:** 1-3 ช่วงจาก events พร้อมเวลา (เช่น "1:42 ยิงจาก 2.6 ม. ไม่หันเข้า CELL → พลาด")
**เทียบแมตช์ก่อนหน้า:** ดีขึ้น/แย่ลงเรื่องใด (ถ้าไม่มี previousMatches เขียนว่า "ยังไม่มีข้อมูลเทียบ")
**โค้ชควรพูดกับผู้เล่น:** 1-2 ประโยคสั้น ให้กำลังใจ และบอกสิ่งเดียวที่ต้องแก้ก่อน
**บทฝึกที่แนะนำ:** 1-2 บทจาก drills เขียนรหัสก่อนชื่อ เช่น "D1.5 หยุดก่อนยิง" พร้อมเหตุผล 1 ประโยค
ทำครบทุกคนในข้อมูล คนละไม่เกินประมาณ 150 คำ`;
const BRIEF = `นี่คือข้อมูลระหว่างแมตช์ (ยังไม่จบ) ดูจาก last20s และ recentEvents เป็นหลัก สรุปสั้นมาก คนละ 1 บรรทัด รูปแบบ:
- **<ตำแหน่ง>** 🟢/🟡/🔴 สิ่งที่เห็นใน 20 วิล่าสุด (อ้างตัวเลขหรือเหตุการณ์ 1 อย่าง) → โค้ชพูดว่า: "<ประโยคสั้นที่พูดได้ทันที>"
ไม่เกิน 35 คำต่อคน ไม่ต้องมีหัวข้อหรือคำนำ`;

const hourly = () => Math.max(1, Math.min(2000, parseInt(env('AI_HOURLY_LIMIT') || '600', 10) || 600));
async function quota(n = 1) {  // นับครั้งที่เรียก AI ใน 1 ชม. ที่ผ่านมา (ทั้งเว็บ)
  try {
    const st = await store(), now = Date.now(), o = (await st.get('ai/h', { type: 'json' }).catch(() => null)) || { t: [] };
    const t = (Array.isArray(o.t) ? o.t : []).filter(x => now - x < 3600e3);
    if (t.length + n > hourly()) return false;
    for (let i = 0; i < n; i++) t.push(now); await st.setJSON('ai/h', { t }); return true;
  } catch { return true; }  // ที่เก็บโควตาใช้ไม่ได้ชั่วคราว = ไม่บล็อกครู (ยังต้องมีรหัสพิเศษ)
}
class AIErr extends Error { constructor(why, msg, status, retry = true) { super(msg); Object.assign(this, { why, status, retry }); } }  // retry = ลองทางสำรองได้

async function viaOpenRouter(models, content, maxTok, effort, ms) {  // models = [รุ่นฟรี, รุ่นเสียเงิน] · OpenRouter ลองตามลำดับในคำขอเดียว คิดเงินตามรุ่นที่ตอบจริง
  const model = models[0], pick = models.length > 1 ? { models } : { model };
  let q, d;
  try {
    q = await fetch((env('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1') + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(ms),
      headers: { authorization: 'Bearer ' + PROV.openrouter.key(), 'content-type': 'application/json' },
      body: JSON.stringify({ ...pick, max_tokens: maxTok, reasoning: { effort }, messages: [{ role: 'system', content: SYS }, { role: 'user', content }] }) });
    d = await q.json().catch(() => null);
  } catch (e) { throw e?.name === 'TimeoutError' ? new AIErr('timeout', 'ตอบไม่ทันเวลา', 504, false) : new AIErr('conn', 'ต่อไม่ได้', 502); }
  const em = String(d?.error?.message || '').replace(/\s+/g, ' ').slice(0, 160), emFull = String(d?.error?.message || '').replace(/\s+/g, ' ').slice(0, 600);
  if (!q.ok || d?.error) {
    const s = q.ok ? (+d?.error?.code || 502) : q.status;
    if (s === 401) throw new AIErr('aikey', 'คีย์ไม่ถูกต้องหรือถูกยกเลิก' + (em ? ' · OpenRouter แจ้ง: ' + em : ''), 502);
    if (s === 402) throw new AIErr('credit', 'credit หมด / ไม่พอ (เติมที่ openrouter.ai)', 502);
    if (s === 404 && /guardrail|data policy/i.test(em)) throw new AIErr('policy', 'บัญชี OpenRouter บล็อกรุ่น ' + model + ' ด้วยการตั้งค่า Privacy / Guardrails · แก้ที่ openrouter.ai/settings/privacy · OpenRouter แจ้ง: ' + emFull, 502);
    if (s === 404) throw new AIErr('model', 'ใช้รุ่น ' + model + ' ไม่ได้' + (em ? ' · ' + em : ' (ตรวจ OPENROUTER_MODEL)'), 502);  // เช่น ตั้งค่าความเป็นส่วนตัวใน OpenRouter บล็อกผู้ให้บริการ
    if (s === 429) throw new AIErr('ai', 'ถูกจำกัดความถี่ (rate limit)', 429);
    if (s === 403) throw new AIErr('refusal', 'AI ไม่ตอบคำขอนี้', 422, false);
    throw new AIErr('api', `ขัดข้อง (${s})${em ? ' · ' + em : ''}`, 503);
  }
  const c = d?.choices?.[0], text = typeof c?.message?.content === 'string' ? c.message.content.trim() : '';
  if (c?.finish_reason === 'content_filter') throw new AIErr('refusal', 'AI ไม่ตอบคำขอนี้', 422, false);
  return { text, model: String(d?.model || model), cut: c?.finish_reason === 'length' };
}
const chain = () => [PROV.openrouter.free(), PROV.openrouter.model()].filter(Boolean);
const run = (p, ...a) => viaOpenRouter(chain(), ...a);
const isFree = m => /:free$/.test(String(m || ''));

export default async req => {
  if (req.method !== 'POST') return json({ ok: false, why: 'method' }, 405);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false, why: 'cross-site' }, 403);
  let d; try { const t = await req.text(); if (t.length > MAX_BODY) return json({ ok: false, why: 'big' }, 413); d = JSON.parse(t); } catch { return json({ ok: false, why: 'body' }, 400); }
  if (!(await isMaster(d?.key))) { await new Promise(ok => setTimeout(ok, 400)); return json({ ok: false, why: 'key' }, 403); }
  const ps = order();

  if (d.op === 'test') {  // ทดสอบทุกทางที่ตั้งคีย์ไว้พร้อมกัน (คำถามสั้นมาก ใช้ token น้อย)
    const set = ps.filter(Boolean);
    if (set.length && !(await quota(2))) return json({ ok: false, why: 'quota', msg: `เกินโควตา ${hourly()} ครั้ง/ชม.` }, 429);
    const P = PROV.openrouter, list = [P.free() && { id: 'free', name: 'OpenRouter รุ่นฟรี', model: P.free() }, { id: 'paid', name: 'OpenRouter รุ่นเสียเงิน', model: P.model() }].filter(Boolean);
    const providers = await Promise.all(list.map(async (it, k) => {
      const o = { ...it, set: !!P.key(), ok: false, ms: 0, msg: '' };
      if (!o.set) { o.msg = 'ยังไม่ได้ตั้ง OPENROUTER_API_KEY ใน Netlify'; return o; }
      if (k === 0) o.key = keyShape(env('OPENROUTER_API_KEY'));
      const t0 = Date.now();
      try { const r = await viaOpenRouter([it.model], 'ทดสอบการเชื่อมต่อ ตอบกลับคำเดียวว่า OK', 600, 'low', 25000); o.ok = !!r.text; o.model = r.model || o.model; o.msg = o.ok ? (it.id === 'free' ? 'ใช้งานได้ (ฟรี จำกัดจำนวนครั้งต่อวัน)' : 'ใช้งานได้') : 'ไม่ได้ข้อความกลับมา'; }
      catch (e) { o.msg = e instanceof AIErr ? e.message : 'ทดสอบไม่ผ่าน'; }
      o.ms = Date.now() - t0; return o;
    }));
    return json({ ok: providers.some(p => p.ok), primary: providers[0]?.id || null, providers });
  }

  if (!ps.length) return json({ ok: false, why: 'nokey', msg: 'ยังไม่ได้ตั้งคีย์ AI ใน Netlify (OPENROUTER_API_KEY)' }, 501);
  if (!d.report || typeof d.report !== 'object' || !Array.isArray(d.report.players) || !d.report.players.length) return json({ ok: false, why: 'report' }, 400);
  if (!(await quota())) return json({ ok: false, why: 'quota', msg: `เกินโควตา ${hourly()} ครั้ง/ชม.` }, 429);
  const brief = d.mode === 'brief', content = `${brief ? BRIEF : FULL}\n\nข้อมูล (JSON):\n${JSON.stringify(d.report)}`;
  // AI อาจใช้เวลา 20-40 วิ แต่ Netlify ตัดการเชื่อมต่อที่เงียบเกิน ~26 วิ → ตอบแบบ stream: ส่งช่องว่าง 1 ตัวทุก 5 วิระหว่างรอ แล้วต่อด้วย JSON
  // (JSON.parse ข้ามช่องว่างนำหน้าได้) · ผลผิดพลาดหลังเริ่ม stream บอกรหัสใน status แทน HTTP status
  const work = async () => {
    const t0 = Date.now(), fails = [];
    for (const p of ps) {
      const left = BUDGET - (Date.now() - t0); if (left < 8000) break;
      try {
        const r = await run(p, content, brief ? 2000 : 8000, brief ? 'low' : 'medium', left);
        if (!r.text) { fails.push(`${PROV[p].name}: ไม่ได้ข้อความกลับมา`); continue; }
        return { ok: true, status: 200, via: PROV[p].name + (isFree(r.model) ? ' · ฟรี' : ''), free: isFree(r.model), model: r.model, ms: Date.now() - t0, fallback: fails.length ? fails : undefined, text: r.text + (r.cut ? '\n\n(ข้อความยาวเกินกำหนด ถูกตัดท้าย)' : '') };
      } catch (e) {
        const er = e instanceof AIErr ? e : new AIErr('err', 'ขัดข้อง', 500);
        fails.push(`${PROV[p].name}: ${er.message}`);
        if (!er.retry) return { ok: false, status: er.status, why: er.why, msg: fails.join(' · ') };
      }
    }
    return { ok: false, status: 502, why: 'fail', msg: fails.join(' · ') || 'AI ไม่ตอบ' };
  };
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(ctl) {
      const iv = setInterval(() => { try { ctl.enqueue(enc.encode(' ')); } catch {} }, 5000);
      let out; try { out = await work(); } catch { out = { ok: false, status: 500, why: 'err', msg: 'ขัดข้อง' }; }
      clearInterval(iv); ctl.enqueue(enc.encode(JSON.stringify(out))); ctl.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
};

export const config = { path: '/api/analyze' };
