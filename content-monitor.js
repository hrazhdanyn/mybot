// Модуль моніторингу угод v2.0

function startTradeMonitoring(trade) {
  if (tradeMonitorInterval) clearInterval(tradeMonitorInterval);

  let checks = 0;
  let phase = 'waiting'; // waiting, checking_opened, checking_closed
  let tradeInfo = {
    pair: trade.pair,
    direction: trade.direction,
    amount: trade.amount,
    timeframe: trade.timeframe,
    openTime: Date.now(),
    closeTime: null,
    expectedCloseTime: null,
    found: false
  };

  // Розраховуємо очікуваний час закриття
  const timeframeMinutes = parseTimeframe(trade.timeframe);
  tradeInfo.expectedCloseTime = Date.now() + (timeframeMinutes * 60 * 1000);

  addLog(`👀 Моніторинг: ${trade.pair} ${trade.direction} ${trade.timeframe}`, 'info');
  addLog(`⏱️ Очікуваний час завершення: ${new Date(tradeInfo.expectedCloseTime).toLocaleTimeString('uk-UA')}`, 'info');

  tradeMonitorInterval = setInterval(async () => {
    checks++;
    const now = Date.now();
    const timeLeft = Math.round((tradeInfo.expectedCloseTime - now) / 1000);

    if (phase === 'waiting') {
      // ФАЗА 1: Очікуємо закінчення таймфрейму
      if (timeLeft > 10) {
        if (checks % 10 === 0) { // Логуємо кожні 30 сек
          await addLog(`⏳ Очікування ${Math.floor(timeLeft / 60)} хв ${timeLeft % 60} сек...`, 'info');
        }
        return;
      }

      // Час майже вийшов - переходимо до перевірки в Opened
      await addLog(`✅ Таймфрейм завершився! Перевірка в Opened...`, 'success');
      phase = 'checking_opened';
      checks = 0;
    }

    if (phase === 'checking_opened') {
      // ФАЗА 2: Перевіряємо чи угода ще в Opened (максимум 5 спроб)
      await addLog(`   [${checks}] Перевірка Opened...`, 'info');

      const stillOpened = await checkIfStillOpened(tradeInfo);

      if (!stillOpened) {
        // Угоди вже немає в Opened - переходимо до Closed
        await addLog(`✅ Угода завершилась! Перевірка результату в Closed...`, 'success');
        phase = 'checking_closed';
        checks = 0;
        return;
      }

      if (checks >= 5) {
        // Угода досі в Opened після 5 спроб - припускаємо що завершилась
        await addLog(`⚠️ Угода досі в Opened, перехожу до Closed`, 'warning');
        phase = 'checking_closed';
        checks = 0;
      }
    }

    if (phase === 'checking_closed') {
      // ФАЗА 3: Шукаємо результат в Closed
      await addLog(`   [${checks}] Пошук в Closed...`, 'info');

      const result = await findAndCheckInClosed(tradeInfo);

      if (result !== null) {
        clearInterval(tradeMonitorInterval);
        tradeMonitorInterval = null;

        if (result) {
          await addLog(`🎉 ВИГРАШ +${(trade.amount * 0.92).toFixed(0)}`, 'success');
        } else {
          await addLog(`😞 ПРОГРАШ -${trade.amount}`, 'error');
        }

        notifyTradeResult(trade, result);
        return;
      }

      // Таймаут після 40 перевірок (2 хвилини)
      if (checks >= 40) {
        clearInterval(tradeMonitorInterval);
        tradeMonitorInterval = null;
        await addLog(`⚠️ Таймаут ${checks * 3}сек - вважаємо програшем`, 'warning');
        notifyTradeResult(trade, false);
      }
    }
  }, 3000);
}

// Парсинг таймфрейму в хвилини
function parseTimeframe(timeframe) {
  const tfUpper = timeframe.toUpperCase().trim();

  if (tfUpper.includes('H')) {
    return parseInt(tfUpper.replace(/[^0-9]/g, '')) * 60;
  } else if (tfUpper.includes('M')) {
    return parseInt(tfUpper.replace(/[^0-9]/g, ''));
  } else if (tfUpper.includes('S')) {
    return parseInt(tfUpper.replace(/[^0-9]/g, '')) / 60;
  } else {
    return parseInt(tfUpper);
  }
}

