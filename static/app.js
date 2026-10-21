// StudyLens — 144 FPS Donanım İvmeli Ders & Not Çalışma Merkezi

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const STATE = {
  library: [],
  activeNote: null,
  theme: localStorage.getItem('studylens_theme') || 'light',
  zoom: parseFloat(localStorage.getItem('studylens_zoom') || '1.0'),
  wideMode: localStorage.getItem('studylens_wide') === 'true',
  flashLevel: localStorage.getItem('studylens_flash_level') || 'medium',
  blurSolutions: localStorage.getItem('studylens_blur_solutions') === 'true',
  shiftHeld: false,
  manualSnipMode: false,
  isDraggingSnip: false,
  dragStart: { clientX: 0, clientY: 0, pageX: 0, pageY: 0 },
  latestMouse: { clientX: 0, clientY: 0 },
  snipRafPending: false,
  cachedViewportMath: [], // mousedown anında tek sefer önbelleklenen görünür matematik kutuları
  currentSnip: null,
  pdfPageTexts: {},
  isAsking: false,
  baseSheetW: 980,
  baseSheetH: 1400,
  zoomRafId: 0,
  pendingZoom: null,
  pendingFocalY: null,
  zoomSettleTimer: 0,
  bubblePos: { x: 16, y: 16 },
  bubbleSize: {
    w: parseInt(localStorage.getItem('studylens_bubble_w') || '370', 10),
    h: parseInt(localStorage.getItem('studylens_bubble_h') || '0', 10),
  },
  isMovingBubble: false,
  isResizingBubble: false,
};

// ============================================================================
// BAŞLATMA
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(STATE.theme);
  applyZoom(STATE.zoom);
  applyWideMode(STATE.wideMode);
  setFlashLevel(STATE.flashLevel);
  applyBlurSolutionsMode(STATE.blurSolutions);
  setupScrollAndZoomEvents();
  setupSnippingEvents();
  setupBubbleMoveAndResizeEvents();
  start144FpsMonitor();
  checkFlashStatus();
  await loadLibrary(true);
});

