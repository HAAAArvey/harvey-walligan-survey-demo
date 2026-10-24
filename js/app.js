import {
  PROJECT,
  LAYERS,
  PHOTOS,
  ROOMS,
  ROUTE,
  IMPORT_THUMBS,
  STEPS,
  LAYER_BY_ID,
} from './data.js';

const app = document.getElementById('app');
const stepper = document.getElementById('stepper');
const toast = document.getElementById('toast');
const modal = document.getElementById('modal');
const helpBtn = document.getElementById('helpBtn');

const state = {
  screen: 'import',
  source: PROJECT.source,
  index: 0,
  decisions: new Map(),
  hiddenLayers: new Set(),
  pendingPhotoId: null,
  pendingLayer: null,
  maxStep: 1,
  exportFormat: 'word',
  timers: [],
  raf: null,
  toastTimer: null,
};

const ROUTES = ['import', 'processing', 'review', 'report'];

const BRAND_MARK_SVG = `<svg viewBox="0 0 32 32"><rect x="3.5" y="3.5" width="25" height="25" rx="2.2"/><path d="M10.5 9.5v13M21.5 9.5v13M10.5 16h11"/><circle cx="25.8" cy="25.8" r="1.7" class="mark-dot"/></svg>`;

/* ------------------------------------------------------------------
   Utilities
   ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function later(fn, ms) {
  const id = window.setTimeout(fn, ms);
  state.timers.push(id);
  return id;
}

function clearTimers() {
  state.timers.forEach((id) => window.clearTimeout(id));
  state.timers = [];
  if (state.raf) {
    cancelAnimationFrame(state.raf);
    state.raf = null;
  }
}

function showToast(message, icon = 'check') {
  const iconId =
    icon === 'check'
      ? 'check-circle'
      : icon === 'info'
        ? 'info'
        : icon === 'word'
          ? 'word'
          : icon === 'pdf'
            ? 'pdf'
            : icon === 'plan'
              ? 'plan'
              : 'check-circle';
  toast.innerHTML = `<svg class="ic"><use href="#i-${iconId}"/></svg><span>${escapeHtml(message)}</span>`;
  toast.classList.add('is-visible');
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3000);
}

function openModal() {
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  const closeButton = modal.querySelector('button[data-close-modal]');
  if (closeButton) closeButton.focus();
}

function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = '';
}

function currentPhoto() {
  return PHOTOS[state.index];
}

function selectedLayerFor(photo) {
  if (!photo) return null;
  if (state.pendingPhotoId === photo.id && state.pendingLayer) return state.pendingLayer;
  const decision = state.decisions.get(photo.id);
  return decision?.layer || photo.layer;
}

function keptPhotos() {
  return PHOTOS.filter((photo) => state.decisions.get(photo.id)?.status === 'kept');
}

function layerCounts() {
  const counts = Object.fromEntries(LAYERS.map((layer) => [layer.id, 0]));
  for (const photo of keptPhotos()) {
    const decision = state.decisions.get(photo.id);
    if (decision?.layer && counts[decision.layer] != null) counts[decision.layer] += 1;
  }
  return counts;
}

function aiLayerCounts() {
  const counts = Object.fromEntries(LAYERS.map((layer) => [layer.id, 0]));
  for (const photo of PHOTOS) {
    if (counts[photo.layer] != null) counts[photo.layer] += 1;
  }
  return counts;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ------------------------------------------------------------------
   Router + stepper
   ------------------------------------------------------------------ */

