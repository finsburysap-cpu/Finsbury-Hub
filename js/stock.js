// js/stock.js
// Stock Intelligence module — all data loading and rendering

import { getSession, signOut, setSessionSite } from './auth.js';
import { getSupabase } from './supabase.js';

// ── Guard ──────────────────────────────────────────
const session = getSession();
if (!session) { window.location.href = 'index.html'; }
if (!session.site) { window.location.href = 'site-select.html'; }

const site = session.site;
const sb   = getSupabase();

// ── State ──────────────────────────────────────────
let allData   = [];
let whsDetail = {};
let orderQtys = {};
let lastSynced = null;

// ── Init ───────────────────────────────────────────
document.getElementById('site-pill').textContent = site;

async function init() {
  await loadData();
  updateSyncTimestamp();
  renderAll();
  setInterval(updateSyncTimestamp, 60000);
}

init();

// ── Data loading ───────────────────────────────────
async function loadData() {
  setTableLoading(true);
  try {
    const { data: metrics, error: e1 } = await sb
      .from('stock_metrics')
      .select('*')
      .eq('site_name', site)
      .limit(5000);
    if (e1) throw e1;
    allData = metrics || [];

    const itemCodes = allData.map(r => r.item_code);
    if (itemCodes.length > 0) {
      const { data: detail, error: e2 } = await sb
        .from('stock_on_hand_detail')
        .select('item_code, whs_code, whs_name, on_hand')
        .eq('site_name', site)
        .in('item_code', itemCodes)
        .limit(5000);
      if (!e2 && detail) {
        whsDetail = {};
        detail.forEach(r => {
          if (!whsDetail[r.item_code]) whsDetail[r.item_code] = [];
          whsDetail[r.item_code].push(r);
        });
      }
    }

    const { data: syncLog } = await sb
  .from('sync_log')
  .select('run_at')
  .eq('status', 'success')
  .order('run_at', { ascending: false })
  .limit(1);
    lastSynced = syncLog && syncLog.length > 0 ? new Date(syncLog[0].run_at) : null;

    populateVendorDropdown();
  } catch (err) {
    console.error('loadData error:', err);
  } finally {
    setTableLoading(false);
  }
}

// ── Sync timestamp ─────────────────────────────────
function updateSyncTimestamp() {
  const dot   = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  if (!lastSynced) {
    dot.className = 'sync-dot';
    label.textContent = 'Never synced';
    return;
  }
  const minutesAgo = Math.floor((Date.now() - lastSynced.getTime()) / 60000);
  const hoursAgo   = Math.floor(minutesAgo / 60);
  let timeStr;
  if (minutesAgo < 1)       timeStr = 'Just now';
  else if (minutesAgo < 60) timeStr = minutesAgo + 'm ago';
  else if (hoursAgo < 24)   timeStr = hoursAgo + 'h ago';
  else                      timeStr = lastSynced.toLocaleDateString();
  label.textContent = 'Last synced: ' + timeStr;
  if (hoursAgo < 4) {
    dot.className = 'sync-dot green';
  } else if (hoursAgo < 12) {
    dot.className = 'sync-dot amber';
    label.textContent += ' — consider refreshing';
  } else {
    dot.className = 'sync-dot red';
    label.textContent += ' — data may be stale';
  }
}

// ── Manual refresh ─────────────────────────────────
window.doRefresh = async function() {
  const btn     = document.getElementById('btn-refresh');
  const txt     = document.getElementById('refresh-text');
  const spinner = document.getElementById('refresh-spinner');
  btn.disabled = true;
  txt.style.display = 'none';
  spinner.style.display = 'inline-block';
  try {
    await loadData();
    updateSyncTimestamp();
    renderAll();
  } finally {
    btn.disabled = false;
    txt.style.display = 'inline';
    spinner.style.display = 'none';
  }
};

