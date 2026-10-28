/* ── State ── */
let catalog = { categories: [], sections: {} };
let activeCatId = null;
let srvCount = 0;
let srvIds = [];

const WITH_QTY = new Set(["ram", "raid_disks", "os_ssd", "gpu", "cpu", "pci_card_1", "pci_card_2", "network"]);
const QTY_MAX  = {};  // no hard limits — case drive slots validation handles this
const REQUIRED  = new Set(["cpu", "motherboard", "cpu_cooler", "ram", "os_ssd", "case", "psu", "os"]);

/* ── Boot ── */
document.addEventListener("DOMContentLoaded", async () => {
  await fetchCatalog();
  bindTabs();
  bindCfgButtons();
  bindCatButtons();
  addServer(); // start with one blank server
  loadUsers();
  loadAssignees();
});

/* ── API helpers ── */
async function api(method, url, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  return r.json();
}

async function fetchCatalog() {
  catalog = await api("GET", "/api/catalog");
  const dateEl = document.getElementById("catalog-date");
  if (dateEl) dateEl.textContent = catalog._updated || "—";
  renderCatSidebar();
}

/* ── Tabs ── */
function bindTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("pane-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "saved") loadSavedList();
      if (btn.dataset.tab === "srvcalc") setTimeout(scCalc, 50);
    });
  });
}

/* ══════════════════════════════
   CONFIGURATOR
══════════════════════════════ */
function bindCfgButtons() {
  document.getElementById("btn-add-server").addEventListener("click", addServer);
  document.getElementById("btn-build-table").addEventListener("click", buildTable);
  document.getElementById("btn-copy").addEventListener("click", copyTable);
}

function getCatById(id) {
  return catalog.categories.find(c => c.id === id);
}

function orderedCats() {
  const seen   = new Set();
  const result = [];
  // Use explicit section_order if available, fall back to Object.entries
  const sectionKeys = catalog.section_order ||
                      Object.keys(catalog.sections);
  for (const sec of sectionKeys) {
    const ids = catalog.sections[sec] || [];
    for (const id of ids) {
      if (!seen.has(id) && getCatById(id)) { result.push([sec, id]); seen.add(id); }
    }
  }
  for (const cat of catalog.categories) {
    if (!seen.has(cat.id)) { result.push(["Misc", cat.id]); seen.add(cat.id); }
  }
  return result;
}

function addServer() {
  srvCount++;
  const id = "srv" + srvCount;
  srvIds.push(id);
  document.getElementById("srv-empty").style.display = "none";

  const card = document.createElement("div");
  card.className = "server-card";
  card.id = id;
  card.innerHTML = buildCardHTML(id, srvCount);
  document.getElementById("srv-list").appendChild(card);

  card.querySelector(".qbtn[data-dir='-1']").addEventListener("click", () => adjSrvQty(id, -1));
  card.querySelector(".qbtn[data-dir='1']").addEventListener("click",  () => adjSrvQty(id,  1));
  card.querySelector(".btn-remove-srv").addEventListener("click", () => removeServer(id));
}

function buildCardHTML(id, num) {
  const ordered = orderedCats();
  let sectionsUsed = {};
  ordered.forEach(([sec, catId]) => { if (!sectionsUsed[sec]) sectionsUsed[sec] = []; sectionsUsed[sec].push(catId); });

  // Categories that auto-select their first (only) item
  const AUTO_SELECT  = new Set(["case", "psu", "cpu_cooler"]);
  // Categories that support a secondary optional select
  const DUAL_SELECT  = new Set(["os"]);
  // Categories that use multi-row instead of single select
  const MULTI_ROW    = new Set(["seldom_used"]);

  let html = `
    <div class="srv-hdr">
      <div class="srv-num">${num}</div>
      <input class="srv-name" type="text" value="Server ${num}" placeholder="Server name">
      <div class="qty-wrap">
        <span class="qty-lbl">Qty:</span>
        <button class="qbtn" data-dir="-1">−</button>
        <span class="qty-v">1</span>
        <button class="qbtn" data-dir="1">+</button>
      </div>
      <div id="${id}-tdp" style="font-size:12px;color:var(--muted);margin-left:auto;padding:0 10px;white-space:nowrap">
        TDP: <span class="tdp-val" style="color:var(--text);font-weight:600">—</span> W
      </div>
      <div id="${id}-pcie-warn" style="display:none;font-size:11px;color:var(--danger);padding:0 6px;white-space:nowrap" title="">
        <i class="ti ti-alert-triangle"></i> Slots
      </div>
      <button class="btn danger btn-remove-srv" style="margin-left:4px" title="Remove server"><i class="ti ti-x"></i></button>
    </div>
    <div class="comp-grid">`;

  let lastSec = null;
  for (const [sec, catId] of ordered) {
    const cat = getCatById(catId);
    if (!cat) continue;
    if (sec !== lastSec) { html += `<div class="sec-hdr">${esc(sec)}</div>`; lastSec = sec; }

    const secItems = sectionsUsed[sec];
    const posInSec = secItems.indexOf(catId);
    const isFull  = secItems.length % 2 !== 0 && posInSec === secItems.length - 1;
    const selId   = `${id}-${catId}`;
    const hasQty  = WITH_QTY.has(catId) || cat.has_qty;
    const autoSel = AUTO_SELECT.has(catId) && cat.items.length > 0;
    const dual    = DUAL_SELECT.has(catId);
    const multi   = MULTI_ROW.has(catId);

    // CPU items are objects, others are strings
    const opts = cat.items.map(o => {
      const val  = typeof o === "object" ? o.name : o;
      const meta = typeof o === "object" ? JSON.stringify({mem_channels: o.mem_channels, mem_type: o.mem_type, pcie_slot: o.pcie_slot}) : "";
      const sel  = autoSel && o === cat.items[0];
      return `<option${sel ? " selected" : ""} data-meta='${meta}'>${esc(val)}</option>`;
    }).join("");

    // ── Multi-row (Seldom Used) ──────────────────────────────
    if (multi) {
      html += `
      <div class="comp-cell full" id="${selId}-wrap">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <span class="comp-lbl">${esc(cat.name)}</span>
          <button class="btn ghost" style="height:22px;padding:0 8px;font-size:11px"
            onclick="addSeldomRow('${id}','${catId}')">
            <i class="ti ti-plus" style="font-size:11px"></i> Add
          </button>
        </div>
        <div id="${selId}-rows"></div>
      </div>`;
      continue;
    }

    const qtyHtml = hasQty ? `
      <button class="cqbtn" data-selid="${selId}" data-dir="-1">−</button>
      <span class="cqv" id="${selId}-qty">1</span>
      <button class="cqbtn" data-selid="${selId}" data-dir="1">+</button>` : "";

    // Second OS select (add-on license)
    const dualHtml = dual ? `
      <select class="comp-sel" id="${selId}-addon" style="margin-top:4px;font-size:11px;color:var(--muted)" title="Add-on license (optional)">
        <option value="">+ add-on license (optional)</option>
        ${cat.items.map(o => `<option>${esc(o)}</option>`).join("")}
      </select>
      <div style="display:flex;align-items:center;gap:4px;margin-top:4px;font-size:10px;color:var(--muted)">
        Add-on qty:
        <button class="cqbtn" data-selid="${selId}-addon" data-dir="-1">−</button>
        <span class="cqv" id="${selId}-addon-qty">1</span>
        <button class="cqbtn" data-selid="${selId}-addon" data-dir="1">+</button>
      </div>` : "";

    html += `
      <div class="comp-cell${isFull ? " full" : ""}">
        <span class="comp-lbl">${esc(cat.name)}</span>
        <select class="comp-sel" id="${selId}"
          ${catId === 'cpu' ? `onchange="onCpuChange('${id}', this)"` : ""}
          onchange="calcTdp('${id}'); validatePcie('${id}')">
          <option value="">— none —</option>
          ${opts}
        </select>
        ${qtyHtml}
        ${dualHtml}
      </div>`;
  }
  html += `</div>`;
  return html;
}

document.addEventListener("click", e => {
  // component qty buttons (delegated)
  const cqbtn = e.target.closest(".cqbtn");
  if (cqbtn) {
    const selId = cqbtn.dataset.selid;
    const span = document.getElementById(selId + "-qty");
    if (span) {
      const catId = selId.replace(/^srv\d+-/, "");
      const max = QTY_MAX[catId] || 99;
      span.textContent = Math.min(max, Math.max(1, parseInt(span.textContent) + parseInt(cqbtn.dataset.dir)));
    }
    // Recalc after qty change for any relevant component
    const srvId = selId.replace(/-\w+$/, "").replace(/-addon$/, "");
    const tdpCats  = new Set(["ram","cpu","gpu","raid_disks","os_ssd","network","raid_controller","pci_card_1","pci_card_2"]);
    const slotsChg = new Set(["raid_disks","os_ssd","gpu","network","raid_controller","pci_card_1","pci_card_2"]);
    const catId2   = selId.replace(/^srv\d+-/, "").replace(/-addon$/, "");
    if (tdpCats.has(catId2) || slotsChg.has(catId2)) {
      setTimeout(() => {
        if (selId.includes("-ram")) validateRam(srvId);
        calcTdp(srvId);       // also calls validatePcie internally
        validatePcie(srvId);  // call directly to be sure
      }, 50);
    }
  }
});

function adjSrvQty(id, d) {
  const span = document.querySelector(`#${id} .qty-v`);
  span.textContent = Math.max(1, parseInt(span.textContent) + d);
}

function removeServer(id) {
  document.getElementById(id)?.remove();
  srvIds = srvIds.filter(s => s !== id);
  if (srvIds.length === 0) document.getElementById("srv-empty").style.display = "";
}

function refreshAllCards() {
  for (const id of srvIds) {
    const card = document.getElementById(id);
    if (!card) continue;

    // Save current state
    const name = card.querySelector(".srv-name")?.value || "";
    const qty  = card.querySelector(".qty-v")?.textContent || "1";

    // Save all select values and qty spans
    const saved = {};
    card.querySelectorAll("select.comp-sel").forEach(sel => {
      saved[sel.id] = { value: sel.value };
    });
    card.querySelectorAll("span.cqv").forEach(span => {
      if (span.id) saved[span.id] = { text: span.textContent };
    });
    // Save seldom_used rows
    const seldomRows = [];
    const seldomContainer = document.getElementById(`${id}-seldom_used-rows`);
    if (seldomContainer) {
      seldomContainer.querySelectorAll("div[id]").forEach(row => {
        const sel = row.querySelector("select");
        const qty = row.querySelector(".cqv");
        if (sel) seldomRows.push({ value: sel.value, qty: qty?.textContent || "1" });
      });
    }

    // Rebuild
    const num = id.replace("srv", "");
    card.innerHTML = buildCardHTML(id, num);

    // Restore
    card.querySelector(".srv-name").value = name;
    card.querySelector(".qty-v").textContent = qty;
    card.querySelector(".qbtn[data-dir='-1']").addEventListener("click", () => adjSrvQty(id, -1));
    card.querySelector(".qbtn[data-dir='1']").addEventListener("click",  () => adjSrvQty(id,  1));
    card.querySelector(".btn-remove-srv").addEventListener("click", () => removeServer(id));

    // Restore select values and qty spans
    Object.entries(saved).forEach(([elId, state]) => {
      const el = document.getElementById(elId);
      if (!el) return;
      if (state.value !== undefined) el.value = state.value;
      if (state.text  !== undefined) el.textContent = state.text;
    });

    // Restore seldom_used rows
    seldomRows.forEach(r => {
      const cat = getCatById("seldom_used"); if (!cat) return;
      addSeldomRow(id, "seldom_used");
      const container = document.getElementById(`${id}-seldom_used-rows`);
      const rows = container?.querySelectorAll("div[id]");
      const last = rows?.[rows.length - 1];
      if (last) {
        const sel = last.querySelector("select");
        const qty = last.querySelector(".cqv");
        if (sel) sel.value = r.value;
        if (qty) qty.textContent = r.qty;
      }
    });

    calcTdp(id);
    validatePcie(id);
  }
}

