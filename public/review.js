window.rtrlApp.review = (function () {
  let masterData = [];
  let filteredData = [];
  let currentJobId = null;
  let jobParams = {};
  let saveTimeout = null;
  let currentSort = { key: "BusinessName", dir: "asc" };
  let activeFilters = {
    search: "",
    contact: "all",
    rating: 0,
    ownerType: "all",
  };

    let sharedSbClient = null;
  function getSbClient() {
      if (!sharedSbClient) {
          sharedSbClient = supabase.createClient(
              window.CONFIG.SUPABASE_URL,
              window.CONFIG.SUPABASE_ANON_KEY
          );
      }
      return sharedSbClient;
  }

  function init() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            const containers = node.querySelectorAll(
              ".action-buttons-container",
            );
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

  async function openReview(jobId) {
    currentJobId = jobId;
    try {

      const sbClient = getSbClient();

      const { data, error } = await sbClient
        .from("jobs")
        .select("results, parameters")
        .eq("id", jobId)
        .single();
      if (error || !data) throw new Error("Fetch failed");
      jobParams = data.parameters || {};
      processData(data.results || [], jobParams.exclusionList || []);
      renderModal();
    } catch (err) {
      alert("Failed to load review workspace.");
    }
  }

  function processData(results, exclusionList) {
    const seen = new Set();
    const norm = (s) =>
      (s || "")
        .toLowerCase()
        .replace(/['’`.,()&]/g, "")
        .replace(/\s+/g, "");
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
        _checked:
          item._selected !== undefined ? item._selected : status === "Active",
      };
    });
    masterData.sort((a, b) =>
      (a.BusinessName || "").localeCompare(b.BusinessName || ""),
    );
    applyFiltersAndSort();
  }

  function applyFiltersAndSort() {
    let data = [...masterData];
    if (activeFilters.search) {
      const s = activeFilters.search.toLowerCase();
      data = data.filter(
        (d) =>
          (d.BusinessName || "").toLowerCase().includes(s) ||
          (d.StreetAddress || "").toLowerCase().includes(s) ||
          (d.Category || "").toLowerCase().includes(s) ||
          (d.Suburb || "").toLowerCase().includes(s),
      );
    }
    if (activeFilters.contact === "mobile")
      data = data.filter(
        (d) =>
          (d.Phone || "").startsWith("614") || (d.Phone || "").startsWith("04"),
      );
    else if (activeFilters.contact === "email")
      data = data.filter((d) => d.Email1);
    else if (activeFilters.contact === "both")
      data = data.filter(
        (d) =>
          d.Email1 &&
          ((d.Phone || "").startsWith("614") ||
            (d.Phone || "").startsWith("04")),
      );
    if (activeFilters.rating > 0)
      data = data.filter(
        (d) => parseFloat(d.StarRating || 0) >= activeFilters.rating,
      );
    if (activeFilters.ownerType !== "all") {
      data = data.filter((d) => {
        const name = (d.OwnerName || "").toLowerCase();
        if (activeFilters.ownerType === "private")
          return name === "private owner" || !name;
        const isEntity =
          name.includes("pty") ||
          name.includes("ltd") ||
          name.includes("inc") ||
          name.includes("corp");
        if (activeFilters.ownerType === "entity")
          return isEntity && name !== "private owner";
        if (activeFilters.ownerType === "human")
          return !isEntity && name !== "private owner" && name.length > 2;
        return true;
      });
    }
    const k = currentSort.key;
    const d = currentSort.dir === "asc" ? 1 : -1;
    data.sort((a, b) => {
      let valA = a[k] || "",
        valB = b[k] || "";
      if (k === "StarRating" || k === "ReviewCount") {
        valA = parseFloat(valA) || 0;
        valB = parseFloat(valB) || 0;
      }
      return valA > valB ? 1 * d : valA < valB ? -1 * d : 0;
    });
    filteredData = data;
  }

  async function saveProgress() {
    const ind = document.getElementById("rev-save-indicator");
    if (ind) {
      ind.innerHTML = '<i class="fas fa-sync fa-spin"></i> Saving changes...';
      ind.classList.add("visible");
    }
    const res = masterData.map((item) => {
      const { _id, _reviewStatus, _checked, ...clean } = item;
      return { ...clean, _selected: _checked };
    });
    
    const sbClient = getSbClient();

    await sbClient.from("jobs").update({ results: res }).eq("id", currentJobId);
    setTimeout(() => {
      if (ind) ind.innerHTML = '<i class="fas fa-check"></i> Changes saved';
    }, 500);
  }

  function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveProgress, 1200);
  }

  function renderModal() {
    if (document.getElementById("review-modal"))
      document.getElementById("review-modal").remove();
    const s = jobParams.searchParamsForEmail || {};
    const title =
      `${s.customCategory || s.primaryCategory || "Search"} in ${s.area || "Area"}${jobParams.radiusKm ? ` (${jobParams.radiusKm}km Radius)` : ""}`.replace(
        /"/g,
        "",
      );
    const overlay = document.createElement("div");
    overlay.className = "review-overlay";
    overlay.id = "review-modal";
    overlay.innerHTML = `
            <div class="review-window">
                <div class="review-header">
                    <div class="header-top-row"><h3 style="margin:0; font-size:1.2rem; color:#1e293b; font-weight:800;">${title}</h3></div>
                    <div class="header-bottom-row">
                        <div class="review-summary">
                            <span id="rev-sel-count" class="sum-pill" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;">0 SELECTED</span>
                            <span class="sum-pill sum-active">${masterData.filter((d) => d._reviewStatus === "Active").length} Unique</span>
                            <span class="sum-pill sum-dup">${masterData.filter((d) => d._reviewStatus === "Duplicate").length} Duplicates</span>
                            <span class="sum-pill sum-excl">${masterData.filter((d) => d._reviewStatus === "Excluded").length} Excluded</span>
                        </div>
                        <div class="review-search-wrapper">
                            <input type="text" class="review-search" placeholder="Search/Filter by name, category, suburb..." id="rev-search" value="${activeFilters.search}">
                            <button class="btn-review-close" id="rev-only-active" style="white-space:nowrap; padding:8px 20px;">Reset to Active Only</button>
                        </div>
                    </div>
                </div>
                <div class="review-toolbar">
                    <div class="filter-group-inline">
                        <span class="filter-label">Contact:</span>
                        <button class="filter-pill ${activeFilters.contact === "all" ? "active" : ""}" data-type="contact" data-val="all">All</button>
                        <button class="filter-pill ${activeFilters.contact === "mobile" ? "active" : ""}" data-type="contact" data-val="mobile">Mobiles Only</button>
                        <button class="filter-pill ${activeFilters.contact === "email" ? "active" : ""}" data-type="contact" data-val="email">Emails Only</button>
                        <button class="filter-pill ${activeFilters.contact === "both" ? "active" : ""}" data-type="contact" data-val="both">Mobiles + Emails</button>
                    </div>
                    <div style="width:1px; height:20px; background:#e2e8f0;"></div>
                    <div class="filter-group-inline">
                        <span class="filter-label">Min Rating:</span>
                        <select class="filter-select" id="rev-filter-rating">
                            <option value="0">Any Rating</option>
                            ${[4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map((v) => `<option value="${v}" ${activeFilters.rating === v ? "selected" : ""}>${v}+ Stars</option>`).join("")}
                        </select>
                    </div>
                    <div style="width:1px; height:20px; background:#e2e8f0;"></div>
                    <div class="filter-group-inline">
                        <span class="filter-label">Owner Info:</span>
                        <select class="filter-select" id="rev-filter-owner">
                            <option value="all">Any Record</option>
                            <option value="human">Person's Name Found</option>
                            <option value="entity">Company/Entity Name</option>
                            <option value="private">Private/Missing</option>
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
                            <th style="width:160px" data-sort="Category"><div class="header-content">Category <i class="fas fa-sort"></i></div></th>
                            <th style="width:140px" data-sort="Suburb"><div class="header-content">Suburb <i class="fas fa-sort"></i></div></th>
                            <th style="width:300px">Street Address</th>
                            <th style="width:180px">Email 1</th>
                            <th style="width:180px">Email 2</th>
                            <th style="width:120px">Phone</th>
                            <th style="width:100px" data-sort="StarRating"><div class="header-content">Rating <i class="fas fa-sort"></i></div></th>
                            <th style="width:100px" data-sort="ReviewCount"><div class="header-content">Reviews <i class="fas fa-sort"></i></div></th>
                            <th style="width:120px">Links</th>
                        </tr></thead>
                        <tbody id="rev-body"></tbody>
                    </table>
                </div>
                <div class="review-footer">
                    <div id="rev-save-indicator" class="save-indicator"></div>
                    <button class="btn-review-close" onclick="document.getElementById('review-modal').remove()">Close Workspace</button>
                    <div class="tooltip-wrapper"><button class="btn-review-export" style="background:#10b981" id="rev-xlsx">Refined Masterlist (.xlsx)</button><span class="tooltip-text"><b>Full Detail Export</b>Downloads an Excel file containing every column and data point for your checked leads.</span></div>
                    <div class="tooltip-wrapper"><button class="btn-review-export" id="rev-zip">Refined Full File (.zip)</button><span class="tooltip-text"><b>Complete Lead Package</b>Generates a ZIP containing the cleaned Masterlist, SMS-ready list, and Email lists.</span></div>
                </div>
            </div>`;
    document.body.appendChild(overlay);
    refreshUI();

    document.getElementById("rev-search").oninput = (e) => {
      activeFilters.search = e.target.value;
      refreshUI();
    };
    document.getElementById("rev-filter-rating").onchange = (e) => {
      activeFilters.rating = parseFloat(e.target.value);
      refreshUI();
    };
    document.getElementById("rev-filter-owner").onchange = (e) => {
      activeFilters.ownerType = e.target.value;
      refreshUI();
    };
    document
      .querySelectorAll('.filter-pill[data-type="contact"]')
      .forEach((btn) => {
        btn.onclick = () => {
          activeFilters.contact = btn.dataset.val;
          refreshUI();
        };
      });
    document.querySelectorAll(".review-table th[data-sort]").forEach((th) => {
      th.onclick = () => {
        const key = th.dataset.sort;
        currentSort.dir =
          currentSort.key === key && currentSort.dir === "asc" ? "desc" : "asc";
        currentSort.key = key;
        refreshUI();
      };
    });
    document.getElementById("rev-master-check").onclick = (e) => {
      filteredData.forEach((d) => (d._checked = e.target.checked));
      updateRowsOnly();
      debouncedSave();
    };
    document.getElementById("rev-only-active").onclick = () => {
      masterData.forEach((d) => (d._checked = d._reviewStatus === "Active"));
      activeFilters = {
        search: "",
        contact: "all",
        rating: 0,
        ownerType: "all",
      };
      refreshUI();
      debouncedSave();
    };
    document.getElementById("rev-xlsx").onclick = exportMaster;
    document.getElementById("rev-zip").onclick = exportZip;
  }

  function refreshUI() {
    applyFiltersAndSort();
    updateRowsOnly();
    renderToolbarState();
  }
  function renderToolbarState() {
    document
      .querySelectorAll('.filter-pill[data-type="contact"]')
      .forEach((btn) => {
        btn.classList.toggle(
          "active",
          activeFilters.contact === btn.dataset.val,
        );
      });
    document.querySelectorAll(".review-table th[data-sort]").forEach((th) => {
      th.classList.toggle("sort-active", th.dataset.sort === currentSort.key);
      const icon = th.querySelector("i");
      if (th.dataset.sort === currentSort.key) {
        icon.className =
          currentSort.dir === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
      } else {
        icon.className = "fas fa-sort";
      }
    });
    document.getElementById("rev-visible-count").textContent =
      `Showing ${filteredData.length} of ${masterData.length} leads`;
  }

  function updateRowsOnly() {
    const count = masterData.filter((d) => d._checked).length;
    document.getElementById("rev-sel-count").textContent = `${count} SELECTED`;
    document.getElementById("rev-body").innerHTML = filteredData
      .map(
        (d, i) => `
            <tr class="row-${d._reviewStatus.toLowerCase()}">
                <td style="color:#94a3b8; font-size:0.7rem">${i + 1}</td>
                <td><input type="checkbox" ${d._checked ? "checked" : ""} onchange="window.rtrlApp.review.toggle(${d._id})"></td>
                <td><span class="status-badge badge-${d._reviewStatus.toLowerCase()}">${d._reviewStatus}</span></td>
                <td style="font-weight:600; color:#1e293b">${d.BusinessName}</td>
                <td style="font-weight:500; color:#475569">${d.OwnerName || ""}</td>
                <td style="color:#64748b; font-size:0.75rem">${d.Category}</td>
                <td style="font-weight:500">${d.Suburb || ""}</td>
                <td style="font-size:0.75rem; color:#64748b">${d.StreetAddress || ""}</td>
                <td style="font-size:0.8rem; color:#3b82f6">${d.Email1 || ""}</td>
                <td style="font-size:0.8rem; color:#3b82f6">${d.Email2 || ""}</td>
                <td style="font-size:0.85rem">${d.Phone || ""}</td>
                <td style="font-weight:600">${d.StarRating ? d.StarRating + " ★" : ""}</td>
                <td style="color:#64748b">${d.ReviewCount || ""}</td>
                <td><div style="display:flex; gap:10px; font-size:0.9rem">
                    ${d.Website ? `<a href="${d.Website}" target="_blank" style="color:#3b82f6"><i class="fas fa-link"></i></a>` : ""}
                    ${d.FacebookURL ? `<a href="${d.FacebookURL}" target="_blank" style="color:#1877f2"><i class="fab fa-facebook"></i></a>` : ""}
                    ${d.InstagramURL ? `<a href="${d.InstagramURL}" target="_blank" style="color:#e4405f"><i class="fab fa-instagram"></i></a>` : ""}
                </div></td>
            </tr>`,
      )
      .join("");
  }

  const createLink = (u) =>
    !u || typeof u !== "string" || !u.trim() || u.length > 250
      ? u
      : { f: `HYPERLINK("${u}", "${u}")`, v: u, t: "s" };
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
    }));
  }
  function exportMaster() {
    const sel = masterData.filter((d) => d._checked);
    if (!sel.length) return alert("Select leads first.");
    const ws = XLSX.utils.json_to_sheet(mapToMaster(sel));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Business List (Unique)");
    XLSX.writeFile(wb, `Refined_Full_DuplicatesRemoved_${currentJobId}.xlsx`);
  }
  async function exportZip() {
    const sel = masterData.filter((d) => d._checked);
    if (!sel.length) return alert("Select leads first.");
    const zip = new JSZip();
    const wsFull = XLSX.utils.json_to_sheet(mapToMaster(sel));
    const wbFull = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbFull, wsFull, "Business List (Unique)");
    zip.file(
      `Refined_Full_DuplicatesRemoved_${currentJobId}.xlsx`,
      XLSX.write(wbFull, { type: "buffer", bookType: "xlsx" }),
    );
    const sms = sel
      .filter((b) => b.Phone && b.Phone.startsWith("614"))
      .map((b) => {
        let fn = "",
          ln = "";
        if (b.OwnerName && b.OwnerName.trim() !== "") {
          const p = b.OwnerName.trim().split(" ");
          fn = p.shift();
          ln = p.join(" ");
        }
        return {
          FirstName: fn,
          LastName: ln,
          Organization: b.BusinessName || "",
          Email: b.Email1 || "",
          FaxNumber: "",
          MobileNumber: b.Phone || "",
          CustomField1: b.Category || "",
          CustomField2: b.Suburb || "",
          CustomField3: "",
          CustomField4: "",
          Unsubscribed: "",
        };
      });
    const wsS = XLSX.utils.json_to_sheet(sms, {
      header: [
        "FirstName",
        "LastName",
        "Organization",
        "Email",
        "FaxNumber",
        "MobileNumber",
        "CustomField1",
        "CustomField2",
        "CustomField3",
        "CustomField4",
        "Unsubscribed",
      ],
    });
    zip.file(
      `Refined_Mobile_Numbers_Only_${currentJobId}.csv`,
      XLSX.write(
        { SheetNames: ["S"], Sheets: { S: wsS } },
        { type: "buffer", bookType: "csv" },
      ),
    );
    const con = sel
      .filter((d) => d.Email1 || d.Email2 || d.Email3)
      .map((d) => {
        let st = "";
        if (d.StreetAddress) {
          const m = d.StreetAddress.match(/\b([A-Z]{2,3})\b(?= \d{4,})/);
          st = m ? m[1] : "";
        }
        return {
          Company: d.BusinessName || "",
          Address_Suburb: d.Suburb || "",
          Address_State: st,
          Notes: `Refined_Search_${currentJobId}`,
          Category: d.Category || "",
          email_1: d.Email1 || "",
          email_2: d.Email2 || "",
          email_3: d.Email3 || "",
          facebook: d.FacebookURL || "",
          instagram: d.InstagramURL || "",
          linkedin: "",
        };
      });
    const wsC = XLSX.utils.json_to_sheet(con, {
      header: [
        "Company",
        "Address_Suburb",
        "Address_State",
        "Notes",
        "Category",
        "facebook",
        "instagram",
        "linkedin",
        "email_1",
        "email_2",
        "email_3",
      ],
    });
    zip.file(
      `Refined_Full_DuplicatesRemoved_Emails_${currentJobId}.csv`,
      XLSX.write(
        { SheetNames: ["C"], Sheets: { C: wsC } },
        { type: "buffer", bookType: "csv" },
      ),
    );
    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Refined_Full_Collection_${currentJobId}.zip`;
    link.click();
  }

  return {
    init,
    toggle: (id) => {
      const item = masterData.find((d) => d._id === id);
      if (item) {
        item._checked = !item._checked;
        updateRowsOnly();
        debouncedSave();
      }
    },
  };
})();
document.addEventListener("DOMContentLoaded", () =>
  window.rtrlApp.review.init(),
);
