// WOK HEI! — Midnight Kitchen Rush
// An original timed cooking game: build dishes from counter ingredients,
// cook them in the wok, serve the matching order before patience runs out.
// Plays offline from static files, keyboard + mouse, no network requests.

const W = 1280, H = 720;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

const INGREDIENTS = [
  { id: 'rice',    emoji: '🍚', name: 'Rice',    key: '1' },
  { id: 'noodle',  emoji: '🍜', name: 'Noodle',  key: '2' },
  { id: 'egg',     emoji: '🥚', name: 'Egg',     key: '3' },
  { id: 'chicken', emoji: '🍗', name: 'Chicken', key: '4' },
  { id: 'prawn',   emoji: '🦐', name: 'Prawn',   key: '5' },
  { id: 'veggie',  emoji: '🥦', name: 'Veggie',  key: '6' },
  { id: 'chili',   emoji: '🌶️', name: 'Chili',   key: '7' },
  { id: 'sauce',   emoji: '🧂', name: 'Sauce',   key: '8' },
];

const DISHES = [
  { name: 'Nasi Goreng',       emoji: '🍛', recipe: ['rice', 'egg', 'chili'],     coins: 80 },
  { name: 'Mie Ayam Geprek',   emoji: '🍜', recipe: ['noodle', 'chicken', 'chili'], coins: 100 },
  { name: 'Prawn Fried Rice',  emoji: '🍤', recipe: ['rice', 'prawn', 'egg'],     coins: 110 },
  { name: 'Veggie Noodle Soup',emoji: '🥣', recipe: ['noodle', 'veggie', 'sauce'], coins: 90 },
  { name: 'Chicken Katsu Rice',emoji: '🍱', recipe: ['rice', 'chicken', 'sauce'], coins: 120 },
  { name: 'Spicy Prawn Noodle',emoji: '🍝', recipe: ['noodle', 'prawn', 'chili'], coins: 130 },
];

const SHIFT_LEN = 180;      // 3 minute shift
const ORDER_PATIENCE = 45;  // seconds per order
const COOK_TIME = 2.5;      // seconds in the wok
const BURN_TIME = 6;        // seconds before a cooked dish burns
const SPAWN_EVERY = 14;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const params = new URLSearchParams(location.search);
const shotName = params.get('shot') || null;
const seed = Number(params.get('seed') || '1') || 1;
const rng = mulberry32(seed * 2654435761);

// ---- state ---------------------------------------------------------------
let orderSeq = 0;
const state = {
  screen: 'title', // title | playing | paused | over
  time: 0,
  shiftTime: SHIFT_LEN,
  coins: 0,
  combo: 0,
  bestCombo: 0,
  served: 0,
  lost: 0,
  mistakes: 0,
  orders: [],
  spawnTimer: 0,
  plate: [],
  cooking: null,   // { progress }
  cooked: null,    // dish object, 'burnt', or null
  burnTimer: 0,
  toasts: [],      // { text, color, t }
  stars: 0,
  muted: false,
  flame: 0,
};

function dishByRecipe(ids) {
  const key = [...ids].sort().join('+');
  return DISHES.find((d) => [...d.recipe].sort().join('+') === key) || null;
}

function newOrder() {
  const dish = DISHES[Math.floor(rng() * DISHES.length)];
  return { id: ++orderSeq, dish, timeLeft: ORDER_PATIENCE, max: ORDER_PATIENCE };
}

function toast(text, color) {
  state.toasts.push({ text, color: color || '#fff', t: 0 });
  if (state.toasts.length > 4) state.toasts.shift();
  if (statusEl) statusEl.textContent = text;
}

// ---- audio (tiny WebAudio synth, no files) -------------------------------
let audioCtx = null;
function ac() {
  if (state.muted) return null;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch (e) { return null; }
}
function beep(freq, dur, type, vol) {
  const c = ac(); if (!c) return;
  try {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.12, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  } catch (e) { /* audio is best-effort */ }
}
function sizzle() {
  const c = ac(); if (!c) return;
  try {
    const len = c.sampleRate * 0.5, buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.25;
    const src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 3200;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(c.destination);
    src.start();
  } catch (e) { /* best-effort */ }
}
const sfx = {
  pick: () => beep(520, 0.08, 'triangle', 0.10),
  cook: () => { sizzle(); beep(180, 0.2, 'sawtooth', 0.05); },
  ding: () => { beep(880, 0.15, 'sine', 0.14); setTimeout(() => beep(1318, 0.25, 'sine', 0.12), 110); },
  bad: () => beep(140, 0.3, 'square', 0.08),
  lost: () => { beep(320, 0.2, 'sine', 0.1); setTimeout(() => beep(210, 0.35, 'sine', 0.1), 150); },
};

