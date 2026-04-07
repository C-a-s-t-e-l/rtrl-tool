window.rtrlApp.review = (function () {
  let masterData = [];
  let filteredData = [];
  let currentJobId = null;
  let jobParams = {};
  let saveTimeout = null;
  let currentSort = { key: "BusinessName", dir: "asc" };
  let activeFilters = { search: "", contact: "all", rating: 0, ownerType: "all" };
  let sharedSbClient = null;
  let tokenProvider = () => null;
  let backendUrl = '';

  function getSbClient() {
    if (!sharedSbClient) {
      sharedSbClient = supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY);
    }
    return sharedSbClient;
  }

  function init(provider, url) {
    if (provider) tokenProvider = provider;
    if (url) backendUrl = url;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            const containers = node.querySelectorAll(".action-buttons-container");
            containers.forEach((container) => {
              if (!container.querySelector(".btn-review-trigger")) {
                const resendBtn = container.querySelector(".resend-email-btn");
                if (!resendBtn) return;
                const btn = document.createElement("button");
                btn.className = "job-action-btn btn-review-trigger";
                btn.style.backgroundColor = "#f0f9ff";
                btn.innerHTML = `<i class="fas fa-list-check"></i> Review & Filter`;
                btn.onclick = () => openReview(resendBtn.dataset.jobId);
                container.appendChild(btn);
              }
            });
          }
        });
      });
    });
    const list = document.getElementById("job-list-container");
    if (list) observer.observe(list, { childList: true, subtree: true });
  }

  async function openReview(jobIds) {
    // Show Loading Cursor
    document.body.style.cursor = 'wait';
    
    const idArray = Array.isArray(jobIds) ? jobIds : [jobIds];
    const token = tokenProvider();

    try {
        const response = await fetch(`${backendUrl}/api/jobs/merge`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ jobIds: idArray })
        });
        
        if (!response.ok) throw new Error("Fetch failed");
        const data = await response.json();
        
        // Reset local state for merge
        currentJobId = idArray.length === 1 ? idArray[0] : 'Merged_Collection';
        
        processData(data.results || [], []);
        renderModal();
    } catch (err) { 
        console.error(err);
        alert("Failed to load review workspace."); 
    } finally {
        // Restore Cursor
        document.body.style.cursor = 'default';
    }
  }

  function processData(results, exclusionList) {
    const seen = new Set();
    const norm = (s) => (s || "").toLowerCase().replace(/['’`.,()&]/g, "").replace(/\s+/g, "");
    const excl = (exclusionList || []).map((e) => norm(e));
    
    masterData = results.map((item, index) => {
      const name = norm(item.BusinessName);
      const sig = `NAME:${name.substring(0, 15)}_${norm(item.StreetAddress)}`;
      let status = "Active";
      if (excl.some((ex) => name.includes(ex))) status = "Excluded";
      else if (seen.has(sig)) status = "Duplicate";
      if (status === "Active") seen.add(sig);
      
      return {
        ...item,
        _id: index,
        _reviewStatus: status,
        _checked: item._selected !== undefined ? item._selected : status === "Active",
        ManualNotes: item.ManualNotes || ""
      };
    });
    applyFiltersAndSort();
  }

  function applyFiltersAndSort() {
    let data = [...masterData];
    if (activeFilters.search) {
      const s = activeFilters.search.toLowerCase();
      data = data.filter(d => (d.BusinessName || "").toLowerCase().includes(s) || (d.StreetAddress || "").toLowerCase().includes(s) || (d.Category || "").toLowerCase().includes(s) || (d.Suburb || "").toLowerCase().includes(s));
    }
    if (activeFilters.contact === "mobile") data = data.filter(d => (d.Phone || "").startsWith("614") || (d.Phone || "").startsWith("04"));
    else if (activeFilters.contact === "email") data = data.filter(d => d.Email1);
    else if (activeFilters.contact === "both") data = data.filter(d => d.Email1 && ((d.Phone || "").startsWith("614") || (d.Phone || "").startsWith("04")));

    if (activeFilters.rating > 0) data = data.filter(d => parseFloat(d.StarRating || 0) >= activeFilters.rating);

    if (activeFilters.ownerType !== "all") {
      data = data.filter((d) => {
        const name = (d.OwnerName || "").toLowerCase();
        if (activeFilters.ownerType === "private") return name === "private owner" || !name;
        const isEntity = name.includes("pty") || name.includes("ltd") || name.includes("inc") || name.includes("corp");
        if (activeFilters.ownerType === "entity") return isEntity && name !== "private owner";
        if (activeFilters.ownerType === "human") return !isEntity && name !== "private owner" && name.length > 2;
        return true;
      });
    }

    const k = currentSort.key;
    const d = currentSort.dir === "asc" ? 1 : -1;
    data.sort((a, b) => {
      let valA = a[k] || "", valB = b[k] || "";
      if (k === "StarRating" || k === "ReviewCount") { valA = parseFloat(valA) || 0; valB = parseFloat(valB) || 0; }
      return valA > valB ? 1 * d : valA < valB ? -1 * d : 0;
    });
    filteredData = data;
  }

  async function saveProgress() {
    const ind = document.getElementById("rev-save-indicator");
    if (ind) { ind.innerHTML = '<i class="fas fa-sync fa-spin"></i> Saving...'; ind.classList.add("visible"); }

    // Group modified rows by their source job
    const updatesByJob = masterData.reduce((acc, item) => {
        if (!item._sourceJobId) return acc;
        if (!acc[item._sourceJobId]) acc[item._sourceJobId] = [];
        const { _id, _reviewStatus, _checked, _sourceJobId, ...clean } = item;
        acc[item._sourceJobId].push({ ...clean, _selected: _checked });
        return acc;
    }, {});

    // Save each affected job individually back to database
    for (const jobId in updatesByJob) {
        await getSbClient().from("jobs").update({ results: updatesByJob[jobId] }).eq("id", jobId);
    }

    setTimeout(() => { if (ind) ind.innerHTML = '<i class="fas fa-check"></i> Changes saved'; }, 500);
  }

  function debouncedSave() { clearTimeout(saveTimeout); saveTimeout = setTimeout(saveProgress, 1200); }

  function renderModal() {
    if (document.getElementById("review-modal")) document.getElementById("review-modal").remove();
    const s = jobParams.searchParamsForEmail || {};
    const title = "Data Review Workspace";
    
    let ratingsOptions = '<option value="0">Any Rating</option>';
    for(let r=0.5; r<=4.5; r+=0.5) {
        ratingsOptions += `<option value="${r}" ${activeFilters.rating === r ? "selected" : ""}>${r}+ Stars</option>`;
    }

    const overlay = document.createElement("div");
    overlay.className = "review-overlay";
    overlay.id = "review-modal";
    overlay.innerHTML = `
            <div class="review-window">
                <div class="review-header">
                    <div class="header-top-row"><h3>${title}</h3></div>
                    <div class="header-bottom-row">
                        <div class="review-summary">
                            <span id="rev-sel-count" class="sum-pill" style="background:#e0f2fe; color:#0369a1; border-color:#0369a1;">0 SELECTED</span>
                            <span class="sum-pill sum-active">${masterData.filter(d => d._reviewStatus === "Active").length} Unique</span>
                            <span class="sum-pill sum-dup">${masterData.filter(d => d._reviewStatus === "Duplicate").length} Duplicates</span>
                            <span class="sum-pill sum-excl">${masterData.filter(d => d._reviewStatus === "Excluded").length} Excluded</span>
                        </div>
                        <div class="review-search-wrapper">
                            <input type="text" class="review-search" placeholder="Search name, category, suburb..." id="rev-search" value="${activeFilters.search}">
                            <button class="btn-reset-active" id="rev-only-active">Reset to Active Only</button>
                        </div>
                    </div>
                </div>
                <div class="review-toolbar">
                    <div class="filter-group-inline">
                        <span class="filter-label">Clean:</span>
                        <div class="tooltip-wrapper">
                            <button class="btn-smart-clean-inline" id="rev-smart-clean">Clean Junk Leads</button>
                            <span class="tooltip-text">
                                <b>Smart Cleanup</b><br>
                                Automatically unselects leads that have no email address and no phone number.
                            </span>
                        </div>
                    </div>
                    <div style="width:1px; height:20px; background:#e2e8f0;"></div>
                    <div class="filter-group-inline">
                        <span class="filter-label">Contact:</span>
                        <div class="tooltip-wrapper"><button class="filter-pill ${activeFilters.contact === "all" ? "active" : ""}" data-type="contact" data-val="all">All</button><span class="tooltip-text">Show all leads found.</span></div>
                        <div class="tooltip-wrapper"><button class="filter-pill ${activeFilters.contact === "mobile" ? "active" : ""}" data-type="contact" data-val="mobile">Mobiles</button><span class="tooltip-text">Show only leads with Australian mobile numbers (starts with 04).</span></div>
                        <div class="tooltip-wrapper"><button class="filter-pill ${activeFilters.contact === "email" ? "active" : ""}" data-type="contact" data-val="email">Emails</button><span class="tooltip-text">Show only leads with at least one email address found.</span></div>
                        <div class="tooltip-wrapper"><button class="filter-pill ${activeFilters.contact === "both" ? "active" : ""}" data-type="contact" data-val="both">Mobiles + Emails</button><span class="tooltip-text">Show only high-quality leads that have BOTH a mobile and an email.</span></div>
                    </div>
                    <div style="width:1px; height:20px; background:#e2e8f0;"></div>
                    <div class="filter-group-inline">
                        <span class="filter-label">Min Rating:</span>
                        <select class="filter-select" id="rev-filter-rating">${ratingsOptions}</select>
                    </div>
                    <div class="filter-group-inline">
                        <span class="filter-label">Owner Info:</span>
                        <select class="filter-select" id="rev-filter-owner">
                            <option value="all" ${activeFilters.ownerType === "all" ? "selected" : ""}>Any Record</option>
                            <option value="human" ${activeFilters.ownerType === "human" ? "selected" : ""}>Person's Name Found</option>
                            <option value="entity" ${activeFilters.ownerType === "entity" ? "selected" : ""}>Company/Entity Name</option>
                            <option value="private" ${activeFilters.ownerType === "private" ? "selected" : ""}>Private/Missing</option>
                        </select>
                    </div>
                    <span id="rev-visible-count" style="margin-left:auto; font-size:0.75rem; color:#94a3b8; font-weight:600;"></span>
                </div>
                <div class="review-table-container">
                    <table class="review-table">
                        <thead><tr>
                            <th style="width:50px">#</th>
                            <th style="width:50px"><input type="checkbox" id="rev-master-check"></th>
                            <th style="width:110px" data-sort="_reviewStatus"><div class="header-content">Status <i class="fas fa-sort"></i></div></th>
                            <th style="width:250px" data-sort="BusinessName"><div class="header-content">Business Name <i class="fas fa-sort"></i></div></th>
                            <th style="width:180px" data-sort="OwnerName"><div class="header-content">Owner <i class="fas fa-sort"></i></div></th>
                            <th style="width:180px">Email 1</th>
                            <th style="width:180px">Email 2</th>
                            <th style="width:180px">Email 3</th>
                            <th style="width:120px">Phone</th>
                            <th style="width:160px" data-sort="Category">Category</th>
                            <th style="width:140px" data-sort="Suburb">Suburb</th>
                            <th style="width:300px">Street Address</th>
                            <th style="width:100px" data-sort="StarRating">Rating</th>
                            <th style="width:100px">Links</th>
                            <th class="col-notes">Internal User Notes</th>
                        </tr></thead>
                        <tbody id="rev-body"></tbody>
                    </table>
                </div>
                <div class="review-footer">
                    <div id="rev-save-indicator" class="save-indicator"></div>
                    <button class="btn-review-close" onclick="document.getElementById('review-modal').remove()">Close Workspace</button>
                    <button class="btn-review-export" style="background:#10b981" id="rev-xlsx">Export List (.xlsx)</button>
                    <button class="btn-review-export" id="rev-zip">Export ZIP Pack</button>
                </div>
            </div>`;
    document.body.appendChild(overlay);
    refreshUI();

    // Handlers
    document.getElementById("rev-search").oninput = (e) => { activeFilters.search = e.target.value; refreshUI(); };
    document.getElementById("rev-filter-rating").onchange = (e) => { activeFilters.rating = parseFloat(e.target.value); refreshUI(); };
    document.getElementById("rev-filter-owner").onchange = (e) => { activeFilters.ownerType = e.target.value; refreshUI(); };
    document.querySelectorAll('.filter-pill[data-type="contact"]').forEach((btn) => { btn.onclick = () => { activeFilters.contact = btn.dataset.val; refreshUI(); }; });
    document.querySelectorAll(".review-table th[data-sort]").forEach((th) => { th.onclick = () => { const key = th.dataset.sort; currentSort.dir = currentSort.key === key && currentSort.dir === "asc" ? "desc" : "asc"; currentSort.key = key; refreshUI(); }; });
    document.getElementById("rev-master-check").onclick = (e) => { filteredData.forEach((d) => (d._checked = e.target.checked)); updateRowsOnly(); debouncedSave(); };
    
    document.getElementById("rev-only-active").onclick = () => {
      masterData.forEach((d) => (d._checked = d._reviewStatus === "Active"));
      activeFilters = { search: "", contact: "all", rating: 0, ownerType: "all" };
      refreshUI();
      debouncedSave();
    };

    document.getElementById("rev-smart-clean").onclick = () => {
        let count = 0;
        masterData.forEach(d => { if (!d.Email1 && !d.Phone) { d._checked = false; count++; } });
        refreshUI(); debouncedSave();
        alert(`Unchecked ${count} leads that had no contact information.`);
    };

    document.getElementById("rev-xlsx").onclick = exportMaster;
    document.getElementById("rev-zip").onclick = exportZip;
  }

  function handleCellEdit(id, field, newValue) {
    const item = masterData.find(d => d._id === id);
    if (item && item[field] !== newValue) { item[field] = newValue; debouncedSave(); }
  }

  function refreshUI() { applyFiltersAndSort(); updateRowsOnly(); renderToolbarState(); }
  
  function renderToolbarState() {
    document.querySelectorAll('.filter-pill[data-type="contact"]').forEach((btn) => { btn.classList.toggle("active", activeFilters.contact === btn.dataset.val); });
    document.querySelectorAll(".review-table th[data-sort]").forEach((th) => {
      th.classList.toggle("sort-active", th.dataset.sort === currentSort.key);
      const icon = th.querySelector("i");
      if (icon) icon.className = th.dataset.sort === currentSort.key ? (currentSort.dir === "asc" ? "fas fa-sort-up" : "fas fa-sort-down") : "fas fa-sort";
    });
    document.getElementById("rev-visible-count").textContent = `Showing ${filteredData.length} of ${masterData.length} leads`;
  }

  function updateRowsOnly() {
    const count = masterData.filter((d) => d._checked).length;
    document.getElementById("rev-sel-count").textContent = `${count} SELECTED`;
    document.getElementById("rev-body").innerHTML = filteredData.map((d, i) => `
            <tr class="row-${d._reviewStatus.toLowerCase()}">
                <td style="color:#94a3b8; font-size:0.7rem">${i + 1}</td>
                <td><input type="checkbox" ${d._checked ? "checked" : ""} onchange="window.rtrlApp.review.toggle(${d._id})"></td>
                <td><span class="status-badge badge-${d._reviewStatus.toLowerCase()}">${d._reviewStatus}</span></td>
                <td style="font-weight:600; color:#1e293b">${d.BusinessName}</td>
                <td class="editable-cell" contenteditable="true" onblur="window.rtrlApp.review.edit(${d._id}, 'OwnerName', this.innerText)">${d.OwnerName || ""}</td>
                <td class="editable-cell" contenteditable="true" onblur="window.rtrlApp.review.edit(${d._id}, 'Email1', this.innerText)" style="color:#3b82f6">${d.Email1 || ""}</td>
                <td class="editable-cell" contenteditable="true" onblur="window.rtrlApp.review.edit(${d._id}, 'Email2', this.innerText)" style="color:#3b82f6">${d.Email2 || ""}</td>
                <td class="editable-cell" contenteditable="true" onblur="window.rtrlApp.review.edit(${d._id}, 'Email3', this.innerText)" style="color:#3b82f6">${d.Email3 || ""}</td>
                <td class="editable-cell" contenteditable="true" onblur="window.rtrlApp.review.edit(${d._id}, 'Phone', this.innerText)">${d.Phone || ""}</td>
                <td style="color:#64748b; font-size:0.75rem">${d.Category}</td>
                <td>${d.Suburb || ""}</td>
                <td style="font-size:0.75rem; color:#64748b">${d.StreetAddress || ""}</td>
                <td style="font-weight:600">${d.StarRating ? d.StarRating + " ★" : ""}</td>
                <td><div style="display:flex; gap:10px; font-size:0.9rem">
                    ${d.Website ? `<a href="${d.Website}" target="_blank" style="color:#3b82f6"><i class="fas fa-link"></i></a>` : ""}
                    ${d.FacebookURL ? `<a href="${d.FacebookURL}" target="_blank" style="color:#1877f2"><i class="fab fa-facebook"></i></a>` : ""}
                    ${d.InstagramURL ? `<a href="${d.InstagramURL}" target="_blank" style="color:#e4405f"><i class="fab fa-instagram"></i></a>` : ""}
                </div></td>
                <td class="editable-cell col-notes" contenteditable="true" onblur="window.rtrlApp.review.edit(${d._id}, 'ManualNotes', this.innerText)">${d.ManualNotes || ""}</td>
            </tr>`).join("");
  }

  const createLink = (u) => !u || typeof u !== "string" || !u.trim() || u.length > 250 ? u : { f: `HYPERLINK("${u}", "${u}")`, v: u, t: "s" };
  
  function mapToMaster(sel) {
    return sel.map((i) => ({
      BusinessName: i.BusinessName,
      Category: i.Category,
      "Suburb/Area": i.Suburb,
      StreetAddress: i.StreetAddress,
      Website: createLink(i.Website),
      OwnerName: i.OwnerName,
      "Email 1": i.Email1,
      "Email 2": i.Email2,
      "Email 3": i.Email3,
      Phone: i.Phone,
      InstagramURL: createLink(i.InstagramURL),
      FacebookURL: createLink(i.FacebookURL),
      GoogleMapsURL: createLink(i.GoogleMapsURL),
      StarRating: i.StarRating,
      ReviewCount: i.ReviewCount,
      "User Internal Notes": i.ManualNotes || ""
    }));
  }

  function exportMaster() {
    const sel = masterData.filter((d) => d._checked);
    if (!sel.length) return alert("Select leads first.");
    const ws = XLSX.utils.json_to_sheet(mapToMaster(sel));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Business List (Unique)");
    XLSX.writeFile(wb, `Refined_Full_Collection.xlsx`);
  }

  async function exportZip() {
    const sel = masterData.filter((d) => d._checked);
    if (!sel.length) return alert("Select leads first.");
    const zip = new JSZip();
    const wbFull = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbFull, XLSX.utils.json_to_sheet(mapToMaster(sel)), "Business List (Unique)");
    zip.file(`Refined_Full_DuplicatesRemoved.xlsx`, XLSX.write(wbFull, { type: "buffer", bookType: "xlsx" }));
    
    // Refined SMS List
    const sms = sel.filter((b) => b.Phone && b.Phone.startsWith("614")).map((b) => {
        let fn = "", ln = "";
        if (b.OwnerName && b.OwnerName.trim() !== "") { const p = b.OwnerName.trim().split(" "); fn = p.shift(); ln = p.join(" "); }
        return { FirstName: fn, LastName: ln, Organization: b.BusinessName || "", Email: b.Email1 || "", MobileNumber: b.Phone || "", CustomField1: b.Category || "", CustomField2: b.Suburb || "", Notes: b.ManualNotes || "" };
    });
    zip.file(`Refined_Mobile_Numbers_Only.csv`, XLSX.write({ SheetNames: ["S"], Sheets: { S: XLSX.utils.json_to_sheet(sms) } }, { type: "buffer", bookType: "csv" }));

    // Refined Email List
    const con = sel.filter((d) => d.Email1 || d.Email2 || d.Email3).map((d) => {
        let st = ""; if (d.StreetAddress) { const m = d.StreetAddress.match(/\b([A-Z]{2,3})\b(?= \d{4,})/); st = m ? m[1] : ""; }
        return { Company: d.BusinessName || "", Address_Suburb: d.Suburb || "", Address_State: st, Notes: `Refined_Search_Collection`, Category: d.Category || "", facebook: d.FacebookURL || "", instagram: d.InstagramURL || "", email_1: d.Email1 || "", email_2: d.Email2 || "", email_3: d.Email3 || "", linkedin: "", };
    });
    zip.file(`Refined_Full_DuplicatesRemoved_Emails.csv`, XLSX.write({ SheetNames: ["C"], Sheets: { C: XLSX.utils.json_to_sheet(con) } }, { type: "buffer", bookType: "csv" }));

    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Refined_Full_Collection.zip`;
    link.click();
  }

  return {
    init,
    toggle: (id) => { const item = masterData.find((d) => d._id === id); if (item) { item._checked = !item._checked; updateRowsOnly(); debouncedSave(); } },
    edit: (id, field, val) => handleCellEdit(id, field, val),
    openReview
  };
})();