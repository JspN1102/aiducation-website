import {imageAsset} from './media-images.mjs?v=20260923-school23';
import {fetchImage} from './image-loader.mjs?v=20260923-school23';
const FONT_NAME = 'PoetryCardSerif';
const fontLoads = new WeakMap();
let nextCardId = 0;
const WIDTH = 1800, HEIGHT = 1440;

function loadFont(document) {
  if (!fontLoads.has(document)) {
    const source = new URL('./vendor/fonts/noto-serif-tc.woff2?v=20260908e', import.meta.url);
    const face = new document.defaultView.FontFace(FONT_NAME, `url("${source.href}")`, {weight: '400 700'});
    const promise = face.load().then(font => {document.fonts.add(font);return font;}).catch(error => {
      fontLoads.delete(document);
      throw error;
    });
    fontLoads.set(document, promise);
  }
  return fontLoads.get(document);
}

/**
 * Opens only when the parent calls it, normally from a completed challenge.
 * No upload, student identity or score enters the image. The parent loads
 * poetry-card.css once. destroy() is safe during loading or PNG encoding.
 */
export function mountPoetryCard(container, {poem, onClose = () => {}} = {}) {
  if (!container?.ownerDocument || !poem || !/^[a-z0-9-]+$/.test(poem.slug || '') ||
      !Array.isArray(poem.lines) || poem.lines.length !== 4 || poem.lines.some(line => !line?.text)) {
    throw new TypeError('A container and a four-line poem are required.');
  }
  const doc = container.ownerDocument, view = doc.defaultView;
  const events = new view.AbortController();
  const id = `poetry-card-${++nextCardId}`;
  const title = poem.id === 5 ? '歸園田居·其三' : poem.title;
  const author = `${poem.dynasty} · ${poem.author}`;
  const lines = poem.lines.map(line => String(line.text) + (line.punctuation || ''));
  const returnFocus = doc.activeElement;
  let dead = false, busy = false, ready = false, selected = 0, generation = 0;
  let pending = null, picture = null, imageURL = null, exportURL = null;
  let pendingTimer = null, timedOut = false, notified = false;

  const dialog = doc.createElement('dialog');
  dialog.className = 'poetry-card-dialog';
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.innerHTML = `<div class="poetry-card-sheet">
    <header class="poetry-card-header"><div><p>把喜歡的一句，留在畫裏</p><h2 id="${id}-title">我的詩意明信片</h2></div><button type="button" class="poetry-card-close" data-card-action="close" aria-label="關閉明信片">×</button></header>
    <div class="poetry-card-preview" aria-busy="true"><canvas width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="正在準備明信片"></canvas><p class="poetry-card-loading">正在鋪好畫紙…</p></div>
    <fieldset class="poetry-card-choices"><legend>選一句你喜歡的詩</legend><div class="poetry-card-choice-grid"></div></fieldset>
    <p class="poetry-card-status" role="status" aria-live="polite"></p>
    <div class="poetry-card-actions"><button type="button" data-card-action="retry" hidden>重新準備</button><button type="button" class="poetry-card-save" data-card-action="save" disabled>保存明信片</button><a class="poetry-card-open" hidden target="_blank" rel="noopener">開啟圖片保存</a></div>
  </div>`;
  container.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const canvas = $('canvas'), context = canvas.getContext('2d');
  if (!context) {dialog.remove();throw new Error('Canvas is unavailable.');}
  const status = $('.poetry-card-status'), preview = $('.poetry-card-preview');
  const saveButton = $('[data-card-action="save"]'), openLink = $('.poetry-card-open');
  const choices = $('.poetry-card-choice-grid');
  for (const [index, text] of lines.entries()) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset.cardAction = 'line';
    button.dataset.line = String(index);
    button.setAttribute('aria-pressed', String(index === selected));
    const clauses = text.match(/[^，。！？；]+[，。！？；]?/g) || [text];
    if (clauses.length > 1) {
      for (const clause of clauses) {
        const span = doc.createElement('span');
        span.className = 'poetry-card-clause';span.textContent = clause;button.append(span);
      }
    } else button.textContent = text;
    choices.append(button);
  }

  function revokeExport() {
    if (exportURL) view.URL.revokeObjectURL(exportURL);
    exportURL = null;
    openLink.removeAttribute('href');
    openLink.hidden = true;
  }

  function syncControls() {
    saveButton.disabled = !ready || busy;
    saveButton.textContent = busy ? '正在保存…' : '保存明信片';
    choices.querySelectorAll('button').forEach(button => {
      button.disabled = busy;
      button.setAttribute('aria-pressed', String(Number(button.dataset.line) === selected));
    });
  }

  function fittedText(text, x, y, size, maxWidth, color, align = 'left') {
    context.textAlign = align;
    context.textBaseline = 'alphabetic';
    context.fillStyle = color;
    let fontSize = size;
    context.font = `500 ${fontSize}px "${FONT_NAME}"`;
    while (context.measureText(text).width > maxWidth && fontSize > 24) {
      fontSize -= 1;
      context.font = `500 ${fontSize}px "${FONT_NAME}"`;
    }
    context.fillText(text, x, y);
  }

  function draw() {
    if (dead || !ready || !picture) return;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = '#fcf8ec';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    // Deterministic paper fibres: restrained texture without random badges.
    context.strokeStyle = 'rgba(145, 125, 81, .045)';
    context.lineWidth = 1;
    for (let y = 13; y < HEIGHT; y += 17) {
      context.beginPath();context.moveTo(0, y);context.lineTo(WIDTH, y + 9);context.stroke();
    }
    const x = 84, y = 72, width = 1632, height = 918;
    context.fillStyle = '#eeeadf';context.fillRect(x, y, width, height);
    // Contain rather than crop: preserve the full final painting in every poem.
    const ratio = Math.min(width / picture.naturalWidth, height / picture.naturalHeight);
    const drawWidth = picture.naturalWidth * ratio, drawHeight = picture.naturalHeight * ratio;
    context.drawImage(picture, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    context.strokeStyle = '#d9d1bb';context.lineWidth = 2;context.strokeRect(x - 1, y - 1, width + 2, height + 2);
    fittedText(title, 84, 1080, 62, 1120, '#235246');
    fittedText(author, WIDTH - 84, 1076, 30, 435, '#677a67', 'right');
    const clauses = lines[selected].match(/[^，。！？；]+[，。！？；]?/g) || [lines[selected]];
    const rows = clauses.length > 1 ? clauses : [lines[selected]];
    rows.forEach((text, index) => fittedText(text, WIDTH / 2, rows.length === 1 ? 1204 : 1167 + index * 76, 65, 1512, '#254b3f', 'center'));
    context.strokeStyle = '#b0bfa4';context.lineWidth = 2;context.beginPath();context.moveTo(710, 1300);context.lineTo(1090, 1300);context.stroke();
    fittedText('我把這首詩讀成了一幅畫', WIDTH / 2, 1360, 30, 1300, '#6a7d64', 'center');
    canvas.setAttribute('aria-label', `明信片預覽：《${title}》，${author}。${lines[selected]}`);
  }

  async function prepare() {
    if (dead) return;
    const current = ++generation;
    pending?.abort();
    clearTimeout(pendingTimer);
    pending = new view.AbortController();
    const request = pending;
    timedOut = false;ready = false;busy = false;
    revokeExport();
    if (imageURL) view.URL.revokeObjectURL(imageURL);
    imageURL = null;picture = null;
    preview.setAttribute('aria-busy', 'true');
    $('.poetry-card-loading').hidden = false;
    $('.poetry-card-loading').textContent = '正在鋪好畫紙…';
    $('[data-card-action="retry"]').hidden = true;
    status.textContent = '';
    syncControls();
    const timeout = new Promise((_, reject) => {
      pendingTimer = view.setTimeout(() => {timedOut = true;request.abort();reject(new Error('Artwork loading timed out.'));}, 18000);
    });
    try {
      const artwork = (async () => {
        const imageSource = new URL(imageAsset(`media/${poem.slug}/cover-final.webp`), import.meta.url);
        const [blob] = await Promise.all([
          fetchImage(imageSource.href, {signal: request.signal, fetchImpl: (url, init) => view.fetch(url, init)}),
          loadFont(doc)
        ]);
        if (dead || current !== generation || timedOut) throw new Error('Artwork was cancelled.');
        imageURL = view.URL.createObjectURL(blob);
        const decoded = new view.Image();
        decoded.decoding = 'async';
        await new Promise((resolve, reject) => {
          decoded.onload = resolve;decoded.onerror = reject;decoded.src = imageURL;
        });
        await decoded.decode?.();
        if (!decoded.naturalWidth) throw new Error('Painting has no pixels.');
        return decoded;
      })();
      const decoded = await Promise.race([artwork, timeout]);
      if (dead || current !== generation) return;
      picture = decoded;ready = true;
      draw();
      $('.poetry-card-loading').hidden = true;
      preview.setAttribute('aria-busy', 'false');
      status.textContent = '選好一句，就可以把明信片帶走。';
    } catch {
      if (dead || current !== generation) return;
      $('.poetry-card-loading').textContent = '畫紙還未準備好';
      preview.setAttribute('aria-busy', 'false');
      status.textContent = '圖片或字體暫時未能載入，請再試一次。';
      $('[data-card-action="retry"]').hidden = false;
    } finally {
      if (!dead && current === generation) {
        clearTimeout(pendingTimer);pendingTimer = null;pending = null;
        syncControls();
      }
    }
  }

  async function saveImage() {
    if (dead || !ready || busy) return;
    busy = true;const current = generation;
    status.textContent = '正在整理你的明信片…';syncControls();
    try {
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed.')), 'image/png'));
      if (dead || current !== generation) return;
      revokeExport();exportURL = view.URL.createObjectURL(blob);
      openLink.href = exportURL;openLink.hidden = false;
      const link = doc.createElement('a');
      link.href = exportURL;
      link.download = `${title}-詩意明信片.png`;
      dialog.append(link);
      try {link.click();} finally {link.remove();}
      status.textContent = '已準備保存。若沒有開始下載，按「開啟圖片保存」，再長按圖片。';
    } catch {
      if (!dead && current === generation) {
        status.textContent = '這次未能保存，請再按一次「保存明信片」。';
      }
    } finally {
      if (!dead && current === generation) {busy = false;syncControls();}
    }
  }

  function destroy() {
    if (dead) return;
    dead = true;generation += 1;
    pending?.abort();pending = null;
    clearTimeout(pendingTimer);pendingTimer = null;
    events.abort();
    revokeExport();
    if (imageURL) view.URL.revokeObjectURL(imageURL);
    imageURL = null;picture = null;
    if (dialog.open) dialog.close();
    dialog.remove();
  }

  function close() {
    if (dead) return;
    destroy();
    if (returnFocus?.isConnected) returnFocus.focus({preventScroll: true});
    if (!notified) {notified = true;onClose();}
  }

  dialog.addEventListener('click', event => {
    const button = event.target.closest?.('[data-card-action]');
    if (!button || button.disabled) return;
    if (button.dataset.cardAction === 'close') close();
    if (button.dataset.cardAction === 'retry') void prepare();
    if (button.dataset.cardAction === 'save') void saveImage();
    if (button.dataset.cardAction === 'line') {
      const next = Number(button.dataset.line);
      if (!Number.isInteger(next) || next < 0 || next >= lines.length || next === selected) return;
      selected = next;revokeExport();syncControls();draw();
      if (ready) status.textContent = '這一句已放進明信片。';
    }
  }, {signal: events.signal});
  dialog.addEventListener('cancel', event => {event.preventDefault();close();}, {signal: events.signal});
  dialog.addEventListener('close', close, {signal: events.signal});
  try {dialog.showModal();} catch (error) {destroy();throw error;}
  void prepare();
  return {destroy};
}
