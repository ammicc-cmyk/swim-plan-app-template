import { generatePlan } from '../rulesEngine.js';
import { renderPlan } from '../render.js';
import { loadCatalog, loadLog, saveLog, saveCatalog, loadSettings } from '../storage.js';

let lastPlan = null;

// Пункт плана может быть обычным (code) или combo из двух половинок —
// собираем плоский список кодов для журнала в обоих случаях.
function itemCodes(item) {
  return item.combo ? item.combo.map((h) => h.code) : [item.code];
}
// Для combo-пункта "новое" относится только к первой половине (см.
// newItemCombo в rulesEngine.js) — вторая половина это известный заполнитель.
function newItemCodes(item) {
  if (!item.is_new) return [];
  return item.combo ? [item.combo[0].code] : [item.code];
}

// Пункты, которыми управляет сама структура плана (позиция у борта,
// добор объёма) — исключать их через чек-лист нельзя, только через каталог/
// журнал (статус deferred).
const STRUCTURAL_CODES = new Set(['ne_warmup', 'ne_cooldown', 'ne_main_crawl']);

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

export function initPlanTab(root) {
  const settings = loadSettings();
  const catalog = loadCatalog();
  const excludableExercises = catalog.filter((ex) => ex.status !== 'deferred' && !STRUCTURAL_CODES.has(ex.code));

  const excludeRows = excludableExercises
    .map((ex) => `<label class="exclude-row"><input type="checkbox" class="exclude-check" value="${esc(ex.code)}"> ${esc(ex.name)}</label>`)
    .join('');

  root.innerHTML = `
    <section class="panel">
      <h2>Генератор плана</h2>
      <form id="plan-form" class="inline-form">
        <label>Объём от <input type="number" id="target-min" step="50" value="${settings.default_target_min}" required></label>
        <label>до <input type="number" id="target-max" step="50" value="${settings.default_target_max}" required></label>
        <label><input type="checkbox" id="no-new-item"> Без нового упражнения в этот раз</label>
        <button type="submit">Сгенерировать план</button>
      </form>
      <details class="exclude-panel">
        <summary>Не показывать какие-то упражнения в этот раз</summary>
        <div class="hint">
          Отметьте упражнения, которые не хотите видеть в этом плане, и нажмите «Сгенерировать план» ещё раз.
          Это разовый выбор только для следующей генерации — из каталога упражнения не удаляются.
        </div>
        <div class="exclude-list">${excludeRows || '<p class="hint">Нет доступных для исключения упражнений.</p>'}</div>
      </details>
      <div id="plan-output"></div>
      <div id="plan-save-row" class="hint" style="display:none;">
        <button id="save-to-log">Сохранить как тренировку в журнал</button>
      </div>
    </section>
  `;

  const form = root.querySelector('#plan-form');
  const output = root.querySelector('#plan-output');
  const saveRow = root.querySelector('#plan-save-row');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const targetMin = Number(root.querySelector('#target-min').value);
    const targetMax = Number(root.querySelector('#target-max').value);
    if (targetMin > targetMax) {
      output.innerHTML = '<p class="warn">Минимум не может быть больше максимума.</p>';
      return;
    }
    const noNewItem = root.querySelector('#no-new-item').checked;
    const forceExclude = Array.from(root.querySelectorAll('.exclude-check:checked')).map((cb) => cb.value);
    const currentCatalog = loadCatalog();
    const log = loadLog();
    const currentSettings = loadSettings();

    lastPlan = generatePlan({
      catalog: currentCatalog,
      log,
      targetMin,
      targetMax,
      settings: currentSettings,
      overrides: { noNewItem, forceExclude },
    });

    output.innerHTML = renderPlan(lastPlan, lastPlan.byCode);
    saveRow.style.display = 'block';
  });

  root.querySelector('#save-to-log').addEventListener('click', () => {
    if (!lastPlan) return;
    const dateStr = window.prompt('Дата тренировки (YYYY-MM-DD), оставьте пустым если неизвестна:', '');
    const log = loadLog();
    const entry = {
      id: `session-${Date.now()}`,
      order: log.length + 1,
      date: dateStr && dateStr.trim() ? dateStr.trim() : null,
      session_label: `Тренировка ${log.length + 1}`,
      target_volume: { min: lastPlan.targetMin, max: lastPlan.targetMax },
      distance_m: lastPlan.mandatoryVolume,
      executed_codes: lastPlan.items.flatMap(itemCodes),
      removed: [],
      reserve: {
        included: true,
        exercise_code: lastPlan.reserve.exercise_code,
        volume_m: lastPlan.reserve.volume_m,
        done: null,
        promoted_to_mandatory: lastPlan.reserve.mandatory,
      },
      new_exercises_introduced: lastPlan.items.flatMap(newItemCodes),
      feedback_text: '',
    };
    log.push(entry);
    saveLog(log);

    // Новые предложенные упражнения, попавшие в план — переводим в in_progress,
    // раз они были реально запланированы к попытке (CATALOG_SCHEMA.md: proposed -> in_progress).
    const catalog = loadCatalog();
    let changed = false;
    for (const code of entry.new_exercises_introduced) {
      const ex = catalog.find((e) => e.code === code);
      if (ex && ex.status === 'proposed') {
        ex.status = 'in_progress';
        changed = true;
      }
    }
    if (changed) saveCatalog(catalog);

    alert(
      'Черновик записи добавлен в журнал. Откройте вкладку "Журнал тренировок", чтобы отметить выполненное/убранное и причины после тренировки.'
    );
  });
}
