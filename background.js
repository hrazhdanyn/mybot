// Глобальні змінні
let scheduledTrades = [];
let checkInterval = null;

// Функція для логування
async function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('uk-UA');
  const data = await chrome.storage.local.get('logs');
  const logs = data.logs || [];
  
  logs.push({
    time: timestamp,
    message: message,
    type: type
  });
  
  if (logs.length > 100) {
    logs.shift();
  }
  
  await chrome.storage.local.set({ logs });
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// Слухач повідомлень
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startBot') {
    startBot();
  } else if (message.action === 'stopBot') {
    stopBot();
  } else if (message.action === 'processSignal') {
    processSignal(message.signal);
  } else if (message.action === 'tradeResult') {
    handleTradeResult(message.result);
  } else if (message.action === 'cancelTrade') {
    cancelTrade(message.tradeId);
  }
});

// Запуск бота
async function startBot() {
  await addLog('🤖 Бот запущено', 'success');
  console.log('Bot started');
  
  // Перевірка що сторінка PocketOption відкрита
  const tabs = await chrome.tabs.query({ 
    url: 'https://pocketoption.com/*' 
  });
  
  if (tabs.length === 0) {
    await addLog('❌ Вкладка PocketOption не знайдена!', 'error');
    await addLog('💡 Відкрийте https://pocketoption.com/en/cabinet/demo-quick-high-low/', 'warning');
    return;
  }
  
  const tab = tabs[0];
  await addLog(`✅ Знайдено вкладку PocketOption (ID: ${tab.id})`, 'success');
  
  // Інжект content script якщо потрібно
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    await addLog(`✅ Content script активний`, 'success');
  } catch (e) {
    await addLog(`⚠️ Завантаження content script...`, 'warning');
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    
    // Чекаємо 3 секунди для ініціалізації
    await new Promise(resolve => setTimeout(resolve, 3000));
    await addLog(`✅ Content script завантажено`, 'success');
  }
  
  // Запит діагностики сторінки
  await addLog('🔍 Перевірка елементів на сторінці...', 'info');
  
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'diagnose' });
    
    if (response && response.diagnostics) {
      const diag = response.diagnostics;
      await addLog(`   📊 Знайдено button: ${diag.totalButtons}`, 'info');
      await addLog(`   📊 Знайдено input: ${diag.totalInputs}`, 'info');
      await addLog(`   📊 Можливих CALL кнопок: ${diag.callButtons}`, diag.callButtons > 0 ? 'success' : 'error');
      await addLog(`   📊 Можливих PUT кнопок: ${diag.putButtons}`, diag.putButtons > 0 ? 'success' : 'error');
      
      if (diag.callButtons === 0 || diag.putButtons === 0) {
        await addLog('⚠️ УВАГА: Кнопки CALL/PUT не знайдені!', 'warning');
        await addLog('💡 Переконайтеся що ви на сторінці торгівлі', 'warning');
      } else {
        await addLog('✅ Всі необхідні елементи знайдено!', 'success');
      }
    }
  } catch (err) {
    await addLog(`⚠️ Не вдалося отримати діагностику: ${err.message}`, 'warning');
  }
  
  if (!checkInterval) {
    // Перевірка запланованих угод кожні 5 секунд
    checkInterval = setInterval(checkScheduledTrades, 5000);
    await addLog('⏰ Запущено таймер перевірки угод (кожні 5 сек)', 'info');
  }
}

// Зупинка бота
async function stopBot() {
  await addLog('⏹️ Бот зупинено', 'warning');
  console.log('Bot stopped');
  
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  
  scheduledTrades = [];
}