function buildTable() {
  const cards = document.querySelectorAll(".server-card");
  if (!cards.length) { alert("Add at least one server first."); return; }

  // Validate required fields
  let hasErrors = false;
  cards.forEach(card => {
    const id = card.id;
    REQUIRED.forEach(catId => {
      const sel = document.getElementById(`${id}-${catId}`);
      if (!sel) return;
      const missing = !sel.value;
      sel.style.borderColor = missing ? "var(--danger)" : "";
      sel.style.background  = missing ? "rgba(239,68,68,.08)" : "";
      if (missing) hasErrors = true;
    });
  });
  if (hasErrors) {
    alert("Some required components are missing (highlighted in red).\nPlease fill in: CPU, Motherboard, CPU Cooler, RAM, OS SSD, Case/PSU, OS.");
    return;
  }
  cards.forEach(card => {
    card.querySelectorAll(".comp-sel").forEach(sel => {
      sel.style.borderColor = "";
      sel.style.background  = "";
    });
  });

  const ordered = orderedCats();
  // colW: [Component, Qty, Model]
  let colW = [9, 3, 20];
  const rows = [];

  cards.forEach(card => {
    const id   = card.id;
    const name = card.querySelector(".srv-name").value || id;
    const qty  = parseInt(card.querySelector(".qty-v").textContent) || 1;
    const hdr  = name + (qty > 1 ? ` ×${qty}` : "");
    colW[2] = Math.max(colW[2], hdr.length);

    const comps = [];
    for (const [, catId] of ordered) {
      const cat = getCatById(catId); if (!cat) continue;
      const sel = document.getElementById(`${id}-${catId}`); if (!sel || !sel.value) continue;
      const hasQty = WITH_QTY.has(catId) || cat.has_qty;
      const qspan  = document.getElementById(`${id}-${catId}-qty`);
      const q      = (hasQty && qspan) ? (parseInt(qspan.textContent) || 1) : 1;
      const model  = sel.value;
      colW[0] = Math.max(colW[0], cat.name.length);
      colW[1] = Math.max(colW[1], String(q).length);
      colW[2] = Math.max(colW[2], model.length);
      comps.push([cat.name, q, model]);

      // Check for OS add-on
      if (catId === "os") {
        const addonSel = document.getElementById(`${id}-${catId}-addon`);
        if (addonSel?.value) {
          const addonQspan = document.getElementById(`${id}-${catId}-addon-qty`);
          const addonQ = addonQspan ? (parseInt(addonQspan.textContent) || 1) : 1;
          colW[2] = Math.max(colW[2], addonSel.value.length);
          comps.push([cat.name + " (add-on)", addonQ, addonSel.value]);
        }
      }
    }
    // ── Summary rows: TDP + free PCIe slots ──────────────────
    // TDP from header badge
    const tdpSpan = document.querySelector(`#${id}-tdp .tdp-val`);
    const tdpVal  = tdpSpan?.textContent || "—";
    const psuSel  = document.getElementById(`${id}-psu`);
    const psuCat  = getCatById("psu");
    const psuItem = psuCat?.items.find(it => (typeof it === "object" ? it.name : it) === psuSel?.value);
    const psuCap  = (typeof psuItem === "object" ? psuItem.tdp : 0) || 0;
    const tdpLine = psuCap ? `${tdpVal} W  /  ${psuCap} W PSU capacity` : `${tdpVal} W`;
    const tdpLabel = "Total TDP";
    colW[0] = Math.max(colW[0], tdpLabel.length);
    colW[2] = Math.max(colW[2], tdpLine.length);
    comps.push([tdpLabel, "", tdpLine]);

    // Free PCIe slots
    const mbSel2  = document.getElementById(`${id}-motherboard`);
    const mbCat2  = getCatById("motherboard");
    const mbItem2 = mbCat2?.items.find(it => (typeof it === "object" ? it.name : it) === mbSel2?.value);
    if (mbItem2 && typeof mbItem2 === "object") {
      let free = { x16: mbItem2.pcie_x16||0, x8: mbItem2.pcie_x8||0, x4: mbItem2.pcie_x4||0 };
      // Subtract used slots
      for (const catId2 of ["gpu","pci_card_1","pci_card_2","network","raid_controller"]) {
        const s2 = document.getElementById(`${id}-${catId2}`); if (!s2?.value) continue;
        const c2 = getCatById(catId2);
        const it2 = c2?.items.find(it => (typeof it === "object" ? it.name : it) === s2.value);
        const slot = (typeof it2 === "object" ? it2.pcie_slot : null) || "x8";
        const q2  = parseInt(document.getElementById(`${id}-${catId2}-qty`)?.textContent) || 1;
        if (free[slot] !== undefined) free[slot] = Math.max(0, free[slot] - q2);
      }
      const freeParts = [];
      if (free.x16 > 0) freeParts.push(`${free.x16}× x16`);
      if (free.x8  > 0) freeParts.push(`${free.x8}× x8`);
      if (free.x4  > 0) freeParts.push(`${free.x4}× x4`);
      const freeStr = freeParts.length ? freeParts.join(", ") : "none";
      const freeLabel = "Free PCIe slots";
      colW[0] = Math.max(colW[0], freeLabel.length);
      colW[2] = Math.max(colW[2], freeStr.length);
      comps.push([freeLabel, "", freeStr]);
    }

    rows.push({ hdr, comps });
  });

  // Store structured rows for clipboard copy
  window._jiraTableRows = rows;

  // Build HTML preview (renders as a real table, also used for clipboard copy)
  let html = "";
  rows.forEach((r, i) => {
    if (i > 0) html += `<div style="height:14px"></div>`;
    html += `<table style="border-collapse:collapse;width:100%;margin-bottom:4px;font-family:Arial,sans-serif;font-size:13px">`;
    html += `<thead><tr>`;
    html += `<th style="border:1px solid #c1c7d0;padding:6px 10px;background:#f4f5f7;text-align:left">Component</th>`;
    html += `<th style="border:1px solid #c1c7d0;padding:6px 10px;background:#f4f5f7;text-align:left">${escHtml(r.hdr)}</th>`;
    html += `<th style="border:1px solid #c1c7d0;padding:6px 10px;background:#f4f5f7;text-align:left">Qty</th>`;
    html += `</tr></thead><tbody>`;
    r.comps.forEach(c => {
      html += `<tr>`;
      html += `<td style="border:1px solid #c1c7d0;padding:6px 10px">${escHtml(c[0])}</td>`;
      html += `<td style="border:1px solid #c1c7d0;padding:6px 10px">${escHtml(c[2])}</td>`;
      html += `<td style="border:1px solid #c1c7d0;padding:6px 10px">${escHtml(String(c[1]))}</td>`;
      html += `</tr>`;
    });
    html += `</tbody></table>`;
  });

  // Plain text fallback (for editors that don't accept HTML paste)
  let plain = "";
  rows.forEach((r, i) => {
    if (i > 0) plain += "\n\n";
    plain += `||Component||${r.hdr}||Qty||\n`;
    r.comps.forEach(c => { plain += `|${c[0]}|${c[2]}|${c[1]}|\n`; });
  });
  window._jiraTablePlain = plain.trimEnd();

  document.getElementById("out-box").innerHTML = html;
  const area = document.getElementById("out-area");
  area.style.display = "block";
  area.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function copyTable() {
  const html  = document.getElementById("out-box").innerHTML;
  const plain = window._jiraTablePlain || document.getElementById("out-box").innerText;
  try {
    if (window.ClipboardItem) {
      const item = new ClipboardItem({
        "text/html":  new Blob([html],  { type: "text/html"  }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    const t = document.getElementById("toast");
    t.style.display = "inline";
    setTimeout(() => t.style.display = "none", 2000);
  } catch (e) {
    // Fallback: plain text only
    await navigator.clipboard.writeText(plain);
    const t = document.getElementById("toast");
    t.textContent = "Copied as plain text (browser blocked HTML copy)";
    t.style.display = "inline";
    setTimeout(() => { t.style.display = "none"; t.textContent = "Copied!"; }, 2500);
  }
}

/* ══════════════════════════════
   CATALOG EDITOR
══════════════════════════════ */
function bindCatButtons() {
  document.getElementById("btn-show-add-cat").addEventListener("click", () => {
    document.getElementById("cat-add-row").classList.add("visible");
    document.getElementById("cat-add-inp").focus();
  });
  document.getElementById("btn-cat-cancel").addEventListener("click", hideAddCat);
  document.getElementById("btn-cat-confirm").addEventListener("click", confirmAddCat);
  document.getElementById("cat-add-inp").addEventListener("keydown", e => {
    if (e.key === "Enter") confirmAddCat();
    if (e.key === "Escape") hideAddCat();
  });
  document.getElementById("btn-del-cat").addEventListener("click", deleteCategory);
  document.getElementById("btn-add-item").addEventListener("click", addItem);
  document.getElementById("add-item-inp").addEventListener("keydown", e => { if (e.key === "Enter") addItem(); });
}

function renderCatSidebar() {
  const el = document.getElementById("cat-items");
  el.innerHTML = "";
  catalog.categories.forEach(cat => {
    const div = document.createElement("div");
    div.className = "cat-item" + (cat.id === activeCatId ? " active" : "");
    div.innerHTML = `<span>${esc(cat.name)}</span><span class="cnt">${cat.items.length}</span>`;
    div.addEventListener("click", () => { activeCatId = cat.id; renderCatSidebar(); renderCompList(); });
    el.appendChild(div);
  });
}

function renderCompList() {
  const cat = catalog.categories.find(c => c.id === activeCatId);
  document.getElementById("cat-panel-title").textContent = cat ? cat.name : "Select a category";
  document.getElementById("btn-del-cat").style.display = cat ? "" : "none";
  document.getElementById("add-item-row").style.display = cat ? "" : "none";

  const list = document.getElementById("comp-list");
  if (!cat) { list.innerHTML = `<div class="placeholder-text">Select a category on the left.</div>`; return; }
  if (!cat.items.length) { list.innerHTML = `<div class="placeholder-text" style="font-style:italic">No components yet.</div>`; return; }

  const isCpu     = (activeCatId === "cpu");
  const isRam     = (activeCatId === "ram");
  const isMb      = (activeCatId === "motherboard");
  const isCase    = (activeCatId === "case");
  const isPsu     = (activeCatId === "psu");
  const isRaidDisk = (activeCatId === "raid_disks");
  const isOsSsd   = (activeCatId === "os_ssd");
  const hasTdp    = ["gpu","network","raid_controller","raid_disks","pci_card_1","pci_card_2"].includes(activeCatId);
  list.innerHTML = "";
  cat.items.forEach((item, idx) => {
    const name  = typeof item === "object" ? item.name : item;
    const row   = document.createElement("div");
    row.className = "comp-item";

    const metaHtml = isCpu ? `
      <div class="comp-cpu-meta" id="cpu-meta-${idx}" style="display:none;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
        <label style="font-size:11px;color:var(--muted)">Socket:</label>
        <input type="text" id="ci-socket-${idx}" value="${item.socket||'SP3'}" style="width:56px;height:26px;font-size:12px">
        <label style="font-size:11px;color:var(--muted)">Mem ch:</label>
        <input type="number" id="cpu-mc-${idx}" value="${item.mem_channels||8}" min="1" max="24" style="width:56px;height:26px;font-size:12px">
        <label style="font-size:11px;color:var(--muted)">Type:</label>
        <select id="cpu-mt-${idx}" style="height:24px;font-size:11px">
          <option${item.mem_type==="RDDR4"?" selected":""}>RDDR4</option>
          <option${item.mem_type==="RDDR5"?" selected":""}>RDDR5</option>
          <option${item.mem_type==="DDR4"?" selected":""}>DDR4</option>
          <option${item.mem_type==="DDR5"?" selected":""}>DDR5</option>
        </select>
        <label style="font-size:11px;color:var(--muted)">TDP W:</label>
        <input type="number" id="ci-tdp-${idx}" value="${item.tdp||0}" min="0" style="width:56px;height:26px;font-size:12px">
      </div>` : isRam ? `
      <div class="comp-cpu-meta" id="cpu-meta-${idx}" style="display:none;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
        <label style="font-size:11px;color:var(--muted)">Type:</label>
        <select id="cpu-mt-${idx}" style="height:24px;font-size:11px">
          <option${item.mem_type==="RDDR4"?" selected":""}>RDDR4</option>
          <option${item.mem_type==="RDDR5"?" selected":""}>RDDR5</option>
          <option${item.mem_type==="DDR4"?" selected":""}>DDR4</option>
          <option${item.mem_type==="DDR5"?" selected":""}>DDR5</option>
        </select>
        <label style="font-size:11px;color:var(--muted)">Capacity (Gb):</label>
        <input type="number" id="cpu-mc-${idx}" value="${item.capacity||16}" min="1" style="width:56px;height:26px;font-size:12px">
      </div>` : isMb ? `
      <div class="comp-cpu-meta" id="cpu-meta-${idx}" style="display:none;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
        <label style="font-size:11px;color:var(--muted)">Socket:</label>
        <input type="text" id="ci-socket-${idx}" value="${item.socket||'SP3'}" style="width:56px;height:26px;font-size:12px">
        <label style="font-size:11px;color:var(--muted)">CPU sockets:</label>
        <input type="number" id="ci-cpusockets-${idx}" value="${item.cpu_sockets||1}" min="1" max="4" style="width:44px;height:26px;font-size:12px">
        <label style="font-size:11px;color:var(--muted)">RAM slots:</label>
        <input type="number" id="ci-ramslots-${idx}" value="${item.ram_slots||8}" min="1" max="32" style="width:56px;height:26px;font-size:12px">
        <label style="font-size:11px;color:var(--muted)">PCIe x16:</label>
        <input type="number" id="ci-px16-${idx}" value="${item.pcie_x16||1}" min="0" max="8" style="width:56px;height:26px;font-size:12px">
        <label style="font-size:11px;color:var(--muted)">x8:</label>
        <input type="number" id="ci-px8-${idx}" value="${item.pcie_x8||0}" min="0" max="8" style="width:56px;height:26px;font-size:12px">
        <label style="font-size:11px;color:var(--muted)">x4:</label>
        <input type="number" id="ci-px4-${idx}" value="${item.pcie_x4||0}" min="0" max="8" style="width:56px;height:26px;font-size:12px">
      </div>` : hasTdp ? `
      <div class="comp-cpu-meta" id="cpu-meta-${idx}" style="display:none;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
        <label style="font-size:11px;color:var(--muted)">TDP (W):</label>
        <input type="number" id="ci-tdp-${idx}" value="${item.tdp||0}" min="0" style="width:60px;height:26px;font-size:12px">
        <label style="font-size:11px;color:var(--muted)">PCIe slot:</label>
        <select id="ci-pcie-${idx}" style="height:24px;font-size:11px">
          <option${item.pcie_slot==="x16"?" selected":""}>x16</option>
          <option${item.pcie_slot==="x8"?" selected":""}>x8</option>
          <option${item.pcie_slot==="x4"?" selected":""}>x4</option>
          <option${item.pcie_slot==="x1"?" selected":""}>x1</option>
        </select>
        ${activeCatId === "gpu" ? `
        <label style="font-size:11px;color:var(--muted)">Physical slots:</label>
        <input type="number" id="ci-slots-${idx}" value="${item.slots_used||2}" min="1" max="4" style="width:56px;height:26px;font-size:12px">` : ""}
      </div>` : isCase ? `
      <div class="comp-cpu-meta" id="cpu-meta-${idx}" style="display:none;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
        <label style="font-size:11px;color:var(--muted)">Expansion slots:</label>
        <input type="number" id="ci-slots-${idx}" value="${item.expansion_slots||7}" min="1" max="20" style="width:56px;height:26px;font-size:12px">
        <label style="font-size:11px;color:var(--muted)">Drive slots:</label>
        <input type="number" id="ci-hddslots-${idx}" value="${item.hdd_slots||16}" min="0" max="60" style="width:56px;height:26px;font-size:12px">
      </div>` : (isRaidDisk || isOsSsd) ? `
      <div class="comp-cpu-meta" id="cpu-meta-${idx}" style="display:none;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
        <label style="font-size:11px;color:var(--muted)">Disk type:</label>
        <select id="ci-disktype-${idx}" style="height:26px;font-size:12px">
          <option${item.disk_type==="HDD" ?" selected":""}>HDD</option>
          <option${item.disk_type==="SSD" ?" selected":""}>SSD</option>
          <option${item.disk_type==="NVMe"?" selected":""}>NVMe</option>
        </select>
      </div>` : isPsu ? `
      <div class="comp-cpu-meta" id="cpu-meta-${idx}" style="display:none;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap">
        <label style="font-size:11px;color:var(--muted)">Power capacity (W):</label>
        <input type="number" id="ci-tdp-${idx}" value="${item.tdp||800}" min="0" style="width:80px;height:26px;font-size:12px">
      </div>` : "";

    row.innerHTML = `
      <span class="comp-item-name" id="cin-${idx}">${esc(name)}${
        isCpu && typeof item === "object" ? `
          <span style="font-size:10px;color:var(--muted);margin-left:8px">${item.socket||""}</span>
          <span style="font-size:10px;color:var(--muted);margin-left:4px">${item.mem_channels||""}× ${item.mem_type||""}</span>
          <span style="font-size:10px;color:var(--warning);margin-left:4px">${item.tdp||0}W</span>` :
        isRam && typeof item === "object" ? `
          <span style="font-size:10px;color:var(--muted);margin-left:8px">${item.mem_type||""} ${item.capacity||""}Gb</span>` :
        isMb && typeof item === "object" ? `
          <span style="font-size:10px;color:var(--muted);margin-left:8px">Socket: ${item.socket||""}</span>
          <span style="font-size:10px;color:var(--muted);margin-left:4px">${item.cpu_sockets||1}× CPU</span>
          <span style="font-size:10px;color:var(--muted);margin-left:4px">${item.ram_slots||""}× RAM</span>
          <span style="font-size:10px;color:var(--muted);margin-left:4px">PCIe: ${item.pcie_x16||0}×16 ${item.pcie_x8||0}×8 ${item.pcie_x4||0}×4</span>` :
        hasTdp && typeof item === "object" ? `
          <span style="font-size:10px;color:var(--warning);margin-left:8px">${item.tdp||0}W</span>${item.pcie_slot ? `<span style="font-size:10px;color:var(--muted);margin-left:4px">PCIe ${item.pcie_slot}</span>` : ""}<span style="font-size:10px;color:var(--muted);margin-left:4px">${item.slots_used||1}-slot</span>` :
        isPsu && typeof item === "object" ? `
          <span style="font-size:10px;color:var(--success);margin-left:8px">⚡ ${item.tdp||0}W capacity</span>` :
        isCase && typeof item === "object" ? `
          <span style="font-size:10px;color:var(--muted);margin-left:8px">⬜ ${item.expansion_slots||0} exp.</span>
          <span style="font-size:10px;color:var(--muted);margin-left:4px">💾 ${item.hdd_slots||0} drive slots</span>` :
        (isRaidDisk || isOsSsd) && typeof item === "object" ? `
          <span style="font-size:10px;color:var(--muted);margin-left:8px">${item.disk_type||"HDD"}</span>` :
        ""
      }</span>
      <input class="comp-edit-inp" id="cie-${idx}" type="text" value="${escAttr(name)}">
      ${metaHtml}
      <div class="comp-actions">
        <button class="btn ghost" data-action="edit" data-idx="${idx}" title="Edit"><i class="ti ti-pencil" style="font-size:13px;color:var(--muted)"></i></button>
        <button class="btn ghost" data-action="save" data-idx="${idx}" title="Save" style="display:none"><i class="ti ti-check" style="font-size:13px;color:var(--success)"></i></button>
        <button class="btn ghost" data-action="cancel" data-idx="${idx}" title="Cancel" style="display:none"><i class="ti ti-x" style="font-size:13px;color:var(--muted)"></i></button>
        <button class="btn danger" data-action="delete" data-idx="${idx}" title="Delete"><i class="ti ti-trash" style="font-size:13px"></i></button>
      </div>`;

    const editInp = row.querySelector(".comp-edit-inp");
    editInp.addEventListener("keydown", e => {
      if (e.key === "Enter")  saveEdit(idx, editInp.value);
      if (e.key === "Escape") cancelEdit(idx);
    });
    // No onblur — would fire when clicking meta fields (selects/inputs)
    list.appendChild(row);
  });

  list.querySelectorAll("[data-action=edit]").forEach(btn => {
    btn.addEventListener("click", () => startEdit(parseInt(btn.dataset.idx)));
  });
  list.querySelectorAll("[data-action=save]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx);
      saveEdit(idx, document.getElementById("cie-" + idx)?.value);
    });
  });
  list.querySelectorAll("[data-action=cancel]").forEach(btn => {
    btn.addEventListener("click", () => cancelEdit(parseInt(btn.dataset.idx)));
  });
  list.querySelectorAll("[data-action=delete]").forEach(btn => {
    btn.addEventListener("click", () => deleteItem(parseInt(btn.dataset.idx)));
  });

  // Show/hide extra add-item fields based on category
  const cpuF = document.getElementById("add-cpu-fields");
  const ramF = document.getElementById("add-ram-fields");
  const mbF  = document.getElementById("add-mb-fields");
  const tdpF = document.getElementById("add-tdp-fields");
  const inp  = document.getElementById("add-item-inp");
  const PCIE_CATS = new Set(["gpu","pci_card_1","pci_card_2"]);
  if (cpuF) cpuF.style.display = isCpu ? "flex" : "none";
  if (ramF) ramF.style.display = isRam ? "flex" : "none";
  if (mbF)  mbF.style.display  = isMb  ? "flex" : "none";
  if (tdpF) tdpF.style.display = (hasTdp || isPsu) ? "flex" : "none";
  const pcieWrap = document.getElementById("add-pcie-wrap");
  if (pcieWrap) pcieWrap.style.display = PCIE_CATS.has(activeCatId) ? "inline-flex" : "none";
  // Case: show expansion slots field
  const caseF = document.getElementById("add-case-fields");
  if (caseF) caseF.style.display = isCase ? "flex" : "none";
  if (inp)  inp.placeholder = isCpu ? "CPU name (e.g. AMD EPYC 9354P ...)" :
                              isRam ? "RAM name (e.g. RDDR5 32Gb)" :
                              isMb  ? "Motherboard model" :
                              hasTdp ? "Component name" :
                              "Component name...";
}

function startEdit(idx) {
  document.getElementById("cin-" + idx).classList.add("hidden");
  const inp = document.getElementById("cie-" + idx);
  inp.classList.add("on");
  inp.focus(); inp.select();
  const meta = document.getElementById(`cpu-meta-${idx}`);
  if (meta) meta.style.display = "flex";
  // Toggle buttons: hide Edit, show Save+Cancel
  document.querySelector(`[data-action="edit"][data-idx="${idx}"]`)?.style.setProperty("display","none");
  document.querySelector(`[data-action="save"][data-idx="${idx}"]`)?.style.setProperty("display","");
  document.querySelector(`[data-action="cancel"][data-idx="${idx}"]`)?.style.setProperty("display","");
}
function cancelEdit(idx) {
  document.getElementById("cin-" + idx).classList.remove("hidden");
  const inp = document.getElementById("cie-" + idx);
  inp.classList.remove("on");
  const meta = document.getElementById(`cpu-meta-${idx}`);
  if (meta) meta.style.display = "none";
  // Toggle buttons: show Edit, hide Save+Cancel
  document.querySelector(`[data-action="edit"][data-idx="${idx}"]`)?.style.setProperty("display","");
  document.querySelector(`[data-action="save"][data-idx="${idx}"]`)?.style.setProperty("display","none");
  document.querySelector(`[data-action="cancel"][data-idx="${idx}"]`)?.style.setProperty("display","none");
}
async function saveEdit(idx, val) {
  val = val.trim();
  if (!val) { cancelEdit(idx); return; }
  const cat   = catalog.categories.find(c => c.id === activeCatId);
  const isCpu  = (activeCatId === "cpu");
  const isRam  = (activeCatId === "ram");
  const isMb   = (activeCatId === "motherboard");
  const isCase    = (activeCatId === "case");
  const isPsu     = (activeCatId === "psu");
  const isRaidDisk = (activeCatId === "raid_disks");
  const isOsSsd   = (activeCatId === "os_ssd");
  const hasTdp    = ["gpu","network","raid_controller","raid_disks","pci_card_1","pci_card_2"].includes(activeCatId);
  const current = typeof cat?.items[idx] === "object" ? cat.items[idx].name : cat?.items[idx];
  // Only skip if name unchanged AND it's a plain string category (no meta fields)
  const hasMeta = isCpu || isRam || isMb || isCase || hasTdp || isPsu || isRaidDisk || isOsSsd;
  if (!hasMeta && current === val) { cancelEdit(idx); return; }

  let payload = { item: val };
  if (isCpu) {
    payload = { item: {
      name: val,
      socket:       document.getElementById(`ci-socket-${idx}`)?.value || "SP3",
      mem_channels: parseInt(document.getElementById(`cpu-mc-${idx}`)?.value) || 8,
      mem_type:     document.getElementById(`cpu-mt-${idx}`)?.value || "RDDR4",
      tdp:          parseInt(document.getElementById(`ci-tdp-${idx}`)?.value) || 0,
    }};
  } else if (isRam) {
    payload = { item: {
      name:     val,
      mem_type: document.getElementById(`cpu-mt-${idx}`)?.value || "RDDR4",
      capacity: parseInt(document.getElementById(`cpu-mc-${idx}`)?.value) || 16,
    }};
  } else if (isMb) {
    payload = { item: {
      name:        val,
      socket:      document.getElementById(`ci-socket-${idx}`)?.value || "SP3",
      cpu_sockets: parseInt(document.getElementById(`ci-cpusockets-${idx}`)?.value) || 1,
      ram_slots:   parseInt(document.getElementById(`ci-ramslots-${idx}`)?.value) || 8,
      pcie_x16:    parseInt(document.getElementById(`ci-px16-${idx}`)?.value) || 1,
      pcie_x8:     parseInt(document.getElementById(`ci-px8-${idx}`)?.value)  || 0,
      pcie_x4:     parseInt(document.getElementById(`ci-px4-${idx}`)?.value)  || 0,
    }};
  } else if (isCase) {
    payload = { item: {
      name:            val,
      expansion_slots: parseInt(document.getElementById(`ci-slots-${idx}`)?.value)    || 7,
      hdd_slots:       parseInt(document.getElementById(`ci-hddslots-${idx}`)?.value) || 16,
    }};
  } else if (isRaidDisk || isOsSsd) {
    payload = { item: {
      name:      val,
      disk_type: document.getElementById(`ci-disktype-${idx}`)?.value || "HDD",
    }};
  } else if (hasTdp || isPsu) {
    const pcieEl  = document.getElementById(`ci-pcie-${idx}`);
    const slotsEl = document.getElementById(`ci-slots-${idx}`);
    payload = { item: {
      name:      val,
      tdp:       parseInt(document.getElementById(`ci-tdp-${idx}`)?.value) || 0,
      ...(pcieEl  ? { pcie_slot:  pcieEl.value } : {}),
      ...(slotsEl ? { slots_used: parseInt(slotsEl.value) || 2 } : {}),
    }};
  }
  await api("PUT", `/api/catalog/category/${activeCatId}/item/${idx}`, payload);
  await fetchCatalog();
  renderCompList();
  refreshAllCards();
}
async function deleteItem(idx) {
  await api("DELETE", `/api/catalog/category/${activeCatId}/item/${idx}`);
  await fetchCatalog();
  renderCompList();
  refreshAllCards();
}
async function addItem() {
  const inp = document.getElementById("add-item-inp");
  const val = inp.value.trim();
  if (!val || !activeCatId) return;

  let item = val;
  if (activeCatId === "cpu") {
    const mc  = parseInt(document.getElementById("add-cpu-mc")?.value) || 8;
    const mt  = document.getElementById("add-cpu-mt")?.value || "RDDR4";
    const skt = document.getElementById("add-cpu-socket")?.value || "SP3";
    const tdp = parseInt(document.getElementById("add-cpu-tdp")?.value) || 0;
    item = { name: val, socket: skt, mem_channels: mc, mem_type: mt, tdp };
  } else if (activeCatId === "ram") {
    const mt  = document.getElementById("add-ram-mt")?.value  || "RDDR4";
    const cap = parseInt(document.getElementById("add-ram-cap")?.value) || 16;
    const autoName = val.includes("Gb") ? val : `${mt} ${cap}Gb`;
    item = { name: autoName, mem_type: mt, capacity: cap };
    inp.value = "";
  } else if (activeCatId === "case") {
    const slots = parseInt(document.getElementById("add-case-slots")?.value) || 7;
    item = { name: val, expansion_slots: slots };
  } else if (activeCatId === "motherboard") {
    item = {
      name:        val,
      socket:      document.getElementById("add-mb-socket")?.value  || "SP3",
      cpu_sockets: parseInt(document.getElementById("add-mb-cpusockets")?.value) || 1,
      ram_slots:   parseInt(document.getElementById("add-mb-ramslots")?.value) || 8,
      pcie_x16:    parseInt(document.getElementById("add-mb-px16")?.value) || 1,
      pcie_x8:     parseInt(document.getElementById("add-mb-px8")?.value)  || 0,
      pcie_x4:     parseInt(document.getElementById("add-mb-px4")?.value)  || 0,
    };
  } else if (["gpu","network","raid_controller","raid_disks","pci_card_1","pci_card_2","psu"].includes(activeCatId)) {
    const tdp  = parseInt(document.getElementById("add-tdp-val")?.value) || 0;
    const pcie = document.getElementById("add-pcie-slot")?.value;
    item = { name: val, tdp, ...(pcie ? { pcie_slot: pcie } : {}) };
  }

  await api("POST", `/api/catalog/category/${activeCatId}/item`, { item });
  inp.value = "";
  await fetchCatalog();
  renderCompList();
  refreshAllCards();
}

function hideAddCat() {
  document.getElementById("cat-add-row").classList.remove("visible");
  document.getElementById("cat-add-inp").value = "";
}
async function confirmAddCat() {
  const val = document.getElementById("cat-add-inp").value.trim();
  if (!val) return;
  const result = await api("POST", "/api/catalog/category", { name: val });
  if (result.error) { alert(result.error); return; }
  hideAddCat();
  activeCatId = result.id;
  await fetchCatalog();
  renderCompList();
}
async function deleteCategory() {
  if (!activeCatId) return;
  const cat = catalog.categories.find(c => c.id === activeCatId);
  if (!confirm(`Delete category "${cat?.name}" and all its components?`)) return;
  await api("DELETE", `/api/catalog/category/${activeCatId}`);
  activeCatId = null;
  await fetchCatalog();
  renderCompList();
  refreshAllCards();
}

/* ── Helpers ── */
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function escAttr(s) { return String(s).replace(/"/g,"&quot;"); }

/* ══════════════════════════════
   RAID CALCULATOR
══════════════════════════════ */

// Single-disk baseline throughput (MB/s): [read, write]
const DISK_BASELINE = {
  hdd_sata: [150,  140],
  hdd_sas:  [250,  230],
  ssd_sata: [550,  520],
  ssd_nvme: [3500, 3000],
};

const RAID_DESC = {
  0:  "<strong>RAID 0 — Striping.</strong> All disks work in parallel. Maximum performance and capacity, but zero redundancy — any single disk failure destroys all data.",
  1:  "<strong>RAID 1 — Mirroring.</strong> Data is duplicated across all disks. Excellent read performance (reads from multiple mirrors), write speed equals a single disk. Requires exactly 2 disks.",
  5:  "<strong>RAID 5 — Distributed parity.</strong> One disk equivalent is used for parity spread across all drives. Survives 1 disk failure. Good balance of capacity, performance and redundancy. Minimum 3 disks.",
  6:  "<strong>RAID 6 — Double parity.</strong> Two disks worth of parity. Survives 2 simultaneous disk failures. Slightly lower write performance than RAID 5. Minimum 4 disks.",
  10: "<strong>RAID 10 — Mirror + Stripe.</strong> Pairs of mirrored disks striped together. Excellent performance and good redundancy (1 disk per mirror pair). Requires an even number of disks, minimum 4.",
  50: "<strong>RAID 50 — RAID 5+0.</strong> Multiple RAID 5 groups striped together. Higher performance than RAID 5, can survive 1 failure per sub-group. Requires at least 6 disks (two groups of 3).",
};

function calcRAID() {
  const level    = parseInt(document.querySelector(".raid-level-btn.active")?.dataset.level ?? 1);
  const count    = parseInt(document.getElementById("r-count").value) || 0;
  const size     = parseFloat(document.getElementById("r-size").value) || 0;
  const unitMul  = parseFloat(document.getElementById("r-unit").value) || 1;
  const diskType = document.getElementById("r-disktype").value;
  const [baseR, baseW] = DISK_BASELINE[diskType];

  const warn = document.getElementById("raid-warn");
  warn.style.display = "none";

  const set = (id, v) => { document.getElementById(id).textContent = v; };
  const bar = (id, pct) => { document.getElementById(id).style.width = Math.min(100, pct) + "%"; };

  function showWarn(msg) { warn.textContent = msg; warn.style.display = "block"; }
  function fmtCap(tb) {
    if (unitMul === 1) return tb.toFixed(2) + " TB";
    return (tb / 0.001).toFixed(0) + " GB";
  }
  function fmtSpeed(mbps) {
    if (mbps >= 1000) return (mbps / 1000).toFixed(1) + " GB/s";
    return Math.round(mbps) + " MB/s";
  }

  let usable = 0, overhead = 0, faultDisks = 0, readMul = 1, writeMul = 1;
  let valid = true;

  const raw = count * size * unitMul;

  switch (level) {
    case 0:
      if (count < 2) { showWarn("RAID 0 requires at least 2 disks."); valid = false; break; }
      usable    = raw;
      overhead  = 0;
      faultDisks = 0;
      readMul   = count;
      writeMul  = count;
      break;
    case 1:
      if (count < 2) { showWarn("RAID 1 requires at least 2 disks."); valid = false; break; }
      if (count > 2) showWarn("RAID 1 standard uses 2 disks. Extra disks shown as additional mirrors.");
      usable    = size * unitMul;
      overhead  = raw - usable;
      faultDisks = count - 1;
      readMul   = count;   // can read from any mirror
      writeMul  = 1;
      break;
    case 5:
      if (count < 3) { showWarn("RAID 5 requires at least 3 disks."); valid = false; break; }
      usable    = (count - 1) * size * unitMul;
      overhead  = size * unitMul;
      faultDisks = 1;
      readMul   = count - 1;   // reads stripe across N-1 data disks — scales with disk count
      writeMul  = 1 / 4;       // write penalty: 4 IOs per write regardless of disk count
      break;
    case 6:
      if (count < 4) { showWarn("RAID 6 requires at least 4 disks."); valid = false; break; }
      usable    = (count - 2) * size * unitMul;
      overhead  = 2 * size * unitMul;
      faultDisks = 2;
      readMul   = count - 2;   // reads stripe across N-2 data disks
      writeMul  = 1 / 6;       // double parity: 6 IOs per write (3 read + 3 write)
      break;
    case 10: {
      if (count < 4) { showWarn("RAID 10 requires at least 4 disks."); valid = false; break; }
      if (count % 2 !== 0) { showWarn("RAID 10 requires an even number of disks."); valid = false; break; }
      const pairs = count / 2;
      usable    = pairs * size * unitMul;
      overhead  = usable;
      faultDisks = pairs; // 1 per mirror pair
      readMul   = count;   // can read from any disk in each mirror
      writeMul  = pairs;   // writes go to all mirrors simultaneously — scales with stripe width
      break;
    }
    case 50: {
      if (count < 6) { showWarn("RAID 50 requires at least 6 disks (two RAID 5 groups of 3)."); valid = false; break; }
      if (count % 2 !== 0) showWarn("For best balance use an even number of disks in RAID 50.");
      const groups = 2;
      const perGroup = Math.floor(count / groups);
      usable    = groups * (perGroup - 1) * size * unitMul;
      overhead  = raw - usable;
      faultDisks = groups; // 1 per group
      readMul   = count - groups;              // reads full stripe across all data disks
      writeMul  = groups / 4;                  // groups stripe writes, each group has /4 penalty
      break;
    }
  }

  if (!valid) {
    ["r-usable","r-raw","r-overhead","r-fault","r-usable-sub","r-overhead-sub","r-eff-sub","r-fault-sub","r-read-val","r-write-val"].forEach(id => set(id, "—"));
    bar("r-read-bar", 0); bar("r-write-bar", 0);
    return;
  }

  const eff = raw > 0 ? (usable / raw * 100) : 0;
  set("r-usable", fmtCap(usable));
  set("r-usable-sub", `${eff.toFixed(0)}% efficiency`);
  set("r-raw", fmtCap(raw));
  set("r-overhead", fmtCap(overhead));
  set("r-overhead-sub", `${(100 - eff).toFixed(0)}% overhead`);
  set("r-fault", faultDisks + (faultDisks === 1 ? " disk" : " disks"));
  set("r-fault-sub", faultDisks === 0 ? "No redundancy" : `Can lose ${faultDisks} disk${faultDisks>1?"s":""}`);

  const readSpeed  = baseR * readMul;
  const writeSpeed = baseW * writeMul;
  const maxSpeed   = Math.max(readSpeed, writeSpeed, baseR * 8);

  set("r-read-val",  `×${readMul.toFixed(1)}  ${fmtSpeed(readSpeed)}`);
  const writeLabel = writeMul < 1
    ? `×${writeMul.toFixed(2)}  ${fmtSpeed(writeSpeed)}  ⚠ slower than single disk`
    : `×${writeMul.toFixed(1)}  ${fmtSpeed(writeSpeed)}`;
  set("r-write-val", writeLabel);
  bar("r-read-bar",  readSpeed  / maxSpeed * 100);
  bar("r-write-bar", writeSpeed / maxSpeed * 100);

  // Description
  document.getElementById("raid-desc").innerHTML = RAID_DESC[level] || "";

  // Store result for apply
  window._raidResult = { count, size, unitMul, level };
}

function applyRAIDToServer() {
  const res = window._raidResult;
  if (!res) { alert("Run the calculator first."); return; }

  const srvId = document.getElementById("apply-srv-sel").value;
  if (!srvId) { alert("Select a server to apply to."); return; }

  // Find best matching disk in catalog
  const diskCat = catalog.categories.find(c => c.id === "raid_disks");
  if (!diskCat || !diskCat.items.length) { alert("No RAID Disks found in catalog."); return; }

  const targetTB = res.size * res.unitMul;
  // Try to match by capacity number in item name (items may be objects or plain strings)
  let bestItem = diskCat.items[0];
  let bestDiff = Infinity;
  diskCat.items.forEach(item => {
    const name = typeof item === "object" ? item.name : item;
    const m = name.match(/(\d+(?:\.\d+)?)\s*(TB|GB)/i);
    if (m) {
      const tb = parseFloat(m[1]) * (m[2].toUpperCase() === "GB" ? 0.001 : 1);
      const diff = Math.abs(tb - targetTB);
      if (diff < bestDiff) { bestDiff = diff; bestItem = item; }
    }
  });
  const bestName = typeof bestItem === "object" ? bestItem.name : bestItem;

  // Set the select
  const selEl = document.getElementById(`${srvId}-raid_disks`);
  if (!selEl) { alert("This server has no RAID Disks field."); return; }
  for (const opt of selEl.options) {
    if (opt.text === bestName) { selEl.value = opt.value; break; }
  }

  // Set qty
  const qtyEl = document.getElementById(`${srvId}-raid_disks-qty`);
  if (qtyEl) qtyEl.textContent = res.count;

  // Recalculate dependent state (TDP, slot validation) for the target server
  if (typeof calcTdp === "function")     calcTdp(srvId);
  if (typeof validatePcie === "function") validatePcie(srvId);

  // Switch to configurator tab
  document.querySelector('[data-tab="cfg"]').click();

  // Flash the field
  if (selEl) {
    selEl.style.borderColor = "var(--success)";
    selEl.style.background  = "rgba(34,197,94,.1)";
    setTimeout(() => { selEl.style.borderColor = ""; selEl.style.background = ""; }, 2000);
  }
}

function refreshApplySrvSelect() {
  const sel = document.getElementById("apply-srv-sel");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— select server —</option>';
  srvIds.forEach(id => {
    const card = document.getElementById(id);
    if (!card) return;
    const name = card.querySelector(".srv-name")?.value || id;
    const opt = document.createElement("option");
    opt.value = id; opt.textContent = name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

// Init RAID tab
document.addEventListener("DOMContentLoaded", () => {
  // Level buttons
  document.getElementById("raid-level-grid").addEventListener("click", e => {
    const btn = e.target.closest(".raid-level-btn");
    if (!btn) return;
    document.querySelectorAll(".raid-level-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    calcRAID();
  });

  ["r-count","r-size","r-unit","r-disktype"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", calcRAID);
    document.getElementById(id)?.addEventListener("change", calcRAID);
  });

  document.getElementById("btn-apply-raid").addEventListener("click", applyRAIDToServer);

  // Refresh server list in apply-select whenever RAID tab is opened
  document.querySelector('[data-tab="raid"]').addEventListener("click", () => {
    refreshApplySrvSelect();
    calcRAID();
  });

  calcRAID();
});

/* ══════════════════════════════
   STORAGE CALCULATOR
══════════════════════════════ */

let stGroups = [];
let stGroupCounter = 0;

function stAddGroup(services = 10, bitrateMbps = 5, days = 90) {
  stGroupCounter++;
  const id = "stg" + stGroupCounter;
  stGroups.push({ id, services, bitrateMbps, days });
  renderStGroups();
  calcStorage();
}

function stRemoveGroup(id) {
  stGroups = stGroups.filter(g => g.id !== id);
  renderStGroups();
  calcStorage();
}

function stReadGroup(id) {
  const g = stGroups.find(g => g.id === id);
  if (!g) return;
  const el = document.getElementById("stg-" + id);
  if (!el) return;
  g.name     = el.querySelector(".st-group-name").value.trim();
  g.services    = parseFloat(el.querySelector(".stg-services").value)    || 0;
  g.bitrateMbps = parseFloat(el.querySelector(".stg-bitrate").value)     || 0;
  g.days        = parseFloat(el.querySelector(".stg-days").value)        || 0;
}

// TB for one group: services × bitrate_Mbps × days × 86400 sec / 8 bits / 1e6 → TB
function groupTB(g) {
  return g.services * g.bitrateMbps * 1e6 * g.days * 86400 / 8 / 1e12;
}

function fmtTB(tb) {
  if (tb >= 1) return tb.toFixed(2) + " TB";
  return (tb * 1000).toFixed(0) + " GB";
}

function renderStGroups() {
  const container = document.getElementById("st-groups");
  if (!container) return;
  container.innerHTML = "";
  stGroups.forEach((g, idx) => {
    const div = document.createElement("div");
    div.className = "st-group";
    div.id = "stg-" + g.id;
    div.innerHTML = `
      <div class="st-group-hdr">
        <div class="srv-num" style="background:var(--accent)">${idx + 1}</div>
        <input class="st-group-name" type="text" value="${esc(g.name || "Group " + (idx+1))}" placeholder="Group name">
        <button class="btn danger" onclick="stRemoveGroup('${g.id}')" title="Remove group" style="height:26px;padding:0 6px"><i class="ti ti-x" style="font-size:13px"></i></button>
      </div>
      <div class="st-group-body">
        <div class="st-field">
          <label>Services</label>
          <input class="stg-services" type="number" value="${g.services}" min="1" step="1">
        </div>
        <div class="st-field">
          <label>Bitrate (Mbps/service)</label>
          <input class="stg-bitrate" type="number" value="${g.bitrateMbps}" min="0.1" step="0.5">
        </div>
        <div class="st-field">
          <label>Retention (days)</label>
          <input class="stg-days" type="number" value="${g.days}" min="1" step="1">
        </div>
      </div>
      <div class="st-group-result">
        <span>Subtotal</span>
        <span class="g-size" id="stg-size-${g.id}">—</span>
      </div>`;
    // live recalc on any input change
    div.querySelectorAll("input").forEach(inp => inp.addEventListener("input", () => {
      stReadGroup(g.id);
      calcStorage();
    }));
    container.appendChild(div);
  });
}

function calcStorage() {
  const reserve = parseFloat(document.getElementById("st-reserve")?.value) || 20;
  document.getElementById("st-reserve-val").textContent = reserve + "%";

  let netTB = 0;
  stGroups.forEach(g => {
    const tb = groupTB(g);
    netTB += tb;
    const el = document.getElementById("stg-size-" + g.id);
    if (el) el.textContent = fmtTB(tb);
  });

  const withReserve = netTB * (1 + reserve / 100);

  // Update summary tiles
  const totalEl = document.getElementById("st-total");
  const netEl   = document.getElementById("st-net");
  if (totalEl) totalEl.textContent = fmtTB(withReserve);
  if (netEl)   netEl.textContent   = fmtTB(netTB);

  const totalSubEl = document.getElementById("st-total-sub");
  const netSubEl   = document.getElementById("st-net-sub");
  if (totalSubEl) totalSubEl.textContent = `Net + ${reserve}% reserve`;
  if (netSubEl)   netSubEl.textContent   = `${stGroups.length} group${stGroups.length !== 1 ? "s" : ""}`;

  // Breakdown table
  const bkEl = document.getElementById("st-breakdown");
  if (bkEl) {
    if (!stGroups.length) { bkEl.innerHTML = ""; return; }
    let rows = stGroups.map((g, i) => {
      const tb = groupTB(g);
      const label = g.name || ("Group " + (i + 1));
      const detail = `${g.services} svc × ${g.bitrateMbps} Mbps × ${g.days}d`;
      return `<div class="st-br-row"><span>${esc(label)}<br><span style="font-size:11px;opacity:.65">${esc(detail)}</span></span><span class="br-val">${fmtTB(tb)}</span></div>`;
    }).join("");
    rows += `<div class="st-br-row" style="margin-top:4px;font-weight:600">
      <span style="color:var(--text)">Net total</span><span class="br-val">${fmtTB(netTB)}</span></div>`;
    rows += `<div class="st-br-row">
      <span>Reserve (${reserve}%)</span><span class="br-val">+${fmtTB(netTB * reserve / 100)}</span></div>`;
    rows += `<div class="st-br-row" style="font-weight:700;font-size:13px">
      <span style="color:var(--accent)">Required capacity</span><span class="br-val" style="color:var(--accent)">${fmtTB(withReserve)}</span></div>`;
    bkEl.innerHTML = rows;
  }

  // Store for RAID handoff
  window._storageResultTB = withReserve;
}

function sendStorageToRAID() {
  const tb = window._storageResultTB || 0;
  if (!tb) { alert("Add some service groups first."); return; }

  const maxDisks = parseInt(document.getElementById("st-max-disks")?.value) || 16;

  // Collect all disk sizes from catalog (TB only)
  const diskCat = catalog.categories.find(c => c.id === "raid_disks");
  const diskSizes = []; // [{tb, item}]
  if (diskCat) {
    diskCat.items.forEach(item => {
      const name = typeof item === "object" ? item.name : item;
      const m = name.match(/(\d+(?:\.\d+)?)\s*TB/i);
      if (m) diskSizes.push({ tb: parseFloat(m[1]), item });
    });
  }
  if (!diskSizes.length) diskSizes.push({ tb: 4, item: null }); // fallback
  diskSizes.sort((a, b) => a.tb - b.tb); // ascending

  // Strategy: for each available disk size, find smallest disk count <= maxDisks
  // that satisfies RAID 5 usable >= required TB.
  // RAID 5 usable = (n-1) * diskTB  →  n = ceil(tb / diskTB) + 1
  // Prefer more disks (better perf/redundancy) up to maxDisks,
  // so among valid options pick the one with the most disks within the cap.

  let bestDiskTB = diskSizes[diskSizes.length - 1].tb;
  let bestCount  = 3;
  let found      = false;

  // Try each disk size from smallest to largest
  for (const { tb: diskTB } of diskSizes) {
    const minCount = Math.max(3, Math.ceil(tb / diskTB) + 1); // min disks to cover capacity
    if (minCount > maxDisks) continue; // even max disks isn't enough with this size — try larger
    // We can cover the capacity; now maximize disks up to maxDisks for better perf
    bestDiskTB = diskTB;
    bestCount  = maxDisks; // use all available slots
    found      = true;
    break;
  }

  if (!found) {
    // Capacity exceeds maxDisks × largest disk — use largest disk, exceed the cap, warn user
    bestDiskTB = diskSizes[diskSizes.length - 1].tb;
    bestCount  = Math.max(3, Math.ceil(tb / bestDiskTB) + 1);
  }

  // Switch to RAID tab and set fields
  document.querySelector('[data-tab="raid"]').click();

  const sizeInp  = document.getElementById("r-size");
  const countInp = document.getElementById("r-count");
  const unitSel  = document.getElementById("r-unit");
  if (sizeInp)  sizeInp.value  = bestDiskTB;
  if (countInp) countInp.value = bestCount;
  if (unitSel)  unitSel.value  = "1";

  // Activate RAID 5
  document.querySelectorAll(".raid-level-btn").forEach(b => b.classList.remove("active"));
  const r5btn = document.querySelector('.raid-level-btn[data-level="5"]');
  if (r5btn) r5btn.classList.add("active");

  calcRAID();

  // Warn if we had to exceed the disk cap
  if (!found) {
    const warn = document.getElementById("raid-warn");
    if (warn) {
      warn.textContent = `Required capacity exceeds ${maxDisks}-disk limit with the largest disk in catalog (${bestDiskTB} TB). Showing minimum required configuration (${bestCount} disks). Consider a larger enclosure or adjust the disk count manually.`;
      warn.style.display = "block";
    }
  }

  const usableEl = document.getElementById("r-usable");
  if (usableEl) {
    usableEl.style.color = "var(--success)";
    setTimeout(() => { usableEl.style.color = ""; }, 2000);
  }
}

// Init Storage tab
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-add-group")?.addEventListener("click", () => stAddGroup());
  document.getElementById("st-reserve")?.addEventListener("input", calcStorage);
  document.getElementById("btn-st-to-raid")?.addEventListener("click", sendStorageToRAID);

  document.querySelector('[data-tab="storage"]')?.addEventListener("click", calcStorage);

  // Start with two example groups
  stAddGroup(10, 5, 90);
  stAddGroup(10, 3, 60);
});

/* ══════════════════════════════
   QUOTATION
══════════════════════════════ */

// Fixes names Pipedrive sometimes stores ALL CAPS (or all lowercase) —
// capitalizes just the first letter of each name part, including across
// hyphens ("Anne-Marie") and apostrophes ("O'Brien").
function toTitleCaseName(str) {
  if (!str) return str;
  return str.trim().replace(/\s+/g, " ").split(" ").map(word =>
    word.split("-").map(part =>
      part.split("'").map(seg => seg ? seg[0].toUpperCase() + seg.slice(1).toLowerCase() : seg).join("'")
    ).join("-")
  ).join(" ");
}

function qtNormalizeContactName() {
  const el = document.getElementById("qt-contact");
  if (!el || !el.value.trim()) return;
  el.value = toTitleCaseName(el.value);
}

let pricelist = [];          // loaded from server
let activeProducts = new Set(); // product group indices
let hwRowCount  = 0;
let svcRowCount = 0;

// ── Boot ──
document.addEventListener("DOMContentLoaded", () => {
  document.querySelector('[data-tab="quote"]')?.addEventListener("click", () => {
    if (!pricelist.length) loadPricelist();
  });
  document.getElementById("btn-export-excel")?.addEventListener("click", async () => {
    const saved = await saveQuotationToDB(false, true);
    if (saved !== false) exportQuote("xlsx");
  });

  // live recalc on any price input change (delegated)
  document.getElementById("pane-quote")?.addEventListener("input", e => {
    if (e.target.classList.contains("lic-price") ||
        e.target.classList.contains("lic-qty-inp")) qtCalc();
  });

  // Default hardware row: 3U server
  addHwRow("5427-3U-SL", "3U Stream Labs branded server");

  // Default service rows with full descriptions
  addSvcRow(
    "Stream Labs Online Technical Support 24/7/365 : Level 2 - per year\n" +
    "• Support team available worldwide.\n" +
    "• All technical support users have access to the published updates, patches and new versions.\n" +
    "• Rapid response to identified problems in software and troubleshooting.\n" +
    "• Remote assistance using secure remote connection\n" +
    "• Priority in support queue by phone hotline/WhatsApp/support ticket system/emails.\n" +
    "• Unlimited consultations regarding Stream Labs products, system configuration and solutions.\n" +
    "Detailed support services description described at SLA",
    1, 0
  );
  addSvcRow(
    "Remote Software Configuration and Personnel Training - per day\n" +
    "Operators training, Support training, Advanced level training or Configuration.\n" +
    "1 x Stream Labs English speaking engineer In case of onsite visit – transportation and accommodation expenses are not included.",
    3, 1000
  );
});

async function loadPricelist() {
  try {
    const r = await fetch("/api/pricelist");
    pricelist = await r.json();
    renderProductPicker();
  } catch(e) { console.error("Pricelist load failed", e); }
}

// ── Quote ID / filename ──
function qtUpdate() {
  const company  = (document.getElementById("qt-company")?.value || "").trim()
                    .replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
  const dealId   = (document.getElementById("qt-deal-id")?.value || "").trim();
  const version  = document.getElementById("qt-version")?.value || "V1";
  const abbrevs  = [...activeProducts]
                    .map(i => pricelist[i]?.abbrev)
                    .filter(Boolean)
                    .filter((v,i,a) => a.indexOf(v) === i) // unique
                    .join("_");
  const qid      = `PP${dealId}_${version}${abbrevs ? "_" + abbrevs : ""}`;
  const filename = `${company || "CLIENT"}_PP${dealId}_${version}${abbrevs ? "_" + abbrevs : ""}`;
  const el = document.getElementById("qt-id-preview");
  const fn = document.getElementById("qt-filename-preview");
  if (el) el.textContent = qid;
  if (fn) fn.textContent = filename + ".xlsx  /  " + filename + ".pdf";
}

// ── Product picker ──
function renderProductPicker() {
  const el = document.getElementById("product-picker");
  if (!el || !pricelist.length) return;
  el.innerHTML = "";
  pricelist.forEach((group, idx) => {
    const btn = document.createElement("button");
    btn.className = "product-chip" + (activeProducts.has(idx) ? " on" : "");
    btn.innerHTML = `<span class="chip-abbrev">${esc(group.abbrev)}</span> ${esc(group.name)}`;
    btn.addEventListener("click", () => {
      if (activeProducts.has(idx)) activeProducts.delete(idx);
      else activeProducts.add(idx);
      btn.classList.toggle("on");
      renderLicSections();
      qtUpdate();
      qtCalc();
    });
    el.appendChild(btn);
  });
}

// ── License sections ──
function renderLicSections() {
  const el = document.getElementById("lic-sections");
  if (!el) return;
  if (!activeProducts.size) {
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Select one or more products above.</div>';
    return;
  }
  el.innerHTML = "";
  [...activeProducts].sort((a,b) => a-b).forEach(idx => {
    const group = pricelist[idx];
    if (!group) return;
    const section = document.createElement("div");
    section.className = "lic-section";
    section.id = "lic-sec-" + idx;

    let rows = group.items.map((item, iidx) => {
      const rid = `lic-${idx}-${iidx}`;
      const itemPrice = item.price || 0;
      return `<tr id="${rid}">
        <td><input type="checkbox" class="lic-chk" id="${rid}-chk" checked onchange="toggleLicRow('${rid}');qtCalc()"></td>
        <td class="code">${esc(item.code)}</td>
        <td class="desc" style="max-width:320px;font-size:11px">${esc(item.desc_short)}</td>
        <td class="num">
          <div class="lic-qty-cell">
            <button class="lic-qbtn" onclick="adjLicQty('${rid}',-1)">−</button>
            <input type="number" class="lic-qty-inp" id="${rid}-qty" value="0" min="0"
              style="width:46px;height:24px;text-align:center;font-size:12px" oninput="qtCalc()">
            <button class="lic-qbtn" onclick="adjLicQty('${rid}',1)">+</button>
          </div>
        </td>
        <td class="num"><input type="number" class="price-inp lic-price" id="${rid}-price" value="${itemPrice}" min="0" oninput="qtCalc()" style="width:78px"></td>
        <td class="num" id="${rid}-total">$ 0</td>
      </tr>`;
    }).join("");

    section.innerHTML = `
      <div class="lic-section-hdr">
        <span class="lic-abbrev-badge">${esc(group.abbrev)}</span>
        <span class="lic-section-title">${esc(group.name)}</span>
      </div>
      <table class="lic-table" style="width:100%">
        <thead><tr><th style="width:30px"></th><th>Code</th><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    el.appendChild(section);
  });
}

function toggleLicRow(rid) {
  const row = document.getElementById(rid);
  const chk = document.getElementById(rid + "-chk");
  if (row && chk) row.classList.toggle("lic-off", !chk.checked);
}

function adjLicQty(rid, d) {
  const inp = document.getElementById(rid + "-qty");
  if (!inp) return;
  inp.value = Math.max(0, (parseInt(inp.value) || 0) + d);
  qtCalc();
}

// ── HW rows ──
function _hwRow(idx, pn = "", desc = "", qty = 1, listPrice = 0, margin = 60) {
  const tr = document.createElement("tr");
  tr.id = "hw-row-" + idx;
  tr.innerHTML = `
    <td class="code"><input type="text" style="width:110px;height:26px;font-size:11px" placeholder="Part #" id="hw-pn-${idx}" value="${escAttr(pn)}"></td>
    <td class="desc">
      <div style="display:flex;flex-direction:column;gap:3px">
        <input type="text" style="width:100%;height:26px;font-size:12px;font-weight:600" placeholder="Bold header (e.g. 3U Stream Labs branded server)" id="hw-hdr-${idx}" value="${escAttr(desc)}">
        <textarea style="width:100%;font-size:11px;height:72px;resize:vertical" placeholder="Detailed description (optional)" id="hw-detail-${idx}"></textarea>
      </div>
    </td>
    <td class="num"><div class="lic-qty-cell"><button class="lic-qbtn" onclick="adjHwQty(${idx},-1)">−</button><span id="hw-qty-${idx}">${qty}</span><button class="lic-qbtn" onclick="adjHwQty(${idx},1)">+</button></div></td>
    <td class="num"><input type="number" class="price-inp" id="hw-list-${idx}" value="${listPrice}" oninput="qtCalc()"></td>
    <td class="num" style="white-space:nowrap"><input type="number" class="price-inp" id="hw-margin-${idx}" value="${margin}" min="0" max="100" oninput="qtCalc()" style="width:50px"> %</td>
    <td class="num" id="hw-up-${idx}">0</td>
    <td class="num" id="hw-total-${idx}">0</td>
    <td><button class="btn danger" style="height:24px;padding:0 6px;border:none" onclick="removeHwRow(${idx})" title="Remove"><i class="ti ti-trash" style="font-size:13px"></i></button></td>`;
  return tr;
}

function adjHwQty(idx, d) {
  const span = document.getElementById("hw-qty-" + idx);
  if (!span) return;
  span.textContent = Math.max(0, parseInt(span.textContent) + d);
  qtCalc();
}

function addHwRow(pn = "", desc = "", qty = 1, listPrice = 0, margin = 60) {
  const idx = hwRowCount++;
  document.getElementById("hw-tbody").appendChild(_hwRow(idx, pn, desc, qty, listPrice, margin));
  qtCalc();
}

function removeHwRow(idx) {
  document.getElementById("hw-row-" + idx)?.remove();
  qtCalc();
}

function hwAddFromCatalog() {
  const sel = document.getElementById("hw-catalog-sel");
  if (!sel || !sel.value) return;
  const [pn, desc] = sel.value.split("|");
  addHwRow(pn, desc);
  sel.selectedIndex = 0;
}

// ── Service rows ──
function _svcRow(idx, desc = "", qty = 1, price = 0) {
  const tr = document.createElement("tr");
  tr.id = "svc-row-" + idx;
  tr.innerHTML = `
    <td class="desc" style="vertical-align:top"><textarea id="svc-desc-${idx}"
      style="width:100%;font-size:11px;resize:vertical;line-height:1.4;min-height:130px;height:130px"
      >${escAttr(desc)}</textarea></td>
    <td class="num"><div class="lic-qty-cell"><button class="lic-qbtn" onclick="adjSvcQty(${idx},-1)">−</button><span id="svc-qty-${idx}">${qty}</span><button class="lic-qbtn" onclick="adjSvcQty(${idx},1)">+</button></div></td>
    <td class="num"><input type="number" class="price-inp" id="svc-up-${idx}" value="${price}" oninput="qtCalc()"></td>
    <td class="num" id="svc-total-${idx}">0</td>
    <td><button class="btn danger" style="height:24px;padding:0 6px;border:none" onclick="removeSvcRow(${idx})" title="Remove"><i class="ti ti-trash" style="font-size:13px"></i></button></td>`;
  return tr;
}

function adjSvcQty(idx, d) {
  const span = document.getElementById("svc-qty-" + idx);
  if (!span) return;
  span.textContent = Math.max(0, parseInt(span.textContent) + d);
  qtCalc();
}

function addSvcRow(desc = "", qty = 1, price = 0) {
  const idx = svcRowCount++;
  document.getElementById("svc-tbody").appendChild(_svcRow(idx, desc, qty, price));
  qtCalc();
}

function removeSvcRow(idx) {
  document.getElementById("svc-row-" + idx)?.remove();
  qtCalc();
}

// ── Calculations ──
function qtCalc() {
  const fmtUsd = n => "$ " + Math.round(n).toLocaleString("de-DE");

  // Hardware — iterate only existing rows
  let hwList = 0, hwMargin = 0;
  for (let i = 0; i < hwRowCount; i++) {
    if (!document.getElementById("hw-row-" + i)) continue;
    const list   = parseFloat(document.getElementById("hw-list-" + i)?.value)    || 0;
    const margin = parseFloat(document.getElementById("hw-margin-" + i)?.value)  || 0;
    const qty    = parseInt(document.getElementById("hw-qty-" + i)?.textContent) || 0;
    const up     = list * (1 + margin / 100);
    const total  = up * qty;
    hwList   += list * qty;
    hwMargin += total;
    const upEl    = document.getElementById("hw-up-" + i);
    const totalEl = document.getElementById("hw-total-" + i);
    if (upEl)    upEl.textContent    = fmtUsd(up);
    if (totalEl) totalEl.textContent = fmtUsd(total);
  }

  // Software
  let swList = 0;
  activeProducts.forEach(idx => {
    const group = pricelist[idx];
    if (!group) return;
    group.items.forEach((item, iidx) => {
      const rid  = `lic-${idx}-${iidx}`;
      const chk  = document.getElementById(rid + "-chk");
      if (!chk?.checked) return;
      const qty   = parseInt(document.getElementById(rid + "-qty")?.value) || 0;
      const price = parseFloat(document.getElementById(rid + "-price")?.value)    || 0;
      const total = qty * price;
      swList += total;
      const tel = document.getElementById(rid + "-total");
      if (tel) tel.textContent = fmtUsd(total);
    });
  });

  const swDisc    = parseFloat(document.getElementById("qt-sw-disc")?.value) || 0;
  const swDiscVal = swList * (1 - swDisc / 100);

  // Services — iterate only existing rows
  let svcTotal = 0;
  for (let i = 0; i < svcRowCount; i++) {
    if (!document.getElementById("svc-row-" + i)) continue;
    const qty   = parseInt(document.getElementById("svc-qty-" + i)?.textContent) || 0;
    const up    = parseFloat(document.getElementById("svc-up-" + i)?.value)      || 0;
    const total = qty * up;
    svcTotal += total;
    const tel = document.getElementById("svc-total-" + i);
    if (tel) tel.textContent = fmtUsd(total);
  }

  const grandTotal = hwMargin + swDiscVal + svcTotal;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  // Currency setup
  const currency = document.getElementById("qt-currency")?.value || "USD";
  const usdRate  = parseFloat(document.getElementById("qt-usd-rate")?.value) || 1.08;
  const showBoth = document.getElementById("qt-show-both")?.checked;
  // UI always shows USD; EUR conversion only in export
  const fmtCur = n => {
    if (currency === "EUR") return "€ " + Math.round(n / usdRate).toLocaleString("de-DE");
    return "$ " + Math.round(n).toLocaleString("de-DE");
  };
  const rateRow = document.getElementById("usd-rate-row");
  if (rateRow) rateRow.style.display = currency === "EUR" ? "none" : "";

  set("qt-s-hw-list",     fmtCur(hwList));
  set("qt-s-hw-margin",   fmtCur(hwMargin));
  set("qt-s-sw-list",     fmtCur(swList));
  set("qt-s-sw-disc",     swDisc + "%");
  set("qt-s-sw-disc-val", fmtCur(swDiscVal));
  set("qt-s-svc",         fmtCur(svcTotal));

  _qtCalculatedTotal = grandTotal;
  const totalEl = document.getElementById("qt-s-total");
  if (totalEl) totalEl.value = _qtTotalOverride === null ? fmtCur(grandTotal) : fmtCur(_qtTotalOverride);

  qtUpdate();
  calcSLA();
}

// ── Grand Total manual override ──
let _qtTotalOverride    = null; // number (in currently displayed currency units) or null when following the calculation
let _qtCalculatedTotal  = 0;

// Reads the value typed into the total field and stores it in the same
// raw (USD-based, pre-fmtCur) units as _qtCalculatedTotal.
function qtTotalInput() {
  const el = document.getElementById("qt-s-total");
  if (!el) return;
  const raw = el.value.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = parseFloat(raw);
  if (isNaN(n)) { _qtTotalOverride = null; }
  else {
    const currency = document.getElementById("qt-currency")?.value || "USD";
    const usdRate  = parseFloat(document.getElementById("qt-usd-rate")?.value) || 1.08;
    _qtTotalOverride = currency === "EUR" ? n * usdRate : n;
  }
  const resetBtn = document.getElementById("qt-total-reset-btn");
  if (resetBtn) resetBtn.style.display = _qtTotalOverride !== null ? "" : "none";
}

function qtTotalBlur() {
  if (_qtTotalOverride === null) return;
  qtCalc(); // reformats the field via fmtCur, consistent with the currency toggle
}

function qtResetTotalOverride() {
  _qtTotalOverride = null;
  const resetBtn = document.getElementById("qt-total-reset-btn");
  if (resetBtn) resetBtn.style.display = "none";
  qtCalc();
}

// Grand total currently in effect (raw USD-based units) — used for saving/Pipedrive.
function qtEffectiveTotalUsd() {
  return _qtTotalOverride !== null ? _qtTotalOverride : _qtCalculatedTotal;
}

// ── Pricelist upload ──
async function uploadPricelist() {
  const file = document.getElementById("pricelist-upload")?.files[0];
  if (!file) return;
  const status = document.getElementById("pricelist-status");
  if (status) { status.textContent = "Uploading…"; status.style.color = "var(--muted)"; }
  const fd = new FormData();
  fd.append("file", file);
  try {
    const r = await fetch("/api/pricelist/upload", { method: "POST", body: fd });
    const d = await r.json();
    if (d.ok) {
      if (status) { status.textContent = `Updated: ${d.groups} product groups, ${d.items} items.`; status.style.color = "var(--success)"; }
      await loadPricelist();
      // Re-render active product sections
      renderLicSections();
    } else {
      if (status) { status.textContent = d.error || "Upload failed"; status.style.color = "var(--danger)"; }
    }
  } catch(e) {
    if (status) { status.textContent = "Upload error: " + e.message; status.style.color = "var(--danger)"; }
  }
}

// ── Export (placeholder — real generation in next step) ──
async function exportQuote(type) {
  const statusEl = document.getElementById("export-status");
  statusEl.style.display = "block";
  statusEl.textContent = "Generating…";
  statusEl.style.color = "var(--muted)";
  try {
    const data = qtGetData();
    const r = await fetch("/api/export/" + type, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: r.statusText }));
      statusEl.textContent = "Error: " + (err.error || r.statusText);
      statusEl.style.color = "var(--danger)";
      return;
    }
    // Determine what files come back
    const ct = r.headers.get("Content-Type") || "";
    if (ct.includes("application/json")) {
      // "both" — server returns JSON with two download tokens
      const result = await r.json();
      if (result.xlsx) downloadByToken(result.xlsx, "xlsx");
      if (result.pdf)  downloadByToken(result.pdf,  "pdf");
      statusEl.textContent = "✓ Files ready";
    } else {
      // Single file — blob download
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition") || "";
      const fnMatch = cd.match(/filename="?([^"]+)"?/);
      const filename = fnMatch ? fnMatch[1] : ("quotation." + (ct.includes("pdf") ? "pdf" : "xlsx"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      statusEl.textContent = "✓ Downloaded: " + filename;
      if (type === "xlsx") _prefillPipedriveFile(blob, filename);
    }
    statusEl.style.color = "var(--success)";
  } catch(e) {
    statusEl.textContent = "Error: " + e.message;
    statusEl.style.color = "var(--danger)";
  }
}

async function downloadByToken(token, ext) {
  const r = await fetch("/api/export/download/" + token);
  const blob = await r.blob();
  const cd = r.headers.get("Content-Disposition") || "";
  const fnMatch = cd.match(/filename="?([^"]+)"?/);
  const filename = fnMatch ? fnMatch[1] : ("quotation." + ext);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  if (ext === "xlsx") _prefillPipedriveFile(blob, filename);
}

// Pre-fills (but does NOT upload) the Pipedrive file picker with the just-exported
// file, purely as a convenience default — the user can still swap in a hand-edited
// file before clicking "Upload to Pipedrive".
function _prefillPipedriveFile(blob, filename) {
  const input = document.getElementById("pd-upload-file");
  if (!input) return;
  try {
    const file = new File([blob], filename, { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    const status = document.getElementById("pipedrive-upload-status");
    if (status) { status.textContent = `Ready: ${filename} (from last export)`; status.style.color = "var(--muted)"; }
  } catch (e) { /* DataTransfer unsupported — user just picks the file manually */ }
}

function onValidDaysChange() {
  const days = parseInt(document.getElementById("qt-valid-days")?.value) || 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  const dateEl = document.getElementById("qt-valid-date");
  if (dateEl) dateEl.value = d.toISOString().slice(0, 10);
  qtUpdate();
}

function onValidDateChange() {
  const dateEl = document.getElementById("qt-valid-date");
  if (!dateEl?.value) return;
  const target = new Date(dateEl.value);
  const today  = new Date();
  today.setHours(0,0,0,0);
  const days = Math.max(1, Math.round((target - today) / 86400000));
  const daysEl = document.getElementById("qt-valid-days");
  if (daysEl) daysEl.value = days;
  qtUpdate();
}

function qtGetData() {
  // Collect all quotation data into one object for export
  const licenses = [];
  activeProducts.forEach(idx => {
    const group = pricelist[idx];
    if (!group) return;
    const items = [];
    group.items.forEach((item, iidx) => {
      const rid   = `lic-${idx}-${iidx}`;
      const chk   = document.getElementById(rid + "-chk");
      const qty   = parseInt(document.getElementById(rid + "-qty")?.value) || 0;
      const price = parseFloat(document.getElementById(rid + "-price")?.value)    || 0;
      if (chk?.checked && (qty > 0 || price > 0)) {
        items.push({ ...item, qty, price, total: qty * price });
      }
    });
    if (items.length) licenses.push({ name: group.name, abbrev: group.abbrev, description: group.description || "", section_label: group.section_label || "", logo: group.logo || "", items });
  });

  const hw = [];
  for (let i = 0; i < hwRowCount; i++) {
    if (!document.getElementById("hw-row-" + i)) continue;
    const pn     = document.getElementById("hw-pn-" + i)?.value     || "";
    const desc   = document.getElementById("hw-hdr-" + i)?.value    || "";
    const detail = document.getElementById("hw-detail-" + i)?.value || "";
    const qty    = parseInt(document.getElementById("hw-qty-" + i)?.textContent) || 0;
    const list   = parseFloat(document.getElementById("hw-list-" + i)?.value)   || 0;
    const marg   = parseFloat(document.getElementById("hw-margin-" + i)?.value) || 0;
    if (pn || desc) hw.push({ pn, desc, detail, qty, list_price: list, margin: marg, unit_price: list*(1+marg/100), total: list*(1+marg/100)*qty });
  }

  const slaUseSW = document.getElementById("sla-base-sw")?.checked || false;
  const slaUseHW = document.getElementById("sla-base-hw")?.checked || false;
  const slaRate  = parseFloat(document.getElementById("sla-rate")?.value) || 0;

  const svc = [];
  for (let i = 0; i < svcRowCount; i++) {
    if (!document.getElementById("svc-row-" + i)) continue;
    const desc = document.getElementById("svc-desc-" + i)?.value || "";
    const qty  = parseInt(document.getElementById("svc-qty-" + i)?.textContent) || 1;
    const up   = parseFloat(document.getElementById("svc-up-" + i)?.value)      || 0;
    const upEl = document.getElementById("svc-up-" + i);
    const isSlaRow = (i === 0) && upEl && upEl.dataset.slaManual !== "1" && slaRate > 0;
    if (desc) svc.push({
      desc, qty, unit_price: up, total: qty * up,
      is_sla_formula: isSlaRow,
      sla_use_sw: slaUseSW, sla_use_hw: slaUseHW, sla_rate: slaRate,
    });
  }

  const currency = document.getElementById("qt-currency")?.value || "USD";
  const usdRate  = parseFloat(document.getElementById("qt-usd-rate")?.value) || 1.08;
  return {
    company:       document.getElementById("qt-company")?.value || "",
    contact:       document.getElementById("qt-contact")?.value || "",
    address:       document.getElementById("qt-address")?.value || "",
    country:       document.getElementById("qt-country")?.value || "",
    phone:         document.getElementById("qt-phone")?.value   || "",
    email:         document.getElementById("qt-email")?.value   || "",
    deal_id:       document.getElementById("qt-deal-id")?.value || "",
    version:       document.getElementById("qt-version")?.value || "V1",
    valid_days:    document.getElementById("qt-valid-days")?.value || "30",
    signed_by:     document.getElementById("qt-signed-by")?.value || "",
    sales_contact: document.getElementById("qt-sales-contact")?.value || "",
    sales_email:   document.getElementById("qt-sales-email")?.value  || "",
    summary:       document.getElementById("qt-summary")?.value || "",
    sw_discount:   parseFloat(document.getElementById("qt-sw-disc")?.value) || 0,
    quote_id:      document.getElementById("qt-id-preview")?.textContent || "",
    currency:      currency,
    usd_rate:      usdRate,
    show_both:     document.getElementById("qt-show-both")?.checked  || false,
    show_logos:    document.getElementById("qt-show-logos")?.checked || false,
    hardware:      hw,
    licenses,
    services:      svc,
    server_config:      getServerConfigTable(),
    server_config_text: document.getElementById("out-box")?.textContent || "",
    server_config_raw:  getServerConfigRaw(),
    grand_total_override: _qtTotalOverride,
  };
}

function getServerConfigTable() {
  const ordered = orderedCats();
  const rows = [];
  srvIds.forEach(id => {
    const card = document.getElementById(id);
    if (!card) return;
    const name = card.querySelector(".srv-name")?.value || id;
    const qty  = parseInt(card.querySelector(".qty-v")?.textContent) || 1;
    const comps = [];
    for (const [, catId] of ordered) {
      const cat = getCatById(catId); if (!cat) continue;

      // Seldom Used — multi-row
      if (catId === "seldom_used") {
        getSeldomComponents(id).forEach(s => {
          comps.push({ category: "Seldom Used", value: `${s.qty}× ${s.name}` });
        });
        continue;
      }

      const sel = document.getElementById(`${id}-${catId}`);
      if (!sel || !sel.value) continue;
      const hasQty = WITH_QTY.has(catId) || cat.has_qty;
      let val = sel.value;
      if (hasQty) {
        const qspan = document.getElementById(`${id}-${catId}-qty`);
        const q = qspan ? parseInt(qspan.textContent) || 1 : 1;
        val = `${q}× ${val}`;
      }
      comps.push({ category: cat.name, value: val });

      // OS add-on
      if (catId === "os") {
        const addonSel = document.getElementById(`${id}-${catId}-addon`);
        if (addonSel?.value) {
          const addonQspan = document.getElementById(`${id}-${catId}-addon-qty`);
          const addonQ = addonQspan ? parseInt(addonQspan.textContent) || 1 : 1;
          comps.push({ category: "OS (add-on)", value: `${addonQ}× ${addonSel.value}` });
        }
      }
    }
    rows.push({ name, qty, components: comps });
  });
  return rows;
}

function calcTdp(srvId) {
  const card = document.getElementById(srvId);
  if (!card) return;
  const ordered = orderedCats();
  // Categories that consume power (not PSU/Case/OS/Motherboard/CPU Cooler)
  const TDP_CATS = new Set(["cpu","ram","gpu","network","raid_controller","raid_disks","pci_card_1","pci_card_2"]);
  let total = 0;

  for (const [, catId] of ordered) {
    const cat = getCatById(catId);
    if (!cat || !TDP_CATS.has(catId)) continue;
    const sel = document.getElementById(`${srvId}-${catId}`);
    // Skip if nothing selected (empty value = "— none —")
    if (!sel || !sel.value) continue;
    // Find item object by name
    const item = cat.items.find(it => (typeof it === "object" ? it.name : it) === sel.value);
    const tdp  = (typeof item === "object" ? (item.tdp || 0) : 0);
    if (!tdp) continue;  // skip items with no TDP data
    // Multiply by qty for components that have it
    const hasQty = WITH_QTY.has(catId) || cat.has_qty;
    const qty    = hasQty
      ? (parseInt(document.getElementById(`${srvId}-${catId}-qty`)?.textContent) || 1)
      : 1;
    total += tdp * qty;
  }

  // Get PSU capacity for colour coding
  const psuSel  = document.getElementById(`${srvId}-psu`);
  const psuCat  = getCatById("psu");
  const psuItem = psuCat?.items.find(it => (typeof it === "object" ? it.name : it) === psuSel?.value);
  const psuCap  = (typeof psuItem === "object" ? psuItem.tdp : 0) || 0;

  const el = document.getElementById(`${srvId}-tdp`);
  if (el) {
    const span = el.querySelector(".tdp-val");
    if (span) {
      span.textContent = total;
      if (psuCap > 0) {
        span.style.color = total > psuCap ? "var(--danger)" : "var(--success)";
        el.title = `PSU capacity: ${psuCap}W`;
      } else {
        span.style.color = "var(--text)";
      }
    }
  }

  // Validate PCIe slots whenever anything changes
  validatePcie(srvId);
}

/* ══════════════════════════════
   PCIe SLOT VALIDATION
══════════════════════════════ */



/* ══════════════════════════════
   CPU → RAM AUTO-SET
══════════════════════════════ */

function onCpuChange(srvId, sel) {
  // Get CPU meta from selected option
  const opt  = sel.options[sel.selectedIndex];
  const meta = opt?.dataset?.meta;
  if (!meta) return;
  let cpu;
  try { cpu = JSON.parse(meta); } catch { return; }

  const { mem_channels, mem_type } = cpu;
  if (!mem_channels) return;

  // Auto-set RAM qty to mem_channels
  const ramSel  = document.getElementById(`${srvId}-ram`);
  const ramQty  = document.getElementById(`${srvId}-ram-qty`);

  if (ramSel && mem_type) {
    // Find a matching RAM option by mem_type (items are now objects)
    for (const opt of ramSel.options) {
      if (opt.value && opt.value.toLowerCase().startsWith(mem_type.toLowerCase())) {
        ramSel.value = opt.value;
        break;
      }
    }
  }
  if (ramQty) {
    ramQty.textContent = mem_channels;
  }

  validateRam(srvId);
  calcTdp(srvId);
}

function validateRam(srvId) {
  // Check RAM qty vs CPU requirement, highlight if mismatch
  const cpuSel  = document.getElementById(`${srvId}-cpu`);
  const ramQty  = document.getElementById(`${srvId}-ram-qty`);
  const ramCell = document.getElementById(`${srvId}-ram`)?.closest(".comp-cell");
  if (!cpuSel || !ramQty || !ramCell) return;

  const opt  = cpuSel.options[cpuSel.selectedIndex];
  const meta = opt?.dataset?.meta;
  if (!meta) { ramCell.style.outline = ""; return; }
  let cpu;
  try { cpu = JSON.parse(meta); } catch { ramCell.style.outline = ""; return; }

  const required = cpu.mem_channels;
  const actual   = parseInt(ramQty.textContent) || 0;
  if (!required) { ramCell.style.outline = ""; return; }

  if (actual !== required) {
    ramCell.style.outline    = "2px solid var(--danger)";
    ramCell.title = `CPU requires ${required} RAM modules (currently ${actual})`;
  } else {
    ramCell.style.outline = "";
    ramCell.title = "";
  }
}

/* ══════════════════════════════
   SLA AUTO-CALCULATION
══════════════════════════════ */

function calcSLA() {
  const useSW = document.getElementById("sla-base-sw")?.checked;
  const useHW = document.getElementById("sla-base-hw")?.checked;
  const rate  = parseFloat(document.getElementById("sla-rate")?.value) || 0;

  // Recalculate SW and HW totals directly from inputs (avoid text parsing)
  let swRaw = 0, hwRaw = 0;
  for (let i = 0; i < hwRowCount; i++) {
    if (!document.getElementById("hw-row-" + i)) continue;
    const list = parseFloat(document.getElementById("hw-list-" + i)?.value) || 0;
    const marg = parseFloat(document.getElementById("hw-margin-" + i)?.value) || 0;
    const qty  = parseInt(document.getElementById("hw-qty-" + i)?.textContent) || 0;
    hwRaw += list * (1 + marg/100) * qty;
  }
  activeProducts.forEach(idx => {
    const group = pricelist[idx]; if (!group) return;
    group.items.forEach((item, iidx) => {
      const rid = `lic-${idx}-${iidx}`;
      if (!document.getElementById(rid + "-chk")?.checked) return;
      const qty   = parseInt(document.getElementById(rid + "-qty")?.value) || 0;
      const price = parseFloat(document.getElementById(rid + "-price")?.value) || 0;
      swRaw += qty * price;
    });
  });
  const swDisc = parseFloat(document.getElementById("qt-sw-disc")?.value) || 0;
  const swDiscVal = swRaw * (1 - swDisc/100);

  let base = 0;
  if (useSW) base += swDiscVal;
  if (useHW) base += hwRaw;
  const slaPrice = Math.round(base * rate / 100);

  const dispEl = document.getElementById("sla-price-display");
  if (dispEl) dispEl.textContent = "$ " + slaPrice.toLocaleString("de-DE");

  const upEl = document.getElementById("svc-up-0");
  if (upEl && upEl.dataset.slaManual !== "1") {
    upEl.value = slaPrice;
    const qty  = parseInt(document.getElementById("svc-qty-0")?.textContent) || 1;
    const tel  = document.getElementById("svc-total-0");
    if (tel) tel.textContent = "$ " + (slaPrice * qty).toLocaleString("de-DE");
  }
}

// calcSLA is called at the end of qtCalc directly — see qtCalc()

/* ══════════════════════════════
   SALES CONTACTS
══════════════════════════════ */

let contactsList = [];   // Sales contacts
let signersList   = [];  // Signed-by contacts

async function loadContacts() {
  try {
    const [rc, rs] = await Promise.all([
      fetch("/api/contacts?role=sales"),
      fetch("/api/contacts?role=signers"),
    ]);
    contactsList = await rc.json();
    signersList  = await rs.json();
    renderContactsSelect();
  } catch(e) { console.error("Contacts load failed", e); }
}

function renderContactsSelect() {
  // Sales contact dropdown
  const sel = document.getElementById("qt-sales-contact-sel");
  if (sel) {
    const cur = document.getElementById("qt-sales-contact")?.value;
    sel.innerHTML = '<option value="">— select —</option>' +
      contactsList.map((c,i) =>
        `<option value="${i}" ${c.name===cur?"selected":""}>${esc(c.name)}</option>`
      ).join("");
  }
  // Signed By dropdown — separate signersList
  const sbSel = document.getElementById("qt-signed-by-sel");
  if (sbSel) {
    const curSB = document.getElementById("qt-signed-by")?.value;
    sbSel.innerHTML = '<option value="">— select —</option>' +
      signersList.map((c,i) =>
        `<option value="${i}" ${c.name===curSB?"selected":""}>${esc(c.name)}</option>`
      ).join("");
  }
}

function onSignedBySelect() {
  const sel = document.getElementById("qt-signed-by-sel");
  const idx = parseInt(sel?.value);
  if (isNaN(idx) || !signersList[idx]) return;
  const nameEl = document.getElementById("qt-signed-by");
  if (nameEl) nameEl.value = signersList[idx].name;
}

function onContactSelect() {
  const sel = document.getElementById("qt-sales-contact-sel");
  const idx = parseInt(sel?.value);
  if (isNaN(idx) || !contactsList[idx]) return;
  const c = contactsList[idx];
  const nameEl  = document.getElementById("qt-sales-contact");
  const emailEl = document.getElementById("qt-sales-email");
  if (nameEl)  nameEl.value  = c.name;
  if (emailEl) emailEl.value = c.email;
}

function showContactsEditor() {
  renderContactsModal();
  const m = document.getElementById("contacts-modal");
  if (m) { m.style.display = "flex"; }
}
function hideContactsEditor() {
  const m = document.getElementById("contacts-modal");
  if (m) m.style.display = "none";
}

let _contactsTab = "sales"; // which tab is active in modal

function renderContactsModal() {
  const el = document.getElementById("contacts-list");
  if (!el) return;
  const list = _contactsTab === "signers" ? signersList : contactsList;
  const tabStyle = (t) => `padding:5px 12px;font-size:12px;cursor:pointer;border:none;border-bottom:2px solid ${_contactsTab===t?"var(--accent)":"transparent"};background:none;color:${_contactsTab===t?"var(--accent)":"var(--muted)"};`;
  el.innerHTML = `
    <div style="display:flex;gap:0;margin-bottom:10px;border-bottom:1px solid var(--border)">
      <button style="${tabStyle("sales")}" onclick="_contactsTab='sales';renderContactsModal()">Sales Contacts</button>
      <button style="${tabStyle("signers")}" onclick="_contactsTab='signers';renderContactsModal()">Signed By</button>
    </div>` +
    (list.length ? list.map((c, i) => `
    <div style="display:flex;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">
      <input type="text" value="${escAttr(c.name)}" id="ce-name-${i}"
        style="flex:1;height:28px;font-size:12px" onchange="saveContactEdit(${i})">
      <input type="text" value="${escAttr(c.email)}" id="ce-email-${i}"
        style="flex:1.2;height:28px;font-size:12px" onchange="saveContactEdit(${i})">
      <button class="btn danger" style="height:28px;padding:0 7px;border:none" onclick="deleteContact(${i})" title="Remove">
        <i class="ti ti-trash" style="font-size:13px"></i>
      </button>
    </div>`).join("") :
    '<div style="font-size:12px;color:var(--muted);padding:6px 0">No contacts yet.</div>');
}

async function saveContactEdit(idx) {
  const name  = document.getElementById("ce-name-"  + idx)?.value.trim();
  const email = document.getElementById("ce-email-" + idx)?.value.trim();
  if (!name) return;
  const role = _contactsTab;
  await fetch(`/api/contacts/${idx}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, role }),
  });
  if (role === "signers") signersList[idx] = { name, email };
  else contactsList[idx] = { name, email };
  renderContactsSelect();
}

async function addContact() {
  const name  = document.getElementById("new-contact-name")?.value.trim();
  const email = document.getElementById("new-contact-email")?.value.trim();
  if (!name) { alert("Name is required"); return; }
  const role = _contactsTab;
  const r = await fetch("/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, role }),
  });
  const d = await r.json();
  if (d.ok) {
    if (role === "signers") signersList.push({ name, email });
    else contactsList.push({ name, email });
    document.getElementById("new-contact-name").value  = "";
    document.getElementById("new-contact-email").value = "";
    renderContactsModal();
    renderContactsSelect();
  }
}

async function deleteContact(idx) {
  const role = _contactsTab;
  const list = role === "signers" ? signersList : contactsList;
  if (!confirm(`Remove "${list[idx]?.name}"?`)) return;
  await fetch(`/api/contacts/${idx}?role=${role}`, { method: "DELETE" });
  list.splice(idx, 1);
  renderContactsModal();
  renderContactsSelect();
}

// Load contacts when Quotation tab opens
document.addEventListener("DOMContentLoaded", () => {
  document.querySelector('[data-tab="quote"]')?.addEventListener("click", () => {
    if (!contactsList.length) loadContacts();
  });
  // Close modal on backdrop click
  document.getElementById("contacts-modal")?.addEventListener("click", e => {
    if (e.target === document.getElementById("contacts-modal")) hideContactsEditor();
  });
});

/* ══════════════════════════════
   QUOTATION PREVIEW
══════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-preview")?.addEventListener("click", showPreview);

  // Init valid-until date to today + 30 days
  const validDateEl = document.getElementById("qt-valid-date");
  if (validDateEl) {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    validDateEl.value = d.toISOString().slice(0, 10);
  }
  document.getElementById("preview-modal")?.addEventListener("click", e => {
    if (e.target === document.getElementById("preview-modal"))
      document.getElementById("preview-modal").style.display = "none";
  });
});

async function showPreview() {
  const data = qtGetData();
  const spinner = document.getElementById("preview-spinner");
  if (spinner) { spinner.style.display = "flex"; spinner.innerHTML = '<i class="ti ti-loader-2" style="font-size:24px;animation:spin 1s linear infinite"></i> Generating preview…'; }

  try {
    const r = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await r.json();
    if (spinner) spinner.style.display = "none";
    if (!result.ok) {
      alert("Preview error: " + (result.error || "Unknown error"));
      return;
    }
    // Open preview HTML in new browser tab — user can Ctrl+P to save as PDF
    window.open("/api/preview/html?t=" + Date.now(), "_blank");
  } catch(e) {
    if (spinner) spinner.style.display = "none";
    alert("Preview error: " + e.message);
  }
}

function buildPreviewHTML(d) {
  const fmt = n => "€ " + (parseFloat(n)||0).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2});
  const esc2 = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
  const date = new Date().toLocaleDateString("en-GB");
  const validUntil = new Date(Date.now() + (parseInt(d.valid_days)||30)*86400000).toLocaleDateString("en-GB");

  const style = `
    <style>
      * { box-sizing: border-box; margin:0; padding:0; }
      body { font-family: Arial, sans-serif; font-size: 8pt; color: #40495a; }
      table { width:100%; border-collapse:collapse; }
      td, th { border:1px solid #ccc; padding:4px 6px; vertical-align:top; }
      .sec-hdr { background:#1D2F41; color:#fff; font-weight:600; font-size:9pt; padding:5px 6px; }
      .col-hdr { background:#1D2F41; color:#fff; font-size:7pt; text-align:center; padding:3px 4px; }
      .num { text-align:right; }
      .muted { color:#888; font-size:7pt; }
      .total-lbl { font-weight:700; font-size:10pt; }
      .grand-total td { background:#f0f4ff; font-size:10pt; font-weight:700; }
      .terms { font-size:7.5pt; line-height:1.6; }
      h1 { font-size:15pt; font-weight:700; text-align:right; }
      .meta td { border:none; border-bottom:1px solid #eee; font-size:8pt; }
      .meta td:first-child { color:#888; width:90px; }
    </style>`;

  // ── Header ──
  let html = style + `
  <h1 style="margin-bottom:12px">Formal Quotation</h1>
  <table style="margin-bottom:12px">
    <tr>
      <td style="width:55%;border:1px solid #ccc;vertical-align:top;padding:8px">
        <div style="font-weight:700;font-size:9pt;margin-bottom:4px">${esc2(d.company)}</div>
        <div>${esc2(d.address)}${d.country ? ", "+esc2(d.country):""}</div>
        <div>${esc2(d.contact)}</div>
        <div>${esc2(d.phone)}</div>
        <div>${esc2(d.email)}</div>
      </td>
      <td style="border:1px solid #ccc;padding:8px">
        <table class="meta">
          <tr><td>Date:</td><td>${date}</td></tr>
          <tr><td>Valid until:</td><td>${validUntil}</td></tr>
          <tr><td>Quote ID:</td><td><strong>${esc2(d.quote_id)}</strong></td></tr>
          <tr><td>Signed by:</td><td>${esc2(d.signed_by)}</td></tr>
          <tr><td>Sales:</td><td>${esc2(d.sales_contact)}</td></tr>
          <tr><td></td><td style="color:#2563eb">${esc2(d.sales_email)}</td></tr>
        </table>
      </td>
    </tr>
  </table>`;

  if (d.summary) {
    html += `<table style="margin-bottom:12px"><tr>
      <td colspan="2" class="sec-hdr">Summary</td></tr>
      <tr><td style="padding:6px 8px;border:1px solid #ccc">${esc2(d.summary)}</td></tr>
    </table>`;
  }

  // ── Hardware ──
  if (d.hardware && d.hardware.length) {
    html += `<table style="margin-bottom:12px">
      <tr><td colspan="5" class="sec-hdr">Hardware</td></tr>
      <tr>
        <th class="col-hdr" style="width:45%">Description</th>
        <th class="col-hdr" style="width:13%">Part #</th>
        <th class="col-hdr" style="width:8%">Qty</th>
        <th class="col-hdr" style="width:14%">Unit Price</th>
        <th class="col-hdr" style="width:14%">Total</th>
      </tr>`;
    let hwTotal = 0;
    d.hardware.forEach(hw => {
      const up = hw.unit_price || hw.list_price*(1+(hw.margin||0)/100);
      const total = up * hw.qty;
      hwTotal += total;
      html += `<tr>
        <td><strong>${esc2(hw.desc)}</strong>${hw.detail?"<br><span class='muted'>"+esc2(hw.detail)+"</span>":""}</td>
        <td class="muted">${esc2(hw.pn)}</td>
        <td class="num">${hw.qty}</td>
        <td class="num">${fmt(up)}</td>
        <td class="num">${fmt(total)}</td>
      </tr>`;
    });
    html += `<tr style="background:#f8f9ff">
      <td colspan="4" style="text-align:right;font-weight:700">Hardware Total</td>
      <td class="num" style="font-weight:700">${fmt(hwTotal)}</td>
    </tr></table>`;
  }

  // ── Licenses ──
  if (d.licenses && d.licenses.length) {
    let swList = 0;
    d.licenses.forEach(group => {
      html += `<table style="margin-bottom:8px">
        <tr><td colspan="4" class="sec-hdr">${esc2(group.name)}</td></tr>
        <tr>
          <th class="col-hdr" style="width:52%">Description</th>
          <th class="col-hdr" style="width:12%">Code</th>
          <th class="col-hdr" style="width:10%">Qty</th>
          <th class="col-hdr" style="width:16%">Total</th>
        </tr>`;
      let groupTotal = 0;
      group.items.forEach(item => {
        const total = (item.qty||0)*(item.price||0);
        groupTotal += total;
        html += `<tr>
          <td>${esc2(item.desc_short||item.desc)}</td>
          <td class="muted num">${esc2(item.code)}</td>
          <td class="num">${item.qty||0}</td>
          <td class="num">${fmt(total)}</td>
        </tr>`;
      });
      swList += groupTotal;
      html += `<tr style="background:#f8f9ff">
        <td colspan="3" style="text-align:right;font-weight:700">Subtotal</td>
        <td class="num" style="font-weight:700">${fmt(groupTotal)}</td>
      </tr></table>`;
    });
    const disc = d.sw_discount || 0;
    const swDisc = swList * (1 - disc/100);
    html += `<table style="margin-bottom:12px">
      <tr><td style="text-align:right;border:none;padding:3px 6px">SW List: ${fmt(swList)}</td>
      <td style="text-align:right;border:none;padding:3px 6px">Discount: ${disc}%</td>
      <td style="text-align:right;font-weight:700;border:none;padding:3px 6px;color:#2563eb">SW Discounted: ${fmt(swDisc)}</td></tr>
    </table>`;
  }

  // ── Services ──
  if (d.services && d.services.length) {
    html += `<table style="margin-bottom:12px">
      <tr><td colspan="4" class="sec-hdr">Support, Warranty, Installation &amp; other services</td></tr>
      <tr>
        <th class="col-hdr" style="width:55%">Description</th>
        <th class="col-hdr" style="width:10%">Qty</th>
        <th class="col-hdr" style="width:15%">Unit Price</th>
        <th class="col-hdr" style="width:15%">Total</th>
      </tr>`;
    let svcTotal = 0;
    d.services.forEach(svc => {
      const total = (svc.qty||1)*(svc.unit_price||0);
      svcTotal += total;
      html += `<tr>
        <td>${esc2(svc.desc)}</td>
        <td class="num">${svc.qty||1}</td>
        <td class="num">${fmt(svc.unit_price||0)}</td>
        <td class="num">${fmt(total)}</td>
      </tr>`;
    });
    html += `<tr style="background:#f8f9ff">
      <td colspan="3" style="text-align:right;font-weight:700">Services Total</td>
      <td class="num" style="font-weight:700">${fmt(svcTotal)}</td>
    </tr></table>`;
  }

  // ── Grand Total ──
  const hwT  = (d.hardware||[]).reduce((s,h)=>s+(h.unit_price||h.list_price*(1+(h.margin||0)/100))*h.qty,0);
  const swT  = (d.licenses||[]).reduce((s,g)=>s+g.items.reduce((ss,i)=>ss+(i.qty||0)*(i.price||0),0),0)*(1-(d.sw_discount||0)/100);
  const svcT = (d.services||[]).reduce((s,v)=>s+(v.qty||1)*(v.unit_price||0),0);
  const grand = hwT + swT + svcT;

  html += `<table class="grand-total" style="margin-bottom:16px">
    <tr><td style="border:2px solid #1D2F41;padding:8px 12px">
      <span class="total-lbl">GRAND TOTAL</span>
    </td>
    <td style="border:2px solid #1D2F41;text-align:right;padding:8px 12px">
      <span class="total-lbl" style="color:#2563eb">${fmt(grand)}</span>
    </td></tr>
  </table>`;

  // Terms
  html += `<div class="terms" style="margin-bottom:16px;padding:8px;border:1px solid #eee">
    <strong>Terms:</strong><br>
    &bull; T/T in advance or by agreement terms;<br>
    &bull; Shipment after TT within 1-4 weeks after receipt;<br>
    &bull; Prices are excluding: any taxes, duties and customs;<br>
    &bull; Delivery: Ex-works;<br>
    &bull; Hardware Warranty &ndash; 12 months from date of shipment;
  </div>
  <div style="text-align:center;color:#888;font-style:italic">Thank you for your business!</div>`;

  return html;
}

/* ══════════════════════════════
   TEST DATA
══════════════════════════════ */

/* ══════════════════════════════
   PRICELIST EDITOR
══════════════════════════════ */

let plData        = [];   // full pricelist
let plActiveGroup = null; // current group index

document.addEventListener("DOMContentLoaded", () => {
  document.querySelector('[data-tab="pricelist"]')?.addEventListener("click", () => {
    if (!plData.length) plLoad();
  });
  document.getElementById("pl-upload-file")?.addEventListener("change", plUpload);
});

async function plAddGroup() {
  const name   = prompt("New product group name:");
  if (!name?.trim()) return;
  const abbrev = prompt("Abbreviation (2-3 letters, e.g. MP, VP):", "");
  const r = await fetch("/api/pricelist/group", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name: name.trim(), abbrev: abbrev?.trim() || "??" }),
  });
  const d = await r.json();
  if (d.ok) {
    await plLoad();
    plActiveGroup = d.index;
    plRenderGroups();
    plRenderItems();
  }
}

