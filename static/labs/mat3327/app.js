// MAT3327 Ayrık Matematik Master Portal Controller

let currentBits = [0, 0, 0, 0, 0, 0, 0, 0]; // 8 bits: MSB at index 0, LSB at index 7

document.addEventListener('DOMContentLoaded', () => {
  initBitboard();
  renderMath();
  runBoothSimulation();
  initScrollProgress();
});

// Reading Progress Bar
function initScrollProgress() {
  const main = document.getElementById('mainContent');
  const bar = document.getElementById('readingProgress');
  if (main && bar) {
    main.addEventListener('scroll', () => {
      const total = main.scrollHeight - main.clientHeight;
      if (total > 0) {
        const pct = (main.scrollTop / total) * 100;
        bar.style.width = pct + '%';
      }
    });
  }
}

// Render LaTeX via KaTeX
function renderMath() {
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(document.body, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
  }
}

// Tab Switching
function switchTab(tabId) {
  // Hide all tabs
  document.querySelectorAll('.tab-pane').forEach(el => {
    el.classList.remove('active');
    el.classList.add('hidden');
  });

  // Deactivate all buttons
  document.querySelectorAll('.nav-pill').forEach(btn => {
    btn.classList.remove('active');
  });

  // Activate chosen tab
  const targetTab = document.getElementById(tabId);
  if (targetTab) {
    targetTab.classList.remove('hidden');
    targetTab.classList.add('active');
  }

  // Activate button
  const activeBtn = document.getElementById(`btn-${tabId}`);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }

  // Re-render math in active pane
  setTimeout(() => renderMath(), 50);

  // Scroll to top of main content
  const main = document.getElementById('mainContent');
  if (main) main.scrollTop = 0;
}

// Search functionality
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) return;

    // Search in all panes
    const panes = document.querySelectorAll('.tab-pane');
    for (const pane of panes) {
      if (pane.innerText.toLowerCase().includes(query)) {
        switchTab(pane.id);
        break;
      }
    }
  });
}

// ----------------------------------------------------
// INTERACTIVE 8-BIT BITBOARD
// ----------------------------------------------------
function initBitboard() {
  const container = document.getElementById('bitboardButtons');
  if (!container) return;

  container.innerHTML = '';
  currentBits.forEach((bit, index) => {
    const btn = document.createElement('button');
    btn.id = `bit-${index}`;
    btn.className = `bit-btn py-3 sm:py-4 rounded-xl border text-base sm:text-xl font-bold transition flex flex-col items-center justify-center ${
      bit === 1 
        ? 'active bg-gradient-to-b from-sky-500 to-sky-700 text-white border-sky-400 shadow-lg shadow-sky-500/30' 
        : 'bg-black/40 text-slate-500 border-white/10 hover:border-white/30'
    }`;
    btn.innerHTML = `
      <span>${bit}</span>
      <span class="text-[9px] font-mono text-slate-400 mt-1 font-normal">2<sup>${7 - index}</sup></span>
    `;
    btn.onclick = () => toggleBit(index);
    container.appendChild(btn);
  });

  updateBitboardOutputs();
}

function toggleBit(index) {
  currentBits[index] = currentBits[index] === 1 ? 0 : 1;
  const btn = document.getElementById(`bit-${index}`);
  if (btn) {
    const bit = currentBits[index];
    if (bit === 1) {
      btn.className = 'bit-btn active py-3 sm:py-4 rounded-xl border text-base sm:text-xl font-bold transition flex flex-col items-center justify-center bg-gradient-to-b from-sky-500 to-sky-700 text-white border-sky-400 shadow-lg shadow-sky-500/30';
    } else {
      btn.className = 'bit-btn py-3 sm:py-4 rounded-xl border text-base sm:text-xl font-bold transition flex flex-col items-center justify-center bg-black/40 text-slate-500 border-white/10 hover:border-white/30';
    }
    btn.innerHTML = `
      <span>${bit}</span>
      <span class="text-[9px] font-mono text-slate-400 mt-1 font-normal">2<sup>${7 - index}</sup></span>
    `;
  }
  updateBitboardOutputs();
}

