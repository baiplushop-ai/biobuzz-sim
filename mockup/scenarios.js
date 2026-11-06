// สถานการณ์จำลองของแต่ละหัวข้อใน Drive Coach Academy
// ใช้ร่วมกัน 2 หน้า: mockup/index.html (รันจริง) และ coach-training/index.html (อ่านชื่อ/เป้าหมาย)
// ฟังก์ชัน setup/tick/ok จะถูกเรียกเฉพาะใน simulator เท่านั้น
// พิกัด (เมตร): X แดง→น้ำเงิน, Z หลังสนาม→ฝั่งผู้ชม · CELL แดงที่หงายตอนเริ่มอยู่ฝั่ง +Z
(function () {
const RED_HALF = { xMin: -1.6, xMax: -0.8, zMin: -1.55, zMax: 1.55 };
const RED_SPOT = [-1.32, 1.0];            // จุดยิงที่ใช้ได้ของ CELL แดงฝั่ง +Z (ห่าง ~1.2 ม.)
const RED_FLOWER_FRONT = [-1.375, 0.594]; // หน้า FLOWER บนกำแพงแดง หันหน้าเข้ากำแพง
const BLUE_FLOWER_FRONT = [1.375, -0.594];
const TIME_CALLS = [90, 65, 60, 30, 20, 10];
const autoPlans = {
  R1: [
    { label: 'ยิงทันที', tasks: [{ goto: 'spot' }, { shoot: 4 }] },
    { label: 'รอ 5 วิ แล้วยิง', tasks: [{ wait: 5 }, { goto: 'spot' }, { shoot: 4 }] },
  ],
  R2: [
    { label: 'รอ HIVE นิ่งแล้วค่อยยิง', tasks: [{ wait: 1 }, { goto: 'spot' }, { shoot: 4 }] },
    { label: 'ยิงทันที ไม่รอ HIVE', tasks: [{ goto: 'spot' }, { shoot: 4, ignoreTip: true }] },
    { label: 'ไม่ยิง: ไปจอด LOADING ZONE แบบไม่แตะกำแพง', tasks: [{ wait: 1 }, { goto: 'lzAuto' }] },
  ],
};

const BENCH_ALL = api => ['R2', 'B1', 'B2'].forEach(api.bench);
const COURSE = [[-1.2, -1.2], [-0.2, -1.35], [1.2, -1.2], [1.35, 0.0], [1.2, 1.2], [0.0, 1.35], [-1.2, 1.2], [-1.0, 0.0]];
function markStep(api, dt, needHold) {
  const S = api.S, ms = S.sc.marks, i = ms.findIndex(m => !m.done); if (i < 0) return;
  ms.forEach((m, k) => m.cur = k === i); const m = ms[i], r = api.robot('R1'), d = Math.hypot(r.x - m.x, r.z - m.z);
  if (!needHold) { if (d < m.r) { m.done = true; api.say(`ผ่านจุด ${i + 1}/${ms.length}`, 1); } return; }
  if (d < m.r && Math.hypot(r.vx, r.vz) < 0.05) { S.sc.hold = (S.sc.hold || 0) + dt; if (S.sc.hold >= 1) { m.done = true; S.sc.hold = 0; api.say(`หยุดตรงจุด ${i + 1}/${ms.length} ✓`, 1.2); } } else S.sc.hold = 0;
}
function hpTiming(api, win = 5) {
  const tips = api.tipEvents('red').filter(e => e.rem > 60), rel = api.releases('red').filter(r => r.rem > 60), used = new Set(); let ok = 0;
  for (const t of tips) { if (t.staged <= 0) { ok++; continue; } const k = rel.findIndex((r, i) => !used.has(i) && r.el >= t.el - 0.05 && r.el <= t.el + win); if (k >= 0) { used.add(k); ok++; } }
  return { tips: tips.length, ok };
}
const hpStatus = api => { const S = api.S, rem = api.remaining(), credit = rem <= 60 ? 'ทั้งหมด' : Math.max(0, S.stats.tips.red - S.hp.red.used); const occ = ['R1', 'R2'].some(id => !api.robot(id).off && api.overlapLZ(id, 'red')); return `สิทธิ์ปล่อยตอนนี้: ${credit} · LOADING ZONE แดง: ${occ ? 'มีหุ่นอยู่ ⚠' : 'ว่าง'} · เหลือในมือ ${api.stagedLeft('red')}`; };
function hpCommon(api) { api.ai('R1', { mode: 'offense' }); api.ai('R2', { mode: 'offense' }); }

window.SCENARIOS = {
// ---------------- Drive Coach ----------------
'2.1': {
  title: 'ชี้เป้าให้คนขับ',
  brief: 'บนพื้นฝั่งแดงมี POLLEN 12 ลูก ลูกที่มีวงแหวนสีเขียวคือเป้าหมาย ทีละลูก โค้ชสั่งด้วยคำสั่งสั้น ๆ ให้คนขับเก็บให้ถูกลูก กล้องล็อกไว้ที่มุม Driver Station เหมือนที่ยืนจริง ถ้าเก็บผิดลูก หุ่นจะคายออกเองและนับเป็นความผิดพลาด',
  start: 90, opt: { lockCam: 2, bots: false, gate: false },
  setup(api) {
    api.resetBalls(); ['R2', 'B1', 'B2'].forEach(api.bench);
    api.pos('R1', -1.4, 0, -Math.PI / 2); api.carry('R1', []);
    const pts = api.randomPoints(12, RED_HALF, 0.3);
    api.S.sc.targets = pts.slice(0, 6).map(p => api.floor('pollen', 'yellow', p[0], p[1]));
    pts.slice(6).forEach(p => api.floor('pollen', 'yellow', p[0], p[1]));
    api.S.sc.cur = 0; api.S.sc.wrong = 0; api.highlight(api.S.sc.targets[0]);
  },
  onPickup(api, r, bi) {
    const sc = api.S.sc; if (r.id !== 'R1') return;
    if (bi === sc.targets[sc.cur]) { sc.cur++; api.vanish(bi); api.say(`ถูกเป้า ${sc.cur}/6`); api.highlight(sc.targets[sc.cur] ?? null); }
    else { sc.wrong++; api.say('ผิดลูก! หุ่นคายออก'); api.ejectBall(r, bi); }
  },
  end: api => api.S.sc.cur >= 6,
  obj: [
    { t: 'เก็บลูกเป้าหมายครบ 6 ลูกภายใน 90 วิ', ok: S => S.sc.cur >= 6 },
    { t: 'เก็บผิดลูกไม่เกิน 1 ครั้ง', ok: S => S.sc.wrong <= 1, live: true },
  ],
},
'2.2': {
  title: 'นาฬิกาของทีม',
  brief: 'แมตช์ TELEOP 2:00 กับหุ่น AI อีก 3 ตัว นาฬิกาใหญ่ถูกซ่อนไว้ คนขับจึงไม่เห็นเวลา โค้ชดูนาฬิกาเล็กในแผงโค้ช แล้วกด B หรือปุ่ม "ประกาศเวลา" ทุกครั้งที่พูดเวลาออกไปที่ 1:30, 1:05, 1:00, 0:30, 0:20 และ 0:10 จากนั้นสั่ง PARK ให้ทัน',
  start: 120, opt: { hideClock: true }, coach: ['call'],
  setup() {},
  obj: [
    { t: 'ประกาศเวลาครบ 6 จุด คลาดไม่เกิน 2 วิ', ok: (S, api) => api.callsHit(TIME_CALLS, 2) === 6 },
    { t: 'R1 PARK ทันตอนจบแมตช์', ok: S => !!S.end?.park?.R1 },
    { t: 'ฝั่งแดงไม่โดน FOUL', ok: (S, api) => api.foulCount('red') === 0, live: true },
  ],
},
'2.3': {
  title: 'นับลูกจนถึง TIP',
  brief: 'มิเตอร์น้ำหนักใน CELL ถูกซ่อน โค้ชต้องนับเองว่าอีกกี่ลูกจะ TIP CELL หงายเริ่มด้วย NECTAR 3 ลูก ลูก POLLEN ที่ 3 จะพลิก หลังพลิก CELL ใหม่ว่าง ต้อง 8 ลูก ก่อนคนขับยิงลูกที่โค้ชคิดว่าจะ TIP ให้กด P หรือปุ่ม "ทาย: ลูกนี้ TIP"',
  start: 120, opt: { hideLoad: true, bots: false }, coach: ['predict'],
  setup(api) {
    ['B1', 'B2'].forEach(api.bench); api.ai('R2', { mode: 'idle' });
    api.pos('R1', -1.45, 0.3, -Math.PI / 2); api.carry('R1', ['pollen', 'pollen', 'pollen', 'pollen']);
    api.scatter(16, RED_HALF);
  },
  end: api => api.tips('red') >= 3,
  obj: [
    { t: 'ทำ TIP ได้ 3 ครั้ง', ok: (S, api) => api.tips('red') >= 3 },
    { t: 'ทาย TIP ถูกอย่างน้อย 2 ครั้ง', ok: S => S.stats.predOk >= 2 },
    { t: 'ทายผิดไม่เกิน 1 ครั้ง', ok: S => S.stats.predBad <= 1, live: true },
  ],
},
'3.1': {
  title: 'ตั้งหุ่นก่อนแมตช์ (G304)',
  brief: 'หุ่นอยู่กลางฝั่งแดงและยังไม่มี pre-load ให้เก็บ POLLEN 4 ลูกที่วางอยู่ใกล้ ๆ แล้วขับไปตั้งในตำแหน่งเริ่มที่ถูกกติกา คือแตะกำแพงฝั่งแดง อยู่นอก LOADING ZONE และไม่แตะ FLOWER จากนั้นกด Y หรือปุ่ม "ยืนยันตำแหน่ง"',
  start: 60, opt: { bots: false, gate: false, noClockRules: true }, coach: ['confirm'],
  setup(api) {
    api.resetBalls(); ['R2', 'B1', 'B2'].forEach(api.bench);
    api.pos('R1', -0.95, 0.2, Math.random() * 6.28); api.carry('R1', []);
    [[-1.15, -0.35], [-0.95, -0.6], [-1.3, 0.75], [-0.9, 0.95]].forEach(p => api.floor('pollen', 'yellow', p[0], p[1]));
  },
  onConfirm(api) { api.S.sc.check = api.startPoseCheck('R1'); },
  end: api => !!api.S.sc.check,
  obj: [
    { t: 'มี POLLEN pre-load 4 ลูกในหุ่น', ok: S => !!S.sc.check?.preload },
    { t: 'แตะกำแพง และหุ่นอยู่ในฝั่งแดงทั้งตัว', ok: S => !!S.sc.check?.wall && !!S.sc.check?.side },
    { t: 'อยู่นอก LOADING ZONE', ok: S => !!S.sc.check?.outLZ },
    { t: 'ไม่แตะ FLOWER', ok: S => !!S.sc.check?.noFlower },
    { t: 'ยืนยันตำแหน่งภายใน 60 วิ', ok: S => !!S.sc.check },
  ],
},
'3.5': {
  title: 'วางแผน AUTO 30 วินาที',
  brief: 'เลือกแผน AUTO ให้หุ่นแดงทั้งสองตัว แล้วดูผลการรัน 30 วิ หุ่นสองตัวมี POLLEN รวม 8 ลูก CELL หงายมี NECTAR 3 ลูก ใน AUTO ยิงลูกเข้า CELL ระหว่าง HIVE กำลังพลิกอาจทำให้ TIP ไม่สำเร็จ ส่วน PARK ตอนจบ AUTO แบบไม่แตะกำแพงจะได้ทั้ง LEAVE และ PARK',
  phase: 'auto', opt: { disrupt: true }, plans: autoPlans,
  setup() {},
  end: api => api.S.el >= 30,
  obj: [
    { t: 'LEAVE ครบทั้งสองหุ่นแดง', ok: S => S.stats.leave.red >= 2 },
    { t: 'AUTO TIP อย่างน้อย 1 ครั้ง', ok: S => S.stats.autoTips.red >= 1 },
    { t: 'R1 กับ R2 ไม่ชนกัน', ok: (S, api) => api.hits('R1', 'R2') === 0, live: true },
    { t: 'ไม่มี TIP ที่ถูกขัดจนไม่สำเร็จ', ok: S => S.stats.disrupted.red === 0, live: true },
  ],
},
'4.1': {
  title: 'คุมจังหวะ cycle',
  brief: 'หุ่นเริ่มโดยไม่มีลูก มี POLLEN กระจายอยู่ทั่วฝั่งแดง 1 cycle คือเก็บลูก ไปจุดยิง หยุด และยิงจนหมด โค้ชจับเวลาแต่ละ cycle และเลือกแหล่งลูกถัดไปให้คนขับล่วงหน้า',
  start: 120, opt: { bots: false },
  setup(api) {
    api.resetBalls(); ['R2', 'B1', 'B2'].forEach(api.bench);
    api.carry('R1', []); api.cell('red', 0, 3); api.scatter(28, RED_HALF);
  },
  end: api => api.robot('R1').cycles.length >= 5,
  obj: [
    { t: 'ทำครบ 5 cycle', ok: S => S.robots[0].cycles.length >= 5 },
    { t: 'cycle ที่ 5 เร็วกว่า cycle ที่ 1', ok: S => { const c = S.robots[0].cycles; return c.length >= 5 && c[4] < c[0]; } },
    { t: 'cycle เฉลี่ยไม่เกิน 20 วิ', ok: S => { const c = S.robots[0].cycles.slice(0, 5); return c.length >= 5 && c.reduce((a, b) => a + b, 0) / c.length <= 20; } },
  ],
},
'4.2': {
  title: 'หลัง TIP: สลับฝั่ง',
  brief: 'CELL หงายขาดอีก 1 ลูกจะ TIP หุ่นถือ POLLEN 4 ลูกอยู่ที่จุดยิงแล้ว หลังพลิก CELL ที่หงายใหม่อยู่อีกฝั่งของ HIVE โค้ชต้องสั่ง "สลับ" ทันที และห้ามจอดรอใต้ HIVE เพื่อรับลูกที่ร่วงลงมา (G409)',
  start: 40, opt: { bots: false },
  setup(api) {
    ['B1', 'B2'].forEach(api.bench); api.ai('R2', { mode: 'idle' });
    api.cell('red', 2, 3); api.pos('R1', RED_SPOT[0], RED_SPOT[1]); api.faceCell('R1');
    api.carry('R1', ['pollen', 'pollen', 'pollen', 'pollen']);
  },
  obj: [
    { t: 'ทำ TIP แรกได้', ok: (S, api) => api.tips('red') >= 1 },
    { t: 'ยิงเข้า CELL ใหม่อย่างน้อย 3 ลูก ภายใน 15 วิหลัง TIP', ok: S => (S.sc.afterTip ?? 0) >= 3 },
    { t: 'ไม่รับลูกที่ร่วงจาก HIVE (G409)', ok: S => S.stats.g409.red === 0, live: true },
  ],
  onTip(api, c) { if (c === 'red' && api.S.sc.tipEl == null) { api.S.sc.tipEl = api.S.el; api.S.sc.afterTip = 0; } },
  onCellHit(api, b) { const sc = api.S.sc; if (b.hive === 'red' && sc.tipEl != null && api.S.el - sc.tipEl <= 15) sc.afterTip++; },
},
'4.3': {
  title: 'ช่วง 1:00: ทำ FLOWER',
  brief: 'เหลือ 1:05 หุ่นถือ NECTAR แดง 1 ลูกกับ POLLEN 2 ลูก จอดอยู่หน้า FLOWER บนกำแพงแดง ห้ามใส่ NECTAR ก่อนนาฬิกาถึง 1:00 (G410) จากนั้นทำแต้มต่อและกลับไป PARK ให้ทัน หุ่นอีก 3 ตัวเล่นตามปกติ',
  start: 65,
  setup(api) {
    api.pos('R1', RED_FLOWER_FRONT[0], RED_FLOWER_FRONT[1], Math.PI / 2);
    api.carry('R1', ['nectar:red', 'pollen', 'pollen']);
  },
  obj: [
    { t: 'ไม่โดน G410 (NECTAR เข้า FLOWER ก่อน 1:00)', ok: (S, api) => api.foulCount('red', 'G410') === 0, live: true },
    { t: 'ฝั่งแดงเป็นเจ้าของ FLOWER อย่างน้อย 1 ต้นตอนจบ', ok: S => (S.end?.owners || []).includes('red') },
    { t: 'R1 PARK ทันตอนจบแมตช์', ok: S => !!S.end?.park?.R1 },
  ],
},
'4.4': {
  title: 'PARK หรือยิงต่อ',
  brief: 'รอบ Playoff เหลือ 0:12 หุ่นถือ POLLEN 4 ลูก CELL ขาดอีก 2 ลูกจะ TIP จุดยิงอยู่ห่างประมาณ 2 วิ LOADING ZONE ห่างประมาณ 5 วิ พันธมิตร PARK แล้ว เลือกให้คุ้มที่สุด',
  start: 12, opt: { bots: false },
  setup(api) {
    ['B1', 'B2'].forEach(api.bench); api.parkNow('R2');
    api.cell('red', 6, 0); api.pos('R1', -1.35, 0.05, -Math.PI / 2);
    api.carry('R1', ['pollen', 'pollen', 'pollen', 'pollen']);
  },
  obj: [
    { t: 'ทำ TIP ได้', ok: (S, api) => api.tips('red') >= 1 },
    { t: 'R1 PARK ทันตอนจบ', ok: S => !!S.end?.park?.R1 },
    { t: 'ไม่โดน FOUL', ok: (S, api) => api.foulCount('red') === 0, live: true },
  ],
},
'5.1': {
  title: 'PIN และการปะทะ',
  brief: 'หุ่น B1 ของคู่แข่งจะพุ่งเข้าชนหุ่นเราเป็นระยะ หุ่นชนกัน 1 ครั้งเลือดลด 2% ถ้าหุ่นเราดันคู่แข่งติดกำแพงหรือสิ่งกีดขวางเกิน 3 วิ จะโดน PIN FOUL (G421) โค้ชต้องเรียก "ระวัง" ก่อนชน และสั่ง "ถอย" ถ้าเริ่มติดกัน',
  start: 120,
  setup(api) { api.ai('B1', { mode: 'bump', target: 'R1' }); },
  obj: [
    { t: 'เลือด R1 เหลืออย่างน้อย 90%', ok: S => S.robots[0].hp >= 90, live: true },
    { t: 'ไม่โดน PIN FOUL (G421)', ok: (S, api) => api.foulCount('red', 'G421') === 0, live: true },
    { t: 'TIP อย่างน้อย 2 ครั้ง', ok: (S, api) => api.tips('red') >= 2 },
  ],
},
'5.2': {
  title: 'พันธมิตรดับกลางแมตช์',
  brief: 'เหลือ 1:30 หุ่น R2 ของพันธมิตรเล่นอยู่ แล้วจะดับเมื่อเหลือ 1:20 และค้างอยู่กลางสนาม โค้ชต้องปรับแผนให้หุ่นเรารับทั้งงาน TIP และ PARK และขับหลบหุ่นที่ดับ',
  start: 90,
  setup(api) { api.ai('R2', { mode: 'offense', dieAt: 80 }); },
  obj: [
    { t: 'TIP อย่างน้อย 2 ครั้งหลังพันธมิตรดับ', ok: (S, api) => api.tipsAfter('red', 80) >= 2 },
    { t: 'R1 PARK ทันตอนจบ', ok: S => !!S.end?.park?.R1 },
    { t: 'ชนหุ่นที่ดับไม่เกิน 1 ครั้ง', ok: (S, api) => api.hits('R1', 'R2', 80) <= 1, live: true },
  ],
},
'5.3': {
  title: 'คู่แข่งเล่นเกมรับ',
  brief: 'หุ่น B1 จะไปจอดขวางจุดยิงที่ใกล้หุ่นเราที่สุดทุกครั้ง ส่วนพันธมิตร R2 ไม่ได้ยิง HIVE ในสถานการณ์นี้ โค้ชต้องสั่งเปลี่ยนไปจุดยิงสำรอง ไม่ใช่ดันสู้',
  start: 120,
  setup(api) { api.ai('B1', { mode: 'defend', target: 'R1' }); api.ai('R2', { mode: 'idle' }); api.scatter(10, RED_HALF); },
  obj: [
    { t: 'TIP อย่างน้อย 3 ครั้ง', ok: (S, api) => api.tips('red') >= 3 },
    { t: 'ยิงจากจุดยิงอย่างน้อย 2 จุดที่ต่างกัน', ok: S => S.robots[0].shotSpots.length >= 2 },
    { t: 'ไม่โดน PIN FOUL (G421)', ok: (S, api) => api.foulCount('red', 'G421') === 0, live: true },
  ],
},
'5.5': {
  title: 'Driver Station หลุด',
  brief: 'ระหว่างแมตช์ หุ่นเราจะหลุดการเชื่อมต่อ 2 ครั้ง หุ่นจะหยุดนิ่ง แผง Driver Station จะขึ้นมา โค้ชต้องคลิกตามลำดับ ■ Stop → เลือก OpMode → INIT → ▶ Start ภายใน 15 วิ โค้ชทำขั้นตอนนี้ได้ตามกฎ G423 แต่ห้ามจับจอย',
  start: 120,
  setup(api) { api.S.sc.dc = [100, 55]; },
  tick(api) { const sc = api.S.sc, rem = api.remaining(); if (sc.dc.length && rem <= sc.dc[0]) { sc.dc.shift(); api.disconnect(); } },
  obj: [
    { t: 'รีสตาร์ทครั้งที่ 1 ภายใน 15 วิ', ok: S => S.dsLog[0] && S.dsLog[0].dur <= 15 },
    { t: 'รีสตาร์ทครั้งที่ 2 ภายใน 15 วิ', ok: S => S.dsLog[1] && S.dsLog[1].dur <= 15 },
    { t: 'กดปุ่มตามลำดับถูกทุกครั้ง', ok: S => S.dsLog.length >= 2 && S.dsLog.every(d => d.wrong === 0) },
  ],
},
'5.6': {
  title: 'HIVE กำลังพลิก',
  brief: 'ในสถานการณ์นี้ หุ่นยิงได้แม้ HIVE กำลังพลิก แต่ถ้าลูกเข้า CELL ระหว่างพลิก อาจทำให้ TIP ไม่สำเร็จ CELL ขาดอีก 1 ลูก โค้ชต้องเรียก "หยุดยิง… รอนิ่ง… สลับ" ทุกครั้ง',
  start: 120, opt: { disrupt: true, bots: false },
  setup(api) {
    ['B1', 'B2'].forEach(api.bench); api.ai('R2', { mode: 'idle' });
    api.cell('red', 7, 0); api.pos('R1', RED_SPOT[0], RED_SPOT[1]); api.faceCell('R1');
    api.carry('R1', ['pollen', 'pollen', 'pollen', 'pollen']); api.scatter(18, RED_HALF);
  },
  end: api => api.tips('red') >= 3,
  obj: [
    { t: 'TIP สำเร็จ 3 ครั้ง', ok: (S, api) => api.tips('red') >= 3 },
    { t: 'ไม่มี TIP ที่ถูกขัดจนไม่สำเร็จ', ok: S => S.stats.disrupted.red === 0, live: true },
  ],
},
'6.1': {
  title: '25 วินาทีสุดท้าย',
  brief: 'เหลือ 0:25 แดงตามหลัง 3 แต้ม (นับรวมคะแนนที่จะได้ตอนจบแล้ว ดูบรรทัด "ถ้าจบตอนนี้") หุ่นถือ POLLEN 4 ลูก CELL มี POLLEN 6 ลูก ขาดอีก 2 ลูกจะ TIP พันธมิตร PARK แล้ว B1 จะใส่ NECTAR ลง FLOWER ฝั่งน้ำเงินเมื่อเหลือ 0:12 ซึ่งได้ประมาณ 13 แต้ม ระวัง: TIP ทำให้ลูกที่ค้างใน CELL ร่วงออก เสียแต้มลูกค้าง 2 แต้มต่อลูก คิดให้ดีว่าทางไหนชนะ',
  start: 25, opt: { bots: false },
  setup(api) {
    api.parkNow('R2'); api.parkNow('B2');
    api.cell('red', 6, 0); api.pos('R1', -1.45, 0.0, -Math.PI / 2); api.carry('R1', ['pollen', 'pollen', 'pollen', 'pollen']);
    api.pos('B1', BLUE_FLOWER_FRONT[0], BLUE_FLOWER_FRONT[1], -Math.PI / 2); api.carry('B1', ['nectar:blue']);
    api.ai('B1', { mode: 'script', tasks: [{ waitUntil: 12 }, { place: 'nectar' }] });
    api.setLead('blue', 3);
  },
  obj: [
    { t: 'ชนะแมตช์', ok: S => S.end && S.end.score.red > S.end.score.blue },
    { t: 'R1 PARK ทันตอนจบ', ok: S => !!S.end?.park?.R1 },
  ],
},
'6.2': {
  title: 'สงคราม FLOWER',
  brief: 'เหลือ 0:40 ใน FLOWER บนกำแพงแดงมี POLLEN 3 ลูก, NECTAR แดง และ NECTAR น้ำเงินทับบนสุด หุ่นเราถือ NECTAR แดง 1 ลูก และมีอีก 1 ลูกใน LOADING ZONE B1 จะมาใส่ NECTAR น้ำเงินทับอีกเมื่อเหลือ 0:20 FLOWER รับเพิ่มได้อีกแค่ 2 ลูก และดึง POLLEN ออกทางล่างเพื่อเปิดที่ว่างได้ ระวัง NECTAR น้ำเงินที่ตกอยู่บนพื้น (G408)',
  start: 40, opt: { bots: false },
  setup(api) {
    api.flower(2, ['pollen', 'pollen', 'pollen', 'nectar:red', 'nectar:blue']); api.staged('red', 0); api.staged('blue', 0);
    api.pos('R1', RED_FLOWER_FRONT[0] + 0.25, RED_FLOWER_FRONT[1] - 0.35, Math.PI / 2); api.carry('R1', ['nectar:red']);
    api.floor('nectar', 'red', -1.64, -0.9); api.floor('nectar', 'blue', -1.05, 1.0);
    api.parkNow('R2'); api.parkNow('B2');
    api.pos('B1', -0.95, 0.55, Math.PI / 2); api.carry('B1', ['nectar:blue']);
    api.ai('B1', { mode: 'script', tasks: [{ waitUntil: 20 }, { goto: RED_FLOWER_FRONT, face: Math.PI / 2, timeout: 7 }, { place: 'nectar' }, { goto: 'park' }] });
  },
  obj: [
    { t: 'แดงเป็นเจ้าของ FLOWER ต้นนี้ตอนจบ', ok: S => S.end?.owners?.[2] === 'red' },
    { t: 'แดงได้ Bottom Bonus ของ FLOWER ต้นนี้', ok: S => S.end?.bottoms?.[2] === 'red' },
    { t: 'ไม่ควบคุม NECTAR คู่แข่ง (G408)', ok: S => S.stats.g408.red === 0, live: true },
    { t: 'R1 PARK ทันตอนจบ', ok: S => !!S.end?.park?.R1 },
  ],
},
'6.5': {
  title: 'สอบปลายภาค: แมตช์เต็ม',
  brief: 'แมตช์เต็ม 2:30 ประกอบด้วย AUTO 30 วิตามแผนที่เลือก ช่วงเปลี่ยน 8 วิที่ห้ามขยับหุ่น และ TELEOP 2:00 กับหุ่น AI อีก 3 ตัว Human Player ฝั่งแดงต้องสั่งเอง กด H เมื่อปล่อย NECTAR ซึ่งได้ 1 ลูกต่อ TIP หรือทั้งหมดเมื่อเหลือ 1:00 และกด B ทุกครั้งที่ประกาศเวลา',
  phase: 'full', opt: { disrupt: true, hpManual: true, hideClock: true }, plans: autoPlans, coach: ['call', 'hp'],
  setup() {},
  obj: [
    { t: 'TIP อย่างน้อย 4 ครั้ง (POLLINATOR 1)', ok: (S, api) => api.tips('red') >= 4 },
    { t: 'ไม่มี FOUL G410 / G426 / G427 / G421 / G403', ok: (S, api) => ['G410', 'G426', 'G427', 'G421', 'G403'].every(g => api.foulCount('red', g) === 0), live: true },
    { t: 'SWARM: LEAVE + PARK ≥ 16 แต้ม', ok: S => S.end && S.stats.leavePark.red >= 16 },
    { t: 'ประกาศเวลาครบ 6 จุด คลาดไม่เกิน 2 วิ', ok: (S, api) => api.callsHit(TIME_CALLS, 2) === 6 },
  ],
},
// ---------------- Driver ----------------
'D1.2': {
  role: 'driver', title: 'ขับผ่านจุดรอบสนาม',
  brief: 'ขับหุ่นผ่านวงแหวนสีเหลืองทีละจุด ครบ 8 จุดรอบสนาม ใช้ field-centric คือดันแกนซ้ายขึ้นแล้วหุ่นวิ่งออกจากฝั่งแดงเสมอ ไม่ว่าหุ่นจะหันไปทางไหน ห้ามชนกำแพงแรง และห้ามชนโครง HIVE',
  start: 60, opt: { bots: false, gate: false, noClockRules: true },
  setup(api) { api.resetBalls(); BENCH_ALL(api); api.S.sc.marks = COURSE.map((p, i) => ({ x: p[0], z: p[1], r: 0.22, label: String(i + 1) })); },
  tick: (api, dt) => markStep(api, dt, false),
  status: api => `ผ่านแล้ว ${api.S.sc.marks.filter(m => m.done).length}/8 · ชนกำแพงแรง ${api.S.stats.wallHits} ครั้ง`,
  end: api => api.S.sc.marks.every(m => m.done),
  obj: [
    { t: 'ผ่านครบ 8 จุดภายใน 60 วิ', ok: S => S.sc.marks.every(m => m.done) },
    { t: 'ชนกำแพงแรงไม่เกิน 3 ครั้ง', ok: S => S.stats.wallHits <= 3, live: true },
    { t: 'ไม่ชนโครง HIVE แรง (G417)', ok: (S, api) => api.foulCount('red', 'G417') === 0, live: true },
  ],
},
'D1.3': {
  role: 'driver', title: 'หยุดให้ตรงจุด',
  brief: 'ขับไปหยุดในวงแหวนเล็กทีละจุด และหยุดนิ่งให้ได้ 1 วินาทีเต็ม จุดสุดท้ายอยู่ใน LOADING ZONE ฝึกการผ่อนแกนจอยก่อนถึงเป้า กด □ ค้าง หรือ Shift เพื่อขับโหมดช้า',
  start: 60, opt: { bots: false, gate: false, noClockRules: true },
  setup(api) { api.resetBalls(); BENCH_ALL(api); api.S.sc.marks = [[-0.95, -0.9], [-1.25, 0.95], [-0.95, 0.25], [-1.56, -0.9]].map((p, i) => ({ x: p[0], z: p[1], r: 0.1, label: String(i + 1) })); api.pos('R1', -1.45, -0.2, -Math.PI / 2); },
  tick: (api, dt) => markStep(api, dt, true),
  status: api => `หยุดตรงจุดแล้ว ${api.S.sc.marks.filter(m => m.done).length}/4 · ค้างไว้ ${(api.S.sc.hold || 0).toFixed(1)} / 1.0 วิ`,
  end: api => api.S.sc.marks.every(m => m.done),
  obj: [
    { t: 'หยุดนิ่งตรงจุดครบ 4 จุดภายใน 60 วิ', ok: S => S.sc.marks.every(m => m.done) },
    { t: 'ชนกำแพงแรงไม่เกิน 2 ครั้ง', ok: S => S.stats.wallHits <= 2, live: true },
  ],
},
'D1.4': {
  role: 'driver', title: 'เก็บลูกให้ไว',
  brief: 'มี POLLEN 14 ลูกกระจายอยู่ฝั่งแดง เก็บให้ได้ 12 ลูกใน 60 วิ ลูกที่เก็บจะถูกนับแล้วหายไปจากหุ่น ระวัง NECTAR สีน้ำเงิน 3 ลูกที่ปนอยู่ ห้ามเก็บ (G408) ถ้าเผลอเก็บต้องกด ○ คายออก',
  start: 60, opt: { bots: false, gate: false, noClockRules: true },
  setup(api) { api.resetBalls(); BENCH_ALL(api); api.carry('R1', []); api.scatter(14, RED_HALF); api.randomPoints(3, RED_HALF, 0.4).forEach(p => api.floor('nectar', 'blue', p[0], p[1])); api.S.sc.n = 0; },
  onPickup(api, r, bi) { if (api.S.balls[bi].kind === 'pollen') { api.S.sc.n++; api.vanish(bi); } },
  status: api => `เก็บแล้ว ${api.S.sc.n}/12`,
  end: api => api.S.sc.n >= 12,
  obj: [
    { t: 'เก็บ POLLEN 12 ลูกภายใน 60 วิ', ok: S => S.sc.n >= 12 },
    { t: 'ไม่เก็บ NECTAR คู่แข่ง (G408)', ok: S => S.stats.g408.red === 0, live: true },
  ],
},
'D1.5': {
  role: 'driver', title: 'ยิงตามกฎ: หยุดก่อนยิง',
  brief: 'ยิงได้เฉพาะเมื่ออยู่ในวงแหวนจุดยิง (ห่าง CELL ที่หงาย 0.9–1.6 ม.) หันตรง CELL ไม่เกิน 10° และหยุดนิ่งสนิท ถ้ากดยิงตอนยังไม่พร้อมจะนับเป็นความผิดพลาด ยิงเข้า 8 ลูก จากอย่างน้อย 2 จุด',
  start: 120, opt: { bots: false },
  setup(api) { ['B1', 'B2'].forEach(api.bench); api.ai('R2', { mode: 'idle' }); api.parkNow('R2'); api.scatter(16, RED_HALF); },
  status: api => `ยิงเข้า ${api.S.stats.hits}/8 · กดยิงตอนไม่พร้อม ${api.S.stats.blocked} ครั้ง`,
  end: api => api.S.stats.hits >= 8,
  obj: [
    { t: 'ยิงเข้า CELL 8 ลูก', ok: S => S.stats.hits >= 8 },
    { t: 'กดยิงตอนยังไม่พร้อมไม่เกิน 3 ครั้ง', ok: S => S.stats.blocked <= 3, live: true },
    { t: 'ยิงจากจุดยิงอย่างน้อย 2 จุด', ok: S => S.robots[0].shotSpots.length >= 2 },
  ],
},
'D2.3': {
  role: 'driver', title: 'วางลูกใน FLOWER และดึงลูกจากก้น',
  brief: 'ชิด FLOWER หันหน้าเข้าหา แล้วกด L2 เพื่อวาง POLLEN ทางปากบน ทำให้ได้ 2 ต้นต่างกัน จากนั้นดึง POLLEN ออกทางก้น FLOWER โดยขับดันหน้าหุ่นเข้าหาฐาน FLOWER พร้อมเปิด intake (G418 ใส่ทางบน ดึงออกทางล่างเท่านั้น)',
  start: 90, opt: { bots: false, noClockRules: true },
  setup(api) { BENCH_ALL(api); api.carry('R1', ['pollen', 'pollen']); api.pos('R1', -1.2, 0.2, Math.PI / 2); },
  status: api => { const S = api.S; return `วางแล้ว ${new Set(S.stats.placed.filter(p => p.id === 'R1' && p.kind === 'pollen').map(p => p.fi)).size}/2 ต้น · ดึงจากก้น ${S.stats.flowerPulls}/1`; },
  end: api => { const S = api.S; return new Set(S.stats.placed.filter(p => p.id === 'R1' && p.kind === 'pollen').map(p => p.fi)).size >= 2 && S.stats.flowerPulls >= 1; },
  obj: [
    { t: 'วาง POLLEN ใน FLOWER 2 ต้นที่ต่างกัน', ok: S => new Set(S.stats.placed.filter(p => p.id === 'R1' && p.kind === 'pollen').map(p => p.fi)).size >= 2 },
    { t: 'ดึง POLLEN ออกทางก้น FLOWER อย่างน้อย 1 ลูก', ok: S => S.stats.flowerPulls >= 1 },
  ],
},
'D2.5': {
  role: 'driver', title: 'จาก AUTO เข้า TELEOP',
  brief: 'เริ่มตอน AUTO เหลือ 8 วิ หุ่นวิ่งเองตามโปรแกรม ห้ามแตะจอยจนถึง TELEOP (ช่วงเปลี่ยน 8 วิ G403) พอ TELEOP เริ่ม ให้รีบเก็บลูกแล้วยิงลูกแรกภายใน 15 วิ',
  startEl: 22, phase: 'auto', opt: {},
  setup(api) {},
  end: api => api.S.el >= 78,
  obj: [
    { t: 'ไม่ขยับจอยช่วงเปลี่ยน (G403)', ok: (S, api) => api.foulCount('red', 'G403') === 0, live: true },
    { t: 'ยิงลูกแรกใน TELEOP ภายใน 15 วิ', ok: S => S.events.some(e => e.type === 'shot' && e.el >= 38 && e.el <= 53) },
    { t: 'TIP อย่างน้อย 1 ครั้งใน TELEOP 40 วิแรก', ok: (S, api) => api.tipEvents('red').some(e => e.el >= 38) },
  ],
},
'D3.1': {
  role: 'driver', title: 'กติกาขณะขับ: G408 · G417',
  brief: 'ยิงเข้า CELL ให้ได้ 8 ลูก โดยมี NECTAR สีน้ำเงินปนอยู่กับ POLLEN บนพื้น ห้ามเก็บ (G408) และห้ามชนโครง HIVE ด้วยความเร็วสูง (G417) ถ้าเผลอเก็บ NECTAR น้ำเงิน ให้คายออกทันที',
  start: 120, opt: { bots: false },
  setup(api) { ['B1', 'B2'].forEach(api.bench); api.parkNow('R2'); api.carry('R1', []); api.scatter(14, { xMin: -1.55, xMax: -0.7, zMin: -1.5, zMax: 1.5 }); api.randomPoints(4, { xMin: -1.4, xMax: -0.75, zMin: -1.2, zMax: 1.2 }, 0.4).forEach(p => api.floor('nectar', 'blue', p[0], p[1])); },
  status: api => `ยิงเข้า ${api.S.stats.hits}/8`,
  end: api => api.S.stats.hits >= 8,
  obj: [
    { t: 'ยิงเข้า CELL 8 ลูก', ok: S => S.stats.hits >= 8 },
    { t: 'ไม่ควบคุม NECTAR คู่แข่ง (G408)', ok: S => S.stats.g408.red === 0, live: true },
    { t: 'ไม่ชนโครง HIVE แรง (G417)', ok: (S, api) => api.foulCount('red', 'G417') === 0, live: true },
  ],
},
'D5.1': {
  role: 'driver', title: 'สอบ Driver: แมตช์เต็ม',
  brief: 'แมตช์เต็ม 2:30: AUTO ตามแผนที่เลือก ช่วงเปลี่ยน 8 วิห้ามขยับ แล้ว TELEOP 2:00 กับหุ่น AI อีก 3 ตัว Human Player ปล่อย NECTAR อัตโนมัติ คนขับต้องทำแต้ม ไม่โดน FOUL และ PARK ให้ทัน',
  phase: 'full', opt: { disrupt: true }, plans: autoPlans,
  setup() {},
  obj: [
    { t: 'TIP อย่างน้อย 4 ครั้ง (POLLINATOR 1)', ok: (S, api) => api.tips('red') >= 4 },
    { t: 'R1 ไม่โดน FOUL หรือคำเตือนเลย', ok: S => !S.fouls.some(f => f.by === 'R1'), live: true },
    { t: 'SWARM: LEAVE + PARK ≥ 16 แต้ม', ok: S => S.end && S.stats.leavePark.red >= 16 },
    { t: 'เลือด R1 เหลืออย่างน้อย 80%', ok: S => S.robots[0].hp >= 80, live: true },
  ],
},
// ---------------- Human Player ----------------
'H2.1': {
  role: 'hp', title: 'ปล่อย NECTAR ตามจังหวะ TIP',
  brief: 'คุณคือ Human Player ฝั่งแดง หุ่นทั้งสองตัวขับโดย AI ทุกครั้งที่ HIVE แดง TIP คุณได้สิทธิ์ปล่อย NECTAR 1 ลูก (G426) กด H หรือปุ่ม "ปล่อย NECTAR" ภายใน 5 วิหลัง TIP ห้ามปล่อยก่อนได้สิทธิ์ และห้ามปล่อยตอนหุ่นอยู่ตรงจุดวางลูกใน LOADING ZONE (G427) สถานการณ์จบเมื่อเหลือ 1:02',
  start: 120, opt: { hpManual: true, lockCam: 2 }, coach: ['hp'],
  setup(api) { hpCommon(api); api.cell('red', 2, 3); api.S.sc.lastTip = api.S.el; },
  onTip(api, c) { if (c === 'red') api.S.sc.lastTip = api.S.el; },
  tick(api) { const S = api.S; if (S.el - S.sc.lastTip > 22 && !S.hives.red.tipping && api.remaining() > 66) { api.forceTip('red'); S.sc.lastTip = S.el; } },
  status: hpStatus,
  end: api => api.remaining() <= 62,
  obj: [
    { t: 'มี TIP อย่างน้อย 2 ครั้ง และปล่อย NECTAR ภายใน 5 วิหลัง TIP ทุกครั้ง', ok: (S, api) => { const r = hpTiming(api); return r.tips >= 2 && r.ok === r.tips; } },
    { t: 'ไม่ปล่อยก่อนได้สิทธิ์ (G426)', ok: (S, api) => api.foulCount('red', 'G426') === 0, live: true },
    { t: 'ไม่ปล่อยใส่หุ่นใน LOADING ZONE (G427)', ok: (S, api) => api.foulCount('red', 'G427') === 0, live: true },
  ],
},
'H2.2': {
  role: 'hp', title: 'ช่วง 1:00: ปล่อยที่เหลือทั้งหมด',
  brief: 'เริ่มตอนเหลือ 1:15 คุณยังถือ NECTAR 4 ลูกและไม่มีสิทธิ์ค้าง เมื่อนาฬิกาถึง 1:00 ปล่อยได้ทั้งหมด ต้องปล่อยครบ 4 ลูกภายใน 5 วิหลัง 1:00 ห้ามปล่อยก่อนเวลา และดูให้ LOADING ZONE ว่างก่อนปล่อยทุกลูก',
  start: 75, opt: { hpManual: true, lockCam: 2 }, coach: ['hp'],
  setup(api) { hpCommon(api); api.staged('red', 4); api.cell('red', 0, 3); },
  tick(api) { const S = api.S; if (S.sc.left55 == null && api.remaining() <= 55) S.sc.left55 = api.stagedLeft('red'); },
  status: hpStatus,
  end: api => api.remaining() <= 50,
  obj: [
    { t: 'ปล่อยครบ 4 ลูกภายใน 5 วิหลังเหลือ 1:00', ok: S => S.sc.left55 === 0 },
    { t: 'ไม่ปล่อยก่อนเวลา (G426)', ok: (S, api) => api.foulCount('red', 'G426') === 0, live: true },
    { t: 'ไม่ปล่อยใส่หุ่นใน LOADING ZONE (G427)', ok: (S, api) => api.foulCount('red', 'G427') === 0, live: true },
  ],
},
'H3.1': {
  role: 'hp', title: 'LOADING ZONE มีหุ่นเข้าออก',
  brief: 'หุ่น R1 วิ่งเข้าออก LOADING ZONE ตลอด HIVE แดงจะ TIP ทุกประมาณ 12 วิ คุณต้องดูจังหวะให้ LOADING ZONE ว่าง แล้วจึงปล่อย NECTAR ให้แตะพื้นก่อนแตะหุ่น (G427) ปล่อยให้ครบ 4 ลูกก่อนเหลือ 1:02',
  start: 120, opt: { hpManual: true, lockCam: 2 }, coach: ['hp'],
  setup(api) { api.ai('R1', { mode: 'traffic' }); api.ai('R2', { mode: 'offense' }); api.S.sc.nextTip = api.S.el + 8; },
  tick(api) { const S = api.S; if (S.el >= S.sc.nextTip && api.remaining() > 66) { api.forceTip('red'); S.sc.nextTip = S.el + 12; } },
  status: hpStatus,
  end: api => api.remaining() <= 62,
  obj: [
    { t: 'ปล่อย NECTAR ครบ 4 ลูก', ok: (S, api) => api.releases('red').length >= 4 },
    { t: 'ไม่ปล่อยใส่หุ่นใน LOADING ZONE (G427)', ok: (S, api) => api.foulCount('red', 'G427') === 0, live: true },
    { t: 'ไม่ปล่อยก่อนได้สิทธิ์ (G426)', ok: (S, api) => api.foulCount('red', 'G426') === 0, live: true },
  ],
},
'H4.1': {
  role: 'hp', title: 'สอบ Human Player: แมตช์เต็ม',
  brief: 'แมตช์เต็ม 2:30 หุ่นทุกตัวขับโดย AI คุณเป็น Human Player ฝั่งแดงคนเดียว ปล่อย NECTAR ภายใน 5 วิหลังทุก TIP ปล่อยที่เหลือทั้งหมดทันทีเมื่อเหลือ 1:00 และห้ามโดน FOUL จาก Human Player',
  phase: 'full', opt: { hpManual: true, lockCam: 2 }, coach: ['hp'],
  setup(api) { hpCommon(api); },
  tick(api) { const S = api.S; if (S.sc.left55 == null && S.el > 38 && api.remaining() <= 55) S.sc.left55 = api.stagedLeft('red'); },
  status: hpStatus,
  obj: [
    { t: 'ปล่อย NECTAR ภายใน 5 วิหลัง TIP ทุกครั้ง (ก่อน 1:00)', ok: (S, api) => { const r = hpTiming(api); return r.ok === r.tips; } },
    { t: 'ปล่อยที่เหลือทั้งหมดภายใน 5 วิหลังเหลือ 1:00', ok: S => S.sc.left55 === 0 },
    { t: 'ไม่โดน G426 / G427', ok: (S, api) => api.foulCount('red', 'G426') + api.foulCount('red', 'G427') === 0, live: true },
  ],
},
};
})();