// Перевірка чи угода ще в Opened
async function checkIfStillOpened(tradeInfo) {
  await clickTab('OPENED');
  await wait(1000);

  const dealItems = document.querySelectorAll('.item-row, .deal-item, [class*="deal"]');
  const cleanPair = tradeInfo.pair.replace('/', '').replace(' ', '');

  for (const item of dealItems) {
    const text = item.textContent;

    if (text.includes(cleanPair) || text.includes(tradeInfo.pair)) {
      // Знайшли пару - перевіряємо чи це наша угода
      return true;
    }
  }

  return false;
}

// Знаходимо угоду в Opened і запам'ятовуємо деталі
async function findAndTrackInOpened(tradeInfo) {
  await clickTab('OPENED');
  await wait(1000);
  
  const dealItems = document.querySelectorAll('.item-row, .deal-item, [class*="deal"]');
  const cleanPair = tradeInfo.pair.replace('/', '').replace(' ', '');
  
  for (const item of dealItems) {
    const text = item.textContent;
    
    // Перевіряємо пару
    if (!text.includes(cleanPair) && !text.includes(tradeInfo.pair)) {
      continue;
    }
    
    // Перевіряємо напрямок (якщо є)
    const upperText = text.toUpperCase();
    const direction = tradeInfo.direction.toUpperCase();
    
    // Шукаємо часи (формат може бути різний: HH:MM:SS або HH:MM)
    const timeMatches = text.match(/(\d{2}):(\d{2}):(\d{2})/g) || text.match(/(\d{2}):(\d{2})/g);
    
    if (timeMatches && timeMatches.length >= 1) {
      // Зберігаємо інформацію
      return {
        ...tradeInfo,
        openTime: new Date().toLocaleTimeString('uk-UA'),
        closeTime: timeMatches[0], // Час закриття угоди
        found: true,
        element: item
      };
    }
  }
  
  return null;
}