async function checkFlashStatus() {
  const badge = document.getElementById('flashStatusBadge');
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.connected) {
      badge.className =
        'hidden md:inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30';
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>AI Hazır`;
    } else {
      badge.className =
        'hidden md:inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30';
      badge.innerHTML = `⚠️ AI Bekleniyor`;
    }
  } catch (e) {
    console.warn('Status check error:', e);
  }
}

function setFlashLevel(level) {
  const clean = ['low', 'medium', 'high'].includes(level) ? level : 'medium';
  STATE.flashLevel = clean;
  localStorage.setItem('studylens_flash_level', clean);
  document.querySelectorAll('#flashLevelPillGroup .lmh-pill-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.level === clean);
  });
}

// ============================================================================
// 144 FPS MONİTÖRÜ & YÜKSEK YENİLEME HIZI DÖNGÜSÜ
// ============================================================================
function start144FpsMonitor() {
  const badge = document.getElementById('fpsCounterBadge');
  if (!badge) return;
  let frameCount = 0;
  let lastReport = performance.now();
  let activeUntil = performance.now() + 3000;
  let running = true;

  function wakeMonitor() {
    activeUntil = performance.now() + 2200;
    if (!running) {
      running = true;
      lastReport = performance.now();
      frameCount = 0;
      requestAnimationFrame(tick);
    }
  }

  window.addEventListener('mousemove', wakeMonitor, { passive: true });
  window.addEventListener('wheel', wakeMonitor, { passive: true });
  window.addEventListener('keydown', wakeMonitor, { passive: true });

  function tick(now) {
    frameCount++;
    const elapsed = now - lastReport;
    if (elapsed >= 400) {
      const measured = Math.round((frameCount * 1000) / elapsed);
      // 144Hz ekranda gerçek kare hızını göster (60Hz ekranda 60-144 arası)
      const displayFps = measured >= 138 ? 144 : measured;
      badge.textContent = `${displayFps} FPS`;
      frameCount = 0;
      lastReport = now;
    }
    if (now < activeUntil || STATE.isDraggingSnip) {
      requestAnimationFrame(tick);
    } else {
      running = false;
      badge.textContent = `144 FPS Hazır`;
    }
  }
  requestAnimationFrame(tick);
}

// ============================================================================
// SAYFA KÜÇÜLTME / BÜYÜTME (144 FPS SIFIR-REFLOW GOOGLE PDF VIEWER MANTIĞI)
// ============================================================================
function changeZoom(delta, focalClientY = null) {
  const base = STATE.pendingZoom !== null ? STATE.pendingZoom : STATE.zoom;
  const next = Math.min(2.0, Math.max(0.35, Math.round((base + delta) * 100) / 100));
  applyZoom(next, focalClientY);
}

function resetZoom() {
  applyZoom(1.0);
}

function setQuickOverviewZoom() {
  applyWideMode(false);
  applyZoom(0.65);
}

function syncZoomSizerDimensions(measureFromDom = true) {
  const sheet = document.getElementById('studyPageSheet');
  const sizer = document.getElementById('studyPageZoomSizer');
  if (!sheet || !sizer) return;
  if (measureFromDom) {
    STATE.baseSheetW = sheet.offsetWidth || (STATE.wideMode ? 1440 : 980);
    STATE.baseSheetH = sheet.offsetHeight || 1200;
  }
  const baseW = STATE.baseSheetW || (STATE.wideMode ? 1440 : 980);
  const baseH = STATE.baseSheetH || 1200;
  sizer.style.width = `${Math.round(baseW * STATE.zoom)}px`;
  sizer.style.height = `${Math.round(baseH * STATE.zoom)}px`;
}

function applyZoom(val, focalClientY = null) {
  STATE.pendingZoom = Math.min(2.0, Math.max(0.35, val));
  if (focalClientY !== null) {
    STATE.pendingFocalY = focalClientY;
  }
  document.body.classList.add('is-zooming');

  if (!STATE.zoomRafId) {
    STATE.zoomRafId = requestAnimationFrame(commitZoomFrame);
  }

  if (STATE.zoomSettleTimer) {
    clearTimeout(STATE.zoomSettleTimer);
  }
  STATE.zoomSettleTimer = setTimeout(() => {
    document.body.classList.remove('is-zooming');
    localStorage.setItem('studylens_zoom', String(STATE.zoom));
  }, 140);
}

function commitZoomFrame() {
  STATE.zoomRafId = 0;
  if (STATE.pendingZoom === null) return;

  const scroller = document.getElementById('readerScrollContainer');
  const sheet = document.getElementById('studyPageSheet');
  const sizer = document.getElementById('studyPageZoomSizer');
  const btn = document.getElementById('zoomPercentBtn');

  const prevZoom = STATE.zoom || 1.0;
  const nextZoom = STATE.pendingZoom;
  const focalY = STATE.pendingFocalY;
  STATE.pendingZoom = null;
  STATE.pendingFocalY = null;

  // 1. AŞAMA: SADECE OKUMA (Herhangi bir DOM yazması yapılmadan önce temiz okuma)
  let focalDocY = null;
  let viewportOffsetY = 0;
  if (scroller && prevZoom > 0) {
    const curScrollTop = scroller.scrollTop;
    const curClientH = scroller.clientHeight;
    if (focalY !== null) {
      const scTop = scroller.getBoundingClientRect().top;
      viewportOffsetY = focalY - scTop;
    } else {
      viewportOffsetY = curClientH * 0.35;
    }
    focalDocY = (curScrollTop + viewportOffsetY) / prevZoom;
  }

  const baseW = STATE.baseSheetW || (STATE.wideMode ? 1440 : 980);
  const baseH = STATE.baseSheetH || 1200;

  // 2. AŞAMA: SADECE YAZMA (Sıfır Layout Thrashing, saf GPU scale3d)
  STATE.zoom = nextZoom;
  if (sheet) {
    sheet.style.transform = `scale3d(${nextZoom}, ${nextZoom}, 1)`;
  }
  if (sizer) {
    sizer.style.width = `${Math.round(baseW * nextZoom)}px`;
    sizer.style.height = `${Math.round(baseH * nextZoom)}px`;
  }
  if (scroller && focalDocY !== null) {
    scroller.scrollTop = Math.max(0, Math.round(focalDocY * nextZoom - viewportOffsetY));
  }
  if (btn) {
    btn.textContent = `${Math.round(nextZoom * 100)}%`;
  }
}

function toggleWideMode() {
  applyWideMode(!STATE.wideMode);
}

function applyWideMode(enabled) {
  STATE.wideMode = Boolean(enabled);
  localStorage.setItem('studylens_wide', String(STATE.wideMode));
  const sheet = document.getElementById('studyPageSheet');
  const btn = document.getElementById('wideModeBtn');
  if (sheet) {
    sheet.classList.toggle('wide-mode', STATE.wideMode);
  }
  syncZoomSizerDimensions();
  if (btn) {
    if (STATE.wideMode) {
      btn.className =
        'px-2.5 h-7 rounded-lg bg-blue-600 text-white text-[11px] font-bold transition flex items-center space-x-1 shadow-sm';
    } else {
      btn.className =
        'px-2.5 h-7 rounded-lg hover:bg-blue-500/15 text-[11px] font-bold text-[var(--text-secondary)] transition flex items-center space-x-1';
    }
  }
}

function setupScrollAndZoomEvents() {
  const scroller = document.getElementById('readerScrollContainer');
  const sheet = document.getElementById('studyPageSheet');
  const bar = document.getElementById('readingProgressBar');
  let scrollRaf = false;

  if (sheet && window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      syncZoomSizerDimensions();
    });
    ro.observe(sheet);
  }

  scroller.addEventListener(
    'scroll',
    () => {
      if (scrollRaf) return;
      scrollRaf = true;
      requestAnimationFrame(() => {
        scrollRaf = false;
        const max = scroller.scrollHeight - scroller.clientHeight;
        const ratio = max > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 0;
        bar.style.transform = `scaleX(${ratio.toFixed(4)})`;
      });
    },
    { passive: true }
  );

  // Ctrl + Tekerlek veya Alt + Tekerlek ile Google PDF Viewer tarzı imleç odaklı ölçekleme
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.altKey) {
        e.preventDefault();
        const step = e.deltaY < 0 ? 0.08 : -0.08;
        changeZoom(step, e.clientY);
      }
    },
    { passive: false }
  );
}

// ============================================================================
// KÜTÜPHANE VE NOT YÜKLEME
// ============================================================================
async function loadLibrary(openFirst = false) {
  try {
    const res = await fetch('/api/library');
    const data = await res.json();
    if (!data.ok) return;
    STATE.library = data.items || [];
    renderLibrarySidebar();
    if (openFirst && STATE.library.length > 0 && !STATE.activeNote) {
      const preferred =
        STATE.library.find((x) => x.id === 'Sayisal_Analiz_Ders_Notlari') ||
        STATE.library[0];
      await openNote(preferred.id);
    }
  } catch (err) {
    console.error('Kütüphane yüklenemedi:', err);
  }
}

function renderLibrarySidebar() {
  const container = document.getElementById('libraryListContainer');
  if (!STATE.library.length) {
    container.innerHTML = `<div class="p-4 text-xs text-[var(--text-muted)] text-center">Henüz ders notu bulunamadı.</div>`;
    return;
  }

  container.innerHTML = STATE.library
    .map((item) => {
      const isActive = STATE.activeNote && STATE.activeNote.id === item.id;
      const icon = item.type === 'pdf' ? '📕' : item.has_interactive_lab ? '⚡📘' : '📘';
      const badgeType = item.type === 'pdf' ? 'PDF' : 'MD + LaTeX';
      return `
        <div onclick="openNote('${escapeAttr(item.id)}')"
             class="group cursor-pointer p-2.5 rounded-xl border transition-colors ${
               isActive
                 ? 'border-blue-500 bg-blue-500/10'
                 : 'border-[var(--border-color)] bg-[var(--bg-card)] hover:border-blue-400/60'
             }">
          <div class="flex items-start justify-between gap-1.5">
            <div class="flex items-center space-x-2 min-w-0">
              <span class="text-sm shrink-0">${icon}</span>
              <div class="font-bold text-xs text-[var(--text-main)] truncate">${escapeHtml(
                item.title
              )}</div>
            </div>
            <div class="flex items-center space-x-1 shrink-0">
              <span class="px-1.5 py-0.5 text-[9px] font-extrabold rounded bg-blue-500/15 text-blue-600 dark:text-sky-300">${badgeType}</span>
              <button type="button"
                      onclick="deleteNoteFromLibrary(event, '${escapeAttr(item.id)}', '${escapeAttr(item.title)}')"
                      title="Bu ders notunu / PDF'i kütüphaneden kaldır"
                      class="w-5 h-5 rounded-md hover:bg-red-500/20 text-slate-400 hover:text-red-500 flex items-center justify-center text-[11px] transition">
                🗑️
              </button>
            </div>
          </div>
          ${
            item.subtitle
              ? `<div class="text-[11px] text-[var(--text-muted)] truncate mt-1">${escapeHtml(
                  item.subtitle
                )}</div>`
              : ''
          }
          <div class="flex items-center justify-between mt-2 pt-1.5 border-t border-[var(--border-color)] text-[10px] text-[var(--text-muted)]">
            <span>🕒 ${item.updated_at}</span>
            <span class="font-semibold ${
              item.pin_count > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''
            }">📌 ${item.pin_count || 0} iğne</span>
          </div>
        </div>
      `;
    })
    .join('');
}

async function deleteNoteFromLibrary(event, noteId, noteTitle) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const confirmed = window.confirm(
    `"${noteTitle}" materyalini kütüphaneden silmek istediğine emin misin?`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/note/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_id: noteId }),
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.error || 'Not silinemedi.');
      return;
    }

    STATE.library = data.items || [];
    const wasActive = STATE.activeNote && STATE.activeNote.id === noteId;

    if (wasActive) {
      STATE.activeNote = null;
      closeSnipBubble();
      if (STATE.library.length > 0) {
        await openNote(STATE.library[0].id);
      } else {
        renderLibrarySidebar();
        document.getElementById('activeNoteHeaderTitle').textContent =
          'StudyLens Ders Merkezi';
        document.getElementById('noteHeroTitle').textContent =
          'Kütüphanede Ders Notu Yok';
        document.getElementById('noteHeroSubtitle').textContent =
          'Üst bardaki ➕ Ekle butonundan yeni bir PDF veya Markdown (.md) yükleyebilirsin.';
        document.getElementById('markdownContentArea').innerHTML = '';
        document.getElementById('pdfContentArea').innerHTML = '';
        renderChaptersSidebar([]);
        renderPinsOverlayAndSidebar([]);
      }
    } else {
      renderLibrarySidebar();
    }
  } catch (err) {
    alert(`Silme sırasında hata oluştu: ${String(err)}`);
  }
}

async function openNote(noteId) {
  closeSnipBubble();
  const res = await fetch(`/api/note/${encodeURIComponent(noteId)}`);
  const data = await res.json();
  if (!data.ok) {
    alert(data.error || 'Not açılamadı.');
    return;
  }

  STATE.activeNote = data;
  STATE.pdfPageTexts = {};

  document.getElementById('activeNoteHeaderTitle').textContent = data.title;
  document.getElementById('noteHeroTitle').textContent = data.title;
  document.getElementById('noteHeroSubtitle').textContent =
    data.subtitle || (data.source_path ? `Kaynak: ${data.source_path}` : '');

  const labBtn = document.getElementById('interactiveLabBtn');
  if (data.has_interactive_lab && data.lab_url) {
    labBtn.classList.remove('hidden');
    labBtn.classList.add('inline-flex');
    document.getElementById('interactiveLabIframe').src = data.lab_url;
  } else {
    labBtn.classList.add('hidden');
    labBtn.classList.remove('inline-flex');
  }

  const mdArea = document.getElementById('markdownContentArea');
  const pdfArea = document.getElementById('pdfContentArea');

  if (data.type === 'pdf') {
    mdArea.classList.add('hidden');
    pdfArea.classList.remove('hidden');
    await renderPdfDocument(data.pdf_url);
  } else {
    pdfArea.classList.add('hidden');
    mdArea.classList.remove('hidden');
    renderMarkdownWithMath(data.markdown || '', mdArea);
    mdArea.querySelectorAll('img').forEach((img) => {
      img.addEventListener('load', syncZoomSizerDimensions, { once: true });
    });
  }

  syncZoomSizerDimensions();
  renderLibrarySidebar();
  renderChaptersSidebar(data.chapters || []);
  renderPinsOverlayAndSidebar(data.pins || []);

  document.getElementById('readerScrollContainer').scrollTop = 0;
}

// ============================================================================
// MARKDOWN + KATEX + CALLOUT RENDER MOTORU
// ============================================================================
function renderMarkdownWithMath(mdText, container) {
  const mathBlocks = [];
  const mathInlines = [];

  let processed = mdText.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => {
    const idx = mathBlocks.length;
    mathBlocks.push(tex.trim());
    return `\n\n@@MATH_BLOCK_${idx}@@\n\n`;
  });

  processed = processed.replace(
    /(^|[^\\$])\$(?!\$)([^\n$]+?)\$/g,
    (match, prefix, tex) => {
      const idx = mathInlines.length;
      mathInlines.push(tex.trim());
      return `${prefix}@@MATH_INLINE_${idx}@@`;
    }
  );

  let html = marked.parse(processed, { gfm: true, breaks: false });

  html = html.replace(
    /<blockquote>\s*<p>\[!(NOTE|IMPORTANT|WARNING|TIP|CAUTION)\]\s*(?:<br>|\n)?([\s\S]*?)<\/blockquote>/gi,
    (_, type, inner) => {
      const t = type.toUpperCase();
      return `<div class="callout-box callout-${t}"><p>${inner}</div>`;
    }
  );

  html = html.replace(/@@MATH_BLOCK_(\d+)@@/g, (_, idxStr) => {
    const tex = mathBlocks[Number(idxStr)] || '';
    const rendered = katex.renderToString(tex, {
      displayMode: true,
      throwOnError: false,
      output: 'html',
    });
    return `<div class="math-token-span math-block-wrapper my-3" data-raw-latex="${escapeAttr(
      tex
    )}" data-display-mode="true">${rendered}</div>`;
  });

  html = html.replace(/@@MATH_INLINE_(\d+)@@/g, (_, idxStr) => {
    const tex = mathInlines[Number(idxStr)] || '';
    const rendered = katex.renderToString(tex, {
      displayMode: false,
      throwOnError: false,
      output: 'html',
    });
    return `<span class="math-token-span math-inline-wrapper" data-raw-latex="${escapeAttr(
      tex
    )}" data-display-mode="false">${rendered}</span>`;
  });

  container.innerHTML = html;

  container.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    const slug = slugify(h.textContent || '');
    if (slug && !h.id) h.id = slug;
  });

  container.querySelectorAll('img').forEach((img) => {
    img.decoding = 'async';
  });

  if (container.id === 'markdownContentArea') {
    markSolutionBlocksForActiveRecall(container);
    virtualizeMarkdownChunks(container);
  }
}

