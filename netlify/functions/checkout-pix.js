const { json, readJson, buildPayload, callSunize } = require('./_sunize');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  try {
    const body = await readJson(event).catch(() => ({}));
    const customer = body.customer || {};
    const amount = Number(body.total_amount ?? body.amount ?? 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      return json(400, { error: 'invalid_amount' });
    }

    if (!customer.name || !customer.email || String(customer.document || customer.cpf || '').replace(/\D/g, '').length !== 11) {
      return json(400, { error: 'invalid_customer' });
    }

    const payload = buildPayload(body, amount);
    const result = await callSunize('/transactions', payload, 'POST');

    if (!result.ok) {
      const data = result.data || {};
      return json(result.statusCode || 502, {
        error: data.error || data.message || result.error || 'sunize_error',
        raw: data,
      });
    }

    return json(200, {
      transactionId: String(result.data.id || result.data.transactionId || payload.external_id),
      status: String(result.data.status || 'PENDING').toLowerCase(),
      raw_status: result.data.status || 'PENDING',
      amount: Number(result.data.total_amount ?? amount),
      pix: result.data.pix || {},
      customer: result.data.customer || payload.customer,
      raw: result.data,
    });
  } catch (error) {
    return json(502, {
      error: 'sunize_unreachable',
      message: error && error.message ? error.message : 'Unable to reach Sunize',
    });
  }
};
