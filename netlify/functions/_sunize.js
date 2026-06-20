const sunizeBase = 'https://api.sunize.com.br/v1';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhone(value) {
  const raw = digits(value);
  if (!raw) return '';
  if (raw.startsWith('55') && raw.length >= 12) return `+${raw}`;
  if (raw.length === 10 || raw.length === 11) return `+55${raw}`;
  return raw.startsWith('+') ? raw : `+${raw}`;
}

function normalizeIp(value) {
  const raw = String(value || '').trim();
  if (!raw) return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  if (raw === '::1') return '127.0.0.1';
  return raw;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function readCredentials() {
  return {
    apiKey: String(process.env.SUNIZE_API_KEY || process.env.CLIENT_KEY || '').trim(),
    apiSecret: String(process.env.SUNIZE_API_SECRET || process.env.CLIENT_SECRET || '').trim(),
  };
}

async function readJson(event) {
  if (!event.body) return {};
  if (event.isBase64Encoded) {
    const decoded = Buffer.from(event.body, 'base64').toString('utf8');
    return decoded ? JSON.parse(decoded) : {};
  }
  return event.body ? JSON.parse(event.body) : {};
}

function buildPayload(eventBody, totalAmount) {
  const customer = eventBody.customer || {};
  return {
    external_id: String(eventBody.external_id || `camisabrasil-${Date.now()}`),
    total_amount: Number(totalAmount.toFixed(2)),
    payment_method: 'PIX',
    ip: normalizeIp(
      eventBody.ip ||
      eventBody.client_ip ||
      eventBody.tracking?.ip ||
      eventBody.headers?.['x-forwarded-for'] ||
      eventBody.headers?.['X-Forwarded-For'] ||
      '127.0.0.1'
    ),
    items: Array.isArray(eventBody.items) && eventBody.items.length
      ? eventBody.items
      : [
          {
            id: 'camisa-brasil-copa-2026',
            title: 'Camisa do Brasil Copa 2026',
            description: 'Kit Camisa do Brasil Home + Away Copa 2026',
            price: Number(totalAmount.toFixed(2)),
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
}

async function callSunize(path, payload, method = 'POST') {
  const { apiKey, apiSecret } = readCredentials();
  if (!apiKey || !apiSecret) {
    return { ok: false, error: 'Sunize credentials not configured', statusCode: 500 };
  }

  const response = await fetch(`${sunizeBase}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': apiKey,
      'x-api-secret': apiSecret,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, statusCode: response.status, data };
}

module.exports = {
  json,
  readJson,
  buildPayload,
  callSunize,
  digits,
  normalizePhone,
  normalizeIp,
};
