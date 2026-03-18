window.rtrlApp.review = (function() {
    let masterData = [];
    let filteredData = [];
    let currentJobId = null;
    let jobParams = {};

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
                                btn.style.borderColor = '#bae6fd';
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
            const { data, error } = await sbClient
                .from('jobs').select('results, parameters').eq('id', jobId).single();

            if (error || !data) throw new Error("Could not fetch job data");

            jobParams = data.parameters || {};
            processData(data.results || [], jobParams.exclusionList || []);
            renderModal();
        } catch (err) {
            console.error("Review Error:", err);
            alert("Failed to load data for review.");
        }
    }

    function processData(results, exclusionList) {
        const seen = new Set();
        const norm = (s) => (s || "").toLowerCase().replace(/['’`.,()&]/g, "").replace(/\s+/g, "");
        const excl = (exclusionList || []).map(e => norm(e));

        masterData = results.map((item, index) => {
            const name = norm(item.BusinessName);
            const fb = item.FacebookURL?.split('/').filter(p => p && !['p','pages','groups','company'].includes(p.toLowerCase())).pop()?.toLowerCase();
            const ig = item.InstagramURL?.split('/').filter(p => p).pop()?.toLowerCase();
            const signature = fb && ig ? `SOC:${fb}_${ig}` : `NAME:${name.substring(0,15)}`;
            
            let status = "Active";
            if (excl.some(ex => name.includes(ex))) status = "Excluded";
            else if (seen.has(signature)) status = "Duplicate";
            if (status === "Active") seen.add(signature);

            return { ...item, _id: index, _reviewStatus: status, _checked: status === "Active" };
        });
        filteredData = [...masterData];
    }

    function renderModal() {
        if (document.getElementById('review-modal')) document.getElementById('review-modal').remove();

        const s = jobParams.searchParamsForEmail || {};
        const title = `${s.customCategory || s.primaryCategory || "Search"} in ${s.area || "Area"}${jobParams.radiusKm ? ` (${jobParams.radiusKm}km)` : ""}`;
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
                    <div style="flex: 1"><h3 style="margin:0; font-size: 1.1rem; color: #1e293b;">${title}</h3>
                        <div class="review-summary" style="margin-top:8px">
                            <span class="sum-pill sum-active">${counts.active} Unique</span>
                            <span class="sum-pill sum-dup">${counts.dup} Duplicates</span>
                            <span class="sum-pill sum-excl">${counts.excl} Excluded</span>
                        </div>
                    </div>
                    <div class="review-controls">
                        <input type="text" class="review-search" placeholder="Quick filter..." id="rev-search">
                        <button class="btn-review-close" id="rev-only-active" style="white-space:nowrap; background:#fff; border:1px solid #cbd5e1;">Reset to Active Only</button>
                    </div>
                </div>
                <div class="review-table-container">
                    <table class="review-table">
                        <thead><tr><th><input type="checkbox" id="rev-master-check" checked></th><th>Status</th><th>Name</th><th>Category</th><th>Address</th><th>Phone</th><th>Email</th><th>Links</th></tr></thead>
                        <tbody id="rev-body"></tbody>
                    </table>
                </div>
                <div class="review-footer">
                    <button class="btn-review-close" onclick="document.getElementById('review-modal').remove()">Cancel</button>
                    
                    <div class="tooltip-wrapper">
                        <button class="btn-review-export" style="background:#10b981" id="rev-export-xlsx">Download Refined Excel</button>
                        <span class="tooltip-text">Saves a complete Excel file containing all data for your selected leads.</span>
                    </div>

                    <div class="tooltip-wrapper">
                        <button class="btn-review-export" id="rev-export-csv">Download Refined CSV</button>
                        <span class="tooltip-text">Saves a lightweight CSV file of selected leads, perfect for dialers or SMS tools.</span>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        updateTable();

        document.getElementById('rev-search').oninput = (e) => {
            const term = e.target.value.toLowerCase();
            filteredData = masterData.filter(d => (d.BusinessName||"").toLowerCase().includes(term) || (d.StreetAddress||"").toLowerCase().includes(term) || (d.Category||"").toLowerCase().includes(term));
            updateTable();
        };
        document.getElementById('rev-master-check').onclick = (e) => { filteredData.forEach(d => d._checked = e.target.checked); updateTable(); };
        document.getElementById('rev-only-active').onclick = () => { masterData.forEach(d => d._checked = d._reviewStatus === 'Active'); updateTable(); };
        
        document.getElementById('rev-export-xlsx').onclick = () => handleExport('xlsx');
        document.getElementById('rev-export-csv').onclick = () => handleExport('csv');
    }

    function updateTable() {
        document.getElementById('rev-body').innerHTML = filteredData.map((d) => `
            <tr class="row-${d._reviewStatus.toLowerCase()}">
                <td><input type="checkbox" ${d._checked ? 'checked' : ''} onchange="window.rtrlApp.review.toggle(${d._id})"></td>
                <td><span class="status-badge badge-${d._reviewStatus.toLowerCase()}">${d._reviewStatus}</span></td>
                <td style="font-weight:600; color:#1e293b;">${d.BusinessName}</td>
                <td style="color:#64748b; font-size:0.8rem;">${d.Category}</td>
                <td style="font-size:0.8rem; color:#475569;">${d.StreetAddress || 'N/A'}</td>
                <td>${d.Phone || ''}</td>
                <td title="${d.Email1}">${d.Email1 ? d.Email1.substring(0,12)+'...' : ''}</td>
                <td><div style="display:flex;gap:10px">
                    ${d.Website ? `<a href="${d.Website}" target="_blank" style="color:#3b82f6"><i class="fas fa-external-link-alt"></i></a>` : ''}
                    ${d.FacebookURL ? `<a href="${d.FacebookURL}" target="_blank" style="color:#1877f2"><i class="fab fa-facebook"></i></a>` : ''}
                </div></td>
            </tr>`).join('');
    }

    function handleExport(type) {
        const selected = masterData.filter(d => d._checked);
        if (selected.length === 0) return alert("Select at least one business.");

        const cleanData = selected.map(d => ({
            BusinessName: d.BusinessName,
            Category: d.Category,
            Suburb: d.Suburb,
            StreetAddress: d.StreetAddress,
            Website: d.Website,
            Phone: d.Phone,
            Email1: d.Email1,
            Email2: d.Email2,
            Email3: d.Email3,
            Facebook: d.FacebookURL,
            Instagram: d.InstagramURL,
            Rating: d.StarRating,
            Reviews: d.ReviewCount
        }));

        const ws = XLSX.utils.json_to_sheet(cleanData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Refined Leads");

        const fileName = `Refined_Leads_${currentJobId}.${type}`;
        if (type === 'xlsx') XLSX.writeFile(wb, fileName);
        else XLSX.writeFile(wb, fileName, { bookType: 'csv' });
        
        document.getElementById('review-modal').remove();
    }

    return {
        init,
        toggle: (id) => { const item = masterData.find(d => d._id === id); if (item) item._checked = !item._checked; }
    };
})();
document.addEventListener('DOMContentLoaded', () => window.rtrlApp.review.init());