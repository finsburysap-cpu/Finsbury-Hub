import { getSupabase } from './supabase.js';
import { requireAuth, signOutAll, getSession } from './auth.js';

const sb = getSupabase();
let session   = null;
let site      = null;
let allPOs    = [];   // purchase_orders rows
let allLines  = [];   // po_lines rows

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  session = await requireAuth();
  if (!session) return;

  site = session.site;
  if (!site) { window.location.href = 'site-select.html'; return; }

  document.getElementById('site-pill').textContent = site;
  window.signOutAll = signOutAll;

  await loadData();
  updateSyncTimestamp();
}

// ── Load data ──────────────────────────────────────────────────────────────
async function loadData() {
  document.getElementById('sync-label').textContent = 'Loading...';

  const [posRes, linesRes] = await Promise.all([
    sb.from('purchase_orders').select('*').eq('site_name', site).order('po_date', { ascending: false }),
    sb.from('po_lines').select('*').eq('site_name', site)
  ]);

  allPOs   = posRes.data  || [];
  allLines = linesRes.data || [];

  populateVendorFilter();
  renderPOs();
  updateMetrics();
  updateSyncTimestamp();
}

// ── Populate vendor filter ─────────────────────────────────────────────────
function populateVendorFilter() {
  const sel     = document.getElementById('vendor-filter');
  const current = sel.value;
  const vendors = [...new Set(allPOs.map(p => p.vendor_name))].sort();
  sel.innerHTML = '<option value="">All vendors</option>';
  vendors.forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
  sel.value = current;
}

