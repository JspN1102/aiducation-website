const media = path => new URL(`../media/${path}`, import.meta.url).href;

const ART = media('exploration/bo-chuan-gua-zhou/scene.webp');
const PIECES = Object.freeze([0, 1, 2, 3, 4, 5]);
const START_ORDER = Object.freeze([4, 1, 5, 0, 3, 2]);
const POEM = '京口瓜洲一水間，鍾山只隔數重山。春風又綠江南岸，明月何時照我還。';
const KNOWLEDGE = '春風讓江南岸重新變綠；明月照着瓜洲的小舟，也照出詩人盼望回家的心情。';
const speech = {
  text: POEM,
  parts: [
    {char: '間', pinyin: 'jiān'},
    {char: '數', pinyin: 'shù'},
    {char: '重', pinyin: 'chóng'},
    {char: '綠', pinyin: 'lǜ'},
    {char: '還', pinyin: 'huán'}
  ]
};

const isPiece = value => Number.isInteger(value) && value >= 0 && value < PIECES.length;
const isSolved = slots => PIECES.every((piece, slot) => slots[slot] === piece);
const backgroundPosition = piece => `${(piece % 3) * 50}% ${Math.floor(piece / 3) * 100}%`;

function restoredState(initialState) {
  const legacyDone = initialState?.gameCompleted === true ||
    (initialState?.version === 2 && initialState?.moon === true);
  if (legacyDone) return {slots: [...PIECES], tray: [], completed: true};

  if (initialState?.version !== 3 || !Array.isArray(initialState.slots)) {
    return {slots: Array(PIECES.length).fill(null), tray: [...START_ORDER], completed: false};
  }

  const seen = new Set();
  const slots = PIECES.map((_, index) => {
    const value = initialState.slots[index];
    if (!isPiece(value) || seen.has(value)) return null;
    seen.add(value);
    return value;
  });
  const remaining = PIECES.filter(piece => !seen.has(piece));
  const requested = Array.isArray(initialState.tray) ? initialState.tray : [];
  const tray = [...new Set(requested.filter(piece => remaining.includes(piece))),
    ...remaining.filter(piece => !requested.includes(piece))];
  return {slots, tray, completed: isSolved(slots)};
}

