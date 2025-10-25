// Ініціалізація при завантаженні popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await updateUI();
  await updateLogs();
  setupEventListeners();
  setupTabs();
  setupToggleSwitches();
});

// Налаштування вкладок
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;

      // Видалити активний клас з усіх вкладок
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));

      // Додати активний клас до вибраної вкладки
      tab.classList.add('active');
      document.getElementById(targetTab).classList.add('active');

      // Оновити дані при переключенні вкладок
      if (targetTab === 'open-trades') {
        updateOpenTrades();
      } else if (targetTab === 'closed-trades') {
        updateClosedTrades();
      } else if (targetTab === 'logs') {
        updateLogs();
      }
    });
  });
}

// Налаштування toggle switches
function setupToggleSwitches() {
  // Global Martingale Toggle
  const globalMartingaleToggle = document.getElementById('globalMartingaleToggle');
  globalMartingaleToggle.addEventListener('click', function() {
    this.classList.toggle('active');
    saveSettings();
  });

  // Martingale Level Toggles
  const levelToggles = document.querySelectorAll('[data-level]');
  levelToggles.forEach(toggle => {
    toggle.addEventListener('click', function() {
      this.classList.toggle('active');
      saveSettings();
    });
  });

  // Stake Type Toggle
  const stakeType = document.getElementById('stakeType');
  const fixedGroup = document.getElementById('fixedAmountGroup');
  const percentGroup = document.getElementById('percentAmountGroup');

  stakeType.addEventListener('change', () => {
    if (stakeType.value === 'fixed') {
      fixedGroup.style.display = 'block';
      percentGroup.style.display = 'none';
    } else {
      fixedGroup.style.display = 'none';
      percentGroup.style.display = 'block';
    }
    saveSettings();
  });
}

// Завантаження збережених налаштувань
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'initialAmount',
    'percentAmount',
    'stakeType',
    'defaultTimeframe',
    'maxMartingale',
    'martingaleMultiplier',
    'martingaleMultiplierPercent',
    'globalMartingale',
    'activeLevels',
    'botActive'
  ]);

  if (settings.initialAmount) {
    document.getElementById('initialAmount').value = settings.initialAmount;
  }
  if (settings.percentAmount) {
    document.getElementById('percentAmount').value = settings.percentAmount;
  }
  if (settings.stakeType) {
    document.getElementById('stakeType').value = settings.stakeType;
    const fixedGroup = document.getElementById('fixedAmountGroup');
    const percentGroup = document.getElementById('percentAmountGroup');
    if (settings.stakeType === 'fixed') {
      fixedGroup.style.display = 'block';
      percentGroup.style.display = 'none';
    } else {
      fixedGroup.style.display = 'none';
      percentGroup.style.display = 'block';
    }
  }
  if (settings.defaultTimeframe) {
    document.getElementById('defaultTimeframe').value = settings.defaultTimeframe;
  }
  if (settings.maxMartingale !== undefined) {
    document.getElementById('maxMartingale').value = settings.maxMartingale;
  }
  if (settings.martingaleMultiplier) {
    document.getElementById('martingaleMultiplier').value = settings.martingaleMultiplier;
  }
  if (settings.martingaleMultiplierPercent) {
    document.getElementById('martingaleMultiplierPercent').value = settings.martingaleMultiplierPercent;
  }

  // Global Martingale Toggle
  const globalMartingaleToggle = document.getElementById('globalMartingaleToggle');
  if (settings.globalMartingale !== undefined && !settings.globalMartingale) {
    globalMartingaleToggle.classList.remove('active');
  }

  // Active Levels
  if (settings.activeLevels) {
    const levelToggles = document.querySelectorAll('[data-level]');
    levelToggles.forEach(toggle => {
      const level = parseInt(toggle.dataset.level);
      if (!settings.activeLevels.includes(level)) {
        toggle.classList.remove('active');
      }
    });
  }
}

