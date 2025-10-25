// Ініціалізація при завантаженні popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await updateUI();
  await updateLogs();
  setupEventListeners();
});

// Завантаження збережених налаштувань
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'initialAmount',
    'defaultTimeframe',
    'maxMartingale',
    'martingaleMultiplier',
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
}

// Оновлення UI
async function updateUI() {
  const data = await chrome.storage.local.get(['botActive', 'trades', 'stats', 'scheduledTrades']);
  
  const botActive = data.botActive || false;
  const trades = data.trades || [];
  const stats = data.stats || { total: 0, wins: 0, losses: 0, profit: 0 };
  const scheduledTrades = data.scheduledTrades || [];
  
  // Оновлення статусу бота
  const statusEl = document.getElementById('botStatus');
  const startBtn = document.getElementById('startBot');
  const stopBtn = document.getElementById('stopBot');
  
  if (botActive) {
    statusEl.textContent = 'Активний';
    statusEl.className = 'status active';
    startBtn.style.display = 'none';
    stopBtn.style.display = 'block';
  } else {
    statusEl.textContent = 'Не активний';
    statusEl.className = 'status inactive';
    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
  }
  
  // Оновлення статистики
  document.getElementById('totalTrades').textContent = stats.total;
  const winRate = stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0;
  document.getElementById('winRate').textContent = winRate + '%';
  document.getElementById('totalProfit').textContent = (stats.profit || 0) + ' ₴';
  document.getElementById('scheduledCount').textContent = scheduledTrades.length;
  
  // Оновлення списку угод
  const tradesListEl = document.getElementById('tradesList');
  if (trades.length === 0) {
    tradesListEl.innerHTML = '<div class="empty-state">Немає активних угод</div>';
  } else {
    tradesListEl.innerHTML = trades.map(trade => createTradeHTML(trade)).join('');
    
    // Додаємо обробники для кнопок відміни
    document.querySelectorAll('.btn-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tradeId = e.target.dataset.tradeId;
        cancelTrade(tradeId);
      });
    });
  }
}

// Створення HTML для угоди
function createTradeHTML(trade) {
  const directionClass = trade.direction === 'CALL' ? 'call' : 'put';
  const statusClass = trade.status === 'win' ? 'win' : trade.status === 'loss' ? 'loss' : '';
  const isScheduled = trade.status === 'scheduled';
  
  return `
    <div class="trade-item ${statusClass}">
      <div class="trade-content">
        <div class="trade-header">
          <span class="trade-pair">${trade.pair}</span>
          <span class="trade-direction ${directionClass}">${trade.direction}</span>
        </div>
        <div class="trade-info">
          <span>Сума: ${trade.amount} ₴</span>
          <span>Час: ${trade.time}</span>
        </div>
        ${trade.martingaleLevel ? `<div class="trade-info"><span>Мартингейл: рівень ${trade.martingaleLevel}</span></div>` : ''}
        ${isScheduled ? `<div class="trade-info"><span style="color: #00d9ff;">⏱ Заплановано</span></div>` : ''}
      </div>
      ${isScheduled ? `<button class="btn-cancel" data-trade-id="${trade.id}">❌ Відмінити</button>` : ''}
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
}

// Збереження налаштувань
async function saveSettings() {
  const settings = {
    initialAmount: parseFloat(document.getElementById('initialAmount').value),
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
}

// Зупинка бота
async function stopBot() {
  await chrome.storage.local.set({ botActive: false });
  
  // Відправка повідомлення background script
  chrome.runtime.sendMessage({ action: 'stopBot' });
  
  await updateUI();
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
    isTestSignal: true // Позначаємо що це тестовий сигнал (без конвертації часу)
  };
  
  chrome.runtime.sendMessage({ 
    action: 'processSignal', 
    signal: testSignal 
  });
  
  alert('Тестовий сигнал відправлено! Угода буде відкрита о ' + testSignal.entryTime);
}

// Відміна угоди
async function cancelTrade(tradeId) {
  if (confirm('Ви впевнені, що хочете відмінити цю угоду?')) {
    chrome.runtime.sendMessage({ 
      action: 'cancelTrade', 
      tradeId: tradeId 
    });
    await updateUI();
  }
}

// Форматування часу
function formatTime(date) {
  return date.toTimeString().substr(0, 5);
}

// Оновлення логів
async function updateLogs() {
  const data = await chrome.storage.local.get('logs');
  const logs = data.logs || [];
  
  const logsContainer = document.getElementById('logsContainer');
  
  if (logs.length === 0) {
    logsContainer.innerHTML = '<div class="empty-state">Логи з\'являться тут...</div>';
  } else {
    logsContainer.innerHTML = logs.slice(-50).map(log => {
      const logClass = log.type || 'info';
      return `
        <div class="log-entry">
          <span class="log-time">[${log.time}]</span>
          <span class="log-${logClass}">${log.message}</span>
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

// Оновлення UI кожні 2 секунди
setInterval(async () => {
  await updateUI();
  await updateLogs();
}, 2000);