// ── Metrics ────────────────────────────────────────────────────────────────
function updateMetrics() {
  const posByNum = {};
  allPOs.forEach(p => { posByNum[p.po_number] = p; });

  // Group lines by PO
  const linesByPO = {};
  allLines.forEach(l => {
    if (!linesByPO[l.po_number]) linesByPO[l.po_number] = [];
    linesByPO[l.po_number].push(l);
  });

  let pending = 0, partial = 0;
  allPOs.forEach(po => {
    const lines  = linesByPO[po.po_number] || [];
    const status = poStatus(lines);
    if (status === 'pending') pending++;
    else if (status === 'partial') partial++;
  });

  const vendors = new Set(allPOs.map(p => p.vendor_name)).size;
  document.getElementById('m-open').textContent        = allPOs.length;
  document.getElementById('m-vendors-sub').textContent = vendors + ' vendor' + (vendors !== 1 ? 's' : '');
  document.getElementById('m-pending').textContent     = pending;
  document.getElementById('m-partial').textContent     = partial;

  // Outstanding value — open_qty × unit_price
  const total = allLines.reduce((s, l) => s + (parseFloat(l.open_qty) * parseFloat(l.unit_price || 0)), 0);
  document.getElementById('m-value').textContent = 'KES ' + total.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── PO status helper ───────────────────────────────────────────────────────
function poStatus(lines) {
  if (!lines.length) return 'pending';
  const totalOrdered  = lines.reduce((s, l) => s + parseFloat(l.ordered_qty || 0), 0);
  const totalOpen     = lines.reduce((s, l) => s + parseFloat(l.open_qty    || 0), 0);
  if (totalOpen >= totalOrdered) return 'pending';
  if (totalOpen > 0)             return 'partial';
  return 'done';
}

// ── Render POs ─────────────────────────────────────────────────────────────
window.renderPOs = function() {
  const vendorF = document.getElementById('vendor-filter').value;
  const statusF = document.getElementById('status-filter').value;
  const search  = document.getElementById('po-search').value.toLowerCase().trim();

  // Group lines by PO
  const linesByPO = {};
  allLines.forEach(l => {
    if (!linesByPO[l.po_number]) linesByPO[l.po_number] = [];
    linesByPO[l.po_number].push(l);
  });

  let pos = allPOs.slice();
  if (vendorF) pos = pos.filter(p => p.vendor_name === vendorF);
  if (statusF) pos = pos.filter(p => poStatus(linesByPO[p.po_number] || []) === statusF);
  if (search)  pos = pos.filter(p => {
    if (p.vendor_name.toLowerCase().includes(search)) return true;
    if (String(p.po_number).includes(search)) return true;
    const lines = linesByPO[p.po_number] || [];
    return lines.some(l => l.item_name.toLowerCase().includes(search));
  });

  const container = document.getElementById('po-list');
  if (pos.length === 0) {
    container.innerHTML = '<div class="empty-state">No purchase orders found</div>';
    return;
  }

  container.innerHTML = pos.map(po => {
    const lines  = linesByPO[po.po_number] || [];
    const status = poStatus(lines);
    const date   = po.po_date ? new Date(po.po_date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';
    const value  = lines.reduce((s, l) => s + parseFloat(l.open_qty) * parseFloat(l.unit_price || 0), 0);

    const statusBadge = status === 'pending'
      ? '<span class="badge badge-critical">Pending</span>'
      : status === 'partial'
      ? '<span class="badge badge-slow">Partial</span>'
      : '<span class="badge badge-ok">Done</span>';

    const linesHtml = lines.map(l => {
      const ordered  = parseFloat(l.ordered_qty || 0);
      const open     = parseFloat(l.open_qty    || 0);
      const received = ordered - open;
      const ls = open >= ordered ? 'pending' : open > 0 ? 'partial' : 'done';
      const lineBadge = ls === 'pending'
        ? '<span class="badge badge-critical" style="font-size:10px">Pending</span>'
        : ls === 'partial'
        ? '<span class="badge badge-slow" style="font-size:10px">Partial</span>'
        : '<span class="badge badge-ok" style="font-size:10px">Done</span>';

      return `<tr style="border-top:0.5px solid var(--border)">
        <td style="padding:6px 8px;white-space:normal;line-height:1.4">${l.item_name}</td>
        <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace">${ordered.toFixed(0)}</td>
        <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--color-success, #2d7a4f)">${received.toFixed(0)}</td>
        <td style="padding:6px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--amber)">${open.toFixed(0)}</td>
        <td style="padding:6px 8px;text-align:right">${lineBadge}</td>
      </tr>`;
    }).join('');

    return `<div class="po-card" style="background:var(--surface);border:0.5px solid var(--border);border-radius:12px;margin-bottom:12px;overflow:hidden">
      <div class="po-header" style="padding:12px 16px;display:grid;grid-template-columns:1fr auto auto auto auto;gap:12px;align-items:center;cursor:pointer" onclick="togglePO(${po.po_number})">
        <div>
          <span style="font-size:13px;font-weight:500;color:var(--text-primary)">PO-${po.po_number}</span>
          <span style="font-size:12px;color:var(--text-secondary);margin-left:12px">${po.vendor_name}</span>
        </div>
        <span style="font-size:12px;color:var(--text-muted)">${date}</span>
        <span style="font-size:12px;color:var(--text-secondary)">${lines.length} item${lines.length !== 1 ? 's' : ''}</span>
        <span style="font-size:13px;font-weight:500;font-family:'DM Mono',monospace">KES ${value.toLocaleString('en-GB', {minimumFractionDigits:0,maximumFractionDigits:0})}</span>
        ${statusBadge}
      </div>
      <div id="po-detail-${po.po_number}" style="display:none;border-top:0.5px solid var(--border);padding:0 16px 12px">
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:12px;table-layout:fixed">
          <thead>
            <tr style="color:var(--text-muted)">
              <th style="text-align:left;padding:4px 8px;font-weight:500;width:44%">Item</th>
              <th style="text-align:right;padding:4px 8px;font-weight:500;width:14%">Ordered</th>
              <th style="text-align:right;padding:4px 8px;font-weight:500;width:14%">Received</th>
              <th style="text-align:right;padding:4px 8px;font-weight:500;width:14%">Balance</th>
              <th style="text-align:right;padding:4px 8px;font-weight:500;width:14%">Status</th>
            </tr>
          </thead>
          <tbody>${linesHtml}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
};

// ── Toggle PO detail ───────────────────────────────────────────────────────
window.togglePO = function(poNumber) {
  const detail = document.getElementById('po-detail-' + poNumber);
  if (!detail) return;
  detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
};

// ── Sync timestamp ─────────────────────────────────────────────────────────
async function updateSyncTimestamp() {
  const { data } = await sb
    .from('sync_log')
    .select('run_at')
    .eq('status', 'success')
    .order('run_at', { ascending: false })
    .limit(1);

  const dot   = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  if (data && data.length > 0) {
    const ago = Math.round((Date.now() - new Date(data[0].run_at)) / 60000);
    dot.className   = 'sync-dot sync-ok';
    label.textContent = ago < 2 ? 'Just synced' : ago + ' min ago';
  } else {
    dot.className   = 'sync-dot sync-warn';
    label.textContent = 'Unknown';
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
      const { data } = await sb.from('sync_log').select('run_at,status').eq('status', 'success').gt('run_at', startedAt).order('run_at', { ascending: false }).limit(1);
      if (data && data.length > 0) { synced = true; break; }
      document.getElementById('sync-label').textContent = 'Syncing... ' + Math.round((Date.now() - started) / 1000) + 's';
    }

    if (synced) {
      document.getElementById('sync-label').textContent = 'Sync complete — reloading...';
      await loadData();
    } else {
      document.getElementById('sync-label').textContent = 'Sync timed out — try again';
    }
  } catch (err) {
    console.error('Refresh error:', err);
    document.getElementById('sync-label').textContent = 'Refresh failed';
  } finally {
    setTimeout(function() {
      btn.disabled = false;
      txt.style.display = 'inline';
      spinner.style.display = 'none';
      updateSyncTimestamp();
    }, 120000);
  }
};

// ── Switch site ─────────────────────────────────────────────────────────────
window.switchSite = function() {
  const target = site === 'Nairobi' ? 'Mombasa' : 'Nairobi';
  document.getElementById('switch-modal-body').textContent = 'Switch to ' + target + '?';
  document.getElementById('switch-modal').style.display = 'flex';
};

window.confirmSwitch = async function() {
  const target = site === 'Nairobi' ? 'Mombasa' : 'Nairobi';
  const s = JSON.parse(sessionStorage.getItem('ftl_session') || '{}');
  s.site = target;
  sessionStorage.setItem('ftl_session', JSON.stringify(s));
  window.location.reload();
};

init();