// Шукаємо угоду в Closed і перевіряємо результат
async function findAndCheckInClosed(tradeInfo) {
  await clickTab('CLOSED');
  await wait(1000);
  
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0]; // 2025-10-25
  
  await addLog(`   Дата: ${dateStr}`, 'info');
  
  // Шукаємо групу з сьогоднішньою датою
  const dateGroups = document.querySelectorAll('.deals-list__group-label, [class*="group-label"]');
  
  for (const group of dateGroups) {
    if (!group.textContent.includes(dateStr)) {
      continue;
    }
    
    await addLog(`   ✅ Група з датою знайдена`, 'success');
    
    // Шукаємо угоди після цієї дати
    let nextElement = group.nextElementSibling;
    let attempts = 0;
    
    while (nextElement && attempts < 30) {
      attempts++;
      
      const text = nextElement.textContent;
      const cleanPair = tradeInfo.pair.replace('/', '').replace(' ', '');
      
      // КРОК 1: Перевірка пари
      if (!text.includes(cleanPair) && !text.includes(tradeInfo.pair)) {
        nextElement = nextElement.nextElementSibling;
        continue;
      }
      
      // КРОК 2: Перевірка часу закриття (якщо є)
      if (tradeInfo.closeTime) {
        if (!text.includes(tradeInfo.closeTime)) {
          nextElement = nextElement.nextElementSibling;
          continue;
        }
        await addLog(`   Час співпадає: ${tradeInfo.closeTime}`, 'success');
      }
      
      // КРОК 3: Перевірка напрямку (CALL/PUT)
      const upperText = text.toUpperCase();
      const direction = tradeInfo.direction.toUpperCase();
      
      // КРОК 4: Перевірка результату - шукаємо .centered
      // class="centered" показує ПРИБУТОК:
      // - Виграш: "+92$" або "+84.64$" (зелений колір, є знак +)
      // - Програш: "0$" (червоний колір, немає знаку +)
      // - НЕ ПЛУТАТИ з price-up: "+92%" (це payout - виплата, а не результат!)
      const centeredElements = nextElement.querySelectorAll('.centered');

      for (const centered of centeredElements) {
        const text = centered.textContent.trim();
        const color = window.getComputedStyle(centered).color;

        await addLog(`      Перевіряю centered: "${text}", колір: ${color}`, 'info');

        // Витягуємо число з тексту
        const match = text.match(/([+-]?)(\d+(?:\.\d+)?)/);

        if (match) {
          const sign = match[1]; // '+' або '-' або ''
          const amount = parseFloat(match[2]);

          // ВИГРАШ: є знак + перед числом (наприклад: "+92$" або "+84.64$")
          if (sign === '+' && amount > 0) {
            await addLog(`   ✅ ВИГРАШ: ${text} (знайдено + перед числом)`, 'success');
            return true;
          }

          // ПРОГРАШ: число 0 або немає знаку + (наприклад: "0$")
          if (sign === '' && amount === 0) {
            await addLog(`   ❌ ПРОГРАШ: ${text} (0 без знаку +)`, 'error');
            return false;
          }

          // Також програш якщо є мінус
          if (sign === '-') {
            await addLog(`   ❌ ПРОГРАШ: ${text} (є знак -)`, 'error');
            return false;
          }
        }

        // Додаткова перевірка за кольором (fallback)
        if (color.includes('0, 255') || color.includes('green')) {
          await addLog(`   ✅ ВИГРАШ за кольором: ${text}`, 'success');
          return true;
        }

        if (color.includes('255, 68') || color.includes('255, 0, 0') || color.includes('red')) {
          await addLog(`   ❌ ПРОГРАШ за кольором: ${text}`, 'error');
          return false;
        }
      }

      // НЕ використовуємо price-up/price-down тому що це payout, а не результат!
      
      nextElement = nextElement.nextElementSibling;
    }
  }
  
  // Якщо не знайшли через дату - пошук в останніх 10 угодах
  await addLog(`   Загальний пошук в останніх угодах...`, 'info');
  
  const allDeals = document.querySelectorAll('.item-row, .deal-item, [class*="deal"]');
  const cleanPair = tradeInfo.pair.replace('/', '');
  
  for (let i = allDeals.length - 1; i >= Math.max(0, allDeals.length - 10); i--) {
    const deal = allDeals[i];
    const text = deal.textContent;

    if (text.includes(cleanPair)) {
      // Перевірка часу
      if (tradeInfo.closeTime && !text.includes(tradeInfo.closeTime)) {
        continue;
      }

      // Шукаємо .centered елементи
      const centeredElements = deal.querySelectorAll('.centered');

      for (const centered of centeredElements) {
        const centeredText = centered.textContent.trim();
        const color = window.getComputedStyle(centered).color;

        // Витягуємо число з тексту
        const match = centeredText.match(/([+-]?)(\d+(?:\.\d+)?)/);

        if (match) {
          const sign = match[1];
          const amount = parseFloat(match[2]);

          // ВИГРАШ: є знак + перед числом
          if (sign === '+' && amount > 0) {
            await addLog(`   [${i}] ✅ ВИГРАШ: ${centeredText}`, 'success');
            return true;
          }

          // ПРОГРАШ: число 0 без знаку + або є мінус
          if ((sign === '' && amount === 0) || sign === '-') {
            await addLog(`   [${i}] ❌ ПРОГРАШ: ${centeredText}`, 'error');
            return false;
          }
        }

        // Додаткова перевірка за кольором
        if (color.includes('0, 255') || color.includes('green')) {
          await addLog(`   [${i}] ✅ ВИГРАШ за кольором`, 'success');
          return true;
        }

        if (color.includes('255, 68') || color.includes('255, 0, 0') || color.includes('red')) {
          await addLog(`   [${i}] ❌ ПРОГРАШ за кольором`, 'error');
          return false;
        }
      }

      // НЕ використовуємо price-up/price-down (це payout, а не результат)
    }
  }
  
  return null;
}

async function clickTab(tabName) {
  const links = document.querySelectorAll('a, [role="tab"]');
  
  for (const link of links) {
    const text = link.textContent.trim().toUpperCase();
    
    if (text === tabName || text.includes(tabName)) {
      link.click();
      return true;
    }
  }
  
  return false;
}

function notifyTradeResult(trade, win) {
  chrome.runtime.sendMessage({
    action: 'tradeResult',
    result: {
      tradeId: trade.id,
      win: win,
      amount: trade.amount
    }
  });
  
  currentTrade = null;
}