// ---- actions -------------------------------------------------------------
function startGame() {
  state.screen = 'playing';
  state.time = 0; state.shiftTime = SHIFT_LEN;
  state.coins = 0; state.combo = 0; state.bestCombo = 0;
  state.served = 0; state.lost = 0; state.mistakes = 0;
  state.orders = [newOrder(), newOrder()];
  state.spawnTimer = SPAWN_EVERY;
  state.plate = []; state.cooking = null; state.cooked = null; state.burnTimer = 0;
  state.toasts = []; state.stars = 0;
  toast('Shift started! Serve the orders!', '#ffd166');
  sfx.ding();
}

function addIngredient(id) {
  if (state.screen !== 'playing' || state.cooking || state.cooked) return;
  if (state.plate.includes(id)) {
    state.plate = state.plate.filter((x) => x !== id);
    toast(ingName(id) + ' removed', '#ccc');
    return;
  }
  if (state.plate.length >= 3) { toast('Plate is full — cook it or clear it!', '#ff9a7a'); sfx.bad(); return; }
  state.plate.push(id);
  sfx.pick();
}

function ingName(id) {
  const ing = INGREDIENTS.find((i) => i.id === id);
  return ing ? ing.name : id;
}

function startCook() {
  if (state.screen !== 'playing' || state.cooking || state.cooked) return;
  if (state.plate.length === 0) { toast('Add ingredients to the plate first!', '#ff9a7a'); sfx.bad(); return; }
  state.cooking = { progress: 0 };
  sfx.cook();
  toast('Cooking in the wok…', '#ffb347');
}

function finishCook() {
  const dish = dishByRecipe(state.plate);
  state.cooked = dish || 'mystery';
  state.cooking = null;
  state.burnTimer = 0;
  if (dish) { toast(dish.name + ' is ready — serve it!', '#7dff9a'); sfx.ding(); }
  else { toast('Mystery Mix… nobody ordered that!', '#ff9a7a'); sfx.bad(); }
}

function clearPlate() {
  if (state.screen !== 'playing') return;
  if (state.cooking) return;
  if (state.plate.length === 0 && !state.cooked) return;
  state.plate = []; state.cooked = null; state.burnTimer = 0;
  toast('Plate cleared', '#ccc');
}

function serveDish() {
  if (state.screen !== 'playing' || !state.cooked) {
    if (state.screen === 'playing' && !state.cooked) toast('Nothing cooked to serve yet!', '#ff9a7a');
    return;
  }
  if (state.cooked === 'burnt') { toast('It is burnt! Clear the plate.', '#ff9a7a'); sfx.bad(); return; }
  const dish = state.cooked === 'mystery' ? null : state.cooked;
  const idx = dish ? state.orders.findIndex((o) => o.dish.name === dish.name) : -1;
  if (idx === -1) {
    state.coins = Math.max(0, state.coins - 10);
    state.combo = 0; state.mistakes++;
    state.plate = []; state.cooked = null; state.burnTimer = 0;
    toast(dish ? 'No one ordered ' + dish.name + '! −10 coins' : 'Mystery Mix thrown out! −10 coins', '#ff6b6b');
    sfx.bad();
    return;
  }
  const order = state.orders[idx];
  const timeBonus = Math.round(30 * (order.timeLeft / order.max));
  const comboBonus = state.combo * 10;
  const earned = dish.coins + timeBonus + comboBonus;
  state.coins += earned;
  state.combo++; state.bestCombo = Math.max(state.bestCombo, state.combo);
  state.served++;
  state.orders.splice(idx, 1);
  state.plate = []; state.cooked = null; state.burnTimer = 0;
  toast('Served ' + dish.name + '! +' + earned + ' coins' + (state.combo > 1 ? '  🔥x' + state.combo : ''), '#7dff9a');
  sfx.ding();
}