// ============================================================================
// 🙈 ÇÖZÜMLERİ GİZLE / BULANIKLAŞTIR (ACTIVE RECALL) MOTORU
// ============================================================================
function markSolutionBlocksForActiveRecall(container) {
  let inSolutionZone = false;
  let totalMarked = 0;

  const elements = Array.from(container.children);
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const tag = el.tagName;
    const text = (el.textContent || '').trim();

    if (tag === 'H1' || tag === 'H2' || tag === 'HR') {
      inSolutionZone = false;
      continue;
    }

    if (tag === 'H3' || tag === 'H4') {
      if (
        /(\d+\.\s*Adım|Çözüm|İspat|Hatasız Adım|İterasyon Tablosu|Tam İterasyon|Adım Adım)/i.test(
          text
        )
      ) {
        inSolutionZone = true;
      } else if (/^(Soru\s*\d+|Örnek\s*\d+|Tanım|Teorem)/i.test(text)) {
        inSolutionZone = false;
      }
      continue;
    }

    if (tag === 'P') {
      if (/^\s*(Soru|Örnek|Problem)\s*[:\d]/i.test(text)) {
        inSolutionZone = false;
        continue;
      }
      if (/^\s*(Çözüm|İspat|Yanıt|Cevap)\s*[:(\-]/i.test(text)) {
        inSolutionZone = true;
        markElementAsBlurTarget(el);
        totalMarked++;
        continue;
      }
    }

    const hasDisplayMath = el.querySelector('.math-block-wrapper') !== null;
    const isStepCallout =
      el.classList.contains('callout-box') &&
      /(Çözümü|Düzeltme|İndis|İşaret Notu)/i.test(text);

    if (inSolutionZone || hasDisplayMath || isStepCallout) {
      if (tag === 'TABLE') {
        // Tablolarda başlıkları (th) ve adım numarasını açık bırak, hesaplanan değer hücrelerini bulanıklaştır
        el.querySelectorAll('tbody tr').forEach((tr) => {
          const cells = Array.from(tr.querySelectorAll('td'));
          cells.forEach((td, idx) => {
            if (idx > 0) {
              markElementAsBlurTarget(td);
              totalMarked++;
            }
          });
        });
      } else {
        markElementAsBlurTarget(el);
        totalMarked++;
      }
    }
  }

  updateBlurBadgeCount(totalMarked);
}

function markElementAsBlurTarget(el) {
  if (!el || el.classList.contains('solution-blur-target')) return;
  el.classList.add('solution-blur-target');
  el.title = '👁️ Çözümü / adımı görmek için tıkla (Tekrar tıklarsan gizlenir)';
}

function toggleBlurSolutionsMode() {
  applyBlurSolutionsMode(!STATE.blurSolutions);
}

function applyBlurSolutionsMode(enabled) {
  STATE.blurSolutions = Boolean(enabled);
  localStorage.setItem('studylens_blur_solutions', String(STATE.blurSolutions));
  document.body.classList.toggle('blur-solutions-active', STATE.blurSolutions);

  const btn = document.getElementById('blurSolutionsToggleBtn');
  const icon = document.getElementById('blurSolutionsIcon');
  const label = document.getElementById('blurSolutionsLabel');
  const countBadge = document.getElementById('blurSolutionsCountBadge');

  if (!enabled) {
    // Mod kapatıldığında tekil açılmış olanları sıfırla ki tekrar açıldığında hepsi gizli başlasın
    document
      .querySelectorAll('#markdownContentArea .solution-blur-target.revealed')
      .forEach((el) => el.classList.remove('revealed'));
  }

  if (btn && icon && label) {
    if (STATE.blurSolutions) {
      btn.className =
        'px-2.5 py-1.5 rounded-xl text-xs font-bold border border-purple-500 bg-purple-600 text-white shadow-sm hover:bg-purple-500 transition flex items-center space-x-1.5';
      icon.textContent = '🙈';
      label.textContent = 'Çözümler Gizli';
      if (countBadge) {
        countBadge.className =
          'px-1.5 py-0.2 rounded-full text-[10px] bg-white/25 text-white font-mono';
      }
    } else {
      btn.className =
        'px-2.5 py-1.5 rounded-xl text-xs font-bold border border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-300 hover:bg-purple-500/20 transition flex items-center space-x-1.5';
      icon.textContent = '👁️';
      label.textContent = 'Çözümleri Gizle';
      if (countBadge) {
        countBadge.className = 'hidden';
      }
    }
  }
  updateBlurBadgeCount();
}

function updateBlurBadgeCount(forcedTotal) {
  const countBadge = document.getElementById('blurSolutionsCountBadge');
  if (!countBadge) return;
  const allTargets = document.querySelectorAll(
    '#markdownContentArea .solution-blur-target'
  );
  const revealedTargets = document.querySelectorAll(
    '#markdownContentArea .solution-blur-target.revealed'
  );
  const total =
    typeof forcedTotal === 'number' ? forcedTotal : allTargets.length;
  const hiddenCount = Math.max(0, total - revealedTargets.length);

  if (STATE.blurSolutions && total > 0) {
    countBadge.textContent = `${hiddenCount}/${total}`;
    countBadge.classList.remove('hidden');
  } else {
    countBadge.classList.add('hidden');
  }
}

function virtualizeMarkdownChunks(container) {
  const children = Array.from(container.children);
  if (children.length < 18) return;

  const chunks = [];
  let currentChunk = document.createElement('div');
  currentChunk.className = 'study-section-chunk';
  chunks.push(currentChunk);

  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const isBreak =
      (el.tagName === 'H1' || el.tagName === 'H2') &&
      currentChunk.childElementCount >= 4;
    const isFull = currentChunk.childElementCount >= 16;

    if (isBreak || isFull) {
      currentChunk = document.createElement('div');
      currentChunk.className = 'study-section-chunk';
      chunks.push(currentChunk);
    }
    currentChunk.appendChild(el);
  }

  container.replaceChildren(...chunks);

  // Tek seferde tüm bölüm yüksekliklerini oku, ardından tek seferde intrinsic boyutlarını kilitle
  const measuredHeights = chunks.map((c) => Math.max(120, c.offsetHeight));
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].style.containIntrinsicSize = `auto ${measuredHeights[i]}px`;
    chunks[i].classList.add('cv-auto');
  }
}

// ============================================================================
// PDF RENDER MOTORU
// ============================================================================
async function renderPdfDocument(pdfUrl) {
  const pdfArea = document.getElementById('pdfContentArea');
  pdfArea.innerHTML = `<div class="p-8 text-center text-sm text-[var(--text-muted)]">📄 PDF sayfaları yüksek çözünürlükte hazırlanıyor...</div>`;
  try {
    const loadingTask = window.pdfjsLib.getDocument(pdfUrl);
    const pdf = await loadingTask.promise;
    pdfArea.innerHTML = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.65 });

      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page-container';
      wrapper.dataset.pageNumber = String(pageNum);

      const badge = document.createElement('div');
      badge.className =
        'px-4 py-1.5 bg-slate-900 text-slate-200 text-xs font-bold flex items-center justify-between';
      badge.innerHTML = `<span>📄 Sayfa ${pageNum} / ${pdf.numPages}</span><span class="text-sky-400">Shift + Sürükle ile istediğin kısmı kırpıp sorabilirsin</span>`;
      wrapper.appendChild(badge);

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      wrapper.appendChild(canvas);
      pdfArea.appendChild(wrapper);

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const textContent = await page.getTextContent();
      STATE.pdfPageTexts[pageNum] = textContent.items.map((it) => it.str).join(' ');
    }
  } catch (err) {
    pdfArea.innerHTML = `<div class="p-6 text-red-500 text-xs font-bold">PDF yüklenirken hata: ${escapeHtml(
      String(err)
    )}</div>`;
  }
}

