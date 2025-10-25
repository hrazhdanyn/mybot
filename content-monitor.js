// Модуль моніторингу угод v2.0

function startTradeMonitoring(trade) {
  if (tradeMonitorInterval) clearInterval(tradeMonitorInterval);
  
  let checks = 0;
  let tradeInfo = {
    pair: trade.pair,
    direction: trade.direction,
    amount: trade.amount,
    openTime: null,
    closeTime: null,
    found: false
  };
  
  addLog(`👀 Моніторинг: ${trade.pair} ${trade.direction}`, 'info');
  
  tradeMonitorInterval = setInterval(async () => {
    checks++;
    
    if (!tradeInfo.found) {
      // ФАЗА 1: Шукаємо в Opened і запам'ятовуємо час
      await addLog(`   [${checks}] Пошук в Opened...`, 'info');
      
      const found = await findAndTrackInOpened(tradeInfo);
      
      if (found) {
        tradeInfo = found;
        tradeInfo.found = true;
        
        await addLog(`✅ Знайдено в Opened!`, 'success');
        await addLog(`   Відкриття: ${tradeInfo.openTime}`, 'info');
        await addLog(`   Закриття: ${tradeInfo.closeTime}`, 'info');
        await addLog(`⏳ Очікую завершення...`, 'warning');
      }
      
      // Після 5 спроб переходимо до Closed
      if (checks >= 5) {
        await addLog(`⚠️ Не знайдено в Opened, перехожу до Closed`, 'warning');
        tradeInfo.found = true; // Переходимо до наступної фази
      }
      
    } else {
      // ФАЗА 2: Чекаємо поки угода з'явиться в Closed
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
        await addLog(`⚠️ Таймаут ${checks * 3}сек`, 'warning');
        notifyTradeResult(trade, false);
      }
    }
  }, 3000);
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
      
      // КРОК 4: Перевірка результату
      const priceUp = nextElement.querySelector('.price-up, .centered.price-up, [class*="price-up"]');
      const priceDown = nextElement.querySelector('.price-down, .centered.price-down, [class*="price-down"]');
      
      if (priceUp) {
        const amount = priceUp.textContent.trim();
        await addLog(`   price-up: ${amount}`, 'success');
        return true;
      }
      
      if (priceDown) {
        const amount = priceDown.textContent.trim();
        await addLog(`   price-down: ${amount}`, 'error');
        return false;
      }
      
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
      
      const priceUp = deal.querySelector('.price-up, .centered.price-up');
      const priceDown = deal.querySelector('.price-down, .centered.price-down');
      
      if (priceUp) {
        await addLog(`   [${i}] ВИГРАШ`, 'success');
        return true;
      }
      
      if (priceDown) {
        await addLog(`   [${i}] ПРОГРАШ`, 'error');
        return false;
      }
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

console.log('✅ Monitor module v2.0 loaded');