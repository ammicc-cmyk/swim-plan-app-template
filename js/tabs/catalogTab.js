import { loadCatalog, saveCatalog, loadLog, loadSettings, exportCatalog, exportExerciseLibraryMd, importCatalogFile } from '../storage.js';
import { validateExercise, normalizeNewExercise, TIERS, STATUSES, KNOWN_EQUIPMENT, expectedVolumeFor } from '../schema.js';

function prerequisiteMet(ex, byCode) {
  if (!ex.requires) return true;
  const prereq = byCode[ex.requires];
  return !!prereq && (prereq.status === 'mastered' || prereq.status === 'in_progress');
}

const STATUS_LABEL = { mastered: 'освоено', in_progress: 'в процессе', proposed: 'предложено', deferred: 'отложено' };
const EQUIPMENT_LABEL = { board: 'доска', pull_buoy: 'колобашка', board_optional: 'доска (опционально)' };

function sessionsSinceLastAttempt(ex, log) {
  if (!ex.last_attempt_date) return null;
  return log.filter((entry) => entry.date && entry.date > ex.last_attempt_date).length;
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

export function initCatalogTab(root) {
  render();

  function render() {
    const catalog = loadCatalog();
    const log = loadLog();
    const settings = loadSettings();
    const cooldownSessions = settings.deferred_cooldown_sessions || 2;
    const byCode = Object.fromEntries(catalog.map((e) => [e.code, e]));

    const rows = catalog
      .map((ex) => {
        const sessionsSince = sessionsSinceLastAttempt(ex, log);
        let cooldownNote = '';
        if (ex.status === 'deferred') {
          if (sessionsSince === null) {
            cooldownNote = '<div class="hint">Дата последней попытки не зафиксирована — вернуть в "предложено" вручную, когда тренер решит повторить.</div>';
          } else if (sessionsSince >= cooldownSessions) {
            cooldownNote = `<div class="hint ok">Прошло ${sessionsSince} трен. с последней попытки — можно пробовать снова.</div>`;
          } else {
            cooldownNote = `<div class="hint">Прошло ${sessionsSince} трен. из ${cooldownSessions} — пока не предлагать.</div>`;
          }
        }
        let requiresNote = '';
        if (ex.requires) {
          const prereq = byCode[ex.requires];
          const met = prerequisiteMet(ex, byCode);
          requiresNote = `<div class="hint ${met ? 'ok' : ''}">Требует: ${esc(prereq ? prereq.name : ex.requires)}${met ? ' — освоено/в процессе' : ' — 🔒 ещё не начато, генератор сам не предложит'}</div>`;
        }
        return `
        <tr data-code="${esc(ex.code)}">
          <td>${esc(ex.code)}</td>
          <td>${esc(ex.name)}</td>
          <td>${ex.equipment ? esc(EQUIPMENT_LABEL[ex.equipment] || ex.equipment) : '—'}</td>
          <td>${ex.volume_unit_m} м</td>
          <td>${esc(ex.tier)}</td>
          <td>
            <select class="status-select" data-code="${esc(ex.code)}">
              ${STATUSES.map((s) => `<option value="${s}" ${s === ex.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
            </select>
            ${cooldownNote}
          </td>
          <td>
            <label class="rotate-toggle">
              <input type="checkbox" class="rotate-check" data-code="${esc(ex.code)}" ${ex.always_include === false ? 'checked' : ''}>
              через трен.
            </label>
          </td>
          <td class="focus-cell">${esc(ex.focus)}${requiresNote}</td>
          <td class="notes-cell">${esc(ex.notes || '')}</td>
        </tr>`;
      })
      .join('');

    root.innerHTML = `
      <section class="panel">
        <h2>Каталог упражнений</h2>
        <div class="toolbar">
          <button id="export-catalog">Экспорт exercise_library.json</button>
          <button id="export-catalog-md">Экспорт EXERCISE_LIBRARY.md</button>
          <label class="file-import">Импорт JSON <input type="file" id="import-catalog" accept="application/json"></label>
        </div>
        <table class="catalog-table">
          <thead>
            <tr><th>Код</th><th>Название</th><th>Инвентарь</th><th>Объём-ед.</th><th>Уровень</th><th>Статус</th><th>Чередование</th><th>Фокус</th><th>Заметки</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
      <section class="panel">
        <h2>Добавить упражнение</h2>
        <form id="add-exercise-form" class="stack-form">
          <label>Код (snake_case, уникальный) <input type="text" id="f-code" required placeholder="ne_new_drill"></label>
          <label>Название <input type="text" id="f-name" required></label>
          <label>Инвентарь
            <select id="f-equipment">
              <option value="">без инвентаря</option>
              ${KNOWN_EQUIPMENT.map((eq) => `<option value="${eq}">${EQUIPMENT_LABEL[eq] || eq}</option>`).join('')}
            </select>
          </label>
          <label>Объём-единица (м) <input type="number" id="f-volume" value="50" readonly></label>
          <label>Уровень
            <select id="f-tier">${TIERS.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
          </label>
          <label>Фокус (обязательно) <input type="text" id="f-focus" required></label>
          <label>Заметки <input type="text" id="f-notes"></label>
          <label>Требует освоения (опционально)
            <select id="f-requires">
              <option value="">— нет —</option>
              ${catalog.map((ex) => `<option value="${esc(ex.code)}">${esc(ex.name)}</option>`).join('')}
            </select>
          </label>
          <div class="hint">Пока указанное упражнение не станет "в процессе"/"освоено", генератор сам это новое упражнение не предложит (только вручную, через чек-лист на вкладке генератора).</div>
          <label><input type="checkbox" id="f-rotate"> Чередовать через тренировку (не включать каждый раз, когда освоено)</label>
          <div class="hint">Статус нового упражнения всегда "предложено" (CATALOG_SCHEMA.md). Чередование начнёт применяться, когда статус станет "освоено"/"в процессе" — пока предложено, действует своё правило (не больше одного нового упражнения за тренировку).</div>
          <div id="add-errors" class="warn"></div>
          <button type="submit">Добавить в каталог</button>
        </form>
      </section>
    `;

    const equipmentSelect = root.querySelector('#f-equipment');
    const volumeInput = root.querySelector('#f-volume');
    equipmentSelect.addEventListener('change', () => {
      volumeInput.value = expectedVolumeFor(equipmentSelect.value || null);
    });

    root.querySelectorAll('.status-select').forEach((select) => {
      select.addEventListener('change', () => {
        const cat = loadCatalog();
        const ex = cat.find((e) => e.code === select.dataset.code);
        if (!ex) return;
        ex.status = select.value;
        if (select.value === 'deferred' && !ex.last_attempt_date) {
          const d = window.prompt('Дата этой (неудачной) попытки, YYYY-MM-DD (можно оставить пустым):', '');
          if (d && d.trim()) ex.last_attempt_date = d.trim();
        }
        saveCatalog(cat);
        render();
      });
    });

    root.querySelectorAll('.rotate-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const cat = loadCatalog();
        const ex = cat.find((e) => e.code === cb.dataset.code);
        if (!ex) return;
        ex.always_include = !cb.checked;
        saveCatalog(cat);
        render();
      });
    });

    root.querySelector('#export-catalog').addEventListener('click', () => exportCatalog());
    root.querySelector('#export-catalog-md').addEventListener('click', () => exportExerciseLibraryMd());

    root.querySelector('#import-catalog').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('Импорт полностью заменит текущий каталог в этом браузере. Продолжить?')) {
        e.target.value = '';
        return;
      }
      importCatalogFile(file)
        .then(() => render())
        .catch((err) => alert('Ошибка импорта: ' + err.message));
    });

    root.querySelector('#add-exercise-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = {
        code: root.querySelector('#f-code').value,
        name: root.querySelector('#f-name').value,
        equipment: root.querySelector('#f-equipment').value,
        volume_unit_m: root.querySelector('#f-volume').value,
        tier: root.querySelector('#f-tier').value,
        focus: root.querySelector('#f-focus').value,
        notes: root.querySelector('#f-notes').value,
        always_include: !root.querySelector('#f-rotate').checked,
        requires: root.querySelector('#f-requires').value,
      };
      const candidate = normalizeNewExercise(input);
      const catalog = loadCatalog();
      const errors = validateExercise(candidate, catalog.map((e) => e.code));
      const errBox = root.querySelector('#add-errors');
      if (errors.length) {
        errBox.innerHTML = errors.map((er) => `<div>${esc(er)}</div>`).join('');
        return;
      }
      catalog.push(candidate);
      saveCatalog(catalog);
      render();
    });
  }
}