function resetBitboard(val) {
  const bitVal = val === 255 ? 1 : 0;
  currentBits = [bitVal, bitVal, bitVal, bitVal, bitVal, bitVal, bitVal, bitVal];
  initBitboard();
}

function updateBitboardOutputs() {
  const binStr = currentBits.join('');
  const unsignedVal = parseInt(binStr, 2);
  
  // Signed 2's Complement (8-bit)
  let signedVal = unsignedVal;
  if (currentBits[0] === 1) {
    signedVal = unsignedVal - 256;
  }

  // Hexadecimal
  const hexVal = '0x' + unsignedVal.toString(16).toUpperCase().padStart(2, '0');

  // Inverted (1's complement)
  const onesCompStr = currentBits.map(b => (b === 1 ? '0' : '1')).join('');

  const elUnsigned = document.getElementById('bitUnsigned');
  const elSigned = document.getElementById('bitSigned');
  const elHex = document.getElementById('bitHex');
  const elOnesComp = document.getElementById('bitOnesComp');

  if (elUnsigned) elUnsigned.innerText = unsignedVal;
  if (elSigned) {
    elSigned.innerText = signedVal;
    elSigned.className = signedVal < 0 ? 'text-lg font-bold text-rose-400' : 'text-lg font-bold text-emerald-400';
  }
  if (elHex) elHex.innerText = hexVal;
  if (elOnesComp) elOnesComp.innerText = onesCompStr;
}

// ----------------------------------------------------
// SIMULATOR: BOOTH MULTIPLICATION (4-BIT)
// ----------------------------------------------------
function to4BitTwosComp(val) {
  if (val < 0) {
    val = (16 + val) & 0xF;
  }
  return (val & 0xF).toString(2).padStart(4, '0');
}

function add4Bit(binA, binB) {
  const sum = (parseInt(binA, 2) + parseInt(binB, 2)) & 0xF;
  return sum.toString(2).padStart(4, '0');
}