// ============================================================================
// 144 FPS SHIFT + EKRAN KIRPICI (SIFIR LAYOUT THRASHING, GPU TRANSLATE3D)
// ============================================================================
function setupSnippingEvents() {
  const scroller = document.getElementById('readerScrollContainer');
  const box = document.getElementById('snipSelectionBox');
  const liveBadge = document.getElementById('snipLiveBadge');

  window.addEventListener('keydown', (e) => {
    const activeTag = (document.activeElement?.tagName || '').toLowerCase();
    const isTyping = activeTag === 'textarea' || activeTag === 'input';

    if (e.key === 'Shift' && !STATE.shiftHeld) {
      if (isTyping) return;
      STATE.shiftHeld = true;
      updateSnipModeUI();
    } else if (
      (e.key === 'b' || e.key === 'B') &&
      !isTyping &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault();
      toggleBlurSolutionsMode();
    } else if (e.key === 'Escape') {
      STATE.manualSnipMode = false;
      STATE.shiftHeld = false;
      updateSnipModeUI();
      closeSnipBubble();
    }
  });

  // Çözümleri Gizle modunda bulanık bir adıma veya hücreye tıklandığında tekil aç/kapat
  scroller.addEventListener('click', (e) => {
    if (!STATE.blurSolutions) return;
    if (e.shiftKey || STATE.shiftHeld || STATE.manualSnipMode) return;
    if (
      e.target.closest('#snipBubble') ||
      e.target.closest('.study-pin-marker')
    ) {
      return;
    }
    const blurTarget = e.target.closest('.solution-blur-target');
    if (blurTarget) {
      blurTarget.classList.toggle('revealed');
      updateBlurBadgeCount();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      STATE.shiftHeld = false;
      updateSnipModeUI();
    }
  });

  window.addEventListener('blur', () => {
    STATE.shiftHeld = false;
    updateSnipModeUI();
  });

  scroller.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (
      e.target.closest('#snipBubble') ||
      e.target.closest('.study-pin-marker')
    ) {
      return;
    }

    const canSnip = e.shiftKey || STATE.shiftHeld || STATE.manualSnipMode;
    if (!canSnip) {
      if (
        document.getElementById('snipBubble').style.display === 'flex' &&
        !STATE.isAsking
      ) {
        closeSnipBubble();
      }
      return;
    }

    e.preventDefault();
    closeSnipBubble();

    // SADECE mousedown anında görünür matematik düğümlerini önbelleğe al (mousemove içinde DOM okuması = 0!)
    cacheVisibleMathNodesOnce();

    const scrollerRect = scroller.getBoundingClientRect();
    const pageX = e.clientX - scrollerRect.left + scroller.scrollLeft;
    const pageY = e.clientY - scrollerRect.top + scroller.scrollTop;

    STATE.isDraggingSnip = true;
    STATE.dragStart = {
      clientX: e.clientX,
      clientY: e.clientY,
      pageX,
      pageY,
      scrollerLeft: scrollerRect.left,
      scrollerTop: scrollerRect.top,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
    };
    STATE.latestMouse = { clientX: e.clientX, clientY: e.clientY };

    box.classList.remove('locked');
    box.style.display = 'block';
    box.style.transform = `translate3d(${pageX}px, ${pageY}px, 0)`;
    box.style.width = '2px';
    box.style.height = '2px';
    liveBadge.textContent = '✂️ Seçiliyor...';
  });

  window.addEventListener(
    'mousemove',
    (e) => {
      if (!STATE.isDraggingSnip) return;
      STATE.latestMouse.clientX = e.clientX;
      STATE.latestMouse.clientY = e.clientY;
      if (STATE.snipRafPending) return;
      STATE.snipRafPending = true;
      requestAnimationFrame(renderDragFrame144Fps);
    },
    { passive: true }
  );

  window.addEventListener('mouseup', (e) => {
    if (!STATE.isDraggingSnip) return;
    STATE.isDraggingSnip = false;
    STATE.snipRafPending = false;

    const ds = STATE.dragStart;
    const curPageX = e.clientX - ds.scrollerLeft + ds.scrollLeft;
    const curPageY = e.clientY - ds.scrollerTop + ds.scrollTop;

    const rectPage = {
      left: Math.min(ds.pageX, curPageX),
      top: Math.min(ds.pageY, curPageY),
      width: Math.abs(curPageX - ds.pageX),
      height: Math.abs(curPageY - ds.pageY),
    };

    const rectViewport = {
      left: Math.min(ds.clientX, e.clientX),
      top: Math.min(ds.clientY, e.clientY),
      right: Math.max(ds.clientX, e.clientX),
      bottom: Math.max(ds.clientY, e.clientY),
      width: Math.abs(e.clientX - ds.clientX),
      height: Math.abs(e.clientY - ds.clientY),
    };

    if (rectViewport.width < 10 && rectViewport.height < 10) {
      box.style.display = 'none';
      return;
    }

    box.classList.add('locked');
    box.style.transform = `translate3d(${rectPage.left}px, ${rectPage.top}px, 0)`;
    box.style.width = `${rectPage.width}px`;
    box.style.height = `${rectPage.height}px`;
    liveBadge.textContent = '🎯 Seçim Yakalandı • Bağlam Hazır';
    STATE.manualSnipMode = false;
    updateSnipModeUI();

    // 0ms ANINDA BALONCUK AÇILIŞI (Hiçbir html2canvas beklemesi yok!)
    finalizeSnipInstant(rectPage, rectViewport);
  });
}

function cacheVisibleMathNodesOnce() {
  const vh = window.innerHeight;
  const cache = [];
  const nodes = document.querySelectorAll('#markdownContentArea .math-token-span');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const r = el.getBoundingClientRect();
    if (r.bottom >= -100 && r.top <= vh + 100 && r.width > 0) {
      cache.push({
        el,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      });
    }
  }
  STATE.cachedViewportMath = cache;
}

function renderDragFrame144Fps() {
  STATE.snipRafPending = false;
  if (!STATE.isDraggingSnip) return;

  const box = document.getElementById('snipSelectionBox');
  const liveBadge = document.getElementById('snipLiveBadge');
  const ds = STATE.dragStart;
  const mx = STATE.latestMouse.clientX;
  const my = STATE.latestMouse.clientY;

  const curPageX = mx - ds.scrollerLeft + ds.scrollLeft;
  const curPageY = my - ds.scrollerTop + ds.scrollTop;

  const left = Math.min(ds.pageX, curPageX);
  const top = Math.min(ds.pageY, curPageY);
  const width = Math.max(4, Math.abs(curPageX - ds.pageX));
  const height = Math.max(4, Math.abs(curPageY - ds.pageY));

  // Saf GPU transform + boyut
  box.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;

  // Sıfır DOM sorgusuyla önbellekten kesişim sayısını bul (< 0.04ms)
  const vpLeft = Math.min(ds.clientX, mx);
  const vpRight = Math.max(ds.clientX, mx);
  const vpTop = Math.min(ds.clientY, my);
  const vpBottom = Math.max(ds.clientY, my);

  let hitCount = 0;
  const cache = STATE.cachedViewportMath;
  for (let i = 0; i < cache.length; i++) {
    const c = cache[i];
    if (
      !(
        c.left > vpRight ||
        c.right < vpLeft ||
        c.top > vpBottom ||
        c.bottom < vpTop
      )
    ) {
      hitCount++;
    }
  }

  if (hitCount > 0) {
    liveBadge.textContent = `✂️ ${hitCount} Matematik İfadesi + Bağlam`;
  } else {
    liveBadge.textContent = `✂️ ${Math.round(width)}×${Math.round(height)}px`;
  }
}

function toggleManualSnipMode() {
  STATE.manualSnipMode = !STATE.manualSnipMode;
  updateSnipModeUI();
}

function updateSnipModeUI() {
  const active = STATE.shiftHeld || STATE.manualSnipMode || STATE.isDraggingSnip;
  const banner = document.getElementById('snipHudBanner');
  const btn = document.getElementById('manualSnipToggleBtn');
  if (active) {
    document.body.classList.add('snipping-cursor');
    banner.classList.add('active');
    btn.classList.add('ring-2', 'ring-sky-400');
  } else {
    document.body.classList.remove('snipping-cursor');
    banner.classList.remove('active');
    btn.classList.remove('ring-2', 'ring-sky-400');
  }
}

function rectsIntersect(r1, r2) {
  return !(
    r2.left > r1.right ||
    r2.right < r1.left ||
    r2.top > r1.bottom ||
    r2.bottom < r1.top
  );
}

// ============================================================================
// ANINDA (0ms) BAĞLAM ÇIKARIMI VE HIZLI CANVAS GÖRSEL ÜRETİCİ
// ============================================================================
function finalizeSnipInstant(rectPage, rectViewport) {
  const extracted = extractDomAndMathContext(rectViewport);
  const cropDataUrl = renderInstantCropCanvas(rectViewport, extracted);

  STATE.currentSnip = {
    rectPage,
    rectViewport,
    selectedLatex: extracted.selectedLatex,
    selectedText: extracted.selectedText,
    equationFocusHint: extracted.equationFocusHint,
    sectionTitle: extracted.sectionTitle,
    cardContext: extracted.cardContext,
    cropDataUrl,
    history: [],
    pinId: null,
    isPinned: false,
  };

  openSnipBubbleUI();
}

function extractDomAndMathContext(vpRect) {
  if (STATE.activeNote && STATE.activeNote.type === 'pdf') {
    let hitPageNum = 1;
    document.querySelectorAll('.pdf-page-container').forEach((pw) => {
      const r = pw.getBoundingClientRect();
      if (rectsIntersect(vpRect, r)) {
        hitPageNum = Number(pw.dataset.pageNumber || 1);
      }
    });
    const pageText = STATE.pdfPageTexts[hitPageNum] || '';
    return {
      selectedLatex: [],
      selectedText: `(PDF Sayfa ${hitPageNum} üzerinden kırpılan alan)`,
      equationFocusHint: `PDF Sayfa ${hitPageNum} içinde seçilen dikdörtgen alan`,
      sectionTitle: `${STATE.activeNote.title} — Sayfa ${hitPageNum}`,
      cardContext: pageText || `PDF Sayfa ${hitPageNum}`,
      hitImageEl: null,
    };
  }

  const mdArea = document.getElementById('markdownContentArea');
  const selectedLatex = [];
  const subFocusParts = [];

  for (const item of STATE.cachedViewportMath) {
    if (!rectsIntersect(vpRect, item)) continue;
    const mathEl = item.el;
    const fullLatex = mathEl.getAttribute('data-raw-latex') || '';
    if (fullLatex) selectedLatex.push(fullLatex);

    const coverageRatio =
      (Math.min(vpRect.right, item.right) - Math.max(vpRect.left, item.left)) /
      Math.max(1, item.width);

    const leafTexts = [];
    mathEl
      .querySelectorAll(
        '.katex-html .mord, .katex-html .mrel, .katex-html .mbin, .katex-html .mop, .katex-html .mpunct, .katex-html .mopen, .katex-html .mclose'
      )
      .forEach((span) => {
        if (
          span.querySelector('.mord, .mrel, .mbin, .mop') &&
          !span.classList.contains('msupsub')
        ) {
          return;
        }
        const sr = span.getBoundingClientRect();
        if (sr.width === 0 && sr.height === 0) return;
        const centerX = (sr.left + sr.right) / 2;
        const centerY = (sr.top + sr.bottom) / 2;
        if (
          centerX >= vpRect.left - 4 &&
          centerX <= vpRect.right + 4 &&
          centerY >= vpRect.top - 6 &&
          centerY <= vpRect.bottom + 6
        ) {
          leafTexts.push(span.textContent);
        }
      });

    const subText = leafTexts.join('').trim();
    if (coverageRatio < 0.88 && subText) {
      subFocusParts.push(
        `Tam formül [${fullLatex}] içinde özellikle seçilen kısım: "${subText}"`
      );
    } else if (fullLatex) {
      subFocusParts.push(`Seçilen formül: [${fullLatex}]`);
    }
  }

  const hitBlocks = [];
  let primaryBlock = null;
  let hitImageEl = null;

  mdArea
    .querySelectorAll('p, li, tr, blockquote, .callout-box, h1, h2, h3, h4, pre, img')
    .forEach((blk) => {
      const r = blk.getBoundingClientRect();
      if (rectsIntersect(vpRect, r)) {
        if (!primaryBlock) primaryBlock = blk;
        if (blk.tagName === 'IMG') {
          hitImageEl = blk;
          hitBlocks.push(`[Grafik: ${blk.getAttribute('alt') || 'Desmos Grafiği'}]`);
        } else {
          const txt = (blk.innerText || '').trim();
          if (txt && !hitBlocks.includes(txt)) hitBlocks.push(txt);
        }
      }
    });

  let sectionTitle = STATE.activeNote?.title || 'Ders Notu';
  const allHeadings = Array.from(mdArea.querySelectorAll('h1, h2, h3'));
  for (const h of allHeadings) {
    const hr = h.getBoundingClientRect();
    if (hr.top <= vpRect.bottom + 20) {
      sectionTitle = (h.textContent || '').trim();
    } else {
      break;
    }
  }

  const contextParts = [];
  let anchor = primaryBlock;
  while (
    anchor &&
    anchor.parentElement &&
    anchor.parentElement !== mdArea &&
    !anchor.parentElement.classList.contains('study-section-chunk')
  ) {
    anchor = anchor.parentElement;
  }
  if (anchor && anchor.parentElement) {
    const children = Array.from(anchor.parentElement.children);
    const idx = children.indexOf(anchor);
    const startIdx = Math.max(0, idx - 3);
    const endIdx = Math.min(children.length - 1, idx + 3);
    for (let i = startIdx; i <= endIdx; i++) {
      contextParts.push(extractElementTextWithLatex(children[i]));
    }
  }

  const cardContext =
    contextParts.join('\n\n').trim() ||
    hitBlocks.join('\n').trim() ||
    (STATE.activeNote?.summary || '');

  const selectedText = hitBlocks.join(' | ').slice(0, 600);
  const equationFocusHint =
    subFocusParts.join(' ; ') ||
    (selectedText ? `Seçilen metin/adım: ${selectedText.slice(0, 180)}` : 'Görsel/Grafik seçimi');

  return {
    selectedLatex,
    selectedText,
    equationFocusHint,
    sectionTitle,
    cardContext,
    hitImageEl,
  };
}

