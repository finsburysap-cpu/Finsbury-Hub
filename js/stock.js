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
let allData   = [];   // raw stock_metrics rows for this site
let whsDetail = {};   // item_code -> [{whs_code, whs_name, on_hand}]
let orderQtys = {};   // item_code -> pcs
let activeTab = 'replen';
let lastSynced = null;

// ── Init ───────────────────────────────────────────
document.getElementById('site-pill').textContent = site;

async function init() {
  await loadData();
  updateSyncTimestamp();
  renderAll();
  setInterval(updateSyncTimestamp, 60000); // refresh timestamp colour every minute
}

init();

// ── Data loading ───────────────────────────────────
async function loadData() {
  setTableLoading(true);

  try {
    // Load stock metrics view
    const { data: metrics, error: e1 } = await sb
      .from('stock_metrics')
      .select('*')
      .eq('site_name', site);

    if (e1) throw e1;
    allData = metrics || [];

    // Load warehouse detail for this site
    const itemCodes = allData.map(r => r.item_code);
    if (itemCodes.length > 0) {
      const { data: detail, error: e2 } = await sb
        .from('stock_on_hand_detail')
        .select('item_code, whs_code, whs_name, on_hand')
        .eq('site_name', site)
        .in('item_code', itemCodes);

      if (!e2 && detail) {
        whsDetail = {};
        detail.forEach(r => {
          if (!whsDetail[r.item_code]) whsDetail[r.item_code] = [];
          whsDetail[r.item_code].push(r);
        });
      }
    }

    // Get last sync time
    const { data: syncLog } = await sb
      .from('sync_log')
      .select('run_at')
      .eq('status', 'success')
      .eq('module', 'stock')
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
    dot.className   = 'sync-dot';
    label.textContent = 'Never synced';
    return;
  }

  const minutesAgo = Math.floor((Date.now() - lastSynced.getTime()) / 60000);
  const hoursAgo   = Math.floor(minutesAgo / 60);

  let timeStr;
  if (minutesAgo < 1)        timeStr = 'Just now';
  else if (minutesAgo < 60)  timeStr = `${minutesAgo}m ago`;
  else if (hoursAgo < 24)    timeStr = `${hoursAgo}h ago`;
  else                       timeStr = lastSynced.toLocaleDateString();

  label.textContent = `Last synced: ${timeStr}`;

  // Colour code
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
  document.getElementById('sync-label').textContent = 'Requesting sync...';

  try {
    // Set the sync_requested flag in Supabase
    await sb.from('sync_control').update({
  sync_requested: true,
  requested_at:   new Date().toISOString(),
  requested_by:   session.email || 'user',
}).eq('id', 1);

    document.getElementById('sync-label').textContent = 'Syncing from SAP...';

    // Poll sync_log every 10 seconds for a new success entry
    const startedAt = new Date().toISOString();
    const maxWait   = 3 * 60 * 1000; // 3 minutes timeout
    const started   = Date.now();
    let   synced    = false;

    while (Date.now() - started < maxWait) {
      await new Promise(r => setTimeout(r, 10000)); // wait 10 seconds

      const { data } = await sb
        .from('sync_log')
        .select('run_at, status')
        .eq('status', 'success')
        .gt('run_at', startedAt)
        .order('run_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        synced    = true;
        lastSynced = new Date(data[0].run_at);
        break;
      }

      // Update label with elapsed time
      var elapsed = Math.round((Date.now() - started) / 1000);
      document.getElementById('sync-label').textContent = 'Syncing... ' + elapsed + 's';
    }

    if (synced) {
      document.getElementById('sync-label').textContent = 'Sync complete — reloading data...';
      await loadData();
      renderAll();
      updateSyncTimestamp();
    } else {
      document.getElementById('sync-label').textContent = 'Sync timed out — try again';
    }

  } catch (err) {
    console.error('Refresh error:', err);
    document.getElementById('sync-label').textContent = 'Refresh failed';
  } finally {
    // Re-enable button after 2 minute cooldown
    setTimeout(function() {
      btn.disabled = false;
      txt.style.display = 'inline';
      spinner.style.display = 'none';
      updateSyncTimestamp();
    }, 120000);
  }
};

