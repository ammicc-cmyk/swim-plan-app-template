// Валидация записи каталога по CATALOG_SCHEMA.md.

export const TIERS = ['base', 'medium', 'advanced'];
export const STATUSES = ['mastered', 'in_progress', 'proposed', 'deferred'];
// Физически в наличии только доска и колобашка (см. указание пользователя) —
// ласты/трубка/лопатки сознательно не поддерживаются ни в каталоге, ни в форме
// добавления упражнения. Список закрытый (не свободный ввод), в отличие от общего
// допущения в CATALOG_SCHEMA.md ("...") — это осознанное сужение под реальный инвентарь.
export const KNOWN_EQUIPMENT = ['board', 'pull_buoy', 'board_optional'];

export function expectedVolumeFor(equipment) {
  const hasEquipment = equipment !== null && equipment !== undefined && String(equipment).trim() !== '';
  return hasEquipment ? 100 : 50;
}

// existingCodes: коды, уже занятые в каталоге (для проверки уникальности при добавлении).
// ignoreCode: код самой записи при редактировании — не конфликтует сам с собой.
export function validateExercise(ex, existingCodes, ignoreCode) {
  const errors = [];

  if (!ex.code || !/^[a-z][a-z0-9_]*$/.test(ex.code)) {
    errors.push('code: обязателен, только snake_case (латиница, цифры, "_", начинается с буквы).');
  } else if (existingCodes.includes(ex.code) && ex.code !== ignoreCode) {
    errors.push(`code: "${ex.code}" уже используется в каталоге — код должен быть уникальным.`);
  }

  if (!ex.name || !String(ex.name).trim()) {
    errors.push('name: обязательно.');
  }

  const equipment = ex.equipment === '' ? null : ex.equipment;
  if (equipment !== null && !KNOWN_EQUIPMENT.includes(equipment)) {
    errors.push(
      `equipment: "${equipment}" не в списке доступного инвентаря (${KNOWN_EQUIPMENT.join(', ')}) — ` +
        'физически в наличии только доска и колобашка.'
    );
  }
  const expected = expectedVolumeFor(equipment);
  if (Number(ex.volume_unit_m) !== expected) {
    const equipLabel = equipment === null ? 'null (без инвентаря)' : `"${equipment}"`;
    errors.push(
      `volume_unit_m: при equipment=${equipLabel} должно быть ${expected} м ` +
        '(правило кратности объёма из PLAN_RULES.md — с инвентарём кратно 100, без — кратно 50).'
    );
  }

  if (!TIERS.includes(ex.tier)) {
    errors.push(`tier: должен быть одним из: ${TIERS.join(', ')}.`);
  }

  if (!STATUSES.includes(ex.status)) {
    errors.push(`status: должен быть одним из: ${STATUSES.join(', ')}.`);
  }

  if (!ex.focus || !String(ex.focus).trim()) {
    errors.push('focus: обязательно, непустое — без фокуса упражнение бесполезно в выводе плана.');
  }

  if (ex.requires && !existingCodes.includes(ex.requires)) {
    errors.push(`requires: код "${ex.requires}" не найден в каталоге.`);
  }
  if (ex.requires && ex.requires === ex.code) {
    errors.push('requires: упражнение не может требовать само себя.');
  }

  return errors;
}

export function normalizeNewExercise(input) {
  return {
    code: (input.code || '').trim(),
    name: (input.name || '').trim(),
    equipment: input.equipment && input.equipment.trim() !== '' ? input.equipment.trim() : null,
    volume_unit_m: Number(input.volume_unit_m),
    tier: input.tier,
    // Новое упражнение начинается как proposed — CATALOG_SCHEMA.md.
    status: 'proposed',
    focus: (input.focus || '').trim(),
    notes: (input.notes || '').trim(),
    last_attempt_date: null,
    // Для proposed always_include не используется генератором (см.
    // CATALOG_SCHEMA.md), но проставляем true по умолчанию, чтобы поле не
    // оставалось undefined для будущих статусов этой записи.
    always_include: input.always_include !== false,
    requires: input.requires && input.requires.trim() !== '' ? input.requires.trim() : null,
  };
}