// Обробка сигналу
async function processSignal(signal) {
  await addLog(`📥 Отримано сигнал: ${signal.pair} ${signal.direction}`, 'info');
  
  const settings = await chrome.storage.local.get([
    'stakeType',
    'initialAmount',
    'percentAmount',
    'maxMartingale',
    'martingaleMultiplier',
    'martingaleMultiplierPercent',
    'globalMartingale',
    'activeLevels',
    'botActive'
  ]);
  
  if (!settings.botActive) {
    await addLog('⚠️ Бот не активний! Сигнал проігноровано', 'warning');
    console.log('Bot is not active, ignoring signal');
    return;
  }
  
  // Конвертація часу
  let entryTimeKyiv;
  if (signal.isTestSignal) {
    entryTimeKyiv = parseTimeString(signal.entryTime);
    await addLog(`⏰ Час входу (тестовий): ${signal.entryTime}`, 'info');
  } else {
    const entryTimeNY = parseTimeString(signal.entryTime);
    entryTimeKyiv = convertNYtoKyiv(entryTimeNY);
    await addLog(`⏰ Час входу: ${signal.entryTime} (NY) → ${formatTimeString(entryTimeKyiv)} (Київ)`, 'info');
  }
  
  // Визначаємо базову ставку
  let baseAmount;
  if (settings.stakeType === 'percent') {
    baseAmount = settings.percentAmount || 1;
    await addLog(`💰 Тип ставки: ${baseAmount}% від депозиту`, 'info');
  } else {
    baseAmount = settings.initialAmount || 100;
    await addLog(`💰 Тип ставки: ${baseAmount} ₴ (фіксована)`, 'info');
  }
  
  const trade = {
    id: generateId(),
    pair: signal.pair,
    direction: signal.direction,
    timeframe: signal.timeframe,
    amount: baseAmount,
    stakeType: settings.stakeType || 'fixed',
    entryTime: entryTimeKyiv,
    martingaleLevel: 0,
    martingaleLevels: [],
    status: 'scheduled'
  };
  
  await addLog(`⏱️ Таймфрейм: ${trade.timeframe}`, 'info');
  
  // Додавання рівнів мартингейлу
  if (signal.martingaleLevels && settings.maxMartingale > 0) {
    const activeLevels = settings.activeLevels || [1, 2, 3];
    const multiplier = settings.stakeType === 'percent'
      ? settings.martingaleMultiplierPercent || 2.0
      : settings.martingaleMultiplier || 2.3;

    await addLog(`🔄 Мартингейл: макс ${settings.maxMartingale} рівнів, множник ${multiplier}`, 'info');

    signal.martingaleLevels.forEach(async (ml, index) => {
      if (index < settings.maxMartingale && activeLevels.includes(ml.level)) {
        let mlTimeKyiv;
        if (signal.isTestSignal) {
          mlTimeKyiv = parseTimeString(ml.time);
        } else {
          const mlTimeNY = parseTimeString(ml.time);
          mlTimeKyiv = convertNYtoKyiv(mlTimeNY);
        }
        
        trade.martingaleLevels.push({
          level: ml.level,
          time: mlTimeKyiv,
          amount: baseAmount * Math.pow(multiplier, ml.level),
          enabled: true
        });
        
        await addLog(`   Рівень ${ml.level}: ${(baseAmount * Math.pow(multiplier, ml.level)).toFixed(2)}`, 'info');
      }
    });
    
    if (settings.globalMartingale) {
      await addLog(`   Глобальний мартингейл: УВІМКНЕНО`, 'info');
    }
  }
  
  scheduledTrades.push(trade);
  await addLog(`✅ Угоду заплановано на ${formatTimeString(entryTimeKyiv)}`, 'success');
  await addLog(`📊 Всього запланованих угод: ${scheduledTrades.length}`, 'info');
  
  await addToActiveTrades(trade);
  await updateScheduledTradesInStorage();
  
  console.log('Signal processed:', trade);
}

// Перевірка запланованих угод
async function checkScheduledTrades() {
  if (scheduledTrades.length === 0) {
    return;
  }
  
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();
  const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  await addLog(`🔍 Перевірка угод. Поточний час: ${currentTimeStr}, Запланованих: ${scheduledTrades.length}`, 'info');
  
  for (let i = scheduledTrades.length - 1; i >= 0; i--) {
    const trade = scheduledTrades[i];
    const tradeTime = trade.entryTime.hours * 60 + trade.entryTime.minutes;
    const tradeTimeStr = formatTimeString(trade.entryTime);
    
    const timeDiff = Math.abs(currentTime - tradeTime);
    
    await addLog(`⏰ Угода ${trade.pair}: заплановано ${tradeTimeStr}, різниця ${timeDiff} хв`, 'info');
    
    // Перевірка чи настав час для угоди (з допуском ±1 хвилина)
    if (timeDiff <= 1) {
      await addLog(`🚀 ЧАС НАСТАВ! Виконуємо угоду ${trade.pair} ${trade.direction}`, 'success');
      await executeTrade(trade);
      scheduledTrades.splice(i, 1);
      await updateScheduledTradesInStorage();
    }
  }
}

