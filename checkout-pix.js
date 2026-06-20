(function () {
  'use strict';

  var API_BASE = String(window.PAYMENTS_API_URL || '').trim().replace(/\/$/, '');
  var overlayId = 'sunize-pix-overlay';
  var activeTransactionId = '';
  var pollingTimer = null;

  function apiUrl(path) {
    if (!path) return API_BASE || '';
    if (/^https?:\/\//i.test(path)) return path;
    return API_BASE ? API_BASE + path : path;
  }

  function digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function parseBRL(value) {
    var text = String(value || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    var amount = Number(text);
    return Number.isFinite(amount) ? amount : 0;
  }

  function normalizePhone(value) {
    var raw = digits(value);
    if (!raw) return '';
    if (raw.startsWith('55') && raw.length >= 12) return '+' + raw;
    if (raw.length === 10 || raw.length === 11) return '+55' + raw;
    return raw.startsWith('+') ? raw : '+' + raw;
  }

  function inputValue(selectors) {
    for (var i = 0; i < selectors.length; i += 1) {
      var el = document.querySelector(selectors[i]);
      if (el && String(el.value || '').trim()) return String(el.value || '').trim();
    }
    for (var j = 0; j < selectors.length; j += 1) {
      var fallback = document.querySelector(selectors[j]);
      if (fallback) return String(fallback.value || '').trim();
    }
    return '';
  }

  function findInput(selectors) {
    for (var i = 0; i < selectors.length; i += 1) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function setInvalidField(input, invalid, message) {
    if (!input) return;
    input.dataset.sunizeInvalid = invalid ? 'true' : 'false';
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    input.style.borderColor = invalid ? '#ef4444' : '';
    input.style.backgroundColor = invalid ? '#fef2f2' : '';
    input.style.boxShadow = invalid ? '0 0 0 1px rgba(239,68,68,.35)' : '';
    input.title = invalid && message ? message : '';
  }

  function clearInvalidState() {
    Array.from(document.querySelectorAll('[data-sunize-invalid="true"]')).forEach(function (input) {
      setInvalidField(input, false);
    });
  }

  function attachValidationListeners() {
    var selectors = [
      'input[placeholder="João da Silva"]',
      'input[placeholder*="Silva"]',
      'input[placeholder="000.000.000-00"]',
      'input[inputmode="numeric"][maxlength="14"]',
      'input[placeholder="(00) 00000-0000"]',
      'input[inputmode="tel"]',
      'input[placeholder="voce@email.com"]',
      'input[type="email"]',
      'input[placeholder="00000-000"]',
      'input[placeholder="123"]',
      'input[placeholder="Rua, bairro"]',
      'input[placeholder="Sua cidade"]',
      'input[placeholder="SP"]',
      'input[placeholder="Apto, bloco..."]'
    ];

    selectors.forEach(function (selector) {
      var input = document.querySelector(selector);
      if (!input || input.dataset.sunizeValidationBound) return;
      input.dataset.sunizeValidationBound = 'true';
      input.addEventListener('input', function () {
        setInvalidField(input, false);
      });
      input.addEventListener('blur', function () {
        if (String(input.dataset.sunizeInvalid || '') === 'true') {
          validateCheckoutForm({ silent: true });
        }
      });
    });
  }

  function totalAmount() {
    function moneyFromText(text) {
      var match = String(text || '').match(/R\$\s*([0-9]+(?:[.,][0-9]{2})?)/);
      if (!match) return 0;
      return parseBRL(match[1]);
    }

    var payButton = Array.from(document.querySelectorAll('button')).find(function (btn) {
      var text = String(btn.textContent || '');
      return text.indexOf('Pagar') !== -1 && text.indexOf('R$') !== -1;
    });
    if (payButton) {
      var buttonAmount = moneyFromText(payButton.textContent || '');
      if (buttonAmount > 0) return buttonAmount;
    }

    var summaryText = String(document.body && document.body.innerText || '');
    var summaryAmount = moneyFromText(summaryText);
    if (summaryAmount > 0) return summaryAmount;

    return 89.40;
  }

  function selectedShipping() {
    var buttons = Array.from(document.querySelectorAll('section button'));
    var chosen = buttons.find(function (btn) {
      var text = String(btn.textContent || '');
      return text.indexOf('Frete grátis') !== -1 || text.indexOf('Expresso') !== -1 || text.indexOf('Jadlog') !== -1;
    });
    var text = chosen ? String(chosen.textContent || '') : 'Frete grátis';
    if (text.indexOf('Expresso') !== -1) return 'Expresso';
    if (text.indexOf('Jadlog') !== -1) return 'Jadlog';
    return 'Frete grátis';
  }

  function collectCustomer() {
    return {
      name: inputValue(['input[placeholder="João da Silva"]', 'input[placeholder*="Silva"]']),
      cpf: inputValue(['input[placeholder="000.000.000-00"]', 'input[inputmode="numeric"][maxlength="14"]']),
      phone: inputValue(['input[placeholder="(00) 00000-0000"]', 'input[inputmode="tel"]']),
      email: inputValue(['input[placeholder="voce@email.com"]', 'input[type="email"]']),
      cep: inputValue(['input[placeholder="00000-000"]']),
      number: inputValue(['input[placeholder="123"]']),
      street: inputValue(['input[placeholder="Rua, bairro"]']),
      city: inputValue(['input[placeholder="Sua cidade"]']),
      state: inputValue(['input[placeholder="SP"]']),
      complement: inputValue(['input[placeholder="Apto, bloco..."]']),
    };
  }

  function validateEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  function validateCheckoutForm(options) {
    var silent = !!(options && options.silent);
    var customer = collectCustomer();
    var invalid = [];
    var cpfInput = findInput(['input[placeholder="000.000.000-00"]', 'input[inputmode="numeric"][maxlength="14"]']);
    var nameInput = findInput(['input[placeholder="João da Silva"]', 'input[placeholder*="Silva"]']);
    var phoneInput = findInput(['input[placeholder="(00) 00000-0000"]', 'input[inputmode="tel"]']);
    var emailInput = findInput(['input[placeholder="voce@email.com"]', 'input[type="email"]']);
    var cepInput = findInput(['input[placeholder="00000-000"]']);
    var numberInput = findInput(['input[placeholder="123"]']);
    var noNumberInput = document.querySelector('input[type="checkbox"]');
    var streetInput = findInput(['input[placeholder="Rua, bairro"]']);
    var cityInput = findInput(['input[placeholder="Sua cidade"]']);
    var stateInput = findInput(['input[placeholder="SP"]']);
    var complementInput = findInput(['input[placeholder="Apto, bloco..."]']);

    clearInvalidState();

    function mark(input, message) {
      if (!input) return;
      setInvalidField(input, true, message);
      invalid.push({ input: input, message: message });
    }

    if (!String(customer.name || '').trim()) mark(nameInput, 'Informe seu nome completo');
    if (digits(customer.cpf).length !== 11) mark(cpfInput, 'CPF inválido');
    if (digits(customer.phone).length < 10) mark(phoneInput, 'Celular inválido');
    if (!validateEmail(customer.email)) mark(emailInput, 'E-mail inválido');
    if (digits(customer.cep).length !== 8) mark(cepInput, 'CEP inválido');
    if (!String(customer.street || '').trim()) mark(streetInput, 'Informe a rua');
    if (!String(customer.city || '').trim()) mark(cityInput, 'Informe a cidade');
    if (!String(customer.state || '').trim() || String(customer.state || '').trim().length !== 2) mark(stateInput, 'UF inválida');
    if (noNumberInput && !noNumberInput.checked && !String(customer.number || '').trim()) mark(numberInput, 'Informe o número');
    if (complementInput && String(complementInput.value || '').trim() && String(complementInput.value || '').trim().length < 1) mark(complementInput, 'Complemento inválido');

    if (!invalid.length) return { valid: true, customer: customer };

    if (!silent) {
      var first = invalid[0].input;
      if (first && first.focus) first.focus();
    }
    return { valid: false, invalid: invalid, customer: customer };
  }

  function closeOverlay() {
    var overlay = document.getElementById(overlayId);
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  function ensureOverlay() {
    var existing = document.getElementById(overlayId);
    if (existing) return existing;

    var style = document.createElement('style');
    style.textContent = [
      '#' + overlayId + '{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(2,6,23,.72);backdrop-filter:blur(10px)}',
      '#' + overlayId + '.open{display:flex}',
      '#' + overlayId + ' .sunize-modal{width:min(100%,420px);background:#fff;border-radius:24px;box-shadow:0 30px 90px rgba(0,0,0,.45);overflow:hidden;font-family:Inter,system-ui,sans-serif}',
      '#' + overlayId + ' .sunize-head{padding:18px 20px;background:linear-gradient(135deg,#ef4444,#fb7185);color:#fff}',
      '#' + overlayId + ' .sunize-body{padding:18px 20px 20px}',
      '#' + overlayId + ' h2{margin:0;font-size:22px;line-height:1.1}',
      '#' + overlayId + ' p{margin:0}',
      '#' + overlayId + ' .sunize-muted{margin-top:6px;color:#6b7280;font-size:14px;line-height:1.45}',
      '#' + overlayId + ' .sunize-grid{display:grid;grid-template-columns:1fr;gap:14px;margin-top:16px}',
      '#' + overlayId + ' .sunize-qr{display:grid;place-items:center;background:#f8fafc;border:1px solid #e5e7eb;border-radius:18px;padding:14px;min-height:260px}',
      '#' + overlayId + ' .sunize-qr img{width:240px;height:240px;object-fit:contain;border-radius:12px}',
      '#' + overlayId + ' textarea{width:100%;min-height:110px;resize:vertical;border:1px solid #d1d5db;border-radius:14px;padding:12px;font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace}',
      '#' + overlayId + ' .sunize-actions{display:flex;gap:10px;margin-top:14px}',
      '#' + overlayId + ' .sunize-actions button{flex:1;border:0;border-radius:999px;padding:12px 14px;font-weight:700}',
      '#' + overlayId + ' .primary{background:#ef4444;color:#fff}',
      '#' + overlayId + ' .secondary{background:#e5e7eb;color:#111827}',
      '#' + overlayId + ' .sunize-row{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;background:#f9fafb;border-radius:14px;font-size:14px}',
      '#' + overlayId + ' .sunize-status{font-size:14px;font-weight:700;color:#b91c1c}',
      '#' + overlayId + ' .sunize-close{position:absolute;right:14px;top:14px;width:36px;height:36px;border:0;border-radius:999px;background:rgba(255,255,255,.92);font-size:24px;line-height:1;color:#111827}'
    ].join('\n');
    document.head.appendChild(style);

    var overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.innerHTML = [
      '<div class="sunize-modal" role="dialog" aria-modal="true" aria-labelledby="sunize-title">',
      '<button class="sunize-close" type="button" aria-label="Fechar">×</button>',
      '<div class="sunize-head"><p style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.9">Pagamento Pix</p><h2 id="sunize-title">Gerando seu Pix</h2><p class="sunize-muted" style="color:rgba(255,255,255,.9)">Aguarde alguns segundos enquanto a Sunize cria a cobrança.</p></div>',
      '<div class="sunize-body">',
      '<div class="sunize-grid">',
      '<div class="sunize-row"><span>Total</span><strong data-total>R$ 0,00</strong></div>',
      '<div class="sunize-row"><span>Status</span><span class="sunize-status" data-status>Pendente</span></div>',
      '<div class="sunize-qr"><img data-qr alt="QR Code do Pix" /><p data-qr-fallback class="sunize-muted" style="display:none;text-align:center">QR Code indisponivel, use o copia e cola abaixo.</p></div>',
      '<label style="display:block"><p style="font-size:12px;font-weight:700;margin-bottom:8px;color:#374151">Copia e cola</p><textarea data-code readonly></textarea></label>',
      '</div>',
      '<div class="sunize-actions"><button class="primary" data-copy type="button">Copiar Pix</button><button class="secondary" data-close type="button">Fechar</button></div>',
      '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (event) {
      if (event.target === overlay || event.target.matches('[data-close], .sunize-close')) {
        closeOverlay();
      }
    });

    overlay.querySelector('[data-copy]').addEventListener('click', function () {
      var code = overlay.querySelector('[data-code]').value || '';
      if (code) navigator.clipboard.writeText(code).catch(function () {});
    });

    return overlay;
  }

  function openOverlay() {
    var overlay = ensureOverlay();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    return overlay;
  }

  function renderPix(data) {
    var overlay = openOverlay();
    var total = overlay.querySelector('[data-total]');
    var status = overlay.querySelector('[data-status]');
    var codeEl = overlay.querySelector('[data-code]');
    var qrEl = overlay.querySelector('[data-qr]');
    var qrFallback = overlay.querySelector('[data-qr-fallback]');

    var code = String((data && data.pix && (data.pix.payload || data.pix.code || data.pix.copyPaste)) || data.pix_payload || data.payload || '').trim();
    var qrSrc = String((data && data.pix && (data.pix.base64 || data.pix.image || data.pix.qrcode)) || data.pix_qrcode_image || data.pix_image || '').trim();

    total.textContent = 'R$ ' + totalAmount().toFixed(2).replace('.', ',');
    status.textContent = String(data.status || data.raw_status || 'pending').toLowerCase() === 'paid' ? 'Pago' : 'Aguardando';
    codeEl.value = code;

    if (qrSrc) {
      if (!/^data:image/i.test(qrSrc) && !/^https?:\/\//i.test(qrSrc)) qrSrc = 'data:image/png;base64,' + qrSrc;
      qrEl.src = qrSrc;
      qrEl.style.display = 'block';
      qrFallback.style.display = 'none';
    } else if (code) {
      qrEl.src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(code);
      qrEl.style.display = 'block';
      qrFallback.style.display = 'none';
    } else {
      qrEl.removeAttribute('src');
      qrEl.style.display = 'none';
      qrFallback.style.display = 'block';
    }

    if (activeTransactionId) {
      if (pollingTimer) clearInterval(pollingTimer);
      pollingTimer = setInterval(function () {
        fetch(apiUrl('/api/pix/status?transaction_id=' + encodeURIComponent(activeTransactionId)), {
          headers: { Accept: 'application/json' },
        })
          .then(function (response) { return response.json(); })
          .then(function (next) {
            var nextStatus = String(next.status || next.raw_status || 'pending').toLowerCase();
            status.textContent = nextStatus === 'paid' ? 'Pago' : nextStatus === 'failed' ? 'Falhou' : 'Aguardando';
            if (nextStatus === 'paid') {
              clearInterval(pollingTimer);
              pollingTimer = null;
              setTimeout(function () {
                window.location.href = '/obrigado';
              }, 900);
            }
          })
          .catch(function () {});
      }, 5000);
    }
  }

  function buildPayload() {
    var customer = collectCustomer();
    var amount = totalAmount();
    return {
      external_id: 'camisabrasil-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      total_amount: Number(amount.toFixed(2)),
      payment_method: 'PIX',
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
        name: customer.name,
        email: customer.email,
        phone: normalizePhone(customer.phone),
        document_type: 'CPF',
        document: digits(customer.cpf),
        address: {
          cep: digits(customer.cep),
          city: customer.city,
          state: customer.state,
          number: customer.number,
          street: customer.street,
          complement: customer.complement,
          neighborhood: customer.street,
        },
      },
      shipping: {
        method: selectedShipping(),
        cep: customer.cep,
        number: customer.number,
        street: customer.street,
        city: customer.city,
        state: customer.state,
        complement: customer.complement,
      },
      tracking: {
        pageUrl: window.location.href,
        title: document.title,
      },
    };
  }

  function setLoading(loading) {
    var payButton = Array.from(document.querySelectorAll('button')).find(function (btn) {
      var text = String(btn.textContent || '');
      return text.indexOf('Pagar') !== -1 && text.indexOf('R$') !== -1;
    });
    if (!payButton) return;
    payButton.disabled = !!loading;
    payButton.style.opacity = loading ? '0.75' : '';
  }

  async function payWithPix() {
    var validation = validateCheckoutForm({ silent: false });
    if (!validation.valid) {
      return;
    }

    var payload = buildPayload();
    openOverlay();
    setLoading(true);
    try {
      var response = await fetch(apiUrl('/api/checkout/pix'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });

      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || data.message || 'Nao foi possivel gerar o Pix');

      activeTransactionId = String(data.transactionId || data.transaction_id || data.id || payload.external_id);
      renderPix(data);
    } catch (error) {
      alert(error && error.message ? error.message : 'Nao foi possivel gerar o Pix');
      closeOverlay();
    } finally {
      setLoading(false);
    }
  }

  window.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!button) return;

    var text = String(button.textContent || '');
    var isPayButton = text.indexOf('Pagar') !== -1 && text.indexOf('R$') !== -1 && button.closest('.fixed');
    if (!isPayButton) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    payWithPix();
  }, true);

  attachValidationListeners();
})();