// Оновлення UI
async function updateUI() {
  const data = await chrome.storage.local.get(['botActive', 'trades', 'stats', 'scheduledTrades']);

  const botActive = data.botActive || false;
  const stats = data.stats || { total: 0, wins: 0, losses: 0, profit: 0 };
  const scheduledTrades = data.scheduledTrades || [];

  // Оновлення статусу бота
  const statusEl = document.getElementById('botStatus');
  const startBtn = document.getElementById('startBot');
  const stopBtn = document.getElementById('stopBot');

  if (botActive) {
    statusEl.innerHTML = '<span class="status-dot"></span><span>Активний</span>';
    statusEl.className = 'status-badge active';
    startBtn.style.display = 'none';
    stopBtn.style.display = 'flex';
  } else {
    statusEl.innerHTML = '<span class="status-dot"></span><span>Не активний</span>';
    statusEl.className = 'status-badge inactive';
    startBtn.style.display = 'flex';
    stopBtn.style.display = 'none';
  }

  // Оновлення статистики
  document.getElementById('totalTrades').textContent = stats.total || 0;
  const winRate = stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0;
  document.getElementById('winRate').textContent = winRate + '%';
  document.getElementById('totalProfit').textContent = Math.round(stats.profit || 0) + '₴';
  document.getElementById('scheduledCount').textContent = scheduledTrades.length;
}

// Оновлення відкритих угод
async function updateOpenTrades() {
  const data = await chrome.storage.local.get(['trades', 'scheduledTrades']);
  const trades = data.trades || [];
  const scheduledTrades = data.scheduledTrades || [];
  const allOpenTrades = [...trades, ...scheduledTrades];

  const openTradesListEl = document.getElementById('openTradesList');

  if (allOpenTrades.length === 0) {
    openTradesListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div>Немає відкритих угод</div>
      </div>
    `;
  } else {
    openTradesListEl.innerHTML = allOpenTrades.map(trade => createOpenTradeHTML(trade)).join('');
  }
}

// Створення HTML для відкритої угоди
function createOpenTradeHTML(trade) {
  const directionClass = trade.direction === 'CALL' ? 'call' : 'put';
  const isScheduled = trade.status === 'scheduled' || !trade.status;

  return `
    <div class="trade-item">
      <div class="trade-header">
        <span class="trade-pair">${trade.pair || 'N/A'}</span>
        <span class="trade-direction ${directionClass}">${trade.direction || 'N/A'}</span>
      </div>
      <div class="trade-info">
        <span>💰 Сума: ${trade.amount || 0} ₴</span>
        <span>⏱ ${trade.time || 'N/A'}</span>
      </div>
      ${trade.martingaleLevel ? `<div class="trade-info"><span>🔄 Мартингейл: рівень ${trade.martingaleLevel}</span></div>` : ''}
      ${isScheduled ? `<div class="trade-info"><span style="color: #00d9ff;">⏰ Заплановано</span></div>` : ''}
    </div>
  `;
}

// Оновлення закритих угод
async function updateClosedTrades(filter = 'all') {
  const data = await chrome.storage.local.get('closedTrades');
  let closedTrades = data.closedTrades || [];

  // Фільтрація
  if (filter === 'win') {
    closedTrades = closedTrades.filter(trade => trade.status === 'win');
  } else if (filter === 'loss') {
    closedTrades = closedTrades.filter(trade => trade.status === 'loss');
  }

  const closedTradesListEl = document.getElementById('closedTradesList');

  if (closedTrades.length === 0) {
    closedTradesListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <div>Немає закритих угод</div>
      </div>
    `;
  } else {
    // Сортування за часом (найновіші спочатку)
    closedTrades.sort((a, b) => {
      const timeA = new Date(a.closeTime || a.time || 0);
      const timeB = new Date(b.closeTime || b.time || 0);
      return timeB - timeA;
    });

    closedTradesListEl.innerHTML = closedTrades.map(trade => createClosedTradeHTML(trade)).join('');
  }
}

