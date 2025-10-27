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
  console.log('[BACKGROUND] Отримано повідомлення:', message.action, message);

  if (message.action === 'startBot') {
    startBot();
  } else if (message.action === 'stopBot') {
    stopBot();
  } else if (message.action === 'processSignal') {
    console.log('[BACKGROUND] Викликаю processSignal з сигналом:', message.signal);
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
  console.log('=== processSignal викликано ===', signal);
  await addLog(`📥 Отримано сигнал: ${signal.pair} ${signal.direction}`, 'info');

  const settings = await chrome.storage.local.get([
    'stakeType',
    'initialAmount',
    'percentAmount',
    'maxMartingale',
    'martingaleMultiplier',
    'martingaleMultiplierPercent',
    'botActive',
    'globalMartingaleLevel'
  ]);

  console.log('Bot settings:', settings);
  await addLog(`⚙️ Бот активний: ${settings.botActive}`, 'info');

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

  // Визначаємо базову ставку або використовуємо поточний глобальний рівень
  const globalLevel = settings.globalMartingaleLevel || 1;
  let baseAmount;

  if (settings.stakeType === 'percent') {
    baseAmount = settings.percentAmount || 1;
    await addLog(`💰 Тип ставки: ${baseAmount}% від депозиту`, 'info');
  } else {
    baseAmount = settings.initialAmount || 100;
    await addLog(`💰 Тип ставки: ${baseAmount} ₴ (фіксована)`, 'info');
  }

  // Якщо є незавершені пари (globalLevel > 1), починаємо з поточного рівня
  let tradeAmount = baseAmount;
  let martingaleLevel = 0;

  if (globalLevel > 1) {
    const multiplier = settings.stakeType === 'percent'
      ? settings.martingaleMultiplierPercent || 2.0
      : settings.martingaleMultiplier || 2.3;

    // Віднімаємо 1 тому що globalLevel вже вказує на НАСТУПНИЙ рівень
    martingaleLevel = globalLevel - 1;
    tradeAmount = baseAmount * Math.pow(multiplier, martingaleLevel);

    await addLog(`🔄 Продовження мартингейлу: рівень ${globalLevel} (після попередніх програшів)`, 'warning');
    await addLog(`💰 Сума з урахуванням мартингейлу: ${tradeAmount.toFixed(2)} ${settings.stakeType === 'percent' ? '%' : '₴'}`, 'info');
  }

  const trade = {
    id: generateId(),
    pair: signal.pair,
    direction: signal.direction,
    timeframe: signal.timeframe,
    amount: tradeAmount,
    stakeType: settings.stakeType || 'fixed',
    entryTime: entryTimeKyiv,
    martingaleLevel: martingaleLevel,
    status: 'scheduled'
  };

  await addLog(`⏱️ Таймфрейм: ${trade.timeframe}`, 'info');

  scheduledTrades.push(trade);
  await addLog(`✅ Угоду заплановано на ${formatTimeString(entryTimeKyiv)}`, 'success');
  await addLog(`📊 Всього запланованих угод: ${scheduledTrades.length}`, 'info');

  await addToActiveTrades(trade);
  await updateScheduledTradesInStorage();

  console.log('Signal processed:', trade);
}

