#!/usr/bin/env node

/**
 * PocketOption Bot - Webhook Server
 *
 * Простий HTTP сервер для прийому вебхуків від SendPulse, TradingView та інших сервісів.
 * Сервер приймає сигнали та зберігає їх, щоб Chrome Extension міг їх читати.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const SIGNALS_FILE = path.join(__dirname, 'webhook-signals.json');

// Зберігаємо останні сигнали в пам'яті
let recentSignals = [];
const MAX_SIGNALS = 100;

// Завантажуємо існуючі сигнали при старті
function loadSignals() {
  try {
    if (fs.existsSync(SIGNALS_FILE)) {
      const data = fs.readFileSync(SIGNALS_FILE, 'utf8');
      recentSignals = JSON.parse(data);
      console.log(`✅ Завантажено ${recentSignals.length} сигналів з файлу`);
    }
  } catch (error) {
    console.error('❌ Помилка завантаження сигналів:', error.message);
    recentSignals = [];
  }
}

// Зберігаємо сигнали в файл
function saveSignals() {
  try {
    fs.writeFileSync(SIGNALS_FILE, JSON.stringify(recentSignals, null, 2));
  } catch (error) {
    console.error('❌ Помилка збереження сигналів:', error.message);
  }
}

// Парсинг JSON з body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        if (body) {
          resolve(JSON.parse(body));
        } else {
          resolve({});
        }
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// Парсинг сигналу з різних форматів
function parseSignal(data) {
  const signal = {
    pair: null,
    direction: null,
    timeframe: null,
    entryTime: null,
    timestamp: new Date().toISOString()
  };

  // Формат 1: Прямий формат (pair, direction, timeframe, entryTime)
  if (data.pair && data.direction) {
    signal.pair = data.pair;
    signal.direction = data.direction.toUpperCase();
    signal.timeframe = data.timeframe || '1M';
    signal.entryTime = data.entryTime || generateEntryTime();
    return signal;
  }

  // Формат 2: TradingView Alert (ticker, action, time)
  if (data.ticker && data.action) {
    signal.pair = parseTicker(data.ticker);
    signal.direction = data.action.toUpperCase() === 'BUY' ? 'CALL' : 'PUT';
    signal.timeframe = data.interval || '1M';
    signal.entryTime = data.time || generateEntryTime();
    return signal;
  }

  // Формат 3: Текстовий формат (розпарсити з message/text)
  if (data.message || data.text) {
    const text = (data.message || data.text).toUpperCase();
    const parsed = parseTextSignal(text);
    if (parsed) return { ...signal, ...parsed };
  }

  // Формат 4: SendPulse (subject, body)
  if (data.subject || data.body) {
    const text = (data.subject || data.body).toUpperCase();
    const parsed = parseTextSignal(text);
    if (parsed) return { ...signal, ...parsed };
  }

  return null;
}

// Парсинг тікера (наприклад: EURUSD -> EUR/USD)
function parseTicker(ticker) {
  ticker = ticker.replace(/[^A-Z]/g, '');

  // Відомі пари
  const pairs = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD',
    'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'NZDUSD'
  ];

  for (const pair of pairs) {
    if (ticker === pair) {
      return pair.slice(0, 3) + '/' + pair.slice(3);
    }
  }

  // Якщо 6 символів - розділяємо пополам
  if (ticker.length === 6) {
    return ticker.slice(0, 3) + '/' + ticker.slice(3);
  }

  return ticker;
}

// Парсинг текстового сигналу
function parseTextSignal(text) {
  const signal = {};

  // Пара (EUR/USD, EURUSD, тощо)
  const pairMatch = text.match(/([A-Z]{3}[\s\/]?[A-Z]{3})/);
  if (pairMatch) {
    const pair = pairMatch[1].replace(/\s/g, '');
    signal.pair = pair.includes('/') ? pair : pair.slice(0, 3) + '/' + pair.slice(3);
  }

  // Напрямок
  if (text.includes('BUY') || text.includes('CALL') || text.includes('🟢')) {
    signal.direction = 'CALL';
  } else if (text.includes('SELL') || text.includes('PUT') || text.includes('🔴')) {
    signal.direction = 'PUT';
  }

  // Таймфрейм (M1, M5, 1M, 5M, тощо)
  const tfMatch = text.match(/([M|H]\d+|\d+[M|H])/);
  if (tfMatch) {
    signal.timeframe = tfMatch[1];
  }

  // Час входу (12:30, 14:45, тощо)
  const timeMatch = text.match(/(\d{1,2}:\d{2})/);
  if (timeMatch) {
    signal.entryTime = timeMatch[1];
  } else {
    signal.entryTime = generateEntryTime();
  }

  if (signal.pair && signal.direction) {
    signal.timeframe = signal.timeframe || '1M';
    return signal;
  }

  return null;
}

// Генерація часу входу (через 2 хвилини)
function generateEntryTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 2);
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// HTTP сервер
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`\n📨 ${req.method} ${req.url}`);

  // GET /signals - отримати останні сигнали
  if (req.method === 'GET' && req.url === '/signals') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      count: recentSignals.length,
      signals: recentSignals
    }));
    return;
  }

  // GET /health - health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      signals: recentSignals.length
    }));
    return;
  }

  // POST /webhook - отримати новий сигнал
  if (req.method === 'POST' && req.url === '/webhook') {
    try {
      const data = await parseBody(req);
      console.log('📦 Отримано дані:', JSON.stringify(data, null, 2));

      const signal = parseSignal(data);

      if (signal && signal.pair && signal.direction) {
        console.log('✅ Сигнал розпарсено:', signal);

        // Додаємо ID
        signal.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        signal.receivedAt = new Date().toISOString();

        // Зберігаємо сигнал
        recentSignals.unshift(signal);
        if (recentSignals.length > MAX_SIGNALS) {
          recentSignals = recentSignals.slice(0, MAX_SIGNALS);
        }

        saveSignals();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Сигнал прийнято',
          signal: signal
        }));

        console.log(`💾 Збережено (всього ${recentSignals.length} сигналів)`);
      } else {
        console.log('❌ Не вдалося розпарсити сигнал');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'Не вдалося розпарсити сигнал. Потрібні поля: pair, direction'
        }));
      }
    } catch (error) {
      console.error('❌ Помилка обробки webhook:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        message: 'Помилка сервера',
        error: error.message
      }));
    }
    return;
  }

  // DELETE /signals - очистити всі сигнали
  if (req.method === 'DELETE' && req.url === '/signals') {
    recentSignals = [];
    saveSignals();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'Всі сигнали видалено'
    }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    success: false,
    message: 'Not Found'
  }));
});

// Запуск сервера
loadSignals();

server.listen(PORT, 'localhost', () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🚀 PocketOption Webhook Server запущено!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📍 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`📊 Signals API: http://localhost:${PORT}/signals`);
  console.log(`💚 Health Check: http://localhost:${PORT}/health`);
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('📖 Приклади використання:');
  console.log('\n1️⃣  Простий формат:');
  console.log(`   curl -X POST http://localhost:${PORT}/webhook \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"pair":"EUR/USD","direction":"CALL","timeframe":"1M"}'`);
  console.log('\n2️⃣  TradingView формат:');
  console.log(`   curl -X POST http://localhost:${PORT}/webhook \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"ticker":"EURUSD","action":"BUY","interval":"M5"}'`);
  console.log('\n3️⃣  Текстовий формат:');
  console.log(`   curl -X POST http://localhost:${PORT}/webhook \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"message":"EUR/USD BUY M1 at 12:30"}'`);
  console.log('\n═══════════════════════════════════════════════════════════\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Зупинка сервера...');
  saveSignals();
  server.close(() => {
    console.log('✅ Сервер зупинено');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Зупинка сервера...');
  saveSignals();
  server.close(() => {
    console.log('✅ Сервер зупинено');
    process.exit(0);
  });
});