function runBoothSimulation() {
  const mVal = parseInt(document.getElementById('simM').value) || 0;
  const qVal = parseInt(document.getElementById('simQ').value) || 0;
  const container = document.getElementById('boothOutput');

  if (!container) return;

  if (mVal < -8 || mVal > 7 || qVal < -8 || qVal > 7) {
    container.innerHTML = `<div class="p-3 bg-rose-950/40 text-rose-300 text-xs rounded-xl border border-rose-800">
      Lütfen 4-bitlik işaretli aralıkta [-8 ile +7] sayılar girin!
    </div>`;
    return;
  }

  const M = to4BitTwosComp(mVal);
  const negM = to4BitTwosComp(-mVal);
  let A = '0000';
  let Q = to4BitTwosComp(qVal);
  let Q_1 = '0';
  const expectedProduct = mVal * qVal;

  let rowsHtml = `
    <tr class="bg-slate-950 text-slate-400">
      <td class="p-3 font-bold text-sky-400">Başlangıç</td>
      <td class="p-3 font-mono font-bold text-white">${A}</td>
      <td class="p-3 font-mono font-bold text-white">${Q}</td>
      <td class="p-3 text-center font-mono font-bold text-slate-400">${Q_1}</td>
      <td class="p-3 text-center">-</td>
      <td class="p-3 text-slate-400">Kayıtlar başlatıldı (M = ${M}, -M = ${negM})</td>
    </tr>
  `;

  for (let cycle = 1; cycle <= 4; cycle++) {
    const q0 = Q[3];
    const pair = q0 + Q_1;
    let opDesc = '';

    if (pair === '10') {
      A = add4Bit(A, negM);
      opDesc = `A = A - M (${A})`;
      rowsHtml += `
        <tr class="bg-rose-950/20 text-rose-300">
          <td class="p-3 font-bold">${cycle}. Döngü (İşlem)</td>
          <td class="p-3 font-mono font-bold text-rose-300">${A}</td>
          <td class="p-3 font-mono">${Q}</td>
          <td class="p-3 text-center font-mono">${Q_1}</td>
          <td class="p-3 text-center font-bold text-rose-400">${pair}</td>
          <td class="p-3">${opDesc}</td>
        </tr>
      `;
    } else if (pair === '01') {
      A = add4Bit(A, M);
      opDesc = `A = A + M (${A})`;
      rowsHtml += `
        <tr class="bg-emerald-950/20 text-emerald-300">
          <td class="p-3 font-bold">${cycle}. Döngü (İşlem)</td>
          <td class="p-3 font-mono font-bold text-emerald-300">${A}</td>
          <td class="p-3 font-mono">${Q}</td>
          <td class="p-3 text-center font-mono">${Q_1}</td>
          <td class="p-3 text-center font-bold text-emerald-400">${pair}</td>
          <td class="p-3">${opDesc}</td>
        </tr>
      `;
    } else {
      opDesc = 'İşlem yok (Yalnızca ASR)';
      rowsHtml += `
        <tr class="bg-slate-900/30 text-slate-400">
          <td class="p-3">${cycle}. Döngü</td>
          <td class="p-3 font-mono">${A}</td>
          <td class="p-3 font-mono">${Q}</td>
          <td class="p-3 text-center font-mono">${Q_1}</td>
          <td class="p-3 text-center">${pair}</td>
          <td class="p-3">${opDesc}</td>
        </tr>
      `;
    }

    // ASR
    const newQ_1 = Q[3];
    const newQ = A[3] + Q.slice(0, 3);
    const newA = A[0] + A.slice(0, 3);

    A = newA;
    Q = newQ;
    Q_1 = newQ_1;

    rowsHtml += `
      <tr class="bg-slate-950/90 border-b border-white/5 text-sky-200">
        <td class="p-3 text-sky-400 pl-5 font-mono">↳ ASR</td>
        <td class="p-3 font-mono font-bold text-white">${A}</td>
        <td class="p-3 font-mono font-bold text-white">${Q}</td>
        <td class="p-3 text-center font-mono font-bold text-amber-300">${Q_1}</td>
        <td class="p-3 text-center">-</td>
        <td class="p-3 text-slate-400">Sağa 1-bit kaydırıldı (MSB korundu)</td>
      </tr>
    `;
  }

  const finalBinary = A + Q;
  let finalDec = parseInt(finalBinary, 2);
  if (finalBinary[0] === '1') {
    finalDec -= 256;
  }

  container.innerHTML = `
    <div class="overflow-x-auto rounded-xl border border-white/10 glass">
      <table class="w-full text-xs font-mono text-left">
        <thead class="bg-slate-950 text-slate-400 border-b border-white/10">
          <tr>
            <th class="p-3">Aşama</th>
            <th class="p-3">Akümülatör (A)</th>
            <th class="p-3">Çarpan (Q)</th>
            <th class="p-3 text-center">Q₋₁</th>
            <th class="p-3 text-center">Q₀ Q₋₁</th>
            <th class="p-3">Açıklama</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-white/5">
          ${rowsHtml}
        </tbody>
      </table>
    </div>

    <div class="p-4 rounded-xl bg-gradient-to-r from-emerald-950/30 via-slate-900 to-teal-950/30 border border-emerald-500/30 flex flex-col sm:flex-row items-center justify-between text-xs font-mono gap-3 shadow-lg">
      <div>
        <span class="text-slate-400">Kayıt Çıkışı [A][Q]: </span>
        <strong class="text-emerald-400 text-sm tracking-wider">${finalBinary}₂</strong>
      </div>
      <div>
        <span class="text-slate-400">Hexadecimal: </span>
        <strong class="text-sky-300">0x${(parseInt(finalBinary, 2) & 0xFF).toString(16).toUpperCase().padStart(2, '0')}</strong>
      </div>
      <div>
        <span class="text-slate-400">Decimal Sonuç: </span>
        <strong class="text-amber-300 text-sm">${finalDec}₁₀</strong>
        <span class="text-slate-500 ml-1.5">(Beklenen: ${expectedProduct})</span>
      </div>
    </div>
  `;
}