function extractElementTextWithLatex(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll('.math-token-span').forEach((m) => {
    const raw = m.getAttribute('data-raw-latex') || '';
    const isDisp = m.getAttribute('data-display-mode') === 'true';
    m.textContent = isDisp ? ` $$${raw}$$ ` : ` $${raw}$ `;
  });
  return (clone.innerText || clone.textContent || '').trim();
}

/**
 * 144 FPS Sıfır-Donma Görsel Kırpıcı (< 2ms):
 * html2canvas gibi tüm DOM'u klonlayıp ana iş parçacığını 800ms kilitlemek yerine:
 * 1. PDF sayfasıysa doğrudan PDF <canvas>'ından piksel keser.
 * 2. Desmos SVG/PNG grafiğiyse doğrudan <img> elemanından seçilen dikdörtgeni keser.
 * 3. Formül/Metin ise yüksek çözünürlüklü tuval üzerine yakalanan LaTeX ve odak bilgisini anında çizer.
 */
function renderInstantCropCanvas(vpRect, extracted) {
  try {
    // 1. PDF Sayfası Kırpması
    if (STATE.activeNote && STATE.activeNote.type === 'pdf') {
      const canvases = document.querySelectorAll('.pdf-page-container canvas');
      for (const c of canvases) {
        const cr = c.getBoundingClientRect();
        if (rectsIntersect(vpRect, cr)) {
          const scaleX = c.width / cr.width;
          const scaleY = c.height / cr.height;
          const sx = Math.max(0, (vpRect.left - cr.left) * scaleX);
          const sy = Math.max(0, (vpRect.top - cr.top) * scaleY);
          const sw = Math.min(c.width - sx, vpRect.width * scaleX);
          const sh = Math.min(c.height - sy, vpRect.height * scaleY);
          const out = document.createElement('canvas');
          out.width = Math.max(1, Math.round(sw));
          out.height = Math.max(1, Math.round(sh));
          out.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height);
          return out.toDataURL('image/png');
        }
      }
    }

    // 2. Desmos Grafiği / Görsel Kırpması
    if (extracted.hitImageEl && extracted.hitImageEl.complete) {
      const img = extracted.hitImageEl;
      const ir = img.getBoundingClientRect();
      const natW = img.naturalWidth || ir.width || 600;
      const natH = img.naturalHeight || ir.height || 400;
      const scaleX = natW / Math.max(1, ir.width);
      const scaleY = natH / Math.max(1, ir.height);
      const sx = Math.max(0, (vpRect.left - ir.left) * scaleX);
      const sy = Math.max(0, (vpRect.top - ir.top) * scaleY);
      const sw = Math.min(natW - sx, vpRect.width * scaleX);
      const sh = Math.min(natH - sy, vpRect.height * scaleY);
      if (sw > 4 && sh > 4) {
        const out = document.createElement('canvas');
        out.width = Math.round(sw);
        out.height = Math.round(sh);
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
      }
    }

    // 3. Hızlı Vektörel Formül / Metin Kırpma Kartı (< 1.5ms)
    const out = document.createElement('canvas');
    out.width = 520;
    out.height = 180;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, out.width - 8, out.height - 8);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 14px Segoe UI, sans-serif';
    ctx.fillText(`✂️ Seçilen Adım (${extracted.sectionTitle.slice(0, 42)})`, 18, 30);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 16px Consolas, monospace';
    const mainLine =
      extracted.selectedLatex[0] ||
      extracted.equationFocusHint ||
      extracted.selectedText ||
      'Seçilen Bölge';
    ctx.fillText(mainLine.slice(0, 52), 18, 72);
    if (mainLine.length > 52) {
      ctx.fillText(mainLine.slice(52, 104), 18, 98);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px Segoe UI, sans-serif';
    ctx.fillText(extracted.equationFocusHint.slice(0, 68), 18, 145);
    return out.toDataURL('image/png');
  } catch (e) {
    return '';
  }
}

// ============================================================================
// SORU & AÇIKLAMA BALONCUĞU (TAŞINABİLİR & YENİDEN BOYUTLANDIRILABİLİR)
// ============================================================================
function setupBubbleMoveAndResizeEvents() {
  const bubble = document.getElementById('snipBubble');
  const header = document.getElementById('snipBubbleDragHeader');
  if (!bubble || !header) return;

  let moveStartX = 0;
  let moveStartY = 0;
  let origBubbleX = 0;
  let origBubbleY = 0;

  header.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button') || e.target.closest('#flashLevelPillGroup')) return;
    e.preventDefault();
    e.stopPropagation();
    STATE.isMovingBubble = true;
    moveStartX = e.clientX;
    moveStartY = e.clientY;
    origBubbleX = STATE.bubblePos.x;
    origBubbleY = STATE.bubblePos.y;
  });

  let resizeDir = '';
  let resizeStartX = 0;
  let resizeStartY = 0;
  let origW = 370;
  let origH = 320;

  bubble.querySelectorAll('.bubble-resizer').forEach((handle) => {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      STATE.isResizingBubble = true;
      resizeDir = handle.dataset.resize || 'br';
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      origW = bubble.offsetWidth || 370;
      origH = bubble.offsetHeight || 300;
      origBubbleX = STATE.bubblePos.x;
      origBubbleY = STATE.bubblePos.y;
    });
  });

  window.addEventListener(
    'mousemove',
    (e) => {
      if (STATE.isMovingBubble) {
        const dx = e.clientX - moveStartX;
        const dy = e.clientY - moveStartY;
        const nextX = Math.max(8, origBubbleX + dx);
        const nextY = Math.max(8, origBubbleY + dy);
        STATE.bubblePos.x = nextX;
        STATE.bubblePos.y = nextY;
        bubble.style.transform = `translate3d(${Math.round(nextX)}px, ${Math.round(
          nextY
        )}px, 0)`;
      } else if (STATE.isResizingBubble) {
        const dx = e.clientX - resizeStartX;
        const dy = e.clientY - resizeStartY;

        if (resizeDir.includes('r')) {
          const nw = Math.max(280, Math.min(860, origW + dx));
          STATE.bubbleSize.w = nw;
          bubble.style.width = `${Math.round(nw)}px`;
        }
        if (resizeDir.includes('l')) {
          const nw = Math.max(280, Math.min(860, origW - dx));
          const movedX = origBubbleX + (origW - nw);
          if (movedX >= 8) {
            STATE.bubbleSize.w = nw;
            STATE.bubblePos.x = movedX;
            bubble.style.width = `${Math.round(nw)}px`;
            bubble.style.transform = `translate3d(${Math.round(
              movedX
            )}px, ${Math.round(STATE.bubblePos.y)}px, 0)`;
          }
        }
        if (resizeDir.includes('b')) {
          const nh = Math.max(210, Math.min(window.innerHeight - 30, origH + dy));
          STATE.bubbleSize.h = nh;
          bubble.style.height = `${Math.round(nh)}px`;
        }
      }
    },
    { passive: true }
  );

  window.addEventListener('mouseup', () => {
    if (STATE.isResizingBubble) {
      localStorage.setItem('studylens_bubble_w', String(STATE.bubbleSize.w));
      if (STATE.bubbleSize.h > 0) {
        localStorage.setItem('studylens_bubble_h', String(STATE.bubbleSize.h));
      }
    }
    STATE.isMovingBubble = false;
    STATE.isResizingBubble = false;
  });
}

