const { json, callSunize } = require('./_sunize');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'method_not_allowed', status: 'pending' });

  try {
    const qs = event.queryStringParameters || {};
    const transactionId = qs.transaction_id || qs.payment_id;
    if (!transactionId) {
      return json(400, { error: 'transaction_id required', status: 'pending' });
    }

    const result = await callSunize(`/transactions/${encodeURIComponent(transactionId)}`, null, 'GET');

    if (!result.ok) {
      const data = result.data || {};
      return json(result.statusCode || 502, {
        error: data.error || data.message || result.error || 'sunize_error',
        status: 'pending',
        raw: data,
      });
    }

    return json(200, {
      transactionId: String(result.data.id || transactionId),
      status: String(result.data.status || 'pending').toLowerCase(),
      raw_status: result.data.status || 'pending',
      amount: Number(result.data.total_amount ?? result.data.amount ?? 0),
      pix: result.data.pix || {},
      raw: result.data,
    });
  } catch (error) {
    return json(502, {
      error: 'sunize_unreachable',
      status: 'pending',
      message: error && error.message ? error.message : 'Unable to reach Sunize',
    });
  }
};