function routeFromHash() {
  const route = location.hash.replace(/^#\/?/, '').trim();
  return ROUTES.includes(route) ? route : 'import';
}

function go(screen) {
  const hash = `#/${screen}`;
  if (location.hash === hash) {
    state.screen = screen;
    render();
  } else {
    location.hash = hash;
  }
}

function render() {
  clearTimers();
  state.screen = routeFromHash();
  const step = STEPS.find((item) => item.id === state.screen);
  if (step) state.maxStep = Math.max(state.maxStep, step.index);

  const burst = document.getElementById('burst');
  if (burst && state.screen !== 'import') burst.remove();

  renderStepper();
  app.classList.remove('screen');
  void app.offsetWidth;
  app.classList.add('screen');

  if (state.screen === 'import') renderImport();
  else if (state.screen === 'processing') renderProcessing();
  else if (state.screen === 'review') renderReview();
  else renderReport();

  app.focus({ preventScroll: true });
}

function renderStepper() {
  const activeIndex = STEPS.find((step) => step.id === state.screen)?.index || 1;
  stepper.innerHTML = STEPS.map((step, i) => {
    const active = step.id === state.screen;
    const done = step.index < activeIndex;
    const enabled = step.index <= state.maxStep;
    return `<button class="step ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}" type="button" data-step="${step.id}" ${enabled ? '' : 'disabled'} aria-current="${active ? 'step' : 'false'}">
      <span class="step-num">${done ? '<svg class="ic" style="width:10px;height:10px"><use href="#i-check"/></svg>' : step.index}</span>
      <span class="step-label">${step.label}</span>
    </button>${i < STEPS.length - 1 ? '<span class="step-line" aria-hidden="true"></span>' : ''}`;
  }).join('');

  stepper.querySelectorAll('[data-step]').forEach((button) => {
    button.addEventListener('click', () => {
      const step = STEPS.find((item) => item.id === button.dataset.step);
      if (step && step.index <= state.maxStep) go(step.id);
    });
  });
}

/* ------------------------------------------------------------------
   Import
   ------------------------------------------------------------------ */

function renderImport() {
  const source = PROJECT.sources[state.source];

  app.innerHTML = `
    <section class="import-screen">
      <div class="import-grid">
        <div class="import-copy">
          <div class="eyebrow">360° condition survey</div>
          <h1 class="display h1">Drop the site folder.<br><em>We'll do the rest.</em></h1>
          <p class="lede">Harvey &amp; Walligan indexes every 360° frame, matches the capture to the floor plan, and prepares a photo-by-photo review. Your surveyor keeps the final call.</p>
          <div class="import-stats">
            <div class="stat"><strong>${PROJECT.photoCount}</strong><span>360° photos</span></div>
            <div class="stat"><strong>${PROJECT.roomCount}</strong><span>rooms</span></div>
            <div class="stat"><strong>${PHOTOS.length}</strong><span>AI candidates</span></div>
            <div class="stat"><strong>1</strong><span>floor plan</span></div>
          </div>
          <div class="workflow-note">
            <span class="dot-row" aria-hidden="true"><i></i><i></i><i></i></span>
            <span>Works with the storage your team already uses. <strong>Nothing leaves the browser.</strong></span>
          </div>
        </div>

        <div class="import-card">
          <div class="source-tabs" role="tablist" aria-label="Photo source">
            ${Object.entries(PROJECT.sources)
              .map(
                ([key, item]) => `<button class="source-tab ${key === state.source ? 'is-active' : ''}" type="button" data-source="${key}" role="tab" aria-selected="${key === state.source}">
                  <svg class="ic"><use href="#i-${item.icon}"/></svg><span>${item.label}</span>
                </button>`,
              )
              .join('')}
          </div>

          <div class="source-path">
            <svg class="ic"><use href="#i-${source.icon}"/></svg>
            <code id="sourcePath" title="${escapeHtml(source.path)}">${escapeHtml(source.path)}</code>
            <span class="source-note">${source.note}</span>
          </div>

          <div class="folder-stage">
            <div class="folder" id="folder" role="button" tabindex="0" aria-label="Import the site folder">
              <div class="folder-back"></div>
              <div class="folder-tab"></div>
              <div class="folder-photos">
                ${IMPORT_THUMBS.slice(0, 3).map((src) => `<img src="${src}" alt="">`).join('')}
              </div>
              <div class="folder-front">
                <span class="folder-count">${PROJECT.photoCount}</span>
                <span class="folder-count-label">photos</span>
              </div>
            </div>
          </div>

          <div class="folder-meta">
            <div>
              <div class="folder-project">${PROJECT.client} · ${PROJECT.block}</div>
              <div class="folder-sub">${PROJECT.floor} · ${PROJECT.roomCount} rooms</div>
            </div>
            <span class="ready-pill"><svg class="ic"><use href="#i-check"/></svg> Folder ready</span>
          </div>

          <button class="btn btn-primary btn-lg btn-block" id="importBtn" type="button">Import folder <svg class="ic"><use href="#i-arrow-right"/></svg></button>
          <button class="text-btn import-skip" id="skipToReview" type="button">Preview the review instead →</button>
        </div>
      </div>

      <div class="import-steps">
        <div class="import-step"><span class="step-index">01</span><div><strong>Import the folder</strong><span>${PROJECT.photoCount} photos · ${PROJECT.roomCount} rooms · 1 plan</span></div></div>
        <div class="import-step"><span class="step-index">02</span><div><strong>AI pass</strong><span>Index, match, detect, frame</span></div></div>
        <div class="import-step"><span class="step-index">03</span><div><strong>Review &amp; report</strong><span>One photo at a time. Export to Word.</span></div></div>
      </div>

      <div class="import-foot">
        <span><strong>Harvey and Walligan</strong> · 360° survey demo</span>
        <span>${source.label} · ${PROJECT.photoCount} photos · ${PROJECT.roomCount} rooms</span>
      </div>
    </section>`;

  app.querySelectorAll('[data-source]').forEach((button) => {
    button.addEventListener('click', () => {
      state.source = button.dataset.source;
      renderImport();
    });
  });

  const importBtn = document.getElementById('importBtn');
  const folder = document.getElementById('folder');
  importBtn.addEventListener('click', startImportBurst);
  folder.addEventListener('click', startImportBurst);
  folder.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      startImportBurst();
    }
  });

  document.getElementById('skipToReview').addEventListener('click', () => {
    state.maxStep = Math.max(state.maxStep, 3);
    go('review');
  });
}

function startImportBurst() {
  if (document.getElementById('burst')) return;
  const folder = document.getElementById('folder');
  const rect = folder.getBoundingClientRect();
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;
  const items = [...IMPORT_THUMBS, null];

  const burst = document.createElement('div');
  burst.className = 'burst';
  burst.id = 'burst';
  burst.innerHTML = `
    <div class="burst-inner">
      <div class="burst-head">
        <div>
          <div class="eyebrow">Import</div>
          <div class="burst-title">${PROJECT.client} · ${PROJECT.floor}</div>
        </div>
        <span class="live-pill"><span class="live-dot"></span> Reading folder</span>
      </div>
      <div class="burst-grid">
        ${items
          .map((src, i) =>
            src
              ? `<div class="burst-item" data-i="${i}"><img src="${src}" alt=""></div>`
              : `<div class="burst-item is-count" data-i="${i}"><strong>${PROJECT.photoCount}</strong><span>photos</span></div>`,
          )
          .join('')}
      </div>
      <div class="burst-foot">
        <span><strong>${PROJECT.photoCount} photos</strong> · ${PROJECT.roomCount} rooms · 1 floor plan</span>
        <span>${PROJECT.sources[state.source].label}</span>
      </div>
    </div>`;
  document.body.appendChild(burst);

  const nodes = [...burst.querySelectorAll('.burst-item')];
  requestAnimationFrame(() => {
    nodes.forEach((node, i) => {
      const nodeRect = node.getBoundingClientRect();
      const dx = originX - (nodeRect.left + nodeRect.width / 2);
      const dy = originY - (nodeRect.top + nodeRect.height / 2);
      node.style.transition = 'none';
      node.style.transform = `translate(${dx}px, ${dy}px) scale(0.18) rotate(${i % 2 ? 1 : -1}deg)`;
      node.style.opacity = '0';
    });
    requestAnimationFrame(() => {
      nodes.forEach((node, i) => {
        node.style.transition = '';
        node.style.transitionDelay = `${i * 42}ms`;
        node.style.transform = 'translate(0, 0) scale(1) rotate(0deg)';
        node.style.opacity = '1';
      });
    });
  });

  later(() => {
    burst.classList.add('is-leaving');
    later(() => {
      burst.remove();
      state.maxStep = Math.max(state.maxStep, 2);
      go('processing');
    }, 260);
  }, 1250);
}