// Перевірка запланованих угод
async function checkScheduledTrades() {
  // Логуємо навіть якщо немає угод (кожні 10 викликів = кожні 50 сек)
  if (!checkScheduledTrades.counter) checkScheduledTrades.counter = 0;
  checkScheduledTrades.counter++;

  if (scheduledTrades.length === 0) {
    if (checkScheduledTrades.counter % 10 === 0) {
      const now = new Date();
      const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      await addLog(`🔍 Перевірка: час ${currentTimeStr}, запланованих угод: 0`, 'info');
    }
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

    // Різниця в хвилинах (позитивна якщо час ще не настав, негативна якщо пройшов)
    const timeDiff = tradeTime - currentTime;

    await addLog(`⏰ Угода ${trade.pair}: заплановано ${tradeTimeStr}, до відкриття ${timeDiff} хв`, 'info');

    // Відкриваємо угоду ТІЛЬКИ коли час настав або пройшов (timeDiff <= 0)
    // Але не пізніше 2 хвилин після запланованого часу
    if (timeDiff <= 0 && timeDiff >= -2) {
      await addLog(`🚀 ЧАС НАСТАВ! Виконуємо угоду ${trade.pair} ${trade.direction}`, 'success');
      await executeTrade(trade);
      scheduledTrades.splice(i, 1);
      await updateScheduledTradesInStorage();
    } else if (timeDiff < -2) {
      // Угода пропущена (минуло більше 2 хвилин)
      await addLog(`⚠️ Угода ${trade.pair} пропущена (час: ${tradeTimeStr})`, 'warning');
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
    'percentAmount',
    'stakeType',
    'globalMartingaleLevel',
    'pairLosses'
  ]);

  // Розрахунок прибутку
  const profitPercent = 0.92; // 92% виплата
  const profit = result.win ? result.amount * profitPercent : -result.amount;

  await updateStats(result.win, profit);

  // Отримуємо інформацію про угоду
  const trade = await getTradeById(result.tradeId);

  if (!trade) {
    await addLog(`⚠️ Угоду не знайдено в активних`, 'warning');
    await removeFromActiveTrades(result.tradeId);
    return;
  }

  const pairKey = `${trade.pair}_${trade.direction}_${trade.timeframe}`;
  let pairLosses = settings.pairLosses || {};
  let globalLevel = settings.globalMartingaleLevel || 1;
  const maxMartingale = settings.maxMartingale || 15;

  if (result.win) {
    // ВИГРАШ - скидаємо ВСЕ до початкового стану
    await addLog(`✅ ВИГРАШ! Скидаємо всі лічильники мартингейлу`, 'success');

    // Скидаємо глобальний рівень до 1
    await chrome.storage.local.set({
      globalMartingaleLevel: 1,
      pairLosses: {}
    });

    await addLog(`🔄 Глобальний рівень скинуто до 1`, 'info');
    await addLog(`🔄 Всі програші пар скинуто`, 'info');

    await removeFromActiveTrades(result.tradeId);
  } else {
    // ПРОГРАШ - обробляємо мартингейл
    const currentPairLosses = pairLosses[pairKey] || 0;
    const newPairLosses = currentPairLosses + 1;

    await addLog(`📉 Програшів на ${pairKey}: ${newPairLosses}`, 'error');
    await addLog(`📊 Поточний глобальний рівень: ${globalLevel}`, 'info');

    // Перевірка чи не досягли максимуму
    if (globalLevel >= maxMartingale) {
      await addLog(`❌ Досягнуто максимальний рівень ${maxMartingale}`, 'error');
      await addLog(`🛑 ЗУПИНКА мартингейлу. Очікуємо нові сигнали зі скиданням`, 'error');

      // Скидаємо все
      await chrome.storage.local.set({
        globalMartingaleLevel: 1,
        pairLosses: {}
      });

      await removeFromActiveTrades(result.tradeId);
      return;
    }

    if (newPairLosses < 4) {
      // ПРОДОВЖУЄМО НА ТІЙ ЖЕ ПАРІ (рівні 1-3 на парі)
      pairLosses[pairKey] = newPairLosses;
      await chrome.storage.local.set({ pairLosses });

      // Збільшуємо глобальний рівень
      const newGlobalLevel = globalLevel + 1;
      await chrome.storage.local.set({ globalMartingaleLevel: newGlobalLevel });

      await addLog(`🔄 Мартингейл: рівень ${newPairLosses}/4 на парі, глобальний рівень ${globalLevel} → ${newGlobalLevel}`, 'warning');

      // Визначаємо базову ставку та множник
      let baseAmount;
      if (trade.stakeType === 'percent') {
        baseAmount = settings.percentAmount || 1;
      } else {
        baseAmount = settings.initialAmount || 100;
      }

      const multiplier = trade.stakeType === 'percent'
        ? settings.martingaleMultiplierPercent || 2.0
        : settings.martingaleMultiplier || 2.3;

      const martingaleAmount = baseAmount * Math.pow(multiplier, globalLevel);

      // Створюємо нову угоду на ту саму пару
      const martingaleTrade = {
        id: generateId(),
        pair: trade.pair,
        direction: trade.direction,
        timeframe: trade.timeframe,
        amount: martingaleAmount,
        stakeType: trade.stakeType,
        entryTime: { hours: new Date().getHours(), minutes: new Date().getMinutes() },
        martingaleLevel: globalLevel,
        status: 'scheduled',
        pairKey: pairKey
      };

      await addLog(`   💰 Сума: ${martingaleAmount.toFixed(2)} ${trade.stakeType === 'percent' ? '%' : '₴'}`, 'info');
      await addLog(`   ⚡ Відкриваємо ЗАРАЗ (без очікування сигналу)`, 'info');

      scheduledTrades.push(martingaleTrade);
      await addToActiveTrades(martingaleTrade);
      await updateScheduledTradesInStorage();

      // Виконуємо негайно
      await executeTrade(martingaleTrade);
    } else {
      // 4-Й ПРОГРАШ НА ПАРІ - очікуємо наступний сигнал
      pairLosses[pairKey] = 4; // Фіксуємо що на цій парі було 4 програші
      await chrome.storage.local.set({ pairLosses });

      // Збільшуємо глобальний рівень
      const newGlobalLevel = globalLevel + 1;
      await chrome.storage.local.set({ globalMartingaleLevel: newGlobalLevel });

      await addLog(`⚠️ 4-й програш на ${pairKey}!`, 'warning');
      await addLog(`⏳ ОЧІКУЄМО НАСТУПНИЙ СИГНАЛ. Він почнеться з глобального рівня ${newGlobalLevel}`, 'warning');
      await addLog(`📊 Кількість завершених пар: ${Object.keys(pairLosses).filter(k => pairLosses[k] === 4).length}`, 'info');
    }

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
    maxMartingale: 15,  // Максимальний глобальний рівень
    martingaleMultiplier: 2.3,
    martingaleMultiplierPercent: 2.0,
    globalMartingaleLevel: 1,  // Починаємо з рівня 1
    pairLosses: {},
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