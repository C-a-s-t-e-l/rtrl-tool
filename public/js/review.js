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
        
        currentJobId = idArray.length === 1 ? idArray[0] : 'Merged_Collection';
        
        processData(data.results || [], []);
        renderModal();
    } catch (err) { 
        console.error(err);
        alert("Failed to load review workspace."); 
    } finally {
        document.body.style.cursor = 'default';
    }
  }

  const getSocialIdentifier = (url) => {
    if (!url) return null;
    try {
      const path = new URL(url).pathname;
      const parts = path.split('/').filter(p => p && !['p', 'pages', 'groups', 'company'].includes(p.toLowerCase()));
      return parts.length > 0 ? parts[0].toLowerCase() : null;
    } catch (e) { return null; }
  };

  const getCleanBusinessName = (name) => {
    if (!name) return '';
    return name.toLowerCase()
      .replace(/\s(pizza|fast food|burger|cafe|restaurant|store|ltd|pty|inc|co)\.?\s*$/g, '')
      .replace(/\s\s+/g, ' ')
      .trim()
      .substring(0, 15);
  };

  function getExportBaseName() {
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    let label = "Collection";

 
    const jobCard = document.getElementById(`job-card-${currentJobId}`);
    if (jobCard) {
      const titleText = jobCard.querySelector('.job-title')?.textContent || "";
      label = titleText.replace('Search: ', '')
                       .replace(/["']/g, '')
                       .replace(/[\s/]/g, '_')
                       .toLowerCase();
    } else if (Array.isArray(currentJobId) || currentJobId === 'Merged_Collection') {
      label = "Merged_Leads";
    }

    return `Refined_${date}_rtrl_${label}`;
  }

  function processData(results, exclusionList) {
    const seenSignatures = new Set();
    const norm = (s) => (s || "").toLowerCase().replace(/['’`.,()&]/g, "").replace(/\s+/g, "");
    const excl = (exclusionList || []).map((e) => norm(e));
    
    masterData = results.map((item, index) => {
      const nameNorm = norm(item.BusinessName);
      
      const facebookId = getSocialIdentifier(item.FacebookURL);
      const instagramId = getSocialIdentifier(item.InstagramURL);
      const cleanName = getCleanBusinessName(item.BusinessName);
      
      let signature = null;
      if (facebookId && instagramId) {
          signature = `SOCIAL_FB:${facebookId}_IG:${instagramId}`;
      } else if (cleanName) {
          signature = `NAME:${cleanName}_${norm(item.Suburb)}`;
      } else {
          signature = `UNIQUE_${item.GoogleMapsURL || Math.random()}`;
      }

      let status = "Active";
      if (excl.some((ex) => nameNorm.includes(ex))) {
          status = "Excluded";
      } else if (seenSignatures.has(signature)) {
          status = "Duplicate";
      }

      if (status === "Active") {
          seenSignatures.add(signature);
      }
      
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
                    
                    <div class="tooltip-wrapper">
                        <button class="btn-review-export" style="background:#10b981" id="rev-xlsx">Export List (.xlsx)</button>
                        <span class="tooltip-text">
                            <b>High-Detail Spreadsheet Export</b><br>
                            Downloads a complete Excel file including every data point, your manual corrections, and internal notes. Matches the standard format.
                        </span>
                    </div>
                    
                    <div class="tooltip-wrapper">
                        <button class="btn-review-export" id="rev-zip">Export ZIP Pack</button>
                        <span class="tooltip-text">
                            <b>Complete Lead Outreach Package</b><br>
                            Generates a ZIP folder containing:<br>
                            1. Refined Masterlist (XLSX)<br>
                            2. SMS-ready list of checked mobiles (CSV)<br>
                            3. Cleaned email-only database (CSV).
                        </span>
                    </div>
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
                    ${d.GoogleMapsURL ? `<a href="${d.GoogleMapsURL}" target="_blank" style="color:#34a853" title="Google Maps"><i class="fas fa-map-marker-alt"></i></a>` : ""}
                    ${d.Website ? `<a href="${d.Website}" target="_blank" style="color:#3b82f6" title="Website"><i class="fas fa-link"></i></a>` : ""}
                    ${d.FacebookURL ? `<a href="${d.FacebookURL}" target="_blank" style="color:#1877f2" title="Facebook"><i class="fab fa-facebook"></i></a>` : ""}
                    ${d.InstagramURL ? `<a href="${d.InstagramURL}" target="_blank" style="color:#e4405f" title="Instagram"><i class="fab fa-instagram"></i></a>` : ""}
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
    const fileName = `${getExportBaseName()}_Full.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

async function exportZip() {
    const activeLeads = masterData.filter((d) => d._checked);
    const duplicateLeads = masterData.filter((d) => d._reviewStatus === "Duplicate");
    
    if (activeLeads.length === 0) return alert("Select leads first.");

    const baseName = getExportBaseName();
    const zip = new JSZip();
    const SPLIT_SIZE = 18;

    // 1. FULL UNIQUE LIST (XLSX)
    const wbFull = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbFull, XLSX.utils.json_to_sheet(mapToMaster(activeLeads)), "Business List");
    zip.file(`${baseName}_Full_DuplicatesRemoved.xlsx`, XLSX.write(wbFull, { type: "buffer", bookType: "xlsx" }));

    // 2. DUPLICATES LIST (XLSX)
    if (duplicateLeads.length > 0) {
        const wbDup = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wbDup, XLSX.utils.json_to_sheet(mapToMaster(duplicateLeads)), "Duplicates");
        zip.file(`${baseName}_Duplicates.xlsx`, XLSX.write(wbDup, { type: "buffer", bookType: "xlsx" }));
    }

    // 3. FULL SMS LIST (CSV)
    const smsItems = activeLeads.filter((b) => b.Phone && (b.Phone.startsWith("614") || b.Phone.startsWith("04"))).map((b) => {
        let fn = "", ln = "";
        if (b.OwnerName && b.OwnerName.trim() !== "") { const p = b.OwnerName.trim().split(" "); fn = p.shift(); ln = p.join(" "); }
        return { FirstName: fn, LastName: ln, Organization: b.BusinessName || "", Email: b.Email1 || "", MobileNumber: b.Phone || "", Category: b.Category || "", Suburb: b.Suburb || "", Notes: b.ManualNotes || "" };
    });
    if (smsItems.length > 0) {
        zip.file(`${baseName}_Mobile_Numbers_Only.csv`, XLSX.write({ SheetNames: ["S"], Sheets: { S: XLSX.utils.json_to_sheet(smsItems) } }, { type: "buffer", bookType: "csv" }));
    }

    // 4. FULL EMAILS LIST (CSV)
    const contactsData = activeLeads.filter(d => d.Email1 || d.Email2 || d.Email3).map(d => {
        let state = '';
        if (d.StreetAddress) {
            const stateMatch = d.StreetAddress.match(/\b([A-Z]{2,3})\b(?= \d{4,})/);
            state = stateMatch ? stateMatch[1] : '';
        }
        return { "Company": d.BusinessName || '', "Address_Suburb": d.Suburb || '', "Address_State": state, "Category": d.Category || '', "email_1": d.Email1 || '', "email_2": d.Email2 || '', "email_3": d.Email3 || '', "facebook": d.FacebookURL || '', "instagram": d.InstagramURL || '', "Notes": d.ManualNotes || "" };
    });
    if (contactsData.length > 0) {
        zip.file(`${baseName}_Full_DuplicatesRemoved_Emails.csv`, XLSX.write({ SheetNames: ["E"], Sheets: { E: XLSX.utils.json_to_sheet(contactsData) } }, { type: "buffer", bookType: "csv" }));
    }

    // 5. CONSOLIDATED EMAILS (TXT)
    const allEmailsSet = new Set();
    activeLeads.forEach(i => {
        if (i.Email1) allEmailsSet.add(i.Email1.toLowerCase().trim());
        if (i.Email2) allEmailsSet.add(i.Email2.toLowerCase().trim());
        if (i.Email3) allEmailsSet.add(i.Email3.toLowerCase().trim());
    });
    if (allEmailsSet.size > 0) {
        zip.file(`${baseName}_All_Emails_Consolidated.txt`, Array.from(allEmailsSet).join('\n'));
    }

    // 6. MOBILE TXT SPLITS (BY CATEGORY)
    const mobilesByCategory = activeLeads.reduce((acc, item) => {
        if (item.Phone) {
            let num = String(item.Phone).replace(/\D/g, '');
            if (num.startsWith('614')) num = '0' + num.substring(2);
            if (num.startsWith('04')) {
                const cat = item.Category || 'General';
                if (!acc[cat]) acc[cat] = new Set();
                acc[cat].add(num);
            }
        }
        return acc;
    }, {});

    for (const [cat, nums] of Object.entries(mobilesByCategory)) {
        const cleanCat = cat.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase();
        zip.file(`mobile_splits/${cleanCat}_mobiles.txt`, Array.from(nums).join('\n'));
    }

    // 7. CSV & TXT SPLITS (CHUNKED BY 18)
    if (contactsData.length > 0) {
        for (let i = 0; i < contactsData.length; i += SPLIT_SIZE) {
            const chunk = contactsData.slice(i, i + SPLIT_SIZE);
            const part = Math.floor(i / SPLIT_SIZE) + 1;
            zip.file(`email_csv_splits/${baseName}_emails_part_${part}.csv`, XLSX.write({ SheetNames: ["E"], Sheets: { E: XLSX.utils.json_to_sheet(chunk) } }, { type: "buffer", bookType: "csv" }));
        }

        const contactsByCategory = contactsData.filter(d => d.email_1).reduce((acc, item) => {
            const cat = item.Category || 'Other';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(item);
            return acc;
        }, {});

        for (const [cat, items] of Object.entries(contactsByCategory)) {
            for (let i = 0; i < items.length; i += SPLIT_SIZE) {
                const chunk = items.slice(i, i + SPLIT_SIZE);
                const part = Math.floor(i / SPLIT_SIZE) + 1;
                const cleanCat = cat.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase();
                zip.file(`email_txt_splits/${cleanCat}_part_${part}.txt`, chunk.map(item => item.email_1).join('\n'));
            }
        }
    }

    // FINAL DOWNLOAD
    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${baseName}_Package.zip`;
    link.click();
  }
  return {
    init,
    toggle: (id) => { const item = masterData.find((d) => d._id === id); if (item) { item._checked = !item._checked; updateRowsOnly(); debouncedSave(); } },
    edit: (id, field, val) => handleCellEdit(id, field, val),
    openReview
  };
})();