async function plAddItem() {
  if (plActiveGroup === null) { alert("Select a product group first."); return; }
  const code = prompt("OEM Code (e.g. SV-AS):");
  if (!code?.trim()) return;
  const desc  = prompt("Description:", "") || "";
  const price = prompt("Price (leave blank if unknown):", "");
  const r = await fetch(`/api/pricelist/group/${plActiveGroup}/item`, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      code:  code.trim(),
      desc:  desc.trim(),
      price: price?.trim() ? parseFloat(price) : null,
    }),
  });
  const d = await r.json();
  if (d.ok) {
    await plLoad();
    plRenderGroups();
    plRenderItems();
  }
}

function plSelectGroup(gi) {
  plActiveGroup = gi;
  plRenderGroups();
  plRenderItems();
}

async function plLoad() {
  try {
    const r = await fetch("/api/pricelist");
    plData = await r.json();
    plRenderGroups();
  } catch(e) { console.error("Pricelist load failed", e); }
}

function plRenderGroups() {
  const el = document.getElementById("pl-group-list");
  if (!el) return;
  el.innerHTML = "";
  plData.forEach((grp, gi) => {
    const total = grp.items.length;
    const depr  = grp.items.filter(it => it.deprecated).length;
    const div   = document.createElement("div");
    div.className = "pl-group-item" + (gi === plActiveGroup ? " active" : "");
    div.innerHTML = `
      <span style="flex:1" onclick="plSelectGroup(${gi})">${esc(grp.name)}</span>
      <span class="pl-cnt">${total - depr}${depr ? ` <span style="color:var(--warning)">(+${depr})</span>` : ""}</span>
      <button class="btn danger" style="height:20px;padding:0 5px;border:none;flex-shrink:0"
        onclick="event.stopPropagation();plDeleteGroup(${gi})" title="Delete group">
        <i class="ti ti-trash" style="font-size:11px"></i></button>`;
    div.onclick = () => plSelectGroup(gi);
    el.appendChild(div);
  });
}

