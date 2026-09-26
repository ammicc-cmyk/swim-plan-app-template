import { initPlanTab } from './tabs/planTab.js';
import { initCatalogTab } from './tabs/catalogTab.js';
import { initLogTab } from './tabs/logTab.js';
import { initSettingsTab } from './tabs/settingsTab.js';

const TABS = [
  { id: 'plan', label: 'Генератор плана', init: initPlanTab },
  { id: 'catalog', label: 'Каталог упражнений', init: initCatalogTab },
  { id: 'log', label: 'Журнал тренировок', init: initLogTab },
  { id: 'settings', label: 'Настройки', init: initSettingsTab },
];

function main() {
  const tabButtons = document.getElementById('tab-buttons');
  const tabRoot = document.getElementById('tab-root');

  tabButtons.innerHTML = TABS.map((t, i) => `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-id="${t.id}">${t.label}</button>`).join('');

  function activate(id) {
    const tab = TABS.find((t) => t.id === id);
    if (!tab) return;
    tabButtons.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
    tabRoot.innerHTML = '';
    tab.init(tabRoot);
  }

  tabButtons.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => activate(btn.dataset.id));
  });

  activate(TABS[0].id);
}

main();