// Виконання угоди
async function executeTrade(trade) {
  await addLog(`🎯 ВИКОНАННЯ УГОДИ: ${trade.pair} ${trade.direction} ${trade.amount}₴`, 'success');
  console.log('Executing trade:', trade);
  
  // Отримання активної вкладки PocketOption
  const tabs = await chrome.tabs.query({ 
    url: 'https://pocketoption.com/*' 
  });
  
  if (tabs.length === 0) {
    await addLog('❌ ПОМИЛКА: Вкладка PocketOption не знайдена!', 'error');
    await addLog('💡 Відкрийте https://pocketoption.com/en/cabinet/demo-quick-high-low/', 'warning');
    console.error('PocketOption tab not found');
    return;
  }
  
  const tab = tabs[0];
  await addLog(`✅ Знайдено вкладку PocketOption (ID: ${tab.id})`, 'success');
  
  try {
    // Спочатку інжектимо content script якщо його ще немає
    await addLog(`🔧 Перевірка content script...`, 'info');
    
    try {
      // Спроба відправити ping для перевірки
      await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      await addLog(`✅ Content script вже завантажено`, 'success');
    } catch (e) {
      // Content script не завантажено - інжектимо вручну
      await addLog(`⚠️ Content script не знайдено, завантажуємо...`, 'warning');
      
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      
      await addLog(`✅ Content script завантажено!`, 'success');
      
      // Чекаємо 3 секунди щоб script ініціалізувався
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Відправка команди на відкриття угоди
    await addLog(`📤 Відправка команди на відкриття угоди...`, 'info');
    
    await chrome.tabs.sendMessage(tab.id, {
      action: 'openTrade',
      trade: trade
    });
    
    // Оновлення статусу угоди
    trade.status = 'active';
    await updateActiveTrades(trade);
    
    await addLog(`✅ Команда відправлена успішно`, 'success');
  } catch (error) {
    await addLog(`❌ Помилка відправки команди: ${error.message}`, 'error');
    await addLog(`💡 Спробуйте перезавантажити сторінку PocketOption (Ctrl+Shift+R)`, 'warning');
    console.error('Error sending message:', error);
  }
}

// Обробка результату угоди
async function handleTradeResult(result) {
  console.log('Trade result:', result);
  await addLog(`📊 Результат угоди: ${result.win ? 'ВИГРАШ' : 'ПРОГРАШ'}`, result.win ? 'success' : 'error');
  
  const settings = await chrome.storage.local.get([
    'maxMartingale',
    'martingaleMultiplier',
    'martingaleMultiplierPercent',
    'initialAmount',
    'stakeType',
    'globalMartingale',
    'activeLevels'
  ]);
  
  // Розрахунок прибутку
  const profitPercent = 0.92; // 92% виплата
  const profit = result.win ? result.amount * profitPercent : -result.amount;
  
  await updateStats(result.win, profit);
  
  if (result.win) {
    // Угода виграна - видаляємо з активних
    await addLog(`✅ Серія завершена успішно`, 'success');
    await removeFromActiveTrades(result.tradeId);
  } else {
    // Угода програна - перевіряємо мартингейл
    const trade = await getTradeById(result.tradeId);
    
    if (!trade) {
      await addLog(`⚠️ Угоду не знайдено в активних`, 'warning');
      return;
    }
    
    await addLog(`   Поточний рівень: ${trade.martingaleLevel}`, 'info');
    await addLog(`   Всього рівнів: ${trade.martingaleLevels ? trade.martingaleLevels.length : 0}`, 'info');
    
    // Перевіряємо чи є наступний рівень мартингейлу
    if (trade.martingaleLevels && trade.martingaleLevel < trade.martingaleLevels.length) {
      const nextLevel = trade.martingaleLevels[trade.martingaleLevel];

      // Перевіряємо чи увімкнений цей рівень
      const activeLevels = settings.activeLevels || [1, 2, 3];
      const levelEnabled = activeLevels.includes(nextLevel.level);

      if (levelEnabled) {
        await addLog(`🔄 Запуск мартингейл рівень ${nextLevel.level}`, 'warning');
        
        const martingaleTrade = {
          ...trade,
          id: generateId(),
          martingaleLevel: nextLevel.level,
          amount: nextLevel.amount,
          entryTime: nextLevel.time,
          status: 'scheduled'
        };
        
        scheduledTrades.push(martingaleTrade);
        await addToActiveTrades(martingaleTrade);
        await updateScheduledTradesInStorage();
        
        await addLog(`   Рівень ${nextLevel.level}: ${nextLevel.amount} (${trade.stakeType})`, 'info');
        console.log('Martingale level scheduled:', martingaleTrade);
      } else {
        await addLog(`⚠️ Рівень ${nextLevel.level} вимкнений - пропускаємо`, 'warning');
      }
    } else {
      // Всі рівні мартингейлу вичерпані
      if (settings.globalMartingale) {
        await addLog(`🔴 Всі рівні мартингейлу програні`, 'error');
        await addLog(`⏳ ГЛОБАЛЬНИЙ МАРТИНГЕЙЛ: Очікуємо наступний сигнал`, 'warning');
        await addLog(`   Для цієї пари не знижуємо ставку`, 'info');
        // Просто видаляємо з активних - наступний сигнал почне з початкової ставки
      } else {
        await addLog(`❌ Серія програна, мартингейл вичерпано`, 'error');
      }
    }
    
    // Видаляємо програну угоду з активних
    await removeFromActiveTrades(result.tradeId);
  }
}

// Допоміжні функції

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function parseTimeString(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

function convertNYtoKyiv(nyTime) {
  // Різниця між Києвом і Нью-Йорком: +7 годин
  let hours = nyTime.hours + 7;
  let minutes = nyTime.minutes;
  
  if (hours >= 24) {
    hours -= 24;
  }
  
  return { hours, minutes };
}

function formatTimeString(timeObj) {
  return `${String(timeObj.hours).padStart(2, '0')}:${String(timeObj.minutes).padStart(2, '0')}`;
}

async function addToActiveTrades(trade) {
  const data = await chrome.storage.local.get('trades');
  const trades = data.trades || [];
  
  trades.push({
    id: trade.id,
    pair: trade.pair,
    direction: trade.direction,
    amount: trade.amount,
    stakeType: trade.stakeType || 'fixed',
    time: `${String(trade.entryTime.hours).padStart(2, '0')}:${String(trade.entryTime.minutes).padStart(2, '0')}`,
    martingaleLevel: trade.martingaleLevel,
    status: trade.status
  });
  
  await chrome.storage.local.set({ trades });
}

async function updateActiveTrades(trade) {
  const data = await chrome.storage.local.get('trades');
  const trades = data.trades || [];
  
  const index = trades.findIndex(t => t.id === trade.id);
  if (index !== -1) {
    trades[index].status = trade.status;
    await chrome.storage.local.set({ trades });
  }
}

async function removeFromActiveTrades(tradeId) {
  const data = await chrome.storage.local.get('trades');
  const trades = data.trades || [];
  
  const filtered = trades.filter(t => t.id !== tradeId);
  await chrome.storage.local.set({ trades: filtered });
}

async function getTradeById(tradeId) {
  const data = await chrome.storage.local.get('trades');
  const trades = data.trades || [];
  return trades.find(t => t.id === tradeId);
}

async function updateStats(win, profit) {
  const data = await chrome.storage.local.get('stats');
  const stats = data.stats || { total: 0, wins: 0, losses: 0, profit: 0 };
  
  stats.total++;
  if (win) {
    stats.wins++;
  } else {
    stats.losses++;
  }
  stats.profit = (stats.profit || 0) + profit;
  
  await chrome.storage.local.set({ stats });
}

// Відміна запланованої угоди
async function cancelTrade(tradeId) {
  console.log('Cancelling trade:', tradeId);
  
  // Видаляємо з масиву запланованих угод
  scheduledTrades = scheduledTrades.filter(t => t.id !== tradeId);
  
  // Видаляємо з активних угод
  await removeFromActiveTrades(tradeId);
  
  // Оновлюємо список у storage
  await updateScheduledTradesInStorage();
}

// Оновлення списку запланованих угод у storage
async function updateScheduledTradesInStorage() {
  await chrome.storage.local.set({ scheduledTrades: scheduledTrades });
}

// Ініціалізація при встановленні розширення
chrome.runtime.onInstalled.addListener(() => {
  console.log('PocketOption Bot installed');
  
  chrome.storage.local.set({
    botActive: false,
    stakeType: 'fixed',
    initialAmount: 100,
    percentAmount: 1,
    defaultTimeframe: 5,
    maxMartingale: 3,
    martingaleMultiplier: 2.3,
    martingaleMultiplierPercent: 2.0,
    globalMartingale: true,
    activeLevels: [1, 2, 3],
    trades: [],
    scheduledTrades: [],
    stats: { total: 0, wins: 0, losses: 0, profit: 0 },
    logs: [],
    webhookTemplates: [],
    webhookHistory: [],
    activeTemplate: null,
    closedTrades: []
  });
});