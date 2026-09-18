import { getSupabase } from './supabase.js';
import { getSession, signOut, setSessionSite } from './auth.js';

const sb       = getSupabase();
let session    = null;
let site       = null;
let allSummary = [];  // one row per customer from ar_customer_summary view

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  session = getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  site = session.site;
  if (!site) { window.location.href = 'site-select.html'; return; }
  document.getElementById('site-pill').textContent = site;
  await loadData();
  updateSyncTimestamp();
}

// ── Load summary data ──────────────────────────────────────────────────────
async function loadData() {
  document.getElementById('sync-label').textContent = 'Loading...';

  const { data, error } = await sb
    .from('ar_customer_summary')
    .select('*')
    .eq('site_name', site);

  if (error) { console.error(error); return; }
  allSummary = data || [];

  populateFilters();
  renderAR();
  updateMetrics();
  updateSyncTimestamp();
}

// ── Populate filters ───────────────────────────────────────────────────────
function populateFilters() {
  const customers = [...new Set(allSummary.map(d => d.card_name))].sort();
  const slps      = [...new Set(allSummary.map(d => d.sales_person).filter(Boolean))].sort();

  const cSel = document.getElementById('customer-filter');
  const sSel = document.getElementById('slp-filter');
  const cVal = cSel.value;
  const sVal = sSel.value;

  cSel.innerHTML = '<option value="">All customers</option>';
  customers.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    cSel.appendChild(o);
  });
  cSel.value = cVal;

  sSel.innerHTML = '<option value="">All</option>';
  slps.forEach(s => {
    const o = document.createElement('option');
    o.value = s; o.textContent = s;
    sSel.appendChild(o);
  });
  sSel.value = sVal;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(n) {
  return Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function agingBucket(days) {
  if (!days || days <= 0) return 'current';
  if (days <= 30) return '30';
  if (days <= 60) return '60';
  return '90';
}

function worstAgingFromSummary(c) {
  const max = parseFloat(c.max_days_overdue || 0);
  return agingBucket(max);
}

function agingBadgeHtml(bucket) {
  if (bucket === 'current') return '<span class="aging-current">Current</span>';
  if (bucket === '30')      return '<span class="aging-30">1–30d</span>';
  if (bucket === '60')      return '<span class="aging-60">31–60d</span>';
  return '<span class="aging-90">60d+</span>';
}

function docBadge(type) {
  const cls = { IN:'doc-in', CN:'doc-cn', RC:'doc-rc', PD:'doc-pd' }[type] || 'doc-in';
  return '<span class="' + cls + '">' + type + '</span>';
}

// ── Metrics ────────────────────────────────────────────────────────────────
function updateMetrics() {
  let totalInv = 0, totalCn = 0, totalRc = 0, totalPd = 0, overdue = 0;
  let agCurrent = 0, ag30 = 0, ag60 = 0, ag90 = 0;

  allSummary.forEach(c => {
    totalInv += parseFloat(c.invoices_total || 0);
    totalCn  += parseFloat(c.credits_total  || 0);
    totalRc  += parseFloat(c.receipts_total || 0);
    totalPd  += Math.abs(parseFloat(c.drafts_total || 0));
    const maxDays = parseFloat(c.max_days_overdue || 0);
    if (maxDays > 0) overdue += parseFloat(c.invoices_total || 0);
    agCurrent += parseFloat(c.aging_current || 0);
    ag30      += parseFloat(c.aging_30 || 0);
    ag60      += parseFloat(c.aging_60 || 0);
    ag90      += parseFloat(c.aging_90 || 0);
  });

  const outstanding = totalInv + totalCn;
  const net         = outstanding + totalRc - totalPd;
  const customers   = allSummary.length;

  document.getElementById('m-total').textContent         = 'KES ' + fmt(outstanding);
  document.getElementById('m-customers-sub').textContent = customers + ' customers';
  document.getElementById('m-overdue').textContent       = 'KES ' + fmt(overdue);
  document.getElementById('m-drafts').textContent        = 'KES ' + fmt(totalPd);
  document.getElementById('m-net').textContent           = 'KES ' + fmt(net);
  document.getElementById('ag-current').textContent      = 'KES ' + fmt(agCurrent);
  document.getElementById('ag-30').textContent           = 'KES ' + fmt(ag30);
  document.getElementById('ag-60').textContent           = 'KES ' + fmt(ag60);
  document.getElementById('ag-90').textContent           = 'KES ' + fmt(ag90);
}

// ── Render customer list ───────────────────────────────────────────────────
window.renderAR = function() {
  const customerF = document.getElementById('customer-filter').value;
  const slpF      = document.getElementById('slp-filter').value;
  const agingF    = document.getElementById('aging-filter').value;
  const search    = document.getElementById('ar-search').value.toLowerCase().trim();

  let rows = allSummary.slice();
  if (customerF) rows = rows.filter(c => c.card_name === customerF);
  if (slpF)      rows = rows.filter(c => c.sales_person === slpF);
  if (search)    rows = rows.filter(c =>
    c.card_name.toLowerCase().includes(search) ||
    c.card_code.toLowerCase().includes(search)
  );
  if (agingF)    rows = rows.filter(c => worstAgingFromSummary(c) === agingF);

  // Sort: worst aging first, then by net outstanding descending
  const agingOrder = { '90':0, '60':1, '30':2, 'current':3 };
  rows.sort((a, b) => {
    const agA = agingOrder[worstAgingFromSummary(a)] ?? 3;
    const agB = agingOrder[worstAgingFromSummary(b)] ?? 3;
    if (agA !== agB) return agA - agB;
    return parseFloat(b.net_outstanding || 0) - parseFloat(a.net_outstanding || 0);
  });

  const container = document.getElementById('ar-list');
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">No outstanding found</div>';
    return;
  }

  container.innerHTML = rows.map(c => {
    const outstanding = parseFloat(c.net_outstanding || 0);
    const drafts      = Math.abs(parseFloat(c.drafts_total || 0));
    const maxDays     = parseFloat(c.max_days_overdue || 0);
    const worst       = worstAgingFromSummary(c);
    const invCount    = parseInt(c.invoice_count || 0);

    return '<div style="background:var(--surface);border:0.5px solid var(--border);border-radius:12px;margin-bottom:10px;overflow:hidden">' +
      '<div class="customer-row" style="padding:10px 14px;display:grid;grid-template-columns:2fr 1fr 1fr 1fr 90px;gap:10px;align-items:center" onclick="toggleCustomer(\'' + c.card_code + '\')">' +
        '<div>' +
          '<div style="font-size:13px;font-weight:500;color:var(--text-primary)">' + c.card_name + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted)">' +
            (c.credit_limit ? 'Credit: KES ' + fmt(c.credit_limit) + ' · ' : '') +
            (c.sales_person || '') +
          '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-size:13px;font-weight:500;font-family:\'DM Mono\',monospace">KES ' + fmt(outstanding) + '</div>' +
          '<div style="font-size:11px;color:var(--text-muted)">' + (drafts > 0 ? 'Drafts: KES ' + fmt(drafts) : '') + '</div>' +
        '</div>' +
        '<div style="text-align:right;font-size:12px;color:var(--text-secondary)">' + invCount + ' inv</div>' +
        '<div style="text-align:right;font-size:12px;color:' + (maxDays > 0 ? 'var(--text-danger)' : 'var(--text-muted)') + '">' +
          (maxDays > 0 ? maxDays + 'd overdue' : 'Current') +
        '</div>' +
        '<div style="text-align:right">' + agingBadgeHtml(worst) + '</div>' +
      '</div>' +
      '<div id="cust-' + c.card_code + '" style="display:none;border-top:0.5px solid var(--border);padding:12px 14px">' +
        '<div style="font-size:11px;color:var(--text-muted);text-align:center">Click to load documents...</div>' +
      '</div>' +
    '</div>';
  }).join('');
};