// Створення HTML для закритої угоди
function createClosedTradeHTML(trade) {
  const directionClass = trade.direction === 'CALL' ? 'call' : 'put';
  const statusClass = trade.status === 'win' ? 'win' : 'loss';
  const statusText = trade.status === 'win' ? '✅ Виграш' : '❌ Програш';
  const resultClass = trade.status === 'win' ? 'win' : 'loss';

  return `
    <div class="trade-item ${statusClass}">
      <div class="trade-header">
        <span class="trade-pair">${trade.pair || 'N/A'}</span>
        <span class="trade-direction ${directionClass}">${trade.direction || 'N/A'}</span>
      </div>
      <div class="trade-info">
        <span>💰 Ставка: ${trade.amount || 0} ₴</span>
        <span>💵 Прибуток: ${trade.profit || 0} ₴</span>
      </div>
      <div class="trade-info">
        <span>⏱ ${trade.closeTime || trade.time || 'N/A'}</span>
      </div>
      ${trade.martingaleLevel ? `<div class="trade-info"><span>🔄 Мартингейл: рівень ${trade.martingaleLevel}</span></div>` : ''}
      <div class="trade-result ${resultClass}">${statusText}</div>
    </div>
  `;
}

// Налаштування обробників подій
function setupEventListeners() {
  // Збереження налаштувань при зміні
  document.getElementById('initialAmount').addEventListener('change', saveSettings);
  document.getElementById('percentAmount').addEventListener('change', saveSettings);
  document.getElementById('stakeType').addEventListener('change', saveSettings);
  document.getElementById('defaultTimeframe').addEventListener('change', saveSettings);
  document.getElementById('maxMartingale').addEventListener('change', saveSettings);
  document.getElementById('martingaleMultiplier').addEventListener('change', saveSettings);
  document.getElementById('martingaleMultiplierPercent').addEventListener('change', saveSettings);

  // Запуск/зупинка бота
  document.getElementById('startBot').addEventListener('click', startBot);
  document.getElementById('stopBot').addEventListener('click', stopBot);

  // Тестовий сигнал
  document.getElementById('testSignal').addEventListener('click', sendTestSignal);

  // Очистка логів
  document.getElementById('clearLogs').addEventListener('click', clearLogs);

  // Експорт логів
  document.getElementById('exportLogs').addEventListener('click', exportLogs);

  // Оновлення закритих угод
  document.getElementById('refreshClosedTrades').addEventListener('click', refreshClosedTrades);

  // Фільтри для закритих угод
  const filterTabs = document.querySelectorAll('.filter-tab');
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const filter = tab.dataset.filter;
      updateClosedTrades(filter);
    });
  });
}

// Збереження налаштувань
async function saveSettings() {
  const globalMartingaleToggle = document.getElementById('globalMartingaleToggle');
  const levelToggles = document.querySelectorAll('[data-level]');

  const activeLevels = [];
  levelToggles.forEach(toggle => {
    if (toggle.classList.contains('active')) {
      activeLevels.push(parseInt(toggle.dataset.level));
    }
  });

  const settings = {
    initialAmount: parseFloat(document.getElementById('initialAmount').value),
    percentAmount: parseFloat(document.getElementById('percentAmount').value),
    stakeType: document.getElementById('stakeType').value,
    defaultTimeframe: parseInt(document.getElementById('defaultTimeframe').value),
    maxMartingale: parseInt(document.getElementById('maxMartingale').value),
    martingaleMultiplier: parseFloat(document.getElementById('martingaleMultiplier').value),
    martingaleMultiplierPercent: parseFloat(document.getElementById('martingaleMultiplierPercent').value),
    globalMartingale: globalMartingaleToggle.classList.contains('active'),
    activeLevels: activeLevels
  };

  await chrome.storage.local.set(settings);
}

// Запуск бота
async function startBot() {
  await saveSettings();
  await chrome.storage.local.set({ botActive: true });

  // Відправка повідомлення background script
  chrome.runtime.sendMessage({ action: 'startBot' });

  await updateUI();
  addLog('Бота запущено', 'success');
}

// Зупинка бота
async function stopBot() {
  await chrome.storage.local.set({ botActive: false });

  // Відправка повідомлення background script
  chrome.runtime.sendMessage({ action: 'stopBot' });

  await updateUI();
  addLog('Бота зупинено', 'warning');
}