// ── Vendor dropdown ────────────────────────────────
function populateVendorDropdown() {
  const sel = document.getElementById('vendor-select');
  const cur = sel.value;
  const vendors = [...new Set(
    allData
      .filter(r => r.vendor_name && r.vendor_name.trim() !== '')
      .map(r => r.vendor_name.trim())
  )].sort();
  sel.innerHTML = '<option value="">All vendors</option>';
  vendors.forEach(function(v) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    if (v === cur) opt.selected = true;
    sel.appendChild(opt);
  });
  console.log('Vendors loaded: ' + vendors.length);
}

// ── Tab switching ──────────────────────────────────
window.setTab = function(tab) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
  document.getElementById('view-' + tab).classList.add('active');
};

// ── Render all ─────────────────────────────────────
function renderAll() {
  updateMetrics();
  window.renderReplen();
  window.renderSlow();
  window.renderDead();
}

// ── Metrics ────────────────────────────────────────
function updateMetrics() {
  document.getElementById('m-reorder').textContent     = allData.filter(function(r) { return r.needs_ordering; }).length;
  document.getElementById('m-critical').textContent    = allData.filter(function(r) { return r.stock_status === 'critical'; }).length;
  document.getElementById('m-slow').textContent        = allData.filter(function(r) { return r.is_slow_moving; }).length;
  document.getElementById('m-dead').textContent        = allData.filter(function(r) { return r.is_dead_stock; }).length;
  document.getElementById('m-reorder-sub').textContent = site + ' warehouse';
}

