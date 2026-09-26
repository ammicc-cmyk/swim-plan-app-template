// Слой хранения: localStorage + seed из встроенных <script type="application/json">
// в index.html (копии exercise_library.json / training_log.json).
// Источник истины при первом запуске — эти json-файлы; после первого запуска
// приложение работает с localStorage. Экспорт/импорт ниже — ручной механизм
// синхронизации с файлами на диске (см. HANDOVER.md, раздел "Реализация").

export const KEYS = {
  catalog: 'swim_catalog_v1',
  log: 'swim_log_v1',
  settings: 'swim_settings_v1',
};

function readSeed(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch (e) {
    console.error('Не удалось разобрать seed-данные', id, e);
    return null;
  }
}

export function defaultSettings() {
  return {
    pool_length_m: 50,
    style_focus: 'кроль (основной), брасс и спина — для разнообразия',
    frequency_per_week: null,
    session_minutes: 45,
    reserve_mandatory: false,
    deferred_cooldown_sessions: 2,
    default_target_min: 700,
    default_target_max: 900,
  };
}

// Переименования упражнений, которые должны применяться даже к каталогу,
// уже сохранённому в localStorage браузера — иначе правка имени в
// exercise_library.json/seed никогда не долетит до тех, кто уже открывал
// приложение раньше (каталог из localStorage имеет приоритет над seed,
// это сделано специально, чтобы не затирать статусы/прогресс при каждом
// обновлении кода). Трогаем только поле name, остальное (status,
// always_include, last_attempt_date и т.д.) не меняем.
const NAME_MIGRATIONS = {
  ne_warmup: 'Разминка, кроль',
  ne_main_crawl: 'Кроль в полной координации',
};

function applyNameMigrations(exercises) {
  let changed = false;
  for (const ex of exercises) {
    const canonicalName = NAME_MIGRATIONS[ex.code];
    if (canonicalName && ex.name !== canonicalName) {
      ex.name = canonicalName;
      changed = true;
    }
  }
  return changed;
}

// Каталог из localStorage имеет приоритет над seed (см. выше) — значит
// упражнения, добавленные в exercise_library.json/seed ПОСЛЕ того, как
// браузер уже сохранил себе каталог, никогда не появятся сами по себе.
// При каждой загрузке доливаем в сохранённый каталог те коды из seed,
// которых там ещё нет — остальные (уже существующие) записи не трогаем.
function mergeNewSeedExercises(exercises) {
  const seed = readSeed('seed-exercises');
  if (!seed || !Array.isArray(seed.exercises)) return false;
  const existingCodes = new Set(exercises.map((e) => e.code));
  let changed = false;
  for (const seedEx of seed.exercises) {
    if (!existingCodes.has(seedEx.code)) {
      exercises.push(seedEx);
      changed = true;
    }
  }
  return changed;
}

export function loadCatalog() {
  const raw = localStorage.getItem(KEYS.catalog);
  const exercises = raw ? JSON.parse(raw) : (readSeed('seed-exercises') || { exercises: [] }).exercises;
  const nameChanged = applyNameMigrations(exercises);
  const mergedNew = raw ? mergeNewSeedExercises(exercises) : false;
  if (nameChanged || mergedNew || !raw) {
    saveCatalog(exercises);
  }
  return exercises;
}

export function saveCatalog(exercises) {
  localStorage.setItem(KEYS.catalog, JSON.stringify(exercises));
}

export function loadLog() {
  const raw = localStorage.getItem(KEYS.log);
  if (raw) return JSON.parse(raw);
  const seed = readSeed('seed-log');
  const entries = seed ? seed.entries : [];
  saveLog(entries);
  return entries;
}

export function saveLog(entries) {
  localStorage.setItem(KEYS.log, JSON.stringify(entries));
}

export function loadSettings() {
  const raw = localStorage.getItem(KEYS.settings);
  if (raw) return JSON.parse(raw);
  const settings = defaultSettings();
  saveSettings(settings);
  return settings;
}

export function saveSettings(settings) {
  localStorage.setItem(KEYS.settings, JSON.stringify(settings));
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportCatalog() {
  const exercises = loadCatalog();
  const payload = { $schema_version: '1.0', exercises };
  downloadText('exercise_library.json', JSON.stringify(payload, null, 2));
}

export function exportLog() {
  const entries = loadLog();
  const payload = { $schema_version: '1.0', entries };
  downloadText('training_log.json', JSON.stringify(payload, null, 2));
}

export function importCatalogFile(file) {
  return file.text().then((text) => {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.exercises)) {
      throw new Error('Файл не похож на exercise_library.json — нет массива "exercises".');
    }
    saveCatalog(parsed.exercises);
    return parsed.exercises;
  });
}

const STATUS_LABEL_MD = { mastered: 'освоено', in_progress: 'в процессе', proposed: 'предложено', deferred: 'отложено' };

// HANDOVER.md рекомендует генерировать EXERCISE_LIBRARY.md из json, а не
// держать вручную — чтобы не расходились. Кнопка на вкладке "Каталог".
export function exportExerciseLibraryMd() {
  const exercises = loadCatalog();
  const withEquip = exercises.filter((e) => e.equipment);
  const noEquip = exercises.filter((e) => !e.equipment);

  const statusCell = (e) => {
    const label = STATUS_LABEL_MD[e.status] || e.status;
    return e.requires ? `${label} (требует: ${e.requires})` : label;
  };

  const equipRows = withEquip
    .map((e) => `| ${e.code} | ${e.name} | ${e.equipment} | ${e.focus} | ${statusCell(e)} |`)
    .join('\n');
  const noEquipRows = noEquip
    .map((e) => `| ${e.code} | ${e.name} | ${e.focus} | ${statusCell(e)} |`)
    .join('\n');

  const md = `# Каталог упражнений

Сгенерировано из exercise_library.json — не редактировать вручную,
править источник и экспортировать заново.

## С инвентарём (объём кратен 100 м, старт/финиш у стартовой стороны)

| Код | Название | Инвентарь | Фокус | Статус |
|---|---|---|---|---|
${equipRows}

## Без инвентаря (объём кратен 50 м)

| Код | Название | Фокус | Статус |
|---|---|---|---|
${noEquipRows}

Правила добавления упражнения, переходов статуса и поле \`requires\`
(прогрессии с предпосылками) — см. CATALOG_SCHEMA.md и PLAN_RULES.md.
`;

  downloadText('EXERCISE_LIBRARY.md', md, 'text/markdown');
}

export function importLogFile(file) {
  return file.text().then((text) => {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.entries)) {
      throw new Error('Файл не похож на training_log.json — нет массива "entries".');
    }
    saveLog(parsed.entries);
    return parsed.entries;
  });
}
