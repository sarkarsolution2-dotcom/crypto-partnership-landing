require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, 'uploads'),
    filename: (req, file, cb) => {
      const ts = Date.now();
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${ts}-${safe}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPG, and WebP images are allowed.'));
    }
  },
});

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function formatPhone(raw) {
  // Normalize to +91XXXXXXXXXX regardless of input format
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) {
    digits = '91' + digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = '91' + digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    // already correct
  } else if (digits.length === 13 && digits.startsWith('91')) {
    digits = digits.slice(0, 12);
  }
  return '+' + digits;
}

function escape(s) {
  // Escape MarkdownV2 special characters. Hyphen must be last in the class.
  return String(s).replace(/[_*\[\]()~`>#+=|{}.!-]/g, '\\$&');
}

async function sendToTelegram(name, phone, exchange) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[TELEGRAM] Not configured — skipping send.');
    console.log(`  Exchange: ${exchange}`);
    console.log(`  Name: ${name}`);
    console.log(`  Phone: ${phone}`);
    return;
  }

  const text =
    `📥 *New Partnership Application*\n\n` +
    `🏦 *Exchange:* ${escape(exchange)}\n` +
    `👤 *Name:* ${escape(name)}\n` +
    `📞 *Phone:* [${escape(phone)}](tel:${phone})\n` +
    `🕐 *Time:* ${escape(new Date().toISOString().replace('T', ' ').slice(0, 19))}`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'MarkdownV2',
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${data.description}`);
  return data;
}

async function sendScreenshotToTelegram(filePath, caption) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[TELEGRAM] Not configured — skipping photo send.');
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const FormData = require('form-data');
  const form = new FormData();
  form.append('chat_id', TELEGRAM_CHAT_ID);
  form.append('photo', fs.createReadStream(filePath));
  form.append('caption', caption);
  form.append('parse_mode', 'MarkdownV2');

  const res = await fetch(url, { method: 'POST', body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram sendPhoto failed: ${data.description}`);
  return data;
}

// Serve static files
app.use(express.static(__dirname));

// CORS — allow frontend from any origin (Netlify, etc.)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Submit endpoint
app.post('/submit', upload.single('screenshot'), async (req, res) => {
  try {
    const { name, phone, exchange } = req.body;
    const file = req.file;

    if (!name || !phone || !exchange) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (!file) {
      return res.status(400).json({ error: 'Screenshot is required.' });
    }

    const phoneFormatted = formatPhone(phone);

    // Forward to Telegram
    await sendToTelegram(name, phoneFormatted, exchange);

    const caption =
      `📸 *P2P Trade History*\n` +
      `👤 ${escape(name)}  ·  📞 ${escape(phoneFormatted)}  ·  🏦 ${escape(exchange)}`;
    await sendScreenshotToTelegram(file.path, caption);

    // Clean up the uploaded file
    fs.unlink(file.path, () => {});

    res.json({ ok: true });
  } catch (err) {
    console.error('[SUBMIT ERROR]', err);
    // Clean up file on error
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Submission failed. Please try again later.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[!] Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env');
  }
});