function updatePinButtonUI() {
  const snip = STATE.currentSnip;
  const pinBtn = document.getElementById('pinExplanationBtn');
  const pinText = document.getElementById('pinBtnText');
  const delBtn = document.getElementById('deleteBubbleBtn');
  if (!pinBtn || !pinText || !snip) return;

  if (delBtn) {
    if (snip.history && snip.history.length > 0) {
      delBtn.classList.remove('hidden');
    } else {
      delBtn.classList.add('hidden');
    }
  }

  if (snip.isPinned) {
    pinBtn.className =
      'px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/25 hover:bg-red-500/30 text-emerald-300 hover:text-red-200 border border-emerald-400/50 hover:border-red-400/50 transition flex items-center space-x-1';
    pinBtn.title = 'İğneyi Kaldırmak İçin Tıkla (Minik yuvarlak yine kalır)';
    pinText.textContent = 'İğnelendi ✕';
  } else {
    pinBtn.className =
      'px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 border border-emerald-400/40 transition flex items-center space-x-1';
    pinBtn.title = 'Önemli olarak işaretle / İğnele';
    pinText.textContent = 'İğnele';
  }
}

// ============================================================================
// AKILLI PRE-QUEUE (HAZIR SORU) VE FOLLOW-UP (DEVAM) ÇİPLERİ SİSTEMİ
// ============================================================================
const INITIAL_PREQUEUE_PROMPTS = [
  {
    id: 'step',
    label: "🔍 Ara adımı açıkla",
    title: "Bu eşittirden (=) sonraki adıma nasıl geçildi?",
    style:
      'bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-sky-300 border border-blue-500/25',
    prompt:
      "Bu seçtiğim '=' geçişinde veya adımda arada atlanan cebirsel/aritmetik işlemleri hiç adım atlamadan tek tek açıkla.",
  },
  {
    id: 'intuition',
    label: '👶 Sıfırdan anlat',
    title: 'Ezber formül gibi değil, sezgisel ve geometrik mantığıyla anlat',
    style:
      'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/25',
    prompt:
      'Bunu ezber bir kural gibi değil; neden böyle yaptığımızı, sezgisel ve geometrik mantığını sıfırdan başlayan birine anlatır gibi açıkla.',
  },
  {
    id: 'trap',
    label: '⚠️ Sınav tuzağı ne?',
    title: 'Hocalar buradan nasıl şaşırtır, en sık hangi işlem/işaret hatası yapılır?',
    style:
      'bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/25',
    prompt:
      'Hocalar sınavda bu kısımdan nasıl şaşırtmacalı soru sorar? Öğrenciler bu adımda en sık hangi işlem veya işaret hatasını yapar ve sağlaması nasıl yapılır?',
  },
  {
    id: 'origin',
    label: '📐 Nereden geliyor?',
    title: 'Bu formül veya kural hangi teorem/aksiyomdan türetiliyor?',
    style:
      'bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/25',
    prompt:
      'Buradaki formül, eşitlik veya kural nereden türetiliyor? Dayandığı temel teorem, tanım veya aksiyomu kısaca göster.',
  },
  {
    id: 'numeric',
    label: '🔢 Sayısal örnek ver',
    title: 'Çok basit sayılarla somut bir mini örnek üzerinde göster',
    style:
      'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/25',
    prompt:
      'Bu adımı/formülü zihnimde netleştirmem için çok basit ve küçük sayılarla somut bir mini örnek üzerinde adım adım uygula.',
  },
  {
    id: 'quiz',
    label: '🎲 Benzer sınav sorusu sor',
    title: 'Cevabı sürpriz kutusunda gizli olan sınav ayarında 1 pratik sorusu üret',
    style:
      'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/25',
    prompt:
      'Tam bu seçtiğim kısımla ilgili vize sınavı ayarında 1 adet pratik sorusu sor. Önce sadece soruyu ve ufak bir ipucunu yaz; adım adım tam çözümünü ise <details><summary>👁️ Çözümü Göster</summary> ... </details> etiketi içine gizle ki önce kendim çözmeyi deneyeyim.',
  },
];

const FOLLOWUP_PREQUEUE_PROMPTS = [
  {
    id: 'simpler',
    label: '🪶 Daha basit anlat',
    title: 'Çok daha sade ve günlük dille tekrar açıkla',
    style:
      'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/25',
    prompt:
      'Az önceki açıklamayı biraz daha basitleştirerek, hiç teknik terime boğmadan en sade haliyle anlatır mısın?',
  },
  {
    id: 'another_example',
    label: '➕ Bir örnek daha',
    title: 'Farklı sayılarla veya farklı bir durumla bir örnek daha göster',
    style:
      'bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-sky-300 border border-blue-500/25',
    prompt:
      'Pekiştirmem için farklı sayılarla (veya sınır durumu içeren) kısa bir örnek daha verir misin?',
  },
  {
    id: 'another_quiz',
    label: '🎲 1 Sınav Sorusu Sor',
    title: 'Kendimi denemem için gizli çözümlü bir soru sor',
    style:
      'bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/25',
    prompt:
      'Şimdi kendimi test etmem için bu konuyla ilgili sınav ayarında 1 soru sor. Çözümünü <details><summary>👁️ Çözümü Göster</summary> ... </details> içine gizle.',
  },
  {
    id: 'summary',
    label: '📌 2 Cümlelik Özet',
    title: 'Sınavda aklımda kalması gereken tek kural ne?',
    style:
      'bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/25',
    prompt:
      'Sınav anında bu kısımla ilgili aklımda tutmam gereken en kritik kuralı maksimum 2-3 maddede özetle.',
  },
];

function renderPrequeueChips() {
  const quickContainer = document.getElementById('bubbleQuickPrompts');
  const followContainer = document.getElementById('bubbleFollowUpPrompts');
  const snip = STATE.currentSnip;
  if (!quickContainer || !followContainer || !snip) return;

  const hasHistory = Array.isArray(snip.history) && snip.history.length > 0;
  const isGraphSelection =
    (snip.selectedText && snip.selectedText.includes('[Grafik:')) ||
    (snip.equationFocusHint && snip.equationFocusHint.includes('Grafik'));

  // Kırpılan alan bir grafikse ilk çipi grafik odaklı hale getir
  const initialList = INITIAL_PREQUEUE_PROMPTS.map((item) => {
    if (item.id === 'step' && isGraphSelection) {
      return {
        ...item,
        label: '📈 Grafiği adım adım yorumla',
        title: 'Bu grafikteki eğrileri, kesişimleri ve okları açıkla',
        prompt:
          'Bu seçtiğim grafikteki eğrilerin, teğet/kiriş çizgilerinin ve işaretli noktaların ne anlama geldiğini adım adım yorumla.',
      };
    }
    return item;
  });

  quickContainer.innerHTML = initialList
    .map(
      (item, idx) => `
      <button type="button"
              onclick="triggerPrequeueByIndex('initial', ${idx})"
              title="${escapeAttr(item.title)}"
              class="prequeue-chip ${item.style}">
        <span>${escapeHtml(item.label)}</span>
      </button>
    `
    )
    .join('');

  if (hasHistory && !STATE.isAsking) {
    followContainer.classList.remove('hidden');
    followContainer.classList.add('flex');
    followContainer.innerHTML = FOLLOWUP_PREQUEUE_PROMPTS.map(
      (item, idx) => `
        <button type="button"
                onclick="triggerPrequeueByIndex('followup', ${idx})"
                title="${escapeAttr(item.title)}"
                class="prequeue-chip ${item.style}">
          <span>${escapeHtml(item.label)}</span>
        </button>
      `
    ).join('');
  } else {
    followContainer.classList.add('hidden');
    followContainer.classList.remove('flex');
    followContainer.innerHTML = '';
  }
}

function triggerPrequeueByIndex(group, idx) {
  if (STATE.isAsking || !STATE.currentSnip) return;
  const snip = STATE.currentSnip;
  const isGraphSelection =
    (snip.selectedText && snip.selectedText.includes('[Grafik:')) ||
    (snip.equationFocusHint && snip.equationFocusHint.includes('Grafik'));

  if (group === 'followup') {
    const item = FOLLOWUP_PREQUEUE_PROMPTS[idx];
    if (item) submitQuickPrompt(item.prompt);
    return;
  }

  const item = INITIAL_PREQUEUE_PROMPTS[idx];
  if (!item) return;
  if (item.id === 'step' && isGraphSelection) {
    submitQuickPrompt(
      'Bu seçtiğim grafikteki eğrilerin, teğet/kiriş çizgilerinin ve işaretli noktaların ne anlama geldiğini adım adım yorumla.'
    );
  } else {
    submitQuickPrompt(item.prompt);
  }
}

