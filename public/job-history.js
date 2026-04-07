window.rtrlApp.jobHistory = (function () {
    let listContainer;
    let tokenProvider = () => null;
    let backendUrl = '';
    let historyCache = [];
    let currentPage = 0;
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
                if (resendButton) {
                    resendEmail(resendButton.dataset.jobId, resendButton);
                }

                const quickListBtn = e.target.closest('.email-body-list-btn');
                if (quickListBtn) {
                    if (confirm("Would you like to email the categorized list of mobile numbers directly to your inbox?")) {
                        sendQuickBodyEmail(quickListBtn.dataset.jobId, quickListBtn);
                    }
                }

                const cloneBtn = e.target.closest('.clone-job-btn');
                if (cloneBtn) {
                    const jobId = cloneBtn.dataset.jobId;
                    const job = historyCache.find(j => j.id === jobId);
                    if (job && window.rtrlApp.cloneJobIntoForm) {
                        window.rtrlApp.cloneJobIntoForm(job.parameters);
                    }
                }

                const pageBtn = e.target.closest('.page-nav-btn');
                if (pageBtn && !pageBtn.disabled) {
                    currentPage = parseInt(pageBtn.dataset.page);
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
                    fetchAndRenderJobs(true);
                }, 500);
            });
        }
    }

    async function fetchAndRenderJobs(force = false) {
        if (!listContainer) return;
        if (isInitialLoadDone && !force) return;

        const token = tokenProvider();
        if (!token) return;

        listContainer.innerHTML = '<div class="loading-text"><i class="fas fa-spinner fa-spin"></i> Loading history...</div>';

        try {
            const url = `${backendUrl}/api/jobs/history?page=${currentPage}&limit=${itemsPerPage}&search=${encodeURIComponent(currentSearch)}`;
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                const jobs = data.jobs || [];
                const totalCount = data.totalCount || 0;
                historyCache = jobs;
                isInitialLoadDone = true;

                if (jobs.length === 0) {
                    listContainer.innerHTML = currentSearch 
                        ? `<p class="placeholder-text">No history matching "${currentSearch}"</p>`
                        : '<p class="placeholder-text">No jobs found.</p>';
                    return;
                }

                let html = jobs.map(renderJob).join('');
                html += renderPagination(totalCount);
                listContainer.innerHTML = html;
            }
        } catch (error) {
            listContainer.innerHTML = '<p class="error-text">An error occurred while loading history.</p>';
        }
    }

    function renderJob(job) {
        const { id, created_at, parameters, status, result_count } = job;
        const p = parameters || {};
        const s = p.searchParamsForEmail || {};
        const date = new Date(created_at).toLocaleString();
        const totalResults = result_count || 0;

let searchType = "Suburb/Area Search";
        let locationDetail = s.area || p.location || "N/A";

        if (p.multiRadiusPoints && p.multiRadiusPoints.length > 0) {
            searchType = p.multiRadiusPoints.length === 1 ? "Radius Search" : "Multi-Zone Search";
            const radii = p.multiRadiusPoints.map(pt => pt.radius);
            const avgRadius = Math.round(radii.reduce((a, b) => a + b, 0) / radii.length);
            locationDetail = `${s.area} (~${avgRadius}km avg radius)`;
        } 
        else if (p.radiusKm) {
            searchType = "Radius Search";
            locationDetail = `${p.radiusKm} km radius around ${s.area || 'selected point'}`;
        } 
        else if (p.postalCode && p.postalCode.length > 0) {
            searchType = "Postcode Search";
            locationDetail = `Postcodes: ${p.postalCode.join(", ")}`;
        } 
        else if (p.businessNames && p.businessNames.length > 0) {
            searchType = "Specific Name Search";
            locationDetail = `${p.businessNames.length} individual business names`;
        }

        const isBroadMode = !s.primaryCategory && s.customCategory;
        const keywordType = isBroadMode ? "Custom Keyword Search" : "Preset Category Search";

        let summaryParts = [];
        if (isBroadMode) {
            summaryParts.push(`Custom Keywords: "${s.customCategory}"`);
        } else {
            summaryParts.push(`Cat: ${s.primaryCategory || "N/A"}`);
            summaryParts.push(`Sub_Cat: ${(s.subCategoryList && s.subCategoryList.length > 0) ? s.subCategoryList.join(", ") : "None"}`);
            if (s.customCategory) summaryParts.push(`Keyword: "${s.customCategory}"`);
        }

        const detailedSummary = summaryParts.join(" ; ");

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
            <a href="${backendUrl}/api/jobs/${id}/download/csv_zip?authToken=${authToken}" class="file-link" download><i class="fas fa-file-archive"></i> Contacts CSV Splits (.zip)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/txt_zip?authToken=${authToken}" class="file-link" download><i class="fas fa-file-alt"></i> Contacts TXT Splits (.zip)</a>
        `;

        return `
            <div class="job-item" id="job-card-${id}">
                <div class="job-header">
                    <div class="job-title-wrapper">
                    <input type="checkbox" class="job-merge-select" value="${id}" style="margin-right: 10px; transform: scale(1.2);">
                        <i class="fas fa-history job-icon"></i>
                        <h4 class="job-title">Search: "${s.area || 'Unknown'}"</h4>
                    </div>
                    <div id="job-status-${id}" class="job-status ${statusClass}">
                        <i class="fas ${statusIcon}"></i>
                        <span>${statusText}</span>
                    </div>
                </div>

                <div class="job-parameter-summary" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; background: #f0f7ff; padding: 15px; border-radius: 10px; border-left: 6px solid #3b82f6; margin: 12px 0; font-size: 0.85rem; color: #1e293b; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);">
                    <div style="line-height: 1.6;">
                        <span style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 0.7rem;">Targeting Criteria</span><br>
                        <strong>Search Type:</strong> ${searchType}<br>
                        <strong>Specifics:</strong> ${locationDetail}
                    </div>
                    <div style="line-height: 1.6;">
                        <span style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 0.7rem;">Keywords & Industry</span><br>
                        <strong>Method:</strong> ${keywordType}<br>
                        <strong>Summary:</strong> ${detailedSummary}
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
        
        if (endPage - startPage < 4) {
            startPage = Math.max(0, endPage - 4);
        }

        for (let i = startPage; i <= endPage; i++) {
            buttons.push(`<button class="page-nav-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i + 1}</button>`);
        }

        buttons.push(`<button class="page-nav-btn" data-page="${totalPages - 1}" ${currentPage === totalPages - 1 ? 'disabled' : ''}><i class="fas fa-angle-double-right"></i></button>`);

        return `
            <div class="pagination-controls" style="display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 30px; padding: 20px 0;">
                ${buttons.join('')}
                <div style="font-size: 0.8rem; color: #64748b; margin-left: 10px;">Page ${currentPage + 1} of ${totalPages}</div>
            </div>
        `;
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

        function triggerMerge() {
        const selected = Array.from(document.querySelectorAll('.job-merge-select:checked')).map(cb => cb.value);
        if (selected.length < 2) return alert("Select at least 2 jobs");
        window.rtrlApp.review.openReview(selected);
}

    return { init, fetchAndRenderJobs, triggerMerge };
})();