/* ------------------------------------------------------------------
   AI pass
   ------------------------------------------------------------------ */

function renderProcessing() {
  const background = [...IMPORT_THUMBS, ...IMPORT_THUMBS].slice(0, 24);
  app.innerHTML = `
    <section class="processing-screen">
      <div class="processing-bg" aria-hidden="true">${background.map((src) => `<img src="${src}" alt="">`).join('')}</div>
      <div class="processing-card" id="processingCard">
        <div class="processing-head">
          <div>
            <div class="eyebrow">AI pass</div>
            <h1 class="display h2">Reading the capture.</h1>
          </div>
          <span class="live-pill"><span class="live-dot"></span> Live</span>
        </div>

        <div class="processing-count"><strong id="procCount">0</strong><span>/ ${PROJECT.photoCount} photos</span></div>
        <div class="processing-bar"><span id="procBar" style="width:0%"></span></div>
        <div class="processing-file" id="procFile">Opening folder · ${escapeHtml(PROJECT.sources[state.source].path)}</div>

        <div class="processing-stages">
          ${[
            ['Indexing 360° frames', '128 frames · 6 rooms'],
            ['Matching rooms to the floor plan', 'Plan A-102 · Rev C'],
            ['Detecting defect candidates', 'Vision + tapping events'],
            ['Building the review framework', '8 candidates · 4 layers'],
          ]
            .map(
              ([name, detail], i) => `<div class="stage-row" data-stage="${i}">
                <span class="stage-icon"></span>
                <div><div class="stage-name">${name}</div><div class="stage-detail">${detail}</div></div>
                <span class="stage-status">Queued</span>
              </div>`,
            )
            .join('')}
        </div>

        <div class="processing-foot">
          <div class="processing-result"><svg class="ic"><use href="#i-check-circle"/></svg> 8 candidates ready for review</div>
          <button class="btn btn-primary" id="reviewNow" type="button" disabled>Review 8 findings <svg class="ic"><use href="#i-arrow-right"/></svg></button>
        </div>
        <div style="text-align:center;margin-top:10px"><button class="text-btn processing-skip" id="skipProcessing" type="button">Skip the animation</button></div>
      </div>
    </section>`;

  const card = document.getElementById('processingCard');
  const countEl = document.getElementById('procCount');
  const barEl = document.getElementById('procBar');
  const fileEl = document.getElementById('procFile');
  const rows = [...app.querySelectorAll('[data-stage]')];

  const setStage = (index, status) => {
    rows.forEach((row, i) => {
      const done = i < index || (i === index && status === 'done');
      const running = i === index && status === 'running';
      row.classList.toggle('is-done', done);
      row.classList.toggle('is-running', running);
      const icon = row.querySelector('.stage-icon');
      const statusEl = row.querySelector('.stage-status');
      if (done) {
        icon.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>';
        statusEl.textContent = 'Done';
      } else if (running) {
        icon.innerHTML = '<span class="stage-spinner"></span>';
        statusEl.textContent = 'Running';
      } else {
        icon.innerHTML = '';
        statusEl.textContent = 'Queued';
      }
    });
  };

  setStage(0, 'running');
  later(() => setStage(0, 'done'), 620);
  later(() => setStage(1, 'running'), 680);
  later(() => setStage(1, 'done'), 1450);
  later(() => setStage(2, 'running'), 1520);
  later(() => setStage(2, 'done'), 2550);
  later(() => setStage(3, 'running'), 2620);
  later(() => {
    setStage(3, 'done');
    card.classList.add('is-ready');
    document.getElementById('reviewNow').disabled = false;
  }, 3400);
  later(() => {
    state.maxStep = Math.max(state.maxStep, 3);
    go('review');
  }, 4700);

  const start = performance.now();
  const duration = 3200;
  const rooms = ['Training Room', 'Main Hall', 'Pantry', 'Store'];
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const count = Math.round(eased * PROJECT.photoCount);
    countEl.textContent = String(count);
    barEl.style.width = `${eased * 100}%`;
    const room = rooms[Math.min(rooms.length - 1, Math.floor((count / PROJECT.photoCount) * rooms.length))];
    fileEl.textContent = `Reading frame ${String(Math.min(count, PROJECT.photoCount)).padStart(3, '0')} · ${room}`;
    if (t < 1) {
      state.raf = requestAnimationFrame(tick);
    } else {
      fileEl.textContent = `${PROJECT.photoCount} frames indexed · ${PROJECT.roomCount} rooms matched · ${PHOTOS.length} candidates found`;
    }
  };
  state.raf = requestAnimationFrame(tick);

  document.getElementById('reviewNow').addEventListener('click', () => {
    state.maxStep = Math.max(state.maxStep, 3);
    go('review');
  });
  document.getElementById('skipProcessing').addEventListener('click', () => {
    state.maxStep = Math.max(state.maxStep, 3);
    go('review');
  });
}

/* ------------------------------------------------------------------
   Review
   ------------------------------------------------------------------ */

function renderReview() {
  const photo = currentPhoto();
  if (!photo) {
    state.maxStep = Math.max(state.maxStep, 4);
    go('report');
    return;
  }

  if (state.pendingPhotoId && state.pendingPhotoId !== photo.id) {
    state.pendingPhotoId = null;
    state.pendingLayer = null;
  }

  app.innerHTML = `
    <section class="review-screen">
      <div class="review-top" id="reviewTop">${reviewTopMarkup()}</div>
      <div class="review-grid">
        <div class="review-main">
          <div class="photo-card" id="photoCard">${photoCardMarkup(photo)}</div>
          <div id="decisionCard">${decisionCardMarkup(photo)}</div>
          <div class="review-hint">
            <span><kbd>←</kbd><kbd>→</kbd> navigate</span>
            <span><kbd>1</kbd>–<kbd>4</kbd> layer</span>
            <span><kbd>Enter</kbd> keep</span>
            <span><kbd>X</kbd> reject</span>
          </div>
        </div>
        <aside class="review-side">
          <div id="planCard">${planCardMarkup(photo)}</div>
          <div id="layersCard">${layersCardMarkup(photo)}</div>
        </aside>
      </div>
    </section>`;

  const screen = app.querySelector('.review-screen');
  screen.addEventListener('click', onReviewClick);
}

