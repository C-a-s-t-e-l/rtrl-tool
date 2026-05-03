window.rtrlApp.jobHistory = (function () {
    let listContainer;
    let tokenProvider = () => null;
    let backendUrl = '';
    let historyCache = [];
    let currentPage = parseInt(localStorage.getItem('rtrl_history_page')) || 0;
    let selectedJobIds = JSON.parse(localStorage.getItem('rtrl_selected_merges')) || [];
    const itemsPerPage = 10;
    let currentSearch = "";
    let isInitialLoadDone = false;
    let searchTimeout;

    function init(provider, url) {
        listContainer = document.getElementById('job-list-container');
        const searchInput = document.getElementById('history-search-input');
        tokenProvider = provider;
        backendUrl = url;

        if (listContainer) {
            listContainer.addEventListener('click', (e) => {
                const resendButton = e.target.closest('.resend-email-btn');
                if (resendButton) resendEmail(resendButton.dataset.jobId, resendButton);

                const quickListBtn = e.target.closest('.email-body-list-btn');
                if (quickListBtn) {
                    if (confirm("Email categorized mobile list?")) sendQuickBodyEmail(quickListBtn.dataset.jobId, quickListBtn);
                }

                const cloneBtn = e.target.closest('.clone-job-btn');
                if (cloneBtn) {
                    const jobId = cloneBtn.dataset.jobId;
                    const job = historyCache.find(j => j.id === jobId);
                    if (job && window.rtrlApp.cloneJobIntoForm) window.rtrlApp.cloneJobIntoForm(job.parameters);
                }

                const pageBtn = e.target.closest('.page-nav-btn');
                if (pageBtn && !pageBtn.disabled) {
                    currentPage = parseInt(pageBtn.dataset.page);
                    localStorage.setItem('rtrl_history_page', currentPage);
                    fetchAndRenderJobs(true);
                    window.scrollTo({ top: document.getElementById('jobHistoryCard').offsetTop - 20, behavior: 'smooth' });
                }
            });
        }

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    currentSearch = e.target.value.trim();
                    currentPage = 0;
                    localStorage.setItem('rtrl_history_page', 0);
                    fetchAndRenderJobs(true);
                }, 500);
            });
        }
    }

    async function fetchAndRenderJobs(force = false) {
        if (!listContainer) return;
        if (isInitialLoadDone && !force) {
            updateMergeButtonUI(); 
            return;
        }

        listContainer.innerHTML = '<div class="loading-text"><i class="fas fa-spinner fa-spin"></i> Loading history...</div>';

        try {
            const token = tokenProvider();
            if (!token) return;

            const url = `${backendUrl}/api/jobs/history?page=${currentPage}&limit=${itemsPerPage}&search=${encodeURIComponent(currentSearch)}`;
            const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

            if (response.ok) {
                const data = await response.json();
                historyCache = data.jobs || [];
                isInitialLoadDone = true;

                if (historyCache.length === 0) {
                    listContainer.innerHTML = currentSearch 
                        ? `<p class="placeholder-text">No history matching "${currentSearch}"</p>`
                        : '<p class="placeholder-text">No jobs found.</p>';
                } else {
                    listContainer.innerHTML = historyCache.map(renderJob).join('') + renderPagination(data.totalCount);
                    attachCheckboxListeners();
                }
            }
        } catch (error) {
            listContainer.innerHTML = '<p class="error-text">An error occurred while loading history.</p>';
        }
    }

