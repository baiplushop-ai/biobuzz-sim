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
// ปุ่ม "สั่งทีม" ของโค้ช (V): นับว่าสั่งทันก่อนหุ่น a กับ b ชนกันกี่ครั้ง (สั่งก่อนชนไม่เกิน win วิ)
function warnCalls(S, a, b, win = 4) {
  const hits = S.events.filter(e => e.type === 'hit' && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
  return { hits: hits.length, ok: hits.filter(h => S.cmds.some(c => c.rem >= h.rem && c.rem <= h.rem + win)).length, n: S.cmds.length };
}
const LZ_RED = [-1.647, -0.895];  // กลาง LOADING ZONE แดง
const nearLZ = (api, id) => { const r = api.robot(id); return !r.off && !api.overlapLZ(id, 'red') && Math.hypot(r.x - LZ_RED[0], r.z - LZ_RED[1]) <= 1.3; };

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
    { t: 'หุ่นอยู่ในสนามทั้งตัว และจอดนิ่งตอนยืนยัน', ok: S => !!S.sc.check?.inField && !!S.sc.check?.still },
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
'3.6': {
  title: 'AUTO ไม่รบกวนฝั่งคู่แข่ง (G402)',
  brief: 'เลือกแผน AUTO ให้ R1 และ R2 แล้วดูผล 30 วิ ช่วง AUTO ห้ามรบกวนฝั่งคู่แข่ง เช่น ควบคุมลูกในฝั่งเขา หรือชนหุ่นเขาในฝั่งเขา (G402 = MAJOR FOUL · ถ้ากรรมการเห็นว่าจงใจ + YELLOW CARD) และ Drive Team ห้ามแตะจอยระหว่าง AUTO (G401) แนวของทีม: ทั้งสองหุ่นอยู่ในฝั่งแดงตลอด AUTO แล้วทำแต้มจาก LEAVE กับ TIP แผนแรกในรายการไม่ใช่แผนที่ถูกเสมอไป',
  phase: 'auto', opt: { disrupt: true },
  plans: {
    R1: [
      { label: 'ยิง pre-load แล้วข้ามไปเก็บลูกฝั่งน้ำเงิน', tasks: [{ goto: 'spot' }, { shoot: 4 }, { goto: [-1.2, 0.8], timeout: 6 }, { goto: [1.2, 0.95], timeout: 14 }] },
      { label: 'ยิง pre-load แล้วเก็บลูกในฝั่งแดง', tasks: [{ goto: 'spot' }, { shoot: 4 }, { goto: [-0.9, -0.6] }] },
      { label: 'ไม่ยิง: วิ่งไปขวางจุดยิงของคู่แข่ง', tasks: [{ goto: [1.3, -1.0], timeout: 14 }] },
    ],
    R2: [
      { label: 'ยิงทันที แล้ววิ่งข้ามเส้นกลางไปรอลูก', tasks: [{ goto: 'spot' }, { shoot: 4, ignoreTip: true }, { goto: [0.6, 0.9], timeout: 12 }] },
      { label: 'รอ HIVE นิ่งแล้วยิง จบที่ LOADING ZONE แบบไม่แตะกำแพง', tasks: [{ wait: 1 }, { goto: 'spot' }, { shoot: 4 }, { goto: 'lzAuto' }] },
    ],
  },
  setup() {},
  tick(api) { const S = api.S; if (S.el < 30 && ['R1', 'R2'].some(id => api.robot(id).x > -0.22)) S.sc.crossed = true; },
  end: api => api.S.el >= 30,
  obj: [
    { t: 'R1 และ R2 อยู่ในฝั่งแดงตลอด AUTO (แนวของทีม: ไม่ล้ำเส้นกลาง)', ok: S => !S.sc.crossed, live: true },
    { t: 'ไม่โดน G402 (ชนหุ่นคู่แข่งในฝั่งเขาช่วง AUTO)', ok: (S, api) => api.foulCount('red', 'G402') === 0, live: true },
    { t: 'LEAVE ครบทั้งสองหุ่นแดง', ok: S => S.stats.leave.red >= 2 },
    { t: 'AUTO TIP อย่างน้อย 1 ครั้ง', ok: S => S.stats.autoTips.red >= 1 },
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
  brief: 'CELL หงายขาดอีก 1 ลูกจะ TIP หุ่นถือ POLLEN 4 ลูกอยู่ที่จุดยิงแล้ว หลังพลิก CELL ที่หงายใหม่อยู่อีกฝั่งของ HIVE โค้ชต้องสั่ง "สลับ" ทันที และห้ามจอดรอใต้ HIVE เพื่อรับลูกที่ร่วงลงมา (G409) เมื่อ HIVE พลิกเสร็จ ให้โค้ชกด V หรือปุ่ม "สั่งสลับ" ทันที',
  start: 40, opt: { bots: false }, coach: ['cmd'], cmdLabel: '📣 สั่ง "สลับ"', cmdSay: 'สลับ!',
  setup(api) {
    ['B1', 'B2'].forEach(api.bench); api.ai('R2', { mode: 'idle' });
    api.cell('red', 2, 3); api.pos('R1', RED_SPOT[0], RED_SPOT[1]); api.faceCell('R1');
    api.carry('R1', ['pollen', 'pollen', 'pollen', 'pollen']);
  },
  obj: [
    { t: 'ทำ TIP แรกได้', ok: (S, api) => api.tips('red') >= 1 },
    { t: 'ยิงเข้า CELL ใหม่อย่างน้อย 3 ลูก ภายใน 15 วิหลัง TIP', ok: S => (S.sc.afterTip ?? 0) >= 3 },
    { t: 'ไม่รับลูกที่ร่วงจาก HIVE (G409)', ok: S => S.stats.g409.red === 0, live: true },
    { t: 'โค้ชสั่ง "สลับ" ภายใน 3 วิหลัง TIP (กดก่อน TIP ไม่เกิน 1 ครั้ง)', ok: S => S.sc.tipEl != null && S.cmds.some(c => c.el >= S.sc.tipEl && c.el <= S.sc.tipEl + 3) && S.cmds.filter(c => c.el < S.sc.tipEl).length <= 1 },
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
  brief: 'หุ่น B1 ของคู่แข่งจะพุ่งเข้าชนหุ่นเราเป็นระยะ หุ่นชนกัน 1 ครั้งเลือดลด 2% (กฎฝึกของทีม ไม่ใช่กติกา) ถ้าหุ่นเราดันคู่แข่งติดกำแพงหรือสิ่งกีดขวางเกิน 3 วิ จะโดน PIN FOUL (G421) โค้ชต้องเรียก "ระวัง" ก่อนชน และสั่ง "ถอย" ถ้าเริ่มติดกัน ทุกครั้งที่เห็น B1 พุ่งเข้ามา ให้กด V หรือปุ่ม "สั่งระวัง" ก่อนหุ่นชนกัน',
  start: 120, coach: ['cmd'], cmdLabel: '📣 สั่ง "ระวัง"', cmdSay: 'ระวัง!',
  setup(api) { api.ai('B1', { mode: 'bump', target: 'R1' }); },
  status: api => { const w = warnCalls(api.S, 'R1', 'B1'); return `B1 ชน ${w.hits} ครั้ง · สั่ง "ระวัง" ทัน ${w.ok} ครั้ง · กดสั่งไป ${w.n} ครั้ง`; },
  obj: [
    { t: 'เลือด R1 เหลืออย่างน้อย 90%', ok: S => S.robots[0].hp >= 90, live: true },
    { t: 'โค้ชสั่ง "ระวัง" ก่อนชนไม่เกิน 4 วิ อย่างน้อยครึ่งหนึ่งของการชน และไม่กดมั่ว', ok: S => { const w = warnCalls(S, 'R1', 'B1'); return w.hits ? w.ok * 2 >= w.hits && w.n <= Math.max(6, w.hits * 3) : w.n <= 3; } },
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
  brief: 'ในสถานการณ์นี้ หุ่นยิงได้แม้ HIVE กำลังพลิก แต่ถ้าลูกเข้า CELL ระหว่างพลิก อาจทำให้ TIP ไม่สำเร็จ CELL ขาดอีก 1 ลูก โค้ชต้องเรียก "หยุดยิง… รอนิ่ง… สลับ" ทุกครั้ง และกด V หรือปุ่ม "สั่งหยุดยิง" ตอนลูกที่ทำให้ TIP เข้า CELL (HIVE เริ่มพลิก)',
  start: 120, opt: { disrupt: true, bots: false }, coach: ['cmd'], cmdLabel: '📣 สั่ง "หยุดยิง"', cmdSay: 'หยุดยิง!',
  setup(api) {
    ['B1', 'B2'].forEach(api.bench); api.ai('R2', { mode: 'idle' });
    api.cell('red', 7, 0); api.pos('R1', RED_SPOT[0], RED_SPOT[1]); api.faceCell('R1');
    api.carry('R1', ['pollen', 'pollen', 'pollen', 'pollen']); api.scatter(18, RED_HALF);
  },
  end: api => api.tips('red') >= 3,
  obj: [
    { t: 'TIP สำเร็จ 3 ครั้ง', ok: (S, api) => api.tips('red') >= 3 },
    { t: 'โค้ชสั่ง "หยุดยิง" ตอน HIVE เริ่มพลิก อย่างน้อย 2 ครั้ง (กดรวมไม่เกิน 9 ครั้ง)', ok: (S, api) => api.tipEvents('red').filter(e => S.cmds.some(c => c.el >= e.el - 2.5 && c.el <= e.el + 0.5)).length >= 2 && S.cmds.length <= 9 },
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
  role: 'driver', title: 'หยุดก่อนยิง (ไม่มีล็อกยิง)',
  brief: 'กดยิงได้ทุกที่ ไม่มีการล็อก ลูกจะเข้าหรือไม่เข้าตามวิถีจริง ฝึกตามกฎฝึกของทีม (กติกา FTC ไม่ได้บังคับ): อยู่ในวงแหวนจุดยิง (ห่าง CELL ที่หงาย 0.9–1.6 ม.) หันตรง CELL ไม่เกิน 10° และหยุดนิ่งสนิทก่อนกด ถ้ากดยิงตอนยังไม่พร้อมจะนับเป็นความผิดพลาด ยิงเข้า 8 ลูก จากอย่างน้อย 2 จุด',
  start: 120, opt: { bots: false },
  setup(api) { ['B1', 'B2'].forEach(api.bench); api.ai('R2', { mode: 'idle' }); api.parkNow('R2'); api.scatter(16, RED_HALF); },
  status: api => `ยิงเข้า ${api.S.stats.hits}/8 · กดยิงตอนไม่พร้อม ${api.S.stats.blocked + (api.S.stats.warnShots || 0)} ครั้ง`,
  end: api => api.S.stats.hits >= 8,
  obj: [
    { t: 'ยิงเข้า CELL 8 ลูก', ok: S => S.stats.hits >= 8 },
    { t: 'กดยิงตอนยังไม่พร้อมไม่เกิน 3 ครั้ง', ok: S => S.stats.blocked + (S.stats.warnShots || 0) <= 3, live: true },
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
  brief: 'เริ่มตอน AUTO เหลือ 8 วิ หุ่นวิ่งเองตามโปรแกรม ระหว่าง AUTO ห้ามแตะจอย (G401) และช่วงเปลี่ยน 8 วิ หุ่นต้องไม่ขยับ (G403: เตือน · ทำซ้ำหรือจงใจ = MAJOR + YELLOW CARD) พอ TELEOP เริ่ม ให้รีบเก็บลูกแล้วยิงลูกแรกภายใน 15 วิ',
  startEl: 22, phase: 'auto', opt: {},
  setup(api) {},
  end: api => api.S.el >= 78,
  obj: [
    { t: 'หุ่นไม่ขยับช่วงเปลี่ยน 8 วิ (G403)', ok: (S, api) => api.foulCount('red', 'G403') === 0, live: true },
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
'D3.2': {
  role: 'driver', title: 'PARK และหยุดนิ่งตอน 0:00 (G404)',
  brief: 'เหลือ 20 วิสุดท้าย หุ่นถือ POLLEN 2 ลูกอยู่กลางฝั่งแดง ตัดสินใจเองว่าจะยิงก่อนหรือกลับเลย แล้วพาหุ่นเข้า LOADING ZONE ฝั่งแดงเพื่อ PARK ให้ทัน เมื่อนาฬิกาถึง 0:00 หุ่นต้องหยุดนิ่งและห้ามโยกจอยต่อ (G404: เตือน · ถ้ากรรมการเห็นว่าจงใจ = MAJOR + YELLOW CARD) หลังหมดเวลา simulator จะรอให้หุ่นและลูกหยุดก่อนนับแต้ม',
  start: 20, opt: { bots: false },
  setup(api) { ['B1', 'B2'].forEach(api.bench); api.parkNow('R2'); api.pos('R1', -0.8, 0.95, -Math.PI / 2); api.carry('R1', ['pollen', 'pollen']); },
  status: api => { const r = api.robot('R1'); return `ความเร็ว R1 ${Math.hypot(r.vx, r.vz).toFixed(1)} ม./วิ · ${api.overlapLZ('R1', 'red') ? 'อยู่ใน LOADING ZONE แล้ว' : 'ยังไม่ถึง LOADING ZONE'}`; },
  obj: [
    { t: 'R1 PARK ใน LOADING ZONE ตอนจบแมตช์', ok: S => !!S.end?.park?.R1 },
    { t: 'หุ่นหยุดนิ่งตอน 0:00 (ความเร็วไม่เกิน 0.1 ม./วิ)', ok: S => (S.stats.endSpeed?.R1 ?? 9) <= 0.1 },
    { t: 'ไม่โดนเตือน G404 (ไม่วิ่งและไม่โยกจอยหลังหมดเวลา)', ok: (S, api) => api.foulCount('red', 'G404') === 0, live: true },
  ],
},
'D3.3': {
  role: 'driver', title: 'ไม่ถือเกิน 4 ลูก (G407)',
  brief: 'หุ่นในบทนี้ไม่มีระบบหยุด intake เองเมื่อครบ 4 ลูก ถ้าเปิด intake ค้างไว้ ลูกที่ 5 จะเข้าหุ่นได้ ถือเกิน 4 ลูกผิด G407 (ถือค้างหรือทำซ้ำ = MAJOR FOUL + YELLOW CARD) ดูจำนวนลูกที่แผงซ้าย ครบ 4 แล้วปิด intake หรือเลี่ยงลูก ถ้าลูกที่ 5 เข้ามาให้กด ○ คายทันที ยิงเข้า CELL ให้ได้ 8 ลูก',
  start: 120, opt: { autoStop: false, bots: false },
  setup(api) { ['B1', 'B2'].forEach(api.bench); api.parkNow('R2'); api.carry('R1', ['pollen', 'pollen', 'pollen']); api.scatter(22, RED_HALF); },
  status: api => `ยิงเข้า ${api.S.stats.hits}/8 · ลูกในหุ่น ${api.robot('R1').load.length}/4`,
  end: api => api.S.stats.hits >= 8,
  obj: [
    { t: 'ยิงเข้า CELL 8 ลูก', ok: S => S.stats.hits >= 8 },
    { t: 'ไม่ถือ 5 ลูกค้างจนโดน MAJOR FOUL (G407)', ok: S => !S.fouls.some(f => f.all === 'red' && f.rule === 'G407' && f.sev === 'MAJOR'), live: true },
    { t: 'ลูกที่ 5 เข้าหุ่นไม่เกิน 1 ครั้ง', ok: S => S.fouls.filter(f => f.all === 'red' && f.rule === 'G407' && f.sev === 'WARN').length <= 1, live: true },
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
// ---------------- Operator ----------------
// คนคุม intake / launcher (Joy 2) ฝึกกับเหตุการณ์แบบสนามจริง: ดูดลูกมีดีเลย์ · โดนชนแล้วหุ่นไถล · คู่แข่งเข้ามาเบียดแย่งลูก
'O1.1': {
  role: 'operator', title: 'ดูดลูกให้ติด (intake มีดีเลย์)',
  brief: 'intake ของหุ่นจริงไม่ได้ดูดลูกติดทันที ต้องประคองลูกให้อยู่หน้า intake ประมาณครึ่งวินาที (ดูแถบ "กำลังดูดลูก" ที่แผงซ้าย) ถ้าวิ่งผ่านเร็วเกินไปลูกจะหลุด เก็บ POLLEN ให้ได้ 10 ลูกใน 60 วิ ลูกที่เก็บจะถูกนับแล้วหายไปจากหุ่น',
  start: 60, opt: { bots: false, intakeDelay: true, noClockRules: true },
  setup(api) { api.resetBalls(); BENCH_ALL(api); api.carry('R1', []); api.scatter(14, RED_HALF); api.randomPoints(2, RED_HALF, 0.4).forEach(p => api.floor('nectar', 'blue', p[0], p[1])); api.S.sc.n = 0; },
  onPickup(api, r, bi) { if (r.id === 'R1' && api.S.balls[bi].kind === 'pollen') { api.S.sc.n++; api.vanish(bi); } },
  status: api => `เก็บแล้ว ${api.S.sc.n}/10 · ชนกำแพงแรง ${api.S.stats.wallHits} ครั้ง`,
  end: api => api.S.sc.n >= 10,
  obj: [
    { t: 'เก็บ POLLEN 10 ลูกภายใน 60 วิ (ดูดจนติดจริง)', ok: S => S.sc.n >= 10 },
    { t: 'ไม่เก็บ NECTAR คู่แข่ง (G408)', ok: S => S.stats.g408.red === 0, live: true },
    { t: 'ชนกำแพงแรงไม่เกิน 3 ครั้ง', ok: S => S.stats.wallHits <= 3, live: true },
  ],
},
'O1.2': {
  role: 'operator', title: 'ยิงอิสระ: เข้าไม่เข้าตามจริง',
  brief: 'ไม่มีการล็อกยิง กดยิงได้ทุกที่ทุกจังหวะ ลูกจะเข้า CELL หรือไม่ขึ้นกับระยะ มุม และความเร็วของหุ่นตอนกด (ยิงตอนหุ่นยังไถล ลูกจะเบี้ยวตาม) ยิงเข้าให้ได้ 8 ลูก โดยความแม่นไม่ต่ำกว่า 60% ใช้เส้นวิถีช่วยเล็ง แล้วหยุดให้นิ่งก่อนกด',
  start: 120, opt: { bots: false, intakeDelay: true, traj: true },
  setup(api) { ['B1', 'B2'].forEach(api.bench); api.parkNow('R2'); api.carry('R1', ['pollen', 'pollen']); api.scatter(18, RED_HALF); },
  status: api => { const s = api.S.stats; return `ยิงเข้า ${s.hits}/8 · ยิงไป ${s.shots} ลูก · แม่น ${s.shots ? Math.round(s.hits / s.shots * 100) : 0}%`; },
  end: api => api.S.stats.hits >= 8,
  obj: [
    { t: 'ยิงเข้า CELL 8 ลูกภายใน 2:00', ok: S => S.stats.hits >= 8 },
    { t: 'ความแม่นอย่างน้อย 60%', ok: S => S.stats.shots >= 8 && S.stats.hits / S.stats.shots >= 0.6 },
    { t: 'ยิงจากจุดยิงอย่างน้อย 2 จุด', ok: S => S.robots[0].shotSpots.length >= 2 },
  ],
},
'O1.3': {
  role: 'operator', title: 'ปิด intake ผ่าน NECTAR คู่แข่ง (G408)',
  brief: 'POLLEN กับ NECTAR สีน้ำเงินของคู่แข่งวางสลับกันเป็นแถว intake ของบทนี้ดูดติดทันทีที่ลูกแตะ ถ้าขับผ่าน NECTAR น้ำเงินโดยเปิด intake ไว้ ลูกจะเข้าหุ่น = ควบคุม NECTAR ของคู่แข่ง (G408) ให้กดปิด intake ก่อนผ่าน แล้วเปิดใหม่เพื่อเก็บ POLLEN ลูกถัดไป หรือเข้าหา POLLEN จากด้านที่ไม่มี NECTAR เก็บ POLLEN ให้ได้ 8 ลูกใน 60 วิ ลูกที่เก็บจะถูกนับแล้วหายไปจากหุ่น ถ้าเผลอเก็บ NECTAR น้ำเงิน ให้กด ○ คายทันที',
  start: 60, opt: { bots: false, intakeDelay: false, noClockRules: true },
  setup(api) {
    api.resetBalls(); BENCH_ALL(api); api.carry('R1', []); api.pos('R1', -1.5, 0, -Math.PI / 2);
    for (let k = 0; k < 11; k++) api.floor(k % 2 ? 'nectar' : 'pollen', k % 2 ? 'blue' : 'yellow', -0.95, -1.25 + k * 0.25);
    [[-1.4, -1.0], [-1.4, -0.5], [-1.4, 0.5], [-1.4, 1.0]].forEach(p => api.floor('pollen', 'yellow', p[0], p[1]));
    api.S.sc.n = 0;
  },
  onPickup(api, r, bi) { if (r.id === 'R1' && api.S.balls[bi].kind === 'pollen') { api.S.sc.n++; api.vanish(bi); } },
  status: api => `เก็บ POLLEN ${api.S.sc.n}/8 · เก็บ NECTAR คู่แข่ง ${api.S.stats.g408.red} ครั้ง · intake ${api.robot('R1').intake ? 'เปิด' : 'ปิด'}`,
  end: api => api.S.sc.n >= 8,
  obj: [
    { t: 'เก็บ POLLEN 8 ลูกภายใน 60 วิ', ok: S => S.sc.n >= 8 },
    { t: 'ไม่ควบคุม NECTAR คู่แข่งเลย (G408)', ok: S => S.stats.g408.red === 0, live: true },
  ],
},
'O2.1': {
  role: 'operator', title: 'โดนเบียดแล้วยังคุมหุ่นได้',
  brief: 'หุ่นน้ำเงิน B1 จะเข้ามาชนและเบียดเป็นระยะ โดนชนแล้วหุ่นเราจะไถล หมุน และสั่น เหมือนของจริง หน้าที่ของ Operator คือรอให้หุ่นนิ่งก่อนค่อยยิง อย่ากดตอนกำลังโดนเบียด ยิงเข้าให้ได้ 6 ลูก รักษาเลือดไว้ ≥ 60% (เลือดเป็นกฎฝึกของทีม) และอย่าเบียดคู่แข่งติดกำแพงเกิน 3 วิ (PIN G421)',
  start: 120, opt: { bots: false, intakeDelay: true, shove: true, health: true },
  setup(api) { api.bench('B2'); api.parkNow('R2'); api.carry('R1', ['pollen', 'pollen']); api.scatter(16, RED_HALF); api.pos('B1', -0.2, 0.2, -Math.PI / 2); api.carry('B1', []); api.ai('B1', { mode: 'contest', target: 'R1' }); },
  status: api => { const S = api.S; return `ยิงเข้า ${S.stats.hits}/6 · โดนชน ${S.stats.collisions} ครั้ง · เลือด ${S.robots[0].hp}%`; },
  end: api => api.S.stats.hits >= 6,
  obj: [
    { t: 'ยิงเข้า CELL 6 ลูก ขณะโดนเบียด', ok: S => S.stats.hits >= 6 },
    { t: 'เลือด R1 เหลืออย่างน้อย 60%', ok: S => S.robots[0].hp >= 60, live: true },
    { t: 'ไม่โดน PIN (G421)', ok: (S, api) => api.foulCount('red', 'G421') === 0, live: true },
  ],
},
'O2.2': {
  role: 'operator', title: 'แย่งลูกกับคู่แข่ง',
  brief: 'POLLEN 16 ลูกกองอยู่กลางสนามฝั่งแดง หุ่นน้ำเงิน B1 จะวิ่งเข้ามาแย่งลูกที่เรากำลังจะเก็บ และเบียดเราออกจากกอง เก็บให้ได้อย่างน้อย 8 ลูก และมากกว่า B1 ภายใน 75 วิ ลูกที่เก็บจะถูกนับแล้วหายไป เทคนิค: เข้าถึงลูกก่อนคู่แข่ง ประคองให้ intake ดูดจนติด แล้วขยับไปลูกถัดไปทันที ห้ามจอดทับกองลูกเพื่อกันไม่ให้คู่แข่งเก็บ (G411 = MAJOR FOUL + YELLOW CARD)',
  start: 75, opt: { bots: false, intakeDelay: true, shove: true, noClockRules: true, hoard: true },
  setup(api) {
    api.resetBalls(); api.bench('R2'); api.bench('B2'); api.carry('R1', []);
    api.scatter(16, { xMin: -1.25, xMax: -0.45, zMin: -0.8, zMax: 0.8 });
    api.pos('R1', -1.5, 0, -Math.PI / 2); api.pos('B1', -0.1, 0.9, Math.PI / 2); api.ai('B1', { mode: 'contest', target: 'R1', v: 0.75, pause: 8 });
    api.S.sc.n = 0; api.S.sc.opp = 0;
  },
  onPickup(api, r, bi) { if (api.S.balls[bi].kind !== 'pollen') return; if (r.id === 'R1') api.S.sc.n++; else api.S.sc.opp++; api.vanish(bi); },
  status: api => `เราเก็บได้ ${api.S.sc.n} · B1 เก็บได้ ${api.S.sc.opp} · เหลือบนพื้น ${api.S.balls.filter(b => b.where === 'floor' && b.kind === 'pollen').length}`,
  end: api => api.S.sc.n + api.S.sc.opp >= 16,
  obj: [
    { t: 'เก็บ POLLEN อย่างน้อย 8 ลูก', ok: S => S.sc.n >= 8 },
    { t: 'เก็บได้มากกว่า B1', ok: S => S.sc.n > S.sc.opp, live: true },
    { t: 'ไม่โดน PIN (G421)', ok: (S, api) => api.foulCount('red', 'G421') === 0, live: true },
    { t: 'ไม่จอดกักกองลูก (G411)', ok: (S, api) => api.foulCount('red', 'G411') === 0, live: true },
  ],
},
'O2.3': {
  role: 'operator', title: 'เกมรับถูกกติกา: ประกบจุดยิง',
  brief: 'หุ่นน้ำเงิน B1 เก็บ POLLEN แล้วกลับไปยิงที่จุดยิงของตัวเองซ้ำ ๆ ถ้าปล่อยไว้ 75 วิ B1 จะยิงเข้าประมาณ 22 ลูก หน้าที่ของเราคือพาหุ่นไปยืนในจุดยิงหรือขวางทางเดิน ให้ B1 ยิงเข้าได้ไม่เกิน 13 ลูก โดยไม่ผิดกติกา: ห้ามดันเขาติดกำแพงหรือ HIVE เกิน 3 วิ (PIN G421 ต้องถอยออกห่าง 2 ฟุต) ห้ามจอดทับกองลูกเพื่อกันไม่ให้เขาเก็บ (G411) และห้ามพุ่งชนแรง (G419 / G420 กรรมการใช้ดุลยพินิจ)',
  start: 75, opt: { bots: false, intakeDelay: true, shove: true, hoard: true },
  setup(api) {
    api.bench('R2'); api.bench('B2'); api.carry('R1', []); api.pos('R1', -0.5, -0.9, -Math.PI / 2);
    api.ai('B1', { mode: 'offense', parkAt: 0 }); api.S.sc.opp = 0;
  },
  onCellHit(api, b) { if (b.shooter === 'B1' && b.hive === 'blue') api.S.sc.opp++; },
  status: api => `B1 ยิงเข้า ${api.S.sc.opp}/13 · ชนแรง ${api.S.stats.hardHits.R1 || 0} ครั้ง`,
  obj: [
    { t: 'B1 ยิงเข้า CELL ไม่เกิน 13 ลูกใน 75 วิ', ok: S => !!S.end && S.sc.opp <= 13 },
    { t: 'ไม่โดน PIN (G421)', ok: (S, api) => api.foulCount('red', 'G421') === 0, live: true },
    { t: 'ไม่จอดกักกองลูก (G411)', ok: (S, api) => api.foulCount('red', 'G411') === 0, live: true },
    { t: 'ไม่พุ่งชนคู่แข่งแรง (เสี่ยง G419 / G420)', ok: S => (S.stats.hardHits.R1 || 0) === 0, live: true },
  ],
},
'O3.1': {
  role: 'operator', title: 'สอบ Operator: TELEOP 2:00 มีคู่แข่งตามเบียด',
  brief: 'TELEOP เต็ม 2:00 หุ่น AI ครบ 3 ตัว โดย B1 ตามเบียดและแย่งลูกเราตลอดแมตช์ intake มีดีเลย์ ยิงไม่มีล็อก โดนชนแล้วหุ่นไถล (เลือดเป็นกฎฝึกของทีม) Operator ต้องจัดการลูกในหุ่น (ไม่เกิน 4 ลูก) เลือกจังหวะยิงตอนหุ่นนิ่ง และกลับไป PARK ให้ทัน',
  start: 120, opt: { intakeDelay: true, shove: true, health: true },
  setup(api) { api.ai('B1', { mode: 'contest', target: 'R1' }); },
  status: api => { const s = api.S.stats; return `TIP แดง ${s.tips.red} · R1 ยิงเข้า ${api.S.robots[0].hits || 0}/${api.S.robots[0].shots || 0} · เลือด ${api.S.robots[0].hp}%`; },
  obj: [
    { t: 'HIVE แดง TIP อย่างน้อย 3 ครั้ง', ok: (S, api) => api.tips('red') >= 3 },
    { t: 'R1 ยิงแม่นอย่างน้อย 60% (ยิงอย่างน้อย 8 ลูก)', ok: S => (S.robots[0].shots || 0) >= 8 && (S.robots[0].hits || 0) / S.robots[0].shots >= 0.6 },
    { t: 'เลือด R1 เหลืออย่างน้อย 60%', ok: S => S.robots[0].hp >= 60, live: true },
    { t: 'R1 ไม่โดน FOUL หรือคำเตือนเลย', ok: S => !S.fouls.some(f => f.by === 'R1'), live: true },
  ],
},
// ---------------- Human Player ----------------
'H2.1': {
  role: 'hp', title: 'ปล่อย NECTAR ตามจังหวะ TIP',
  brief: 'คุณคือ Human Player ฝั่งแดง หุ่นทั้งสองตัวขับโดย AI ทุกครั้งที่ HIVE แดง TIP คุณได้สิทธิ์ปล่อย NECTAR 1 ลูก (G426) กด H หรือปุ่ม "ปล่อย NECTAR" ภายใน 5 วิหลัง TIP (5 วิเป็นเป้าฝึกของทีม กติกาไม่ได้กำหนดเวลา) ห้ามปล่อยก่อนได้สิทธิ์ และห้ามปล่อยตอนหุ่นอยู่ตรงจุดวางลูกใน LOADING ZONE (G427) สถานการณ์จบเมื่อเหลือ 1:02',
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
  brief: 'เริ่มตอนเหลือ 1:15 คุณยังถือ NECTAR 4 ลูกและไม่มีสิทธิ์ค้าง เมื่อนาฬิกาถึง 1:00 ปล่อยได้ทั้งหมด ต้องปล่อยครบ 4 ลูกภายใน 5 วิหลัง 1:00 (เป้าฝึกของทีม) ห้ามปล่อยก่อนเวลา และดูให้ LOADING ZONE ว่างก่อนปล่อยทุกลูก',
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
'H3.2': {
  role: 'hp', title: 'เก็บสิทธิ์ไว้ หรือปล่อยเลย',
  brief: 'มีสิทธิ์แล้วไม่จำเป็นต้องปล่อยทันที HIVE แดงจะ TIP ทุกประมาณ 12 วิ และหุ่น R1 วิ่งเข้าออกแถว LOADING ZONE ให้ปล่อย NECTAR เฉพาะตอนที่ LOADING ZONE ว่าง และมีหุ่นแดงอยู่ใกล้พอจะมารับ (ไม่เกิน 1.3 ม. ดูแถบสถานะ) ถ้ายังไม่เข้าเงื่อนไขให้เก็บสิทธิ์ไว้ก่อน ห้ามปล่อยเกินสิทธิ์ (G426) และห้ามปล่อยใส่หุ่น (G427) ปล่อยให้ได้อย่างน้อย 3 ลูกก่อนเหลือ 1:02 เงื่อนไข "มีหุ่นอยู่ใกล้" เป็นเป้าฝึกของทีม ไม่ใช่กติกา',
  start: 120, opt: { hpManual: true, lockCam: 2 }, coach: ['hp'],
  setup(api) { api.ai('R1', { mode: 'traffic' }); api.ai('R2', { mode: 'offense' }); Object.assign(api.S.sc, { nextTip: api.S.el + 6, nRel: 0, good: 0, bad: 0 }); },
  tick(api) {
    const S = api.S, sc = S.sc; if (S.el >= sc.nextTip && api.remaining() > 66) { api.forceTip('red'); sc.nextTip = S.el + 12; }
    const n = api.releases('red').length;
    if (n > sc.nRel) { const ok = !['R1', 'R2'].some(id => !api.robot(id).off && api.overlapLZ(id, 'red')) && ['R1', 'R2'].some(id => nearLZ(api, id)); if (ok) sc.good += n - sc.nRel; else { sc.bad += n - sc.nRel; api.say('ปล่อยตอนยังไม่มีหุ่นแดงมารับ หรือ LOADING ZONE ไม่ว่าง', 2); } sc.nRel = n; }
  },
  status: api => `${hpStatus(api)} · หุ่นแดงใกล้พอมารับ: ${['R1', 'R2'].some(id => nearLZ(api, id)) ? 'ใช่ ✓' : 'ยัง'} · ปล่อยถูกจังหวะ ${api.S.sc.good} · ผิดจังหวะ ${api.S.sc.bad}`,
  end: api => api.remaining() <= 62,
  obj: [
    { t: 'ปล่อย NECTAR ถูกจังหวะอย่างน้อย 3 ลูก (LOADING ZONE ว่าง และมีหุ่นแดงอยู่ใกล้)', ok: S => S.sc.good >= 3 },
    { t: 'ปล่อยผิดจังหวะไม่เกิน 1 ลูก', ok: S => S.sc.bad <= 1, live: true },
    { t: 'ไม่ปล่อยเกินสิทธิ์ (G426)', ok: (S, api) => api.foulCount('red', 'G426') === 0, live: true },
    { t: 'ไม่ปล่อยใส่หุ่นใน LOADING ZONE (G427)', ok: (S, api) => api.foulCount('red', 'G427') === 0, live: true },
  ],
},
'H4.1': {
  role: 'hp', title: 'สอบ Human Player: แมตช์เต็ม',
  brief: 'แมตช์เต็ม 2:30 หุ่นทุกตัวขับโดย AI คุณเป็น Human Player ฝั่งแดงคนเดียว ปล่อย NECTAR ภายใน 5 วิหลังทุก TIP (เป้าฝึกของทีม) ปล่อยที่เหลือทั้งหมดทันทีเมื่อเหลือ 1:00 และห้ามโดน FOUL จาก Human Player',
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
