// Модуль відкриття угод

async function openTrade(trade) {
  await addLog(`═══════════════════════════════════`, 'info');
  await addLog(`🎯 ${trade.pair} ${trade.direction} ${trade.amount}${trade.stakeType === 'percent' ? '%' : '₴'}`, 'success');
  await addLog(`═══════════════════════════════════`, 'info');
  
  try {
    // КРОК 0: Тип ставки
    await addLog(`📍 КРОК 0: Тип ставки`, 'info');
    await checkAndSetStakeType(trade.stakeType);
    await wait(1000);
    
    // КРОК 1: Пара
    await addLog(`📍 КРОК 1: Пара ${trade.pair}`, 'info');
    const pairOk = await selectAsset(trade.pair);
    
    if (pairOk) {
      await wait(1000);
      const verified = await verifyCurrentPair(trade.pair);
      if (!verified) {
        await addLog(`❌ Пара не підтверджена`, 'error');
        notifyTradeResult(trade, false);
        return;
      }
      await addLog(`✅ ПАРА OK`, 'success');
    }
    await wait(1000);
    
    // КРОК 2: Таймфрейм
    await addLog(`📍 КРОК 2: Таймфрейм ${trade.timeframe}`, 'info');
    await setTimeframe(trade.timeframe);
    await wait(1000);
    
    // КРОК 3: Сума
    await addLog(`📍 КРОК 3: Сума ${trade.amount}`, 'info');
    await setAmount(trade.amount);
    await wait(1000);
    
    // КРОК 4: Відкриття
    await addLog(`📍 КРОК 4: ${trade.direction}`, 'info');
    const success = await clickTradeButton(trade.direction);
    
    if (success) {
      await addLog(`═══════════════════════════════════`, 'success');
      await addLog(`✅ УГОДА ВІДКРИТА!`, 'success');
      await addLog(`═══════════════════════════════════`, 'success');
      
      currentTrade = { ...trade, openTime: Date.now() };
      startTradeMonitoring(trade);
    } else {
      await addLog(`❌ НЕ ВДАЛОСЯ ВІДКРИТИ`, 'error');
      notifyTradeResult(trade, false);
    }
    
  } catch (error) {
    await addLog(`❌ ПОМИЛКА: ${error.message}`, 'error');
  }
}

async function checkAndSetStakeType(requiredType) {
  const allText = document.body.textContent;
  
  let currentType = 'unknown';
  if (allText.includes('Stake') || allText.includes('Amount')) {
    currentType = 'fixed';
  } else if (allText.includes('Percent') || allText.includes('%')) {
    currentType = 'percent';
  }
  
  await addLog(`   Поточний: ${currentType}, потрібен: ${requiredType}`, 'info');
  
  if (currentType === requiredType || requiredType === 'fixed' && currentType === 'unknown') {
    await addLog(`   ✅ Тип OK`, 'success');
    return true;
  }
  
  const callPutBlock = document.querySelector('.call-put-block, #put-call-buttons-chart-1');
  
  if (callPutBlock) {
    const switches = callPutBlock.querySelectorAll('svg, [class*="switch"], [class*="toggle"]');
    
    for (let i = 0; i < Math.min(switches.length, 3); i++) {
      switches[i].click();
      await wait(500);
      
      const newText = document.body.textContent;
      const newType = newText.includes('Percent') ? 'percent' : 'fixed';
      
      if (newType === requiredType) {
        await addLog(`   ✅ Змінено на ${requiredType}`, 'success');
        return true;
      }
    }
  }
  
  return false;
}

async function selectAsset(pair) {
  const currentSymbol = document.querySelector('.current-symbol, .current-symbol_cropped');
  
  if (!currentSymbol) {
    await addLog(`   ❌ current-symbol не знайдено`, 'error');
    return false;
  }
  
  const currentText = currentSymbol.textContent.trim();
  const cleanPair = pair.replace('/', '');
  
  if (currentText.includes(cleanPair)) {
    await addLog(`   ✅ Вже вибрана`, 'success');
    return true;
  }
  
  currentSymbol.click();
  await wait(800);
  
  const labels = document.querySelectorAll('.alist__label');
  
  for (const label of labels) {
    const text = label.textContent.trim();
    
    if (text.includes(cleanPair) || text.includes(pair)) {
      await addLog(`   ✅ Клік на "${text}"`, 'success');
      label.click();
      await wait(500);
      return true;
    }
  }
  
  return false;
}

async function verifyCurrentPair(expectedPair) {
  const currentSymbol = document.querySelector('.current-symbol, .current-symbol_cropped');
  
  if (!currentSymbol) return false;
  
  const currentText = currentSymbol.textContent.trim();
  const cleanExpected = expectedPair.replace('/', '');
  
  return currentText.includes(cleanExpected) || currentText.includes(expectedPair);
}

