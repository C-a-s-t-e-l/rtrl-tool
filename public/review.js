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

            // Logic: If the database already has a saved selection state, use it. 
            // Otherwise, default to checking "Active" items.
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
            if (indicator) indicator.innerHTML = '<i class="fas fa-check"></i> All progress saved';
        }, 500);
    }

    function debouncedSave() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveProgress, 1500);
    }

    function renderModal() {
        if (document.getElementById('review-modal')) document.getElementById('review-modal').remove();
        const s = jobParams.searchParamsForEmail || {};
        const title = `${s.customCategory || s.primaryCategory || "Search"} in ${s.area || "Area"}`;

        const overlay = document.createElement('div');
        overlay.className = 'review-overlay';
        overlay.id = 'review-modal';
        overlay.innerHTML = `
            <div class="review-window">
                <div class="review-header">
                    <div style="flex: 1"><h3 style="margin:0">${title}</h3>
                        <div class="review-summary" style="margin-top:8px">
                            <span class="sum-pill sum-active">Selection active</span>
                        </div>
                    </div>
                    <div class="review-controls">
                        <input type="text" class="review-search" placeholder="Quick Filter..." id="rev-search">
                        <button class="btn-review-close" id="rev-only-active" style="background:#fff; border:1px solid #cbd5e1;">Reset to Active Only</button>
                    </div>
                </div>
                <div class="review-table-container">
                    <table class="review-table">
                        <thead><tr><th><input type="checkbox" id="rev-master-check"></th><th>Status</th><th>Name</th><th>Category</th><th>Address</th><th>Phone</th><th>Links</th></tr></thead>
                        <tbody id="rev-body"></tbody>
                    </table>
                </div>
                <div class="review-footer">
                    <div id="rev-save-indicator" class="save-indicator"></div>
                    <button class="btn-review-close" onclick="document.getElementById('review-modal').remove()">Close Workspace</button>
                    
                    <div class="tooltip-wrapper">
                        <button class="btn-review-export" style="background:#10b981" id="rev-export-xlsx">Refined Master (.xlsx)</button>
                        <span class="tooltip-text">Downloads a high-detail Excel file of your checked leads.</span>
                    </div>

                    <div class="tooltip-wrapper">
                        <button class="btn-review-export" id="rev-export-zip">Refined Files (.zip)</button>
                        <span class="tooltip-text">Generates a ZIP containing SMS lists, Email lists, and split files based on your selection.</span>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        updateTable();

        document.getElementById('rev-search').oninput = (e) => {
            const term = e.target.value.toLowerCase();
            filteredData = masterData.filter(d => (d.BusinessName||"").toLowerCase().includes(term) || (d.StreetAddress||"").toLowerCase().includes(term));
            updateTable();
        };
        document.getElementById('rev-master-check').onclick = (e) => { filteredData.forEach(d => d._checked = e.target.checked); updateTable(); debouncedSave(); };
        document.getElementById('rev-only-active').onclick = () => { masterData.forEach(d => d._checked = d._reviewStatus === 'Active'); updateTable(); debouncedSave(); };
        document.getElementById('rev-export-xlsx').onclick = () => exportMasterXLSX();
        document.getElementById('rev-export-zip').onclick = () => exportRefinedZip();
    }

    function updateTable() {
        document.getElementById('rev-body').innerHTML = filteredData.map((d) => `
            <tr class="row-${d._reviewStatus.toLowerCase()}">
                <td><input type="checkbox" ${d._checked ? 'checked' : ''} onchange="window.rtrlApp.review.toggle(${d._id})"></td>
                <td><span class="status-badge badge-${d._reviewStatus.toLowerCase()}">${d._reviewStatus}</span></td>
                <td style="font-weight:600">${d.BusinessName}</td>
                <td style="color:#64748b; font-size:0.75rem">${d.Category}</td>
                <td style="font-size:0.75rem">${d.StreetAddress || ''}</td>
                <td>${d.Phone || ''}</td>
                <td><div style="display:flex;gap:10px">
                    ${d.Website ? `<a href="${d.Website}" target="_blank"><i class="fas fa-link"></i></a>` : ''}
                </div></td>
            </tr>`).join('');
    }

    function exportMasterXLSX() {
        const selected = masterData.filter(d => d._checked);
        if (!selected.length) return alert("Select leads first.");
        const ws = XLSX.utils.json_to_sheet(selected.map(({_id, _reviewStatus, _checked, ...rest}) => rest));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Master List");
        XLSX.writeFile(wb, `Refined_Master_${currentJobId}.xlsx`);
    }

    async function exportRefinedZip() {
        const selected = masterData.filter(d => d._checked);
        if (!selected.length) return alert("Select leads first.");

        const zip = new JSZip();
        
        // 1. Master Excel
        const wsFull = XLSX.utils.json_to_sheet(selected.map(({_id, _reviewStatus, _checked, ...rest}) => rest));
        const wbFull = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wbFull, wsFull, "Unique Leads");
        zip.file("1_Master_List_Refined.xlsx", XLSX.write(wbFull, {type:'buffer', bookType:'xlsx'}));

        // 2. SMS CSV
        const smsData = selected.filter(d => d.Phone && d.Phone.startsWith('614')).map(d => ({
            Name: d.BusinessName, Mobile: d.Phone, Category: d.Category
        }));
        if(smsData.length) {
            const wsSms = XLSX.utils.json_to_sheet(smsData);
            zip.file("2_Mobile_Numbers_Only.csv", XLSX.write({SheetNames:["S"], Sheets:{S:wsSms}}, {type:'buffer', bookType:'csv'}));
        }

        // 3. Email TXT List
        const emails = selected.map(d => d.Email1).filter(e => e && e.includes('@'));
        if(emails.length) zip.file("3_Clean_Email_List.txt", emails.join('\n'));

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
                debouncedSave();
            }
        }
    };
})();
document.addEventListener('DOMContentLoaded', () => window.rtrlApp.review.init());