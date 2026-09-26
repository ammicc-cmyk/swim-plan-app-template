import { loadLog, saveLog, loadCatalog, saveCatalog, exportLog, importLogFile } from '../storage.js';

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Применяет последствия записи журнала к каталогу — CATALOG_SCHEMA.md /
// PLAN_RULES.md: техническая причина исключения -> deferred + last_attempt_date;
// организационная причина -> статус не трогаем.
function applyEntryToCatalog(entry) {
  const catalog = loadCatalog();
  let changed = false;
  for (const removal of entry.removed || []) {
    if (removal.reason_type === 'technical') {
      const ex = catalog.find((e) => e.code === removal.code);
      if (ex) {
        ex.status = 'deferred';
        ex.last_attempt_date = entry.date || ex.last_attempt_date || todayStr();
        changed = true;
      }
    }
  }
  for (const code of entry.new_exercises_introduced || []) {
    const ex = catalog.find((e) => e.code === code);
    if (ex && ex.status === 'proposed') {
      ex.status = 'in_progress';
      changed = true;
    }
  }
  if (changed) saveCatalog(catalog);
}

export function initLogTab(root) {
  render();

  function render() {
    root.innerHTML = `
      <section class="panel">
        <h2>Журнал тренировок</h2>
        <div class="toolbar">
          <button id="new-entry">Добавить запись вручную</button>
          <button id="export-log">Экспорт training_log.json</button>
          <label class="file-import">Импорт JSON <input type="file" id="import-log" accept="application/json"></label>
        </div>
        <div id="log-entries"></div>
      </section>
      <section class="panel" id="entry-editor" style="display:none;"></section>
    `;

    renderEntriesList();

    root.querySelector('#export-log').addEventListener('click', () => exportLog());
    root.querySelector('#import-log').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('Импорт полностью заменит текущий журнал в этом браузере. Продолжить?')) {
        e.target.value = '';
        return;
      }
      importLogFile(file)
        .then(() => {
          root.querySelector('#entry-editor').style.display = 'none';
          renderEntriesList();
        })
        .catch((err) => alert('Ошибка импорта: ' + err.message));
    });

    root.querySelector('#new-entry').addEventListener('click', () => {
      const log = loadLog();
      const entry = {
        id: `session-${Date.now()}`,
        order: log.length + 1,
        date: todayStr(),
        session_label: `Тренировка ${log.length + 1}`,
        target_volume: { min: 700, max: 900 },
        distance_m: null,
        executed_codes: [],
        removed: [],
        reserve: { included: true, exercise_code: 'ne_main_crawl', volume_m: 100, done: null, promoted_to_mandatory: false },
        new_exercises_introduced: [],
        feedback_text: '',
      };
      log.push(entry);
      saveLog(log);
      renderEntriesList();
      openEditor(log.length - 1);
    });
  }

  // Обновляет только список записей — не трогает открытый редактор (иначе
  // подсказка про резерв и открытая форма редактирования стирались бы сразу
  // после сохранения). Таблица: № тренировки (позиция в массиве, начиная с
  // 1) — Дата — Упражнения кратко — Дистанция — Заметки пловца.
  function renderEntriesList() {
    const log = loadLog();
    const catalog = loadCatalog();
    const byCode = Object.fromEntries(catalog.map((e) => [e.code, e]));

    const rowsHtml = log
      .map((entry, idx) => {
        const exerciseNames = (entry.executed_codes || []).map((c) => (byCode[c] ? byCode[c].name : c)).join(', ') || '—';
        const distance = entry.distance_m
          ? `${entry.distance_m} м`
          : entry.target_volume
            ? `${entry.target_volume.min}–${entry.target_volume.max} м (план)`
            : '—';
        return `
        <tr>
          <td class="log-col-num">${idx + 1}</td>
          <td class="log-col-date">${entry.date ? esc(entry.date) : '—'}</td>
          <td class="log-col-exercises">${esc(exerciseNames)}</td>
          <td class="log-col-distance">${esc(distance)}</td>
          <td class="log-col-notes">${esc(entry.feedback_text || '')}</td>
          <td class="log-col-actions">
            <button class="edit-entry" data-idx="${idx}">Редактировать</button>
            <button class="delete-entry" type="button" data-idx="${idx}" title="Удалить эту тренировку">✕</button>
          </td>
        </tr>`;
      })
      .join('');

    const listEl = root.querySelector('#log-entries');
    listEl.innerHTML = log.length
      ? `
      <table class="log-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Дата</th>
            <th>Упражнения (кратко)</th>
            <th>Дистанция</th>
            <th>Заметки пловца</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`
      : '<p class="hint">Пока нет записей.</p>';
    listEl.querySelectorAll('.edit-entry').forEach((btn) => {
      btn.addEventListener('click', () => openEditor(Number(btn.dataset.idx)));
    });
    // Удаление — только по одной записи за раз, с подтверждением. Массовой
    // очистки всего журнала намеренно нет (запрещено пользователем 2026-09-22).
    listEl.querySelectorAll('.delete-entry').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        const current = loadLog();
        const entry = current[idx];
        if (!entry) return;
        const label = entry.date ? `тренировку №${idx + 1} от ${entry.date}` : `тренировку №${idx + 1}`;
        if (!confirm(`Удалить ${label}? Отменить нельзя.`)) return;
        current.splice(idx, 1);
        saveLog(current);
        root.querySelector('#entry-editor').style.display = 'none';
        renderEntriesList();
      });
    });
  }

  function openEditor(idx) {
    const log = loadLog();
    const catalog = loadCatalog();
    const entry = log[idx];
    if (!entry) return;
    const editor = root.querySelector('#entry-editor');
    editor.style.display = 'block';

    const executedSet = new Set(entry.executed_codes || []);
    const removedByCode = Object.fromEntries((entry.removed || []).map((r) => [r.code, r]));

    const rows = catalog
      .map((ex) => {
        const isExecuted = executedSet.has(ex.code);
        const removal = removedByCode[ex.code];
        return `
        <div class="log-edit-row" data-code="${esc(ex.code)}">
          <label><input type="checkbox" class="exec-check" data-code="${esc(ex.code)}" ${isExecuted ? 'checked' : ''}> ${esc(ex.name)}</label>
          <label class="removed-toggle"><input type="checkbox" class="removed-check" data-code="${esc(ex.code)}" ${removal ? 'checked' : ''}> убрано</label>
          <select class="reason-select" data-code="${esc(ex.code)}" ${removal ? '' : 'disabled'}>
            <option value="organizational" ${removal && removal.reason_type === 'organizational' ? 'selected' : ''}>организационная</option>
            <option value="technical" ${removal && removal.reason_type === 'technical' ? 'selected' : ''}>техническая</option>
          </select>
          <input type="text" class="reason-note" data-code="${esc(ex.code)}" placeholder="причина/заметка" value="${esc(removal ? removal.note : '')}" ${removal ? '' : 'disabled'}>
        </div>`;
      })
      .join('');

    editor.innerHTML = `
      <h2>Редактирование: ${esc(entry.session_label)}</h2>
      <div class="stack-form">
        <label>Дата <input type="date" id="e-date" value="${entry.date || ''}"></label>
        <label>Дистанция, м (фактическая) <input type="number" id="e-distance" step="50" value="${entry.distance_m ?? ''}" placeholder="например 800"></label>
        <label>Плановый диапазон от <input type="number" id="e-min" step="50" value="${entry.target_volume?.min || 700}"></label>
        <label>до <input type="number" id="e-max" step="50" value="${entry.target_volume?.max || 900}"></label>
        <label><input type="checkbox" id="e-reserve-done" ${entry.reserve?.done ? 'checked' : ''}> Резерв выполнен полностью</label>
        <h3>Упражнения</h3>
        <div class="log-edit-list">${rows}</div>
        <label>Заметки пловца <textarea id="e-feedback" rows="3">${esc(entry.feedback_text || '')}</textarea></label>
        <div id="reserve-hint" class="hint"></div>
        <div class="toolbar">
          <button id="save-entry">Сохранить</button>
          <button id="cancel-entry" type="button">Закрыть</button>
        </div>
      </div>
    `;

    editor.querySelectorAll('.removed-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const code = cb.dataset.code;
        const row = editor.querySelector(`.log-edit-row[data-code="${code}"]`);
        const reasonSelect = row.querySelector('.reason-select');
        const reasonNote = row.querySelector('.reason-note');
        reasonSelect.disabled = !cb.checked;
        reasonNote.disabled = !cb.checked;
        if (cb.checked) row.querySelector('.exec-check').checked = false;
      });
    });

    editor.querySelector('#save-entry').addEventListener('click', () => {
      const updated = { ...entry };
      updated.date = editor.querySelector('#e-date').value || null;
      const distanceVal = editor.querySelector('#e-distance').value;
      updated.distance_m = distanceVal ? Number(distanceVal) : null;
      updated.target_volume = {
        min: Number(editor.querySelector('#e-min').value),
        max: Number(editor.querySelector('#e-max').value),
      };
      updated.feedback_text = editor.querySelector('#e-feedback').value;

      const executed = [];
      const removed = [];
      editor.querySelectorAll('.log-edit-row').forEach((row) => {
        const code = row.dataset.code;
        const execChecked = row.querySelector('.exec-check').checked;
        const removedChecked = row.querySelector('.removed-check').checked;
        if (execChecked) executed.push(code);
        if (removedChecked) {
          removed.push({
            code,
            reason_type: row.querySelector('.reason-select').value,
            note: row.querySelector('.reason-note').value,
          });
        }
      });
      updated.executed_codes = executed;
      updated.removed = removed;
      updated.reserve = {
        ...(entry.reserve || {}),
        done: editor.querySelector('#e-reserve-done').checked,
      };

      const log2 = loadLog();
      log2[idx] = updated;
      saveLog(log2);
      applyEntryToCatalog(updated);

      const noTechnicalRemovals = removed.every((r) => r.reason_type !== 'technical');
      if (updated.reserve.done && noTechnicalRemovals) {
        editor.querySelector('#reserve-hint').textContent =
          'Резерв выполнен полностью без технических причин исключений — кандидат на перевод в обязательный объём (PLAN_RULES.md). Включите флаг в Настройках, если решите перевести.';
      } else {
        editor.querySelector('#reserve-hint').textContent = '';
      }

      renderEntriesList();
    });

    editor.querySelector('#cancel-entry').addEventListener('click', () => {
      editor.style.display = 'none';
    });
  }
}
