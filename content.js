// Content script - Головний файл v3.0
// Працює разом з content-trade.js та content-monitor.js
console.log('🤖 PocketOption Bot v3.0 - Main module loaded');

// Глобальні змінні (доступні для всіх модулів)
let currentTrade = null;
let tradeMonitorInterval = null;

// ═══════════════════════════════════════════════════════════
// ЛОГУВАННЯ
// ═══════════════════════════════════════════════════════════

async function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('uk-UA');
  
  try {
    const data = await chrome.storage.local.get('logs');
    const logs = data.logs || [];
    
    logs.push({
      time: timestamp,
      message: `[CONTENT] ${message}`,
      type: type
    });
    
    if (logs.length > 150) {
      logs.shift();
    }
    
    await chrome.storage.local.set({ logs });
    console.log(`[CONTENT ${type.toUpperCase()}] ${message}`);
  } catch (err) {
    console.error('Log error:', err);
  }
}

// ═══════════════════════════════════════════════════════════
// ДОПОМІЖНІ ФУНКЦІЇ
// ═══════════════════════════════════════════════════════════

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════
// ІНІЦІАЛІЗАЦІЯ
// ═══════════════════════════════════════════════════════════

(async function init() {
  await wait(2000);
  await addLog('═══════════════════════════════════', 'info');
  await addLog('✅ Bot v3.0 ініціалізовано', 'success');
  await addLog(`📍 URL: ${window.location.href}`, 'info');
  
  // Діагностика сторінки
  const spans = document.querySelectorAll('span');
  let buyCount = 0, sellCount = 0;
  
  spans.forEach(s => {
    const txt = s.textContent.trim().toUpperCase();
    if (txt === 'BUY') buyCount++;
    if (txt === 'SELL') sellCount++;
  });
  
  await addLog(`📊 BUY spans: ${buyCount}, SELL spans: ${sellCount}`, 'info');
  
  if (buyCount > 0 && sellCount > 0) {
    await addLog('✅ Елементи знайдено - готовий!', 'success');
  } else {
    await addLog('⚠️ BUY/SELL не знайдено', 'warning');
  }
  
  await addLog('═══════════════════════════════════', 'info');
})();

// ═══════════════════════════════════════════════════════════
// СЛУХАЧ ПОВІДОМЛЕНЬ
// ═══════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  await addLog(`📨 Команда: ${message.action}`, 'info');

  try {
    if (message.action === 'ping') {
      sendResponse({ status: 'alive' });
      return true;
    }

    if (message.action === 'diagnose') {
      const diagnostics = await getDiagnostics();
      sendResponse({ diagnostics });
      return true;
    }

    if (message.action === 'openTrade') {
      await addLog(`═══════════════════════════════════`, 'success');
      await addLog(`🎯 ОТРИМАНО КОМАНДУ ВІДКРИТИ УГОДУ`, 'success');
      await addLog(`═══════════════════════════════════`, 'success');

      // Перевіряємо чи завантажився content-trade.js
      if (typeof openTrade !== 'function') {
        await addLog(`⚠️ Очікуємо завантаження content-trade.js...`, 'warning');

        // Чекаємо до 5 секунд поки завантажиться
        let attempts = 0;
        while (typeof openTrade !== 'function' && attempts < 10) {
          await wait(500);
          attempts++;
        }

        if (typeof openTrade !== 'function') {
          await addLog(`❌ content-trade.js не завантажився!`, 'error');
          sendResponse({ status: 'error', message: 'content-trade.js not loaded' });
          return true;
        }

        await addLog(`✅ content-trade.js завантажено`, 'success');
      }

      // Викликаємо функцію з content-trade.js
      openTrade(message.trade).catch(err => {
        addLog(`❌ Критична помилка: ${err.message}`, 'error');
        console.error(err);
      });

      sendResponse({ status: 'started' });
      return true;
    }

  } catch (error) {
    await addLog(`❌ Помилка обробки: ${error.message}`, 'error');
    console.error(error);
  }

  return true;
});

// ═══════════════════════════════════════════════════════════
// ДІАГНОСТИКА
// ═══════════════════════════════════════════════════════════

async function getDiagnostics() {
  const spans = document.querySelectorAll('span');
  let buy = 0, sell = 0;
  
  spans.forEach(s => {
    const t = s.textContent.trim().toUpperCase();
    if (t === 'BUY') buy++;
    if (t === 'SELL') sell++;
  });
  
  return {
    totalButtons: document.querySelectorAll('button').length,
    totalInputs: document.querySelectorAll('input').length,
    totalSpans: spans.length,
    buySpans: buy,
    sellSpans: sell,
    callButtons: buy,
    putButtons: sell
  };
}

// ═══════════════════════════════════════════════════════════
// ПАРСИНГ СИГНАЛІВ
// ═══════════════════════════════════════════════════════════

window.parseSignalFromText = function(text) {
  const signal = {};
  
  // Пара
  const pairMatch = text.match(/([A-Z]{3}\/[A-Z]{3})/);
  if (pairMatch) signal.pair = pairMatch[1];
  
  // Напрямок
  if (text.includes('CALL') || text.includes('BUY') || text.includes('🟢')) {
    signal.direction = 'CALL';
  } else if (text.includes('SELL') || text.includes('PUT') || text.includes('🔽') || text.includes('🟥')) {
    signal.direction = 'PUT';
  }
  
  // Таймфрейм
  const tfMatch = text.match(/(\d+)M/);
  if (tfMatch) signal.timeframe = tfMatch[0];
  
  // Час входу
  const timeMatch = text.match(/Entry at (\d{1,2}:\d{2})/i);
  if (timeMatch) signal.entryTime = timeMatch[1];
  
  // Мартингейл
  const martingaleLevels = [];
  const levelMatches = text.matchAll(/(\d)️⃣ level at (\d{1,2}:\d{2})/g);
  
  for (const match of levelMatches) {
    martingaleLevels.push({
      level: parseInt(match[1]),
      time: match[2]
    });
  }
  
  if (martingaleLevels.length > 0) {
    signal.martingaleLevels = martingaleLevels;
  }
  
  return signal;
};

console.log('✅ Main module ready - waiting for content-trade.js and content-monitor.js');