// ── Toggle customer — load docs on demand ──────────────────────────────────
window.toggleCustomer = async function(code) {
  const el = document.getElementById('cust-' + code);
  if (!el) return;

  if (el.style.display === 'block') {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';

  // Check if already loaded
  if (el.dataset.loaded === 'true') return;

  el.innerHTML = '<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:8px">Loading...</div>';

  const { data, error } = await sb
    .from('ar_documents')
    .select('*')
    .eq('card_code', code)
    .eq('site_name', site)
    .order('doc_date', { ascending: true });

  if (error || !data) {
    el.innerHTML = '<div style="font-size:11px;color:var(--text-danger);padding:8px">Failed to load documents</div>';
    return;
  }

  const linesHtml = data.map(d => {
    const amt      = parseFloat(d.amount || 0);
    const amtColor = amt < 0 ? 'color:var(--text-success)' : '';
    const dateStr  = d.doc_date ? new Date(d.doc_date).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) : '—';
    const dueStr   = d.due_date ? new Date(d.due_date).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) : '—';
    const overdue  = d.days_overdue != null && d.days_overdue > 0
      ? '<span style="color:var(--text-danger)">' + d.days_overdue + 'd</span>' : '—';

    return '<tr style="border-top:0.5px solid var(--border)">' +
      '<td style="padding:5px 8px">' + docBadge(d.doc_type) + '</td>' +
      '<td style="padding:5px 8px;font-family:\'DM Mono\',monospace;color:var(--text-secondary)">' + d.doc_number + '</td>' +
      '<td style="padding:5px 8px;color:var(--text-secondary)">' + dateStr + '</td>' +
      '<td style="padding:5px 8px;color:var(--text-secondary)">' + dueStr + '</td>' +
      '<td style="padding:5px 8px;color:var(--text-muted);font-size:11px;white-space:normal">' + (d.memo || '—') + '</td>' +
      '<td style="padding:5px 8px;text-align:right;font-family:\'DM Mono\',monospace;' + amtColor + '">' +
        (amt < 0 ? '-' : '') + 'KES ' + fmt(Math.abs(amt)) +
      '</td>' +
      '<td style="padding:5px 8px;text-align:right">' + (d.doc_type === 'IN' ? overdue : '—') + '</td>' +
    '</tr>';
  }).join('');

  el.innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed">' +
      '<thead><tr style="color:var(--text-muted)">' +
        '<th style="text-align:left;padding:4px 8px;font-weight:500;width:6%">Type</th>' +
        '<th style="text-align:left;padding:4px 8px;font-weight:500;width:8%">Doc no.</th>' +
        '<th style="text-align:left;padding:4px 8px;font-weight:500;width:12%">Date</th>' +
        '<th style="text-align:left;padding:4px 8px;font-weight:500;width:12%">Due date</th>' +
        '<th style="text-align:left;padding:4px 8px;font-weight:500;width:32%">Memo</th>' +
        '<th style="text-align:right;padding:4px 8px;font-weight:500;width:18%">Amount</th>' +
        '<th style="text-align:right;padding:4px 8px;font-weight:500;width:12%">Overdue</th>' +
      '</tr></thead>' +
      '<tbody>' + linesHtml + '</tbody>' +
    '</table>';

  el.dataset.loaded = 'true';
};