function reviewTopMarkup() {
  const kept = keptPhotos().length;
  return `
    <div class="review-title">
      <button class="icon-btn sm" id="prevPhoto" type="button" ${state.index === 0 ? 'disabled' : ''} aria-label="Previous finding"><svg class="ic"><use href="#i-chevron-left"/></svg></button>
      <span class="review-title-text">Review findings</span>
      <span class="project-chip">${PROJECT.client} · ${PROJECT.floor}</span>
    </div>
    <div class="review-progress">
      <span class="progress-count">${state.index + 1} <span class="muted">of ${PHOTOS.length}</span></span>
      <div class="progress-track"><span style="width:${((state.index + 1) / PHOTOS.length) * 100}%"></span></div>
      <span class="progress-kept">${kept} kept</span>
    </div>`;
}

function photoCardMarkup(photo) {
  const layer = LAYER_BY_ID[photo.layer];
  return `
    <img class="photo-img" src="${photo.src}" alt="${escapeHtml(`${photo.room} — ${photo.title}`)}" loading="eager" decoding="async">
    <div class="photo-meta">
      <span class="meta-chip"><svg class="ic"><use href="#i-camera"/></svg> Photo ${String(state.index + 1).padStart(2, '0')} / ${String(PHOTOS.length).padStart(2, '0')}</span>
      <span class="meta-chip">${escapeHtml(photo.room)}</span>
      <span class="meta-chip">${photo.time}</span>
    </div>
    <div class="photo-view"><span class="meta-chip">${photo.view}</span></div>
    <div class="candidate">
      <div class="candidate-top">
        <span class="ai-badge"><svg class="ic"><use href="#i-sparkle"/></svg> AI candidate</span>
        <span class="confidence" style="border-color:${layer.color}66"><span class="chip-dot" style="background:${layer.color}"></span>${layer.name} · ${photo.confidence}% match</span>
      </div>
      <h2 class="candidate-title">${escapeHtml(photo.title)}</h2>
      <p class="candidate-detail">${escapeHtml(photo.detail)}</p>
      <div class="candidate-meta">
        <span><svg class="ic"><use href="#i-plan"/></svg>${escapeHtml(photo.room)} · ${escapeHtml(photo.zone)}</span>
        ${photo.event ? `<span><svg class="ic"><use href="#i-hammer"/></svg>${escapeHtml(photo.event)}</span>` : ''}
        <span><svg class="ic"><use href="#i-clock"/></svg>${photo.time}</span>
      </div>
    </div>`;
}

function decisionCardMarkup(photo) {
  const selected = selectedLayerFor(photo);
  return `
    <div class="decision-card">
      <div class="layer-picker">
        <div class="layer-label">Assign layer</div>
        <div class="layer-chips">
          ${LAYERS.map(
            (layer) => `<button class="layer-chip ${selected === layer.id ? 'is-selected' : ''}" type="button" data-layer="${layer.id}" style="--layer-color:${layer.color};--layer-soft:${layer.soft}" aria-pressed="${selected === layer.id}">
              <span class="chip-dot"></span>${layer.name}
              ${selected === layer.id ? '<svg class="ic chip-check"><use href="#i-check"/></svg>' : ''}
            </button>`,
          ).join('')}
        </div>
      </div>
      <div class="decision-actions">
        <button class="btn btn-ghost" id="rejectBtn" type="button"><svg class="ic"><use href="#i-x"/></svg> Not a defect</button>
        <button class="btn btn-primary" id="keepBtn" type="button">${state.index === PHOTOS.length - 1 ? 'Finish review' : 'Keep finding'}<svg class="ic"><use href="#i-arrow-right"/></svg></button>
      </div>
    </div>`;
}

function planCardMarkup(photo) {
  const selected = selectedLayerFor(photo);
  const layer = LAYER_BY_ID[selected];
  return `
    <div class="plan-card">
      <div class="card-head">
        <div><span class="card-title">Floor plan</span><span class="card-sub">${PROJECT.floor} · ${PROJECT.planRef}</span></div>
        <span class="mini-badge"><span class="mini-dot"></span> Route on</span>
      </div>
      ${planMarkup({ mode: 'review', currentId: photo.id, selectedLayer: selected })}
      <div class="card-foot">
        <span class="foot-now"><span class="dot" style="background:${layer.color}"></span>Now · ${escapeHtml(photo.room)}</span>
        <span class="foot-meta">${PROJECT.planRef}</span>
      </div>
    </div>`;
}

function layersCardMarkup(photo) {
  const counts = layerCounts();
  const suggested = aiLayerCounts();
  const kept = keptPhotos().length;
  const selected = selectedLayerFor(photo);
  return `
    <div class="layers-card">
      <div class="card-head">
        <div><span class="card-title">Layers</span><span class="card-sub">${kept} of ${PHOTOS.length} confirmed</span></div>
        ${state.hiddenLayers.size ? '<button class="text-btn" id="showAllLayers" type="button">Show all</button>' : ''}
      </div>
      <div class="layer-rows">
        ${LAYERS.map((layer) => {
          const active = layer.id === selected;
          const hidden = state.hiddenLayers.has(layer.id);
          return `<button class="layer-row ${active ? 'is-active' : ''} ${hidden ? 'is-hidden' : ''}" type="button" data-layer-toggle="${layer.id}" aria-pressed="${!hidden}" style="--layer-color:${layer.color};--layer-soft:${layer.soft}">
            <span class="layer-dot"></span>
            <span class="layer-name">${layer.name}</span>
            <span class="layer-count">${counts[layer.id]}<small>AI ${suggested[layer.id]}</small></span>
            <span class="layer-eye"><svg class="ic"><use href="#i-${hidden ? 'eye-off' : 'eye'}"/></svg></span>
          </button>`;
        }).join('')}
      </div>
      <div class="layers-foot">
        <div class="progress-track"><span style="width:${(kept / PHOTOS.length) * 100}%"></span></div>
        <span>${kept} / ${PHOTOS.length}</span>
      </div>
    </div>`;
}

