// Ініціалізація при завантаженні popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await updateUI();
  await updateLogs();
  setupEventListeners();
  setupTabs();
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

// Завантаження збережених налаштувань
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'initialAmount',
    'defaultTimeframe',
    'maxMartingale',
    'martingaleMultiplier',
    'globalMartingaleLevel',
    'pairLosses',
    'botActive'
  ]);

  if (settings.initialAmount) {
    document.getElementById('initialAmount').value = settings.initialAmount;
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

  // Оновити відображення стану мартингейлу
  await updateMartingaleStatus();
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
  document.getElementById('defaultTimeframe').addEventListener('change', saveSettings);
  document.getElementById('maxMartingale').addEventListener('change', saveSettings);
  document.getElementById('martingaleMultiplier').addEventListener('change', saveSettings);

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

  // Скидання мартингейлу
  document.getElementById('resetMartingale').addEventListener('click', resetMartingale);

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
  const settings = {
    initialAmount: parseFloat(document.getElementById('initialAmount').value),
    stakeType: 'fixed', // Завжди використовуємо фіксовану суму
    defaultTimeframe: parseInt(document.getElementById('defaultTimeframe').value),
    maxMartingale: parseInt(document.getElementById('maxMartingale').value),
    martingaleMultiplier: parseFloat(document.getElementById('martingaleMultiplier').value)
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
  // Отримуємо налаштування для таймфрейму
  const settings = await chrome.storage.local.get(['defaultTimeframe']);
  const timeframeMinutes = settings.defaultTimeframe || 5;

  const now = new Date();
  const entryTime = new Date(now.getTime() + 2 * 60000); // Через 2 хвилини

  // Форматуємо таймфрейм
  let timeframeStr = `${timeframeMinutes}M`;
  if (timeframeMinutes >= 60) {
    timeframeStr = `${Math.floor(timeframeMinutes / 60)}H`;
  }

  const testSignal = {
    pair: 'EUR/USD',
    direction: 'CALL',
    timeframe: timeframeStr,
    entryTime: formatTime(entryTime),
    martingaleLevels: [
      { level: 1, time: formatTime(new Date(entryTime.getTime() + timeframeMinutes * 60000)) },
      { level: 2, time: formatTime(new Date(entryTime.getTime() + timeframeMinutes * 2 * 60000)) },
      { level: 3, time: formatTime(new Date(entryTime.getTime() + timeframeMinutes * 3 * 60000)) }
    ],
    isTestSignal: true
  };

  chrome.runtime.sendMessage({
    action: 'processSignal',
    signal: testSignal
  });

  addLog(`Тестовий сигнал відправлено! Таймфрейм: ${timeframeStr}, угода о ${testSignal.entryTime}`, 'info');
  alert(`Тестовий сигнал відправлено!\nТаймфрейм: ${timeframeStr}\nУгода буде відкрита о ${testSignal.entryTime}`);
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

// ═══════════════════════════════════════════════════════════
// WEBHOOK FUNCTIONALITY
// ═══════════════════════════════════════════════════════════

let currentWebhookData = null;
let webhookListenerActive = false;

// Отримання Extension ID та Webhook URL
function getWebhookUrl() {
  const extensionId = chrome.runtime.id;
  return `http://localhost:8765/webhook`; // Використовуємо локальний сервер
}

// Ініціалізація webhook функціоналу
async function initWebhook() {
  const webhookUrlEl = document.getElementById('webhookUrl');
  webhookUrlEl.textContent = getWebhookUrl();

  // Кнопки webhook
  document.getElementById('copyWebhookUrl').addEventListener('click', copyWebhookUrl);
  document.getElementById('testWebhook').addEventListener('click', sendTestWebhook);
  document.getElementById('createTemplate').addEventListener('click', openTemplateEditor);
  document.getElementById('cancelTemplate').addEventListener('click', closeTemplateEditor);
  document.getElementById('saveTemplate').addEventListener('click', saveTemplate);
  document.getElementById('testMapping').addEventListener('click', testMapping);

  // Завантаження шаблонів
  await loadTemplates();

  // Завантаження історії
  await loadWebhookHistory();
}

// Копіювання webhook URL
async function copyWebhookUrl() {
  const url = getWebhookUrl();

  try {
    await navigator.clipboard.writeText(url);
    alert('URL скопійовано в буфер обміну!');
    addLog('Webhook URL скопійовано', 'success');
  } catch (err) {
    // Fallback для старих браузерів
    const input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    alert('URL скопійовано в буфер обміну!');
  }
}

// Тестовий webhook
async function sendTestWebhook() {
  const testData = {
    pair: 'EUR/USD',
    action: 'buy',
    time: '14:30',
    timeframe: '5M'
  };

  addLog('Відправка тестового webhook...', 'info');

  // Симулюємо отримання webhook
  await handleIncomingWebhook(testData);

  alert('Тестовий webhook відправлено!');
}

// Обробка вхідного webhook
async function handleIncomingWebhook(data) {
  addLog(`Отримано webhook: ${JSON.stringify(data)}`, 'info');

  // Зберігаємо в історію
  const historyData = await chrome.storage.local.get('webhookHistory');
  const history = historyData.webhookHistory || [];

  history.unshift({
    timestamp: new Date().toISOString(),
    data: data
  });

  // Зберігаємо тільки останні 50
  if (history.length > 50) {
    history.pop();
  }

  await chrome.storage.local.set({ webhookHistory: history });
  await loadWebhookHistory();

  // Якщо відкритий редактор - показуємо дані
  if (webhookListenerActive) {
    currentWebhookData = data;
    displayWebhookData(data);
  }

  // Перевіряємо чи є активний шаблон
  const settings = await chrome.storage.local.get(['activeTemplate', 'webhookTemplates']);

  if (settings.activeTemplate && settings.webhookTemplates) {
    const template = settings.webhookTemplates.find(t => t.id === settings.activeTemplate);

    if (template) {
      const signal = parseWebhookWithTemplate(data, template);

      if (signal) {
        addLog(`Сигнал розпізнано: ${signal.pair} ${signal.direction}`, 'success');

        // Відправляємо на обробку
        chrome.runtime.sendMessage({
          action: 'processSignal',
          signal: signal
        });
      } else {
        addLog('Не вдалося розпізнати сигнал з webhook', 'error');
      }
    }
  }
}

// Парсинг webhook з шаблоном
function parseWebhookWithTemplate(data, template) {
  try {
    // Витягуємо значення за path
    const pair = getValueByPath(data, template.pairPath);
    const direction = getValueByPath(data, template.directionPath);
    const time = getValueByPath(data, template.timePath);
    const timeframe = template.timeframePath ? getValueByPath(data, template.timeframePath) : null;

    if (!pair || !direction || !time) {
      return null;
    }

    // Форматуємо пару
    let formattedPair = pair.replace(/[^A-Z]/g, '');
    if (formattedPair.length === 6) {
      formattedPair = formattedPair.substring(0, 3) + '/' + formattedPair.substring(3);
    }

    // Визначаємо напрямок
    const dirLower = direction.toLowerCase();
    let formattedDirection = 'CALL';
    if (dirLower.includes('sell') || dirLower.includes('put') || dirLower.includes('down')) {
      formattedDirection = 'PUT';
    }

    // Конвертуємо час
    const formattedTime = convertTimeWithTimezone(time, template.sourceTimezone, template.timeFormat);

    // Форматуємо таймфрейм
    let formattedTimeframe = timeframe || '5M';
    if (!formattedTimeframe.includes('M')) {
      formattedTimeframe = formattedTimeframe + 'M';
    }

    return {
      pair: formattedPair,
      direction: formattedDirection,
      timeframe: formattedTimeframe,
      entryTime: formattedTime,
      martingaleLevels: []
    };
  } catch (err) {
    console.error('Помилка парсингу webhook:', err);
    return null;
  }
}

// Отримання значення з об'єкта за path
function getValueByPath(obj, path) {
  if (!path) return null;

  const keys = path.split('.');
  let value = obj;

  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return null;
    }
  }

  return value;
}