// ── Export Excel ───────────────────────────────────────────────────────────
window.exportAR = async function() {
  const customerF = document.getElementById('customer-filter').value;
  const slpF      = document.getElementById('slp-filter').value;
  const search    = document.getElementById('ar-search').value.toLowerCase().trim();

  const dateLabel = new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'});

  // Fetch all docs for export using pagination
  let docs = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let query = sb.from('ar_documents').select('*').eq('site_name', site).range(from, from + pageSize - 1);
    if (customerF) query = query.eq('card_name', customerF);
    if (slpF)      query = query.eq('sales_person', slpF);
    const { data, error } = await query;
    if (error || !data || data.length === 0) break;
    docs = docs.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  if (search) docs = docs.filter(d => d.card_name.toLowerCase().includes(search));
  const wsData = [
    ['FINSBURY TRADING LTD — AR OUTSTANDING'],
    ['Date: ' + dateLabel + '   Site: ' + site + (slpF ? '   Sales person: ' + slpF : '')],
    [],
    ['Type','Doc no.','Customer','Date','Due date','Payment terms','Amount (KES)','Days overdue','Sales person']
  ];

  docs.forEach(d => {
    wsData.push([
      d.doc_type,
      d.doc_number,
      d.card_name,
      d.doc_date || '',
      d.due_date || '',
      d.payment_terms || '',
      parseFloat(d.amount || 0),
      d.days_overdue || '',
      d.sales_person || ''
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{wch:5},{wch:10},{wch:35},{wch:12},{wch:12},{wch:18},{wch:16},{wch:14},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws, 'AR Outstanding');
  XLSX.writeFile(wb, 'ar_outstanding_' + site + '_' + new Date().toISOString().slice(0,10) + '.xlsx');
};

// ── Sync timestamp ─────────────────────────────────────────────────────────
async function updateSyncTimestamp() {
  const { data } = await sb.from('sync_log').select('run_at').eq('status','success').order('run_at',{ascending:false}).limit(1);
  const dot   = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  if (data && data.length > 0) {
    const mins = Math.round((Date.now() - new Date(data[0].run_at)) / 60000);
    dot.className = 'sync-dot sync-ok';
    if (mins < 2) {
      label.textContent = 'Just synced';
    } else if (mins < 60) {
      label.textContent = mins + ' min ago';
    } else {
      const hrs = Math.round(mins / 60);
      label.textContent = hrs + 'h ago';
    }
}

// ── Refresh ────────────────────────────────────────────────────────────────
window.doRefresh = async function() {
  const btn     = document.getElementById('btn-refresh');
  const txt     = document.getElementById('refresh-text');
  const spinner = document.getElementById('refresh-spinner');
  btn.disabled = true;
  txt.style.display = 'none';
  spinner.style.display = 'inline-block';
  document.getElementById('sync-label').textContent = 'Requesting sync...';

  try {
    await sb.from('sync_control').update({
      sync_requested: true,
      requested_at:   new Date().toISOString(),
      requested_by:   session.email || 'user',
    }).eq('id', 1);

    document.getElementById('sync-label').textContent = 'Syncing from SAP...';
    const startedAt = new Date().toISOString();
    const maxWait   = 5 * 60 * 1000;
    const started   = Date.now();
    let synced = false;

    while (Date.now() - started < maxWait) {
      await new Promise(r => setTimeout(r, 5000));
      const { data } = await sb.from('sync_log').select('run_at').eq('status','success').gt('run_at',startedAt).order('run_at',{ascending:false}).limit(1);
      if (data && data.length > 0) { synced = true; break; }
      document.getElementById('sync-label').textContent = 'Syncing... ' + Math.round((Date.now() - started) / 1000) + 's';
    }

    if (synced) {
      document.getElementById('sync-label').textContent = 'Sync complete — reloading...';
      await loadData();
    } else {
      document.getElementById('sync-label').textContent = 'Sync timed out — try again';
    }
  } catch(err) {
    console.error(err);
    document.getElementById('sync-label').textContent = 'Refresh failed';
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      txt.style.display = 'inline';
      spinner.style.display = 'none';
      updateSyncTimestamp();
    }, 120000);
  }
};

window.clearFilters = function() {
  document.getElementById('customer-filter').value = '';
  document.getElementById('slp-filter').value = '';
  document.getElementById('aging-filter').value = '';
  document.getElementById('ar-search').value = '';
  renderAR();
};
  
// ── Switch site ────────────────────────────────────────────────────────────
window.switchSite = function() {
  const target = site === 'Nairobi' ? 'Mombasa' : 'Nairobi';
  document.getElementById('switch-modal-body').textContent = 'Switch to ' + target + '?';
  document.getElementById('switch-modal').style.display = 'flex';
};

window.confirmSwitch = function() {
  const target = site === 'Nairobi' ? 'Mombasa' : 'Nairobi';
  setSessionSite(target);
  window.location.href = 'ar.html';
};

window.doSignOut = function() {
  signOut();
  window.location.href = 'index.html';
};

init();
