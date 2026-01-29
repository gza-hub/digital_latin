/* =========================================================
   PVE – Egyéni útvonal (SPA jellegű, adatvezérelt)
   - 1 pve.html
   - JSON írja le a városokat, feladatokat, szótárt
   - localStorage tárolja a haladást
   ========================================================= */

/** Hol vannak az adatfájlok? */
const MAP_FILE = "data/map.json";

/** localStorage kulcs a mentéshez */
const STORAGE_KEY = "pve_progress_v1";

/** Egyszerű "állapotgép" */
const state = {
  view: "map",        // "map" | "city"
  map: null,          // map.json tartalma
  currentCityId: null,
  currentCityData: null, // city_cityX.json tartalma
  progress: null         // mentett haladás objektum
};

let mapResizeObserver = null;

/* -----------------------------
   DOM elemek gyors elérése
------------------------------ */
const elViewMap = document.getElementById("viewMap");
const elViewCity = document.getElementById("viewCity");
const elMapLayer = document.getElementById("mapLayer");
const elHudTitle = document.getElementById("hudTitle");
const elHudSub = document.getElementById("hudSub");

const btnBack = document.getElementById("btnBack");
const btnMap = document.getElementById("btnMap");
const btnReset = document.getElementById("btnReset");

const elCityTitle = document.getElementById("cityTitle");
const btnExitCity = document.getElementById("btnExitCity");
const hsTemple = document.getElementById("hsTemple");
const hsPractice = document.getElementById("hsPractice");
const hsExam = document.getElementById("hsExam");

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");

/* -----------------------------
   Indítás
------------------------------ */
init();

async function init() {
  try {
    state.progress = loadProgress();
    state.map = await fetchJson(MAP_FILE);
    await loadMapImageNaturalSize();

    // ✅ védőellenőrzés
    if (!state.map || !Array.isArray(state.map.cities)) {
      throw new Error("map.json hiba: hiányzik a 'cities' tömb. (pl. { cities: [...] })");
    }

    ensureFirstCityUnlocked();
    wireUi();
    renderMap();
    showView("map");
  } catch (err) {
    // ✅ látható hibaüzenet a képernyőn is
    console.error(err);
    openModal("Hiba", `<p>${escapeHtml(err.message)}</p><p>Nézd meg a Console-t (F12) részletekért.</p>`);
  }

  mapResizeObserver.observe(elMapWrap);
}