// ── Vendor dropdown ────────────────────────────────
function populateVendorDropdown() {
  const sel = document.getElementById('vendor-select');
  const cur = sel.value;
  const vendors = [...new Set(
    allData.filter(r => r.vendor_name).map(r => r.vendor_name)
  )].sort();

  sel.innerHTML = '<option value="">All vendors</option>';
  vendors.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    if (v === cur) opt.selected = true;
    sel.appendChild(opt);
  });
}

window.onVendorChange = function() { renderReplen(); };

// ── Tab switching ──────────────────────────────────
window.setTab = function(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + tab).classList.add('active');
};

// ── Render all ─────────────────────────────────────
function renderAll() {
  updateMetrics();
  renderReplen();
  renderSlow();
  renderDead();
}

// ── Metrics ────────────────────────────────────────
function updateMetrics() {
  const reorder  = allData.filter(r => r.needs_ordering && !r.is_dead_stock && !r.is_slow_moving).length;
  const critical = allData.filter(r => r.stock_status === 'critical').length;
  const slow     = allData.filter(r => r.is_slow_moving).length;
  const dead     = allData.filter(r => r.is_dead_stock).length;

  document.getElementById('m-reorder').textContent  = reorder;
  document.getElementById('m-critical').textContent = critical;
  document.getElementById('m-slow').textContent     = slow;
  document.getElementById('m-dead').textContent     = dead;
  document.getElementById('m-reorder-sub').textContent = site + ' warehouse';
}