function plRenderItems() {
  const tbody = document.getElementById("pl-items-tbody");
  const title = document.getElementById("pl-panel-title");
  if (!tbody) return;
  if (plActiveGroup === null || !plData[plActiveGroup]) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);padding:16px;text-align:center">Select a product group</td></tr>';
    const descRow = document.getElementById("pl-desc-row");
    if (descRow) descRow.style.display = "none";
    return;
  }
  const grp      = plData[plActiveGroup];
  const showDepr = document.getElementById("pl-show-deprecated")?.checked;

  // Editable group name in header
  if (title) {
    title.innerHTML = `
      <input type="text" value="${escAttr(grp.name)}" id="pl-grp-name-inp"
        style="font-size:13px;font-weight:600;background:none;border:none;color:var(--text);outline:none;border-bottom:1px solid transparent;min-width:200px"
        onfocus="this.style.borderBottomColor='var(--accent)'"
        onblur="plSaveGroupName(${plActiveGroup},this.value)"
        onkeydown="if(event.key==='Enter')this.blur()">
      <span style="font-size:10px;color:var(--muted);margin-left:8px">Abbrev:</span>
      <input type="text" value="${escAttr(grp.abbrev||'')}" id="pl-grp-abbrev-inp"
        style="font-size:11px;font-weight:700;background:none;border:none;color:var(--accent);outline:none;border-bottom:1px solid transparent;width:40px;text-align:center"
        onfocus="this.style.borderBottomColor='var(--accent)'"
        onblur="plSaveGroupAbbrev(${plActiveGroup},this.value)"
        onkeydown="if(event.key==='Enter')this.blur()">`;
  }

  // Show + populate description row
  const descRow = document.getElementById("pl-desc-row");
  const descInp = document.getElementById("pl-grp-desc-inp");
  const secLabelInp = document.getElementById("pl-grp-section-label-inp");
  if (descRow) descRow.style.display = "block";
  if (descInp) descInp.value = grp.description || "";
  if (secLabelInp) secLabelInp.value = grp.section_label || "";
  plRefreshLogoPreview(plActiveGroup);

  const items = grp.items.filter(it => showDepr || !it.deprecated);
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--muted);padding:16px;text-align:center">${showDepr ? "No items" : "No active items — enable 'Show deprecated' to see all"}</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const ii  = grp.items.indexOf(item);
    const gi  = plActiveGroup;
    const dep = item.deprecated;
    return `<tr class="${dep ? "deprecated" : ""}" id="pl-row-${gi}-${ii}">
      <td>
        <input type="text" value="${escAttr(item.code)}" class="pl-code"
          style="width:80px;height:24px;font-size:11px;font-family:var(--font-mono)"
          onblur="plSaveCode(${gi},${ii},this.value)"
          onkeydown="if(event.key==='Enter')this.blur()">
      </td>
      <td>
        <input class="pl-desc-inp" type="text" value="${escAttr(item.desc_short)}"
          style="width:100%"
          onblur="plSaveDesc(${gi},${ii},this.value)"
          onkeydown="if(event.key==='Enter')this.blur()">
      </td>
      <td class="num">
        <input class="pl-price-inp" type="number" value="${item.price ?? ''}"
          placeholder="—" min="0" step="0.01"
          onblur="plSavePrice(${gi},${ii},this.value)"
          onkeydown="if(event.key==='Enter')this.blur()">
      </td>
      <td style="text-align:center;white-space:nowrap;display:flex;gap:2px;align-items:center;justify-content:center">
        ${dep
          ? `<span class="pl-depr-badge">depr.</span>
             <button class="btn ghost" style="height:22px;padding:0 4px" onclick="plToggleDepr(${gi},${ii})" title="Restore">
               <i class="ti ti-refresh" style="font-size:12px;color:var(--success)"></i></button>`
          : `<button class="btn ghost" style="height:22px;padding:0 4px" onclick="plToggleDepr(${gi},${ii})" title="Deprecate">
               <i class="ti ti-eye-off" style="font-size:12px;color:var(--muted)"></i></button>`
        }
        <button class="btn danger" style="height:22px;padding:0 4px;border:none" onclick="plDeleteItem(${gi},${ii})" title="Delete permanently">
          <i class="ti ti-trash" style="font-size:12px"></i></button>
      </td>
    </tr>`;
  }).join("");
}

