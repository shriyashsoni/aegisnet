(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config & state
  // ---------------------------------------------------------------------------
  var EXPLORER = 'https://sepolia.etherscan.io';
  var FAUCET = 'https://www.alchemy.com/faucets/ethereum-sepolia';
  var OPCODES = {
    1: ['OP_EXCHANGE_SWAP', 'Uniswap V3 exact input swap'],
    2: ['OP_SPLIT_ROUTE', 'Multi-pool split execution'],
    3: ['OP_VERIFY_MIN_OUTPUT', 'Onchain slippage safety verification'],
    4: ['OP_UNISWAP_V3_DIRECT', 'Direct Uniswap V3 SwapRouter02 call'],
    5: ['OP_LIQUIDITY_DEPOSIT', 'Concentrated liquidity position deposit'],
    6: ['OP_LIQUIDITY_REBALANCE', 'Range order liquidity rebalance'],
  };
  var STATUS = {
    REQUESTED: ['Submitted', 's-verified'],
    PENDING_BIOMETRICS: ['Waiting for Human Approval', 's-pending'],
    BIOMETRICS_VERIFIED: ['Approved, not executed', 's-verified'],
    EXECUTED: ['Executed', 's-executed'],
    CANCELLED: ['Cancelled', 's-cancelled'],
  };

  var state = {
    api: null,
    health: null,
    wallet: { connected: false },
    balance: null,
    myAgent: null,      // permissions of the connected wallet as an agent
    myAgents: [],       // agents the connected wallet owns (from chain events)
    requests: [],
    approval: null,     // request currently in the approval modal
    autoCancel: false,
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var Wallet = window.AegisWallet;
  var Chain = window.AegisChain;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function short(v, head, tail) {
    v = String(v || '');
    head = head || 6; tail = tail || 4;
    return v.length > head + tail + 1 ? v.slice(0, head) + '…' + v.slice(-tail) : v;
  }
  function usd(n) {
    var x = Number(n);
    if (!isFinite(x)) return '—';
    return '$' + x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  function fromWei(s) {
    try { return Number(BigInt(s) / 1000000000000n) / 1e6; } catch (e) { return Number(s) || 0; }
  }
  function timeAgo(iso) {
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(d)) return '—';
    if (d < 45) return 'just now';
    if (d < 3600) return Math.round(d / 60) + 'm ago';
    if (d < 86400) return Math.round(d / 3600) + 'h ago';
    return new Date(iso).toLocaleDateString();
  }
  var isAddress = function (v) { return /^0x[0-9a-fA-F]{40}$/.test(v || ''); };
  var isTxHash = function (v) { return /^0x[0-9a-fA-F]{64}$/.test(v || ''); };
  var same = function (a, b) { return !!a && !!b && a.toLowerCase() === b.toLowerCase(); };

  var COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg>';
  function copyBtn(value) {
    return '<button type="button" class="copy" data-copy="' + esc(value) + '" aria-label="Copy">' + COPY_ICON + '</button>';
  }
  function addrLink(addr) {
    if (!isAddress(addr)) return '<span class="addr-link">' + esc(short(addr)) + '</span>';
    return '<a class="addr-link" href="' + EXPLORER + '/address/' + addr + '" target="_blank" rel="noopener">' + short(addr) + '</a>';
  }
  function txLink(hash, label) {
    if (!isTxHash(hash)) return '<span class="hint">—</span>';
    return '<a class="addr-link" href="' + EXPLORER + '/tx/' + hash + '" target="_blank" rel="noopener">' + esc(label || short(hash, 8, 6)) + '</a>';
  }
  function pill(status) {
    var s = STATUS[status] || [status, ''];
    return '<span class="status-pill ' + s[1] + '">' + esc(s[0]) + '</span>';
  }

  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' is-' + kind : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 300);
    }, kind === 'err' ? 7000 : 4000);
  }

  function showResult(box, kind, html) {
    box.hidden = false;
    box.className = 'result' + (kind ? ' is-' + kind : '');
    box.innerHTML = html;
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.textContent = label || 'Working…';
      btn.classList.add('is-loading');
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.label || btn.textContent;
      delete btn.dataset.label;
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  }

  function formData(form) {
    var out = {};
    new FormData(form).forEach(function (v, k) { out[k] = typeof v === 'string' ? v.trim() : v; });
    return out;
  }

  /** Renders transaction progress into an <ol class="tx-steps"> */
  function txTracker(list) {
    list.hidden = false;
    list.innerHTML = '';
    var rows = {};
    return function (s) {
      var li = rows[s.label];
      if (!li) {
        li = document.createElement('li');
        rows[s.label] = li;
        list.appendChild(li);
      }
      li.className = 'is-' + s.step;
      var text = s.step === 'sign' ? 'Confirm in your wallet…'
        : s.step === 'pending' ? 'Waiting for Sepolia… ' + txLink(s.hash)
        : s.step === 'mined' ? 'Confirmed ' + txLink(s.hash)
        : esc(s.error || 'Failed');
      li.innerHTML = '<strong>' + esc(s.label) + '</strong><span>' + text + '</span>';
    };
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  function resolveApi() {
    var candidates = [];
    var override = localStorage.getItem('aegis.api');
    if (override) candidates.push(override.replace(/\/$/, ''));
    if (/^https?:$/.test(location.protocol)) candidates.push('');
    candidates.push('http://localhost:4000');

    var i = 0;
    function next() {
      if (i >= candidates.length) return Promise.reject(new Error('Backend unreachable'));
      var base = candidates[i++];
      return fetch(base + '/api/health?t=' + Date.now(), { signal: window.AbortSignal && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined })
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (health) {
          if (!health || health.status !== 'online') throw new Error();
          state.api = base;
          return health;
        })
        .catch(next);
    }
    return next();
  }

  function api(path, opts) {
    opts = opts || {};
    if (state.api === null) return Promise.reject(new Error('Backend is offline. Start it with "npm start" in /backend.'));
    return fetch(state.api + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok || data.success === false) {
          var err = new Error(data.error || ('Request failed (' + r.status + ')'));
          err.status = r.status;
          throw err;
        }
        return data;
      });
    }, function () {
      throw new Error('Could not reach the backend.');
    });
  }

  /** After a transaction: ask the backend to index the new block, then reload */
  function afterTx() {
    return api('/api/execution/refresh', { method: 'POST' }).catch(function () {}).then(function () {
      return Promise.all([loadActivity(), loadMine()]);
    });
  }

  // ---------------------------------------------------------------------------
  // Health / system
  // ---------------------------------------------------------------------------
  function setChip(online, text) {
    var chip = $('#api-chip');
    chip.classList.toggle('is-online', online);
    chip.classList.toggle('is-offline', !online);
    chip.querySelector('span').textContent = text;
  }

  function renderHealth(h) {
    state.health = h;
    setChip(true, 'Backend online');
    $('#kpi-status').innerHTML = '<span class="s-ok">● </span>Online';
    $('#kpi-network').innerHTML = h.rpcReachable ? esc(h.network) : '<span class="s-err">RPC unreachable</span>';
    $('#kpi-root').textContent = h.rootEnsName || '—';
    $('#kpi-threshold').textContent = h.biometricThresholdUSD != null ? '≥ ' + usd(h.biometricThresholdUSD) : '—';
    if (h.ai && h.ai.provider === '0g') {
      $('#kpi-ai').innerHTML = '<span class="s-ok">●</span> 0G Private Compute';
    } else {
      $('#kpi-ai').innerHTML = h.ai && h.ai.enabled ? '<span class="s-ok">●</span> ' + esc(h.ai.model) : '<span class="hint">Rules (no API key)</span>';
    }
    if ($('#kpi-approval')) {
      $('#kpi-approval').innerHTML = '<span class="s-ok" style="color:#4ade80">●</span> Human Approval Gate';
    } else if ($('#kpi-worldid')) {
      $('#kpi-worldid').innerHTML = '<span class="s-ok" style="color:#4ade80">●</span> Human Approval Gate';
    }

    // 0G Proof Panel & KPIs
    if (h.zg) {
      if (h.zg.compute && $('#zg-planner-model')) {
        $('#zg-planner-model').textContent = h.zg.compute.model || '0gm-1.0-35b-a3b';
      }
      if (h.zg.storage && $('#zg-storage-status')) {
        $('#zg-storage-status').innerHTML = '<span class="s-ok">●</span> Turbo Galileo';
      }
      var latestReq = (h.zg.compute && h.zg.compute.latestRequestId) || (h.zg.latestRecord && h.zg.latestRecord.requestId);
      if ($('#zg-req-text')) {
        $('#zg-req-text').textContent = latestReq ? esc(latestReq) : 'None recorded yet';
        $('#zg-req-copy').innerHTML = latestReq ? copyBtn(latestReq) : '';
      }
      var latestRoot = (h.zg.storage && h.zg.storage.latestRootHash) || (h.zg.latestRecord && h.zg.latestRecord.rootHash);
      if ($('#zg-root-text')) {
        $('#zg-root-text').textContent = latestRoot ? esc(short(latestRoot, 14, 10)) : 'None recorded yet';
        $('#zg-root-copy').innerHTML = latestRoot ? copyBtn(latestRoot) : '';
        if ($('#zg-scan-link')) {
          if (latestRoot) {
            $('#zg-scan-link').href = 'https://storagescan.0g.ai/file/' + encodeURIComponent(latestRoot);
            $('#zg-scan-link').hidden = false;
          } else {
            $('#zg-scan-link').hidden = true;
          }
        }
      }
    }
    var ix = h.indexer || {};
    $('#kpi-indexer').innerHTML = ix.synced ? '<span class="s-ok">●</span> Synced · block ' + esc(ix.cursor) : '<span class="s-pending">●</span> Syncing' + (ix.cursor >= 0 ? ' · ' + esc(ix.cursor) : '');
    $('#kpi-relayer').innerHTML = h.relayer.matchesContract === false
      ? '<span class="s-err">● Not the contract relayer</span>'
      : h.relayer.matchesContract ? '<span class="s-ok">●</span> ' + esc(short(h.relayer.address)) : esc(short(h.relayer.address));

    $$('[data-root]').forEach(function (el) { el.textContent = '.' + (h.rootEnsName || 'aegisnet.eth'); });

    var contracts = h.contracts || {};
    var names = Object.keys(contracts);
    $('#contracts').innerHTML = names.map(function (name) {
      return '<li><span class="name">' + esc(name) + '</span><span class="addr">' + addrLink(contracts[name]) + copyBtn(contracts[name]) + '</span></li>';
    }).join('');
    $('#contract-list').innerHTML = names.map(function (name) {
      return '<option value="' + esc(contracts[name]) + '">' + esc(name) + '</option>';
    }).join('');

    if (h.ai && h.ai.enabled) {
      var pName = h.ai.provider === '0g' ? '0G Private Compute' : 'Claude';
      $('#planner-badge').textContent = pName + (h.ai.model ? ' · ' + h.ai.model : '');
    } else {
      $('#planner-badge').textContent = 'Rule-based planner';
    }
    $('#planner-badge').classList.toggle('is-onchain', !!(h.ai && h.ai.enabled));

    renderGuard();
  }

  function renderOffline() {
    state.api = null;
    setChip(false, 'Backend offline');
    $('#kpi-status').innerHTML = '<span class="s-err">● </span>Offline';
    $('#contracts').innerHTML = '<li class="empty">Backend unreachable. Run <code>npm start</code> in <code>backend/</code>, then refresh.</li>';
    renderGuard();
  }

  function loadHealth() {
    return resolveApi().then(function (h) {
      renderHealth(h);
      loadWorldIDConfig();
      if (!Chain.ready()) {
        return api('/api/abis').then(function (abis) { Chain.init(h, abis); });
      }
    }, renderOffline);
  }

  function loadWorldIDConfig() {
    return api('/api/worldid/config').then(function (res) {
      if (res && res.success) state.worldId = res;
    }).catch(function () {});
  }

  $('#refresh-health').addEventListener('click', function () {
    var btn = this;
    busy(btn, true, 'Refreshing…');
    loadHealth().then(function () { busy(btn, false); });
  });

  // ---------------------------------------------------------------------------
  // Wallet
  // ---------------------------------------------------------------------------
  function connectWallet() {
    return Wallet.openPicker({ allowDemo: false }).then(function (res) {
      if (res && res.connected) {
        toast('Wallet connected: ' + Wallet.short(res.address), 'ok');
        if (!res.onSepolia) toast('Your wallet is not on Sepolia. Use "Switch to Sepolia".', 'err');
      }
      return res;
    });
  }

  function onWalletChange(w) {
    var changed = !same(w.address, state.wallet.address);
    state.wallet = w;
    if (changed) {
      state.myAgent = null;
      state.myAgents = [];
      state.balance = null;
      if (w.connected) {
        $$('[data-agent]').forEach(function (i) { if (!i.value || !isAddress(i.value)) i.value = w.address; });
        $('#reg-address').value = w.address;
      }
      loadMine();
    }
    renderWallet();
  }

  function renderWallet() {
    var w = state.wallet;
    var btn = $('#wallet-btn');
    btn.classList.toggle('is-connected', !!w.connected);
    btn.classList.toggle('is-wrong-net', !!w.connected && !w.onSepolia);
    btn.textContent = w.connected ? Wallet.short(w.address) : 'Connect wallet';

    var body = $('#wallet-card-body');
    var actions = $('#wallet-card-actions');
    if (w.connected) {
      var bal = state.balance;
      body.innerHTML = '<span class="kpi-label">Your wallet (owner &amp; agent)</span>' +
        '<strong class="wallet-card-title mono">' + esc(Wallet.short(w.address)) + '</strong>' +
        '<span class="net-badge' + (w.onSepolia ? '' : ' is-wrong') + '"><i></i>' +
        (w.onSepolia ? 'Sepolia' : 'Wrong network') + (bal != null ? ' · ' + bal.toFixed(4) + ' ETH' : '') + '</span>';
      actions.innerHTML = (w.onSepolia ? '' : '<button class="btn btn-solid btn-sm" type="button" data-switch-net>Switch to Sepolia</button>') +
        (w.onSepolia && bal != null && bal < 0.002 ? '<a class="btn btn-solid btn-sm" href="' + FAUCET + '" target="_blank" rel="noopener">Get Sepolia ETH</a>' : '') +
        '<button class="btn btn-ghost btn-sm" type="button" data-manage-wallet>Manage</button>';
    } else {
      body.innerHTML = '<span class="kpi-label">Wallet</span><strong class="wallet-card-title">Not connected</strong>' +
        '<p class="hint">Connect a wallet on Sepolia to start.</p>';
      actions.innerHTML = '<button class="btn btn-solid btn-sm" type="button" data-connect>Connect wallet</button>';
    }
    renderGuard();
    renderDashboard();
  }

  /** Banner explaining what's blocking the user, if anything */
  function renderGuard() {
    var g = $('#guard');
    var w = state.wallet;
    var msg = null;
    if (state.api === null && state.health === null) msg = null;
    else if (state.api === null) msg = 'The AegisNet backend is offline. Start it and reload.';
    else if (!w.connected) msg = '<strong>Connect your wallet</strong> to register an agent and trade on Sepolia. <button class="btn btn-solid btn-sm" type="button" data-connect>Connect wallet</button>';
    else if (!w.onSepolia) msg = 'Your wallet is on the wrong network. <button class="btn btn-solid btn-sm" type="button" data-switch-net>Switch to Sepolia</button>';
    else if (state.balance != null && state.balance < 0.002) msg = 'You need a little Sepolia ETH for gas. <a class="btn btn-solid btn-sm" href="' + FAUCET + '" target="_blank" rel="noopener">Get free Sepolia ETH</a>';
    g.hidden = !msg;
    g.innerHTML = msg || '';
  }

  $('#wallet-btn').addEventListener('click', function () {
    if (state.wallet.connected) Wallet.openAccount(); else connectWallet();
  });

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-connect]')) {
      e.preventDefault();
      if (state.wallet.connected) Wallet.openAccount(); else connectWallet();
    } else if (e.target.closest('[data-manage-wallet]')) {
      Wallet.openAccount();
    } else if (e.target.closest('[data-switch-net]')) {
      Wallet.ensureSepolia().then(function () { toast('Switched to Sepolia', 'ok'); }, function (err) { toast(err.message, 'err'); });
    }
  });

  Wallet.onChange(onWalletChange);

  /** Throws a friendly error if the wallet can't transact yet */
  function requireWallet() {
    if (!state.wallet.connected) throw new Error('Connect your wallet first.');
    if (!Chain.ready()) throw new Error('Still loading contract settings. Try again in a moment.');
  }

  // ---------------------------------------------------------------------------
  // "Mine": my agent identity, agents I own, balance
  // ---------------------------------------------------------------------------
  function setNode(node) {
    if (!node) return;
    $$('[data-node]').forEach(function (i) { i.value = node; });
  }

  function loadMine() {
    var w = state.wallet;
    if (!w.connected || state.api === null) { renderDashboard(); return Promise.resolve(); }
    var addr = w.address;
    return Promise.all([
      api('/api/ens/lookup/' + addr).catch(function () {
        return api('/api/ens/permissions/' + addr).then(function (r) { return r.permissions; }, function () { return null; });
      }),
      api('/api/ens/agents?owner=' + addr).then(function (r) { return r.agents; }, function () { return []; }),
      Chain.balanceOf(addr),
    ]).then(function (res) {
      if (!same(addr, state.wallet.address)) return; // wallet changed meanwhile
      state.myAgent = res[0];
      state.myAgents = res[1] || [];
      state.balance = res[2];
      if (state.myAgent && state.myAgent.isActive) setNode(state.myAgent.subnameNode || state.myAgent.node);
      else if (state.myAgents[0]) setNode(state.myAgents[0].subnameNode);
      renderWallet();
      renderAgentList();
      updateGateHint();
    });
  }

  function renderAgentList() {
    var list = $('#agent-list');
    if (!state.wallet.connected) {
      list.innerHTML = '<li class="empty">Connect your wallet to see agents you own.</li>';
      return;
    }
    if (!state.myAgents.length) {
      list.innerHTML = '<li class="empty">You don\'t own any agents yet. Register one on the left.</li>';
      return;
    }
    list.innerHTML = state.myAgents.map(function (a) {
      var you = same(a.agentAddress, state.wallet.address);
      return '<li>' +
        '<div><strong>' + esc(a.subnameFull) + '</strong> ' + (a.revoked ? '<span class="status-pill s-err">Revoked</span>' : '<span class="status-pill s-ok">Active</span>') +
        '<span class="hint">Agent ' + addrLink(a.agentAddress) + (you ? ' (this wallet)' : '') + ' · ' + timeAgo(a.registeredAt) + ' · ' + txLink(a.registeredTxHash, 'registration') + '</span></div>' +
        (a.revoked ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-use-node="' + esc(a.subnameNode) + '">Manage</button>') +
        '</li>';
    }).join('');
  }

  $('#agent-list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-use-node]');
    if (!b) return;
    setNode(b.dataset.useNode);
    toast('Agent selected. The forms below now manage it.', 'ok');
    $('#form-threshold').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('#refresh-agents').addEventListener('click', function () {
    var btn = this;
    busy(btn, true, 'Refreshing…');
    afterTx().then(function () { busy(btn, false); });
  });

  // ---------------------------------------------------------------------------
  // Agents tab: register / lookup / limits / whitelist / text / pools
  // ---------------------------------------------------------------------------
  $('#form-register').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = this, btn = form.querySelector('[type=submit]'), box = form.querySelector('[data-result]');
    var d = formData(form);
    box.hidden = true;
    try { requireWallet(); } catch (err) { return showResult(box, 'err', esc(err.message)); }
    if (!isAddress(d.agentAddress)) return showResult(box, 'err', 'Enter a valid 0x agent address.');
    var threshold = d.biometricThresholdUSD === '' ? (state.health ? state.health.biometricThresholdUSD : 1000) : Number(d.biometricThresholdUSD);
    var limit = d.dailySpendingLimitUSD === '' ? 50000 : Number(d.dailySpendingLimitUSD);

    busy(btn, true, 'Registering…');
    Chain.registerAgent({
      label: d.label.toLowerCase(),
      agent: d.agentAddress,
      thresholdUSD: threshold,
      dailyLimitUSD: limit,
    }, txTracker(form.querySelector('[data-txsteps]'))).then(function (r) {
      setNode(r.node);
      showResult(box, 'ok',
        '<div class="result-title">' + esc(d.label.toLowerCase()) + '.' + esc(state.health.rootEnsName) + ' is live onchain</div>' +
        '<dl class="kv"><dt>Node</dt><dd class="mono">' + esc(short(r.node, 10, 8)) + ' ' + copyBtn(r.node) + '</dd>' +
        '<dt>Approval at</dt><dd>≥ ' + usd(threshold) + '</dd><dt>Daily limit</dt><dd>' + usd(limit) + '</dd></dl>');
      toast('Agent registered on Sepolia', 'ok');
      return afterTx();
    }).catch(function (err) {
      showResult(box, 'err', esc(err.message));
    }).then(function () { busy(btn, false); });
  });

  function renderPermissions(p) {
    var spent = p.currentDailySpentUSD || 0;
    return '<div class="result-title">' + esc(p.subnameFull) + ' ' + (p.isActive ? '<span class="status-pill s-ok">Active</span>' : '<span class="status-pill s-err">Revoked</span>') + '</div>' +
      '<dl class="kv">' +
      '<dt>Agent</dt><dd>' + addrLink(p.agentAddress) + '</dd>' +
      '<dt>Owner</dt><dd>' + addrLink(p.ownerAddress) + '</dd>' +
      '<dt>Approval at</dt><dd>≥ ' + usd(p.biometricThresholdUSD) + '</dd>' +
      '<dt>Daily limit</dt><dd>' + usd(p.dailySpendingLimitUSD) + ' (spent ' + usd(spent) + ')</dd>' +
      '<dt>Node</dt><dd class="mono">' + esc(short(p.subnameNode, 10, 8)) + ' ' + copyBtn(p.subnameNode) + '</dd>' +
      '</dl>';
  }

  $('#form-lookup').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = this, btn = form.querySelector('[type=submit]'), box = form.querySelector('[data-result]');
    var addr = formData(form).agentAddress;
    if (!isAddress(addr)) return showResult(box, 'err', 'Enter a valid 0x agent address.');

    busy(btn, true, 'Reading chain…');
    api('/api/ens/permissions/' + addr).then(function (res) {
      showResult(box, 'ok', renderPermissions(res.permissions));
    }).catch(function (err) {
      showResult(box, err.status === 404 ? '' : 'err',
        err.status === 404 ? 'This address has no agent identity.' : esc(err.message));
    }).then(function () { busy(btn, false); });
  });

  function walletAction(btn, box, labelBusy, run, onOk) {
    box.hidden = true;
    try { requireWallet(); } catch (err) { return showResult(box, 'err', esc(err.message)); }
    busy(btn, true, labelBusy);
    run().then(function (receipt) {
      showResult(box, 'ok', onOk(receipt));
      return afterTx();
    }).catch(function (err) {
      showResult(box, 'err', esc(err.message));
    }).then(function () { busy(btn, false); });
  }

  $('#form-threshold').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = this, btn = form.querySelector('[type=submit]'), box = form.querySelector('[data-result]');
    var d = formData(form);
    if (d.thresholdUSD === '') return showResult(box, 'err', 'Enter a threshold in USD (0 turns the gate off).');
    walletAction(btn, box, 'Confirm in wallet…', function () {
      return Chain.setThreshold(d.subnameNode, Number(d.thresholdUSD));
    }, function (r) {
      return '<div class="result-title">World ID now required at ≥ ' + usd(d.thresholdUSD) + '</div><dl class="kv"><dt>Tx</dt><dd>' + txLink(r.hash) + '</dd></dl>';
    });
  });

  $('#revoke-btn').addEventListener('click', function () {
    var form = $('#form-threshold'), btn = this, box = form.querySelector('[data-result]');
    var node = formData(form).subnameNode;
    if (!node) return showResult(box, 'err', 'Pick an agent in "My agents" first.');
    if (!window.confirm('Revoke this agent? It loses all authority immediately.')) return;
    walletAction(btn, box, 'Confirm in wallet…', function () { return Chain.revoke(node); }, function (r) {
      toast('Agent revoked', 'ok');
      return '<div class="result-title">Agent revoked</div><dl class="kv"><dt>Tx</dt><dd>' + txLink(r.hash) + '</dd></dl>';
    });
  });

  $('#form-whitelist').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = this, btn = form.querySelector('[type=submit]'), box = form.querySelector('[data-result]');
    var d = formData(form);
    if (!isAddress(d.targetContract)) return showResult(box, 'err', 'Enter a valid contract address.');
    var allowed = !!d.isWhitelisted;
    walletAction(btn, box, 'Confirm in wallet…', function () {
      return Chain.setWhitelist(d.subnameNode, d.targetContract, allowed);
    }, function (r) {
      return '<div class="result-title">Contract ' + (allowed ? 'allowed' : 'blocked') + '</div><dl class="kv"><dt>Tx</dt><dd>' + txLink(r.hash) + '</dd></dl>';
    });
  });

  $('#form-text-set').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = this, btn = form.querySelector('[type=submit]'), box = form.querySelector('[data-result]');
    var d = formData(form);
    walletAction(btn, box, 'Confirm in wallet…', function () {
      return Chain.setText(d.subnameNode, d.key, d.value || '');
    }, function (r) {
      return '<div class="result-title">' + esc(d.key) + ' updated</div><dl class="kv"><dt>Tx</dt><dd>' + txLink(r.hash) + '</dd></dl>';
    });
  });

  $('#text-get').addEventListener('click', function () {
    var form = $('#form-text-set'), btn = this, box = form.querySelector('[data-result]');
    var d = formData(form);
    if (!d.subnameNode || !d.key) return showResult(box, 'err', 'Agent node and key are required.');
    busy(btn, true, 'Reading…');
    api('/api/ens/text-record/' + encodeURIComponent(d.subnameNode) + '/' + encodeURIComponent(d.key))
      .then(function (res) {
        showResult(box, 'ok', '<dl class="kv"><dt>' + esc(res.key) + '</dt><dd>' + (res.value ? esc(res.value) : '<span class="hint">empty</span>') + '</dd></dl>');
      })
      .catch(function (err) { showResult(box, 'err', esc(err.message)); })
      .then(function () { busy(btn, false); });
  });

  var ADAPTER_UNISWAP = (state.health && state.health.contracts && state.health.contracts.AegisUniswapAdapter) || '0x6383A973B4d65a48E489f22F9eD298CA7230C185';

  var btnQuickWl = $('#btn-quick-whitelist');
  if (btnQuickWl) {
    btnQuickWl.addEventListener('click', function () {
      var box = $('#whitelist-check-result');
      var node = state.myAgent ? state.myAgent.node : ($('#wl-node') ? $('#wl-node').value.trim() : '');
      if (!node) return showResult(box, 'err', 'Connect your agent wallet or enter an agent node first.');
      walletAction(this, box, 'Confirm whitelist in wallet…', function () {
        return Chain.setWhitelist(node, ADAPTER_UNISWAP, true);
      }, function (r) {
        return '<p class="s-ok">AegisUniswapAdapter whitelisted onchain.</p><p>' + txLink(r.hash) + '</p>';
      });
    });
  }

  var btnCheckWl = $('#btn-check-whitelist');
  if (btnCheckWl) {
    btnCheckWl.addEventListener('click', function () {
      var box = $('#whitelist-check-result');
      var node = state.myAgent ? state.myAgent.node : ($('#wl-node') ? $('#wl-node').value.trim() : '');
      if (!node) return showResult(box, 'err', 'Connect your agent wallet or enter an agent node first.');
      busy(this, true, 'Checking…');
      Chain.isWhitelisted(node, ADAPTER_UNISWAP)
        .then(function (allowed) {
          showResult(box, allowed ? 'ok' : 'warn',
            allowed ? '✓ AegisUniswapAdapter is whitelisted and active.'
                    : '⚠ AegisUniswapAdapter is not whitelisted for this agent yet.');
        })
        .catch(function (err) { showResult(box, 'err', esc(err.message)); })
        .then(function () { busy(btnCheckWl, false); });
    });
  }

  // ---------------------------------------------------------------------------
  // AI strategy
  // ---------------------------------------------------------------------------
  function propose(body) {
    return api('/api/agent/propose', { method: 'POST', body: body });
  }

  function renderProposal(res) {
    var p = res.proposal;
    var ops = (p.instructions || []).map(function (op) {
      var meta = OPCODES[op.opcode] || ['OP_' + op.opcode, ''];
      return '<li><span class="op-code">0x' + Number(op.opcode).toString(16).padStart(2, '0') + '</span>' +
        '<span class="op-name">' + meta[0] + '<small>' + meta[1] + '</small></span>' +
        '<span class="op-amt">min ' + fromWei(op.minAmountOut).toLocaleString() + '</span></li>';
    }).join('');
    var list = function (items, cls) {
      return items && items.length ? '<ul class="' + cls + '">' + items.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : '';
    };

    return '<div class="panel-head"><h2>Plan</h2>' +
      (p.requiresBiometric2FA ? '<span class="status-pill s-warn">Needs World ID</span>' : '<span class="status-pill s-ok">Runs automatically</span>') +
      '</div>' +
      '<p class="plan-summary"><span class="mode-pill' + (p.planner === '0g' || p.planner === 'claude' ? ' is-onchain' : '') + '">' +
        (p.planner === '0g' ? '0G Private Compute · ' + esc(p.plannerModel || '') : (p.planner === 'claude' ? 'Claude · ' + esc(p.plannerModel || '') : 'Rules')) + '</span> ' + esc(p.summary) + '</p>' +
      '<div class="route">' +
        '<div class="route-side"><span class="route-amt">' + usd(p.amountIn) + '</span><span class="route-sym">' + esc(p.tokenInSymbol) + '</span></div>' +
        '<div class="route-arrow"></div>' +
        '<div class="route-side"><span class="route-amt">' + esc(p.estimatedOutput) + '</span><span class="route-sym">' + esc(p.tokenOutSymbol) + (p.quoteSource === 'uniswap_v3' || p.quoteSource === '1inch_api' ? ' (live pool price)' : ' (estimate)') + '</span></div>' +
      '</div>' +
      list(p.rationale, 'rationale') +
      (p.riskNotes && p.riskNotes.length ? '<div class="risk"><strong>Risk notes</strong>' + list(p.riskNotes, 'rationale') + '</div>' : '') +
      '<dl class="kv" style="margin-top:16px">' +
        '<dt>Agent</dt><dd>' + (p.agentSubname ? esc(p.agentSubname) : '<span class="s-err">Not registered</span>') + '</dd>' +
        (p.zgRequestId ? '<dt>0G Request ID</dt><dd class="mono">' + esc(p.zgRequestId) + ' ' + copyBtn(p.zgRequestId) + '</dd>' : '') +
        (p.zgStorageRootHash ? '<dt>0G Storage Root</dt><dd class="mono">' + esc(short(p.zgStorageRootHash, 12, 8)) + ' ' + copyBtn(p.zgStorageRootHash) + (p.zgStorageExplorerUrl ? ' <a href="' + esc(p.zgStorageExplorerUrl) + '" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="font-size:0.75rem;padding:2px 6px;margin-left:6px;">0G Scan ↗</a>' : '') + '</dd>' : '') +
        '<dt>Onchain check</dt><dd>' + (p.authorization
          ? (p.authorization.isAllowed ? '<span class="s-ok">Authorized</span>' : '<span class="s-err">Not authorized</span>')
          : '<span class="hint">Not checked</span>') + '</dd>' +
        '<dt>Approval at</dt><dd>≥ ' + usd(p.biometricThresholdUSD) + '</dd>' +
        (p.dailyLimit ? '<dt>Daily limit</dt><dd>' + (p.dailyLimit.remainingUSD == null ? 'Unlimited'
          : (p.dailyLimit.exceeds ? '<span class="s-err">' : '') + usd(p.dailyLimit.remainingUSD) + ' left of ' + usd(p.dailyLimit.limitUSD) + (p.dailyLimit.exceeds ? ' · over the limit</span>' : '')) + '</dd>' : '') +
        '<dt>Target</dt><dd>' + addrLink(res.targetContract) + '</dd>' +
        '<dt>Calldata</dt><dd class="mono">' + esc(short(res.encodedCallData, 14, 8)) + ' ' + copyBtn(res.encodedCallData) + '</dd>' +
      '</dl>' +
      '<ul class="ops">' + ops + '</ul>' +
      '<div class="form-actions" style="margin-top:18px"><button class="btn btn-solid" type="button" id="proposal-run">Trade this plan</button></div>';
  }

  $('#form-propose').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = this, btn = form.querySelector('[type=submit]');
    var d = formData(form);
    if (!isAddress(d.agentAddress)) return toast('Enter a valid 0x agent address.', 'err');

    var planningText = state.health && state.health.ai && state.health.ai.provider === '0g'
      ? '0G Private Compute is planning…'
      : (state.health && state.health.ai && state.health.ai.enabled ? 'Claude is planning…' : 'Planning…');
    busy(btn, true, planningText);
    propose(d).then(function (res) {
      var panel = $('#proposal');
      panel.innerHTML = renderProposal(res);
      $('#proposal-run').addEventListener('click', function () {
        $('#ex-goal').value = d.goalPrompt;
        $('#ex-amount').value = d.amountUSD;
        location.hash = '#execute';
        updateGateHint();
      });
    }).catch(function (err) {
      var panel = $('#proposal');
      panel.innerHTML = '<div class="panel-head"><h2>Plan Failed Safe</h2><span class="status-pill s-err">Fail-Safe Active</span></div>' +
        '<div class="risk" style="margin-top:12px"><strong>0G Decentralized Guardrail Notice</strong><p style="margin-top:6px;color:#f87171">' + esc(err.message) + '</p>' +
        '<p class="hint" style="margin-top:8px">Under AegisNet fail-safe protocol, no speculative or fake trade decisions are generated when 0G Private Compute or 0G Storage cannot cryptographically verify the route.</p></div>';
      toast(err.message, 'err');
    }).then(function () { busy(btn, false); });
  });

  // ---------------------------------------------------------------------------
  // Trade pipeline (wallet signs as the agent)
  // ---------------------------------------------------------------------------
  var STEPS = ['identity', 'strategy', 'submit', 'gate', 'execute'];

  function setStep(name, cls) {
    var li = $('#pipeline [data-step="' + name + '"]');
    li.className = cls ? 'is-' + cls : '';
  }
  function resetPipeline() {
    STEPS.forEach(function (s) { setStep(s, ''); });
    $('#exec-result').hidden = true;
    $('#exec-state').hidden = true;
  }
  function setExecState(status) {
    var el = $('#exec-state');
    var s = STATUS[status] || [status, ''];
    el.hidden = false;
    el.className = 'status-pill ' + s[1];
    el.textContent = s[0];
  }
  function failActive(message) {
    var active = $('#pipeline li.is-active');
    if (active) active.className = 'is-fail';
    showResult($('#exec-result'), 'err', esc(message));
  }

  function updateGateHint() {
    var hint = $('#gate-hint');
    var a = state.myAgent;
    var amount = parseFloat($('#ex-amount').value);
    if (!state.wallet.connected) { hint.textContent = 'Connect your wallet to see your agent\'s approval threshold.'; return; }
    if (!a || !a.isActive) { hint.innerHTML = 'Your wallet isn\'t a registered agent yet. <a class="addr-link" href="#agents">Register it</a> first.'; return; }
    var t = a.biometricThresholdUSD;
    var txt = esc(a.subnameFull) + ' · World ID needed at ≥ ' + usd(t) + '.';
    if (isFinite(amount)) txt += amount >= t && t > 0 ? ' This trade will pause for your approval.' : ' This trade runs automatically.';
    hint.innerHTML = txt;
  }
  $('#ex-amount').addEventListener('input', updateGateHint);
  $$('#amount-chips [data-amount]').forEach(function (b) {
    b.addEventListener('click', function () { $('#ex-amount').value = b.dataset.amount; updateGateHint(); });
  });

  function showExecResult(title, fields, kind) {
    showResult($('#exec-result'), kind == null ? 'ok' : kind,
      '<div class="result-title">' + esc(title) + '</div><dl class="kv">' + fields.map(function (f) {
        return '<dt>' + esc(f[0]) + '</dt><dd>' + f[1] + '</dd>';
      }).join('') + '</dl>');
  }

  $('#form-execute').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = this, btn = form.querySelector('[type=submit]');
    var d = formData(form);
    resetPipeline();

    try { requireWallet(); } catch (err) { return toast(err.message, 'err'); }
    var agent = state.wallet.address;
    var amount = Number(d.amountUSD);

    busy(btn, true, 'Working…');
    setStep('identity', 'active');

    Promise.resolve(state.myAgent ? state.myAgent : loadMine().then(function () { return state.myAgent; })).then(function (me) {
      if (!me || !me.isActive) throw new Error('Your wallet is not a registered, active agent. Register it in the Agents tab first.');
      setStep('identity', 'done');
      setStep('strategy', 'active');
      return propose({ agentAddress: agent, goalPrompt: d.goalPrompt || 'Swap USDC to ETH at the best price', amountUSD: amount });
    }).then(function (res) {
      if (res.proposal.authorization && !res.proposal.authorization.isAllowed) {
        throw new Error('The onchain check failed: the Uniswap adapter is not whitelisted for this agent.');
      }
      var dl = res.proposal.dailyLimit;
      if (dl && dl.exceeds) {
        throw new Error('Blocked: this trade is over your agent\'s daily limit. Only ' + usd(dl.remainingUSD) + ' of ' + usd(dl.limitUSD) + ' is left today, so the contract would reject it.');
      }
      setStep('strategy', 'done');
      setStep('submit', 'active');
      var pLabel = res.proposal.planner === '0g' ? ('0G (' + (res.proposal.plannerModel || '0gm-1.0-35b-a3b') + ')') : (res.proposal.planner === 'claude' ? 'Claude' : 'Rules');
      showExecResult('Plan: ' + res.proposal.summary, [['Planner', pLabel]], '');
      return Chain.requestExecution(res.targetContract, res.encodedCallData, amount, function (s) {
        if (s.step === 'sign') btn.textContent = 'Confirm in wallet…';
        if (s.step === 'pending') btn.textContent = 'Waiting for Sepolia…';
      }).then(function (out) { out.proposal = res.proposal; return out; });
    }).then(function (out) {
      setStep('submit', 'done');
      var fields = [
        ['Request', '<span class="mono">' + esc(short(out.requestId, 12, 6)) + '</span> ' + copyBtn(out.requestId)],
        ['Value', usd(amount)],
        ['Tx', txLink(out.txHash)],
      ];
      if (out.requiresBiometrics) {
        setStep('gate', 'wait');
        setExecState('PENDING_BIOMETRICS');
        showExecResult('Paused onchain: waiting for Human Approval', fields, '');
        var req = { requestId: out.requestId, valueUSD: amount, agentSubname: state.myAgent.subnameFull, agentAddress: agent, ownerAddress: state.myAgent.ownerAddress };
        state.approval = req;
        if (state.autoCancel) {
          state.autoCancel = false;
          toast('Trade paused onchain. Now cancel it as the owner.');
          setTimeout(function () { cancelTrade(req.requestId); }, 900);
        } else {
          openApproval(req);
        }
      } else {
        setStep('gate', 'skip');
        setStep('execute', out.executed ? 'done' : 'fail');
        setExecState(out.executed ? 'EXECUTED' : 'REQUESTED');
        showExecResult(out.executed ? 'Executed onchain without approval (under the threshold)' : 'Submitted', fields);
        toast('Trade executed on Sepolia', 'ok');
      }
      return afterTx();
    }).catch(function (err) {
      state.autoCancel = false;
      failActive(err.message);
      toast(err.message, 'err');
    }).then(function () { busy(btn, false); });
  });

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Human Approval Gate & World ID Agent Pass 2FA
  // ---------------------------------------------------------------------------
  var modal = $('#worldid-modal');
  var approvalTimer = null;

  function renderApprovalBanner(status, message) {
    var banner = $('#wid-status-banner');
    if (!banner) return;
    if (!status) {
      banner.hidden = true;
      banner.innerHTML = '';
      return;
    }
    banner.hidden = false;
    if (status === 'denied') {
      banner.style.background = 'rgba(239, 68, 68, 0.12)';
      banner.style.color = '#f87171';
      banner.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      banner.innerHTML = '<strong>DENIED:</strong> ' + esc(message || 'Trade denied by human approver. Autonomous agent blocked from moving funds.');
    } else if (status === 'expired') {
      banner.style.background = 'rgba(245, 158, 11, 0.12)';
      banner.style.color = '#fbbf24';
      banner.style.border = '1px solid rgba(245, 158, 11, 0.3)';
      banner.innerHTML = '<strong>EXPIRED:</strong> ' + esc(message || '15-minute approval window elapsed. Trade is permanently blocked from execution.');
    } else if (status === 'cancelled') {
      banner.style.background = 'rgba(161, 161, 170, 0.12)';
      banner.style.color = '#d4d4d8';
      banner.style.border = '1px solid rgba(161, 161, 170, 0.3)';
      banner.innerHTML = '<strong>CANCELLED:</strong> ' + esc(message || 'Execution request cancelled on-chain.');
    } else if (status === 'approved') {
      banner.style.background = 'rgba(34, 197, 94, 0.12)';
      banner.style.color = '#4ade80';
      banner.style.border = '1px solid rgba(34, 197, 94, 0.3)';
      banner.innerHTML = '<strong>APPROVED:</strong> ' + esc(message || 'Human verified via World ID Agent Pass. Trade executed on Sepolia.');
    }
  }

  function openApproval(req) {
    state.approval = req;
    renderApprovalBanner(null);
    if (approvalTimer) clearInterval(approvalTimer);

    var wid = state.worldId || {};
    var mode = wid.mode || 'cloud';
    var hasProof = !!(wid.proofOfOwnership && wid.proofOfOwnership.verified) || !!(state.health && state.health.worldId && state.health.worldId.proofOfOwnership && state.health.worldId.proofOfOwnership.verified);
    var orbCommitment = (wid.proofOfOwnership && wid.proofOfOwnership.orbCommitment) || (state.health && state.health.worldId && state.health.worldId.proofOfOwnership && state.health.worldId.proofOfOwnership.orbCommitment) || '';

    if ($('#wid-mode-badge')) {
      $('#wid-mode-badge').textContent = hasProof ? '● World ID Orb Proof of Ownership (Verified Human)' : '● World ID Agent Pass (Human Checkpoint)';
      if (hasProof) $('#wid-mode-badge').style.color = '#c084fc';
    }

    $('#wid-prompt').textContent = 'A ' + usd(req.valueUSD) + ' trade by ' + (req.agentSubname || short(req.agentAddress)) +
      ' is paused onchain. Authorize it via World ID Agent Pass to approve.';
    $('#wid-meta').innerHTML =
      '<dt>Request</dt><dd class="mono">' + esc(short(req.requestId, 12, 6)) + '</dd>' +
      '<dt>Trade Value</dt><dd>' + usd(req.valueUSD) + '</dd>' +
      '<dt>Agent</dt><dd>' + esc(req.agentSubname || short(req.agentAddress)) + '</dd>' +
      '<dt>Security Gate</dt><dd class="mono" style="color:#c084fc">' + (hasProof ? 'World ID Orb Proof of Ownership (' + esc(orbCommitment.slice(0, 8) + '…' + orbCommitment.slice(-6)) + ')' : 'World ID Agent Pass (OIDC Human Checkpoint)') + '</dd>';
    $('#wid-steps').hidden = true;
    $('#wid-steps').innerHTML = '';
    $('#wid-verify').textContent = hasProof ? 'Authorize with Verified World ID' : 'Verify Human with Agent Pass';
    $('#wid-hint').innerHTML = hasProof
      ? 'Validated against authentic cryptographic World ID Orb proof of ownership. Relayer signs single-use attestation bound on Sepolia.'
      : 'Verifies proof of humanity server-side per auth.world.org guidelines and signs relayer attestation over (requestId, nullifier, deadline).';
    $('#wid-verify').disabled = false;
    if ($('#wid-deny')) $('#wid-deny').disabled = false;
    $('#wid-cancel').disabled = false;
    modal.hidden = false;

    // Create Agent Pass session on backend
    api('/api/worldid/session', {
      method: 'POST',
      body: { requestId: req.requestId }
    }).then(function (session) {
      state.approvalSession = session;
      var deadline = session.deadline || (Math.floor(Date.now() / 1000) + 900);

      var updateCountdown = function () {
        var now = Math.floor(Date.now() / 1000);
        var left = deadline - now;
        if ($('#wid-expiry-badge')) {
          if (left <= 0) {
            $('#wid-expiry-badge').textContent = 'EXPIRED';
            $('#wid-expiry-badge').style.color = '#ef4444';
            renderApprovalBanner('expired');
            $('#wid-verify').disabled = true;
            if ($('#wid-deny')) $('#wid-deny').disabled = true;
            clearInterval(approvalTimer);
          } else {
            var m = Math.floor(left / 60);
            var s = left % 60;
            $('#wid-expiry-badge').textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
          }
        }
      };
      updateCountdown();
      approvalTimer = setInterval(updateCountdown, 1000);
    }).catch(function (err) {
      console.warn('Could not initialize Agent Pass session:', err);
    });
  }

  function closeApproval() {
    modal.hidden = true;
    if (approvalTimer) {
      clearInterval(approvalTimer);
      approvalTimer = null;
    }
  }
  $$('[data-close]', modal).forEach(function (el) { el.addEventListener('click', closeApproval); });

  function attest(requestId, result) {
    var nullifier = (result && result.nullifier_hash) || ('0x' + Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(32)), function (b) { return b.toString(16).padStart(2, '0'); }).join(''));
    return api('/api/worldid/attest', {
      method: 'POST',
      body: {
        requestId: requestId,
        nullifier_hash: nullifier,
        proof: result && result.proof,
        merkle_root: result && result.merkle_root,
        verification_level: result && result.verification_level,
      },
    });
  }

  /** Attestation → wallet records approval & executes trade */
  function finishApproval(req, att) {
    var track = txTracker($('#wid-steps'));
    $('#wid-verify').disabled = true;
    if ($('#wid-deny')) $('#wid-deny').disabled = true;
    $('#wid-cancel').disabled = true;
    setStep('gate', 'active');

    return Chain.submitApproval(req.requestId, att.nullifierHash, att.deadline, att.signature, track).then(function (receipt) {
      setStep('gate', 'done');
      setStep('execute', 'done');
      setExecState('EXECUTED');
      renderApprovalBanner('approved', 'World ID Agent Pass attestation accepted on Sepolia. Trade executed.');
      toast('Approved via World ID Agent Pass and executed on Sepolia', 'ok');
      showExecResult('Approved via World ID Agent Pass and executed onchain', [
        ['Request', '<span class="mono">' + esc(short(req.requestId, 12, 6)) + '</span>'],
        ['Value', usd(req.valueUSD)],
        ['Execution tx', txLink(receipt.hash)],
      ]);
      setTimeout(closeApproval, 2500);
      return afterTx();
    }).catch(function (err) {
      failActive(err.message);
      toast(err.message, 'err');
      $('#wid-verify').disabled = false;
      if ($('#wid-deny')) $('#wid-deny').disabled = false;
      $('#wid-cancel').disabled = false;
      return afterTx();
    });
  }

  $('#wid-verify').addEventListener('click', function () {
    var req = state.approval;
    if (!req) return;
    try { requireWallet(); } catch (err) { return toast(err.message, 'err'); }
    var btn = this;
    var session = state.approvalSession;

    busy(btn, true, 'Verifying Agent Pass…');

    if (session && session.sessionId) {
      api('/api/worldid/verify', {
        method: 'POST',
        body: { sessionId: session.sessionId }
      }).then(function (att) {
        busy(btn, false);
        toast('World ID Agent Pass verified', 'ok');
        return finishApproval(req, att);
      }).catch(function (err) {
        busy(btn, false);
        toast(err.message, 'err');
      });
    } else {
      attest(req.requestId, {}).then(function (att) {
        busy(btn, false);
        toast('Human approval attested', 'ok');
        return finishApproval(req, att);
      }).catch(function (err) {
        busy(btn, false);
        toast(err.message, 'err');
      });
    }
  });

  if ($('#wid-deny')) {
    $('#wid-deny').addEventListener('click', function () {
      var req = state.approval;
      if (!req) return;
      var btn = this;
      var session = state.approvalSession;

      if (session && session.sessionId) {
        busy(btn, true, 'Denying…');
        api('/api/worldid/deny', {
          method: 'POST',
          body: { sessionId: session.sessionId, reason: 'Human operator denied high-value trade proposal' }
        }).then(function () {
          busy(btn, false);
          renderApprovalBanner('denied');
          $('#wid-verify').disabled = true;
          $('#wid-deny').disabled = true;
          setStep('gate', 'fail');
          setStep('execute', 'skip');
          setExecState('DENIED');
          toast('Trade explicitly denied by human approver. Agent blocked.', 'warn');
          showExecResult('Trade Denied by Human Approver. Protected action did NOT occur.', [
            ['Request', '<span class="mono">' + esc(short(req.requestId, 12, 6)) + '</span>'],
            ['Status', '<span style="color:#ef4444;font-weight:bold;">DENIED</span>'],
            ['Outcome', 'Funds remain 100% untouched. Autonomous agent blocked.'],
          ], 'err');
        }).catch(function (err) {
          busy(btn, false);
          toast(err.message, 'err');
        });
      } else {
        renderApprovalBanner('denied');
        $('#wid-verify').disabled = true;
        $('#wid-deny').disabled = true;
        setStep('gate', 'fail');
        setStep('execute', 'skip');
        setExecState('DENIED');
        toast('Trade denied. Agent blocked.', 'warn');
      }
    });
  }

  function cancelTrade(requestId, btn) {
    try { requireWallet(); } catch (err) { return toast(err.message, 'err'); }
    busy(btn, true, 'Confirm in wallet…');
    return Chain.cancel(requestId).then(function (receipt) {
      toast('Trade cancelled onchain', 'ok');
      if (state.approval && state.approval.requestId === requestId) {
        renderApprovalBanner('cancelled');
        setStep('gate', 'fail');
        setStep('execute', 'skip');
        setExecState('CANCELLED');
        showExecResult('Cancelled by the owner. The funds never moved.', [['Cancel tx', txLink(receipt.hash)]], 'err');
        setTimeout(closeApproval, 2000);
      }
      return afterTx();
    }).catch(function (err) {
      toast(err.message, 'err');
    }).then(function () { busy(btn, false); });
  }

  $('#wid-cancel').addEventListener('click', function () {
    if (state.approval) cancelTrade(state.approval.requestId, this);
  });

  function executeApproved(requestId, btn) {
    try { requireWallet(); } catch (err) { return toast(err.message, 'err'); }
    busy(btn, true, 'Confirm in wallet…');
    Chain.executeVerified(requestId).then(function () {
      toast('Executed on Sepolia', 'ok');
      return afterTx();
    }).catch(function (err) { toast(err.message, 'err'); }).then(function () { busy(btn, false); });
  }

  // ---------------------------------------------------------------------------
  // Activity (from chain events)
  // ---------------------------------------------------------------------------
  function mineFilter(r) {
    var me = state.wallet.address;
    return same(r.agentAddress, me) || same(r.ownerAddress, me);
  }

  function actionsFor(r) {
    var me = state.wallet.address;
    var canCancel = same(r.agentAddress, me) || same(r.ownerAddress, me);
    if (r.status === 'PENDING_BIOMETRICS') {
      return '<button class="btn btn-solid btn-sm" data-approve="' + esc(r.requestId) + '">Approve</button>' +
        (canCancel ? '<button class="btn btn-ghost btn-danger btn-sm" data-cancel="' + esc(r.requestId) + '">Cancel</button>' : '');
    }
    if (r.status === 'BIOMETRICS_VERIFIED') {
      return '<button class="btn btn-solid btn-sm" data-execute="' + esc(r.requestId) + '">Execute</button>' +
        (canCancel ? '<button class="btn btn-ghost btn-danger btn-sm" data-cancel="' + esc(r.requestId) + '">Cancel</button>' : '');
    }
    return '';
  }

  function renderActivity() {
    var onlyMine = $('#only-mine').checked && state.wallet.connected;
    var list = onlyMine ? state.requests.filter(mineFilter) : state.requests;
    var pendingMine = state.requests.filter(function (r) { return r.status === 'PENDING_BIOMETRICS' && mineFilter(r); }).length;
    var count = $('#nav-count');
    count.hidden = !pendingMine;
    count.textContent = pendingMine;

    var body = $('#activity-body');
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">' + (onlyMine ? 'No trades from your agents yet. Run one from <a class="addr-link" href="#execute">Trade</a>.' : 'No trades on the contract yet.') + '</td></tr>';
    } else {
      body.innerHTML = list.map(function (r) {
        var txs = [txLink(r.txHash, 'request'), r.verificationTxHash ? txLink(r.verificationTxHash, 'approval') : '',
          r.executionTxHash && r.executionTxHash !== r.txHash ? txLink(r.executionTxHash, 'execution') : '',
          r.cancelTxHash ? txLink(r.cancelTxHash, 'cancel') : ''].filter(Boolean).join(' · ');
        var zgCell = r.zgStorageRootHash
          ? '<span class="mono" title="' + esc(r.zgStorageRootHash) + '">' +
            esc(short(r.zgStorageRootHash, 8, 6)) + ' ' + copyBtn(r.zgStorageRootHash) +
            ' <a class="btn btn-ghost btn-sm" href="https://storagescan.0g.ai/file/' + encodeURIComponent(r.zgStorageRootHash) + '" target="_blank" rel="noopener" style="font-size:0.75rem;padding:2px 4px;margin-left:4px;">0G</a></span>'
          : '<span class="hint">—</span>';
        return '<tr>' +
          '<td class="mono" title="' + esc(r.requestId) + '">' + esc(short(r.requestId, 10, 6)) + ' ' + copyBtn(r.requestId) + '</td>' +
          '<td>' + (r.agentSubname ? esc(r.agentSubname) : addrLink(r.agentAddress)) + '</td>' +
          '<td>' + usd(r.valueUSD) + '</td>' +
          '<td>' + pill(r.status) + '</td>' +
          '<td>' + zgCell + '</td>' +
          '<td>' + txs + '</td>' +
          '<td class="hint" title="' + esc(r.updatedAt) + '">' + timeAgo(r.updatedAt) + '</td>' +
          '<td><div class="row-actions">' + actionsFor(r) + '</div></td>' +
        '</tr>';
      }).join('');
    }
    renderDashboard();
  }

  function loadActivity() {
    if (state.api === null) return Promise.resolve();
    return api('/api/execution/requests').then(function (res) {
      state.requests = res.requests || [];
      if (state.health) state.health.indexer = res.indexer;
      renderActivity();
    }).catch(function (err) {
      if (!err.status) renderOffline();
    });
  }

  function onRowAction(e) {
    var a = e.target.closest('[data-approve]');
    var c = e.target.closest('[data-cancel]');
    var x = e.target.closest('[data-execute]');
    var find = function (id) { return state.requests.filter(function (r) { return r.requestId === id; })[0]; };
    if (a) {
      var r = find(a.dataset.approve);
      if (r) openApproval(r);
    } else if (c) {
      cancelTrade(c.dataset.cancel, c);
    } else if (x) {
      executeApproved(x.dataset.execute, x);
    }
  }
  $('#activity-body').addEventListener('click', onRowAction);
  $('#approvals').addEventListener('click', onRowAction);
  $('#only-mine').addEventListener('change', renderActivity);
  $('#refresh-activity').addEventListener('click', function () {
    var btn = this;
    busy(btn, true, 'Refreshing…');
    afterTx().then(function () { busy(btn, false); });
  });

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  var SCENARIOS = {
    small: { amount: 250, goal: 'Rebalance the treasury: swap USDC to ETH' },
    big: { amount: 2500, goal: 'Swap USDC to ETH at the best price' },
    whale: { amount: 25000, goal: 'Large USDC to ETH swap, minimize slippage' },
    stop: { amount: 3000, goal: 'Swap USDC to ETH', autoCancel: true },
  };

  function runScenario(key) {
    var sc = SCENARIOS[key];
    if (!sc) return;
    if (!state.wallet.connected) { toast('Connect your wallet first.', 'err'); return connectWallet(); }
    if (!state.myAgent || !state.myAgent.isActive) {
      toast('Register your wallet as an agent first (step 2).', 'err');
      return gotoRegister();
    }
    var t = state.myAgent.biometricThresholdUSD;
    if ((key === 'big' || key === 'whale' || key === 'stop') && !(t > 0 && sc.amount >= t)) {
      toast('Your approval threshold is ' + usd(t) + ', so this trade won\'t pause. Lower it in "Limits & kill switch" to see the World ID gate.', 'err');
    }
    $('#ex-goal').value = sc.goal;
    $('#ex-amount').value = sc.amount;
    state.autoCancel = !!sc.autoCancel;
    location.hash = '#execute';
    updateGateHint();
    setTimeout(function () { $('#form-execute').requestSubmit(); }, 350);
  }

  function gotoRegister() {
    if (state.wallet.connected) $('#reg-address').value = state.wallet.address;
    if (!$('#reg-label').value) $('#reg-label').value = 'agent' + Math.floor(Math.random() * 9000 + 1000);
    location.hash = '#agents';
    setTimeout(function () { $('#reg-label').focus(); }, 60);
  }

  document.addEventListener('click', function (e) {
    var sc = e.target.closest('[data-scenario]');
    if (sc) { e.preventDefault(); return runScenario(sc.dataset.scenario); }
    if (e.target.closest('[data-goto-register]')) { e.preventDefault(); return gotoRegister(); }
    if (e.target.closest('[data-goto-killswitch]')) {
      e.preventDefault();
      location.hash = '#agents';
      setTimeout(function () { $('#form-threshold').scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
    }
  });

  function renderDashboard() {
    var w = state.wallet;
    var me = state.myAgent;
    var mine = state.requests.filter(function (r) { return same(r.agentAddress, w.address); });

    var done = {
      wallet: !!w.connected && !!w.onSepolia && (state.balance == null || state.balance > 0),
      identity: !!(me && me.isActive),
      small: mine.some(function (r) { return r.status === 'EXECUTED' && !r.requiresBiometrics; }),
      big: mine.some(function (r) { return r.status === 'EXECUTED' && r.requiresBiometrics; }),
      stop: mine.some(function (r) { return r.status === 'CANCELLED'; }),
    };
    var nextSet = false;
    $$('#demo-steps [data-step]').forEach(function (li) {
      var k = li.dataset.step;
      li.classList.toggle('is-done', !!done[k]);
      var isNext = !nextSet && !done[k];
      li.classList.toggle('is-next', isNext);
      if (isNext) nextSet = true;
    });
    $('#step-wallet-text').innerHTML = w.connected
      ? (w.onSepolia ? 'Connected as ' + esc(short(w.address)) + (state.balance != null ? ' with ' + state.balance.toFixed(4) + ' Sepolia ETH.' : '.') : 'Connected, but on the wrong network. Switch to Sepolia.')
      : 'You are the owner. You need a little Sepolia test ETH for gas.';
    $('#step-identity-text').innerHTML = me && me.isActive
      ? 'Your wallet is <strong>' + esc(me.subnameFull) + '</strong>, approval at ≥ ' + usd(me.biometricThresholdUSD) + ', daily limit ' + usd(me.dailySpendingLimitUSD) + '.'
      : 'Register an ENS name for your agent with a daily limit and an approval threshold. Three wallet confirmations.';
    if (me) $('#step-big-text').innerHTML = 'The agent tries $2,500. At or above your <strong>' + usd(me.biometricThresholdUSD) + '</strong> threshold it pauses onchain until you verify with World ID.';

    // My agent card
    var card = $('#agent-card');
    var pillEl = $('#agent-status');
    if (!w.connected) {
      pillEl.hidden = true;
      card.innerHTML = '<p class="hint">Connect your wallet to see your agent.</p>';
    } else if (me) {
      var spent = me.currentDailySpentUSD || 0;
      var limit = me.dailySpendingLimitUSD || 0;
      var pct = limit ? Math.min(100, (spent / limit) * 100) : 0;
      pillEl.hidden = false;
      pillEl.className = 'status-pill ' + (me.isActive ? 's-ok' : 's-err');
      pillEl.textContent = me.isActive ? 'Active' : 'Revoked';
      var records = me.textRecords || {};
      var proofBadge = '';
      if (records['agent.proof_of_ownership']) {
        var commitment = records['agent.proof_of_ownership'];
        proofBadge = '<dt>World ID Verification</dt><dd><span class="status-pill s-ok" style="font-size:11px;border-color:#a855f7;color:#d8b4fe">● Orb-Verified Human</span> <span class="mono hint" title="' + esc(commitment) + '">' + esc(commitment.slice(0, 6) + '…' + commitment.slice(-4)) + '</span></dd>';
      } else if (state.health && state.health.worldId && state.health.worldId.proofOfOwnership) {
        var c = state.health.worldId.proofOfOwnership.orbCommitment || '';
        proofBadge = '<dt>World ID Verification</dt><dd><span class="status-pill s-ok" style="font-size:11px;border-color:#a855f7;color:#d8b4fe">● Orb-Verified Human</span> <span class="mono hint">' + esc(c.slice(0, 6) + '…' + c.slice(-4)) + '</span></dd>';
      }
      var storageBadge = '';
      if (records['agent.storage_root']) {
        var root = records['agent.storage_root'];
        storageBadge = '<dt>0G Storage Audit</dt><dd><span class="mono hint" title="' + esc(root) + '">' + esc(root.slice(0, 8) + '…' + root.slice(-6)) + '</span></dd>';
      }

      card.innerHTML = '<dl class="kv">' +
        '<dt>ENSv2 Identity</dt><dd><strong>' + esc(me.subnameFull) + '</strong></dd>' +
        '<dt>Agent Address</dt><dd>' + addrLink(me.agentAddress) + ' <span class="hint">(this wallet)</span></dd>' +
        '<dt>Owner Address</dt><dd>' + addrLink(me.ownerAddress) + '</dd>' +
        '<dt>Human Approval Gate</dt><dd>≥ ' + usd(me.biometricThresholdUSD) + '</dd>' +
        proofBadge +
        storageBadge +
        '</dl>' +
        '<div class="agent-limit"><div class="agent-limit-top"><span>Spent today</span><span>' + usd(spent) + ' of ' + usd(limit) + '</span></div>' +
        '<div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div></div>' +
        '<div class="form-actions" style="margin-top:14px"><a class="btn btn-ghost btn-sm" href="#agents" data-goto-killswitch>Change limits or revoke</a></div>';
    } else {
      pillEl.hidden = false; pillEl.className = 'status-pill s-pending'; pillEl.textContent = 'Not registered';
      card.innerHTML = '<p class="hint">Your wallet has no agent identity yet. Register it to trade from this console.</p>' +
        '<div class="form-actions" style="margin-top:14px"><button class="btn btn-solid btn-sm" type="button" data-goto-register>Register agent</button></div>';
    }

    // Stats (my agents) + approvals
    var set = w.connected ? state.requests.filter(mineFilter) : state.requests;
    var count = function (s) { return set.filter(function (r) { return r.status === s; }).length; };
    $('#dash-stats').innerHTML =
      '<div class="stat-box"><b>' + set.length + '</b><span>' + (w.connected ? 'My trades' : 'All trades') + '</span></div>' +
      '<div class="stat-box"><b class="s-ok">' + count('EXECUTED') + '</b><span>Executed</span></div>' +
      '<div class="stat-box"><b class="s-pending">' + (count('PENDING_BIOMETRICS') + count('BIOMETRICS_VERIFIED')) + '</b><span>Waiting</span></div>' +
      '<div class="stat-box"><b class="s-cancelled">' + count('CANCELLED') + '</b><span>Cancelled</span></div>';

    var pending = w.connected ? set.filter(function (r) { return r.status === 'PENDING_BIOMETRICS' || r.status === 'BIOMETRICS_VERIFIED'; }) : [];
    $('#approvals').innerHTML = pending.length ? pending.map(function (r) {
      return '<li><div class="ap-main"><strong>' + usd(r.valueUSD) + ' · ' + esc(r.agentSubname || short(r.agentAddress)) + '</strong>' +
        '<span>' + pill(r.status) + ' · ' + timeAgo(r.createdAt) + ' · ' + txLink(r.txHash, 'request') + '</span></div>' +
        '<div class="row-actions">' + actionsFor(r) + '</div></li>';
    }).join('') : '<li class="empty">Nothing waiting. Big trades will show up here.</li>';
  }

  // ---------------------------------------------------------------------------
  // Copy buttons (delegated) with instant checkmark feedback
  // ---------------------------------------------------------------------------
  var CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (!b) return;
    var text = b.dataset.copy;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      function () {
        b.classList.add('is-copied');
        var prev = b.innerHTML;
        b.innerHTML = CHECK_ICON;
        setTimeout(function () {
          b.classList.remove('is-copied');
          b.innerHTML = prev;
        }, 1500);
        toast('Copied to clipboard', 'ok');
      },
      function () { window.prompt('Copy value', text); }
    );
  });

  // ---------------------------------------------------------------------------
  // Tabs (hash routing) + mobile menu
  // ---------------------------------------------------------------------------
  var TABS = ['overview', 'agents', 'strategy', 'execute', 'activity'];

  function showTab() {
    var name = (location.hash || '').replace('#', '');
    if (TABS.indexOf(name) === -1) name = 'overview';
    $$('.tab').forEach(function (t) { t.hidden = t.dataset.tab !== name; });
    $$('#site-nav a').forEach(function (a) {
      var on = a.dataset.tab === name;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', showTab);

  var body = document.body;
  var burger = $('.burger');
  function setMenu(open) {
    body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  burger.addEventListener('click', function () { setMenu(!body.classList.contains('menu-open')); });
  $$('#site-nav a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  $('.menu-backdrop').addEventListener('click', function () { setMenu(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    setMenu(false);
    if (!modal.hidden) closeApproval();
  });
  var mq = window.matchMedia('(min-width: 901px)');
  var onMq = function (e) { if (e.matches) setMenu(false); };
  if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener(onMq);

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  showTab();
  renderWallet();
  loadHealth().then(function () {
    return Wallet.restore();
  }).then(function (w) {
    onWalletChange(w || Wallet.get());
    return loadActivity();
  });
  setInterval(function () {
    if (document.hidden) return;
    if (state.api === null) loadHealth(); else loadActivity();
  }, 10000);
  setInterval(function () {
    if (!document.hidden && state.wallet.connected) loadMine();
  }, 30000);
})();