// Функція для збору закритих угод з історії
async function fetchClosedTradesFromSite() {
  try {
    addLog('Збір закритих угод з історії...', 'info');

    // Переходимо на вкладку Closed
    await clickTab('CLOSED');
    await wait(2000);

    const closedTrades = [];
    const dealItems = document.querySelectorAll('.item-row, .deal-item, [class*="deal"]');

    addLog(`Знайдено ${dealItems.length} записів`, 'info');

    for (const item of dealItems) {
      try {
        const text = item.textContent;

        // Витягуємо пару (наприклад: EUR/USD або EURUSD)
        const pairMatch = text.match(/([A-Z]{3}[\s\/]?[A-Z]{3})/);
        if (!pairMatch) continue;

        const pair = pairMatch[0];

        // Витягуємо час
        const timeMatch = text.match(/(\d{2}):(\d{2}):(\d{2})/);
        const closeTime = timeMatch ? timeMatch[0] : null;

        // Витягуємо суму
        const amountMatch = text.match(/[\$\₴]?\s?(\d+(?:\.\d+)?)/);
        const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;

        // Визначаємо напрямок (CALL/PUT)
        let direction = 'CALL';
        if (text.toUpperCase().includes('PUT') || text.includes('⬇')) {
          direction = 'PUT';
        }

        // Визначаємо результат (виграш/програш) через .centered
        // centered показує ПРИБУТОК: "+92$" (виграш) або "0$" (програш)
        const centeredElements = item.querySelectorAll('.centered');

        let status = 'unknown';
        let profit = 0;

        for (const centered of centeredElements) {
          const centeredText = centered.textContent.trim();
          const color = window.getComputedStyle(centered).color;

          // Витягуємо число з тексту
          const match = centeredText.match(/([+-]?)(\d+(?:\.\d+)?)/);

          if (match) {
            const sign = match[1];
            const profitAmount = parseFloat(match[2]);

            // ВИГРАШ: є знак + перед числом
            if (sign === '+' && profitAmount > 0) {
              status = 'win';
              profit = profitAmount;
              break;
            }

            // ПРОГРАШ: число 0 без знаку + або є мінус
            if ((sign === '' && profitAmount === 0) || sign === '-') {
              status = 'loss';
              profit = -amount;
              break;
            }
          }

          // Додаткова перевірка за кольором
          if (color.includes('0, 255') || color.includes('green')) {
            status = 'win';
            profit = amount * 0.92;
            break;
          }

          if (color.includes('255, 68') || color.includes('255, 0, 0') || color.includes('red')) {
            status = 'loss';
            profit = -amount;
            break;
          }
        }

        // Якщо все ще не визначили - пропускаємо (не використовуємо price-up/down)

        // Додаємо угоду
        if (status !== 'unknown') {
          closedTrades.push({
            pair: pair,
            direction: direction,
            amount: amount,
            profit: profit,
            status: status,
            closeTime: closeTime || new Date().toLocaleTimeString('uk-UA'),
            time: closeTime || new Date().toLocaleTimeString('uk-UA')
          });
        }
      } catch (err) {
        console.error('Помилка обробки угоди:', err);
      }
    }

    // Зберігаємо закриті угоди
    const existingData = await chrome.storage.local.get('closedTrades');
    const existingTrades = existingData.closedTrades || [];

    // Об'єднуємо з існуючими (уникаємо дублікатів)
    const allTrades = [...existingTrades];

    for (const newTrade of closedTrades) {
      const isDuplicate = allTrades.some(t =>
        t.pair === newTrade.pair &&
        t.closeTime === newTrade.closeTime &&
        t.amount === newTrade.amount
      );

      if (!isDuplicate) {
        allTrades.push(newTrade);
      }
    }

    await chrome.storage.local.set({ closedTrades: allTrades });

    addLog(`Оновлено ${closedTrades.length} закритих угод`, 'success');

    return {
      success: true,
      count: closedTrades.length,
      trades: closedTrades
    };
  } catch (error) {
    addLog(`Помилка збору угод: ${error.message}`, 'error');
    return {
      success: false,
      error: error.message
    };
  }
}

// Обробник повідомлень для збору закритих угод
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchClosedTrades') {
    fetchClosedTradesFromSite().then(result => {
      sendResponse(result);
    });
    return true; // Асинхронна відповідь
  }
});

// Експортуємо функції в глобальну область видимості
window.startTradeMonitoring = startTradeMonitoring;
window.fetchClosedTradesFromSite = fetchClosedTradesFromSite;
window.notifyTradeResult = notifyTradeResult;

console.log('✅ Monitor module v2.0 loaded - functions available globally');