// The Quotation tab keeps its own copy (`pricelist`), loaded once. Mirror in-place
// edits into it, otherwise quotes and exports keep the old text until a page reload.
// Both copies come from the same file, so group/item indices match.
function plSyncQuoteItem(gi, ii, field, val) {
  const item = pricelist[gi]?.items[ii];
  if (!item) return;
  item[field] = val;
  const row = document.getElementById(`lic-${gi}-${ii}`);
  if (row && field === "desc_short") row.querySelector("td.desc").textContent = val;
  if (row && field === "code")       row.querySelector("td.code").textContent = val;
}

function plSyncQuoteGroup(gi, field, val) {
  if (pricelist[gi]) pricelist[gi][field] = val;
}

async function plSaveDesc(gi, ii, val) {
  val = val.trim();
  if (!val || val === plData[gi]?.items[ii]?.desc_short) return;
  await fetch("/api/pricelist/item", {
    method: "PUT", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ group_idx: gi, item_idx: ii, desc_short: val }),
  });
  if (plData[gi]?.items[ii]) plData[gi].items[ii].desc_short = val;
  plSyncQuoteItem(gi, ii, "desc_short", val);
}

async function plSaveCode(gi, ii, val) {
  val = val.trim();
  if (!val || val === plData[gi]?.items[ii]?.code) return;
  await fetch("/api/pricelist/item", {
    method: "PUT", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ group_idx: gi, item_idx: ii, code: val }),
  });
  if (plData[gi]?.items[ii]) plData[gi].items[ii].code = val;
  plSyncQuoteItem(gi, ii, "code", val);
}

async function plSaveGroupName(gi, val) {
  val = val.trim();
  if (!val || val === plData[gi]?.name) return;
  await fetch(`/api/pricelist/group/${gi}`, {
    method: "PUT", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name: val }),
  });
  if (plData[gi]) plData[gi].name = val;
  plSyncQuoteGroup(gi, "name", val);
  plRenderGroups();
}

async function plSaveGroupAbbrev(gi, val) {
  val = val.trim().toUpperCase();
  if (!val || val === plData[gi]?.abbrev) return;
  await fetch(`/api/pricelist/group/${gi}`, {
    method: "PUT", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ abbrev: val }),
  });
  if (plData[gi]) plData[gi].abbrev = val;
  plSyncQuoteGroup(gi, "abbrev", val);
  plRenderGroups();
}

async function plSaveGroupDesc(gi, val) {
  if (gi === null || gi === undefined) return;
  val = val.trim();
  if (val === (plData[gi]?.description || "")) return;
  await fetch(`/api/pricelist/group/${gi}`, {
    method: "PUT", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ description: val }),
  });
  if (plData[gi]) plData[gi].description = val;
  plSyncQuoteGroup(gi, "description", val);
}

async function plSaveGroupSectionLabel(gi, val) {
  if (gi === null || gi === undefined) return;
  val = val.trim();
  if (val === (plData[gi]?.section_label || "")) return;
  await fetch(`/api/pricelist/group/${gi}`, {
    method: "PUT", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ section_label: val }),
  });
  if (plData[gi]) plData[gi].section_label = val;
  plSyncQuoteGroup(gi, "section_label", val);
}

async function plUploadLogo(event, gi) {
  if (gi === null || gi === undefined) return;
  const file = event.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  const r = await fetch(`/api/pricelist/group/${gi}/logo`, { method: "POST", body: formData });
  const d = await r.json();
  if (d.ok) {
    if (plData[gi]) plData[gi].logo = d.filename;
    plRefreshLogoPreview(gi);
  }
}

async function plDeleteLogo(gi) {
  if (gi === null || gi === undefined) return;
  await fetch(`/api/pricelist/group/${gi}/logo`, { method: "DELETE" });
  if (plData[gi]) plData[gi].logo = "";
  plRefreshLogoPreview(gi);
}

function plRefreshLogoPreview(gi) {
  const grp = plData[gi];
  const img  = document.getElementById("pl-logo-img");
  const ph   = document.getElementById("pl-logo-placeholder");
  const delBtn = document.getElementById("pl-logo-del-btn");
  if (!img) return;
  if (grp?.logo) {
    img.src = `/api/assets/${grp.logo}?t=${Date.now()}`;
    img.style.display = "block";
    if (ph) ph.style.display = "none";
    if (delBtn) delBtn.style.display = "";
  } else {
    img.style.display = "none";
    img.src = "";
    if (ph) ph.style.display = "";
    if (delBtn) delBtn.style.display = "none";
  }
}

async function plSavePrice(gi, ii, val) {
  const price = val === "" ? null : parseFloat(val);
  if (price === plData[gi]?.items[ii]?.price) return;
  await fetch("/api/pricelist/item", {
    method: "PUT",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ group_idx: gi, item_idx: ii, price }),
  });
  if (plData[gi]?.items[ii]) plData[gi].items[ii].price = price;
  plSyncQuoteItem(gi, ii, "price", price);
  // Refresh license sections if open
  if (activeProducts.size) { renderLicSections(); qtCalc(); }
}

async function plDeleteGroup(gi) {
  const grp = plData[gi];
  if (!confirm(`Delete group "${grp?.name}" and all ${grp?.items?.length} items? This cannot be undone.`)) return;
  const r = await fetch(`/api/pricelist/group/${gi}`, { method: "DELETE" });
  const d = await r.json();
  if (d.ok) {
    plData.splice(gi, 1);
    if (plActiveGroup === gi) plActiveGroup = null;
    else if (plActiveGroup > gi) plActiveGroup--;
    plRenderGroups();
    plRenderItems();
  }
}

async function plDeleteItem(gi, ii) {
  const item = plData[gi]?.items[ii];
  if (!confirm(`Delete "${item?.code} — ${item?.desc_short}"? This cannot be undone.`)) return;
  const r = await fetch(`/api/pricelist/item/${gi}/${ii}`, { method: "DELETE" });
  const d = await r.json();
  if (d.ok) {
    plData[gi].items.splice(ii, 1);
    plRenderGroups();
    plRenderItems();
  }
}

async function plToggleDepr(gi, ii) {
  const r = await fetch("/api/pricelist/item/deprecate", {
    method: "PUT",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ group_idx: gi, item_idx: ii }),
  });
  const d = await r.json();
  if (plData[gi]?.items[ii]) plData[gi].items[ii].deprecated = d.deprecated;
  plRenderGroups();
  plRenderItems();
}

async function plUpload() {
  const file = document.getElementById("pl-upload-file")?.files[0];
  if (!file) return;
  const status = document.getElementById("pl-upload-status");
  const statsEl = document.getElementById("pl-stats");
  if (status) { status.textContent = "Uploading…"; status.style.color = "var(--muted)"; }

  const fd = new FormData();
  fd.append("file", file);
  try {
    const r = await fetch("/api/pricelist/upload", { method: "POST", body: fd });
    const d = await r.json();
    if (d.ok) {
      status.textContent = `✓ ${d.groups} groups, ${d.items} items`;
      status.style.color = "var(--success)";
      // Show merge stats
      if (d.stats && statsEl) {
        const s = d.stats;
        statsEl.innerHTML =
          `<strong>Upload result:</strong> ` +
          `<span class="pl-stat-badge updated">↻ ${s.updated} updated</span>` +
          `<span class="pl-stat-badge added">+ ${s.added} new</span>` +
          (s.deprecated ? `<span class="pl-stat-badge deprecated">⚠ ${s.deprecated} deprecated</span>` : "") +
          (s.groups_added ? `<span class="pl-stat-badge added">+ ${s.groups_added} new groups</span>` : "");
        statsEl.classList.add("visible");
      }
      // Reload
      await plLoad();
      // Also refresh quotation pricelist
      await loadPricelist();
      renderLicSections();
    } else {
      status.textContent = "Error: " + (d.error || "upload failed");
      status.style.color = "var(--danger)";
    }
  } catch(e) {
    status.textContent = "Error: " + e.message;
    status.style.color = "var(--danger)";
  }
  // Reset file input
  document.getElementById("pl-upload-file").value = "";
}

/* ══════════════════════════════
   IMPORT FROM CONFIGURATOR
══════════════════════════════ */