async function setTimeframe(timeframe) {
  const minutes = parseInt(timeframe.replace(/[MS]/g, ''));
  await addLog(`   Потрібен: ${minutes} хвилин`, 'info');
  
  // МЕТОД 1: Спочатку шукаємо швидкі кнопки (S5, M1, M5 тощо)
  const quickButtons = document.querySelectorAll('.dops__timeframes-item');
  
  for (const btn of quickButtons) {
    const text = btn.textContent.trim();
    
    // ТІЛЬКИ M (хвилини), НЕ S (секунди)
    if (text === `M${minutes}`) {
      await addLog(`   ✅ Клік на M${minutes}`, 'success');
      btn.click();
      await wait(500);
      return true;
    }
  }
  
  // МЕТОД 2: Якщо немає швидкої кнопки - використовуємо детальний вибір
  await addLog(`   M${minutes} не знайдено, використовую детальний вибір`, 'info');
  
  // Клікаємо на value__val (показує поточний час типу "00:05:00")
  const valueVal = document.querySelector('.value__val');
  
  if (!valueVal) {
    await addLog(`   ❌ value__val не знайдено`, 'error');
    return false;
  }
  
  await addLog(`   Клік на value__val: ${valueVal.textContent}`, 'info');
  valueVal.click();
  await wait(800);
  
  // Тепер відкрилось вікно з вибором
  // Перевіряємо чи є перемикач (checkbox для Auto Time Offset)
  const checkbox = document.querySelector('input.mdl-switch__input[type="checkbox"]');
  
  if (checkbox && checkbox.checked) {
    // Вимикаємо Auto Time, щоб можна було вручну встановити
    await addLog(`   Вимикаю Auto Time Offset`, 'info');
    checkbox.click();
    await wait(500);
  }
  
  // Знаходимо input поля для годин, хвилин, секунд
  const timeInputs = document.querySelectorAll('input[type="text"]');
  
  if (timeInputs.length >= 3) {
    // Зазвичай порядок: години, хвилини, секунди
    const hoursInput = timeInputs[0];
    const minutesInput = timeInputs[1];
    const secondsInput = timeInputs[2];
    
    await addLog(`   Встановлюю: 00:${String(minutes).padStart(2, '0')}:00`, 'info');
    
    // Години = 0
    await setInputValue(hoursInput, '0');
    await wait(200);
    
    // Хвилини = потрібне значення
    await setInputValue(minutesInput, String(minutes));
    await wait(200);
    
    // Секунди = 0
    await setInputValue(secondsInput, '0');
    await wait(300);
    
    // Закриваємо модальне вікно (клік поза ним або ESC)
    document.body.click();
    await wait(500);
    
    await addLog(`   ✅ Таймфрейм встановлено`, 'success');
    return true;
  }
  
  await addLog(`   ⚠️ Не вдалося встановити таймфрейм`, 'warning');
  return false;
}

// Допоміжна функція для встановлення значення в input
async function setInputValue(input, value) {
  input.focus();
  input.select();
  
  // Очищаємо
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  
  // Вводимо нове значення
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  
  input.blur();
}

async function setAmount(amount) {
  const callPutBlock = document.querySelector('.call-put-block, #put-call-buttons-chart-1');
  
  if (!callPutBlock) {
    await addLog(`   ❌ Блок не знайдено`, 'error');
    return false;
  }
  
  const inputs = callPutBlock.querySelectorAll('input');
  const visibleInputs = [];
  
  for (const input of inputs) {
    const rect = input.getBoundingClientRect();
    const styles = window.getComputedStyle(input);
    
    if (styles.display !== 'none' && rect.width > 30) {
      visibleInputs.push({ input, width: rect.width });
    }
  }
  
  visibleInputs.sort((a, b) => b.width - a.width);
  
  if (visibleInputs.length === 0) return false;
  
  const targetInput = visibleInputs[0].input;
  
  targetInput.focus();
  await wait(200);
  
  targetInput.value = '';
  targetInput.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(100);
  
  for (const char of amount.toString()) {
    targetInput.value += char;
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(100);
  }
  
  targetInput.dispatchEvent(new Event('change', { bubbles: true }));
  targetInput.blur();
  await wait(200);
  
  if (targetInput.value == amount) {
    await addLog(`   ✅ ${amount}`, 'success');
    return true;
  }
  
  return false;
}

async function clickTradeButton(direction) {
  const isBuy = direction === 'CALL' || direction === 'BUY';
  const searchText = isBuy ? 'BUY' : 'SELL';
  
  const switchItems = document.querySelectorAll('span.switch-state-block__item');
  
  for (const item of switchItems) {
    const text = item.textContent.trim().toUpperCase();
    
    if (text === searchText) {
      await addLog(`   ✅ ${searchText}`, 'success');
      item.click();
      await wait(500);
      return true;
    }
  }
  
  const allSpans = document.querySelectorAll('span');
  
  for (const span of allSpans) {
    const text = span.textContent.trim().toUpperCase();
    
    if (text === searchText) {
      const rect = span.getBoundingClientRect();
      const styles = window.getComputedStyle(span);
      
      if (styles.display !== 'none' && rect.width > 0) {
        await addLog(`   ✅ ${searchText} (span)`, 'success');
        span.click();
        await wait(500);
        return true;
      }
    }
  }
  
  await addLog(`   ❌ ${searchText} не знайдено`, 'error');
  return false;
}