function planMarkup({ mode = 'review', currentId = null, selectedLayer = null, compact = false } = {}) {
  const path = ROUTE.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const currentRoom = currentId ? PHOTOS.find((photo) => photo.id === currentId)?.room : null;
  const rooms = ROOMS.map(
    (room) => `<span class="room-label ${currentRoom === room.name ? 'is-current' : ''} ${room.faint ? 'is-faint' : ''}" style="left:${room.x}%;top:${room.y}%">${room.name}</span>`,
  ).join('');

  const pins = PHOTOS.map((photo) => {
    const decision = state.decisions.get(photo.id);
    const isCurrent = photo.id === currentId;
    if (decision?.status === 'rejected' && !isCurrent) return '';
    if (mode === 'report' && decision?.status !== 'kept') return '';
    const layerId = decision?.status === 'kept' ? decision.layer : photo.layer;
    if (mode !== 'report' && state.hiddenLayers.has(layerId) && !isCurrent) return '';
    const layer = LAYER_BY_ID[layerId];
    const color = isCurrent && selectedLayer ? LAYER_BY_ID[selectedLayer].color : layer.color;
    const isKept = decision?.status === 'kept';
    const classes = `plan-pin ${isKept ? 'is-kept' : ''} ${isCurrent ? 'is-current' : ''}`;
    const style = `left:${photo.pin.x}%;top:${photo.pin.y}%;--layer-color:${color}`;
    if (mode === 'report') {
      return `<span class="${classes}" style="${style}" title="${escapeHtml(photo.id)}"></span>`;
    }
    return `<button type="button" class="${classes}" style="${style}" data-photo-jump="${photo.id}" title="${escapeHtml(`${photo.id} · ${photo.title}`)}" aria-label="Review ${escapeHtml(photo.title)}"></button>`;
  }).join('');

  return `<div class="plan-stage ${compact ? 'is-compact' : ''}">
    <img class="plan-img" src="assets/floor-plan.png" alt="Reference floor plan with survey route and findings">
    <div class="plan-overlay">
      <svg class="plan-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/></svg>
      ${rooms}
      ${pins}
    </div>
  </div>`;
}

function refreshReviewParts() {
  const photo = currentPhoto();
  if (!photo) return;
  const top = document.getElementById('reviewTop');
  if (top) top.innerHTML = reviewTopMarkup();
  const decision = document.getElementById('decisionCard');
  if (decision) decision.innerHTML = decisionCardMarkup(photo);
  const plan = document.getElementById('planCard');
  if (plan) plan.innerHTML = planCardMarkup(photo);
  const layers = document.getElementById('layersCard');
  if (layers) layers.innerHTML = layersCardMarkup(photo);
}

function onReviewClick(event) {
  const layerButton = event.target.closest('[data-layer]');
  if (layerButton) {
    setLayer(layerButton.dataset.layer);
    return;
  }

  const toggle = event.target.closest('[data-layer-toggle]');
  if (toggle) {
    toggleLayer(toggle.dataset.layerToggle);
    return;
  }

  const jump = event.target.closest('[data-photo-jump]');
  if (jump) {
    jumpToPhoto(jump.dataset.photoJump);
    return;
  }

  if (event.target.closest('#keepBtn')) {
    decide('kept');
    return;
  }

  if (event.target.closest('#rejectBtn')) {
    decide('rejected');
    return;
  }

  if (event.target.closest('#prevPhoto')) {
    prevPhoto();
    return;
  }

  if (event.target.closest('#showAllLayers')) {
    state.hiddenLayers.clear();
    refreshReviewParts();
  }
}

function setLayer(layerId) {
  const photo = currentPhoto();
  if (!photo || !LAYER_BY_ID[layerId]) return;
  state.pendingPhotoId = photo.id;
  state.pendingLayer = layerId;
  const decision = state.decisions.get(photo.id);
  if (decision?.status === 'kept') {
    state.decisions.set(photo.id, { ...decision, layer: layerId });
  }
  refreshReviewParts();
}

function toggleLayer(layerId) {
  if (state.hiddenLayers.has(layerId)) state.hiddenLayers.delete(layerId);
  else state.hiddenLayers.add(layerId);
  refreshReviewParts();
}

function decide(status) {
  const photo = currentPhoto();
  if (!photo) return;
  const layer = status === 'kept' ? selectedLayerFor(photo) : null;
  state.decisions.set(photo.id, { status, layer });
  state.pendingPhotoId = null;
  state.pendingLayer = null;

  if (state.index >= PHOTOS.length - 1) {
    state.maxStep = Math.max(state.maxStep, 4);
    go('report');
  } else {
    state.index += 1;
    renderReview();
  }
}

function prevPhoto() {
  if (state.index === 0) return;
  state.index -= 1;
  state.pendingPhotoId = null;
  state.pendingLayer = null;
  renderReview();
}

function nextPhoto() {
  if (state.index >= PHOTOS.length - 1) return;
  state.index += 1;
  state.pendingPhotoId = null;
  state.pendingLayer = null;
  renderReview();
}

function jumpToPhoto(photoId) {
  const index = PHOTOS.findIndex((photo) => photo.id === photoId);
  if (index < 0) return;
  state.index = index;
  state.pendingPhotoId = null;
  state.pendingLayer = null;
  renderReview();
}

/* ------------------------------------------------------------------
   Report
   ------------------------------------------------------------------ */