// ── Replenishment tab ──────────────────────────────
window.renderReplen = function() {
  var vendor = (document.getElementById('vendor-select').value || '').trim();
  var filter = document.getElementById('filter-select').value;
  var search = (document.getElementById('replen-search').value || '').toLowerCase().trim();

  console.log('Rendering replen — filter:' + filter + ' vendor:"' + vendor + '" search:"' + search + '" allData:' + allData.length);

  var rows = filter === 'all' ? allData.slice() : allData.filter(function(r) { return r.needs_ordering; });
  if (vendor) rows = rows.filter(function(r) { return (r.vendor_name || '').trim() === vendor; });
  if (search) rows = rows.filter(function(r) {
    return r.item_name.toLowerCase().indexOf(search) > -1 ||
           (r.item_code || '').toLowerCase().indexOf(search) > -1;
  });

  rows.sort(function(a, b) {
    var order = { critical: 0, low: 1, ok: 2 };
    return (order[a.stock_status] !== undefined ? order[a.stock_status] : 3) -
           (order[b.stock_status] !== undefined ? order[b.stock_status] : 3);
  });

  document.getElementById('tc-replen').textContent = allData.filter(function(r) { return r.needs_ordering; }).length;

  var tbody = document.getElementById('tbody-replen');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No items found</td></tr>';
    updateOrderSummary(0);
    return;
  }

  rows.forEach(function(r) {
    var key      = r.item_code;
    var savedPcs = orderQtys[key] || '';
    var ctn      = r.pcs_per_ctn || 0;
    var savedCtn = savedPcs && ctn ? Math.ceil(savedPcs / ctn) : '';
    var suggestCtn = r.suggest_qty_pcs && ctn ? Math.ceil(r.suggest_qty_pcs / ctn) + ' ctn' : '';
    var coverStr   = r.cover_days != null ? r.cover_days + 'd' : '—';
    var coverColor = r.cover_days == null ? '' :
      r.cover_days < r.target_days * 0.5 ? 'color:var(--red);font-weight:500' :
      r.cover_days < r.target_days       ? 'color:var(--amber);font-weight:500' : '';
    var ek = key.replace(/[^a-zA-Z0-9]/g, '_');

    var suggestCell = '';
    if (r.suggest_qty_pcs > 0) {
      suggestCell = '<span style="font-family:\'DM Mono\',monospace;font-weight:500">' + fmt(r.suggest_qty_pcs) + ' pcs</span>' +
        (suggestCtn ? '<br><small style="color:var(--text-muted)">' + suggestCtn + '</small>' : '');
    } else if (r.needs_ordering && (!r.daily_rate_90d || r.daily_rate_90d === 0)) {
      suggestCell = '<span style="color:var(--amber);font-size:11px">No sales history</span>';
    } else {
      suggestCell = '<span style="color:var(--text-muted)">—</span>';
    }

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td title="' + r.item_name + '" style="font-weight:500;white-space:normal;line-height:1.4">' + r.item_name + '</td>' +
      '<td style="color:var(--text-secondary)">' + (r.grp_name || '—') + '</td>' +
      '<td><span style="font-family:\'DM Mono\',monospace">' + fmt(r.stock_on_hand) + ' pcs</span>' +
  (ctn > 0 ? '<br><small style="color:var(--text-muted);font-family:\'DM Mono\',monospace">' + (r.stock_on_hand / ctn).toFixed(1) + ' ctn</small>' : '') +
'<button class="btn-expand" style="margin-left:4px" onclick="showWhsDetail(\'' + key + '\',\'' + r.item_name.replace(/'/g, "\\'") + '\')">▾</button></td>' +
      '<td style="' + coverColor + '">' + coverStr + '</td>' +
      '<td style="color:var(--text-muted)">' + (r.target_days ? r.target_days + 'd' : '—') + '</td>' +
      '<td style="font-family:\'DM Mono\',monospace">' + (r.daily_rate_90d ? r.daily_rate_90d.toFixed(1) + '/d' : '—') + '</td>' +
      '<td>' + trendHtml(r.trend_pct) + '</td>' +
      '<td style="color:var(--text-muted);font-family:\'DM Mono\',monospace">' + (r.open_po_qty > 0 ? fmt(r.open_po_qty) : '—') + '</td>' +
      '<td>' + suggestCell + '</td>' +
      '<td><div class="order-cell">' +
        '<input type="number" class="qty-input' + (savedPcs ? ' filled' : '') + '" id="pcs-' + ek + '" placeholder="pcs" value="' + savedPcs + '" min="0" step="1" oninput="onPcsInput(\'' + ek + '\',\'' + key + '\',' + ctn + ')">' +
        '<span class="qty-divider">/</span>' +
        '<input type="number" class="qty-input' + (savedCtn ? ' filled' : '') + '" id="ctn-' + ek + '" placeholder="ctn" value="' + savedCtn + '" min="0" step="1" oninput="onCtnInput(\'' + ek + '\',\'' + key + '\',' + ctn + ')">' +
      '</div></td>' +
      '<td>' + statusBadge(r.stock_status) + '</td>';
    tbody.appendChild(tr);
  });

  updateOrderSummary(rows.length);
};

// ── Slow moving tab ────────────────────────────────
window.renderSlow = function() {
  var search = (document.getElementById('slow-search').value || '').toLowerCase().trim();
  var rows = allData.filter(function(r) { return r.is_slow_moving; });
  if (search) rows = rows.filter(function(r) {
    return r.item_name.toLowerCase().indexOf(search) > -1 ||
           (r.vendor_name || '').toLowerCase().indexOf(search) > -1;
  });
  document.getElementById('tc-slow').textContent = rows.length;
  var tbody = document.getElementById('tbody-slow');
  tbody.innerHTML = '';
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No slow moving items</td></tr>';
    return;
  }
  rows.forEach(function(r) {
    var reason = r.daily_rate_30d < r.daily_rate_90d * 0.5 ? 'Velocity drop' : 'Cover 2× target';
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td title="' + r.item_name + '" style="font-weight:500;white-space:normal;line-height:1.4">' + r.item_name + '</td>' +
      '<td style="color:var(--text-secondary)">' + (r.grp_name || '—') + '</td>' +
      '<td><span style="font-family:\'DM Mono\',monospace">' + fmt(r.stock_on_hand) + ' pcs</span>' +
  (r.pcs_per_ctn > 0 ? '<br><small style="color:var(--text-muted);font-family:\'DM Mono\',monospace">' + (r.stock_on_hand / r.pcs_per_ctn).toFixed(1) + ' ctn</small>' : '') +
 '<button class="btn-expand" style="margin-left:4px" onclick="showWhsDetail(\'' + r.item_code + '\',\'' + r.item_name.replace(/'/g, "\\'") + '\')">▾</button></td>' +
      '<td style="color:var(--amber);font-weight:500">' + (r.cover_days != null ? r.cover_days + 'd' : '—') + '</td>' +
      '<td style="color:var(--text-muted)">' + (r.target_days ? r.target_days + 'd' : '—') + '</td>' +
      '<td style="font-family:\'DM Mono\',monospace">' + (r.daily_rate_90d ? r.daily_rate_90d.toFixed(1) + '/d' : '—') + '</td>' +
      '<td style="font-family:\'DM Mono\',monospace;color:var(--red)">' + (r.daily_rate_30d ? r.daily_rate_30d.toFixed(1) + '/d' : '—') + '</td>' +
      '<td>' + trendHtml(r.trend_pct) + '</td>' +
      '<td><span class="badge badge-slow">' + reason + '</span></td>' +
      '<td style="color:var(--text-secondary)">' + (r.vendor_name || '—') + '</td>';
    tbody.appendChild(tr);
  });
};

