import { loadSettings, saveSettings } from '../storage.js';

export function initSettingsTab(root) {
  const settings = loadSettings();
  root.innerHTML = `
    <section class="panel">
      <h2>Настройки</h2>
      <div class="stack-form">
        <label>Бассейн (м, фиксировано) <input type="number" value="${settings.pool_length_m}" disabled></label>
        <label>Длительность тренировки (мин, фиксировано) <input type="number" value="${settings.session_minutes}" disabled></label>
        <div class="hint">≈${settings.default_target_min}–${settings.default_target_max} м за 45 мин на текущем темпе пловчихи.</div>
        <label>Стиль-фокус <input type="text" id="s-style" value="${settings.style_focus}"></label>
        <label>Частота тренировок в неделю <input type="number" id="s-freq" value="${settings.frequency_per_week ?? ''}"></label>
        <label>Диапазон объёма по умолчанию: от <input type="number" id="s-min" step="50" value="${settings.default_target_min}"> до <input type="number" id="s-max" step="50" value="${settings.default_target_max}"></label>
        <label>Сколько тренировок ждать перед повторной попыткой deferred-упражнения <input type="number" id="s-cooldown" value="${settings.deferred_cooldown_sessions}"></label>
        <label><input type="checkbox" id="s-reserve-mandatory" ${settings.reserve_mandatory ? 'checked' : ''}> Резерв — обязательный объём (а не "если успевает")</label>
        <div class="hint">Открытый вопрос из HANDOVER.md: переводить резерв в обязательный, только если причина всех исключений в недавних тренировках — не техническая усталость к концу.</div>
        <button id="save-settings">Сохранить настройки</button>
        <div id="settings-saved" class="hint ok" style="display:none;">Сохранено.</div>
      </div>
    </section>
  `;

  root.querySelector('#save-settings').addEventListener('click', () => {
    const updated = {
      ...settings,
      style_focus: root.querySelector('#s-style').value,
      frequency_per_week: root.querySelector('#s-freq').value ? Number(root.querySelector('#s-freq').value) : null,
      default_target_min: Number(root.querySelector('#s-min').value),
      default_target_max: Number(root.querySelector('#s-max').value),
      deferred_cooldown_sessions: Number(root.querySelector('#s-cooldown').value),
      reserve_mandatory: root.querySelector('#s-reserve-mandatory').checked,
    };
    saveSettings(updated);
    const savedNote = root.querySelector('#settings-saved');
    savedNote.style.display = 'block';
    setTimeout(() => (savedNote.style.display = 'none'), 1500);
  });
}