// ── Replenishment tab ──────────────────────────────
window.renderReplen = function() {
  var vendor = (document.getElementById('vendor-select').value || '').trim();
  var filter = document.getElementById('filter-select').value;
  var search = (document.getElementById('replen-search').value || '').toLowerCase().trim();

  var rows = filter === 'all' ? allData.slice() : allData.filter(function(r) { return r.needs_ordering; });
  if (vendor) rows = rows.filter(function(r) { return (r.vendor_name || '').trim() === vendor; });
  if (search) rows = rows.filter(function(r) {
    return r.item_name.toLowerCase().indexOf(search) > -1 ||
           (r.item_code || '').toLowerCase().indexOf(search) > -1;
  });

  rows.sort(function(a, b) {
    var vendorA = (a.vendor_name || '').toLowerCase();
    var vendorB = (b.vendor_name || '').toLowerCase();
    if (vendorA < vendorB) return -1;
    if (vendorA > vendorB) return 1;
    var coverA = a.cover_days != null ? a.cover_days : 9999;
    var coverB = b.cover_days != null ? b.cover_days : 9999;
    return coverA - coverB;
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
      suggestCell = '<span style="font-family:\'DM Mono\',monospace;font-weight:500">' + r.suggest_qty_pcs.toFixed(2) + ' ' + (r.inv_uom || 'pcs') + '</span>' +
        (suggestCtn ? '<br><small style="color:var(--text-muted)">' + suggestCtn + '</small>' : '');
    } else if (r.needs_ordering && (!r.daily_rate_90d || r.daily_rate_90d === 0)) {
      suggestCell = '<span style="color:var(--amber);font-size:11px">No sales history</span>';
    } else {
      suggestCell = '<span style="color:var(--text-muted)">—</span>';
    }

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td title="' + r.item_name + '" style="font-weight:500;white-space:normal;line-height:1.4">' + r.item_name + '</td>' +
      '<td><span style="font-family:\'DM Mono\',monospace">' + (r.stock_on_hand != null ? r.stock_on_hand.toFixed(2) : '—') + ' ' + (r.inv_uom || 'pcs') + '</span>' +
        (ctn > 0 && r.stock_on_hand > 0 ? '<br><small style="color:var(--text-muted);font-family:\'DM Mono\',monospace">' + (r.stock_on_hand / ctn).toFixed(2) + ' ctn</small>' : '') +
        '<button class="btn-expand" style="margin-left:4px" onclick="showWhsDetail(\'' + key + '\',\'' + r.item_name.replace(/'/g, "\\'") + '\')">▾</button></td>' +
      '<td style="' + coverColor + '">' + coverStr + '</td>' +
      '<td style="color:var(--text-muted)">' + (r.target_days ? r.target_days + 'd' : '—') + '</td>' +
      '<td style="font-family:\'DM Mono\',monospace">' + (r.daily_rate_90d ? r.daily_rate_90d.toFixed(1) + '/d' : '—') + '</td>' +
      '<td>' + trendHtml(r.trend_pct) + '</td>' +
      '<td style="color:var(--text-muted);font-family:\'DM Mono\',monospace">' + (r.open_po_qty > 0 ? fmt(r.open_po_qty) : '—') + '</td>' +
      '<td style="font-family:\'DM Mono\',monospace;font-size:12px">' +
        (r.last_purchase_price ? (r.last_purchase_currency || '') + ' ' + Number(r.last_purchase_price).toFixed(2) +
          (r.last_purchase_date ? '<br><small style="color:var(--text-muted)">' + new Date(r.last_purchase_date).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) + '</small>' : '')
        : '—') + '</td>' +
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

  rows.sort(function(a, b) {
    var vendorA = (a.vendor_name || '').toLowerCase();
    var vendorB = (b.vendor_name || '').toLowerCase();
    if (vendorA < vendorB) return -1;
    if (vendorA > vendorB) return 1;
    var coverA = a.cover_days != null ? a.cover_days : 9999;
    var coverB = b.cover_days != null ? b.cover_days : 9999;
    return coverA - coverB;
  });

  document.getElementById('tc-slow').textContent = rows.length;
  var tbody = document.getElementById('tbody-slow');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No slow moving items</td></tr>';
    return;
  }

  rows.forEach(function(r) {
    var reason = r.daily_rate_30d < r.daily_rate_90d * 0.5 ? 'Velocity drop' : 'Cover 2× target';
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td title="' + r.item_name + '" style="font-weight:500;white-space:normal;line-height:1.4">' + r.item_name + '</td>' +
      '<td><span style="font-family:\'DM Mono\',monospace">' + (r.stock_on_hand != null ? r.stock_on_hand.toFixed(2) : '—') + ' ' + (r.inv_uom || 'pcs') + '</span>' +
        (r.pcs_per_ctn > 0 && r.stock_on_hand > 0 ? '<br><small style="color:var(--text-muted);font-family:\'DM Mono\',monospace">' + (r.stock_on_hand / r.pcs_per_ctn).toFixed(2) + ' ctn</small>' : '') +
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

  rows.sort(function(a, b) {
    var vendorA = (a.vendor_name || '').toLowerCase();
    var vendorB = (b.vendor_name || '').toLowerCase();
    if (vendorA < vendorB) return -1;
    if (vendorA > vendorB) return 1;
    var coverA = a.cover_days != null ? a.cover_days : 0;
    var coverB = b.cover_days != null ? b.cover_days : 0;
    return coverB - coverA;
  });

  document.getElementById('tc-dead').textContent = rows.length;
  var tbody = document.getElementById('tbody-dead');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No dead stock items</td></tr>';
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
      '<td><span style="font-family:\'DM Mono\',monospace">' + (r.stock_on_hand != null ? r.stock_on_hand.toFixed(2) : '—') + ' ' + (r.inv_uom || 'pcs') + '</span>' +
        (r.pcs_per_ctn > 0 && r.stock_on_hand > 0 ? '<br><small style="color:var(--text-muted);font-family:\'DM Mono\',monospace">' + (r.stock_on_hand / r.pcs_per_ctn).toFixed(2) + ' ctn</small>' : '') +
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
  const detail = whsDetail[itemCode] || [];
  document.getElementById('whs-modal-title').textContent = itemName;

  let html = '';
  if (detail.length === 0) {
    html = '<p style="color:var(--text-muted);font-size:13px;margin-top:12px">No warehouse detail available.</p>';
  } else {
    html = '<table class="whs-table"><thead><tr><th>Warehouse</th><th>Code</th><th style="text-align:right">Stock on hand</th></tr></thead><tbody>';
    let total = 0;
    detail.forEach(w => {
      total += w.on_hand || 0;
      html += `<tr>
        <td>${w.whs_name || w.whs_code}</td>
        <td style="color:var(--text-muted)">${w.whs_code}</td>
        <td style="text-align:right;font-weight:500">${fmt(w.on_hand)}</td>
      </tr>`;
    });
    html += `<tr style="background:var(--gray-bg)">
      <td colspan="2" style="font-weight:500;color:var(--text-secondary)">Total</td>
      <td style="text-align:right;font-weight:500">${fmt(total)}</td>
    </tr>`;
    html += '</tbody></table>';
  }

  document.getElementById('whs-modal-body').innerHTML = html;
  document.getElementById('whs-modal').style.display = 'flex';
};

// ── Order qty inputs ───────────────────────────────
window.onPcsInput = function(ek, key, ctnSize) {
  const pcsEl = document.getElementById('pcs-' + ek);
  const ctnEl = document.getElementById('ctn-' + ek);
  const pcs   = parseInt(pcsEl.value) || 0;
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
  updateOrderSummary();
};

window.onCtnInput = function(ek, key, ctnSize) {
  if (!ctnSize) return;
  const pcsEl = document.getElementById('pcs-' + ek);
  const ctnEl = document.getElementById('ctn-' + ek);
  const ctn   = parseInt(ctnEl.value) || 0;
  if (ctn > 0) {
    const pcs = ctn * ctnSize;
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
  updateOrderSummary();
};

function updateOrderSummary() {
  const count = Object.keys(orderQtys).length;
  document.getElementById('order-summary').textContent =
    count > 0 ? `${count} item${count !== 1 ? 's' : ''} with quantities` : '';
}

// ── Export ─────────────────────────────────────────
window.exportReplen = function(format) {
  var vendor = (document.getElementById('vendor-select').value || '').trim();
  var filter = document.getElementById('filter-select').value;
  var rows   = filter === 'all' ? allData.slice() : allData.filter(function(r) { return r.needs_ordering; });
  if (vendor) rows = rows.filter(function(r) { return (r.vendor_name || '').trim() === vendor; });

  var exportRows = rows.filter(function(r) { return orderQtys[r.item_code]; });
  if (exportRows.length === 0) {
    alert('No order quantities entered. Please enter quantities before exporting.');
    return;
  }

  // Detect currency from first item
  var currency = exportRows[0].last_purchase_currency || 'KES';

  // Build common data
  var dateLabel    = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  var vendorLabel  = vendor || 'All Vendors';
  var siteLabel    = site || '';
  var preparedBy = (session && session.name) ? session.name : (session && session.email) ? session.email : '';

  var tableRows = [];
  var total = 0;
  exportRows.forEach(function(r, i) {
    var oqPcs    = orderQtys[r.item_code];
    var oqCtn    = (oqPcs && r.pcs_per_ctn) ? parseFloat((oqPcs / r.pcs_per_ctn).toFixed(2)) : '';
    var price    = r.last_purchase_price ? Number(r.last_purchase_price) : 0;
    var subtotal = price ? oqPcs * price : 0;
    total += subtotal;
    tableRows.push([
      i + 1,
      r.item_name,
      oqPcs,
      oqCtn || '—',
      price ? price.toFixed(2) : '—',
      subtotal ? subtotal.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
    ]);
  });

  if (format === 'xlsx') {
    var wsData = [
      ['FINSBURY TRADING LTD'],
      ['Date: ' + dateLabel],
      ['Vendor: ' + vendorLabel],
      [],
      ['#', 'Item Name', 'Qty (pcs)', 'Qty (ctn)', 'Last price (' + currency + ')', 'Subtotal (' + currency + ')']
    ];
    tableRows.forEach(function(r) { wsData.push(r); });
    wsData.push([]);
    wsData.push(['', '', '', '', 'Total (' + currency + ')', total.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })]);

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 4 }, { wch: 45 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 18 }];
    ['A1','A2','A3','A5','B5','C5','D5','E5','F5'].forEach(function(cell) {
      if (ws[cell]) ws[cell].s = { font: { bold: true } };
    });
    XLSX.utils.book_append_sheet(wb, ws, 'Order');
    XLSX.writeFile(wb, 'order_' + site + '_' + today() + '.xlsx');
    return;
  }

  // PDF export
  var doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  var pageW = doc.internal.pageSize.getWidth();

  // Logo
  var logoBase64 = '/9j/4AAQSkZJRgABAQEAyADIAAD/7gAOQWRvYmUAZAAAAAAA/+4ADkFkb2JlAGQAAAAAAP/bAEMADAgICAgIDAgIDBALCwsMDw4NDQ4UEg4OExMSFxQSFBQaGxcUFBseHicbFCQnJycnJDI1NTUyOzs7Ozs7Ozs7O//bAEMBDQsLDgsOEQ8PEhgRERESFxsYFBQXHhcYIBgXHiUeHh4eHh4lIygoKCgoIywwMDAwLDc7Ozs3Ozs7Ozs7Ozs7O//bAEMCDQsLDgsOEQ8PEhgRERESFxsYFBQXHhcYIBgXHiUeHh4eHh4lIygoKCgoIywwMDAwLDc7Ozs3Ozs7Ozs7Ozs7O//bAEMDDQsLDgsOEQ8PEhgRERESFxsYFBQXHhcYIBgXHiUeHh4eHh4lIygoKCgoIywwMDAwLDc7Ozs3Ozs7Ozs7Ozs7O//AABQIAZACWAQAIgABEQECEQIDIgP/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/2gAOBAAAAQACAAMAAD8A9Vooor06vTq9OooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooopjSxJkMwBHUZ5/KomvYF6Et9B/jis+71rTbHIuLuGIjqrSLv4OD8uc8HrxWfd61ptjkXF3DER1VpF3cHB+XOeD14oopMgUm8VYoqodQGflQke5wf5GmG/kz8qqB75J/mKxZ/HugQ5AuTKQ2CI4pD+OSoBH0NY0/jzQIcgXJlIbBEcUh/HJUAj6GnUUzf7Um81eoqh9vm9F/I/wCNM+13H9/9B/hVOX4k6LHjatxLnP3I1GPrvdf0qnL8SNFjxtW4lzn7kajH13Ov6VJRUe80bj61pUVm/a7j+/8AoP8ACnC+mAwdp9yOf0IpIviV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iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiv/Z';

  // Red header bar
  doc.setFillColor(192, 57, 43);
  doc.rect(0, 0, pageW, 28, 'F');

  // Logo on header
  doc.addImage(logoBase64, 'JPEG', 6, 2, 24, 24);

  // Company name in header
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('FINSBURY TRADING LTD.', 34, 11);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.text('"Distribution Excellence"', 34, 17);

  // PURCHASE ORDER label on right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('PURCHASE ORDER', pageW - 10, 14, { align: 'right' });

  // Header info rows
  doc.setTextColor(80, 80, 80);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  var y = 36;
  doc.text('Date:', 10, y);
  doc.setFont('helvetica', 'bold');
  doc.text(dateLabel, 35, y);
  doc.setFont('helvetica', 'normal');
  doc.text('Vendor:', 105, y);
  doc.setFont('helvetica', 'bold');
  doc.text(vendorLabel, 125, y);

  y = 43;
  doc.setFont('helvetica', 'normal');
  doc.text('Site:', 10, y);
  doc.setFont('helvetica', 'bold');
  doc.text(siteLabel, 35, y);
  doc.setFont('helvetica', 'normal');
  doc.text('Prepared by:', 105, y);
  doc.setFont('helvetica', 'bold');
  doc.text(preparedBy, 135, y);

  // Table
  doc.autoTable({
    startY: 50,
    head: [[
      '#',
      'Item name',
      'Qty (pcs)',
      'Qty (ctn)',
      'Last price (' + currency + ')',
      'Subtotal (' + currency + ')'
    ]],
    body: tableRows,
    foot: [[
      '', '', '', '',
      { content: 'TOTAL (' + currency + ')', styles: { fontStyle: 'bold', halign: 'right' } },
      { content: total.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), styles: { fontStyle: 'bold' } }
    ]],
    headStyles: {
      fillColor: [192, 57, 43],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9
    },
    footStyles: {
      fillColor: [245, 245, 245],
      textColor: [192, 57, 43],
      fontSize: 10
    },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 70 },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 30, halign: 'right' }
    },
    margin: { left: 10, right: 10 }
  });

  // Authorised by signature line
  var finalY = doc.lastAutoTable.finalY + 15;
  doc.setDrawColor(180, 180, 180);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('Authorised by', 10, finalY);
  doc.line(10, finalY + 12, 80, finalY + 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Signature / Date', 10, finalY + 17);

  doc.save('order_' + site + '_' + today() + '.pdf');
};