function attachCheckboxListeners() {
        document.querySelectorAll('.job-merge-select').forEach(cb => {
            cb.onchange = (e) => {
                const id = e.target.value;
                if (e.target.checked) {
                    if (!selectedJobIds.includes(id)) selectedJobIds.push(id);
                } else {
                    selectedJobIds = selectedJobIds.filter(item => item !== id);
                }
                localStorage.setItem('rtrl_selected_merges', JSON.stringify(selectedJobIds));
                updateMergeButtonUI();
            };
        });
        updateMergeButtonUI();
    }

    function updateMergeButtonUI() {
        const mergeBtn = document.getElementById('merge-trigger-btn');
        const clearBtn = document.getElementById('clear-merges-btn');
        if (!mergeBtn) return;
        
        const count = selectedJobIds.length;
        
        if (count === 0) {
            mergeBtn.textContent = 'Merge & Review Selected (0)';
            mergeBtn.disabled = true;
            mergeBtn.style.background = '#f1f5f9';
            mergeBtn.style.color = '#94a3b8';
            mergeBtn.style.borderColor = '#e2e8f0';
            if (clearBtn) clearBtn.style.display = 'none';
        } else if (count === 1) {
            mergeBtn.textContent = `Select one more to merge (1)`;
            mergeBtn.disabled = true;
            mergeBtn.style.background = '#f1f5f9';
            mergeBtn.style.color = '#94a3b8';
            mergeBtn.style.borderColor = '#e2e8f0';
            if (clearBtn) clearBtn.style.display = 'inline-flex';
        } else {
            mergeBtn.textContent = `Merge & Review Selected (${count})`;
            mergeBtn.disabled = false;
            mergeBtn.style.background = '#3b82f6';
            mergeBtn.style.color = 'white';
            mergeBtn.style.borderColor = '#2563eb';
            if (clearBtn) clearBtn.style.display = 'inline-flex';
        }
    }

    function clearSelection() {
        selectedJobIds = [];
        localStorage.setItem('rtrl_selected_merges', JSON.stringify([]));
        document.querySelectorAll('.job-merge-select').forEach(cb => cb.checked = false);
        updateMergeButtonUI();
    }

    function triggerMerge() {
        if (selectedJobIds.length < 2) return alert("Select at least 2 jobs");
        window.rtrlApp.review.openReview(selectedJobIds);
    }

