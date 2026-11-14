// รหัสทีม (ตั้งที่ Netlify → Environment variables: SCOUT_KEY) หรือรหัสพิเศษของผู้ดูแล · ใช้ร่วมกันโดย /api/scout และ /api/academy
import { isMaster } from './master.mjs';
export const okTeamKey = async k => { if (typeof k !== 'string' || !k || k.length > 128) return false; const sk = (process.env.SCOUT_KEY || '').trim(); return (sk && k.trim() === sk) || isMaster(k); };