window.exportSlow = function() {
  const rows = allData.filter(r => r.is_slow_moving);
  const csvRows = [
    ['Item code','Item name','Group','Stock','Cover (days)','Target (days)','90d rate','30d rate','Trend %','Vendor'].join(',')
  ];
  rows.forEach(r => {
    csvRows.push([
      r.item_code, `"${r.item_name}"`, r.grp_name || '',
      r.stock_on_hand, r.cover_days || '', r.target_days || '',
      r.daily_rate_90d ? r.daily_rate_90d.toFixed(2) : '',
      r.daily_rate_30d ? r.daily_rate_30d.toFixed(2) : '',
      r.trend_pct || '', r.vendor_name || ''
    ].join(','));
  });
  downloadCsv(csvRows.join('\n'), `slow_moving_${site}_${today()}.csv`);
};

window.exportDead = function() {
  const rows = allData.filter(r => r.is_dead_stock);
  const csvRows = [
    ['Item code','Item name','Group','Stock','Last sale','90d returns','Vendor'].join(',')
  ];
  rows.forEach(r => {
    csvRows.push([
      r.item_code, `"${r.item_name}"`, r.grp_name || '',
      r.stock_on_hand, r.last_sale_date || '',
      r.total_returns_90d || 0, r.vendor_name || ''
    ].join(','));
  });
  downloadCsv(csvRows.join('\n'), `dead_stock_${site}_${today()}.csv`);
};

