import { expandToRestSegments } from './rulesEngine.js';

const BLOCK_LABEL = {
  warmup: 'Разминка',
  equipment: 'С инвентарём',
  no_equipment: 'Без инвентаря',
  cooldown: 'Заминка',
  reserve: 'Резерв',
};

function unitFor(ex) {
  return ex && ex.equipment ? 100 : 50;
}

function formatVolume(volume_m, ex) {
  const unit = unitFor(ex);
  const reps = Math.round(volume_m / unit);
  if (reps <= 1) return `${volume_m}м`;
  return `${reps}×${unit}м (${volume_m}м)`;
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

export function renderPlan(plan, catalogByCode) {
  const { items, targetMin, targetMax, totalVolume, mandatoryVolume, withinRange, multipleOf100, reserve } = plan;

  const shortLines = items
    .map((item) => {
      if (item.combo) {
        const parts = item.combo
          .map((h) => `${h.volume_m}м ${esc(catalogByCode[h.code] ? catalogByCode[h.code].name : h.code)}`)
          .join(' + ');
        return `<li>${parts}${item.is_new ? ' <span class="badge badge-new">новое</span>' : ''}</li>`;
      }
      const ex = catalogByCode[item.code];
      const name = ex ? ex.name : item.code;
      const badges =
        (item.is_new ? ' <span class="badge badge-new">новое</span>' : '') +
        (item.is_reserve ? ' <span class="badge badge-reserve">резерв</span>' : '');
      return `<li>${formatVolume(item.volume_m, ex)} — ${esc(name)}${badges}</li>`;
    })
    .join('');

  const detailRows = items
    .map((item) => {
      if (item.combo) {
        const halvesHtml = item.combo
          .map((h) => {
            const hEx = catalogByCode[h.code];
            if (!hEx) return '';
            return `
            <div class="plan-detail-combo-half">
              <strong>${h.volume_m}м — ${esc(hEx.name)}</strong>
              <div>Инвентарь: ${hEx.equipment ? esc(hEx.equipment) : 'без инвентаря'}</div>
              <div>Фокус: ${esc(hEx.focus)}</div>
            </div>`;
          })
          .join('<div class="plan-detail-combo-plus">+</div>');
        const comboVolume = item.combo.reduce((s, h) => s + h.volume_m, 0);
        const comboTitle =
          item.combo.length > 2
            ? `Сет ${comboVolume}м — чередование стилей (${item.combo.length}×50м)`
            : `Круг ${comboVolume}м из двух упражнений`;
        return `
        <div class="plan-detail-row block-${item.block} plan-detail-combo">
          <div class="plan-detail-head">
            <span class="block-tag">${BLOCK_LABEL[item.block] || item.block}</span>
            <strong>${esc(comboTitle)}</strong>
            ${item.is_new ? '<span class="badge badge-new">новое, уменьшенный объём</span>' : ''}
          </div>
          <div class="plan-detail-combo-halves">${halvesHtml}</div>
        </div>`;
      }
      const ex = catalogByCode[item.code];
      if (!ex) return '';
      return `
        <div class="plan-detail-row block-${item.block}">
          <div class="plan-detail-head">
            <span class="block-tag">${BLOCK_LABEL[item.block] || item.block}</span>
            <strong>${esc(ex.name)}</strong>
            ${item.is_new ? '<span class="badge badge-new">новое, уменьшенный объём</span>' : ''}
            ${item.is_reserve ? '<span class="badge badge-reserve">резерв — обязательный объём</span>' : ''}
          </div>
          <div class="plan-detail-meta">
            <span>Объём: ${formatVolume(item.volume_m, ex)}</span>
            <span>Инвентарь: ${ex.equipment ? esc(ex.equipment) : 'без инвентаря'}</span>
          </div>
          <div class="plan-detail-focus">Фокус: ${esc(ex.focus)}</div>
        </div>`;
    })
    .join('');

  // Когда резерв обязательный, он уже вставлен в items (перед заминкой) и
  // виден в кратком плане/подробностях с меткой "резерв" — отдельный блок
  // внизу тогда не нужен, иначе один и тот же пункт дублируется на экране.
  const reserveBlock = reserve.mandatory
    ? ''
    : `
    <div class="plan-reserve">
      <strong>Резерв (${esc(reserve.label)})</strong> —
      ${catalogByCode[reserve.exercise_code] ? esc(catalogByCode[reserve.exercise_code].name) : reserve.exercise_code},
      ${reserve.volume_m}м, тот же фокус/стиль, что кроль в полной координации — для сравнимости прогресса.
      <div class="hint">Выполняется "если успевает", в общий объём не входит.</div>
    </div>`;

  let rangeNote;
  if (withinRange && multipleOf100) {
    rangeNote = `<span class="ok">В диапазоне ${targetMin}–${targetMax} м, кратно 100 м — пловчиха заканчивает у старта</span>`;
  } else if (!multipleOf100) {
    rangeNote = `<span class="warn">Объём ${mandatoryVolume} м не кратен 100 м — пловчиха не закончит тренировку у старта (PLAN_RULES.md, "Позиция у борта"). Попробуйте другой диапазон.</span>`;
  } else {
    rangeNote = `<span class="warn">Не удалось точно попасть в диапазон ${targetMin}–${targetMax} м доступными упражнениями — объём ${mandatoryVolume} м. Добавьте упражнение или измените диапазон.</span>`;
  }

  return `
    <div class="plan-summary">
      <div class="plan-total">Объём (обязательный): <strong>${mandatoryVolume} м</strong> ${rangeNote}</div>
      ${reserve.mandatory ? `<div class="plan-total-with-reserve">Итого с резервом: <strong>${totalVolume} м</strong></div>` : ''}
    </div>
    <h3>Краткий план</h3>
    <ol class="plan-short-list">${shortLines}</ol>
    <h3>Подробности</h3>
    <div class="plan-details">${detailRows}</div>
    ${reserveBlock}
    <details class="rest-segments">
      <summary>Показать по 50 м (маркеры отдыха)</summary>
      ${renderRestSegments(items, catalogByCode)}
    </details>
  `;
}

function renderRestSegments(items, catalogByCode) {
  const segments = expandToRestSegments(items);
  const parts = segments.map((seg, idx) => {
    const ex = catalogByCode[seg.code];
    const name = ex ? ex.name : seg.code;
    return `<span class="segment">${esc(name)} 50м</span>` + (idx < segments.length - 1 ? '<span class="rest-marker">↴ отдых</span>' : '');
  });
  return `<div class="segments-flow">${parts.join('')}</div>`;
}