function renderJob(job) {
    const { id, created_at, parameters, status, result_count } = job;
    const p = parameters || {};
    const s = p.searchParamsForEmail || {};
    const date = new Date(created_at).toLocaleString();
    
    const isSelected = selectedJobIds.includes(id) ? 'checked' : '';

    // --- 1. ZONE / LOCATION LOGIC ---
    let locationDetail = "";
    if (p.multiRadiusPoints && p.multiRadiusPoints.length > 0) {
        locationDetail = p.multiRadiusPoints.map(pt => `${pt.name} (${pt.radius}km)`).join(', ');
    } else if (p.radiusKm) {
        locationDetail = `${p.radiusKm}km around ${s.area || p.location}`;
    } else if (p.postalCode && p.postalCode.length > 0) {
        locationDetail = `Postcodes: ${p.postalCode.join(', ')}`;
    } else {
        locationDetail = s.area || p.location || "N/A";
    }

    // --- 2. SEARCH METHOD & CATEGORY LOGIC ---
    let methodLabel = "";
    let categoryDetailHTML = "";

    const isCustomSearch = !!s.customCategory || s.primaryCategory === "Custom Search";

    if (isCustomSearch) {
        methodLabel = "Custom Keyword Search";
        categoryDetailHTML = `
            <strong>Method:</strong> Custom Keywords<br>
            <strong>Keywords:</strong> <span style="color: #3b82f6; font-weight: 600;">${s.customCategory || "N/A"}</span>
        `;
    } else {
        methodLabel = "Industry Dataset Search";
        const industry = s.primaryCategory || "General";
        const categories = s.subCategoryList && s.subCategoryList.length > 0 
            ? s.subCategoryList.join(', ') 
            : "All Categories";
            
        categoryDetailHTML = `
            <strong>Industry:</strong> ${industry}<br>
            <strong>Categories:</strong> <span style="color: #3b82f6; font-weight: 600;">${categories}</span>
        `;
    }

    // --- 3. STATUS & ICON LOGIC ---
    let statusIcon = 'fa-clock', statusClass = 'status-queued', statusText = 'Queued';
    if (status === 'running') { statusIcon = 'fa-spinner fa-spin'; statusClass = 'status-running'; statusText = 'Running'; }
    else if (status === 'completed') { statusIcon = 'fa-check-circle'; statusClass = 'status-completed'; statusText = 'Completed'; }
    else if (status === 'failed') { statusIcon = 'fa-exclamation-triangle'; statusClass = 'status-failed'; statusText = 'Failed'; }

    const authToken = tokenProvider();

    const fileLinks = `
        <a href="${backendUrl}/api/jobs/${id}/download/full_xlsx?authToken=${authToken}" class="file-link" download><i class="fas fa-file-excel"></i> Full List (.xlsx)</a>
        <a href="${backendUrl}/api/jobs/${id}/download/duplicates_xlsx?authToken=${authToken}" class="file-link" download><i class="fas fa-copy"></i> Duplicates (.xlsx)</a>
        <a href="${backendUrl}/api/jobs/${id}/download/sms_csv?authToken=${authToken}" class="file-link" download><i class="fas fa-mobile-alt"></i> SMS List (.csv)</a>
        <a href="${backendUrl}/api/jobs/${id}/download/contacts_csv?authToken=${authToken}" class="file-link" download><i class="fas fa-address-book"></i> Emails (.csv)</a>
        <a href="${backendUrl}/api/jobs/${id}/download/mobiles_zip?authToken=${authToken}" class="file-link" download><i class="fas fa-file-zipper"></i> Mobile Splits (.zip)</a>
        <a href="${backendUrl}/api/jobs/${id}/download/csv_zip?authToken=${authToken}" class="file-link" download><i class="fas fa-file-archive"></i> CSV Splits (.zip)</a>
        <a href="${backendUrl}/api/jobs/${id}/download/txt_zip?authToken=${authToken}" class="file-link" download><i class="fas fa-file-alt"></i> TXT Splits (.zip)</a>
    `;

    return `
        <div class="job-item" id="job-card-${id}">
            <div class="job-header" style="display: flex; align-items: center; gap: 15px;">
                <div style="display: flex; align-items: center; justify-content: center; width: 30px;">
                    <input type="checkbox" class="job-merge-select" value="${id}" ${isSelected} style="width: 18px; height: 18px; cursor: pointer; margin: 0;">
                </div>
                <div class="job-title-wrapper" style="flex: 1; display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-history job-icon"></i>
                    <h4 class="job-title" style="margin:0;">Search: "${s.area || 'Unknown'}"</h4>
                </div>
                <div id="job-status-${id}" class="job-status ${statusClass}" style="margin-left: auto;">
                    <i class="fas ${statusIcon}"></i>
                    <span>${statusText}</span>
                </div>
            </div>

            <div class="job-parameter-summary" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; background: #f0f7ff; padding: 15px; border-radius: 10px; border-left: 6px solid #3b82f6; margin: 12px 0; font-size: 0.85rem; color: #1e293b; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);">
                <div style="line-height: 1.6;">
                    <span style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 0.7rem;">Targeting Criteria</span><br>
                    <strong>Zones:</strong> ${locationDetail}
                </div>
                <div style="line-height: 1.6;">
                    <span style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 0.7rem;">Industry & Keywords</span><br>
                    ${categoryDetailHTML}
                </div>
                <div style="line-height: 1.6;">
                    <span style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 0.7rem;">System Settings</span><br>
                    <strong>AI Enrichment:</strong> ${p.useAiEnrichment ? "ENABLED" : "DISABLED"}<br>
                    <strong>Limit:</strong> ${p.count === -1 ? "All Available" : p.count}
                </div>
            </div>

            <div class="job-meta">
                <span><i class="fas fa-calendar-alt"></i> ${date}</span>
                <span id="job-count-${id}"><i class="fas fa-database"></i> ${(job.results ? job.results.length : result_count) || 0} Results Found</span>
                <span><i class="fas fa-fingerprint"></i> ID: ${id}</span>
            </div>

            ${status === 'completed' ? `
            <div class="job-downloads" style="margin-top: 15px;">
                <div class="job-files">
                    <h5>Download Files</h5>
                    <div class="file-links-container">
                        ${fileLinks}
                    </div>
                </div>
                <div class="job-actions">
                    <h5>Actions</h5>
                    <div class="action-buttons-container">
                        <a href="${backendUrl}/api/jobs/${id}/download/all?authToken=${authToken}" class="job-action-btn" download><i class="fas fa-file-zipper"></i> Download All (.zip)</a>
                        <button class="job-action-btn resend-email-btn" data-job-id="${id}"><i class="fas fa-paper-plane"></i> Resend Email</button>
                        <button class="job-action-btn email-body-list-btn" data-job-id="${id}"><i class="fas fa-mobile-alt"></i> Send Mobile List</button>
                        <button class="job-action-btn clone-job-btn" style="background: #e0f2fe; border-color: #bae6fd; color: #0369a1;" data-job-id="${id}"><i class="fas fa-sync-alt"></i> Repeat Search</button>
                        <button class="job-action-btn btn-review-trigger" style="background-color: #f0f9ff;" onclick="window.rtrlApp.review.openReview('${id}')"><i class="fas fa-list-check"></i> Review & Filter</button>
                    </div>
                </div>
            </div>
            ` : ''}
        </div>
    `;
}

    function renderPagination(totalCount) {
        const totalPages = Math.ceil(totalCount / itemsPerPage);
        if (totalPages <= 1) return "";
        let buttons = [];
        buttons.push(`<button class="page-nav-btn" data-page="0" ${currentPage === 0 ? 'disabled' : ''}><i class="fas fa-angle-double-left"></i></button>`);
        let startPage = Math.max(0, currentPage - 2);
        let endPage = Math.min(totalPages - 1, startPage + 4);
        if (endPage - startPage < 4) startPage = Math.max(0, endPage - 4);
        for (let i = startPage; i <= endPage; i++) {
            buttons.push(`<button class="page-nav-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i + 1}</button>`);
        }
        buttons.push(`<button class="page-nav-btn" data-page="${totalPages - 1}" ${currentPage === totalPages - 1 ? 'disabled' : ''}><i class="fas fa-angle-double-right"></i></button>`);
        return `<div class="pagination-controls" style="display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 30px; padding: 20px 0;">${buttons.join('')}</div>`;
    }

    async function resendEmail(jobId, buttonEl) {
        const token = tokenProvider();
        if (!token) return;
        const originalText = buttonEl.innerHTML;
        buttonEl.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Sending...`;
        buttonEl.disabled = true;
        try {
            const response = await fetch(`${backendUrl}/api/jobs/${jobId}/resend-email`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            buttonEl.innerHTML = response.ok ? `<i class="fas fa-check"></i> Sent!` : `<i class="fas fa-times"></i> Failed`;
        } catch (error) { buttonEl.innerHTML = `<i class="fas fa-times"></i> Error`; }
        finally { setTimeout(() => { buttonEl.innerHTML = originalText; buttonEl.disabled = false; }, 3000); }
    }

    async function sendQuickBodyEmail(jobId, buttonEl) {
        const token = tokenProvider();
        if (!token) return;
        const originalText = buttonEl.innerHTML;
        buttonEl.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Sending...`;
        buttonEl.disabled = true;
        try {
            const response = await fetch(`${backendUrl}/api/jobs/${jobId}/send-quick-body`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            buttonEl.innerHTML = response.ok ? `<i class="fas fa-check"></i> Sent` : `<i class="fas fa-times"></i> Failed`;
        } catch (error) { buttonEl.innerHTML = `<i class="fas fa-times"></i> Error`; }
        finally { setTimeout(() => { buttonEl.innerHTML = originalText; buttonEl.disabled = false; }, 3000); }
    }

    return { init, fetchAndRenderJobs, triggerMerge, clearSelection  };
})();