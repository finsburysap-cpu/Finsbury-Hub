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
function renderReplen() {
  const vendor  = document.getElementById('vendor-select').value;
  const filter  = document.getElementById('filter-select').value;
  const search  = document.getElementById('replen-search').value.toLowerCase();

  let rows = allData.filter(r => !r.is_dead_stock);

  if (vendor) rows = rows.filter(r => r.vendor_name === vendor);
  if (filter === 'needs') rows = rows.filter(r => r.needs_ordering);
  if (search) rows = rows.filter(r =>
    r.item_name.toLowerCase().includes(search) ||
    (r.item_code || '').toLowerCase().includes(search)
  );

  // Sort: critical first, then low, then ok
 rows.sort(function(a, b) {
  var vendorA = (a.vendor_name || '').toLowerCase();
  var vendorB = (b.vendor_name || '').toLowerCase();
  if (vendorA < vendorB) return -1;
  if (vendorA > vendorB) return 1;
  // Same vendor — sort by cover days ascending (most urgent first)
  var coverA = a.cover_days != null ? a.cover_days : 9999;
  var coverB = b.cover_days != null ? b.cover_days : 9999;
  return coverA - coverB;
});

  document.getElementById('tc-replen').textContent = rows.length;

  const tbody = document.getElementById('tbody-replen');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-state">No items found</td></tr>`;
    updateOrderSummary();
    return;
  }

  rows.forEach(r => {
    const key        = r.item_code;
    const savedPcs   = orderQtys[key] || '';
    const ctn        = r.pcs_per_ctn || 0;
    const savedCtn   = savedPcs && ctn ? Math.ceil(savedPcs / ctn) : '';
    const suggestCtn = r.suggest_qty_pcs && ctn
      ? `${Math.ceil(r.suggest_qty_pcs / ctn)} ctn`
      : '';
    const coverStr   = r.cover_days != null ? `${r.cover_days}d` : '—';
    const coverColor = r.cover_days == null ? '' :
      r.cover_days < (r.target_days * 0.5) ? 'color:var(--red);font-weight:500' :
      r.cover_days < r.target_days          ? 'color:var(--amber);font-weight:500' : '';

    const tr = document.createElement('tr');
    const ek = key.replace(/[^a-zA-Z0-9]/g, '_');

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
    `;
    tbody.appendChild(tr);
  });

  updateOrderSummary();
}

// ── Slow moving tab ────────────────────────────────
function renderSlow() {
  const search = document.getElementById('slow-search').value.toLowerCase();
  let rows = allData.filter(r => r.is_slow_moving);
  if (search) rows = rows.filter(r =>
    r.item_name.toLowerCase().includes(search) ||
    (r.vendor_name || '').toLowerCase().includes(search)
  );

  document.getElementById('tc-slow').textContent = rows.length;
  const tbody = document.getElementById('tbody-slow');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">No slow moving items</td></tr>`;
    return;
  }

  rows.forEach(r => {
    const reason = r.daily_rate_30d < r.daily_rate_90d * 0.5
      ? 'Velocity drop'
      : 'Cover 2× target';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${r.item_name}" style="font-weight:500;white-space:normal;line-height:1.4">${r.item_name}</td>
      <td style="color:var(--text-secondary)">${r.grp_name || '—'}</td>
      <td>
        <span style="font-family:'DM Mono',monospace">${fmt(r.stock_on_hand)}</span>
        <button class="btn-expand" style="margin-left:4px" onclick="showWhsDetail('${r.item_code}','${r.item_name}')">▾</button>
      </td>
      <td style="color:var(--amber);font-weight:500">${r.cover_days != null ? r.cover_days + 'd' : '—'}</td>
      <td style="color:var(--text-muted)">${r.target_days ? r.target_days + 'd' : '—'}</td>
      <td style="font-family:'DM Mono',monospace">${r.daily_rate_90d ? r.daily_rate_90d.toFixed(1) + '/d' : '—'}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--red)">${r.daily_rate_30d ? r.daily_rate_30d.toFixed(1) + '/d' : '—'}</td>
      <td>${trendHtml(r.trend_pct)}</td>
      <td><span class="badge badge-slow">${reason}</span></td>
      <td style="color:var(--text-secondary)">${r.vendor_name || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Dead stock tab ─────────────────────────────────
function renderDead() {
  const search = document.getElementById('dead-search').value.toLowerCase();
  let rows = allData.filter(r => r.is_dead_stock);
  if (search) rows = rows.filter(r =>
    r.item_name.toLowerCase().includes(search) ||
    (r.vendor_name || '').toLowerCase().includes(search)
  );

  // Sort by days inactive desc
  rows.sort((a, b) => (b.cover_days || 0) - (a.cover_days || 0));

  document.getElementById('tc-dead').textContent = rows.length;
  const tbody = document.getElementById('tbody-dead');
  tbody.innerHTML = '';

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No dead stock items</td></tr>`;
    return;
  }

  rows.forEach(r => {
    const lastSale = r.last_sale_date
      ? new Date(r.last_sale_date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      : 'Never';
    const daysInactive = r.last_sale_date
      ? Math.floor((Date.now() - new Date(r.last_sale_date).getTime()) / 86400000)
      : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${r.item_name}" style="font-weight:500;white-space:normal;line-height:1.4">${r.item_name}</td>
      <td style="color:var(--text-secondary)">${r.grp_name || '—'}</td>
      <td>
        <span style="font-family:'DM Mono',monospace">${fmt(r.stock_on_hand)}</span>
        <button class="btn-expand" style="margin-left:4px" onclick="showWhsDetail('${r.item_code}','${r.item_name}')">▾</button>
      </td>
      <td style="color:var(--text-secondary)">${lastSale}</td>
      <td style="color:var(--red);font-weight:500;font-family:'DM Mono',monospace">${daysInactive}${typeof daysInactive === 'number' ? 'd' : ''}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--text-secondary)">${fmt(r.total_returns_90d)} pcs</td>
      <td style="color:var(--text-secondary)">${r.vendor_name || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

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
  const vendor = document.getElementById('vendor-select').value;
  const filter = document.getElementById('filter-select').value;
  let rows = allData.filter(r => !r.is_dead_stock);
  if (vendor) rows = rows.filter(r => r.vendor_name === vendor);
  if (filter === 'needs') rows = rows.filter(r => r.needs_ordering);

  // Only export rows with qty entered if any exist, else export all visible
  const withQty = rows.filter(r => orderQtys[r.item_code]);
  const exportRows = withQty.length > 0 ? withQty : rows;

  const csvRows = [
    ['Item code', 'Item name', 'Group', 'Vendor', 'Stock on hand', 'Cover (days)',
     'Target (days)', '90d rate', 'Trend %', 'Open PO', 'Suggested (pcs)',
     'Suggested (ctn)', 'Order qty (pcs)', 'Order qty (ctn)', 'Status'].join(',')
  ];

  exportRows.forEach(r => {
    const oqPcs = orderQtys[r.item_code] || '';
    const oqCtn = oqPcs && r.pcs_per_ctn ? Math.ceil(oqPcs / r.pcs_per_ctn) : '';
    const sugCtn = r.suggest_qty_pcs && r.pcs_per_ctn
      ? Math.ceil(r.suggest_qty_pcs / r.pcs_per_ctn) : '';
    csvRows.push([
      r.item_code,
      `"${r.item_name}"`,
      r.grp_name || '',
      r.vendor_name || '',
      r.stock_on_hand,
      r.cover_days || '',
      r.target_days || '',
      r.daily_rate_90d ? r.daily_rate_90d.toFixed(2) : '',
      r.trend_pct || '',
      r.open_po_qty || 0,
      r.suggest_qty_pcs || '',
      sugCtn,
      oqPcs,
      oqCtn,
      r.stock_status,
    ].join(','));
  });

  const filename = `replenishment_${site}_${today()}.csv`;
  downloadCsv(csvRows.join('\n'), filename);
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