function importFromConfigurator() {
  const servers = getServerConfigTable();
  if (!servers.length) {
    alert("No servers configured. Add servers in the Configurator tab first.");
    return;
  }

  // Ask user whether to append or replace
  const existing = document.querySelectorAll("#hw-tbody tr[id]").length;
  if (existing > 0) {
    if (!confirm(`Replace existing ${existing} hardware row(s) with ${servers.length} server(s) from Configurator?`)) return;
    document.querySelectorAll("#hw-tbody tr[id]").forEach(el => el.remove());
    hwRowCount = 0;
  }

  servers.forEach(srv => {
    const compMap = {};
    srv.components.forEach(c => { compMap[c.category] = c.value; });

    // Build detail line: prioritised components comma-separated
    const EXCLUDE  = new Set(["Motherboard", "Case", "PSU", "CPU Cooler"]);
    const PRIORITY = [
      "CPU", "RAM", "OS SSD",
      "RAID Controller", "RAID Disks", "Network", "GPU",
      "PCI Card 1", "PCI Card 2", "Seldom Used", "OS",
    ];
    const parts = [];
    PRIORITY.forEach(cat => {
      if (compMap[cat]) { parts.push(compMap[cat]); delete compMap[cat]; }
    });
    // Any remaining not in EXCLUDE
    Object.entries(compMap).forEach(([cat, v]) => {
      if (!EXCLUDE.has(cat)) parts.push(v);
    });

    const qty    = srv.qty || 1;
    const detail = parts.join(", ");

    addHwRow("5427-3U-SL", "3U Stream Labs branded server", qty, 0, 60);

    const idx = hwRowCount - 1;

    // Set detail textarea
    const detailEl = document.getElementById(`hw-detail-${idx}`);
    if (detailEl) detailEl.value = detail;
  });

  qtCalc();

  // Switch to Quotation tab if not already there
  document.querySelector('[data-tab="quote"]')?.click();

  // Flash the hardware section
  const tbody = document.getElementById("hw-tbody");
  if (tbody) {
    tbody.style.outline = "2px solid var(--accent)";
    setTimeout(() => { tbody.style.outline = ""; }, 1500);
  }
}

/* ══════════════════════════════
   COMPANIES
══════════════════════════════ */

let companiesList = [];
let newLogoFilename = "";

document.addEventListener("DOMContentLoaded", () => {
  document.querySelector('[data-tab="quote"]')?.addEventListener("click", () => {
    if (!companiesList.length) loadCompanies();
  });
  document.getElementById("companies-modal")?.addEventListener("click", e => {
    if (e.target === document.getElementById("companies-modal")) hideCompaniesEditor();
  });
});

async function loadCompanies() {
  try {
    const r = await fetch("/api/companies");
    companiesList = await r.json();
    renderCompaniesSelect();
  } catch(e) { console.error("Companies load failed", e); }
}

function renderCompaniesSelect() {
  const sel = document.getElementById("qt-company-sel");
  if (!sel) return;
  sel.innerHTML = companiesList.map((co, i) =>
    `<option value="${i}" ${co.active ? "selected" : ""}>${esc(co.name)}</option>`
  ).join("");
}

async function switchCompany(idx) {
  await fetch(`/api/companies/${idx}/activate`, { method: "POST" });
  companiesList.forEach((c, i) => c.active = (i == idx));
}

function showCompaniesEditor() {
  renderCompaniesModal();
  document.getElementById("companies-modal").style.display = "flex";
}
function hideCompaniesEditor() {
  document.getElementById("companies-modal").style.display = "none";
}

function renderCompaniesModal() {
  const el = document.getElementById("companies-list");
  if (!el) return;
  if (!companiesList.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted)">No companies yet.</div>';
    return;
  }
  el.innerHTML = companiesList.map((co, i) => `
    <div style="border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        ${co.logo ? `<img src="/api/assets/${co.logo}" style="height:32px;max-width:100px;object-fit:contain">` : '<span style="font-size:11px;color:var(--muted)">No logo</span>'}
        <label class="btn" style="cursor:pointer;height:24px;font-size:11px;margin-left:auto">
          <i class="ti ti-upload"></i> Logo
          <input type="file" accept="image/*" style="display:none" onchange="uploadLogoForExisting(${i}, this)">
        </label>
        <button class="btn ${co.active ? 'primary' : ''}" style="height:24px;font-size:11px"
          onclick="activateCompany(${i})">${co.active ? '✓ Active' : 'Set active'}</button>
        <button class="btn danger" style="height:24px;padding:0 7px;border:none" onclick="deleteCompany(${i})">
          <i class="ti ti-trash" style="font-size:13px"></i></button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <input type="text" value="${escAttr(co.name)}" placeholder="Name"
          style="height:26px;font-size:12px" onchange="saveCompanyField(${i},'name',this.value)">
        <input type="text" value="${escAttr(co.address)}" placeholder="Address"
          style="height:26px;font-size:12px" onchange="saveCompanyField(${i},'address',this.value)">
        <input type="text" value="${escAttr(co.vat||'')}" placeholder="VAT ID"
          style="height:26px;font-size:12px" onchange="saveCompanyField(${i},'vat',this.value)">
        <input type="text" value="${escAttr(co.email||'')}" placeholder="Email"
          style="height:26px;font-size:12px" onchange="saveCompanyField(${i},'email',this.value)">
      </div>
    </div>`).join("");
}

async function saveCompanyField(idx, key, val) {
  await fetch(`/api/companies/${idx}`, {
    method: "PUT", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({[key]: val}),
  });
  if (companiesList[idx]) companiesList[idx][key] = val;
  renderCompaniesSelect();
}

async function activateCompany(idx) {
  await fetch(`/api/companies/${idx}/activate`, { method: "POST" });
  companiesList.forEach((c, i) => c.active = (i == idx));
  renderCompaniesModal();
  renderCompaniesSelect();
}

async function deleteCompany(idx) {
  if (!confirm(`Delete "${companiesList[idx]?.name}"?`)) return;
  await fetch(`/api/companies/${idx}`, { method: "DELETE" });
  companiesList.splice(idx, 1);
  if (companiesList.length && !companiesList.some(c => c.active)) companiesList[0].active = true;
  renderCompaniesModal();
  renderCompaniesSelect();
}

async function uploadLogoForExisting(idx, input) {
  const file = input.files[0]; if (!file) return;
  const fd = new FormData(); fd.append("file", file);
  const r = await fetch("/api/companies/logo", { method: "POST", body: fd });
  const d = await r.json();
  if (d.ok) {
    await saveCompanyField(idx, "logo", d.filename);
    if (companiesList[idx]) companiesList[idx].logo = d.filename;
    renderCompaniesModal();
  }
}

async function uploadLogoForNew(input) {
  const file = input.files[0]; if (!file) return;
  const fd = new FormData(); fd.append("file", file);
  const r = await fetch("/api/companies/logo", { method: "POST", body: fd });
  const d = await r.json();
  if (d.ok) {
    newLogoFilename = d.filename;
    const el = document.getElementById("nc-logo-name");
    if (el) el.textContent = d.filename;
  }
}

async function addCompany() {
  const name = document.getElementById("nc-name")?.value.trim();
  if (!name) { alert("Name is required"); return; }
  const body = {
    name, logo: newLogoFilename,
    address: document.getElementById("nc-address")?.value.trim() || "",
    vat:     document.getElementById("nc-vat")?.value.trim()     || "",
    email:   document.getElementById("nc-email")?.value.trim()   || "",
  };
  const r = await fetch("/api/companies", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (d.ok) {
    await loadCompanies();
    // Clear inputs
    ["nc-name","nc-address","nc-vat","nc-email"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
    newLogoFilename = "";
    const nn = document.getElementById("nc-logo-name"); if (nn) nn.textContent = "No logo";
    renderCompaniesModal();
  }
}

/* ══════════════════════════════
   LIVE EXCHANGE RATE (ECB via Frankfurter)
══════════════════════════════ */

async function fetchExchangeRate() {
  const btn    = document.getElementById("btn-fetch-rate");
  const status = document.getElementById("rate-fetch-status");
  const inp    = document.getElementById("qt-usd-rate");
  if (!inp) return;

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite;font-size:13px"></i>'; }
  if (status) { status.textContent = "Fetching…"; status.style.color = "var(--muted)"; }

  try {
    const r = await fetch("/api/exchange-rate");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || "Server error");
    const rate = data.rate;

    inp.value = rate.toFixed(4);
    qtCalc();

    if (status) {
      status.textContent = `✓ ${rate.toFixed(4)} · ${data.date}`;
      status.style.color = "var(--success)";
      setTimeout(() => { if (status) status.textContent = data.date; }, 3000);
    }
  } catch(e) {
    if (status) {
      status.textContent = "⚠ " + e.message;
      status.style.color = "var(--warning)";
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-refresh" style="font-size:13px"></i>'; }
  }
}

// Auto-fetch exchange rate on page load
let _rateFetched = false;
document.addEventListener("DOMContentLoaded", () => {
  // Fetch rate immediately on load
  setTimeout(() => {
    if (!_rateFetched) {
      _rateFetched = true;
      fetchExchangeRate();
    }
  }, 500); // small delay to ensure DOM is ready

  document.querySelector('[data-tab="quote"]')?.addEventListener("click", () => {
    if (!_rateFetched) {
      _rateFetched = true;
      fetchExchangeRate();
    }
  });
});

/* ── Version dropdown ── */
function toggleVersionDrop() {
  const d = document.getElementById("version-drop");
  if (!d) return;
  d.style.display = d.style.display === "none" ? "block" : "none";
}
function pickVersion(v) {
  const inp = document.getElementById("qt-version");
  if (inp) { inp.value = v; qtUpdate(); }
  closeVersionDrop();
}
function closeVersionDrop() {
  const d = document.getElementById("version-drop");
  if (d) d.style.display = "none";
}
document.addEventListener("click", e => {
  if (!e.target.closest('[id="version-drop"]') &&
      !e.target.closest('[onclick*="toggleVersionDrop"]') &&
      !e.target.closest('#qt-version')) {
    closeVersionDrop();
  }
});

/* ══════════════════════════════
   SELDOM USED — MULTI-ROW
══════════════════════════════ */

function addSeldomRow(srvId, catId) {
  const cat       = getCatById(catId);
  if (!cat) return;
  const container = document.getElementById(`${srvId}-${catId}-rows`);
  if (!container) return;

  const rowIdx = container.children.length;
  const rowId  = `${srvId}-${catId}-${rowIdx}`;

  const opts = cat.items.map(o => {
    const val = typeof o === "object" ? o.name : o;
    return `<option>${esc(val)}</option>`;
  }).join("");

  const div = document.createElement("div");
  div.id = rowId;
  div.style.cssText = "display:flex;align-items:center;gap:4px;margin-bottom:4px";
  div.innerHTML = `
    <select class="comp-sel" id="${rowId}-sel" style="flex:1"
      onchange="calcTdp('${srvId}')">
      <option value="">— none —</option>
      ${opts}
    </select>
    <button class="cqbtn" data-selid="${rowId}-sel" data-dir="-1">−</button>
    <span class="cqv" id="${rowId}-sel-qty">1</span>
    <button class="cqbtn" data-selid="${rowId}-sel" data-dir="1">+</button>
    <button class="btn danger" style="height:24px;padding:0 6px;border:none;flex-shrink:0"
      onclick="removeSeldomRow('${rowId}','${srvId}')">
      <i class="ti ti-x" style="font-size:11px"></i>
    </button>`;
  container.appendChild(div);
}

function removeSeldomRow(rowId, srvId) {
  document.getElementById(rowId)?.remove();
  calcTdp(srvId);
}

// Read all seldom_used rows for buildTable / getServerConfigTable
function getSeldomComponents(srvId) {
  const cat       = getCatById("seldom_used");
  if (!cat) return [];
  const container = document.getElementById(`${srvId}-seldom_used-rows`);
  if (!container) return [];
  const result = [];
  for (const row of container.children) {
    const sel = row.querySelector("select");
    const qty = row.querySelector(".cqv");
    if (sel?.value) {
      result.push({
        value: sel.value + (qty ? ` ×${qty.textContent}` : ""),
        name:  sel.value,
        qty:   parseInt(qty?.textContent) || 1,
      });
    }
  }
  return result;
}

/* ══════════════════════════════
   PCIe SLOT VALIDATION
══════════════════════════════ */

function validatePcie(srvId) {
  // Get motherboard slots
  const mbSel = document.getElementById(`${srvId}-motherboard`);
  const mbCat = getCatById("motherboard");
  const mbItem = mbCat?.items.find(it => (typeof it === "object" ? it.name : it) === mbSel?.value);
  const mbEl  = mbSel?.closest(".comp-cell");

  // Available PCIe slots (0 if no MB selected)
  const avail = {
    x16: (mbItem && typeof mbItem === "object") ? (mbItem.pcie_x16 || 0) : 0,
    x8:  (mbItem && typeof mbItem === "object") ? (mbItem.pcie_x8  || 0) : 0,
    x4:  (mbItem && typeof mbItem === "object") ? (mbItem.pcie_x4  || 0) : 0,
  };

  // Collect required slots from GPU and PCI cards (with qty)
  const required = { x16: 0, x8: 0, x4: 0 };
  const pcieCats = ["gpu", "pci_card_1", "pci_card_2"];
  for (const catId of pcieCats) {
    const cat = getCatById(catId); if (!cat) continue;
    const sel = document.getElementById(`${srvId}-${catId}`);
    if (!sel?.value) continue;
    const item = cat.items.find(it => (typeof it === "object" ? it.name : it) === sel.value);
    const slot = (typeof item === "object" ? item.pcie_slot : null) || "x8";
    const qty  = WITH_QTY.has(catId)
      ? (parseInt(document.getElementById(`${srvId}-${catId}-qty`)?.textContent) || 1)
      : 1;
    if (required[slot] !== undefined) required[slot] += qty;
  }

  // Check fit: x16 cards → x16 slots only
  //            x8 cards → x8 or x16 slots
  //            x4 cards → x4, x8, or x16 slots
  const remaining = { ...avail };
  const issues = [];

  // CPU socket count vs motherboard
  const cpuQty = parseInt(document.getElementById(`${srvId}-cpu-qty`)?.textContent) || 1;
  const cpuSel = document.getElementById(`${srvId}-cpu`);
  if (cpuSel?.value) {
    const maxSockets = (mbItem && typeof mbItem === "object") ? (mbItem.cpu_sockets || 1) : 1;
    if (cpuQty > maxSockets) {
      issues.push(`${cpuQty}× CPU needed, motherboard has ${maxSockets} socket${maxSockets>1?"s":""}`);
    }
  }

  // RAM module count vs motherboard slots
  const ramQty = parseInt(document.getElementById(`${srvId}-ram-qty`)?.textContent) || 1;
  const ramSel = document.getElementById(`${srvId}-ram`);
  if (ramSel?.value) {
    const maxRamSlots = (mbItem && typeof mbItem === "object") ? (mbItem.ram_slots || 0) : 0;
    if (maxRamSlots > 0 && ramQty > maxRamSlots) {
      issues.push(`${ramQty}× RAM modules needed, motherboard has ${maxRamSlots} slots`);
    }
  }

  // x16 cards first (strictest)
  if (required.x16 > remaining.x16) {
    issues.push(`${required.x16}× PCIe x16 needed, only ${remaining.x16} available`);
  }
  remaining.x16 = Math.max(0, remaining.x16 - required.x16);

  // x8 cards: use x8 slots, then x16 overflow
  const x8_avail = remaining.x8 + remaining.x16;
  if (required.x8 > x8_avail) {
    issues.push(`${required.x8}× PCIe x8 needed, only ${x8_avail} available (x8+x16)`);
  }
  let x8_used_x16 = Math.max(0, required.x8 - remaining.x8);
  remaining.x8  = Math.max(0, remaining.x8  - required.x8);
  remaining.x16 = Math.max(0, remaining.x16 - x8_used_x16);

  // x4 cards: use x4, then x8, then x16
  const x4_avail = remaining.x4 + remaining.x8 + remaining.x16;
  if (required.x4 > x4_avail) {
    issues.push(`${required.x4}× PCIe x4 needed, only ${x4_avail} available (x4+x8+x16)`);
  }

  // Drive slot check (case hdd_slots vs RAID disks + OS SSD)
  const caseSel2  = document.getElementById(`${srvId}-case`);
  const caseCat2  = getCatById("case");
  const caseItem2 = caseCat2?.items.find(it => (typeof it === "object" ? it.name : it) === caseSel2?.value);
  const caseDrv   = (typeof caseItem2 === "object" ? caseItem2.hdd_slots : 0) || 0;
  const caseExp   = (typeof caseItem2 === "object" ? caseItem2.expansion_slots : 0) || 0;

  if (caseDrv > 0) {
    let totalDrives = 0;
    const drvDetail = [];
    const rdSel = document.getElementById(`${srvId}-raid_disks`);
    const rdQty = parseInt(document.getElementById(`${srvId}-raid_disks-qty`)?.textContent) || 0;
    if (rdSel?.value && rdQty > 0) { totalDrives += rdQty; drvDetail.push(`RAID: ${rdQty}`); }
    const osSel = document.getElementById(`${srvId}-os_ssd`);
    const osQty = parseInt(document.getElementById(`${srvId}-os_ssd-qty`)?.textContent) || 0;
    if (osSel?.value && osQty > 0) { totalDrives += osQty; drvDetail.push(`OS SSD: ${osQty}`); }
    if (totalDrives > caseDrv) {
      issues.push(`Drive slots: need ${totalDrives} (${drvDetail.join(", ")}), case has ${caseDrv}`);
    }
  }

  if (caseExp > 0) {
    const PHYS_CATS = ["gpu","network","raid_controller","pci_card_1","pci_card_2"];
    let totalPhys = 0; const physDet = [];
    for (const catId of PHYS_CATS) {
      const s = document.getElementById(`${srvId}-${catId}`); if (!s?.value) continue;
      const c2 = getCatById(catId);
      const it2 = c2?.items.find(it => (typeof it === "object" ? it.name : it) === s.value);
      const su = (typeof it2 === "object" ? it2.slots_used : 1) || 1;
      const q  = parseInt(document.getElementById(`${srvId}-${catId}-qty`)?.textContent) || 1;
      totalPhys += su * q; physDet.push(`${c2?.name}: ${q}×${su}`);
    }
    if (totalPhys > caseExp) issues.push(`Physical slots: need ${totalPhys} (${physDet.join(", ")}), case has ${caseExp}`);
  }

  // Show/hide warning
  _clearPcieWarning(srvId);
  // Header badge
  const hdrWarn = document.getElementById(`${srvId}-pcie-warn`);

  if (issues.length) {
    // Inline grid warning
    let warn = document.getElementById(`${srvId}-slot-warn`);
    if (!warn) {
      warn = document.createElement("div");
      warn.id = `${srvId}-slot-warn`;
      warn.style.cssText = "grid-column:1/-1;padding:6px 10px;margin:4px 0;border-radius:6px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);font-size:11px;color:var(--danger)";
      const grid = document.querySelector(`#${srvId} .comp-grid`);
      if (grid) grid.appendChild(warn);
    }
    warn.innerHTML = `<i class="ti ti-alert-triangle" style="margin-right:4px"></i><strong>Slot conflict:</strong> ${issues.join(" · ")}`;
    if (mbEl) mbEl.style.outline = issues.some(i=>i.includes("PCIe")||i.includes("socket")||i.includes("RAM slots")) ? "2px solid var(--danger)" : "";
    // Show header indicator
    if (hdrWarn) { hdrWarn.style.display = "flex"; hdrWarn.title = issues.join("\n"); }
  } else {
    document.getElementById(`${srvId}-slot-warn`)?.remove();
    if (mbEl) mbEl.style.outline = "";
    if (hdrWarn) hdrWarn.style.display = "none";
  }
}

function _clearPcieWarning(srvId) {
  document.getElementById(`${srvId}-slot-warn`)?.remove();
  const mbEl = document.getElementById(`${srvId}-motherboard`)?.closest(".comp-cell");
  if (mbEl) mbEl.style.outline = "";
  const hdrWarn = document.getElementById(`${srvId}-pcie-warn`);
  if (hdrWarn) hdrWarn.style.display = "none";
}

/* ══════════════════════════════
   USERS (Jira author/assignee + quotation DB attribution)
══════════════════════════════ */
let usersList = [];

function getCurrentUser() {
  return localStorage.getItem("qt_current_user") || "";
}

function setCurrentUser(login) {
  localStorage.setItem("qt_current_user", login || "");
  if (document.getElementById("pane-saved")?.classList.contains("active")) loadSavedList();
}

async function loadUsers() {
  usersList = await (await fetch("/api/users")).json();
  renderCurrentUserSelect();
  renderJiraAssigneeSelect();
  renderUsersModalList();
}

function renderCurrentUserSelect() {
  const sel = document.getElementById("current-user-sel");
  if (!sel) return;
  const cur = getCurrentUser();
  sel.innerHTML = '<option value="">— no user —</option>' +
    usersList.map(u => `<option value="${esc(u.login)}">${esc(u.name)}</option>`).join("");
  sel.value = usersList.some(u => u.login === cur) ? cur : "";
}

function openUsersModal() {
  renderUsersModalList();
  renderAssigneesModalList();
  document.getElementById("users-modal").style.display = "flex";
}

function switchUsersModalTab(tab) {
  const isUsers = tab === "users";
  document.getElementById("users-modal-panel-users").style.display     = isUsers ? "" : "none";
  document.getElementById("users-modal-panel-assignees").style.display = isUsers ? "none" : "";
  document.getElementById("users-modal-tab-users").style.borderBottomColor     = isUsers ? "var(--accent)" : "transparent";
  document.getElementById("users-modal-tab-assignees").style.borderBottomColor = isUsers ? "transparent" : "var(--accent)";
}

function closeUsersModal() {
  document.getElementById("users-modal").style.display = "none";
}

function renderUsersModalList() {
  const list = document.getElementById("users-list");
  if (!list) return;
  if (!usersList.length) {
    list.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:8px 0">No users yet — add one below.</div>`;
    return;
  }
  list.innerHTML = usersList.map((u, i) => `
    <div style="display:flex;align-items:center;gap:8px;background:var(--bg3);border-radius:var(--radius);padding:8px 10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--text)">${esc(u.name)} <span style="color:var(--muted);font-weight:400">(${esc(u.login)})</span></div>
        <div style="font-size:11px;color:var(--muted)">${esc(u.email || "no email")} ${u.has_token ? '· <span style="color:var(--success)">Jira PAT set</span>' : '· <span style="color:var(--muted)">no personal PAT (uses shared token)</span>'}</div>
      </div>
      <button class="qbtn" title="Remove" onclick="deleteUser(${i})"><i class="ti ti-trash"></i></button>
    </div>
  `).join("");
}

async function addUser() {
  const name  = document.getElementById("user-new-name")?.value?.trim();
  const login = document.getElementById("user-new-login")?.value?.trim();
  const email = document.getElementById("user-new-email")?.value?.trim();
  const token = document.getElementById("user-new-token")?.value?.trim();
  if (!name || !login) { alert("Name and login are required."); return; }

  const r = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, login, email, jira_token: token }),
  });
  const d = await r.json();
  if (!d.ok) { alert(d.error || "Failed to add user"); return; }

  document.getElementById("user-new-name").value  = "";
  document.getElementById("user-new-login").value = "";
  document.getElementById("user-new-email").value = "";
  document.getElementById("user-new-token").value = "";
  await loadUsers();
}

async function deleteUser(idx) {
  const u = usersList[idx];
  if (!confirm(`Remove user "${u.name}"?`)) return;
  await fetch(`/api/users/${idx}`, { method: "DELETE" });
  await loadUsers();
}

/* ── Jira Assignees (separate, editable list) ── */
let assigneesList = [];

async function loadAssignees() {
  assigneesList = await (await fetch("/api/jira/assignees")).json();
  renderJiraAssigneeSelect();
  renderAssigneesModalList();
}

function renderJiraAssigneeSelect() {
  const sel = document.getElementById("jira-assignee");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— unassigned —</option>' +
    assigneesList.map(a => `<option value="${esc(a.login)}">${esc(a.name)} (${esc(a.login)})</option>`).join("");
  sel.value = assigneesList.some(a => a.login === cur) ? cur : "";
}

function renderAssigneesModalList() {
  const list = document.getElementById("assignees-list");
  if (!list) return;
  if (!assigneesList.length) {
    list.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:8px 0">No assignees yet — add one below.</div>`;
    return;
  }
  list.innerHTML = assigneesList.map((a, i) => `
    <div style="display:flex;align-items:center;gap:8px;background:var(--bg3);border-radius:var(--radius);padding:8px 10px">
      <div style="flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--text)">${esc(a.name)} <span style="color:var(--muted);font-weight:400">(${esc(a.login)})</span></div>
      <button class="qbtn" title="Remove" onclick="deleteAssignee(${i})"><i class="ti ti-trash"></i></button>
    </div>
  `).join("");
}

async function addAssignee() {
  const login = document.getElementById("assignee-new-login")?.value?.trim();
  const name  = document.getElementById("assignee-new-name")?.value?.trim();
  if (!login) { alert("Jira login is required."); return; }

  const r = await fetch("/api/jira/assignees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, login }),
  });
  const d = await r.json();
  if (!d.ok) { alert(d.error || "Failed to add assignee"); return; }

  document.getElementById("assignee-new-name").value  = "";
  document.getElementById("assignee-new-login").value = "";
  await loadAssignees();
}