function endShift() {
  state.screen = 'over';
  const s = state.served;
  state.stars = s >= 12 ? 3 : s >= 8 ? 2 : s >= 4 ? 1 : 0;
  toast('Shift over!', '#ffd166');
  sfx.ding();
}

// ---- update --------------------------------------------------------------
function update(dt) {
  state.time += dt;
  state.flame += dt;
  for (const t of state.toasts) t.t += dt;
  state.toasts = state.toasts.filter((t) => t.t < 2.6);
  if (state.screen !== 'playing') return;

  state.shiftTime -= dt;
  if (state.shiftTime <= 0) { state.shiftTime = 0; endShift(); return; }

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    state.spawnTimer = SPAWN_EVERY;
    if (state.orders.length < 3) state.orders.push(newOrder());
  }
  for (const o of state.orders) o.timeLeft -= dt;
  const expired = state.orders.filter((o) => o.timeLeft <= 0);
  if (expired.length) {
    state.orders = state.orders.filter((o) => o.timeLeft > 0);
    state.lost += expired.length;
    state.combo = 0;
    toast('Order lost: ' + expired.map((o) => o.dish.name).join(', '), '#ff6b6b');
    sfx.lost();
  }
  if (state.cooking) {
    state.cooking.progress += dt / COOK_TIME;
    if (state.cooking.progress >= 1) finishCook();
  } else if (state.cooked && state.cooked !== 'burnt') {
    state.burnTimer += dt;
    if (state.burnTimer >= BURN_TIME) {
      state.cooked = 'burnt';
      toast('It burnt! Clear the plate!', '#ff6b6b');
      sfx.bad();
    }
  }
}

// ---- rendering -----------------------------------------------------------
let hits = []; // rebuilt each frame: {x,y,w,h,action,label}
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function fitCanvas() {
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = Math.floor(W * scale) + 'px';
  canvas.style.height = Math.floor(H * scale) + 'px';
}
window.addEventListener('resize', fitCanvas);

function drawHeader() {
  ctx.fillStyle = '#1d120b';
  ctx.fillRect(0, 0, W, 64);
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 30px Georgia, serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('🔥 WOK HEI!', 18, 34);
  ctx.font = '15px Georgia, serif';
  ctx.fillStyle = '#ffb347';
  ctx.fillText('MIDNIGHT KITCHEN RUSH', 248, 36);

  // shift timer
  const urgent = state.shiftTime <= 30;
  ctx.fillStyle = urgent ? '#ff6b6b' : '#fff6e0';
  ctx.font = 'bold 26px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('⏱ SHIFT ' + fmtTime(state.shiftTime), 640, 34);
  ctx.fillStyle = urgent ? '#ff6b6b' : '#2fa36b';
  rr(500, 52, 280 * (state.shiftTime / SHIFT_LEN), 6, 3); ctx.fill();

  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 24px Georgia, serif';
  ctx.fillText('🪙 ' + state.coins.toLocaleString('en-US'), 1080, 34);
  ctx.fillStyle = state.combo > 1 ? '#ff8c42' : '#8a7a6a';
  ctx.font = 'bold 20px Georgia, serif';
  ctx.fillText(state.combo > 1 ? '🔥 COMBO x' + state.combo : 'COMBO —', 1262, 34);
  ctx.textAlign = 'left';
}

