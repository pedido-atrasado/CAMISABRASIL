import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;
const port = Number(process.env.PORT || 8000);

const apiKey = String(process.env.SUNIZE_API_KEY || process.env.CLIENT_KEY || '').trim();
const apiSecret = String(process.env.SUNIZE_API_SECRET || process.env.CLIENT_SECRET || '').trim();
const sunizeBase = 'https://api.sunize.com.br/v1';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhone(value) {
  let raw = digits(value);
  if (!raw) return '';
  if (raw.startsWith('55') && raw.length >= 12) return '+' + raw;
  if (raw.length === 10 || raw.length === 11) return '+55' + raw;
  return raw.startsWith('+') ? raw : '+' + raw;
}

function normalizeIp(value) {
  const raw = String(value || '').trim();
  if (!raw) return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  if (raw === '::1') return '127.0.0.1';
  return raw;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function createPix(req, res) {
  try {
    if (!apiKey || !apiSecret) {
      json(res, 500, { error: 'Sunize credentials not configured' });
      return;
    }

    const body = await readJson(req).catch(() => ({}));
    const customer = body.customer || {};
    const amount = Number(body.total_amount ?? body.amount ?? 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      json(res, 400, { error: 'invalid_amount' });
      return;
    }

    if (!customer.name || !customer.email || digits(customer.document || customer.cpf).length !== 11) {
      json(res, 400, { error: 'invalid_customer' });
      return;
    }

    const payload = {
      external_id: String(body.external_id || `camisabrasil-${Date.now()}`),
      total_amount: Number(amount.toFixed(2)),
      payment_method: 'PIX',
      ip: normalizeIp(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1'),
      items: [
        {
          id: 'camisa-brasil-copa-2026',
          title: 'Camisa do Brasil Copa 2026',
          description: 'Kit Camisa do Brasil Home + Away Copa 2026',
          price: Number(amount.toFixed(2)),
          quantity: 1,
          is_physical: true,
        },
      ],
      customer: {
        name: String(customer.name || '').trim(),
        email: String(customer.email || '').trim(),
        phone: normalizePhone(customer.phone || ''),
        document_type: 'CPF',
        document: digits(customer.document || customer.cpf),
      },
    };

    const response = await fetch(`${sunizeBase}/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-key': apiKey,
        'x-api-secret': apiSecret,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      json(res, response.status, { error: data.error || data.message || 'sunize_error', raw: data });
      return;
    }

    json(res, 200, {
      transactionId: String(data.id || data.transactionId || payload.external_id),
      status: String(data.status || 'PENDING').toLowerCase(),
      raw_status: data.status || 'PENDING',
      amount: Number(data.total_amount ?? amount),
      pix: data.pix || {},
      customer: data.customer || payload.customer,
      raw: data,
    });
  } catch (error) {
    json(res, 502, {
      error: 'sunize_unreachable',
      message: error && error.message ? error.message : 'Unable to reach Sunize',
    });
  }
}

async function pixStatus(req, res, url) {
  try {
    if (!apiKey || !apiSecret) {
      json(res, 500, { error: 'Sunize credentials not configured', status: 'pending' });
      return;
    }

    const transactionId = url.searchParams.get('transaction_id') || url.searchParams.get('payment_id');
    if (!transactionId) {
      json(res, 400, { error: 'transaction_id required', status: 'pending' });
      return;
    }

    const response = await fetch(`${sunizeBase}/transactions/${encodeURIComponent(transactionId)}`, {
      headers: {
        Accept: 'application/json',
        'x-api-key': apiKey,
        'x-api-secret': apiSecret,
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      json(res, response.status, { error: data.error || data.message || 'sunize_error', status: 'pending', raw: data });
      return;
    }

    json(res, 200, {
      transactionId: String(data.id || transactionId),
      status: String(data.status || 'pending').toLowerCase(),
      raw_status: data.status || 'pending',
      amount: Number(data.total_amount ?? data.amount ?? 0),
      pix: data.pix || {},
      raw: data,
    });
  } catch (error) {
    json(res, 502, {
      error: 'sunize_unreachable',
      status: 'pending',
      message: error && error.message ? error.message : 'Unable to reach Sunize',
    });
  }
}

async function serveFile(res, filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(ext) || 'application/octet-stream';
  const body = await readFile(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(body);
  return true;
}

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  const candidates = [];

  if (pathname === '/' || pathname === '') {
    candidates.push(path.join(rootDir, 'index.html'));
  } else {
    const clean = pathname.replace(/^\/+/, '');
    candidates.push(path.join(rootDir, clean));
    candidates.push(path.join(rootDir, clean, 'index.html'));
    candidates.push(path.join(rootDir, clean + '.html'));
  }

  for (const candidate of candidates) {
    try {
      if (await serveFile(res, candidate)) return;
    } catch {}
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      });
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/checkout/pix') {
      await createPix(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/pix/status') {
      await pixStatus(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`Camisa Brasil running at http://127.0.0.1:${port}/`);
  });