function renderReport() {
  if (state.decisions.size === 0) {
    for (const photo of PHOTOS) {
      state.decisions.set(photo.id, { status: 'kept', layer: photo.layer });
    }
  }

  const kept = keptPhotos();
  const counts = layerCounts();
  const total = kept.length;
  const layersUsed = LAYERS.filter((layer) => counts[layer.id] > 0).length;
  const empty = total === 0;
  const plan = planMarkup({ mode: 'report', compact: true });

  const layerRows = LAYERS.map((layer) => {
    const count = counts[layer.id];
    const percent = total ? Math.round((count / total) * 100) : 0;
    return `<div class="report-layer-row" style="--layer-color:${layer.color}">
      <span class="report-layer-dot"></span>
      <span class="report-layer-name">${layer.name}</span>
      <span class="report-layer-count">${count}</span>
      <div class="report-layer-bar"><span style="width:${percent}%"></span></div>
    </div>`;
  }).join('');

  const rows = kept
    .map((photo, i) => {
      const layer = LAYER_BY_ID[state.decisions.get(photo.id).layer];
      return `<tr>
        <td class="ref">F-${String(i + 1).padStart(2, '0')}</td>
        <td>${escapeHtml(photo.room)}<br><span style="color:#748078;font-size:7.5px">${escapeHtml(photo.zone)}</span></td>
        <td><span class="report-layer-tag" style="--layer-color:${layer.color}"><i></i>${layer.short}</span></td>
        <td class="finding"><strong>${escapeHtml(photo.title)}</strong><span>${escapeHtml(photo.detail)}</span></td>
        <td class="ref">${photo.id}</td>
      </tr>`;
    })
    .join('');

  app.innerHTML = `
    <section class="report-screen">
      <div class="report-top">
        <div class="review-title">
          <span class="review-title-text">Draft report</span>
          <span class="project-chip">${PROJECT.client} · ${PROJECT.floor}</span>
        </div>
        <div class="report-top-right">
          <span class="ready-state"><span class="demo-dot"></span> ${empty ? 'Nothing confirmed' : 'Ready to export'}</span>
          <button class="text-btn" id="backToReview" type="button">← Back to review</button>
        </div>
      </div>

      <div class="report-grid">
        <div class="report-preview-wrap" id="reportPreview">
          <article class="report-page" id="reportPage">
            <div class="report-head">
              <div class="report-brand"><span class="brand-mark">${BRAND_MARK_SVG}</span><span class="report-brand-word">Harvey &amp; Walligan</span></div>
              <div class="report-head-meta">Condition survey · Draft<br>${PROJECT.surveyDate}</div>
            </div>

            <div class="report-title-block">
              <div class="eyebrow">Draft report</div>
              <h1>Condition Survey</h1>
              <div class="report-project">${PROJECT.client} · ${PROJECT.block} · ${PROJECT.floor}</div>
            </div>

            <div class="report-meta-grid">
              <div><span>Client</span><strong>${PROJECT.client}</strong></div>
              <div><span>Block / floor</span><strong>${PROJECT.block} · ${PROJECT.floor}</strong></div>
              <div><span>Survey date</span><strong>${PROJECT.surveyDate}</strong></div>
              <div><span>Surveyor</span><strong>${PROJECT.surveyor}</strong></div>
              <div><span>Plan reference</span><strong>${PROJECT.planRef}</strong></div>
              <div><span>Capture</span><strong>${PROJECT.photoCount} × 360° photos</strong></div>
            </div>

            <div class="report-stats">
              <div class="report-stat"><strong>${PROJECT.photoCount}</strong><span>Photos</span></div>
              <div class="report-stat"><strong>${PHOTOS.length}</strong><span>AI candidates</span></div>
              <div class="report-stat"><strong>${total}</strong><span>Confirmed</span></div>
              <div class="report-stat"><strong>${LAYERS.length}</strong><span>Layers</span></div>
            </div>

            ${
              empty
                ? `<div class="report-empty"><h2 class="display h2">No findings confirmed.</h2><p>Go back to the review and keep at least one candidate to build the report.</p></div>`
                : `<div class="report-summary">
                    <div class="report-plan">${plan}<div class="report-plan-caption">Marked plan · ${PROJECT.planRef} · names redacted</div></div>
                    <div class="report-layers">
                      <div class="report-section-title">Findings by layer</div>
                      ${layerRows}
                    </div>
                  </div>
                  <div class="report-section-title">Confirmed findings</div>
                  <table class="report-table">
                    <thead><tr><th style="width:8%">Ref</th><th style="width:21%">Location</th><th style="width:13%">Layer</th><th style="width:46%">Finding</th><th style="width:12%">Photo</th></tr></thead>
                    <tbody>${rows}</tbody>
                  </table>`
            }

            <div class="report-foot"><span>Harvey and Walligan · Demo report</span><span>${PROJECT.surveyDate} · ${total} confirmed findings</span></div>
          </article>
        </div>

        <aside class="export-panel" id="exportPanel">${exportPanelMarkup(empty)}</aside>
      </div>
    </section>`;

  const screen = app.querySelector('.report-screen');
  screen.addEventListener('click', (event) => {
    const option = event.target.closest('[data-export]');
    if (option) {
      state.exportFormat = option.dataset.export;
      const panel = document.getElementById('exportPanel');
      if (panel) panel.innerHTML = exportPanelMarkup(keptPhotos().length === 0);
      return;
    }

    if (event.target.closest('#exportBtn')) {
      handleExport();
      return;
    }

    if (event.target.closest('#startNew')) {
      resetAll();
      return;
    }

    if (event.target.closest('#backToReview')) {
      state.index = Math.max(0, PHOTOS.length - 1);
      state.maxStep = Math.max(state.maxStep, 3);
      go('review');
    }
  });
}