// Конвертація часу з урахуванням часового поясу
function convertTimeWithTimezone(time, sourceTimezone, timeFormat) {
  try {
    // Якщо вже київський час - повертаємо як є
    if (sourceTimezone === 'Europe/Kiev') {
      return parseTimeToKyivFormat(time, timeFormat);
    }

    // Створюємо дату з поточним днем
    const now = new Date();
    let timeStr;

    // Парсимо час в залежності від формату
    if (timeFormat === 'timestamp') {
      const date = new Date(parseInt(time) * 1000);
      timeStr = formatTimeToKyiv(date);
    } else if (timeFormat === 'iso') {
      const date = new Date(time);
      timeStr = formatTimeToKyiv(date);
    } else {
      // Для форматів HH:mm, HH:mm:ss тощо
      timeStr = parseTimeToKyivFormat(time, timeFormat);

      // Конвертуємо з source timezone до Kyiv
      const [hours, minutes] = timeStr.split(':').map(Number);

      // Різниця між часовими поясами
      const timezoneOffsets = {
        'UTC': 0,
        'America/New_York': -5, // EDT -4, EST -5
        'Europe/London': 0,
        'Europe/Kiev': 2, // EET +2, EEST +3
        'Asia/Tokyo': 9,
        'Asia/Shanghai': 8,
        'Europe/Moscow': 3
      };

      const sourceOffset = timezoneOffsets[sourceTimezone] || 0;
      const kyivOffset = 2; // Київ GMT+2 (або +3 влітку)
      const diff = kyivOffset - sourceOffset;

      let newHours = hours + diff;
      if (newHours >= 24) newHours -= 24;
      if (newHours < 0) newHours += 24;

      timeStr = `${String(newHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    return timeStr;
  } catch (err) {
    console.error('Помилка конвертації часу:', err);
    return time;
  }
}

// Парсинг часу в київський формат
function parseTimeToKyivFormat(time, format) {
  if (format === 'HH:mm' || format === 'HH:mm:ss') {
    const parts = time.split(':');
    return `${parts[0]}:${parts[1]}`;
  } else if (format === 'hh:mm A') {
    // 12-годинний формат
    const parts = time.split(' ');
    const timeParts = parts[0].split(':');
    let hours = parseInt(timeParts[0]);
    const minutes = timeParts[1];
    const period = parts[1];

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  return time;
}

// Форматування дати до київського часу
function formatTimeToKyiv(date) {
  return date.toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Kiev'
  });
}

// Відкриття редактора шаблонів
async function openTemplateEditor() {
  document.getElementById('templateEditor').style.display = 'block';
  document.getElementById('mappingSection').style.display = 'none';
  document.getElementById('webhookStatus').innerHTML = '<div style="font-size: 12px; color: #ffaa00;">⏳ Очікую webhook...</div>';
  document.getElementById('webhookData').style.display = 'none';

  // Очищаємо поля
  document.getElementById('templateName').value = '';
  document.getElementById('pairPath').value = '';
  document.getElementById('directionPath').value = '';
  document.getElementById('timePath').value = '';
  document.getElementById('timeframePath').value = '';

  currentWebhookData = null;
  webhookListenerActive = true;

  addLog('Очікування webhook для створення шаблону...', 'info');
}

// Закриття редактора шаблонів
function closeTemplateEditor() {
  document.getElementById('templateEditor').style.display = 'none';
  webhookListenerActive = false;
  currentWebhookData = null;
}

// Відображення даних webhook
function displayWebhookData(data) {
  const statusEl = document.getElementById('webhookStatus');
  statusEl.innerHTML = '<div style="font-size: 12px; color: #00ff88;">✅ Webhook отримано!</div>';

  const dataEl = document.getElementById('webhookData');
  dataEl.style.display = 'block';
  dataEl.textContent = JSON.stringify(data, null, 2);

  document.getElementById('mappingSection').style.display = 'block';

  // Автозаповнення полів (якщо можливо)
  autoFillTemplateFields(data);
}

// Автозаповнення полів шаблону
function autoFillTemplateFields(data) {
  // Шукаємо можливі поля
  const keys = Object.keys(data);

  keys.forEach(key => {
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes('pair') || lowerKey.includes('ticker') || lowerKey.includes('symbol')) {
      document.getElementById('pairPath').value = key;
    }

    if (lowerKey.includes('action') || lowerKey.includes('side') || lowerKey.includes('direction')) {
      document.getElementById('directionPath').value = key;
    }

    if (lowerKey.includes('time') || lowerKey.includes('entry')) {
      document.getElementById('timePath').value = key;
    }

    if (lowerKey.includes('timeframe') || lowerKey.includes('interval') || lowerKey.includes('period')) {
      document.getElementById('timeframePath').value = key;
    }
  });
}

// Тестування мапінгу
async function testMapping() {
  if (!currentWebhookData) {
    alert('Спочатку отримайте webhook!');
    return;
  }

  const template = {
    pairPath: document.getElementById('pairPath').value,
    directionPath: document.getElementById('directionPath').value,
    timePath: document.getElementById('timePath').value,
    timeframePath: document.getElementById('timeframePath').value,
    sourceTimezone: document.getElementById('sourceTimezone').value,
    timeFormat: document.getElementById('timeFormat').value
  };

  const signal = parseWebhookWithTemplate(currentWebhookData, template);

  const resultEl = document.getElementById('testResult');
  resultEl.style.display = 'block';

  if (signal) {
    resultEl.innerHTML = `
      <div style="background: #0f1624; padding: 12px; border-radius: 8px; border-left: 4px solid #00ff88;">
        <div style="font-size: 12px; color: #00ff88; margin-bottom: 8px;">✅ Мапінг успішний!</div>
        <div style="font-size: 11px; color: #ccc; font-family: monospace;">
          <div>Пара: ${signal.pair}</div>
          <div>Напрямок: ${signal.direction}</div>
          <div>Час: ${signal.entryTime}</div>
          <div>Таймфрейм: ${signal.timeframe}</div>
        </div>
      </div>
    `;
  } else {
    resultEl.innerHTML = `
      <div style="background: #0f1624; padding: 12px; border-radius: 8px; border-left: 4px solid #ff4444;">
        <div style="font-size: 12px; color: #ff4444;">❌ Помилка мапінгу</div>
        <div style="font-size: 11px; color: #888; margin-top: 4px;">Перевірте правильність полів</div>
      </div>
    `;
  }
}

// Збереження шаблону
async function saveTemplate() {
  const name = document.getElementById('templateName').value.trim();

  if (!name) {
    alert('Введіть назву шаблону!');
    return;
  }

  if (!currentWebhookData) {
    alert('Спочатку отримайте webhook!');
    return;
  }

  const template = {
    id: Date.now().toString(),
    name: name,
    pairPath: document.getElementById('pairPath').value,
    directionPath: document.getElementById('directionPath').value,
    timePath: document.getElementById('timePath').value,
    timeframePath: document.getElementById('timeframePath').value,
    sourceTimezone: document.getElementById('sourceTimezone').value,
    timeFormat: document.getElementById('timeFormat').value,
    createdAt: new Date().toISOString()
  };

  // Зберігаємо
  const data = await chrome.storage.local.get('webhookTemplates');
  const templates = data.webhookTemplates || [];
  templates.push(template);

  await chrome.storage.local.set({ webhookTemplates: templates });

  addLog(`Шаблон "${name}" збережено`, 'success');
  closeTemplateEditor();
  await loadTemplates();
}

// Завантаження списку шаблонів
async function loadTemplates() {
  const data = await chrome.storage.local.get(['webhookTemplates', 'activeTemplate']);
  const templates = data.webhookTemplates || [];
  const activeId = data.activeTemplate || null;

  const listEl = document.getElementById('templatesList');

  if (templates.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding: 20px;">
        <div class="empty-icon">📝</div>
        <div>Немає збережених шаблонів</div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = templates.map(template => {
    const isActive = template.id === activeId;
    return `
      <div class="template-item ${isActive ? 'active' : ''}" data-template-id="${template.id}">
        <div class="template-header">
          <span class="template-name">${isActive ? '✅ ' : ''}${template.name}</span>
          <div class="template-actions">
            <button class="template-btn" onclick="activateTemplate('${template.id}')">
              ${isActive ? 'Активний' : 'Активувати'}
            </button>
            <button class="template-btn" onclick="deleteTemplate('${template.id}')">🗑️</button>
          </div>
        </div>
        <div style="font-size: 10px; color: #666; margin-top: 4px;">
          ${template.sourceTimezone} • ${template.timeFormat}
        </div>
      </div>
    `;
  }).join('');
}

// Активація шаблону
window.activateTemplate = async function(templateId) {
  await chrome.storage.local.set({ activeTemplate: templateId });
  await loadTemplates();
  addLog('Шаблон активовано', 'success');
};

// Видалення шаблону
window.deleteTemplate = async function(templateId) {
  if (!confirm('Видалити цей шаблон?')) return;

  const data = await chrome.storage.local.get('webhookTemplates');
  const templates = data.webhookTemplates || [];

  const filtered = templates.filter(t => t.id !== templateId);
  await chrome.storage.local.set({ webhookTemplates: filtered });

  addLog('Шаблон видалено', 'warning');
  await loadTemplates();
};

// Завантаження історії webhook
async function loadWebhookHistory() {
  const data = await chrome.storage.local.get('webhookHistory');
  const history = data.webhookHistory || [];

  const historyEl = document.getElementById('webhookHistory');

  if (history.length === 0) {
    historyEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div>Webhook ще не надходили</div>
      </div>
    `;
    return;
  }

  historyEl.innerHTML = history.slice(0, 10).map(item => {
    const date = new Date(item.timestamp);
    const timeStr = date.toLocaleTimeString('uk-UA');
    return `
      <div class="webhook-item">
        <div class="webhook-time">${timeStr}</div>
        <div class="webhook-data">${JSON.stringify(item.data)}</div>
      </div>
    `;
  }).join('');
}

// Ініціалізація webhook при завантаженні
document.addEventListener('DOMContentLoaded', () => {
  initWebhook();
});

// Оновлення статусу мартингейлу
async function updateMartingaleStatus() {
  const data = await chrome.storage.local.get(['globalMartingaleLevel', 'pairLosses']);

  const globalLevel = data.globalMartingaleLevel || 1;
  const pairLosses = data.pairLosses || {};

  // Підрахунок активних пар з програшами (пар з 4 програшами)
  const activePairs = Object.keys(pairLosses).filter(k => pairLosses[k] >= 1).length;

  // Оновлення відображення
  const currentGlobalLevelEl = document.getElementById('currentGlobalLevel');
  const activePairLossesEl = document.getElementById('activePairLosses');

  if (currentGlobalLevelEl) {
    currentGlobalLevelEl.textContent = globalLevel;

    // Підсвітка залежно від рівня
    if (globalLevel >= 13) {
      currentGlobalLevelEl.style.color = '#ff4444'; // Червоний для високих рівнів
    } else if (globalLevel >= 9) {
      currentGlobalLevelEl.style.color = '#ffaa00'; // Жовтий для середніх
    } else if (globalLevel >= 5) {
      currentGlobalLevelEl.style.color = '#00d9ff'; // Блакитний
    } else {
      currentGlobalLevelEl.style.color = '#00ff88'; // Зелений для низьких
    }
  }

  if (activePairLossesEl) {
    activePairLossesEl.textContent = activePairs;

    // Підсвітка залежно від кількості пар
    if (activePairs >= 3) {
      activePairLossesEl.style.color = '#ff4444'; // Червоний - багато пар
    } else if (activePairs >= 2) {
      activePairLossesEl.style.color = '#ffaa00'; // Жовтий - середньо
    } else if (activePairs >= 1) {
      activePairLossesEl.style.color = '#00d9ff'; // Блакитний - одна пара
    } else {
      activePairLossesEl.style.color = '#00ff88'; // Зелений - жодної
    }
  }
}

// Скидання всіх лічильників мартингейлу
async function resetMartingale() {
  const confirmed = confirm('Скинути всі лічильники мартингейлу?\n\n• Глобальний рівень → 1\n• Всі програші пар → 0');

  if (!confirmed) return;

  await chrome.storage.local.set({
    globalMartingaleLevel: 1,
    pairLosses: {}
  });

  await updateMartingaleStatus();
  await addLogToStorage('🔄 Лічильники мартингейлу скинуто до початкового стану', 'success');

  alert('✅ Лічильники успішно скинуто до рівня 1!');
}

// Допоміжна функція для додавання логу
async function addLogToStorage(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('uk-UA');
  const data = await chrome.storage.local.get('logs');
  const logs = data.logs || [];

  logs.push({
    time: timestamp,
    message: `[POPUP] ${message}`,
    type: type
  });

  if (logs.length > 150) {
    logs.shift();
  }

  await chrome.storage.local.set({ logs });
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

  // Оновлюємо webhook історію якщо вкладка активна
  const webhookTab = document.getElementById('webhook');
  if (webhookTab.classList.contains('active')) {
    await loadWebhookHistory();
  }

  // Оновлюємо стан мартингейлу якщо вкладка налаштувань активна
  const settingsTab = document.getElementById('settings');
  if (settingsTab.classList.contains('active')) {
    await updateMartingaleStatus();
  }
}, 2000);
