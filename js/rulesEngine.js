// Детерминированный генератор плана тренировки. Никаких вызовов AI — вся логика
// основана на каталоге (exercise_library.json) и правилах (PLAN_RULES.md).
//
// Порядок блоков (PLAN_RULES.md): разминка -> инвентарь -> без инвентаря ->
// заминка -> резерв. Разминка — первый пункт (как и ожидает тренер), сразу
// за ней блок с инвентарём — это допустимо, т.к. правило требует не "ноль
// метров перед инвентарём", а "объём перед инвентарём кратен 100" (см. ниже).
//
// КЛЮЧЕВОЙ ИНВАРИАНТ (PLAN_RULES.md, "Позиция у борта"): бассейн 50м без
// разделителя, план "живёт" у старта — КАЖДЫЙ пункт плана должен начинаться
// у старта, не только блок с инвентарём и не только итоговая сумма. Значит
// каждый пункт плана сам по себе должен быть кратен 100м — это либо одно
// упражнение, проплытое 2×50 (100м), либо "круг" из двух РАЗНЫХ упражнений
// по 50м каждое (combo-пункт, например "50м кроль на кулаках + 50м обычный
// кроль" — пример пользователя). Одиночный необёрнутый пункт в 50м допустим
// только как половина такого круга, никогда сам по себе. Это гарантируется
// на этапе построения плана (ниже), а не проверкой суммы после — более
// ранняя версия проверяла только итоговую кратность 100 и пропускала
// одиночные 50м-пункты (разминка/брасс/спина/заминка) посередине плана, из-за
// чего следующее упражнение стартовало не с той стороны. Отдельно: разминку
// сначала поставили ПОСЛЕ блока с инвентарём (чтобы точно не было ничего
// перед ним) — из-за этого она "терялась" где-то в середине краткого списка
// (шаг 4), что сбивало с толку читающего план. Вернули на привычное место
// первым пунктом, раз она и так уже 100м (баги найдены по фидбэку
// пользователя 2026-09-16, см. HANDOVER.md).

const STATUS_RANK = { mastered: 0, in_progress: 1, proposed: 2, deferred: 3 };

function unitFor(ex) {
  return ex.equipment ? 100 : 50;
}

function byStatusRank(a, b) {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status];
}

/**
 * @param {object} params
 * @param {Array} params.catalog - exercise_library.json exercises
 * @param {Array} params.log - training_log.json entries (хронологический порядок, старые первыми)
 * @param {number} params.targetMin
 * @param {number} params.targetMax
 * @param {object} params.settings
 * @param {object} [params.overrides] - { forceExclude:[code], forceInclude:[code],
 *   forceVolume:{code:meters}, allowDeferred:[code], maxNewItems:number, noNewItem:bool }
 */