// ── Dead stock tab ─────────────────────────────────
window.renderDead = function() {
  var search = (document.getElementById('dead-search').value || '').toLowerCase().trim();
  var rows = allData.filter(function(r) { return r.is_dead_stock; });
  if (search) rows = rows.filter(function(r) {
    return r.item_name.toLowerCase().indexOf(search) > -1 ||
           (r.vendor_name || '').toLowerCase().indexOf(search) > -1;
  });
  rows.sort(function(a, b) { return (b.cover_days || 0) - (a.cover_days || 0); });
  document.getElementById('tc-dead').textContent = rows.length;
  var tbody = document.getElementById('tbody-dead');
  tbody.innerHTML = '';
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No dead stock items</td></tr>';
    return;
  }
  rows.forEach(function(r) {
    var lastSale = r.last_sale_date
      ? new Date(r.last_sale_date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      : 'Never';
    var daysInactive = r.last_sale_date
      ? Math.floor((Date.now() - new Date(r.last_sale_date).getTime()) / 86400000)
      : null;
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td title="' + r.item_name + '" style="font-weight:500;white-space:normal;line-height:1.4">' + r.item_name + '</td>' +
'<td><span style="font-family:\'DM Mono\',monospace">' + fmt(r.stock_on_hand) + ' pcs</span>' +
  (r.pcs_per_ctn > 0 ? '<br><small style="color:var(--text-muted);font-family:\'DM Mono\',monospace">' + (r.stock_on_hand / r.pcs_per_ctn).toFixed(1) + ' ctn</small>' : '') +
  '<button class="btn-expand" style="margin-left:4px" onclick="showWhsDetail(\'' + r.item_code + '\',\'' + r.item_name.replace(/'/g, "\\'") + '\')">▾</button></td>' +
      '<td style="color:var(--text-secondary)">' + lastSale + '</td>' +
      '<td style="color:var(--red);font-weight:500;font-family:\'DM Mono\',monospace">' + (daysInactive != null ? daysInactive + 'd' : '—') + '</td>' +
      '<td style="font-family:\'DM Mono\',monospace;color:var(--text-secondary)">' + fmt(r.total_returns_90d) + ' pcs</td>' +
      '<td style="color:var(--text-secondary)">' + (r.vendor_name || '—') + '</td>';
    tbody.appendChild(tr);
  });
};

// ── Warehouse detail modal ─────────────────────────
window.showWhsDetail = function(itemCode, itemName) {
  var detail = whsDetail[itemCode] || [];
  document.getElementById('whs-modal-title').textContent = itemName;
  var html = '';
  if (detail.length === 0) {
    html = '<p style="color:var(--text-muted);font-size:13px;margin-top:12px">No warehouse detail available.</p>';
  } else {
    html = '<table class="whs-table"><thead><tr><th>Warehouse</th><th>Code</th><th style="text-align:right">Stock on hand</th></tr></thead><tbody>';
    var total = 0;
    detail.forEach(function(w) {
      total += w.on_hand || 0;
      html += '<tr><td>' + (w.whs_name || w.whs_code) + '</td><td style="color:var(--text-muted)">' + w.whs_code + '</td><td style="text-align:right;font-weight:500">' + fmt(w.on_hand) + '</td></tr>';
    });
    html += '<tr style="background:var(--gray-bg)"><td colspan="2" style="font-weight:500;color:var(--text-secondary)">Total</td><td style="text-align:right;font-weight:500">' + fmt(total) + '</td></tr>';
    html += '</tbody></table>';
  }
  document.getElementById('whs-modal-body').innerHTML = html;
  document.getElementById('whs-modal').style.display = 'flex';
};

// ── Order qty inputs ───────────────────────────────
window.onPcsInput = function(ek, key, ctnSize) {
  var pcsEl = document.getElementById('pcs-' + ek);
  var ctnEl = document.getElementById('ctn-' + ek);
  var pcs   = parseInt(pcsEl.value) || 0;
  if (pcs > 0) {
    orderQtys[key] = pcs;
    if (ctnSize > 0) ctnEl.value = Math.ceil(pcs / ctnSize);
    pcsEl.classList.add('filled');
    if (ctnSize > 0) ctnEl.classList.add('filled');
  } else {
    delete orderQtys[key];
    ctnEl.value = '';
    pcsEl.classList.remove('filled');
    ctnEl.classList.remove('filled');
  }
  updateOrderSummary(null);
};

window.onCtnInput = function(ek, key, ctnSize) {
  if (!ctnSize) return;
  var pcsEl = document.getElementById('pcs-' + ek);
  var ctnEl = document.getElementById('ctn-' + ek);
  var ctn   = parseInt(ctnEl.value) || 0;
  if (ctn > 0) {
    var pcs = ctn * ctnSize;
    orderQtys[key] = pcs;
    pcsEl.value = pcs;
    pcsEl.classList.add('filled');
    ctnEl.classList.add('filled');
  } else {
    delete orderQtys[key];
    pcsEl.value = '';
    pcsEl.classList.remove('filled');
    ctnEl.classList.remove('filled');
  }
  updateOrderSummary(null);
};

function updateOrderSummary(rowCount) {
  var count   = Object.keys(orderQtys).length;
  var summary = '';
  if (rowCount != null) summary = rowCount.toLocaleString() + ' items shown';
  if (count > 0) summary += (summary ? ' · ' : '') + count + ' with quantities';
  document.getElementById('order-summary').textContent = summary;
}

// ── Export ─────────────────────────────────────────
window.exportReplen = function() {
  var vendor = (document.getElementById('vendor-select').value || '').trim();
  var filter = document.getElementById('filter-select').value;
  var rows   = filter === 'all' ? allData.slice() : allData.filter(function(r) { return r.needs_ordering; });
  if (vendor) rows = rows.filter(function(r) { return (r.vendor_name || '').trim() === vendor; });
  var withQty    = rows.filter(function(r) { return orderQtys[r.item_code]; });
  var exportRows = withQty.length > 0 ? withQty : rows;
  var csvRows = [['Item code','Item name','Group','Vendor','Stock on hand','Cover (days)','Target (days)','90d rate','Trend %','Open PO','Suggested (pcs)','Suggested (ctn)','Order qty (pcs)','Order qty (ctn)','Status'].join(',')];
  exportRows.forEach(function(r) {
    var oqPcs  = orderQtys[r.item_code] || '';
    var oqCtn  = oqPcs && r.pcs_per_ctn ? Math.ceil(oqPcs / r.pcs_per_ctn) : '';
    var sugCtn = r.suggest_qty_pcs && r.pcs_per_ctn ? Math.ceil(r.suggest_qty_pcs / r.pcs_per_ctn) : '';
    csvRows.push([r.item_code,'"'+r.item_name+'"',r.grp_name||'',r.vendor_name||'',r.stock_on_hand,r.cover_days||'',r.target_days||'',r.daily_rate_90d?r.daily_rate_90d.toFixed(2):'',r.trend_pct||'',r.open_po_qty||0,r.suggest_qty_pcs||'',sugCtn,oqPcs,oqCtn,r.stock_status].join(','));
  });
  downloadCsv(csvRows.join('\n'), 'replenishment_' + site + '_' + today() + '.csv');
};

window.exportSlow = function() {
  var rows    = allData.filter(function(r) { return r.is_slow_moving; });
  var csvRows = [['Item code','Item name','Group','Stock','Cover (days)','Target (days)','90d rate','30d rate','Trend %','Vendor'].join(',')];
  rows.forEach(function(r) {
    csvRows.push([r.item_code,'"'+r.item_name+'"',r.grp_name||'',r.stock_on_hand,r.cover_days||'',r.target_days||'',r.daily_rate_90d?r.daily_rate_90d.toFixed(2):'',r.daily_rate_30d?r.daily_rate_30d.toFixed(2):'',r.trend_pct||'',r.vendor_name||''].join(','));
  });
  downloadCsv(csvRows.join('\n'), 'slow_moving_' + site + '_' + today() + '.csv');
};

window.exportDead = function() {
  var rows    = allData.filter(function(r) { return r.is_dead_stock; });
  var csvRows = [['Item code','Item name','Group','Stock','Last sale','90d returns','Vendor'].join(',')];
  rows.forEach(function(r) {
    csvRows.push([r.item_code,'"'+r.item_name+'"',r.grp_name||'',r.stock_on_hand,r.last_sale_date||'',r.total_returns_90d||0,r.vendor_name||''].join(','));
  });
  downloadCsv(csvRows.join('\n'), 'dead_stock_' + site + '_' + today() + '.csv');
};

// ── Site switching ─────────────────────────────────
window.switchSite = function() {
  var target = site === 'Nairobi' ? 'Mombasa' : 'Nairobi';
  document.getElementById('switch-modal-body').innerHTML = 'You are on <strong>' + site + '</strong>. Switching to <strong>' + target + '</strong> will reload all data. Any unsaved order quantities will be lost.';
  document.getElementById('switch-modal').style.display = 'flex';
};

window.confirmSwitch = function() {
  var target = site === 'Nairobi' ? 'Mombasa' : 'Nairobi';
  setSessionSite(target);
  window.location.href = 'stock.html';
};

window.signOutAll = function() {
  signOut();
  window.location.href = 'index.html';
};

// ── Helpers ────────────────────────────────────────
function fmt(n) {
  if (n == null || n === '') return '—';
  return Math.round(n).toLocaleString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function trendHtml(pct) {
  if (pct == null) return '<span class="trend-flat">—</span>';
  if (pct > 10)    return '<span class="trend-up">+' + pct + '%</span>';
  if (pct < -10)   return '<span class="trend-down">' + pct + '%</span>';
  return '<span class="trend-flat">stable</span>';
}

function statusBadge(status) {
  if (status === 'critical') return '<span class="badge badge-critical">Critical</span>';
  if (status === 'low')      return '<span class="badge badge-low">Low</span>';
  return '<span class="badge badge-ok">OK</span>';
}

function downloadCsv(content, filename) {
  var blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function setTableLoading(loading) {
  ['tbody-replen','tbody-slow','tbody-dead'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el && loading) {
      el.innerHTML = '<tr><td colspan="11" class="empty-state"><span class="spinner spinner-dark" style="width:18px;height:18px;border-color:rgba(0,0,0,0.1);border-top-color:var(--accent)"></span>&nbsp; Loading...</td></tr>';
    }
  });
}