async function deleteAssignee(idx) {
  const a = assigneesList[idx];
  if (!confirm(`Remove assignee "${a.name}"?`)) return;
  await fetch(`/api/jira/assignees/${idx}`, { method: "DELETE" });
  await loadAssignees();
}

/* ══════════════════════════════
   PIPEDRIVE INTEGRATION
══════════════════════════════ */

async function fetchFromPipedrive() {
  const dealId = document.getElementById("qt-deal-id")?.value?.trim();
  if (!dealId) { alert("Enter a Deal ID first."); return; }

  const btn    = document.getElementById("btn-pipedrive-fetch");
  const status = document.getElementById("pipedrive-status");

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Fetching…';
  if (status) { status.textContent = ""; status.style.color = "var(--muted)"; }

  try {
    const r = await fetch(`/api/pipedrive/deal/${encodeURIComponent(dealId)}`);
    const d = await r.json();

    if (!d.ok) {
      if (status) { status.textContent = "✗ " + d.error; status.style.color = "var(--danger)"; }
      return;
    }

    // Populate client fields
    const fields = {
      "qt-company": d.company,
      "qt-contact": toTitleCaseName(d.contact), // Pipedrive names are sometimes ALL CAPS
      "qt-address": d.address,
      "qt-country": d.country,
      "qt-phone":   d.phone,
      "qt-email":   d.email,
    };
    for (const [id, val] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el && val) el.value = val;
    }
    qtUpdate();

    if (status) {
      const filled = Object.values(fields).filter(v => v).length;
      status.textContent = `✓ ${filled} fields filled`;
      status.style.color = "var(--success)";
      setTimeout(() => { if (status) status.textContent = ""; }, 4000);
    }
  } catch (e) {
    if (status) { status.textContent = "✗ Network error"; status.style.color = "var(--danger)"; }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-brand-pipedrive"></i> Fetch';
  }
}

async function pipedriveUpdateDealValue() {
  const dealId = document.getElementById("qt-deal-id")?.value?.trim();
  if (!dealId) { alert("Enter a Deal ID first."); return; }

  const btn    = document.getElementById("btn-pipedrive-update-value");
  const status = document.getElementById("pipedrive-update-status");
  const value  = qtEffectiveTotalUsd();

  if (!confirm(`Set Pipedrive deal #${dealId} value to $ ${Math.round(value).toLocaleString("de-DE")}?`)) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Updating…';
  if (status) { status.textContent = ""; status.style.color = "var(--muted)"; }

  try {
    const r = await fetch(`/api/pipedrive/deal/${encodeURIComponent(dealId)}/value`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, currency: "USD" }),
    });
    const d = await r.json();

    if (!d.ok) {
      if (status) { status.textContent = "✗ " + d.error; status.style.color = "var(--danger)"; }
      return;
    }

    if (status) {
      status.textContent = `✓ Deal value set to $ ${Math.round(d.deal_value).toLocaleString("de-DE")}`;
      status.style.color = "var(--success)";
      setTimeout(() => { if (status) status.textContent = ""; }, 5000);
    }
  } catch (e) {
    if (status) { status.textContent = "✗ Network error"; status.style.color = "var(--danger)"; }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-brand-pipedrive"></i> Update Deal Value';
  }
}

async function pipedriveUploadFile() {
  const dealId = document.getElementById("qt-deal-id")?.value?.trim();
  if (!dealId) { alert("Enter a Deal ID first."); return; }

  const fileInput = document.getElementById("pd-upload-file");
  const file = fileInput?.files?.[0];
  if (!file) { alert("Choose a file to upload first."); return; }

  const btn    = document.getElementById("btn-pipedrive-upload-file");
  const status = document.getElementById("pipedrive-upload-status");

  if (!confirm(`Upload "${file.name}" to Pipedrive deal #${dealId}?`)) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Uploading…';
  if (status) { status.textContent = ""; status.style.color = "var(--muted)"; }

  try {
    const fd = new FormData();
    fd.append("file", file, file.name);
    const r = await fetch(`/api/pipedrive/deal/${encodeURIComponent(dealId)}/file`, {
      method: "POST",
      body: fd,
    });
    const d = await r.json();

    if (!d.ok) {
      if (status) { status.textContent = "✗ " + d.error; status.style.color = "var(--danger)"; }
      return;
    }

    if (status) {
      status.textContent = `✓ Uploaded: ${d.file_name}`;
      status.style.color = "var(--success)";
      setTimeout(() => { if (status) status.textContent = ""; }, 5000);
    }
  } catch (e) {
    if (status) { status.textContent = "✗ Network error"; status.style.color = "var(--danger)"; }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-cloud-upload"></i> Upload to Pipedrive';
  }
}

/* ══════════════════════════════
   JIRA TASK INTEGRATION
══════════════════════════════ */

let _jiraFetchedData = {};

function openJiraModal() {
  // Pre-fill deal ID from Quotation tab if available
  const qtDealId = document.getElementById("qt-deal-id")?.value?.trim();
  const jiraDealId = document.getElementById("jira-deal-id");
  if (qtDealId && jiraDealId && !jiraDealId.value) jiraDealId.value = qtDealId;

  jiraUpdatePreview();
  jiraRenderSrvPreview();
  renderJiraAssigneeSelect();

  const modal = document.getElementById("jira-modal");
  if (modal) modal.style.display = "flex";
}

function closeJiraModal() {
  const modal = document.getElementById("jira-modal");
  if (modal) modal.style.display = "none";
  const err = document.getElementById("jira-error");
  if (err) err.style.display = "none";
}

function jiraUpdatePreview() {
  const dealId      = document.getElementById("jira-deal-id")?.value?.trim() || "";
  const company     = _jiraFetchedData.company || "";
  const country     = _jiraFetchedData.country || "";
  const salesContact = _jiraFetchedData.sales_contact ||
                       document.getElementById("qt-sales-contact")?.value?.trim() || "";
  const lastName    = salesContact.trim().split(/\s+/).pop() || "";

  const title = dealId && company
    ? `Конфигурация сервера для "${company}" \\ PP${dealId} \\ ${country} \\ ${lastName}`
    : "Fill Deal ID and fetch Pipedrive data to preview title";

  const el = document.getElementById("jira-modal-title-preview");
  if (el) el.textContent = `Title: ${title}`;
}

async function jiraFetchPipedrive() {
  const dealId = document.getElementById("jira-deal-id")?.value?.trim();
  if (!dealId) { alert("Enter a Deal ID first."); return; }

  const status = document.getElementById("jira-fetch-status");
  if (status) { status.textContent = "Fetching…"; status.style.color = "var(--muted)"; }

  try {
    const r = await fetch(`/api/pipedrive/deal/${encodeURIComponent(dealId)}`);
    const d = await r.json();
    if (!d.ok) {
      if (status) { status.textContent = "✗ " + d.error; status.style.color = "var(--danger)"; }
      return;
    }
    _jiraFetchedData = d;

    // Show preview
    const preview = document.getElementById("jira-deal-preview");
    if (preview) {
      preview.style.display = "block";
      preview.innerHTML = [
        d.company  ? `<b>Company:</b> ${esc(d.company)}`  : "",
        d.contact  ? `<b>Contact:</b> ${esc(d.contact)}`  : "",
        d.country  ? `<b>Country:</b> ${esc(d.country)}`  : "",
        d.email    ? `<b>Email:</b> ${esc(d.email)}`       : "",
      ].filter(Boolean).join(" &nbsp;·&nbsp; ");
    }

    // Pull sales contact from Quotation tab if not in Pipedrive data
    if (!_jiraFetchedData.sales_contact) {
      _jiraFetchedData.sales_contact = document.getElementById("qt-sales-contact")?.value?.trim() || "";
    }

    jiraUpdatePreview();
    if (status) { status.textContent = "✓ Loaded"; status.style.color = "var(--success)"; }
  } catch (e) {
    if (status) { status.textContent = "✗ Error"; status.style.color = "var(--danger)"; }
  }
}

function jiraRenderSrvPreview() {
  const el = document.getElementById("jira-srv-preview");
  if (!el) return;
  const rows = getServerConfigTable();
  if (!rows.length) {
    el.textContent = "No servers configured. Add servers in Configurator first.";
    return;
  }
  el.innerHTML = rows.map(r =>
    `<div><b>${esc(r.name)}</b> ×${r.qty} — ${r.components.length} components</div>`
  ).join("");
}

async function submitJiraTask() {
  const dealId  = document.getElementById("jira-deal-id")?.value?.trim() || "";
  const context = document.getElementById("jira-context")?.value?.trim() || "";
  const btn     = document.getElementById("btn-jira-submit");
  const errEl   = document.getElementById("jira-error");

  if (!dealId) { alert("Enter a Pipedrive Deal ID."); return; }

  const specRows = getServerConfigTable().map(r => ({
    server:     r.name,
    qty:        r.qty,
    components: r.components,
  }));

  if (!specRows.length) { alert("No server configuration found. Configure servers first."); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Creating…';
  if (errEl) errEl.style.display = "none";

  try {
    const salesContact = _jiraFetchedData.sales_contact ||
                         document.getElementById("qt-sales-contact")?.value?.trim() || "";
    const assigneeName = document.getElementById("jira-assignee")?.value?.trim() || "";
    const r = await fetch("/api/jira/create-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deal_id:        dealId,
        company:        _jiraFetchedData.company  || "",
        country:        _jiraFetchedData.country  || "",
        sales_contact:  salesContact,
        context:        context,
        spec_rows:      specRows,
        assignee_name:  assigneeName,
        reporter_login: getCurrentUser(),
      }),
    });
    const d = await r.json();

    if (d.ok) {
      closeJiraModal();
      // Show success toast with link
      const t = document.getElementById("toast");
      if (t) {
        t.innerHTML = `✓ Jira task created: <a href="${d.url}" target="_blank" style="color:var(--accent)">${d.key}</a>`;
        t.style.display = "inline";
        setTimeout(() => { t.style.display = "none"; t.innerHTML = "Copied!"; }, 6000);
      }
    } else {
      if (errEl) { errEl.textContent = d.error; errEl.style.display = "block"; }
    }
  } catch (e) {
    if (errEl) { errEl.textContent = "Network error: " + e.message; errEl.style.display = "block"; }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send"></i> Create Task';
  }
}

/* ══════════════════════════════
   QUOTATION DATABASE
══════════════════════════════ */

function getServerConfigRaw() {
  const ordered = orderedCats(); const servers = [];
  srvIds.forEach(id => {
    const card = document.getElementById(id); if (!card) return;
    const srv = {id, name:card.querySelector(".srv-name")?.value||"",
      qty:parseInt(card.querySelector(".qty-v")?.textContent)||1, selects:{}, seldom:[]};
    for (const [,catId] of ordered) {
      if (catId==="seldom_used"){srv.seldom=getSeldomComponents(id).map(s=>({value:s.name,qty:s.qty}));continue;}
      const sel=document.getElementById(`${id}-${catId}`); if(!sel) continue;
      const qEl=document.getElementById(`${id}-${catId}-qty`);
      srv.selects[catId]={value:sel.value,qty:qEl?parseInt(qEl.textContent)||1:1};
      if(catId==="os"){const aS=document.getElementById(`${id}-${catId}-addon`);const aQ=document.getElementById(`${id}-${catId}-addon-qty`);
        srv.selects["os_addon"]={value:aS?.value||"",qty:aQ?parseInt(aQ.textContent)||1:1};}
    }
    servers.push(srv);
  });
  return servers;
}

async function saveQuotationToDB(overwrite=false, silent=false) {
  const data=qtGetData(); const dealId=data.deal_id?.trim(); const version=data.version?.trim()||"V1";
  if(!dealId){if(!silent)alert("Enter a Deal ID before saving.");return false;}
  const r=await fetch("/api/quotations/save",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({deal_id:dealId,version,overwrite,data,created_by:getCurrentUser()})});
  const d=await r.json();
  if(d.conflict){
    const vr=await fetch(`/api/quotations/${encodeURIComponent(dealId)}`);
    const versions=await vr.json();
    const existing=versions.map(v=>v.version).join(", ");
    const nums=versions.map(v=>parseInt((v.version||"V0").replace(/\D/g,""))).filter(n=>!isNaN(n));
    const nextVer=`V${nums.length?Math.max(...nums)+1:2}`;
    const choice=await showVersionDialog(dealId,version,existing,nextVer);
    if(!choice) return false;
    if(choice==="overwrite") return saveQuotationToDB(true,silent);
    const vi=document.getElementById("qt-version"); if(vi){vi.value=nextVer;qtUpdate();}
    return saveQuotationToDB(false,silent);
  }
  if(d.ok&&!silent){const t=document.getElementById("toast");if(t){
    t.textContent=d.created?`✓ Saved as ${version} (Deal ${dealId})`:`✓ Updated ${version} (Deal ${dealId})`;
    t.style.display="inline";setTimeout(()=>{t.style.display="none";t.textContent="Copied!";},3000);}}
  return d.ok;
}

function showVersionDialog(dealId,currentVersion,existingVersions,nextVersion){
  return new Promise(resolve=>{
    document.getElementById("ver-dialog")?.remove();
    const div=document.createElement("div"); div.id="ver-dialog";
    div.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;display:flex;align-items:center;justify-content:center";
    div.innerHTML=`<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;width:420px">
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px"><i class="ti ti-alert-triangle" style="color:var(--warning)"></i> Version already exists</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:16px">Deal <b>${esc(dealId)}</b> already has: <b>${esc(existingVersions)}</b>.<br>What to do with <b>${esc(currentVersion)}</b>?</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn ghost" id="vd-cancel">Cancel</button>
        <button class="btn ghost" id="vd-overwrite" style="color:var(--danger);border-color:var(--danger)">Overwrite ${esc(currentVersion)}</button>
        <button class="btn primary" id="vd-new">Save as ${esc(nextVersion)}</button>
      </div></div>`;
    document.body.appendChild(div);
    div.querySelector("#vd-cancel").onclick=()=>{div.remove();resolve(null);};
    div.querySelector("#vd-overwrite").onclick=()=>{div.remove();resolve("overwrite");};
    div.querySelector("#vd-new").onclick=()=>{div.remove();resolve("new");};
  });
}

let _savedSearchTimeout=null;
function savedSearch(){clearTimeout(_savedSearchTimeout);_savedSearchTimeout=setTimeout(loadSavedList,350);}

function _renderSavedUserFilterOptions(){
  const sel = document.getElementById("saved-user-filter");
  if (!sel) return;
  const cur = sel.value || "mine";
  const perUserOpts = usersList.map(u=>`<option value="${esc(u.login)}">${esc(u.name)}</option>`).join("");
  sel.innerHTML = `<option value="mine">My quotations</option><option value="all">All users</option>${perUserOpts}`;
  sel.value = [...sel.options].some(o=>o.value===cur) ? cur : "mine";
}

async function loadSavedList(){
  _renderSavedUserFilterOptions();
  const q=document.getElementById("saved-search")?.value?.trim()||"";
  const filterSel=document.getElementById("saved-user-filter")?.value||"mine";
  const userParam = filterSel==="mine" ? (getCurrentUser()||"all") : filterSel;
  const params=new URLSearchParams();
  if(q) params.set("search",q);
  params.set("user",userParam);
  const d=await(await fetch(`/api/quotations?${params}`)).json();
  const list=document.getElementById("saved-list"); if(!list) return;
  if(!d.items?.length){list.innerHTML=`<div style="color:var(--muted);padding:20px;text-align:center;font-size:13px">No saved quotations${q?` matching "${esc(q)}"`:""}</div>`;return;}
  const byDeal={};
  d.items.forEach(row=>{if(!byDeal[row.deal_id])byDeal[row.deal_id]=[];byDeal[row.deal_id].push(row);});
  list.innerHTML=Object.entries(byDeal).map(([dealId,rows])=>{
    const latest=rows[0];
    const verBadges=rows.map(r=>`<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:var(--bg3);color:var(--muted);margin-right:3px">${esc(r.version)}</span>`).join("");
    const authorName = usersList.find(u=>u.login===latest.created_by)?.name || latest.created_by || "";
    return `<div data-deal-id="${esc(dealId)}" style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;cursor:pointer;transition:border-color .15s"
      onclick="showSavedVersions('${esc(dealId)}')"
      onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${esc(latest.company||"—")}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Deal <b>PP${esc(dealId)}</b> · ${esc(latest.country||"")} · ${esc(latest.contact||"")}${authorName?` · by ${esc(authorName)}`:""}</div>
        </div>
        <div>${verBadges}</div>
        <div style="font-size:11px;color:var(--muted);white-space:nowrap">${esc(latest.updated_at?.slice(0,10)||"")}</div>
        <i class="ti ti-chevron-right" style="color:var(--muted)"></i>
      </div></div>`;
  }).join("");
}

async function showSavedVersions(dealId){
  const rows=await(await fetch(`/api/quotations/${encodeURIComponent(dealId)}`)).json();
  if(!rows.length) return;
  document.getElementById("saved-ver-title").textContent=rows[0].company||dealId;
  document.getElementById("saved-ver-sub").textContent=`PP${dealId} · ${rows.length} version(s)`;
  document.getElementById("saved-ver-tbody").innerHTML=rows.map(r=>`
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;font-weight:600;color:var(--text)">${esc(r.version)}</td>
      <td style="padding:8px 10px;color:var(--muted);font-size:11px">${esc(r.updated_at?.slice(0,16).replace("T"," ")||"")}</td>
      <td style="padding:8px 10px;color:var(--muted)">${esc(r.company||"")}</td>
      <td style="padding:8px 10px;text-align:right;white-space:nowrap">
        <button class="btn primary" onclick="loadQuotation('${esc(dealId)}','${esc(r.version)}')"
          style="height:26px;padding:0 10px;font-size:11px;margin-right:4px"><i class="ti ti-download"></i> Load</button>
        <button class="btn danger" onclick="deleteQuotation('${esc(dealId)}','${esc(r.version)}')"
          style="height:26px;padding:0 8px;font-size:11px"><i class="ti ti-trash"></i></button>
      </td></tr>`).join("");
  const panel = document.getElementById("saved-versions");
  const card  = document.querySelector(`#saved-list [data-deal-id="${dealId.replace(/"/g,'\\"')}"]`);
  if (card) card.insertAdjacentElement("afterend", panel); // move panel under the clicked card, not to the bottom of the list
  panel.style.display="block";
  panel.scrollIntoView({behavior:"smooth", block:"nearest"});
}

async function loadQuotation(dealId,version){
  if(!confirm(`Load ${version} of deal PP${dealId}? This will replace all current quotation data.`)) return;
  const r=await fetch(`/api/quotations/${encodeURIComponent(dealId)}/${encodeURIComponent(version)}`);
  const q=await r.json(); if(!q||q.error){alert("Failed to load quotation.");return;}
  const data=q.data;
  document.querySelector('[data-tab="quote"]').click();
  const setV=(id,v)=>{const el=document.getElementById(id);if(el&&v!==undefined)el.value=v;};
  setV("qt-company",data.company);setV("qt-contact",data.contact);setV("qt-address",data.address);
  setV("qt-country",data.country);setV("qt-phone",data.phone);setV("qt-email",data.email);
  setV("qt-deal-id",data.deal_id);setV("qt-summary",data.summary);setV("qt-signed-by",data.signed_by);
  setV("qt-sales-contact",data.sales_contact);setV("qt-sales-email",data.sales_email);
  setV("qt-sw-disc",data.sw_discount);setV("qt-usd-rate",data.usd_rate);setV("qt-valid-days",data.valid_days);
  const vi=document.getElementById("qt-version");if(vi)vi.value=data.version||version;
  const cur=document.getElementById("qt-currency");if(cur)cur.value=data.currency||"USD";
  const sb=document.getElementById("qt-show-both");if(sb)sb.checked=!!data.show_both;
  const sl=document.getElementById("qt-show-logos");if(sl)sl.checked=!!data.show_logos;

  document.querySelectorAll("#hw-tbody tr[id]").forEach(el=>el.remove());hwRowCount=0;
  (data.hardware||[]).forEach(hw=>{
    addHwRow(hw.pn||"",hw.desc||"",hw.qty||1,hw.list_price||0,hw.margin||0);
    const detail=document.getElementById(`hw-detail-${hwRowCount-1}`);if(detail)detail.value=hw.detail||"";
  });
  document.querySelectorAll("#svc-tbody tr[id]").forEach(el=>el.remove());svcRowCount=0;
  (data.services||[]).forEach(svc=>addSvcRow(svc.desc||"",svc.qty||1,svc.unit_price||0));
  if(data.sla_use_sw!==undefined){
    const sw=document.getElementById("sla-base-sw");const hw2=document.getElementById("sla-base-hw");const rate=document.getElementById("sla-rate");
    if(sw)sw.checked=!!data.sla_use_sw;if(hw2)hw2.checked=!!data.sla_use_hw;if(rate)rate.value=data.sla_rate||15;
  }
  if(!pricelist.length)await loadPricelist();
  activeProducts.clear();document.querySelectorAll(".product-chip").forEach(c=>c.classList.remove("on"));
  const savedLics=data.licenses||[];
  // Match by exact name first — abbrev is not unique across products (e.g. several
  // groups share "HW"/"MS"), so an abbrev-only fallback can silently pick the wrong group.
  const findGroupIdx = sg => {
    let idx = pricelist.findIndex(g => g.name === sg.name);
    if (idx < 0) idx = pricelist.findIndex(g => g.abbrev === sg.abbrev);
    return idx;
  };
  savedLics.forEach(sg=>{const idx=findGroupIdx(sg);
    if(idx<0)return;activeProducts.add(idx);document.querySelectorAll(".product-chip")[idx]?.classList.add("on");});
  renderLicSections();
  await new Promise(r=>setTimeout(r,300));
  document.querySelectorAll(".lic-table input[type=checkbox]").forEach(chk=>{chk.checked=false;});
  savedLics.forEach(sg=>{
    const idx=findGroupIdx(sg);if(idx<0)return;
    const plItems=pricelist[idx]?.items||[];
    (sg.items||[]).forEach(si=>{
      let iidx=plItems.findIndex(pi=>pi.code===si.code);if(iidx<0)iidx=sg.items.indexOf(si);if(iidx<0)return;
      const rid=`lic-${idx}-${iidx}`;
      const chkEl=document.getElementById(rid+"-chk");const qtyEl=document.getElementById(rid+"-qty");const priceEl=document.getElementById(rid+"-price");
      if(chkEl&&(si.qty>0||si.price>0))chkEl.checked=true;
      if(qtyEl)qtyEl.value=si.qty||0;if(priceEl)priceEl.value=si.price||0;
    });
  });
  _qtTotalOverride = (typeof data.grand_total_override === "number") ? data.grand_total_override : null;
  const resetBtn = document.getElementById("qt-total-reset-btn");
  if (resetBtn) resetBtn.style.display = _qtTotalOverride !== null ? "" : "none";
  qtCalc();
  if(data.server_config_raw?.length)await restoreServerConfig(data.server_config_raw);
  qtUpdate();onValidDaysChange();
  const t=document.getElementById("toast");if(t){t.textContent=`✓ Loaded ${version} — PP${dealId}`;t.style.display="inline";
    setTimeout(()=>{t.style.display="none";t.textContent="Copied!";},3000);}
}

async function restoreServerConfig(rawServers){
  if(!catalog||!catalog.categories)return;
  srvIds.forEach(id=>document.getElementById(id)?.remove());srvIds=[];srvCounter=0;
  document.getElementById("srv-empty").style.display="";
  for(const srv of rawServers){
    addServer();await new Promise(r=>setTimeout(r,50));
    const id=srvIds[srvIds.length-1];const card=document.getElementById(id);if(!card)continue;
    const nameEl=card.querySelector(".srv-name");if(nameEl)nameEl.value=srv.name||"";
    const qtyEl=card.querySelector(".qty-v");if(qtyEl)qtyEl.textContent=srv.qty||1;
    Object.entries(srv.selects||{}).forEach(([catId,{value,qty}])=>{
      if(catId==="os_addon"){const sel=document.getElementById(`${id}-os-addon`);if(sel)sel.value=value;
        const q=document.getElementById(`${id}-os-addon-qty`);if(q)q.textContent=qty;return;}
      const sel=document.getElementById(`${id}-${catId}`);if(sel&&value)sel.value=value;
      const qEl=document.getElementById(`${id}-${catId}-qty`);if(qEl&&qty)qEl.textContent=qty;
    });
    (srv.seldom||[]).forEach(s=>{addSeldomRow(id,"seldom_used");
      const container=document.getElementById(`${id}-seldom_used-rows`);
      const rows=container?.querySelectorAll("div[id]");const last=rows?.[rows.length-1];
      if(last){const sel=last.querySelector("select");const q=last.querySelector(".cqv");
        if(sel)sel.value=s.value;if(q)q.textContent=s.qty||1;}
    });
    calcTdp(id);validatePcie(id);
  }
}

async function deleteQuotation(dealId,version){
  if(!confirm(`Delete ${version} of deal PP${dealId}?`))return;
  await fetch(`/api/quotations/${encodeURIComponent(dealId)}/${encodeURIComponent(version)}`,{method:"DELETE"});
  showSavedVersions(dealId);loadSavedList();
}

document.addEventListener("DOMContentLoaded",()=>{
  const btn=document.getElementById("btn-export-excel");
  if(btn) btn.addEventListener("click", async ()=>{
    const saved = await saveQuotationToDB(false, true);
    if (saved !== false) exportQuote("xlsx");
  });
  // Pre-calculate server config on load
  setTimeout(scCalc, 200);
});