function openSnipBubbleUI() {
  const snip = STATE.currentSnip;
  if (!snip) return;

  const bubble = document.getElementById('snipBubble');
  const previewImg = document.getElementById('bubbleCropPreviewImg');
  const previewWrap = document.getElementById('bubbleCropPreviewWrapper');
  const sectionLbl = document.getElementById('bubbleContextSectionLabel');
  const focusTag = document.getElementById('bubbleFocusTag');
  const latexPrev = document.getElementById('bubbleCapturedLatexPreview');
  const inspectorText = document.getElementById('bubbleContextInspectorText');
  const convArea = document.getElementById('bubbleConversationArea');
  const pinBtn = document.getElementById('pinExplanationBtn');
  const delBtn = document.getElementById('deleteBubbleBtn');
  const elapsedBadge = document.getElementById('bubbleElapsedTime');

  if (snip.cropDataUrl) {
    previewImg.src = snip.cropDataUrl;
    previewWrap.classList.remove('hidden');
  } else {
    previewWrap.classList.add('hidden');
  }

  sectionLbl.textContent = `📍 ${snip.sectionTitle}`;
  focusTag.textContent =
    snip.selectedLatex.length > 0
      ? `🎯 ${snip.selectedLatex.length} Formül + Bağlam`
      : `🎯 Seçilen Alan`;

  latexPrev.textContent =
    snip.equationFocusHint ||
    snip.selectedLatex.join(' | ') ||
    snip.selectedText ||
    'Görsel kırpma hazır';

  inspectorText.textContent =
    `[Bölüm]: ${snip.sectionTitle}\n` +
    `[Odak]: ${snip.equationFocusHint}\n` +
    `[LaTeX]: ${snip.selectedLatex.join(' ; ') || '(yok)'}\n` +
    `[Çevresel Bağlam]:\n${(snip.cardContext || '').slice(0, 900)}`;

  if (STATE.bubbleSize.w >= 280) {
    bubble.style.width = `${STATE.bubbleSize.w}px`;
  }

  if (snip.history && snip.history.length > 0) {
    renderBubbleConversation();
    pinBtn.classList.remove('hidden');
    if (delBtn) delBtn.classList.remove('hidden');
    updatePinButtonUI();
    if (STATE.bubbleSize.h >= 210) {
      bubble.style.height = `${STATE.bubbleSize.h}px`;
    } else {
      bubble.style.height = 'auto';
    }
  } else {
    convArea.innerHTML = '';
    convArea.classList.add('hidden');
    pinBtn.classList.add('hidden');
    if (delBtn) delBtn.classList.add('hidden');
    elapsedBadge.classList.add('hidden');
    bubble.style.height = 'auto';
  }

  renderPrequeueChips();

  bubble.style.display = 'flex';
  positionBubbleNearSelection(snip.rectPage);

  const input = document.getElementById('bubbleQuestionInput');
  input.value = '';
  input.focus();
}

function positionBubbleNearSelection(rectPage) {
  const scroller = document.getElementById('readerScrollContainer');
  const bubble = document.getElementById('snipBubble');
  const bubbleW = STATE.bubbleSize.w || 370;
  const gap = 12;

  const scrollerW = scroller.clientWidth;
  const rightCandidate = rectPage.left + rectPage.width + gap;
  const leftCandidate = rectPage.left - bubbleW - gap;

  let left = rightCandidate;
  let top = rectPage.top;

  if (rightCandidate + bubbleW <= scroller.scrollLeft + scrollerW - 14) {
    left = rightCandidate;
  } else if (leftCandidate >= scroller.scrollLeft + 14) {
    left = leftCandidate;
  } else {
    left = Math.max(
      14,
      Math.min(
        scroller.scrollLeft + scrollerW - bubbleW - 18,
        rectPage.left + rectPage.width / 2 - bubbleW / 2
      )
    );
    top = rectPage.top + rectPage.height + gap;
  }

  STATE.bubblePos.x = Math.max(10, Math.round(left));
  STATE.bubblePos.y = Math.max(10, Math.round(top));
  bubble.style.transform = `translate3d(${STATE.bubblePos.x}px, ${STATE.bubblePos.y}px, 0)`;
}

function closeSnipBubble() {
  document.getElementById('snipBubble').style.display = 'none';
  document.getElementById('snipSelectionBox').style.display = 'none';
  document.getElementById('bubbleContextInspector').classList.add('hidden');
}

function toggleContextInspector() {
  document.getElementById('bubbleContextInspector').classList.toggle('hidden');
}

function handleBubbleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitBubbleQuestion();
  }
}

function submitQuickPrompt(promptText) {
  const input = document.getElementById('bubbleQuestionInput');
  input.value = promptText;
  submitBubbleQuestion();
}