function drawOrderBoard() {
  ctx.fillStyle = '#b08954';
  rr(16, 80, 300, 300, 14); ctx.fill();
  ctx.fillStyle = '#8b5a2b';
  rr(16, 80, 300, 40, 14); ctx.fill();
  ctx.fillRect(16, 104, 300, 16);
  ctx.fillStyle = '#fff6e0';
  ctx.font = 'bold 20px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('📋 ORDER BOARD', 166, 101);

  if (state.orders.length === 0) {
    ctx.fillStyle = '#fff6e0';
    ctx.font = '18px Georgia, serif';
    ctx.fillText('No orders yet…', 166, 220);
  }
  state.orders.forEach((o, i) => {
    const y = 132 + i * 78;
    const frac = Math.max(0, o.timeLeft / o.max);
    const matched = state.cooked && state.cooked !== 'burnt' && state.cooked !== 'mystery'
      && state.cooked.name === o.dish.name;
    ctx.fillStyle = matched ? '#d8f7c5' : '#fff6e0';
    rr(28, y, 276, 68, 10); ctx.fill();
    if (matched) { ctx.strokeStyle = '#2fa36b'; ctx.lineWidth = 3; ctx.stroke(); }
    ctx.fillStyle = '#3a2418';
    ctx.font = 'bold 17px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText(o.dish.emoji + ' ' + o.dish.name, 40, y + 22);
    ctx.font = '15px Georgia, serif';
    ctx.fillStyle = '#8a6d3b';
    ctx.fillText('🪙 ' + o.dish.coins + '   ' + o.dish.recipe.map(ingName).join(' + '), 40, y + 46);
    ctx.fillStyle = frac > 0.5 ? '#2fa36b' : frac > 0.25 ? '#e07b39' : '#d64545';
    rr(40, y + 54, 252 * frac, 8, 4); ctx.fill();
    ctx.fillStyle = '#3a2418';
    ctx.font = 'bold 13px Georgia, serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.ceil(o.timeLeft) + 's', 292, y + 22);
    ctx.textAlign = 'left';
  });
  ctx.textAlign = 'left';
}

function drawIngredients() {
  ctx.fillStyle = '#8b5a2b';
  rr(16, 396, 1248, 128, 14); ctx.fill();
  ctx.fillStyle = '#a06a35';
  ctx.fillRect(16, 396, 1248, 10);
  ctx.fillStyle = '#ffe9b8';
  ctx.font = 'bold 18px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.fillText('🥬 INGREDIENTS ON THE COUNTER — click or press 1–8', 30, 424);

  INGREDIENTS.forEach((ing, i) => {
    const x = 30 + i * 152, y = 436, w = 138, h = 74;
    const on = state.plate.includes(ing.id);
    ctx.fillStyle = on ? '#ffe08a' : '#fff8ec';
    rr(x, y, w, h, 12); ctx.fill();
    if (on) { ctx.strokeStyle = '#e07b39'; ctx.lineWidth = 3; ctx.stroke(); }
    ctx.font = '30px serif';
    ctx.textAlign = 'center';
    ctx.fillText(ing.emoji, x + w / 2, y + 34);
    ctx.fillStyle = '#3a2418';
    ctx.font = 'bold 14px Georgia, serif';
    ctx.fillText(ing.name, x + w / 2, y + 58);
    ctx.fillStyle = '#8a7a6a';
    ctx.font = '12px Georgia, serif';
    ctx.fillText('[' + ing.key + ']', x + w / 2, y + 70);
    hits.push({ x, y, w, h, action: () => addIngredient(ing.id), label: ing.name });
  });
  ctx.textAlign = 'left';
}

