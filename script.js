// ========= UI refs =========
const UI = {
  play: document.getElementById('play'),
  score: document.getElementById('score'),
  timeFill: document.getElementById('timeFill'),
  cleanFill: document.getElementById('cleanFill'),
  dirtyFill: document.getElementById('dirtyFill'),
  cleanPct: document.getElementById('cleanPct'),
  dirtyPct: document.getElementById('dirtyPct'),
  can: document.getElementById('canWrap'),
  canEl: document.getElementById('can'),
  qualityBar: document.getElementById('qualityBar'),
  scoreCenter: document.getElementById('scoreCenter'),
  start: document.getElementById('start'),
  backdrop: document.getElementById('backdrop'),
  peopleNum: document.getElementById('peopleNum'),
  btnStart: document.getElementById('btnStart'),
  btnReplay: document.getElementById('btnReplay'),
  btnMenu: document.getElementById('btnMenu'),
  btnReset: document.getElementById('btnReset'),
  boostBadge: document.getElementById('boostBadge'),
  toast: document.getElementById('toast'),
};

// ========= Difficulty presets =========
const DIFF = {
  easy:   { duration: 35, spawn: 650, cleanChance: 0.70, obstacleChance: 0.10, minSpawn: 260, speedStep: 0.12 },
  normal: { duration: 30, spawn: 600, cleanChance: 0.65, obstacleChance: 0.15, minSpawn: 250, speedStep: 0.15 },
  hard:   { duration: 25, spawn: 520, cleanChance: 0.58, obstacleChance: 0.20, minSpawn: 220, speedStep: 0.18 },
};

// active config (set at start)
let CFG = { ...DIFF.normal };

// ========= Game state =========
const state = {
  time: CFG.duration,
  score: 0,
  pollution: 0,
  clean: 0,
  dirty: 0,
  tick: null,
  spawner: null,
  running: false,
  speedMul: 1,
  currentSpawn: CFG.spawn,
  difficulty: 'normal',
  villages: 0, // 10점당 1마을
};

// ========= SFX =========
const SETTINGS = { sfxEnabled: true };

function loadAudio(path, volume = 0.6){
  const a = new Audio(path);
  a.preload = 'auto';
  a.volume = volume;
  return a;
}

// 파일명 확정: clean-boing.wav / dirty-leak.wav / obstacle-beep.mp3
const SFX = {
  clean:    loadAudio('sound/clean-boing.wav',   0.55), // 깨끗한 물: 또잉
  dirty:    loadAudio('sound/dirty-leak.wav',    0.60), // 더러운 물: 물 새는 소리
  obstacle: loadAudio('sound/obstacle-beep.mp3', 0.60), // 빨간 물: 삐—
};

// SFX 에러 로깅
Object.entries(SFX).forEach(([key, aud])=>{
  if (!aud) return;
  aud.addEventListener('error', ()=>{
    console.error(`[SFX] load error for "${key}":`, aud.src, aud.error || '(no detail)');
  });
});

function playSfx(aud){
  if(!SETTINGS.sfxEnabled || !aud) return;
  try {
    aud.currentTime = 0;
    const p = aud.play();
    if (p && typeof p.then === 'function') {
      p.catch(err=>{
        console.warn('[SFX] play blocked/rejected:', aud.src, err?.name || err);
      });
    }
  } catch(e) {
    console.warn('[SFX] play exception:', e);
  }
}

// 사용자 제스처 이후 오디오 unlock (iOS/Safari 대응 강화: 여러 이벤트에 1회 바인딩)
function primeAudioOnce(){
  const audios = Object.values(SFX).filter(Boolean);
  audios.forEach(a=>{
    a.muted = true;
    a.play().then(()=>{
      a.pause();
      a.currentTime = 0;
      a.muted = false;
    }).catch(()=>{ /* 첫 시도 실패해도 이후 상호작용에서 재시도됨 */ });
  });
}

// ========= Toast / Milestone =========
function showToast(message, ms=1600){
  if(!UI.toast) return;
  UI.toast.textContent = message;
  UI.toast.classList.add('show');
  setTimeout(()=> UI.toast.classList.remove('show'), ms);
}