// Відправка тестового сигналу
async function sendTestSignal() {
  const now = new Date();
  const entryTime = new Date(now.getTime() + 2 * 60000); // Через 2 хвилини

  const testSignal = {
    pair: 'EUR/USD',
    direction: 'CALL',
    timeframe: '5M',
    entryTime: formatTime(entryTime),
    martingaleLevels: [
      { level: 1, time: formatTime(new Date(entryTime.getTime() + 5 * 60000)) },
      { level: 2, time: formatTime(new Date(entryTime.getTime() + 10 * 60000)) },
      { level: 3, time: formatTime(new Date(entryTime.getTime() + 15 * 60000)) }
    ],
    isTestSignal: true
  };

  chrome.runtime.sendMessage({
    action: 'processSignal',
    signal: testSignal
  });

  addLog(`Тестовий сигнал відправлено! Угода буде відкрита о ${testSignal.entryTime}`, 'info');
  alert('Тестовий сигнал відправлено! Угода буде відкрита о ' + testSignal.entryTime);
}

// Оновлення закритих угод з сайту
async function refreshClosedTrades() {
  addLog('Оновлення закритих угод...', 'info');

  // Відправка повідомлення до content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab && tab.url && tab.url.includes('pocketoption.com')) {
    chrome.tabs.sendMessage(tab.id, { action: 'fetchClosedTrades' }, (response) => {
      if (response && response.success) {
        addLog(`Оновлено ${response.count} закритих угод`, 'success');
        updateClosedTrades();
      } else {
        addLog('Помилка оновлення угод. Переконайтеся, що ви на сайті PocketOption', 'error');
      }
    });
  } else {
    addLog('Відкрийте вкладку з PocketOption для оновлення угод', 'error');
    alert('Спочатку відкрийте вкладку з PocketOption!');
  }
}

// Форматування часу
function formatTime(date) {
  return date.toTimeString().substr(0, 5);
}

// Додавання логу
async function addLog(message, type = 'info') {
  const now = new Date();
  const timeStr = now.toTimeString().substr(0, 8);

  const data = await chrome.storage.local.get('logs');
  const logs = data.logs || [];

  logs.push({
    time: timeStr,
    message: message,
    type: type
  });

  // Зберігаємо тільки останні 100 логів
  if (logs.length > 100) {
    logs.shift();
  }

  await chrome.storage.local.set({ logs: logs });
  await updateLogs();
}

// Оновлення логів
async function updateLogs() {
  const data = await chrome.storage.local.get('logs');
  const logs = data.logs || [];

  const logsContainer = document.getElementById('logsContainer');

  if (logs.length === 0) {
    logsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div>Логи з'являться тут...</div>
      </div>
    `;
  } else {
    logsContainer.innerHTML = logs.slice(-50).map(log => {
      const logClass = log.type || 'info';
      return `
        <div class="log-entry log-${logClass}">
          <span class="log-time">[${log.time}]</span>
          <span>${log.message}</span>
        </div>
      `;
    }).join('');

    // Прокрутка вниз
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }
}

// Очистка логів
async function clearLogs() {
  await chrome.storage.local.set({ logs: [] });
  await updateLogs();
}

// Експорт логів
async function exportLogs() {
  const data = await chrome.storage.local.get('logs');
  const logs = data.logs || [];

  if (logs.length === 0) {
    alert('Немає логів для експорту');
    return;
  }

  const logText = logs.map(log => `[${log.time}] ${log.type.toUpperCase()}: ${log.message}`).join('\n');
  const blob = new Blob([logText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `bot-logs-${new Date().toISOString().split('T')[0]}.txt`;
  a.click();

  URL.revokeObjectURL(url);
  addLog('Логи експортовано', 'success');
}

// Оновлення UI кожні 2 секунди
setInterval(async () => {
  await updateUI();
  await updateOpenTrades();

  // Оновлюємо логи тільки якщо вкладка логів активна
  const logsTab = document.getElementById('logs');
  if (logsTab.classList.contains('active')) {
    await updateLogs();
  }
}, 2000);