function drawKitchen() {
  // wall + floor
  const g = ctx.createLinearGradient(0, 64, 0, H);
  g.addColorStop(0, '#4a2f1d'); g.addColorStop(0.55, '#3a2418'); g.addColorStop(1, '#241610');
  ctx.fillStyle = g; ctx.fillRect(0, 64, W, H - 64);
  // tile stripe
  ctx.fillStyle = '#f7e8c9';
  ctx.fillRect(0, 64, W, 6);
  // hanging lamp + chef + cat mascot
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(1120, 120, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a2418'; ctx.font = '34px serif'; ctx.textAlign = 'center';
  ctx.fillText('👨‍🍳', 1120, 132);
  ctx.font = '15px Georgia, serif'; ctx.fillStyle = '#ffe9b8';
  ctx.fillText('Chef Bara', 1120, 168);
  ctx.font = '34px serif';
  ctx.fillText('🐱', 1200, 132);
  ctx.font = '13px Georgia, serif'; ctx.fillStyle = '#ffe9b8';
  ctx.fillText('Momo', 1200, 168);
  ctx.textAlign = 'left';

  drawOrderBoard();

  // stove + wok (right side)
  const wx = 940, wy = 250;
  ctx.fillStyle = '#1a1a1e';
  rr(wx - 110, wy - 60, 220, 130, 16); ctx.fill();
  ctx.fillStyle = '#33333a';
  rr(wx - 100, wy - 50, 200, 110, 12); ctx.fill();
  // flame
  const fl = 0.75 + 0.25 * Math.sin(state.flame * 6);
  ctx.fillStyle = state.cooking ? 'rgba(255,140,40,' + fl + ')' : 'rgba(255,140,40,0.25)';
  ctx.beginPath();
  ctx.ellipse(wx, wy + 34, 52, 20 * fl + 6, 0, 0, Math.PI * 2); ctx.fill();
  // wok
  ctx.fillStyle = '#242428';
  ctx.beginPath(); ctx.ellipse(wx, wy, 78, 30, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#55555e'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#3a3a40';
  ctx.beginPath(); ctx.ellipse(wx, wy - 4, 66, 22, 0, 0, Math.PI * 2); ctx.fill();
  if (state.cooking) {
    ctx.font = '26px serif'; ctx.textAlign = 'center';
    ctx.fillText('🍚', wx - 24 + Math.sin(state.flame * 9) * 4, wy - 8);
    ctx.fillText('🔥', wx + 22, wy - 10);
    ctx.fillStyle = '#ffd166';
    rr(wx - 60, wy + 52, 120 * state.cooking.progress, 8, 4); ctx.fill();
    ctx.strokeStyle = '#fff6e0'; ctx.lineWidth = 1;
    rr(wx - 60, wy + 52, 120, 8, 4); ctx.stroke();
  } else if (state.cooked && state.cooked !== 'burnt') {
    ctx.font = '30px serif'; ctx.textAlign = 'center';
    ctx.fillText(state.cooked === 'mystery' ? '❓' : state.cooked.emoji, wx, wy - 2);
  }
  ctx.fillStyle = '#ffe9b8';
  ctx.font = 'bold 16px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText(state.cooking ? 'COOKING…' : '🔥 THE WOK  [C]', wx, wy + 82);
  ctx.textAlign = 'left';

  // assembly plate (center)
  const px = 560, py = 250;
  ctx.fillStyle = '#fff8ec';
  ctx.beginPath(); ctx.ellipse(px, py, 130, 52, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d9c9a8'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#ffe9b8';
  ctx.font = 'bold 16px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText('🍽️ ASSEMBLY PLATE', px, py - 72);
  if (state.plate.length === 0 && !state.cooked) {
    ctx.fillStyle = '#8a7a6a'; ctx.font = '15px Georgia, serif';
    ctx.fillText('empty — add ingredients', px, py + 4);
  } else {
    const items = state.plate.map((id) => INGREDIENTS.find((i) => i.id === id));
    items.forEach((ing, i) => {
      const ix = px - (items.length - 1) * 34 + i * 68;
      ctx.font = '38px serif';
      ctx.fillText(ing.emoji, ix, py + 12);
    });
    if (state.cooked) {
      ctx.font = 'bold 17px Georgia, serif';
      ctx.fillStyle = state.cooked === 'burnt' ? '#3a3a3a' : state.cooked === 'mystery' ? '#d64545' : '#2fa36b';
      const label = state.cooked === 'burnt' ? '🔥 BURNT! Clear it!' : state.cooked === 'mystery' ? '❓ Mystery Mix' : '✅ ' + state.cooked.name + ' ready!';
      ctx.fillText(label, px, py + 72);
      if (state.cooked !== 'burnt') {
        ctx.fillStyle = '#d64545';
        ctx.font = '13px Georgia, serif';
        ctx.fillText('burns in ' + Math.max(0, Math.ceil(BURN_TIME - state.burnTimer)) + 's', px, py + 92);
      }
    }
  }
  ctx.textAlign = 'left';

  // buttons
  const ready = state.cooked && state.cooked !== 'burnt';
  button(400, 560, 200, 56, state.cooking ? 'COOKING…' : '🔥 COOK  [C]', state.cooking || state.plate.length === 0 || state.cooked ? '#5a4632' : '#e07b39', () => startCook());
  button(630, 560, 220, 56, '🛎️ SERVE  [Space]', ready ? '#2fa36b' : '#5a4632', () => serveDish(), ready);
  button(880, 560, 180, 56, '🗑️ CLEAR  [X]', (state.plate.length || state.cooked) && !state.cooking ? '#7a6a5a' : '#5a4632', () => clearPlate());
  button(1090, 560, 110, 56, state.muted ? '🔇 MUTED' : '🔊 SOUND', '#7a6a5a', () => { state.muted = !state.muted; });

  // (Recipes are shown on each order ticket, so no separate book is needed.)

  // toasts
  state.toasts.forEach((t, i) => {
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t.t - 1.8) / 0.8);
    ctx.font = 'bold 20px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, 640, 668 - i * 26);
    ctx.globalAlpha = 1;
  });
  ctx.textAlign = 'left';
}

function button(x, y, w, h, label, color, action, glow) {
  if (glow) {
    ctx.save();
    ctx.shadowColor = '#7dff9a'; ctx.shadowBlur = 18;
    ctx.fillStyle = color; rr(x, y, w, h, 12); ctx.fill();
    ctx.restore();
  } else {
    ctx.fillStyle = color; rr(x, y, w, h, 12); ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 17px Georgia, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  hits.push({ x, y, w, h, action, label });
}

function drawTitle() {
  drawKitchen();
  ctx.fillStyle = 'rgba(20,10,5,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 84px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText('🔥 WOK HEI! 🔥', 640, 240);
  ctx.fillStyle = '#fff6e0';
  ctx.font = 'bold 30px Georgia, serif';
  ctx.fillText('MIDNIGHT KITCHEN RUSH', 640, 300);
  ctx.font = '19px Georgia, serif'; ctx.fillStyle = '#ffe9b8';
  ctx.fillText('Build dishes from the counter, cook them in the wok,', 640, 360);
  ctx.fillText('and serve the matching order before patience runs out.', 640, 388);
  ctx.fillStyle = '#7dff9a';
  ctx.font = 'bold 24px Georgia, serif';
  const blink = Math.floor(state.time * 2) % 2 === 0;
  if (blink) ctx.fillText('▶  PRESS ENTER OR CLICK TO START  ◀', 640, 460);
  ctx.fillStyle = '#ffe9b8';
  ctx.font = '16px Georgia, serif';
  ctx.fillText('Keys: 1–8 ingredients · C cook · Space serve · X clear · P pause · M mute', 640, 520);
  ctx.fillText('One 3-minute shift. 3 stars at 12 dishes served. Good luck, Chef!', 640, 548);
  ctx.textAlign = 'left';
  hits.push({ x: 0, y: 0, w: W, h: H, action: () => startGame(), label: 'start' });
}

function drawPaused() {
  drawKitchen();
  ctx.fillStyle = 'rgba(20,10,5,0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff6e0';
  ctx.font = 'bold 56px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText('⏸ PAUSED', 640, 330);
  ctx.font = '20px Georgia, serif';
  ctx.fillText('Press P or click to resume', 640, 390);
  ctx.textAlign = 'left';
  hits.push({ x: 0, y: 0, w: W, h: H, action: () => { state.screen = 'playing'; }, label: 'resume' });
}

function drawResults() {
  ctx.fillStyle = '#241610';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 54px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText('🌙 SHIFT OVER!', 640, 130);
  ctx.font = '44px serif';
  ctx.fillText('★'.repeat(state.stars) + '☆'.repeat(3 - state.stars), 640, 200);
  ctx.fillStyle = '#fff6e0';
  ctx.font = 'bold 26px Georgia, serif';
  ctx.fillText('🪙 ' + state.coins.toLocaleString('en-US') + ' coins earned', 640, 270);
  ctx.font = '22px Georgia, serif'; ctx.fillStyle = '#ffe9b8';
  ctx.fillText('🍽️ Dishes served: ' + state.served + '      😤 Orders lost: ' + state.lost, 640, 320);
  ctx.fillText('🔥 Best combo: x' + state.bestCombo + '      ❌ Mistakes: ' + state.mistakes, 640, 356);
  ctx.fillStyle = state.stars === 3 ? '#7dff9a' : '#ffb347';
  ctx.font = 'bold 22px Georgia, serif';
  ctx.fillText(state.stars === 3 ? 'Three stars! You are the Wok Master! 🏆' : state.stars === 2 ? 'Great shift, Chef!' : state.stars === 1 ? 'A decent shift — the wok awaits your comeback.' : 'Rough night… the regulars still believe in you.', 640, 420);
  ctx.fillStyle = '#7dff9a';
  ctx.font = 'bold 22px Georgia, serif';
  if (Math.floor(state.time * 2) % 2 === 0) ctx.fillText('▶  PRESS R TO COOK AGAIN  ◀', 640, 500);
  ctx.textAlign = 'left';
  hits.push({ x: 0, y: 0, w: W, h: H, action: () => startGame(), label: 'restart' });
}

function render() {
  hits = [];
  ctx.clearRect(0, 0, W, H);
  if (state.screen === 'title') drawTitle();
  else if (state.screen === 'paused') drawPaused();
  else if (state.screen === 'over') { drawHeader(); drawResults(); }
  else { drawHeader(); drawKitchen(); drawIngredients(); }
}

// ---- input ----------------------------------------------------------------
function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
}
canvas.addEventListener('click', (e) => {
  const p = toLogical(e);
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) { h.action(); return; }
  }
});
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (state.screen === 'title' && (k === 'enter' || k === ' ')) { startGame(); return; }
  if (state.screen === 'over' && k === 'r') { startGame(); return; }
  if (k === 'p' && (state.screen === 'playing' || state.screen === 'paused')) {
    state.screen = state.screen === 'playing' ? 'paused' : 'playing';
    return;
  }
  if (state.screen !== 'playing') return;
  if (k === ' ') { e.preventDefault(); serveDish(); }
  else if (k === 'c') startCook();
  else if (k === 'x') clearPlate();
  else if (k === 'm') state.muted = !state.muted;
  else {
    const ing = INGREDIENTS.find((i) => i.key === k);
    if (ing) addIngredient(ing.id);
  }
});

