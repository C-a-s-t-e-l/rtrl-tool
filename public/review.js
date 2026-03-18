window.rtrlApp.review = (function() {
    let masterData = [];
    let filteredData = [];
    let currentJobId = null;

    function init() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        const containers = node.querySelectorAll('.action-buttons-container');
                        containers.forEach(container => {
                            if (!container.querySelector('.btn-review-trigger')) {
                                const jobId = container.querySelector('.resend-email-btn').dataset.jobId;
                                const btn = document.createElement('button');
                                btn.className = 'job-action-btn btn-review-trigger';
                                btn.style.backgroundColor = '#f8fafc';
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
        const token = window.localStorage.getItem('sb-qbktnernawpprarckvzx-auth-token');
        const parsedToken = JSON.parse(token)?.access_token;
        
        const response = await fetch(`https://backend.rtrlprospector.space/api/jobs/history?search=${jobId}`, {
            headers: { 'Authorization': `Bearer ${parsedToken}` }
        });
        const data = await response.json();
        const job = data.jobs.find(j => j.id === jobId);
        
        const results = await fetchRawResults(jobId, parsedToken);
        processData(results, job.parameters.exclusionList || []);
        renderModal();
    }

    async function fetchRawResults(jobId, token) {
        const { data, error } = await supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY)
            .from('jobs').select('results').eq('id', jobId).single();
        return data.results || [];
    }

    function processData(results, exclusionList) {
        const seen = new Set();
        const norm = (s) => (s || "").toLowerCase().replace(/['’`.,()&]/g, "").replace(/\s+/g, "");
        const excl = (exclusionList || []).map(e => norm(e));

        masterData = results.map(item => {
            const name = norm(item.BusinessName);
            const fb = item.FacebookURL?.split('/').filter(p => p && !['p','pages','groups','company'].includes(p.toLowerCase())).pop()?.toLowerCase();
            const ig = item.InstagramURL?.split('/').filter(p => p).pop()?.toLowerCase();
            const signature = fb && ig ? `SOC:${fb}_${ig}` : `NAME:${name.substring(0,15)}`;
            
            let status = "Active";
            if (excl.some(ex => name.includes(ex))) status = "Excluded";
            else if (seen.has(signature)) status = "Duplicate";
            
            if (status === "Active") seen.add(signature);

            return { ...item, _reviewStatus: status, _checked: status === "Active" };
        });
        filteredData = [...masterData];
    }

    function renderModal() {
        const overlay = document.createElement('div');
        overlay.className = 'review-overlay';
        overlay.id = 'review-modal';
        
        const counts = {
            active: masterData.filter(d => d._reviewStatus === 'Active').length,
            dup: masterData.filter(d => d._reviewStatus === 'Duplicate').length,
            excl: masterData.filter(d => d._reviewStatus === 'Excluded').length
        };

        overlay.innerHTML = `
            <div class="review-window">
                <div class="review-header">
                    <div>
                        <h3 style="margin:0">Data Quality Review</h3>
                        <div class="review-summary" style="margin-top:8px">
                            <span class="sum-pill sum-active">${counts.active} Active</span>
                            <span class="sum-pill sum-dup">${counts.dup} Duplicates</span>
                            <span class="sum-pill sum-excl">${counts.excl} Excluded</span>
                        </div>
                    </div>
                    <div class="review-controls">
                        <input type="text" class="review-search" placeholder="Search by name, suburb, or category..." id="rev-search">
                        <button class="btn-review-close" id="rev-only-active">Keep Active Only</button>
                    </div>
                </div>
                <div class="review-table-container">
                    <table class="review-table">
                        <thead>
                            <tr>
                                <th><input type="checkbox" id="rev-master-check" checked></th>
                                <th>Status</th>
                                <th>Business Name</th>
                                <th>Category</th>
                                <th>Suburb</th>
                                <th>Phone</th>
                                <th>Email</th>
                                <th>Links</th>
                            </tr>
                        </thead>
                        <tbody id="rev-body"></tbody>
                    </table>
                </div>
                <div class="review-footer">
                    <button class="btn-review-close" onclick="document.getElementById('review-modal').remove()">Cancel</button>
                    <button class="btn-review-export" id="rev-export">Export Selection</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        updateTable();

        document.getElementById('rev-search').oninput = (e) => {
            const term = e.target.value.toLowerCase();
            filteredData = masterData.filter(d => 
                d.BusinessName.toLowerCase().includes(term) || 
                d.Suburb.toLowerCase().includes(term) || 
                d.Category.toLowerCase().includes(term)
            );
            updateTable();
        };

        document.getElementById('rev-master-check').onclick = (e) => {
            filteredData.forEach(d => d._checked = e.target.checked);
            updateTable();
        };

        document.getElementById('rev-only-active').onclick = () => {
            masterData.forEach(d => d._checked = d._reviewStatus === 'Active');
            updateTable();
        };

        document.getElementById('rev-export').onclick = handleExport;
    }

    function updateTable() {
        const tbody = document.getElementById('rev-body');
        tbody.innerHTML = filteredData.map((d, i) => `
            <tr class="row-${d._reviewStatus.toLowerCase()}">
                <td><input type="checkbox" ${d._checked ? 'checked' : ''} onchange="window.rtrlApp.review.toggle(${i})"></td>
                <td><span class="status-badge badge-${d._reviewStatus.toLowerCase()}">${d._reviewStatus}</span></td>
                <td style="font-weight:600">${d.BusinessName}</td>
                <td style="color:#64748b">${d.Category}</td>
                <td>${d.Suburb}</td>
                <td>${d.Phone}</td>
                <td title="${d.Email1}">${d.Email1 ? d.Email1.substring(0,12)+'...' : ''}</td>
                <td>
                    <div style="display:flex;gap:8px">
                        ${d.Website ? `<a href="${d.Website}" target="_blank"><i class="fas fa-external-link-alt"></i></a>` : ''}
                        ${d.FacebookURL ? `<a href="${d.FacebookURL}" target="_blank" style="color:#1877f2"><i class="fab fa-facebook"></i></a>` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
    }

    async function handleExport() {
        const selected = masterData.filter(d => d._checked);
        if (selected.length === 0) return alert("Select at least one business.");
        
        const btn = document.getElementById('rev-export');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        btn.disabled = true;

        const response = await fetch(`https://backend.rtrlprospector.space/api/jobs/history?search=${currentJobId}`, {
            headers: { 'Authorization': `Bearer ${JSON.parse(window.localStorage.getItem('sb-qbktnernawpprarckvzx-auth-token')).access_token}` }
        });
        const jobData = await response.json();
        const job = jobData.jobs[0];

        const formData = new FormData();
        formData.append('data', JSON.stringify(selected));
        formData.append('params', JSON.stringify(job.parameters.searchParamsForEmail));

        const res = await fetch(`${window.BACKEND_URL}/api/jobs/${currentJobId}/download/all?authToken=${JSON.parse(window.localStorage.getItem('sb-qbktnernawpprarckvzx-auth-token')).access_token}`);
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = `Refined_Results_${currentJobId}.zip`;
        link.click();
        
        btn.innerHTML = 'Export Selection';
        btn.disabled = false;
        document.getElementById('review-modal').remove();
    }

    return {
        init,
        toggle: (idx) => { filteredData[idx]._checked = !filteredData[idx]._checked; }
    };
})();

document.addEventListener('DOMContentLoaded', () => window.rtrlApp.review.init());