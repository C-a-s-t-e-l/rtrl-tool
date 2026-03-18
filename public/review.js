window.rtrlApp.review = (function() {
    let masterData = [];
    let filteredData = [];
    let currentJobId = null;
    let jobParams = {};
    let saveTimeout = null;

    function init() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        const containers = node.querySelectorAll('.action-buttons-container');
                        containers.forEach(container => {
                            if (!container.querySelector('.btn-review-trigger')) {
                                const resendBtn = container.querySelector('.resend-email-btn');
                                if (!resendBtn) return;
                                const jobId = resendBtn.dataset.jobId;
                                const btn = document.createElement('button');
                                btn.className = 'job-action-btn btn-review-trigger';
                                btn.style.backgroundColor = '#f0f9ff';
                                btn.innerHTML = `<i class="fas fa-list-check"></i> Review & Filter`;
                                btn.onclick = () => openReview(jobId);
                                container.appendChild(btn);
                            }
                        });
                    }
                });
            });
        });
        const list = document.getElementById('job-list-container');
        if (list) observer.observe(list, { childList: true, subtree: true });
    }

    async function openReview(jobId) {
        currentJobId = jobId;
        try {
            const sbClient = supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY);
            const { data, error } = await sbClient.from('jobs').select('results, parameters').eq('id', jobId).single();
            if (error || !data) throw new Error("Fetch failed");

            jobParams = data.parameters || {};
            processData(data.results || [], jobParams.exclusionList || []);
            renderModal();
        } catch (err) { alert("Failed to load review workspace."); }
    }

    function processData(results, exclusionList) {
        const seen = new Set();
        const norm = (s) => (s || "").toLowerCase().replace(/['’`.,()&]/g, "").replace(/\s+/g, "");
        const excl = (exclusionList || []).map(e => norm(e));

        masterData = results.map((item, index) => {
            const name = norm(item.BusinessName);
            const signature = `NAME:${name.substring(0,15)}_${norm(item.StreetAddress)}`;
            let status = "Active";
            if (excl.some(ex => name.includes(ex))) status = "Excluded";
            else if (seen.has(signature)) status = "Duplicate";
            if (status === "Active") seen.add(signature);

            const isChecked = (item._selected !== undefined) ? item._selected : (status === "Active");
            return { ...item, _id: index, _reviewStatus: status, _checked: isChecked };
        });
        filteredData = [...masterData];
    }

    async function saveProgress() {
        const indicator = document.getElementById('rev-save-indicator');
        if (indicator) {
            indicator.innerHTML = '<i class="fas fa-sync fa-spin"></i> Saving changes...';
            indicator.classList.add('visible');
        }
        const resultsToSave = masterData.map(item => {
            const { _id, _reviewStatus, _checked, ...cleanItem } = item;
            return { ...cleanItem, _selected: _checked };
        });
        const sbClient = supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY);
        await sbClient.from('jobs').update({ results: resultsToSave }).eq('id', currentJobId);
        setTimeout(() => {
            if (indicator) indicator.innerHTML = '<i class="fas fa-check"></i> Changes saved';
        }, 500);
    }

    function debouncedSave() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveProgress, 1200);
    }

    function updateCounters() {
        const selectedCount = masterData.filter(d => d._checked).length;
        const el = document.getElementById('rev-selection-count');
        if (el) el.textContent = `${selectedCount} SELECTED FOR EXPORT`;
    }

    function renderModal() {
        if (document.getElementById('review-modal')) document.getElementById('review-modal').remove();
        const s = jobParams.searchParamsForEmail || {};
        const title = `${s.customCategory || s.primaryCategory || "Search"} in ${s.area || "Area"}${jobParams.radiusKm ? ` (${jobParams.radiusKm}km Radius)` : ""}`;
        const counts = {
            active: masterData.filter(d => d._reviewStatus === 'Active').length,
            dup: masterData.filter(d => d._reviewStatus === 'Duplicate').length,
            excl: masterData.filter(d => d._reviewStatus === 'Excluded').length
        };

        const overlay = document.createElement('div');
        overlay.className = 'review-overlay';
        overlay.id = 'review-modal';
        overlay.innerHTML = `
            <div class="review-window">
                <div class="review-header">
                    <div style="flex: 1">
                        <h3 style="margin:0; font-size: 1.1rem; color: #1e293b;">${title}</h3>
                        <div class="review-summary">
                            <span id="rev-selection-count" class="sum-pill sum-active" style="background:#e0f2fe; color:#0369a1; border: 1px solid #bae6fd;">0 SELECTED</span>
                            <span class="sum-pill sum-active">${counts.active} Unique</span>
                            <span class="sum-pill sum-dup">${counts.dup} Duplicates</span>
                            <span class="sum-pill sum-excl">${counts.excl} Excluded</span>
                        </div>
                    </div>
                    <div class="review-controls">
                        <input type="text" class="review-search" placeholder="Search/Filter by name, address or category..." id="rev-search">
                        <button class="btn-review-close" id="rev-only-active" style="background:#fff; border:1px solid #cbd5e1; white-space: nowrap; padding: 10px 25px;">Reset to Active Only</button>
                    </div>
                </div>
                <div class="review-table-container">
                    <table class="review-table">
                        <thead>
                            <tr>
                                <th style="width:40px"><input type="checkbox" id="rev-master-check"></th>
                                <th style="width:100px">Status</th>
                                <th style="width:220px">Business Name</th>
                                <th style="width:140px">Category</th>
                                <th style="width:250px">Address</th>
                                <th style="width:150px">Email</th>
                                <th style="width:120px">Phone</th>
                                <th style="width:100px">Links</th>
                            </tr>
                        </thead>
                        <tbody id="rev-body"></tbody>
                    </table>
                </div>
                <div class="review-footer">
                    <div id="rev-save-indicator" class="save-indicator"></div>
                    <button class="btn-review-close" onclick="document.getElementById('review-modal').remove()">Close Workspace</button>
                    <div class="tooltip-wrapper">
                        <button class="btn-review-export" style="background:#10b981" id="rev-export-xlsx">Refined Masterlist (.xlsx)</button>
                        <span class="tooltip-text">Downloads a high-detail Excel file matching the 'Full_DuplicatesRemoved' format.</span>
                    </div>
                    <div class="tooltip-wrapper">
                        <button class="btn-review-export" id="rev-export-zip">Refined Full File (.zip)</button>
                        <span class="tooltip-text">Generates a ZIP containing the cleaned Masterlist, SMS CSV, and Email list.</span>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        updateTable();
        updateCounters();

        document.getElementById('rev-search').oninput = (e) => {
            const term = e.target.value.toLowerCase();
            filteredData = masterData.filter(d => (d.BusinessName||"").toLowerCase().includes(term) || (d.StreetAddress||"").toLowerCase().includes(term) || (d.Category||"").toLowerCase().includes(term));
            updateTable();
        };
        document.getElementById('rev-master-check').onclick = (e) => { filteredData.forEach(d => d._checked = e.target.checked); updateTable(); updateCounters(); debouncedSave(); };
        document.getElementById('rev-only-active').onclick = () => { masterData.forEach(d => d._checked = d._reviewStatus === 'Active'); updateTable(); updateCounters(); debouncedSave(); };
        document.getElementById('rev-export-xlsx').onclick = () => exportMasterXLSX();
        document.getElementById('rev-export-zip').onclick = () => exportRefinedZip();
    }

    function updateTable() {
        document.getElementById('rev-body').innerHTML = filteredData.map((d) => `
            <tr class="row-${d._reviewStatus.toLowerCase()}">
                <td><input type="checkbox" ${d._checked ? 'checked' : ''} onchange="window.rtrlApp.review.toggle(${d._id})"></td>
                <td><span class="status-badge badge-${d._reviewStatus.toLowerCase()}">${d._reviewStatus}</span></td>
                <td style="font-weight:600; color:#1e293b">${d.BusinessName}</td>
                <td style="color:#64748b; font-size:0.75rem">${d.Category}</td>
                <td style="font-size:0.75rem; color:#475569">${d.StreetAddress || ''}</td>
                <td style="font-size:0.8rem; color:#3b82f6" title="${d.Email1}">${d.Email1 ? d.Email1.substring(0,18)+'...' : ''}</td>
                <td style="font-size:0.85rem">${d.Phone || ''}</td>
                <td><div style="display:flex; gap:12px; font-size: 1rem">
                    ${d.Website ? `<a href="${d.Website}" target="_blank" style="color:#64748b"><i class="fas fa-link"></i></a>` : ''}
                    ${d.FacebookURL ? `<a href="${d.FacebookURL}" target="_blank" style="color:#1877f2"><i class="fab fa-facebook"></i></a>` : ''}
                    ${d.InstagramURL ? `<a href="${d.InstagramURL}" target="_blank" style="color:#e4405f"><i class="fab fa-instagram"></i></a>` : ''}
                </div></td>
            </tr>`).join('');
    }

    const createLink = (url) => {
        if (!url || typeof url !== 'string' || !url.trim()) return '';
        if (url.length > 250) return url;
        return { f: `HYPERLINK("${url}", "${url}")`, v: url, t: 's' };
    };

    function mapToMaster(selected) {
        return selected.map(item => ({
            "BusinessName": item.BusinessName,
            "Category": item.Category,
            "Suburb/Area": item.Suburb,
            "StreetAddress": item.StreetAddress,
            "Website": createLink(item.Website),
            "OwnerName": item.OwnerName,
            "Email 1": item.Email1,
            "Email 2": item.Email2,
            "Email 3": item.Email3,
            "Phone": item.Phone,
            "InstagramURL": createLink(item.InstagramURL),
            "FacebookURL": createLink(item.FacebookURL),
            "GoogleMapsURL": createLink(item.GoogleMapsURL),
            "StarRating": item.StarRating,
            "ReviewCount": item.ReviewCount
        }));
    }

    function exportMasterXLSX() {
        const selected = masterData.filter(d => d._checked);
        if (!selected.length) return alert("Select leads first.");
        const formatted = mapToMaster(selected);
        const ws = XLSX.utils.json_to_sheet(formatted);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Business List (Unique)");
        XLSX.writeFile(wb, `Refined_Full_DuplicatesRemoved_${currentJobId}.xlsx`);
    }

    async function exportRefinedZip() {
        const selected = masterData.filter(d => d._checked);
        if (!selected.length) return alert("Select leads first.");
        const zip = new JSZip();

        // 1. Refined Master
        const formattedMaster = mapToMaster(selected);
        const wsFull = XLSX.utils.json_to_sheet(formattedMaster);
        const wbFull = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wbFull, wsFull, "Business List (Unique)");
        zip.file(`Refined_Full_DuplicatesRemoved_${currentJobId}.xlsx`, XLSX.write(wbFull, {type:'buffer', bookType:'xlsx'}));

        // 2. Refined SMS CSV
        const smsData = selected.filter(b => b.Phone && b.Phone.startsWith("614")).map(b => {
            let firstName = "", lastName = "";
            if (b.OwnerName && b.OwnerName.trim() !== "") {
                const parts = b.OwnerName.trim().split(" ");
                firstName = parts.shift();
                lastName = parts.join(" ");
            }
            return {
                FirstName: firstName, LastName: lastName, Organization: b.BusinessName || "",
                Email: b.Email1 || "", FaxNumber: "", MobileNumber: b.Phone || "",
                CustomField1: b.Category || "", CustomField2: b.Suburb || "",
                CustomField3: "", CustomField4: "", Unsubscribed: ""
            };
        });
        const wsSms = XLSX.utils.json_to_sheet(smsData, { header: ["FirstName", "LastName", "Organization", "Email", "FaxNumber", "MobileNumber", "CustomField1", "CustomField2", "CustomField3", "CustomField4", "Unsubscribed"] });
        zip.file(`Refined_Mobile_Numbers_Only_${currentJobId}.csv`, XLSX.write({SheetNames:["S"], Sheets:{S:wsSms}}, {type:'buffer', bookType:'csv'}));

        // 3. Refined Contacts CSV
        const contactsData = selected.filter(d => d.Email1 || d.Email2 || d.Email3).map(d => {
            let state = '';
            if (d.StreetAddress) {
                const match = d.StreetAddress.match(/\b([A-Z]{2,3})\b(?= \d{4,})/);
                state = match ? match[1] : '';
            }
            return {
                "Company": d.BusinessName || '', "Address_Suburb": d.Suburb || '', "Address_State": state,
                "Notes": `Refined_Search_${currentJobId}`, "Category": d.Category || '',
                "email_1": d.Email1 || '', "email_2": d.Email2 || '', "email_3": d.Email3 || '',
                "facebook": d.FacebookURL || '', "instagram": d.InstagramURL || '', "linkedin": '',
            };
        });
        const wsContacts = XLSX.utils.json_to_sheet(contactsData, { header: ["Company", "Address_Suburb", "Address_State", "Notes", "Category", "facebook", "instagram", "linkedin", "email_1", "email_2", "email_3"] });
        zip.file(`Refined_Full_DuplicatesRemoved_Emails_${currentJobId}.csv`, XLSX.write({SheetNames:["C"], Sheets:{C:wsContacts}}, {type:'buffer', bookType:'csv'}));

        const content = await zip.generateAsync({type:"blob"});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `Refined_Full_Collection_${currentJobId}.zip`;
        link.click();
    }

    return {
        init,
        toggle: (id) => { 
            const item = masterData.find(d => d._id === id); 
            if (item) {
                item._checked = !item._checked; 
                updateCounters();
                debouncedSave();
            }
        }
    };
})();
document.addEventListener('DOMContentLoaded', () => window.rtrlApp.review.init());