/* ══════════════════════════════
   SERVER CONFIGURATION CALCULATOR
   Based on Stream Labs MultiProbe load test data
══════════════════════════════ */

// Reference test data extracted from wiki load test PDFs
// Each entry: { res, codec, mode, decode, channels_per_unit, cpu_pct, ram_gb, notes }
const SC_TEST_DATA = {
  // ── QoS only (no decoding) ──────────────────────────────────────────────
  qos: {
    hd25:  { channels_cpu: 200, ram_per_ch: 0.15, cpu_cores_ref: 46, note: "Xeon Gold 6230R, 1080i50 10Mbps → 200ch / 2Gbps network, ~30GB RAM" },
    hd50:  { channels_cpu: 150, ram_per_ch: 0.15, cpu_cores_ref: 46, note: "Extrapolated from 1080i50 data" },
    sd:    { channels_cpu: 300, ram_per_ch: 0.10, cpu_cores_ref: 46, note: "Xeon Gold 6230R, 1080i50 5Mbps → 300ch, ~30GB RAM" },
    uhd:   { channels_cpu: 80,  ram_per_ch: 0.20, cpu_cores_ref: 46, note: "Extrapolated, no direct UHD QoS-only test" },
  },

  // ── QoS + QoE by reference frames (CPU decoding) ────────────────────────
  ref: {
    sd:    { channels_cpu: 250, ram_per_ch: 0.20, cpu_cores_ref: 46, note: "Xeon Gold 6230R, 576p25 H.264 3Mbps → 250ch, CPU 70-80%, ~50GB RAM" },
    hd25:  { channels_cpu: 100, ram_per_ch: 0.50, cpu_cores_ref: 46, note: "Xeon Gold 6230R, 1080i50 10Mbps → 100ch, CPU 60%, ~50GB RAM" },
    hd50:  { channels_cpu: 70,  ram_per_ch: 0.55, cpu_cores_ref: 46, note: "Xeon Gold 6230R, extrapolated; 140ch at 70-80% CPU is near limit" },
    uhd:   { channels_cpu: 20,  ram_per_ch: 1.0,  cpu_cores_ref: 46, note: "Extrapolated — no direct UHD ref-frame test" },
  },

  // ── Full Decoding ────────────────────────────────────────────────────────
  full: {
    // GPU — RTX PRO 4000 Blackwell
    gpu_blackwell: {
      sd:   { channels_gpu: 69, channels_gpu2: 140, ram_per_ch: 0.40, cpu_pct_per_ch: 0.28,
              note: "Xeon Gold 6530, SD 480p H.264 3.3Mbps → 69ch/GPU @ ~18% CPU" },
      hd25: { channels_gpu: 42, channels_gpu2: 84,  ram_per_ch: 0.55, cpu_pct_per_ch: 0.45,
              note: "Xeon Gold 6530, 1080p25 H.264 10Mbps, extrapolated from 1080p50 data" },
      hd50: { channels_gpu: 30, channels_gpu2: 60,  ram_per_ch: 0.55, cpu_pct_per_ch: 0.50,
              note: "Xeon Gold 6530, 1080p50 H.264 20Mbps → 34ch/GPU (conservative: 30), 2GPU→76ch, CPU 19-37%" },
      uhd:  { channels_gpu: 8,  channels_gpu2: 16,  ram_per_ch: 1.2,  cpu_pct_per_ch: 1.0,
              note: "Extrapolated — no direct UHD Blackwell test data" },
    },
    // GPU — RTX A4000 16GB
    gpu_a4000: {
      sd:   { channels_gpu: 98, channels_gpu2: 196, ram_per_ch: 0.35, cpu_pct_per_ch: 0.25,
              note: "Xeon Gold 5318Y, SD 576p H.264 1.5Mbps → 98ch/GPU (CPU+GPU mix: 224 total)" },
      hd25: { channels_gpu: 25, channels_gpu2: 50,  ram_per_ch: 0.55, cpu_pct_per_ch: 0.35,
              note: "Dual Xeon 6338, 1080p25 H.264 → ~25ch/GPU at 85% GPU decode, 2GPU→50ch" },
      hd50: { channels_gpu: 12, channels_gpu2: 24,  ram_per_ch: 0.60, cpu_pct_per_ch: 0.45,
              note: "Dual Xeon 6338, 1080p50 H.264 → ~12ch/GPU at 80% GPU decode" },
      uhd:  { channels_gpu: 7,  channels_gpu2: 14,  ram_per_ch: 1.0,  cpu_pct_per_ch: 0.8,
              note: "Xeon 5318Y, H.265 4K 50fps → 7ch/GPU at 80% decode (1 GPU test)" },
    },
    // CPU only decoding
    cpu: {
      sd:   { channels_cpu: 172, ram_per_ch: 0.25, cpu_cores_ref: 48, note: "Xeon 5318Y, SD 576p H.264 1.5Mbps → 172ch on CPU at <85%" },
      hd25: { channels_cpu: 54,  ram_per_ch: 0.55, cpu_cores_ref: 64, note: "Dual Xeon 6338, 1080p25 H.264 10Mbps → 54ch CPU+GPU mix; CPU-only ~32ch/Xeon" },
      hd50: { channels_cpu: 20,  ram_per_ch: 0.65, cpu_cores_ref: 48, note: "Xeon 5318Y, 1080p HD H.264 50fps → ~20ch CPU at <85%" },
      uhd:  { channels_cpu: 0,   ram_per_ch: 0,    cpu_cores_ref: 0,  note: "4K на CPU не декодируется (из тестов Зиброва)" },
    },
  },
};

// H.265 is more CPU/GPU intensive — apply multiplier
const H265_FACTOR = { cpu: 0.75, gpu: 1.15 }; // H.265: ~25% fewer channels on CPU, ~15% more on GPU

// Recommended CPUs by workload
const SC_CPUS = [
  { name: "Intel Xeon Gold 6230R",  cores: 26,  tdp: 150, tier: 1 },
  { name: "Intel Xeon Gold 6530",   cores: 32,  tdp: 270, tier: 2 },
  { name: "Intel Xeon Gold 6338",   cores: 32,  tdp: 205, tier: 2 },
  { name: "Intel Xeon Gold 6338 ×2",cores: 64,  tdp: 410, tier: 3 },
  { name: "AMD EPYC 7543",          cores: 32,  tdp: 225, tier: 2 },
];

let _scResult = null;

function scCalc() {
  const res       = document.getElementById("sc-resolution")?.value || "hd25";
  const codec     = document.getElementById("sc-codec")?.value || "h264";
  const bitrate   = parseFloat(document.getElementById("sc-bitrate")?.value) || 10;
  const channels  = parseInt(document.getElementById("sc-channels")?.value) || 50;
  const mode      = document.getElementById("sc-mode")?.value || "ref";
  const decode    = document.getElementById("sc-decode")?.value || "gpu_blackwell";
  const mosaic    = document.getElementById("sc-mosaic")?.checked;
  const recording = document.getElementById("sc-recording")?.checked;

  const resultEl  = document.getElementById("sc-result");
  const nodataEl  = document.getElementById("sc-nodata");
  const cardsEl   = document.getElementById("sc-cards");
  const detailEl  = document.getElementById("sc-detail");
  const warnEl    = document.getElementById("sc-warning");

  // Elements not in DOM yet — abort silently
  if (!resultEl || !cardsEl) return;

  // Enable/disable decode select based on mode
  const decodeEl = document.getElementById("sc-decode");
  if (decodeEl) decodeEl.disabled = (mode !== "full");

  // Get test data
  let data, isGpu = false, channelsPerUnit = 0;
  const warnings = [];

  if (mode === "qos") {
    data = SC_TEST_DATA.qos[res];
  } else if (mode === "ref") {
    data = SC_TEST_DATA.ref[res];
  } else {
    data = SC_TEST_DATA.full[decode]?.[res];
    isGpu = (decode !== "cpu");
  }

  if (!data || (mode === "full" && decode === "cpu" && data.channels_cpu === 0)) {
    if (nodataEl) nodataEl.style.display = "block";
    if (cardsEl)  cardsEl.innerHTML = "";
    if (detailEl) detailEl.innerHTML = "";
    return;
  }
  if (nodataEl) nodataEl.style.display = "none";

  // Apply H.265 factor
  const h265 = codec === "h265";
  let channels_per_gpu = isGpu ? (data.channels_gpu || 0) : 0;
  let channels_per_cpu = !isGpu ? (data.channels_cpu || 0) : 0;
  if (h265) {
    channels_per_gpu = Math.floor(channels_per_gpu * H265_FACTOR.gpu);
    channels_per_cpu = Math.floor(channels_per_cpu * H265_FACTOR.cpu);
    warnings.push("H.265: GPU capacity slightly higher, CPU capacity ~25% lower than H.264.");
  }

  // Bitrate scaling — tests done at reference bitrates; scale linearly for GPU decode
  const refBitrates = { sd: 3, hd25: 10, hd50: 20, uhd: 20 };
  const refBr = refBitrates[res] || 10;
  if (Math.abs(bitrate - refBr) > 3) {
    const factor = refBr / bitrate;
    if (isGpu) {
      channels_per_gpu = Math.max(1, Math.floor(channels_per_gpu * factor));
      warnings.push(`Bitrate ${bitrate} Mbps differs from test reference (${refBr} Mbps) — capacity adjusted proportionally.`);
    }
  }

  // Network bandwidth needed
  const networkGbps = (channels * bitrate) / 1000;

  // ── Size the fleet (one or more identical servers) ────────────────────────
  const HEADROOM = 0.80; // use max 80% of tested capacity

  // Capacity of a single "unit" (1 GPU, or 1 CPU socket)
  const unitCapacity = Math.max(1, Math.floor(
    (isGpu ? (channels_per_gpu || 1) : (channels_per_cpu || channels)) * HEADROOM
  ));
  const totalUnitsNeeded = Math.max(1, Math.ceil(channels / unitCapacity));

  // Pick CPU/GPU families first — their socket & PCIe needs decide which real
  // motherboards are even compatible, so the per-server ceiling isn't guessed.
  const cpuItem = isGpu ? scPickCpu(32) : scPickCpu(data.cpu_cores_ref || 32);
  const gpuItem = isGpu ? scPickGpu(decode) : null;
  const gpuSlotsUsed = gpuItem?.slots_used || 1;

  const mbPoolAll  = scCatalogItems("motherboard");
  const mbPool     = mbPoolAll.filter(m => m.socket === cpuItem?.socket);
  const mbCandidates = mbPool.length ? mbPool : mbPoolAll;

  // Physical ceiling per chassis, derived from the best real motherboard available
  // for this CPU's socket — not an assumed constant.
  const maxCpuSocketsAvail = mbCandidates.length ? Math.max(...mbCandidates.map(m => m.cpu_sockets || 1)) : 1;
  const maxGpuUnitsAvail   = mbCandidates.length ? Math.max(...mbCandidates.map(m => Math.floor((m.pcie_x16 || 0) / gpuSlotsUsed))) : 1;
  const MAX_UNITS_PER_SERVER = Math.max(1, isGpu ? maxGpuUnitsAvail : maxCpuSocketsAvail);

  const strategy = document.getElementById("sc-strategy")?.value || "scaleup";

  let unitsPerServer = strategy === "split"
    ? 1                                            // scale OUT: smaller, more numerous servers
    : Math.min(MAX_UNITS_PER_SERVER, totalUnitsNeeded); // scale UP: pack each server to the max
  let serverCount = Math.max(1, Math.ceil(totalUnitsNeeded / unitsPerServer));
  unitsPerServer  = Math.ceil(totalUnitsNeeded / serverCount); // rebalance evenly across servers

  const channelsPerServer = Math.ceil(channels / serverCount);

  if (serverCount > 1) {
    warnings.push(`One server isn't enough for ${channels} channels — recommending ${serverCount}× identical servers ` +
      `(${strategy === "split" ? "scaled out for lower cost per unit" : "scaled up to minimise server count"}).`);
  }
  if (!mbPool.length) {
    warnings.push(`No motherboard in the catalog matches socket ${cpuItem?.socket || "?"} — add one in Component Catalog for an exact fit.`);
  }

  // ── Pick real parts from the Configurator catalog ─────────────────────────
  let gpuQtyPerServer = 0, cpuQtyPerServer = 1, ramGbPerServer = 0;

  if (isGpu) {
    gpuQtyPerServer = unitsPerServer;
    cpuQtyPerServer = Math.min(gpuQtyPerServer > 2 ? 2 : 1, maxCpuSocketsAvail); // GPU offloads most decode — light CPU need
    ramGbPerServer = Math.ceil(32 + channelsPerServer * (data.ram_per_ch || 0.5));
  } else {
    cpuQtyPerServer = unitsPerServer;
    ramGbPerServer = Math.ceil(32 + channelsPerServer * (data.ram_per_ch || 0.3));
  }

  // Recording adds ~30% CPU overhead
  if (recording) {
    warnings.push("Recording (transcoding) adds significant CPU load (~30%). Consider adding GPU encoder or extra CPU headroom.");
    if (!isGpu) ramGbPerServer = Math.ceil(ramGbPerServer * 1.2);
  }
  if (mosaic && mode === "qos") {
    warnings.push("Mosaic display with QoS-only mode uses CPU for rendering — may reduce channel capacity by 10-15%.");
  }

  // Round RAM to standard sizes, then pick real catalog modules to reach it.
  // Full memory bandwidth requires populating every channel on every installed
  // CPU (mem_channels from the catalog) — fewer sticks run in degraded mode.
  const stdRam = [32,64,96,128,192,256,384,512];
  ramGbPerServer = stdRam.find(s => s >= ramGbPerServer) || 512;
  const minRamSticks = cpuQtyPerServer * (cpuItem?.mem_channels || 8);
  let ramItem = scPickRam(cpuItem?.mem_type, ramGbPerServer, minRamSticks);

  // Pick the actual motherboard for this exact CPU/GPU/RAM combo
  const mbItem = scPickMotherboard(cpuItem?.socket, cpuQtyPerServer, gpuQtyPerServer, gpuSlotsUsed, ramItem.qty);
  if (mbItem && (mbItem.cpu_sockets||1) < cpuQtyPerServer) {
    warnings.push(`No catalog motherboard has ${cpuQtyPerServer} CPU sockets for ${esc(cpuItem?.socket||"")} — closest is ${esc(mbItem.name)} (${mbItem.cpu_sockets||1} socket${(mbItem.cpu_sockets||1)>1?"s":""}). Add a suitable board to the catalog.`);
  }
  if (mbItem && (mbItem.pcie_x16||0) < gpuQtyPerServer * gpuSlotsUsed) {
    warnings.push(`No catalog motherboard has enough PCIe x16 slots for ${gpuQtyPerServer}× GPU — closest is ${esc(mbItem.name)} (${mbItem.pcie_x16||0}× x16). Add a suitable board to the catalog.`);
  }
  if (mbItem && ramItem.qty > (mbItem.ram_slots || 0)) {
    warnings.push(`RAM: ${cpuQtyPerServer}× ${esc(cpuItem?.name||"CPU")} needs ${minRamSticks} sticks to populate all memory channels, but ${esc(mbItem.name)} only has ${mbItem.ram_slots || 0} slots.`);
  }
  const ramActualGb = ramItem.qty * ramItem.capacity;

  // Network interface recommendation (per-server share of total bandwidth)
  const netPerServerGbps = networkGbps / serverCount;
  const netIface = netPerServerGbps > 10 ? "2× 25GbE or 2× 40GbE" : netPerServerGbps > 5 ? "2× 10GbE" : "1× 10GbE";

  _scResult = {
    serverCount, strategy,
    cpuItem, cpuQtyPerServer,
    gpuItem, gpuQtyPerServer,
    ramItem, ramActualGb,
    mbItem,
    networkGbps, netIface, channels, channelsPerServer, res, mode, decode,
  };

  // ── Render cards ──────────────────────────────────────────────────────────
  const cardStyle = `background:var(--bg3);border-radius:var(--radius);padding:14px;text-align:center`;
  const fleetNote = serverCount > 1
    ? `<div style="grid-column:1/-1;font-size:12px;color:var(--accent);font-weight:600;margin-bottom:4px">
         ${serverCount}× identical servers &nbsp;·&nbsp; ~${channelsPerServer} channels each
       </div>` : "";
  cardsEl.innerHTML = `
    ${fleetNote}
    <div style="${cardStyle}">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">CPU ${serverCount>1?"(per server)":""}</div>
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px">${cpuQtyPerServer}× ${esc(cpuItem?.name || "—")}</div>
      <div style="font-size:11px;color:var(--muted)">${cpuItem ? (cpuItem.name.match(/(\d+)C-/)?.[1] || "?") + " cores each" : ""}</div>
    </div>
    <div style="${cardStyle}">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">RAM ${serverCount>1?"(per server)":""}</div>
      <div style="font-size:22px;font-weight:700;color:var(--accent)">${ramActualGb} GB</div>
      <div style="font-size:11px;color:var(--muted)">${ramItem.qty}× ${esc(ramItem.name || "")}</div>
    </div>
    <div style="${cardStyle}">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">GPU ${serverCount>1?"(per server)":""}</div>
      ${gpuQtyPerServer > 0
        ? `<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px">${gpuQtyPerServer}× ${esc(gpuItem?.name || "—")}</div>
           <div style="font-size:11px;color:var(--muted)">${Math.floor(channels_per_gpu * HEADROOM)} ch/GPU (80% load)</div>`
        : `<div style="font-size:13px;font-weight:700;color:var(--muted)">Not required</div>
           <div style="font-size:11px;color:var(--muted)">CPU decoding</div>`}
    </div>
    <div style="${cardStyle};grid-column:1/-1">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Motherboard ${serverCount>1?"(per server)":""}</div>
      <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(mbItem?.name || "No compatible board in catalog")}</div>
      ${mbItem ? `<div style="font-size:11px;color:var(--muted)">${mbItem.cpu_sockets||1}× CPU socket, ${mbItem.ram_slots||0}× RAM, ${mbItem.pcie_x16||0}× PCIe x16</div>` : ""}
    </div>`;

  // ── Detail text ───────────────────────────────────────────────────────────
  const modeLabel = { qos: "QoS only", ref: "QoS + QoE (reference frames)", full: "Full Decoding" }[mode];
  const resLabel  = { sd:"SD", hd25:"HD 1080p25/i50", hd50:"HD 1080p50", uhd:"UHD 4K" }[res];
  detailEl.innerHTML = `
    <b>Scenario:</b> ${channels} × ${resLabel} ${codec.toUpperCase()} ${bitrate} Mbps &nbsp;·&nbsp; ${modeLabel}<br>
    <b>Fleet:</b> ${serverCount}× server${serverCount>1?"s":""} ${serverCount>1?`(${channelsPerServer} ch each)`:""}<br>
    <b>Network:</b> ${networkGbps.toFixed(1)} Gbps total${serverCount>1?` (~${netPerServerGbps.toFixed(1)} Gbps/server)`:""} → recommend <b>${netIface}</b> per server<br>
    <b>Capacity basis:</b> ${data.note}<br>
    ${isGpu && channels_per_gpu ? `<b>GPU capacity:</b> max ~${Math.floor(channels_per_gpu * HEADROOM)} channels per GPU at 80% load<br>` : ""}
    ${!isGpu && channels_per_cpu ? `<b>CPU capacity:</b> max ~${Math.floor(channels_per_cpu * HEADROOM)} channels at 80% utilisation<br>` : ""}
    <span style="color:var(--muted);font-size:11px">⚠ Add 20–25% headroom for real-world fluctuations. Data based on Stream Labs v7.14/25.12 internal tests.</span>`;

  if (warnEl) {
    warnEl.style.display = warnings.length ? "block" : "none";
    if (warnings.length) warnEl.innerHTML = warnings.map(w => `⚠ ${esc(w)}`).join("<br>");
  }
}

// ── Pick real catalog parts (so results map onto what Configurator/Pricelist actually sell) ──
function scCatalogItems(catId) {
  const cat = getCatById(catId);
  return (cat?.items || []).filter(o => typeof o === "object");
}

function scPickCpu(minCores) {
  const items = scCatalogItems("cpu");
  if (!items.length) return null;
  const withCores = items.map(o => {
    const m = o.name.match(/(\d+)C-/);
    return { ...o, cores: m ? parseInt(m[1]) : 0 };
  });
  const sufficient = withCores.filter(o => o.cores >= minCores).sort((a,b) => a.cores - b.cores);
  return sufficient[0] || withCores.sort((a,b) => b.cores - a.cores)[0];
}

function scPickGpu(decode) {
  const items = scCatalogItems("gpu");
  if (!items.length) return null;
  const keyword = decode === "gpu_blackwell" ? "blackwell" : "a4000";
  return items.find(o => o.name.toLowerCase().includes(keyword)) || items[0];
}

// Picks the smallest RAM module that, at exactly `minSticks` (all memory
// channels populated), covers targetGb. If even the biggest catalog module
// falls short at minSticks, adds extra full sets of minSticks rather than
// leaving channels unpopulated.
function scPickRam(memType, targetGb, minSticks = 1) {
  const all  = scCatalogItems("ram");
  const pool = (memType && all.some(o => o.mem_type === memType)) ? all.filter(o => o.mem_type === memType) : all;
  if (!pool.length) {
    const qty = Math.max(minSticks, Math.ceil(targetGb / 32));
    return { name: "RAM module", capacity: 32, qty };
  }
  const sorted = [...pool].sort((a,b) => a.capacity - b.capacity);
  const fits = sorted.find(m => minSticks * m.capacity >= targetGb);
  if (fits) return { ...fits, qty: minSticks };

  const biggest = sorted[sorted.length - 1];
  const sets = Math.ceil(targetGb / (minSticks * biggest.capacity));
  return { ...biggest, qty: minSticks * sets };
}

// Picks the smallest real motherboard that actually supports the requested
// CPU socket count, GPU PCIe x16 slots, and RAM DIMM slots — same constraints
// the Configurator itself enforces via validatePcie().
function scPickMotherboard(socketType, cpuQty, gpuQty, gpuSlotsUsed, ramQty) {
  const items = scCatalogItems("motherboard");
  if (!items.length) return null;
  const bySocket = socketType ? items.filter(m => m.socket === socketType) : items;
  const pool = bySocket.length ? bySocket : items;

  const requiredX16 = gpuQty * (gpuSlotsUsed || 1);
  const size = m => (m.cpu_sockets || 1) * 100 + (m.pcie_x16 || 0) * 10 + (m.ram_slots || 0) / 8;

  const sufficient = pool.filter(m =>
    (m.cpu_sockets || 1) >= cpuQty &&
    (m.pcie_x16 || 0)    >= requiredX16 &&
    (m.ram_slots || 0)   >= ramQty
  );
  if (sufficient.length) return sufficient.sort((a,b) => size(a) - size(b))[0];

  // Nothing fits — surface the closest (biggest) option so the caller can warn.
  return pool.sort((a,b) => size(b) - size(a))[0];
}

function scImportToConfigurator() {
  if (!_scResult) return;
  const { serverCount, cpuItem, cpuQtyPerServer, gpuItem, gpuQtyPerServer, ramItem, mbItem } = _scResult;

  // Switch to configurator tab
  document.querySelector('[data-tab="cfg"]').click();

  for (let i = 0; i < serverCount; i++) {
    addServer();
    const id = srvIds[srvIds.length - 1];
    if (!id) continue;

    const card = document.getElementById(id);
    const nameEl = card?.querySelector(".srv-name");
    if (nameEl) nameEl.value = serverCount > 1 ? `MultiProbe Server ${i + 1}/${serverCount}` : "MultiProbe Server";

    // Exact catalog values — no fuzzy matching needed, we picked these from the same catalog.
    setTimeout(() => {
      if (cpuItem) {
        const cpuSel = document.getElementById(`${id}-cpu`);
        if (cpuSel) cpuSel.value = cpuItem.name;
        const cpuQty = document.getElementById(`${id}-cpu-qty`);
        if (cpuQty) cpuQty.textContent = cpuQtyPerServer;
      }
      if (gpuItem && gpuQtyPerServer > 0) {
        const gpuSel = document.getElementById(`${id}-gpu`);
        if (gpuSel) gpuSel.value = gpuItem.name;
        const gpuQty = document.getElementById(`${id}-gpu-qty`);
        if (gpuQty) gpuQty.textContent = gpuQtyPerServer;
      }
      if (ramItem) {
        const ramSel = document.getElementById(`${id}-ram`);
        if (ramSel) ramSel.value = ramItem.name;
        const ramQty = document.getElementById(`${id}-ram-qty`);
        if (ramQty) ramQty.textContent = ramItem.qty;
      }
      if (mbItem) {
        const mbSel = document.getElementById(`${id}-motherboard`);
        if (mbSel) mbSel.value = mbItem.name;
      }
      calcTdp(id);
      validatePcie(id);
    }, 100);
  }

  // Toast
  const t = document.getElementById("toast");
  if (t) {
    t.textContent = serverCount > 1
      ? `✓ ${serverCount} servers imported to Configurator`
      : "✓ Configuration imported to Configurator";
    t.style.display = "inline";
    setTimeout(() => { t.style.display = "none"; t.textContent = "Copied!"; }, 3000);
  }
}

// Trigger initial calculation when tab opens