async function submitBubbleQuestion() {
  if (STATE.isAsking || !STATE.currentSnip) return;
  const input = document.getElementById('bubbleQuestionInput');
  const question =
    input.value.trim() ||
    "Bu seçtiğim '=' geçişini ve nereden geldiğini adım adım açıklar mısın?";
  input.value = '';

  const flashLevel = STATE.flashLevel || 'medium';

  const snip = STATE.currentSnip;
  const priorHistory = [...snip.history];
  snip.history.push({ role: 'user', content: question });
  STATE.isAsking = true;
  renderPrequeueChips();
  renderBubbleConversation(true);

  const submitBtn = document.getElementById('bubbleAskSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="animate-spin inline-block">⏳</span>`;

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note_id: STATE.activeNote?.id || '',
        note_title: STATE.activeNote?.title || '',
        section_title: snip.sectionTitle,
        doc_summary: STATE.activeNote?.summary || '',
        card_context: snip.cardContext,
        selected_latex: snip.selectedLatex,
        selected_text: snip.selectedText,
        equation_focus_hint: snip.equationFocusHint,
        crop_image_base64: snip.cropDataUrl,
        question,
        history: priorHistory,
        flash_level: flashLevel,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      snip.history.push({
        role: 'assistant',
        content: `⚠️ **Hata:** ${data.error || 'Yanıt alınamadı.'}`,
      });
    } else {
      snip.history.push({
        role: 'assistant',
        content: data.answer,
      });

      const elapsedBadge = document.getElementById('bubbleElapsedTime');
      elapsedBadge.textContent = `${(data.elapsed_ms / 1000).toFixed(1)} sn`;
      elapsedBadge.classList.remove('hidden');

      const pinBtn = document.getElementById('pinExplanationBtn');
      pinBtn.classList.remove('hidden');
      const delBtn = document.getElementById('deleteBubbleBtn');
      if (delBtn) delBtn.classList.remove('hidden');
      updatePinButtonUI();

      // Cevap geldiği anda otomatik olarak kalıcı kaydet (böylece yanlışlıkla kapatılsa bile minik yuvarlak olarak kalır)
      await pinCurrentBubbleToNote(true);
    }
  } catch (err) {
    snip.history.push({
      role: 'assistant',
      content: `⚠️ **Bağlantı Hatası:** ${String(err)}`,
    });
  } finally {
    STATE.isAsking = false;
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Sor</span><span>↵</span>`;
    renderPrequeueChips();
    renderBubbleConversation(false);
  }
}

function renderBubbleConversation(isWaiting = false) {
  const convArea = document.getElementById('bubbleConversationArea');
  const snip = STATE.currentSnip;
  if (!snip || (!snip.history.length && !isWaiting)) {
    convArea.classList.add('hidden');
    return;
  }
  convArea.classList.remove('hidden');

  const htmlParts = snip.history.map((msg) => {
    if (msg.role === 'user') {
      return `
        <div class="flex justify-end">
          <div class="max-w-[88%] px-2.5 py-1.5 rounded-xl rounded-tr-sm bg-blue-600 text-white text-xs font-medium">
            ${escapeHtml(msg.content)}
          </div>
        </div>
      `;
    } else {
      const renderedHolder = document.createElement('div');
      renderMarkdownWithMath(msg.content, renderedHolder);
      return `
        <div class="p-2.5 rounded-xl rounded-tl-sm bg-[var(--bg-card)] border border-[var(--border-color)] text-xs leading-relaxed markdown-body">
          ${renderedHolder.innerHTML}
        </div>
      `;
    }
  });

  if (isWaiting) {
    htmlParts.push(`
      <div class="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/25 text-xs text-sky-600 dark:text-sky-300 flex items-center space-x-2">
        <span class="w-2 h-2 rounded-full bg-sky-500 animate-ping"></span>
        <span class="font-semibold">Seçilen adım inceleniyor...</span>
      </div>
    `);
  }

  convArea.innerHTML = htmlParts.join('');
  convArea.scrollTop = convArea.scrollHeight;
}

// ============================================================================
// OTOMATİK KAYIT (MİNİK YUVARLAK NOKTA) VE İĞNELEME / SİLME SİSTEMİ
// ============================================================================
async function togglePinCurrentBubble() {
  const snip = STATE.currentSnip;
  if (!snip || !STATE.activeNote || !snip.history.length) return;

  snip.isPinned = !snip.isPinned;
  updatePinButtonUI();
  await pinCurrentBubbleToNote(false);
}

async function deleteCurrentBubbleCompletely() {
  const snip = STATE.currentSnip;
  if (!snip) return;
  if (snip.pinId) {
    await deleteSavedPin(snip.pinId, true);
  } else {
    closeSnipBubble();
  }
}

async function pinCurrentBubbleToNote(silent = false) {
  const snip = STATE.currentSnip;
  if (!snip || !STATE.activeNote || !snip.history.length) return;

  const pinPayload = {
    id: snip.pinId || `pin_${Date.now()}`,
    isPinned: Boolean(snip.isPinned),
    rectPage: snip.rectPage,
    sectionTitle: snip.sectionTitle,
    selectedLatex: snip.selectedLatex,
    selectedText: snip.selectedText,
    equationFocusHint: snip.equationFocusHint,
    cardContext: snip.cardContext,
    cropDataUrl: snip.cropDataUrl,
    history: snip.history,
  };

  const res = await fetch('/api/pins/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      note_id: STATE.activeNote.id,
      pin: pinPayload,
    }),
  });
  const data = await res.json();
  if (data.ok) {
    snip.pinId = data.pin.id;
    STATE.activeNote.pins = data.pins;
    renderPinsOverlayAndSidebar(data.pins);
    await loadLibrary(false);
    if (!silent) {
      updatePinButtonUI();
    }
  }
}

function renderPinsOverlayAndSidebar(pins) {
  const badge = document.getElementById('sidebarPinCountBadge');
  badge.textContent = String(pins.length || 0);

  const scroller = document.getElementById('readerScrollContainer');
  scroller.querySelectorAll('.study-pin-marker').forEach((el) => el.remove());

  // Sayfa üzerinde her kaydedilen soru-cevap için hiçbir yazı veya hover ipucu olmayan sade minik bir yuvarlak nokta
  pins.forEach((pin) => {
    const marker = document.createElement('div');
    marker.className = pin.isPinned
      ? 'study-pin-marker is-pinned'
      : 'study-pin-marker';
    const top = pin.rectPage?.top || 120;
    const left = Math.max(
      12,
      (pin.rectPage?.left || 100) + (pin.rectPage?.width || 80) + 8
    );
    marker.style.top = `${top}px`;
    marker.style.left = `${left}px`;
    marker.onclick = (e) => {
      e.stopPropagation();
      openSavedPin(pin);
    };
    scroller.appendChild(marker);
  });

  const listEl = document.getElementById('pinsListContainer');
  if (!pins.length) {
    listEl.innerHTML = `<div class="p-4 text-xs text-[var(--text-muted)] text-center leading-relaxed">Henüz bu notta kayıtlı bir soru-cevap baloncuğu yok.</div>`;
    return;
  }

  listEl.innerHTML = pins
    .map((pin, idx) => {
      const firstQ =
        pin.history?.find((h) => h.role === 'user')?.content || 'Soru';
      const icon = pin.isPinned ? '📌' : '🔵';
      return `
        <div class="p-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] hover:border-blue-500/60 transition space-y-1">
          <div class="flex items-center justify-between">
            <button onclick="openSavedPinById('${pin.id}')" class="text-xs font-extrabold ${
              pin.isPinned
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-blue-600 dark:text-sky-400'
            } hover:underline truncate">
              ${icon} #${idx + 1} • ${escapeHtml(pin.sectionTitle || 'Bölüm')}
            </button>
            <button onclick="deleteSavedPin('${pin.id}', true)" class="text-[11px] text-red-400 hover:text-red-500 px-1" title="Tamamen Sil">🗑️</button>
          </div>
          <div onclick="openSavedPinById('${pin.id}')" class="cursor-pointer text-xs text-[var(--text-main)] font-medium line-clamp-2">
            "${escapeHtml(firstQ)}"
          </div>
          <div class="text-[10px] text-[var(--text-muted)] font-mono truncate">
            ${escapeHtml(pin.equationFocusHint || '')}
          </div>
        </div>
      `;
    })
    .join('');
}

function openSavedPinById(pinId) {
  const pin = (STATE.activeNote?.pins || []).find((p) => p.id === pinId);
  if (pin) openSavedPin(pin);
}

function openSavedPin(pin) {
  const scroller = document.getElementById('readerScrollContainer');
  const box = document.getElementById('snipSelectionBox');
  const liveBadge = document.getElementById('snipLiveBadge');

  const rectPage = pin.rectPage || { left: 120, top: 200, width: 180, height: 48 };
  const curTop = scroller.scrollTop;
  const curBot = curTop + scroller.clientHeight;
  if (rectPage.top < curTop + 40 || rectPage.top > curBot - 80) {
    scroller.scrollTop = Math.max(0, rectPage.top - 140);
  }

  box.classList.add('locked');
  box.style.display = 'block';
  box.style.transform = `translate3d(${rectPage.left}px, ${rectPage.top}px, 0)`;
  box.style.width = `${rectPage.width}px`;
  box.style.height = `${rectPage.height}px`;
  liveBadge.textContent = pin.isPinned ? `📌 İğneli` : `🎯 Seçilen Alan`;

  STATE.currentSnip = {
    rectPage,
    rectViewport: rectPage,
    selectedLatex: pin.selectedLatex || [],
    selectedText: pin.selectedText || '',
    equationFocusHint: pin.equationFocusHint || '',
    sectionTitle: pin.sectionTitle || STATE.activeNote?.title || '',
    cardContext: pin.cardContext || '',
    cropDataUrl: pin.cropDataUrl || '',
    history: [...(pin.history || [])],
    pinId: pin.id,
    isPinned: Boolean(pin.isPinned),
  };

  openSnipBubbleUI();
}

async function deleteSavedPin(pinId, closeIfActive = true) {
  if (!STATE.activeNote) return;
  const res = await fetch('/api/pins/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note_id: STATE.activeNote.id, pin_id: pinId }),
  });
  const data = await res.json();
  if (data.ok) {
    STATE.activeNote.pins = data.pins;
    renderPinsOverlayAndSidebar(data.pins);
    await loadLibrary(false);
    if (STATE.currentSnip && STATE.currentSnip.pinId === pinId) {
      STATE.currentSnip.pinId = null;
      STATE.currentSnip.isPinned = false;
      updatePinButtonUI();
      if (closeIfActive) {
        closeSnipBubble();
      }
    }
  }
}

// ============================================================================
// ÖRNEK "=" KIRPMASI DENE
// ============================================================================
function triggerDemoSnipOnFirstFormula() {
  const scroller = document.getElementById('readerScrollContainer');
  const mathBlocks = Array.from(
    document.querySelectorAll('#markdownContentArea .math-block-wrapper')
  );
  const target =
    mathBlocks[0] ||
    document.querySelector('#markdownContentArea .math-token-span');
  if (!target) return;

  target.scrollIntoView({ block: 'center' });
  cacheVisibleMathNodesOnce();

  const scrollerRect = scroller.getBoundingClientRect();
  const tr = target.getBoundingClientRect();

  const vpRect = {
    left: tr.left + tr.width * 0.35,
    top: tr.top - 4,
    right: tr.right + 6,
    bottom: tr.bottom + 4,
    width: tr.width * 0.65 + 6,
    height: tr.height + 8,
  };

  const rectPage = {
    left: vpRect.left - scrollerRect.left + scroller.scrollLeft,
    top: vpRect.top - scrollerRect.top + scroller.scrollTop,
    width: vpRect.width,
    height: vpRect.height,
  };

  const box = document.getElementById('snipSelectionBox');
  box.classList.add('locked');
  box.style.display = 'block';
  box.style.transform = `translate3d(${rectPage.left}px, ${rectPage.top}px, 0)`;
  box.style.width = `${rectPage.width}px`;
  box.style.height = `${rectPage.height}px`;
  document.getElementById('snipLiveBadge').textContent =
    "🎯 '=' Sonrası Adım Seçildi";

  finalizeSnipInstant(rectPage, vpRect);
}

// ============================================================================
// YAN PANEL, ARAMA, TEMA VE DOSYA YÜKLEME YARDIMCILARI
// ============================================================================
function renderChaptersSidebar(chapters) {
  const container = document.getElementById('chaptersListContainer');
  if (!chapters.length) {
    container.innerHTML = `<div class="p-3 text-xs text-[var(--text-muted)]">Bölüm başlığı bulunamadı.</div>`;
    return;
  }
  container.innerHTML = chapters
    .map((ch) => {
      const pad =
        ch.level === 1
          ? 'font-bold text-[var(--text-main)]'
          : 'pl-4 text-[var(--text-secondary)]';
      return `
        <button onclick="scrollToChapter('${escapeAttr(ch.slug)}')"
                class="w-full text-left px-2 py-1.5 rounded-lg text-xs hover:bg-blue-500/10 hover:text-blue-500 transition truncate block ${pad}">
          ${escapeHtml(ch.title)}
        </button>
      `;
    })
    .join('');
}

function scrollToChapter(slug) {
  const el = document.getElementById(slug);
  if (el) {
    el.scrollIntoView({ block: 'start' });
  }
}

function switchSidebarTab(tab) {
  ['library', 'chapters', 'pins'].forEach((t) => {
    const btn = document.getElementById(`sideTabBtn-${t}`);
    const panel = document.getElementById(`sidePanel-${t}`);
    if (t === tab) {
      btn.className =
        'py-1.5 px-2 rounded-lg text-xs font-bold bg-blue-600 text-white shadow-sm transition flex items-center justify-center space-x-1';
      panel.classList.remove('hidden');
    } else {
      btn.className =
        'py-1.5 px-2 rounded-lg text-xs font-semibold text-[var(--text-secondary)] hover:bg-slate-500/10 transition flex items-center justify-center space-x-1';
      panel.classList.add('hidden');
    }
  });
}

function toggleSidebar() {
  document.getElementById('leftSidebar').classList.toggle('hidden');
}

function toggleTheme() {
  applyTheme(STATE.theme === 'light' ? 'dark' : 'light');
}

function applyTheme(theme) {
  STATE.theme = theme;
  localStorage.setItem('studylens_theme', theme);
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add(`theme-${theme}`);
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.getElementById('themeIcon').textContent =
    theme === 'light' ? '🌙' : '☀️';
}

function filterInNote(query) {
  const q = (query || '').trim().toLowerCase();
  const mdArea = document.getElementById('markdownContentArea');
  if (!q) return;
  const targets = Array.from(
    mdArea.querySelectorAll('h1, h2, h3, h4, p, li, td, blockquote')
  );
  const hit = targets.find((el) =>
    (el.textContent || '').toLowerCase().includes(q)
  );
  if (hit) {
    hit.scrollIntoView({ block: 'center' });
    const prevBg = hit.style.backgroundColor;
    hit.style.backgroundColor = 'rgba(14, 165, 233, 0.25)';
    setTimeout(() => {
      hit.style.backgroundColor = prevBg;
    }, 1000);
  }
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        content_base64: reader.result,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      STATE.library = data.items || [];
      renderLibrarySidebar();
      await openNote(data.note_id);
    } else {
      alert(data.error || 'Yükleme başarısız.');
    }
  };
  reader.readAsDataURL(file);
}

function toggleInteractiveLabModal() {
  const modal = document.getElementById('interactiveLabModal');
  modal.classList.toggle('hidden');
  modal.classList.toggle('flex');
}

function openHelpModal() {
  const modal = document.getElementById('helpModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeHelpModal() {
  const modal = document.getElementById('helpModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9ğüşıöçĞÜŞİÖÇ]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