// ── Site switching ─────────────────────────────────
window.switchSite = function() {
  const target = site === 'Nairobi' ? 'Mombasa' : 'Nairobi';
  document.getElementById('switch-modal-body').innerHTML =
    `You are on <strong>${site}</strong>. Switching to <strong>${target}</strong> will reload all data. Any unsaved order quantities will be lost.`;
  document.getElementById('switch-modal').style.display = 'flex';
};

window.confirmSwitch = function() {
  const target = site === 'Nairobi' ? 'Mombasa' : 'Nairobi';
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
  if (pct > 10)  return `<span class="trend-up">+${pct}%</span>`;
  if (pct < -10) return `<span class="trend-down">${pct}%</span>`;
  return '<span class="trend-flat">stable</span>';
}

function statusBadge(status) {
  if (status === 'critical') return '<span class="badge badge-critical">Critical</span>';
  if (status === 'low')      return '<span class="badge badge-low">Low</span>';
  return '<span class="badge badge-ok">OK</span>';
}

function downloadCsv(content, filename) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function setTableLoading(loading) {
  ['tbody-replen','tbody-slow','tbody-dead'].forEach(id => {
    const el = document.getElementById(id);
    if (el && loading) {
      el.innerHTML = `<tr><td colspan="11" class="empty-state">
        <span class="spinner spinner-dark" style="width:18px;height:18px;border-color:rgba(0,0,0,0.1);border-top-color:var(--accent)"></span>
        &nbsp; Loading...
      </td></tr>`;
    }
  });
}