export function generatePlan({ catalog, log, targetMin, targetMax, settings, overrides = {} }) {
  const forceExclude = overrides.forceExclude || [];
  const forceInclude = overrides.forceInclude || [];
  const forceVolume = overrides.forceVolume || {};
  const allowDeferred = overrides.allowDeferred || [];
  const maxNewItems = overrides.noNewItem ? 0 : overrides.maxNewItems ?? 1;

  const byCode = Object.fromEntries(catalog.map((e) => [e.code, e]));

  // deferred упражнения генератор сам никогда не предлагает — это единственный
  // надёжный способ выполнить "не предлагать deferred сразу после неудачной попытки"
  // без привязки к точным датам последней попытки (last_attempt_date часто ещё не
  // проставлена). Возврат из deferred — осознанное действие тренера в каталоге,
  // либо ручной allowDeferred-оверрайд здесь.
  const eligible = catalog.filter((ex) => {
    if (forceExclude.includes(ex.code)) return false;
    if (ex.status === 'deferred' && !allowDeferred.includes(ex.code)) return false;
    return true;
  });

  const warmup = eligible.find((e) => e.code === 'ne_warmup');
  const cooldown = eligible.find((e) => e.code === 'ne_cooldown');

  const equipmentPool = eligible
    .filter((e) => e.equipment && e.code !== 'ne_warmup' && e.code !== 'ne_cooldown')
    .sort(byStatusRank);

  const noEquipBasePool = eligible.filter(
    (e) => !e.equipment && e.tier === 'base' && e.code !== 'ne_warmup' && e.code !== 'ne_cooldown' && e.code !== 'ne_main_crawl'
  );

  const noEquipMediumPool = eligible.filter(
    (e) => !e.equipment && (e.tier === 'medium' || e.tier === 'advanced') && e.code !== 'ne_main_crawl'
  );

  // Настоящая случайность (Math.random), не история из журнала — по прямому
  // запросу пользователя (2026-09-16): чередование "не повторять прошлую
  // тренировку" давало слишком мало вариативности (правило работает только
  // если тренер сохраняет каждую тренировку в журнал, и даже тогда меняло
  // от силы 1 пункт из 10 — пул кандидатов слишком маленький). Детерминизм
  // из HANDOVER.md был про "не нужен AI/LLM в рантайме", не про "один и тот
  // же результат при каждом клике" — сами ПРАВИЛА (кратность, порядок
  // блоков, лимит новых упражнений) остаются жёстко детерминированными,
  // случайно выбирается только ЧТО из уже разрешённого правилами набора
  // попадёт в конкретный план. Fisher–Yates.
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const orderedMedium = shuffle(noEquipMediumPool);

  const items = [];

  function volumeFor(ex) {
    if (forceVolume[ex.code]) return forceVolume[ex.code];
    return unitFor(ex);
  }

  // requires (CATALOG_SCHEMA.md, добавлено 2026-09-22): упражнение из
  // пошаговой прогрессии (например 5 шагов кроля на спине) не должно
  // всплывать раньше своего предшественника. Пока предшественник не
  // "в процессе"/"освоено" — генератор сам его не предложит; ручной
  // forceInclude это правило обходит осознанно (тренер решил сам).
  function prerequisiteMet(ex) {
    if (!ex.requires) return true;
    const prereq = byCode[ex.requires];
    return !!prereq && (prereq.status === 'mastered' || prereq.status === 'in_progress');
  }

  // Какое (если есть) новое/предложенное упражнение попадёт в этот план —
  // решается один раз, заранее, случайным выбором из ВСЕХ подходящих
  // кандидатов (инвентарь + drills вместе), а не "чей блок обрабатывается
  // первым в коде" (было так раньше — инвентарь всегда успевал занять слот
  // до drills). Правило "не больше 1 продвинутого" по-прежнему соблюдается.
  const proposedCandidates = [...equipmentPool, ...noEquipMediumPool].filter((ex) => ex.status === 'proposed');
  const chosenNewCodes = new Set();
  if (maxNewItems > 0 && proposedCandidates.length) {
    const forced = proposedCandidates.filter((ex) => forceInclude.includes(ex.code));
    const rest = shuffle(proposedCandidates.filter((ex) => !forceInclude.includes(ex.code) && prerequisiteMet(ex)));
    let advancedUsed = false;
    for (const ex of [...forced, ...rest]) {
      if (chosenNewCodes.size >= maxNewItems) break;
      if (ex.tier === 'advanced' && advancedUsed) continue;
      chosenNewCodes.add(ex.code);
      if (ex.tier === 'advanced') advancedUsed = true;
    }
  }

  function canIncludeNew(ex) {
    if (ex.status !== 'proposed') return true;
    return chosenNewCodes.has(ex.code);
  }

  // Объём любого пункта плана (обычного или combo из двух половинок) —
  // все дальнейшие суммы считаются через эту функцию.
  function itemVolume(item) {
    return item.combo ? item.combo.reduce((s, h) => s + h.volume_m, 0) : item.volume_m;
  }

  // Пара "новое/непривычное упражнение (уменьшенный объём 50м) + известное
  // упражнение-заполнитель (50м)" — один круг 100м у старта, сохраняет
  // правило "первая попытка уменьшённым объёмом", не нарушая кратность 100
  // на уровне каждого пункта. Заполнитель — "кроль в полной координации" (та же роль,
  // что "50м обычный кроль" в примере пользователя).
  function newItemCombo(ex) {
    const fillerCode = byCode['ne_main_crawl'] ? 'ne_main_crawl' : cooldown ? cooldown.code : ex.code;
    return {
      combo: [
        { code: ex.code, volume_m: forceVolume[ex.code] || unitFor(ex) },
        { code: fillerCode, volume_m: 50 },
      ],
      block: 'no_equipment',
      is_new: true,
    };
  }

  // 1. Разминка — самый первый пункт плана, как и ожидает тренер (не
  // "куда-то в середину списка"). 100м (2×50 одного упражнения), не 50м —
  // правило "объём до инвентаря кратен 100" не требует, чтобы перед
  // инвентарём не было ВООБЩЕ ничего, только чтобы объём до него был
  // кратен 100 (100 кратно 100 — годится, пловчиха возвращается к старту).
  if (warmup) {
    items.push({ code: warmup.code, volume_m: forceVolume[warmup.code] || 100, block: 'warmup', is_new: false });
  }

  // Упражнение с always_include:false (CATALOG_SCHEMA.md) чередуется
  // случайно, монетка ~50/50 при каждой генерации — не история из журнала
  // (см. комментарий про shuffle() выше: пул слишком маленький, чтобы
  // история давала заметную вариативность). К proposed не применяется —
  // у них свой лимит новизны (chosenNewCodes выше).
  function rotationEligible(ex) {
    if (ex.status === 'proposed') return true;
    if (ex.always_include === false) return Math.random() < 0.5;
    return true;
  }

  // 2. Блок с инвентарём — весь целиком, сразу после разминки (объём до
  // него кратен 100, см. "Позиция у борта" в PLAN_RULES.md). Каждый пункт
  // уже кратен 100 по правилу кратности объёма.
  for (const ex of equipmentPool) {
    if (!canIncludeNew(ex)) continue;
    if (!rotationEligible(ex)) continue;
    items.push({ code: ex.code, volume_m: volumeFor(ex), block: 'equipment', is_new: ex.status === 'proposed' });
  }

  // 3. Стилевой сет (добавлено 2026-09-16 по примерам тренировок SwimRocket,
  // присланным пользователем — там разнообразие строится через ОДИН сет,
  // который сам крутит 2-3 стиля по кругу: "9×50: 1.кроль 2.спина 3.брасс",
  // "10×25 брасс+кроль", а не через отдельные пункты плана на каждый стиль).
  // Пул стилей: брасс целиком (всегда) + кроль (переиспользуем main_crawl —
  // это нормально, в примерах SwimRocket кроль тоже встречается несколько
  // раз за тренировку в разных пунктах) + спина, если она в этот раз прошла
  // по чередованию (rotationEligible, монетка ~50/50, как раньше). Порядок
  // внутри круга и число кругов (100 или 200м — 2 или 4 отрезка по 50м,
  // чётное число, чтобы круг сам оставался кратен 100) — тоже случайные,
  // это и есть основной источник разнообразия в этом блоке.
  const breastFull = noEquipBasePool.find((e) => e.code === 'ne_breast_full');
  const backPause = noEquipBasePool.find((e) => e.code === 'ne_back_pause');
  const stylePool = [];
  if (breastFull) stylePool.push(breastFull);
  if (byCode['ne_main_crawl']) stylePool.push(byCode['ne_main_crawl']);
  if (backPause && rotationEligible(backPause)) stylePool.push(backPause);
  for (const extra of noEquipBasePool.filter((e) => e.code !== 'ne_breast_full' && e.code !== 'ne_back_pause')) {
    if (rotationEligible(extra)) stylePool.push(extra);
  }

  if (stylePool.length === 1) {
    items.push({ code: stylePool[0].code, volume_m: forceVolume[stylePool[0].code] || 100, block: 'no_equipment', is_new: false });
  } else if (stylePool.length >= 2) {
    const shuffledStyles = shuffle(stylePool);
    const segmentCount = shuffle([2, 4])[0];
    const cycleEntries = [];
    for (let i = 0; i < segmentCount; i += 1) {
      const ex = shuffledStyles[i % shuffledStyles.length];
      cycleEntries.push({ code: ex.code, volume_m: 50 });
    }
    items.push({ combo: cycleEntries, block: 'no_equipment', is_new: false });
  }

  // 4. Техническая ротация (medium/advanced drills) — по умолчанию 2 разных
  // упражнения по 100м (не 3×50м — слишком много мелких пунктов, фидбэк
  // пользователя 2026-09-16), случайно выбранных из orderedMedium (уже
  // перемешан shuffle() выше). Новое/предложенное упражнение — исключение:
  // объём остаётся уменьшенным, оформляется combo-парой (см. newItemCombo),
  // чтобы не терять кратность 100; включается сюда, только если оно же
  // оказалось выбрано в chosenNewCodes.
  const drillTarget = 2;
  const drillStandardVolume = 100;
  let drillsChosen = 0;
  for (const ex of orderedMedium) {
    if (drillsChosen >= drillTarget) break;
    if (!canIncludeNew(ex)) continue;
    const isNewItem = ex.status === 'proposed';
    if (isNewItem) {
      items.push(newItemCombo(ex));
    } else {
      items.push({ code: ex.code, volume_m: forceVolume[ex.code] || drillStandardVolume, block: 'no_equipment', is_new: false });
    }
    drillsChosen += 1;
  }

  // 5. "Кроль в полной координации" — гибкий "доборный" пункт, всегда включён, всегда
  // кратен 100 (шаг добора — 100м).
  const mainCrawl = byCode['ne_main_crawl'];
  const mainCrawlItem = { code: 'ne_main_crawl', volume_m: forceVolume['ne_main_crawl'] || 100, block: 'no_equipment', is_new: false, flexible: true };
  if (mainCrawl) items.push(mainCrawlItem);

  // 6. Заминка — фиксированный последний пункт. 100м, не 50м — по тому же
  // правилу: последний пункт тоже должен начинаться (и как итог, весь план
  // — заканчиваться) у старта.
  if (cooldown) {
    items.push({ code: cooldown.code, volume_m: forceVolume[cooldown.code] || 100, block: 'cooldown', is_new: false });
  }

  const sum = () => items.reduce((s, i) => s + itemVolume(i), 0);
  // Сумма всех пунктов, КРОМЕ гибкого основного блока кроля.
  const fixedSum = () => items.reduce((s, i) => (i.flexible ? s : s + itemVolume(i)), 0);

  // Подрезка: если даже минимальный main_crawl (100м — все остальные пункты
  // уже гарантированно кратны 100 по построению) не помещается в верхнюю
  // границу — убираем сначала новое/предложенное упражнение (combo целиком),
  // затем технические drills по одному, с конца.
  const drillCodes = new Set(orderedMedium.map((e) => e.code));
  const isDrillItem = (item) => (item.combo ? item.combo.some((h) => drillCodes.has(h.code)) : drillCodes.has(item.code));
  let trimGuard = 0;
  while (fixedSum() + 100 > targetMax && trimGuard < 10) {
    trimGuard += 1;
    const newIdx = items.findIndex((i) => i.is_new);
    if (newIdx !== -1) {
      items.splice(newIdx, 1);
      continue;
    }
    let lastDrillIdx = -1;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (isDrillItem(items[i])) {
        lastDrillIdx = i;
        break;
      }
    }
    if (lastDrillIdx !== -1) {
      items.splice(lastDrillIdx, 1);
      continue;
    }
    break; // нечего больше убрать без нарушения обязательных пунктов
  }

  // Добор объёма до диапазона через main_crawl, шагом 100м, если пользователь
  // не зафиксировал объём вручную. Все остальные пункты уже кратны 100, так
  // что итог остаётся кратным 100 на любом шаге.
  if (mainCrawl && !forceVolume['ne_main_crawl']) {
    const fs = fixedSum();
    let mainVol = 100;
    let guard = 0;
    while (fs + mainVol < targetMin && guard < 20) {
      mainVol += 100;
      guard += 1;
    }
    if (fs + mainVol > targetMax && mainVol > 100) {
      mainVol -= 100;
    }
    mainCrawlItem.volume_m = mainVol;
  }

  const totalVolume = sum();
  const withinRange = totalVolume >= targetMin && totalVolume <= targetMax;
  const multipleOf100 = totalVolume % 100 === 0;

  const reserve = {
    exercise_code: 'ne_main_crawl',
    volume_m: forceVolume['reserve'] || 100,
    mandatory: !!settings.reserve_mandatory,
    label: settings.reserve_mandatory ? 'обязательный объём' : 'если успевает',
  };
  if (reserve.mandatory) {
    // Заминка обязана оставаться последним пунктом (PLAN_RULES.md) — если
    // резерв стал обязательным, он встаёт ПЕРЕД заминкой, а не после нее
    // (более ранняя версия push'ила резерв в самый конец, уже после
    // заминки — баг найден по фидбэку пользователя 2026-09-16).
    const reserveItem = {
      code: reserve.exercise_code,
      volume_m: reserve.volume_m,
      block: 'reserve',
      is_new: false,
      is_reserve: true,
    };
    const cooldownIdx = items.findIndex((i) => i.block === 'cooldown');
    if (cooldownIdx !== -1) {
      items.splice(cooldownIdx, 0, reserveItem);
    } else {
      items.push(reserveItem);
    }
  }

  return {
    items,
    byCode,
    totalVolume: reserve.mandatory ? totalVolume + reserve.volume_m : totalVolume,
    mandatoryVolume: totalVolume,
    targetMin,
    targetMax,
    withinRange,
    multipleOf100,
    reserve,
  };
}

// Разворачивает список пунктов плана в 50-метровые сегменты со сквозным маркером
// отдыха после каждого сегмента (PLAN_RULES.md: "отдых после каждых 50 м,
// независимо от того, где заканчивается конкретное упражнение" — то есть и
// посреди 100-метрового упражнения с инвентарём тоже).
export function expandToRestSegments(items) {
  const segments = [];
  for (const item of items) {
    const halves = item.combo || [{ code: item.code, volume_m: item.volume_m }];
    for (const half of halves) {
      const segCount = Math.round(half.volume_m / 50);
      for (let i = 0; i < segCount; i += 1) {
        segments.push({ code: half.code, block: item.block, segment_m: 50, exercise_total_m: half.volume_m });
      }
    }
  }
  return segments;
}
