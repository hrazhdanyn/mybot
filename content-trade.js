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

      // Перевірка виплати (payout)
      await addLog(`📍 Перевірка виплати...`, 'info');
      const payout = await checkPayout();
      if (payout < 70) {
        await addLog(`❌ Виплата надто низька: ${payout}% (мінімум 70%)`, 'error');
        await addLog(`⏭️ Пропускаємо цю угоду, чекаємо наступну`, 'warning');
        notifyTradeResult(trade, false);
        return;
      }
      await addLog(`✅ Виплата OK: ${payout}%`, 'success');
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
  // Парсимо таймфрейм (може бути M1, M5, M30, H1, 1M, 5M, 30M, 1H тощо)
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  const tfUpper = timeframe.toUpperCase().trim();

  // Визначаємо години/хвилини/секунди
  if (tfUpper.includes('H')) {
    hours = parseInt(tfUpper.replace(/[^0-9]/g, ''));
    await addLog(`   Потрібен: ${hours} годин`, 'info');
  } else if (tfUpper.includes('M')) {
    minutes = parseInt(tfUpper.replace(/[^0-9]/g, ''));
    await addLog(`   Потрібен: ${minutes} хвилин`, 'info');
  } else if (tfUpper.includes('S')) {
    seconds = parseInt(tfUpper.replace(/[^0-9]/g, ''));
    await addLog(`   Потрібен: ${seconds} секунд`, 'info');
  } else {
    // Якщо тільки число - вважаємо хвилинами
    minutes = parseInt(tfUpper);
    await addLog(`   Потрібен: ${minutes} хвилин`, 'info');
  }

  // МЕТОД 1: Спочатку шукаємо швидкі кнопки
  const quickButtons = document.querySelectorAll('.dops__timeframes-item');

  for (const btn of quickButtons) {
    const text = btn.textContent.trim().toUpperCase();

    // Перевіряємо чи співпадає
    if (text === tfUpper || text === `M${minutes}` || text === `H${hours}` || text === `S${seconds}`) {
      await addLog(`   ✅ Клік на швидку кнопку: ${text}`, 'success');
      btn.click();
      await wait(500);
      return true;
    }
  }

  // МЕТОД 2: Детальне налаштування через модальне вікно
  await addLog(`   Швидка кнопка не знайдена, використовую детальний вибір`, 'info');

  // Клікаємо на value__val (показує поточний час)
  const valueVals = document.querySelectorAll('.value__val');
  let valueVal = null;

  // Шукаємо value__val який показує час в форматі HH:MM:SS
  for (const val of valueVals) {
    if (val.textContent.match(/\d{2}:\d{2}:\d{2}/)) {
      valueVal = val;
      break;
    }
  }

  if (!valueVal) {
    await addLog(`   ❌ value__val не знайдено`, 'error');
    return false;
  }

  await addLog(`   Клік на value__val: ${valueVal.textContent}`, 'info');
  valueVal.click();
  await wait(1000);

  // Перевіряємо чи відкрилось модальне вікно
  const modal = document.querySelector('.trading-panel-modal__wrap');
  if (!modal) {
    await addLog(`   ❌ Модальне вікно не відкрилось`, 'error');
    return false;
  }

  await addLog(`   ✅ Модальне вікно відкрито`, 'success');

  // Знаходимо перемикач Auto Time Offset
  const checkboxes = modal.querySelectorAll('input.mdl-switch__input[type="checkbox"]');

  for (const checkbox of checkboxes) {
    if (checkbox.checked) {
      await addLog(`   Вимикаю Auto Time Offset`, 'info');
      checkbox.click();
      await wait(500);
      break;
    }
  }

  // Знаходимо input поля для годин, хвилин, секунд
  const allInputs = modal.querySelectorAll('input[type="text"]');

  // Фільтруємо тільки видимі поля які приймають числа
  const timeInputs = [];
  for (const input of allInputs) {
    const rect = input.getBoundingClientRect();
    const styles = window.getComputedStyle(input);

    // Перевіряємо чи input видимий та має нормальну ширину
    if (styles.display !== 'none' && rect.width > 20 && rect.width < 100) {
      timeInputs.push(input);
    }
  }

  await addLog(`   Знайдено ${timeInputs.length} input полів для часу`, 'info');

  if (timeInputs.length >= 3) {
    // Зазвичай порядок: години, хвилини, секунди
    const hoursInput = timeInputs[0];
    const minutesInput = timeInputs[1];
    const secondsInput = timeInputs[2];

    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    await addLog(`   Встановлюю: ${timeStr}`, 'info');

    // Встановлюємо години
    await setInputValue(hoursInput, String(hours));
    await wait(200);

    // Встановлюємо хвилини
    await setInputValue(minutesInput, String(minutes));
    await wait(200);

    // Встановлюємо секунди
    await setInputValue(secondsInput, String(seconds));
    await wait(500);

    // Закриваємо модальне вікно - клік поза ним
    const backdrop = document.querySelector('.modal-backdrop, .overlay');
    if (backdrop) {
      backdrop.click();
    } else {
      // Якщо немає backdrop - клікаємо на body
      const rect = modal.getBoundingClientRect();
      const x = rect.left - 10;
      const y = rect.top + rect.height / 2;

      const elementAtPoint = document.elementFromPoint(x, y);
      if (elementAtPoint) {
        elementAtPoint.click();
      }
    }

    await wait(500);

    await addLog(`   ✅ Таймфрейм встановлено: ${timeStr}`, 'success');
    return true;
  } else if (timeInputs.length > 0) {
    // Якщо знайшли менше 3 полів - спробуємо працювати з тим що є
    await addLog(`   ⚠️ Знайдено менше 3 полів, спроба встановити...`, 'warning');

    if (timeInputs.length >= 1 && hours > 0) {
      await setInputValue(timeInputs[0], String(hours));
      await wait(200);
    }
    if (timeInputs.length >= 2 && minutes > 0) {
      await setInputValue(timeInputs[1], String(minutes));
      await wait(200);
    }
    if (timeInputs.length >= 3 && seconds > 0) {
      await setInputValue(timeInputs[2], String(seconds));
      await wait(200);
    }

    // Закриваємо модальне вікно
    document.body.click();
    await wait(500);

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

async function checkPayout() {
  // Шукаємо елемент з класом value__val-start який показує виплату
  const payoutElements = document.querySelectorAll('.value__val-start');

  for (const element of payoutElements) {
    const text = element.textContent.trim();

    // Витягуємо число з тексту (наприклад: "92%" -> 92)
    const match = text.match(/(\d+)%?/);

    if (match) {
      const payout = parseInt(match[1]);
      await addLog(`   Знайдено виплату: ${payout}%`, 'info');
      return payout;
    }
  }

  // Якщо не знайшли - повертаємо 0 (буде заблоковано)
  await addLog(`   ⚠️ Не знайдено інформацію про виплату`, 'warning');
  return 0;
}