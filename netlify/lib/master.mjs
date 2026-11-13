// รหัสพิเศษ (ผู้ดูแล): เข้าชมได้ทุกห้อง + ใช้ AI วิเคราะห์ผู้เล่น · ใช้ร่วมกันโดย /api/rooms และ /api/analyze
// รีโปนี้เปิดสาธารณะ จึงเก็บแค่ค่า hash แบบย้อนกลับไม่ได้ (PBKDF2) ไม่เก็บตัวรหัส · ไม่สนตัวพิมพ์เล็ก/ใหญ่
// เปลี่ยนรหัสได้ที่ Netlify → Environment variables: WATCH_MASTER_KEY = รหัสใหม่ (ตั้งแล้วใช้รหัสนั้นแทนค่าเริ่มต้น)
const MASTER_SALT = 'biobuzz-watch-v1', MASTER_HASH = '1e1e41864429ddd4cbf92c1f3677fcdda853168f4c8ada7ec5427a6636553883';
const pbk = async k => { const b = await crypto.subtle.importKey('raw', new TextEncoder().encode(k), 'PBKDF2', false, ['deriveBits']);
  return [...new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(MASTER_SALT), iterations: 120000 }, b, 256))].map(x => x.toString(16).padStart(2, '0')).join(''); };
export const isMaster = async k => { if (typeof k !== 'string' || !k || k.length > 40) return false; const env = (process.env.WATCH_MASTER_KEY || '').trim(); k = k.toLowerCase(); return env ? k === env.toLowerCase() : await pbk(k) === MASTER_HASH; };