// 점수 10점마다 village 1 증가 → 토스트
function checkVillageMilestone(){
  const newVillages = Math.floor(state.score / 10);
  if (newVillages > state.villages){
    const gained = newVillages - state.villages;
    state.villages = newVillages;
    for(let i=0;i<gained;i++){
      const n = state.villages - (gained - 1 - i);
      const label = (n === 1) ? '1 village' : `${n} villages`;
      showToast(`Clean water delivered to ${label}! 💛`);
    }
  }
}

// ========= Core HUD/Loop =========
function updateHUD(){
  UI.timeFill.style.width = (state.time / CFG.duration * 100) + '%';

  const total = state.clean + state.dirty;
  const cPct = total > 0 ? Math.round((state.clean / total) * 100) : 0;
  const dPct = total > 0 ? 100 - cPct : 0;
  UI.cleanFill.style.width = cPct + '%';
  UI.dirtyFill.style.width = dPct + '%';
  UI.cleanPct.textContent = cPct + '%';
  UI.dirtyPct.textContent = dPct + '%';

  UI.score.textContent = state.score;
}

function clearTimers(){
  if (state.tick)    { clearInterval(state.tick);    state.tick = null; }
  if (state.spawner) { clearInterval(state.spawner); state.spawner = null; }
}

function resetState(){
  state.time = CFG.duration;
  state.score = 0;
  state.pollution = 0;
  state.clean = 0;
  state.dirty = 0;
  state.running = false;
  state.speedMul = 1;
  state.currentSpawn = CFG.spawn;
  state.villages = 0;
  UI.play.innerHTML = '';
  updateHUD();
}

function applyDifficulty(){
  const chosen = document.querySelector('input[name="difficulty"]:checked')?.value || 'normal';
  state.difficulty = chosen;
  CFG = { ...DIFF[chosen] };
}

function start(){
  clearTimers();
  state.running = true;
  updateHUD();

  state.tick = setInterval(()=>{
    state.time--;
    updateHUD();
    if(state.time <= 0){ endRound(true); } // time survived = win
  }, 1000);

  state.spawner = setInterval(spawn, state.currentSpawn);
}

function endRound(isWin=false){
  clearTimers();
  state.running = false;

  [...UI.play.querySelectorAll('.drop')].forEach(d=>{
    d.style.animationPlayState = 'paused';
  });

  if (isWin) burstConfetti();

  UI.peopleNum.textContent = `${Math.max(0, state.score)} People!`;
  UI.backdrop.style.display = 'flex';
}

function resetAndStart(){
  resetState();
  UI.backdrop.style.display = 'none';
  start();
}

function showStart(){
  clearTimers();
  resetState();
  UI.backdrop.style.display = 'none';
  UI.start.style.display = 'flex';
}

function hideStart(){
  UI.start.style.display = 'none';
}

// ========= Spawner / Collision =========
function spawn(){
  const el = document.createElement('i');

  // decide type
  const r = Math.random();
  let type = 'clean';
  if (r < CFG.obstacleChance) type = 'obstacle';
  else type = (Math.random() < CFG.cleanChance) ? 'clean' : 'dirty';

  el.className = `drop ${type}`;
  el.dataset.type = type;

  const size = 28 + Math.round(Math.random() * 22);
  el.style.width = el.style.height = size + 'px';
  el.style.left = Math.round(Math.random() * (UI.play.clientWidth - size)) + 'px';
  el.style.setProperty('--h', size + 'px');

  const base = 1.2 + Math.random() * 1.2;
  const dur = Math.max(0.5, base / state.speedMul);
  el.style.animation = `fall ${dur}s linear forwards`;

  el.addEventListener('animationend', ()=> checkCollision(el));
  UI.play.appendChild(el);
}