// ---- fixed screenshot states ---------------------------------------------
function setupShot(name) {
  state.screen = 'playing';
  state.toasts = [];
  state.combo = 0; state.bestCombo = 0; state.served = 0; state.lost = 0; state.mistakes = 0;
  state.plate = []; state.cooking = null; state.cooked = null; state.burnTimer = 0;
  if (name === 'start') {
    state.screen = 'title';
    state.shiftTime = SHIFT_LEN; state.coins = 0;
    state.orders = [
      { id: 1, dish: DISHES[0], timeLeft: 38, max: ORDER_PATIENCE },
      { id: 2, dish: DISHES[1], timeLeft: 30, max: ORDER_PATIENCE },
    ];
  } else if (name === 'play') {
    state.shiftTime = 151; state.coins = 240; state.combo = 2; state.bestCombo = 2; state.served = 3;
    state.plate = ['rice', 'egg'];
    state.orders = [
      { id: 1, dish: DISHES[0], timeLeft: 32, max: ORDER_PATIENCE },
      { id: 2, dish: DISHES[1], timeLeft: 24, max: ORDER_PATIENCE },
      { id: 3, dish: DISHES[5], timeLeft: 40, max: ORDER_PATIENCE },
    ];
    state.toasts = [{ text: 'Rice + Egg on the plate…', color: '#ffe9b8', t: 0.4 }];
  } else if (name === 'serve') {
    state.shiftTime = 118; state.coins = 480; state.combo = 3; state.bestCombo = 3; state.served = 6;
    state.plate = ['rice', 'egg', 'chili'];
    state.cooked = DISHES[0];
    state.burnTimer = 1.2;
    state.orders = [
      { id: 1, dish: DISHES[0], timeLeft: 26, max: ORDER_PATIENCE },
      { id: 2, dish: DISHES[4], timeLeft: 35, max: ORDER_PATIENCE },
    ];
    state.toasts = [{ text: 'Nasi Goreng is ready — serve it!', color: '#7dff9a', t: 0.4 }];
  } else if (name === 'end') {
    state.screen = 'over';
    state.shiftTime = 0; state.coins = 1480; state.served = 12; state.lost = 1;
    state.bestCombo = 5; state.mistakes = 1; state.stars = 3;
    state.orders = [];
  }
}

// ---- boot ------------------------------------------------------------------
fitCanvas();
if (shotName) {
  setupShot(shotName);
  state.time = 1.2; // freeze the title blink in its "on" phase
  render();
} else {
  let last = performance.now();
  (function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  })(last);
}