/* -----------------------------
   UI események
------------------------------ */
function wireUi() {
  btnBack.addEventListener("click", () => history.back());

  btnMap.addEventListener("click", () => {
    // városból vissza térkép
    showView("map");
    renderMap();
  });

  btnReset.addEventListener("click", () => {
    if (confirm("Biztosan törlöd a haladást?")) {
      localStorage.removeItem(STORAGE_KEY);
      state.progress = loadProgress();
      ensureFirstCityUnlocked();
      showView("map");
      renderMap();
    }
  });

  btnExitCity.addEventListener("click", () => {
    showView("map");
    renderMap();
  });

  // Város épületek
  hsTemple.addEventListener("click", openDictionary);
  hsPractice.addEventListener("click", openPractice);
  hsExam.addEventListener("click", openExam);

  modalClose.addEventListener("click", closeModal);

  // ESC bezárja a modált
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

/* -----------------------------
   Nézetváltás
------------------------------ */
function showView(view) {
  state.view = view;

  if (view === "map") {
    elViewMap.classList.remove("hidden");
    elViewCity.classList.add("hidden");
    elHudTitle.textContent = "Térkép";
    elHudSub.textContent = "Válassz várost";
  } else if (view === "city") {
    elViewMap.classList.add("hidden");
    elViewCity.classList.remove("hidden");
  }
}

/* -----------------------------
   TÉRKÉP kirajzolás
------------------------------ */

const elMapWrap = document.getElementById("mapWrap");

let mapImgNatural = null; // { w, h }

function getBgImageUrl(el) {
  const bg = getComputedStyle(el).backgroundImage; // url("...")
  const m = bg.match(/url\(["']?(.*?)["']?\)/i);
  return m ? m[1] : null;
}

async function loadMapImageNaturalSize() {
  const url = getBgImageUrl(elMapWrap);
  if (!url) throw new Error("Nem található háttérkép a .map-wrap elemhez.");

  const img = new Image();
  img.src = url;
  await img.decode(); // waits until dimensions are known
  mapImgNatural = { w: img.naturalWidth, h: img.naturalHeight };
}

function getContainedRect(containerW, containerH, imgW, imgH) {
  // background-size: contain
  const scale = Math.min(containerW / imgW, containerH / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  const x = (containerW - w) / 2; // background-position: center
  const y = (containerH - h) / 2;
  return { x, y, w, h };
}



function renderMap() {
  elMapLayer.innerHTML = "";

  // container size in CSS pixels
  const wrapRect = elMapWrap.getBoundingClientRect();

  // contained image rect inside the wrapper
  const imgRect = getContainedRect(
      wrapRect.width,
      wrapRect.height,
      mapImgNatural.w,
      mapImgNatural.h
  );

  for (const c of state.map.cities) {
    const status = getCityStatus(c.id);

    const node = document.createElement("div");
    node.className = `city-node ${status}`;

    // IMPORTANT:
    // Treat c.x/c.y as % of the MAP IMAGE (not the wrapper).
    // If your map.json currently stores 0..100, convert to 0..1:
    const rx = (c.x ?? 0) / 100;
    const ry = (c.y ?? 0) / 100;

    const px = imgRect.x + rx * imgRect.w;
    const py = imgRect.y + ry * imgRect.h;

    node.style.left = `${px}px`;
    node.style.top = `${py}px`;

    const label = document.createElement("div");
    label.className = "city-label";
    label.textContent = c.name;
    node.appendChild(label);

    node.addEventListener("click", () => {
      if (status === "locked") return;
      enterCity(c.id);
    });

    elMapLayer.appendChild(node);
  }
}

new ResizeObserver(() => {
  if (state.view === "map") renderMap();
}).observe(elMapWrap);

/* -----------------------------
   VÁROS belépés
------------------------------ */
async function enterCity(cityId) {
  state.currentCityId = cityId;

  // város adatfájlja: data/city_<id>.json (konvenció)
  // pl: city_city1.json
  const cityFile = `data/city_${cityId}.json`;
  state.currentCityData = await fetchJson(cityFile);

  elCityTitle.textContent = state.currentCityData.title;

  elHudTitle.textContent = "Város";
  elHudSub.textContent = state.currentCityData.title;

  showView("city");
}

/* -----------------------------
   SZÓTÁR
------------------------------ */
async function openDictionary() {
  const city = state.currentCityData;
  const dict = await fetchJson(city.dictionaryFile);

  openModal("Templom – Szótár", renderDictionaryHtml(dict));

  // kereső bekötése
  const input = modalBody.querySelector("#dictSearch");
  const list = modalBody.querySelector("#dictList");

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    list.innerHTML = dict
      .filter(x => x.hu.toLowerCase().includes(q) || x.la.toLowerCase().includes(q))
      .map(x => `<li><b>${escapeHtml(x.hu)}</b> – ${escapeHtml(x.la)}</li>`)
      .join("");
  });
}

function renderDictionaryHtml(dict) {
  return `
    <p>Itt tudsz szótárazni a témakör szavaiból.</p>
    <div class="row">
      <input id="dictSearch" placeholder="Keresés (HU vagy LA)..." />
    </div>
    <ul id="dictList">
      ${dict.map(x => `<li><b>${escapeHtml(x.hu)}</b> – ${escapeHtml(x.la)}</li>`).join("")}
    </ul>
  `;
}

/* -----------------------------
   GYAKORLÓ FELADATOK
------------------------------ */
async function openPractice() {
  const city = state.currentCityData;
  const tasks = await fetchJson(city.tasksFile);

  let idx = 0;
  let correctCount = 0;

  const draw = () => {
    const t = tasks[idx];
    openModal(`Feladatok (${idx + 1}/${tasks.length})`, renderTaskHtml(t));

    // ordering típus bekötése
    if (t.type === "ordering") {
      const chosen = [];
      const pool = modalBody.querySelector("#ordPool");
      const out = modalBody.querySelector("#ordChosen");
      const reset = modalBody.querySelector("#ordReset");

      // védő: ha valamiért nincs meg az elem, ne omoljon össze
      if (!pool || !out || !reset) {
        console.warn("Ordering elemek hiányoznak a DOM-ból!");
      } else {
        const renderChosen = () => {
          out.innerHTML = chosen
            .map(id => {
              const word = t.items.find(x => x.id === id)?.text ?? id;
              return `<span class="ord-slot">${escapeHtml(word)}</span>`;
            })
            .join(" ");
          out.dataset.order = JSON.stringify(chosen);
        };

        pool.addEventListener("click", (e) => {
          const b = e.target.closest(".ord-chip");
          if (!b) return;
          const id = b.dataset.id;
          if (chosen.includes(id)) return;
          chosen.push(id);
          b.disabled = true;
          renderChosen();
        });

        reset.addEventListener("click", () => {
          chosen.length = 0;
          pool.querySelectorAll(".ord-chip").forEach(b => (b.disabled = false));
          renderChosen();
        });

        renderChosen();
      }
    }

    // válasz bekötése
    const btn = modalBody.querySelector("#taskSubmit");
    btn.addEventListener("click", () => {
      const ok = gradeTask(t);
      if (ok) correctCount++;

      idx++;

      if (idx >= tasks.length) {
        openModal("Feladatok – Eredmény", `
          <p>Kész! Helyes válaszok: <b>${correctCount}</b> / ${tasks.length}</p>
          <div class="row">
            <button id="closeAfter">Bezárás</button>
          </div>
        `);
        modalBody.querySelector("#closeAfter").addEventListener("click", closeModal);
        return;
      }

      draw();
    });
  };

  draw();
}


function renderTaskHtml(t) {
  if (t.type === "tf") {
    return `
      <p><b>Igaz/Hamis:</b> ${escapeHtml(t.q)}</p>
      <div class="row">
        <label><input type="radio" name="ans" value="true"> Igaz</label>
        <label><input type="radio" name="ans" value="false"> Hamis</label>
      </div>
      <div class="row">
        <button id="taskSubmit">Válasz</button>
      </div>
    `;
  }

  if (t.type === "mcq") {
    return `
      <p><b>Választós:</b> ${escapeHtml(t.q)}</p>
      <div class="row">
        ${t.options.map((o, i) => `
          <label><input type="radio" name="ans" value="${i}"> ${escapeHtml(o)}</label>
        `).join("")}
      </div>
      <div class="row">
        <button id="taskSubmit">Válasz</button>
      </div>
    `;
  }

  if (t.type === "grouping") {
    return `
      <p><b>Csoportosítás:</b> ${escapeHtml(t.q)}</p>
      <p>Válaszd ki minden elemhez a csoportot.</p>

      <div id="groupList">
        ${t.items.map(it => `
          <div class="g-row">
            <span class="g-item">${escapeHtml(it.text)}</span>
            <select name="grp_${escapeHtml(it.id)}">
              <option value="">-- válassz --</option>
              ${t.groups.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("")}
            </select>
          </div>
        `).join("")}
      </div>

      <div class="row">
        <button id="taskSubmit">Válasz</button>
      </div>
    `;
  }

  if (t.type === "ordering") {
    return `
      <p><b>Sorbarendezés:</b> ${escapeHtml(t.q)}</p>
      <p>Kattints a szavakra a kívánt sorrendben (a listába kerülnek).</p>

      <div class="row" id="ordPool">
        ${t.items.map(it => `
          <button type="button" class="ord-chip" data-id="${escapeHtml(it.id)}">
            ${escapeHtml(it.text)}
          </button>
        `).join("")}
      </div>

      <p><b>Aktuális sorrend:</b></p>
      <div class="row" id="ordChosen"></div>

      <div class="row">
        <button id="ordReset" type="button">Újrakezd</button>
        <button id="taskSubmit">Válasz</button>
      </div>
    `;
  }

  return `<p>Ismeretlen feladattípus: ${escapeHtml(t.type)}</p>`;
}

function gradeTask(t) {
  const chosen = modalBody.querySelector('input[name="ans"]:checked');
  if (!chosen) {
    alert("Válassz egy opciót!");
    return false;
  }

  if (t.type === "tf") {
    const val = chosen.value === "true";
    return val === t.correct;
  }

  if (t.type === "mcq") {
    const val = Number(chosen.value);
    return val === t.correct;
  }

  if (t.type === "grouping") {
    for (const it of t.items) {
      const sel = modalBody.querySelector(`select[name="grp_${CSS.escape(it.id)}"]`);
      if (!sel || !sel.value) {
        alert("Minden elemhez válassz csoportot!");
        return false;
      }
      if (sel.value !== it.group) return false;
    }
    return true;
  }

  if (t.type === "ordering") {
    const out = modalBody.querySelector("#ordChosen");
    const chosen = out?.dataset?.order ? JSON.parse(out.dataset.order) : [];
    if (chosen.length !== t.answerOrder.length) {
      alert("Rakd sorba az összes elemet!");
      return false;
    }
    return chosen.every((id, i) => id === t.answerOrder[i]);
  }

  return false;
}

/* -----------------------------
   VIZSGA (városkapu)
   - siker esetén: város teljesítve + következő város(ok) nyitása
------------------------------ */
function openExam() {
  const exam = state.currentCityData.exam;

  let idx = 0;
  let score = 0;

  const draw = () => {
    const q = exam.questions[idx];
    openModal(`Vizsga (${idx + 1}/${exam.questions.length})`, renderTaskHtml(q));

    const btn = modalBody.querySelector("#taskSubmit");
    btn.textContent = "Tovább";
    btn.addEventListener("click", () => {
      const ok = gradeTask(q);
      if (ok) score++;

      idx++;
      if (idx >= exam.questions.length) {
        finishExam(score, exam.passScore, exam.questions.length);
        return;
      }
      draw();
    });
  };

  draw();
}

function finishExam(score, passScore, total) {
  const passed = score >= passScore;

  if (!passed) {
    openModal("Vizsga – Sikertelen", `
      <p>Eredmény: <b>${score}</b> / ${total}</p>
      <p>Még nem sikerült a kijutás a városból. Gyakorolj és próbáld újra!</p>
      <div class="row"><button id="closeAfter">Bezárás</button></div>
    `);
    modalBody.querySelector("#closeAfter").addEventListener("click", closeModal);
    return;
  }

  // siker: város teljesítése és következő városok nyitása
  markCityDone(state.currentCityId);
  unlockNextCities(state.currentCityId);

  saveProgress();

  openModal("Vizsga – Sikeres!", `
    <p>Eredmény: <b>${score}</b> / ${total}</p>
    <p><b>Kijutottál a városból!</b> Megnyílt a következő állomás.</p>
    <div class="row">
      <button id="goMap">Vissza a térképre</button>
      <button id="stay">Maradok</button>
    </div>
  `);

  modalBody.querySelector("#goMap").addEventListener("click", () => {
    closeModal();
    showView("map");
    renderMap();
  });

  modalBody.querySelector("#stay").addEventListener("click", closeModal);
}

/* -----------------------------
   PROGRESS (mentés/betöltés)
------------------------------ */
function loadProgress() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    // alap: semmi nincs kész, csak az első város nyitott
    return { unlocked: {}, done: {} };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { unlocked: {}, done: {} };
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

function ensureFirstCityUnlocked() {
  const first = state.map.cities[0];
  if (!first) return;

  // ha nincs egy város sem nyitva, nyissuk az elsőt
  const anyUnlocked = Object.values(state.progress.unlocked).some(Boolean);
  if (!anyUnlocked) {
    state.progress.unlocked[first.id] = true;
    saveProgress();
  }
}

function getCityStatus(cityId) {
  if (state.progress.done[cityId]) return "done";
  if (state.progress.unlocked[cityId]) return "open";
  return "locked";
}

function markCityDone(cityId) {
  state.progress.done[cityId] = true;
  // ha done, akkor implicit legyen unlocked is
  state.progress.unlocked[cityId] = true;
}

function unlockNextCities(cityId) {
  // map.json alapján keressük meg a várost, és a next listát nyitjuk
  const city = state.map.cities.find(c => c.id === cityId);
  if (!city) return;

  for (const nxt of city.next) {
    state.progress.unlocked[nxt] = true;
  }
}

/* -----------------------------
   MODAL segédek
------------------------------ */
function openModal(title, html) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
  modalBody.innerHTML = "";
}

/* -----------------------------
   Fetch + HTML escape segédek
------------------------------ */
async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Nem tölthető be: ${path}`);
  return await res.json();
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