function exportPanelMarkup(empty) {
  const formats = [
    { id: 'word', icon: 'word', title: 'Word report', desc: 'Editable findings, layer summary and marked plan' },
    { id: 'pdf', icon: 'pdf', title: 'PDF report', desc: 'Print-ready, fixed layout for issue' },
    { id: 'plan', icon: 'plan', title: 'Marked plan', desc: `${PROJECT.planRef} · PNG with findings` },
  ];
  const labels = {
    word: 'Export Word report',
    pdf: 'Print / save PDF',
    plan: 'Download marked plan',
  };
  const icons = { word: 'word', pdf: 'pdf', plan: 'download' };
  const selected = state.exportFormat;
  const total = keptPhotos().length;

  return `
    <div class="eyebrow">Export</div>
    <h2 class="display h2">Take it to Word.</h2>
    <p class="export-lede">The surveyor's edits are preserved. Choose the format your team issues.</p>

    <div class="export-options" role="group" aria-label="Export format">
      ${formats
        .map(
          (format) => `<button class="export-option ${selected === format.id ? 'is-selected' : ''}" type="button" data-export="${format.id}" aria-pressed="${selected === format.id}">
            <span class="export-icon"><svg class="ic"><use href="#i-${format.icon}"/></svg></span>
            <span class="export-copy"><strong>${format.title}</strong><small>${format.desc}</small></span>
            <span class="export-check"><svg class="ic"><use href="#i-check"/></svg></span>
          </button>`,
        )
        .join('')}
    </div>

    <button class="btn btn-primary btn-lg btn-block export-btn" id="exportBtn" type="button" ${empty ? 'disabled' : ''}>
      <svg class="ic"><use href="#i-${icons[selected]}"/></svg>${labels[selected]}
    </button>

    <div class="export-note"><svg class="ic"><use href="#i-info"/></svg><span>${empty ? 'Confirm at least one finding to enable export.' : 'Demo: the Word file is generated locally in your browser.'}</span></div>

    <div class="export-included">
      <div class="export-included-title">Included</div>
      <ul>
        <li><svg class="ic"><use href="#i-check"/></svg>${total} confirmed findings</li>
        <li><svg class="ic"><use href="#i-check"/></svg>Layer summary and marked plan</li>
        <li><svg class="ic"><use href="#i-check"/></svg>${PROJECT.photoCount} photo references</li>
      </ul>
    </div>

    <button class="text-btn export-reset" id="startNew" type="button">Start a new survey</button>`;
}

async function handleExport() {
  const kept = keptPhotos();
  if (!kept.length) {
    showToast('Confirm at least one finding first.', 'info');
    return;
  }

  if (state.exportFormat === 'pdf') {
    showToast('Opening print dialog…', 'pdf');
    later(() => window.print(), 320);
    return;
  }

  if (state.exportFormat === 'plan') {
    await downloadMarkedPlan();
    return;
  }

  await exportWord();
}