function checkCollision(drop){
  const dropRect = drop.getBoundingClientRect();
  const canRect  = UI.can.getBoundingClientRect();

  if(
    dropRect.bottom >= canRect.top &&
    dropRect.left   <  canRect.right &&
    dropRect.right  >  canRect.left
  ){
    if (drop.dataset.type === 'clean') {
      state.score++;
      state.clean = Math.min(100, state.clean + 10);
      UI.canEl.classList.add('hit');
      UI.scoreCenter.classList.add('pop');
      setTimeout(()=>{
        UI.canEl.classList.remove('hit');
        UI.scoreCenter.classList.remove('pop');
      }, 500);

      // SFX + 마일스톤
      playSfx(SFX.clean);
      checkVillageMilestone();

    } else if (drop.dataset.type === 'dirty') {
      state.score = Math.max(0, state.score - 1);
      state.pollution = Math.min(100, state.pollution + 10);
      state.dirty = Math.min(100, state.dirty + 10);
      UI.qualityBar.classList.add('shake','flash');
      setTimeout(()=>{ UI.qualityBar.classList.remove('shake','flash'); }, 520);

      playSfx(SFX.dirty);

    } else if (drop.dataset.type === 'obstacle') {
      // obstacle: speed up + score penalty
      state.score = Math.max(0, state.score - 2);
      state.speedMul = +(state.speedMul + CFG.speedStep).toFixed(2);
      state.currentSpawn = Math.max(CFG.minSpawn, state.currentSpawn - 80);

      if (state.spawner) { clearInterval(state.spawner); }
      state.spawner = setInterval(spawn, state.currentSpawn);

      if (UI.boostBadge){
        UI.boostBadge.style.display = 'block';
        setTimeout(()=>{ UI.boostBadge.style.display = 'none'; }, 750);
      }

      UI.qualityBar.classList.add('flash','shake');
      setTimeout(()=>{ UI.qualityBar.classList.remove('flash','shake'); }, 520);

      playSfx(SFX.obstacle);
    }

    updateHUD();
  }

  drop.remove();
  if(state.pollution >= 100){ endRound(false); } // lose if pollution 100
}

// ========= Drag can left-right =========
let isDragging = false;
UI.can.addEventListener('pointerdown', ()=>{ isDragging = true; });
document.addEventListener('pointerup',   ()=>{ isDragging = false; });
document.addEventListener('pointermove', (e)=>{
  if(isDragging && state.running){
    const phoneRect = document.querySelector('.phone').getBoundingClientRect();
    const playRect  = UI.play.getBoundingClientRect();
    const canWidth  = UI.can.offsetWidth || 120;

    let x = e.clientX - phoneRect.left - canWidth/2;
    const minX = (playRect.left - phoneRect.left);
    const maxX = (playRect.right - phoneRect.left) - canWidth;
    x = Math.max(minX, Math.min(maxX, x));

    UI.can.style.left = x + 'px';
    UI.can.style.right = 'auto';
    UI.can.style.position = 'absolute';
  }
});

// ========= Simple emoji confetti =========
function burstConfetti(){
  const emojis = ['🎉','✨','💛','💧','🎊'];
  const N = 36;
  for(let i=0;i<N;i++){
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = emojis[i % emojis.length];
    s.style.left = Math.random()*92 + 'vw';
    s.style.animationDuration = (900 + Math.random()*700) + 'ms';
    s.style.fontSize = (16 + Math.random()*16) + 'px';
    document.body.appendChild(s);
    s.addEventListener('animationend', ()=> s.remove());
  }
}

// ========= Buttons =========

// 오디오 언락: Start 버튼에 다양한 제스처로 1회만 바인딩
if (UI.btnStart) {
  ['pointerdown','touchstart','mousedown','click'].forEach(ev=>{
    UI.btnStart.addEventListener(ev, primeAudioOnce, { once: true });
  });
}

// 실제 게임 시작은 click 한 번만!
UI.btnStart  && UI.btnStart.addEventListener('click', ()=>{
  applyDifficulty();
  hideStart();
  resetAndStart();
});

UI.btnReplay && UI.btnReplay.addEventListener('click', resetAndStart);
UI.btnMenu   && UI.btnMenu.addEventListener('click', showStart);
UI.btnReset  && UI.btnReset.addEventListener('click', resetAndStart);

// ========= First load =========
showStart();