export function mountRiver(holder, {
  initialState,
  readOnly = false,
  playAudio,
  onState,
  onComplete,
  reducedMotion = false
} = {}) {
  const doc = holder.ownerDocument;
  const view = doc.defaultView;
  const abort = new view.AbortController();
  const restored = restoredState(initialState);
  let slots = restored.slots;
  let tray = restored.tray;
  let completed = restored.completed;
  let solution = false;
  let selected = null;
  let ready = false;
  let dead = false;
  let speaking = false;
  let voiceGeneration = 0;
  let voiceTimer = null;
  let loadGeneration = 0;
  let loadTimer = null;
  let drag = null;
  let suppressClickUntil = 0;
  let reported = initialState?.gameCompleted === true || readOnly;

  const root = doc.createElement('section');
  root.className = 'river-puzzle-game';
  root.setAttribute('aria-label', '拼好春江月夜圖');
  root.innerHTML = `
    <header class="river-puzzle-heading">
      <div><span>泊船瓜洲</span><h3>拼好春江月夜圖</h3></div>
      <b data-river-count aria-live="off"></b>
    </header>
    <div class="river-puzzle-work">
      <div class="river-puzzle-board" data-river-board aria-label="六格春江月夜拼圖" aria-busy="true"></div>
      <div class="river-puzzle-side">
        <p class="river-puzzle-instruction">選一片，再點畫中位置；也可以直接拖過去。</p>
        <div class="river-puzzle-tray" data-river-tray aria-label="待拼畫片"></div>
      </div>
    </div>
    <div class="river-puzzle-actions">
      <button type="button" data-river-audio><span aria-hidden="true">♪</span><span data-river-audio-label>聽一聽古詩</span></button>
      <button type="button" data-river-retry hidden>重新載入畫卷</button>
    </div>
    <p class="river-puzzle-status" data-river-status role="status" aria-live="polite"></p>
    <img class="river-puzzle-preload" src="${ART}" alt="" aria-hidden="true">
  `;
  if (reducedMotion) root.classList.add('is-reduced-motion');
  holder.append(root);

  const q = selector => root.querySelector(selector);
  const board = q('[data-river-board]');
  const trayHolder = q('[data-river-tray]');
  const tell = text => { if (!dead) q('[data-river-status]').textContent = text; };
  const countPlaced = () => slots.filter(isPiece).length;
  const snapshot = () => ({version: 3, slots: [...slots], tray: [...tray], completed});
  const interactive = () => ready && !dead && !readOnly && !completed && !solution;

  function pieceHTML(piece, location) {
    const selectedClass = selected === piece ? ' is-selected' : '';
    const style = `--piece-position:${backgroundPosition(piece)}`;
    if (location === 'tray') {
      return `<button type="button" class="river-puzzle-piece${selectedClass}" data-piece="${piece}" style="${style}" aria-label="第 ${piece + 1} 片畫片" aria-pressed="${selected === piece}" ${interactive() ? '' : 'disabled'}><span aria-hidden="true"></span></button>`;
    }
    return `<span class="river-puzzle-piece is-placed${selectedClass}" data-piece="${piece}" style="${style}" aria-hidden="true"><span></span></span>`;
  }

  function updateAudioState() {
    const button = q('[data-river-audio]');
    const label = q('[data-river-audio-label]');
    if (!button || !label) return;
    button.disabled = speaking || !ready;
    button.setAttribute('aria-busy', String(speaking));
    label.textContent = speaking ? '仔細聽…' : '聽一聽古詩';
  }

  function render() {
    const done = completed || solution;
    root.classList.toggle('is-complete', done);
    root.classList.toggle('is-readonly', readOnly);
    root.classList.toggle('has-selection', selected !== null);
    q('.river-puzzle-heading h3').textContent = done ? '春江月夜圖拼好了' : '拼好春江月夜圖';
    q('[data-river-count]').textContent = done ? '完成' : `${countPlaced()} / ${PIECES.length}`;
    q('[data-river-count]').setAttribute('aria-label', done ? '拼圖完成' : `已放好 ${countPlaced()} 片，共 ${PIECES.length} 片`);
    board.innerHTML = PIECES.map(slot => {
      const piece = slots[slot];
      const occupied = isPiece(piece);
      const label = occupied
        ? `第 ${slot + 1} 格，現在是第 ${piece + 1} 片${selected === piece ? '，已選取' : ''}`
        : `第 ${slot + 1} 個空位`;
      return `<button type="button" class="river-puzzle-slot${occupied ? ' has-piece' : ''}" data-river-slot="${slot}" ${occupied ? `data-piece="${piece}"` : ''} aria-label="${label}" ${interactive() ? '' : 'disabled'}>${occupied ? pieceHTML(piece, 'slot') : `<span class="river-slot-number" aria-hidden="true">${slot + 1}</span>`}</button>`;
    }).join('');
    trayHolder.innerHTML = tray.length
      ? tray.map(piece => pieceHTML(piece, 'tray')).join('')
      : `<span class="river-tray-empty">${done ? '六片都回到畫裏了' : '畫片都放進去了，再看看位置。'}</span>`;
    updateAudioState();
  }

  function notifyCompletion() {
    if (reported || dead || readOnly || solution || !completed) return;
    reported = true;
    onComplete?.({correct: true, response: snapshot(), knowledge: KNOWLEDGE});
  }

  function selectPiece(piece) {
    if (!interactive() || !isPiece(piece)) return;
    selected = selected === piece ? null : piece;
    render();
    tell(selected === null ? '已取消選取。' : `第 ${piece + 1} 片選好了，點一個畫中位置。`);
  }

  function place(piece, targetSlot, {focus = false} = {}) {
    if (!interactive() || !isPiece(piece) || !isPiece(targetSlot)) return;
    const sourceSlot = slots.indexOf(piece);
    if (sourceSlot === targetSlot) {
      selected = null;
      render();
      tell('這一片已經在這裏，可以繼續拼。');
      return;
    }

    const displaced = slots[targetSlot];
    if (sourceSlot >= 0) {
      slots[sourceSlot] = isPiece(displaced) ? displaced : null;
    } else {
      tray = tray.filter(value => value !== piece);
      if (isPiece(displaced)) tray.push(displaced);
    }
    slots[targetSlot] = piece;
    selected = null;
    completed = isSolved(slots);
    render();
    onState?.(snapshot());

    if (completed) {
      tell('拼好了！春風染綠兩岸，明月照着小舟。');
      notifyCompletion();
    } else {
      const correct = piece === targetSlot;
      tell(correct ? '這一片對上了，繼續拼下一片。' : '先放在這裏也可以，畫片可以隨時再移，不會扣分。');
      if (focus) q(`[data-river-slot="${targetSlot}"]`)?.focus({preventScroll: true});
    }
  }

  function clearDrag() {
    if (!drag) return;
    drag.source?.removeEventListener('lostpointercapture', drag.lostCapture);
    drag.source?.classList.remove('is-drag-source');
    drag.ghost?.remove();
    drag = null;
    root.classList.remove('is-dragging');
    board.querySelectorAll('[data-river-slot]').forEach(node => node.classList.remove('is-drop-target'));
  }

  function startPointer(event) {
    const source = event.target.closest?.('[data-piece]');
    if (!source || !interactive() || event.button > 0) return;
    const piece = Number(source.dataset.piece);
    if (!isPiece(piece)) return;
    const lostCapture = lostEvent => {
      if (drag?.id === lostEvent.pointerId) clearDrag();
    };
    drag = {id: event.pointerId, piece, source, x: event.clientX, y: event.clientY, moved: false, ghost: null, lostCapture};
    source.addEventListener('lostpointercapture', lostCapture, {once: true, signal: abort.signal});
    try { source.setPointerCapture(event.pointerId); } catch {}
  }

  function movePointer(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
    if (event.cancelable) event.preventDefault();
    if (!drag.moved) {
      drag.moved = true;
      drag.source.classList.add('is-drag-source');
      drag.ghost = doc.createElement('span');
      drag.ghost.className = 'river-puzzle-ghost';
      drag.ghost.style.setProperty('--piece-position', backgroundPosition(drag.piece));
      root.append(drag.ghost);
      root.classList.add('is-dragging');
    }
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
    const slot = doc.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-river-slot]');
    board.querySelectorAll('[data-river-slot]').forEach(node => node.classList.toggle('is-drop-target', node === slot));
  }

  function finishPointer(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const current = drag;
    if (current.moved) {
      if (event.cancelable) event.preventDefault();
      const slot = doc.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-river-slot]');
      suppressClickUntil = view.performance.now() + 650;
      clearDrag();
      if (slot) place(current.piece, Number(slot.dataset.riverSlot));
      else tell('把畫片放到六格畫面裏，再試一次。');
    } else {
      clearDrag();
    }
  }

  async function listen() {
    if (dead || speaking || !ready) return;
    const generation = ++voiceGeneration;
    speaking = true;
    updateAudioState();
    tell('慢慢聽一遍，拼圖時也可以再聽。');
    let ok = false;
    try {
      ok = await Promise.race([
        Promise.resolve(playAudio?.(speech)),
        new Promise(resolve => { voiceTimer = view.setTimeout(() => resolve(false), 45000); })
      ]);
    } catch {} finally {
      view.clearTimeout(voiceTimer);
      voiceTimer = null;
    }
    if (dead || generation !== voiceGeneration) return;
    speaking = false;
    updateAudioState();
    if (ok === false || ok === undefined) tell('聲音暫時未能播放，拼圖仍然可以繼續。');
  }

  async function load() {
    const generation = ++loadGeneration;
    ready = false;
    root.dataset.assets = 'loading';
    board.setAttribute('aria-busy', 'true');
    q('[data-river-retry]').hidden = true;
    render();
    const image = q('.river-puzzle-preload');
    if (generation > 1) {
      const retryURL = new URL(ART);
      retryURL.searchParams.set('retry', String(generation));
      image.src = retryURL.href;
      root.style.setProperty('--river-art', `url("${retryURL.href}")`);
    }
    try {
      await Promise.race([
        image.decode(),
        new Promise((_, reject) => { loadTimer = view.setTimeout(() => reject(new Error('image-timeout')), 12000); })
      ]);
      if (dead || generation !== loadGeneration) return;
      ready = true;
      root.dataset.assets = 'ready';
      board.setAttribute('aria-busy', 'false');
      render();
      if (completed || solution) {
        tell(solution ? '完整畫面裏有春風吹綠的江岸、停泊的小舟和照鄉心的明月。' : KNOWLEDGE);
        if (completed) view.queueMicrotask(notifyCompletion);
      } else if (readOnly) {
        tell('這次先看看畫面；按小提示就能看到完整拼圖。');
      } else {
        tell('放錯可以再移，不會扣分。');
      }
    } catch {
      if (dead || generation !== loadGeneration) return;
      root.dataset.assets = 'error';
      board.setAttribute('aria-busy', 'false');
      q('[data-river-retry]').hidden = false;
      tell('畫卷暫時未能載入，請再試一次。');
    } finally {
      view.clearTimeout(loadTimer);
      loadTimer = null;
    }
  }

  root.style.setProperty('--river-art', `url("${ART}")`);
  root.addEventListener('pointerdown', startPointer, {signal: abort.signal});
  root.addEventListener('pointermove', movePointer, {signal: abort.signal, passive: false});
  root.addEventListener('pointerup', finishPointer, {signal: abort.signal, passive: false});
  root.addEventListener('pointercancel', event => {
    if (drag?.id === event.pointerId) clearDrag();
  }, {signal: abort.signal});
  root.addEventListener('click', event => {
    if (view.performance.now() < suppressClickUntil) return;
    if (event.target.closest('[data-river-retry]')) { void load(); return; }
    if (event.target.closest('[data-river-audio]')) { void listen(); return; }
    const piece = event.target.closest('[data-piece]');
    const slot = event.target.closest('[data-river-slot]');
    if (slot && selected !== null) place(selected, Number(slot.dataset.riverSlot), {focus: true});
    else if (piece) selectPiece(Number(piece.dataset.piece));
    else if (slot) tell('先在下方選一片畫片，再點這個位置。');
  }, {signal: abort.signal});

  render();
  void load();

  return {
    showSolution() {
      if (dead) return;
      clearDrag();
      voiceGeneration++;
      view.clearTimeout(voiceTimer);
      voiceTimer = null;
      speaking = false;
      solution = true;
      selected = null;
      slots = [...PIECES];
      tray = [];
      render();
      tell('完整畫面裏有春風吹綠的江岸、停泊的小舟和照鄉心的明月。');
    },
    destroy() {
      if (dead) return;
      dead = true;
      loadGeneration++;
      voiceGeneration++;
      view.clearTimeout(voiceTimer);
      view.clearTimeout(loadTimer);
      clearDrag();
      abort.abort();
      root.remove();
    }
  };
}