async function exportWord() {
  const kept = keptPhotos();
  if (!kept.length) return;
  showToast('Compiling Word report…', 'word');

  try {
    const canvas = await makeMarkedPlanCanvas();
    const planData = canvas.toDataURL('image/png');
    const counts = layerCounts();
    const layersUsed = LAYERS.filter((layer) => counts[layer.id] > 0).length;

    const rows = kept
      .map((photo, i) => {
        const layer = LAYER_BY_ID[state.decisions.get(photo.id).layer];
        return `<tr>
          <td>F-${String(i + 1).padStart(2, '0')}</td>
          <td>${escapeHtml(photo.room)}<br><span class="small">${escapeHtml(photo.zone)}</span></td>
          <td><span style="color:${layer.color};font-weight:bold">●</span> ${escapeHtml(layer.name)}</td>
          <td><strong>${escapeHtml(photo.title)}</strong><br><span class="small">${escapeHtml(photo.detail)}</span></td>
          <td>${photo.id}</td>
        </tr>`;
      })
      .join('');

    const layerRows = LAYERS.map(
      (layer) => `<tr><td><span style="color:${layer.color};font-weight:bold">●</span> ${escapeHtml(layer.name)}</td><td>${counts[layer.id]}</td></tr>`,
    ).join('');

    const html = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Condition Survey — ${escapeHtml(PROJECT.client)} ${escapeHtml(PROJECT.floor)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: Calibri, Arial, sans-serif; font-size: 10pt; color: #222; line-height: 1.4; }
  h1 { font-family: Georgia, serif; font-size: 26pt; font-weight: normal; margin: 0 0 4pt; }
  h2 { font-family: Georgia, serif; font-size: 14pt; font-weight: normal; margin: 18pt 0 6pt; }
  .eyebrow { font-size: 8pt; letter-spacing: 2pt; text-transform: uppercase; color: #777; }
  .project { font-size: 12pt; color: #555; margin-bottom: 12pt; }
  .meta { width: 100%; border-collapse: collapse; margin: 12pt 0; }
  .meta td { padding: 4pt 8pt 4pt 0; vertical-align: top; font-size: 9pt; }
  .label { color: #777; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.8pt; }
  table.findings { width: 100%; border-collapse: collapse; margin-top: 6pt; }
  table.findings th { background: #f0ece3; text-align: left; font-size: 8pt; padding: 5pt; border: 1px solid #d8d0c2; }
  table.findings td { font-size: 9pt; padding: 5pt; border: 1px solid #e2dbce; vertical-align: top; }
  table.layers { border-collapse: collapse; margin-top: 6pt; }
  table.layers td { padding: 3pt 12pt 3pt 0; font-size: 9pt; border-bottom: 1px solid #eee; }
  .small { color: #777; font-size: 8pt; }
  .plan { width: 100%; max-width: 520pt; margin: 8pt 0; }
  .footer { margin-top: 18pt; border-top: 1px solid #ddd; padding-top: 6pt; color: #888; font-size: 8pt; }
</style>
</head>
<body>
  <div class="eyebrow">Harvey and Walligan · Condition survey</div>
  <h1>Condition Survey — Draft Report</h1>
  <div class="project">${escapeHtml(PROJECT.client)} · ${escapeHtml(PROJECT.block)} · ${escapeHtml(PROJECT.floor)}</div>

  <table class="meta">
    <tr><td><span class="label">Client</span><br>${escapeHtml(PROJECT.client)}</td><td><span class="label">Block / floor</span><br>${escapeHtml(PROJECT.block)} · ${escapeHtml(PROJECT.floor)}</td><td><span class="label">Survey date</span><br>${PROJECT.surveyDate}</td></tr>
    <tr><td><span class="label">Surveyor</span><br>${escapeHtml(PROJECT.surveyor)}</td><td><span class="label">Plan reference</span><br>${PROJECT.planRef}</td><td><span class="label">Capture</span><br>${PROJECT.photoCount} × 360° photos</td></tr>
  </table>

  <h2>Summary</h2>
  <p>${PROJECT.photoCount} 360° photos were captured across ${PROJECT.roomCount} rooms. The AI pass proposed ${PHOTOS.length} candidates; the surveyor confirmed ${kept.length} findings across ${layersUsed} layers.</p>

  <h2>Findings</h2>
  <table class="findings">
    <thead><tr><th style="width:8%">Ref</th><th style="width:18%">Location</th><th style="width:16%">Layer</th><th style="width:46%">Finding</th><th style="width:12%">Photo</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>Findings by layer</h2>
  <table class="layers"><tbody>${layerRows}</tbody></table>

  <h2>Marked plan</h2>
  <img class="plan" src="${planData}" alt="Marked floor plan">
  <p class="small">${PROJECT.planRef} · Reference plan, names redacted. The marked plan is generated from the confirmed findings.</p>

  <div class="footer">Harvey and Walligan · Demo report · ${PROJECT.surveyDate} · Photo references: ${kept.map((photo) => photo.id).join(', ')}</div>
</body>
</html>`;

    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    downloadBlob(blob, 'Harvey-Walligan_Belmont-Court_3F-West_Draft-Report.doc');
    showToast(`Word report compiled · ${kept.length} findings`, 'check');
  } catch (error) {
    console.error(error);
    showToast('Could not compile the report in this browser.', 'info');
  }
}

async function downloadMarkedPlan() {
  showToast('Rendering marked plan…', 'plan');
  try {
    const canvas = await makeMarkedPlanCanvas();
    canvas.toBlob((blob) => {
      if (!blob) {
        showToast('Could not render the plan.', 'info');
        return;
      }
      downloadBlob(blob, 'Harvey-Walligan_Belmont-Court_3F-West_Marked-Plan.png');
      showToast('Marked plan downloaded', 'check');
    }, 'image/png');
  } catch (error) {
    console.error(error);
    showToast('Could not render the plan.', 'info');
  }
}

async function makeMarkedPlanCanvas() {
  const image = await loadImage('assets/floor-plan.png');
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);

  // Survey route
  ctx.save();
  ctx.strokeStyle = 'rgba(28, 27, 24, 0.32)';
  ctx.lineWidth = Math.max(2, width / 300);
  ctx.setLineDash([Math.max(6, width / 100), Math.max(8, width / 80)]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ROUTE.forEach(([x, y], i) => {
    const px = (x / 100) * width;
    const py = (y / 100) * height;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.restore();

  // Confirmed findings
  const kept = keptPhotos();
  kept.forEach((photo, i) => {
    const layer = LAYER_BY_ID[state.decisions.get(photo.id).layer];
    const x = (photo.pin.x / 100) * width;
    const y = (photo.pin.y / 100) * height;
    const radius = Math.max(12, width / 55);

    ctx.beginPath();
    ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 253, 249, 0.92)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = layer.color;
    ctx.fill();
    ctx.lineWidth = Math.max(2, width / 300);
    ctx.strokeStyle = '#fffdf9';
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.max(12, width / 62)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y + 1);
  });

  // Legend
  const pad = Math.max(16, width / 40);
  const legendWidth = Math.max(150, width / 4.2);
  const legendHeight = Math.max(96, height / 8.2);
  const legendX = pad;
  const legendY = pad;
  roundRect(ctx, legendX, legendY, legendWidth, legendHeight, Math.max(6, width / 100));
  ctx.fillStyle = 'rgba(255, 253, 249, 0.93)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(205, 196, 180, 0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#827c6f';
  ctx.font = `700 ${Math.max(8, width / 90)}px Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('CONFIRMED FINDINGS', legendX + 10, legendY + 16);

  const counts = layerCounts();
  LAYERS.forEach((layer, i) => {
    const y = legendY + 32 + i * ((legendHeight - 32) / 4);
    ctx.beginPath();
    ctx.arc(legendX + 14, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = layer.color;
    ctx.fill();

    ctx.fillStyle = '#45423b';
    ctx.font = `600 ${Math.max(8, width / 95)}px Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(layer.name, legendX + 24, y + 3);

    ctx.fillStyle = '#827c6f';
    ctx.textAlign = 'right';
    ctx.fillText(String(counts[layer.id]), legendX + legendWidth - 10, y + 3);
    ctx.textAlign = 'left';
  });

  return canvas;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/* ------------------------------------------------------------------
   Reset, keyboard, boot
   ------------------------------------------------------------------ */

function resetAll() {
  state.decisions.clear();
  state.hiddenLayers.clear();
  state.index = 0;
  state.pendingPhotoId = null;
  state.pendingLayer = null;
  state.maxStep = 1;
  state.exportFormat = 'word';
  state.source = PROJECT.source;
  closeModal();
  go('import');
  showToast('Demo reset', 'check');
}

function onKeydown(event) {
  if (event.target instanceof Element && event.target.matches('input, textarea, select')) return;

  if (!modal.hidden) {
    if (event.key === 'Escape') closeModal();
    return;
  }

  if (state.screen === 'review') {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      prevPhoto();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      nextPhoto();
      return;
    }
    if (event.key === 'Enter' && !event.target.closest('button, a')) {
      event.preventDefault();
      decide('kept');
      return;
    }
    if (event.key === 'x' || event.key === 'X') {
      event.preventDefault();
      decide('rejected');
      return;
    }
    if (/^[1-4]$/.test(event.key)) {
      event.preventDefault();
      setLayer(LAYERS[Number(event.key) - 1].id);
      return;
    }
  }

  if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    resetAll();
  }
}

function preloadReviewImages() {
  PHOTOS.forEach((photo) => {
    const image = new Image();
    image.src = photo.src;
  });
}

function init() {
  state.screen = routeFromHash();
  if (!location.hash || !ROUTES.includes(routeFromHash())) {
    history.replaceState(null, '', `#/${state.screen}`);
  }

  window.addEventListener('hashchange', () => {
    state.screen = routeFromHash();
    render();
  });

  window.addEventListener('keydown', onKeydown);
  helpBtn.addEventListener('click', openModal);
  modal.querySelectorAll('[data-close-modal]').forEach((element) => element.addEventListener('click', closeModal));
  document.getElementById('resetDemo').addEventListener('click', resetAll);

  render();
  later(preloadReviewImages, 700);
}

init();
