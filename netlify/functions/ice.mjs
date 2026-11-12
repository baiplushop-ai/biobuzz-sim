// /api/ice · ส่งรายการ ICE server (STUN + TURN) ให้หน้าเล่นออนไลน์
// TURN = ตัวส่งต่อข้อมูล ใช้เมื่อสองเครื่องต่อตรงกันไม่ได้ (เช่น hotspot มือถือที่อยู่หลัง CGNAT)
// TURN ฟรีที่ PeerJS เคยตั้งไว้ในตัว (eu-0 / us-0.turn.peerjs.com) ปิดไปแล้ว จึงต้องตั้งเองที่ Netlify → Site configuration → Environment variables
//   แบบ 1 Cloudflare Realtime TURN (ฟรี 1,000 GB / เดือน): CF_TURN_KEY_ID + CF_TURN_API_TOKEN
//   แบบ 2 TURN ที่มี username / password คงที่ (เช่น Metered): TURN_URLS (คั่นด้วย ,) + TURN_USERNAME + TURN_CREDENTIAL
// ไม่มีความลับในไฟล์นี้ · ยังไม่ได้ตั้ง = ส่ง STUN อย่างเดียว (เล่นได้เหมือนเดิม แต่บางเครือข่ายต่อไม่ติด)
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const env = k => (process.env[k] || '').trim();
const json = o => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const hasTurn = list => list.some(s => [].concat(s.urls).some(u => /^turns?:/.test(u)));

export default async req => {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ iceServers: STUN, turn: false, why: 'cross-site' });  // ไม่แจก TURN ให้เว็บอื่น
  const kid = env('CF_TURN_KEY_ID'), tok = env('CF_TURN_API_TOKEN');
  if (kid && tok) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(kid)}/credentials/generate-ice-servers`, {
        method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }), signal: AbortSignal.timeout(5000) });
      if (!r.ok) return json({ iceServers: STUN, turn: false, why: 'cloudflare ' + r.status });
      const d = await r.json();
      // พอร์ต 53 ของ Cloudflare ทำให้เบราว์เซอร์บางตัวค้าง ตัดออก
      const list = [].concat(d.iceServers || []).map(s => ({ ...s, urls: [].concat(s.urls || []).filter(u => !/:53(\?|$)/.test(u)) })).filter(s => s.urls.length);
      return json({ iceServers: [...STUN, ...list], turn: hasTurn(list), src: 'cloudflare' });
    } catch { return json({ iceServers: STUN, turn: false, why: 'cloudflare unreachable' }); }
  }
  const urls = env('TURN_URLS').split(',').map(s => s.trim()).filter(Boolean);
  if (urls.length) return json({ iceServers: [...STUN, { urls, username: env('TURN_USERNAME'), credential: env('TURN_CREDENTIAL') }], turn: true, src: 'static' });
  return json({ iceServers: STUN, turn: false, why: 'not configured' });
};

export const config = { path: '/api/ice' };
