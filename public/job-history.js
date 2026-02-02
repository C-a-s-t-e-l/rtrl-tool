window.rtrlApp.jobHistory = (function () {
    let containerEl, listContainer;
    let tokenProvider = () => null;
    let backendUrl = '';
    let historyCache = [];

    function init(provider, url) {
        containerEl = document.getElementById('jobHistoryCard');
        if (!containerEl) return;
        listContainer = document.getElementById('job-list-container');
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
            });
        }
    }

    function renderJob(job) {
        const { id, created_at, parameters, status, results } = job;
        const p = parameters || {};
        const s = p.searchParamsForEmail || {}; 
        const date = new Date(created_at).toLocaleString();
        const totalResults = results || 0;

        let searchType = "Suburb/Area Search";
        let locationDetail = s.area || p.location || "N/A";

        if (p.radiusKm) {
            searchType = "Radius Search";
            locationDetail = `${p.radiusKm} km radius around ${s.area || 'selected point'}`;
        } else if (p.postalCode && p.postalCode.length > 0) {
            searchType = "Postcode Search";
            locationDetail = `Postcodes: ${p.postalCode.join(", ")}`;
        } else if (p.businessNames && p.businessNames.length > 0) {
            searchType = "Specific Name Search";
            locationDetail = `${p.businessNames.length} individual business names`;
        }

        const keywordType = s.customCategory ? "Custom Keyword Search" : "Preset Category Search";
        const keywordList = p.categoriesToLoop ? p.categoriesToLoop.join(", ") : (p.businessNames ? "N/A (Name Search)" : "None");

        let statusIcon = 'fa-clock', statusClass = 'status-queued', statusText = 'Queued';
        if (status === 'running') {
            statusIcon = 'fa-spinner fa-spin'; statusClass = 'status-running'; statusText = 'Running';
        } else if (status === 'completed') {
            statusIcon = 'fa-check-circle'; statusClass = 'status-completed'; statusText = 'Completed';
        } else if (status === 'failed') {
            statusIcon = 'fa-exclamation-triangle'; statusClass = 'status-failed'; statusText = 'Failed';
        }

        const authToken = tokenProvider();

        const fileLinks = `
            <a href="${backendUrl}/api/jobs/${id}/download/full_xlsx?authToken=${authToken}" class="file-link" download><i class="fas fa-file-excel"></i> Full List (.xlsx)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/duplicates_xlsx?authToken=${authToken}" class="file-link" download><i class="fas fa-copy"></i> Duplicates (.xlsx)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/sms_csv?authToken=${authToken}" class="file-link" download><i class="fas fa-mobile-alt"></i> SMS List (.csv)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/contacts_csv?authToken=${authToken}" class="file-link" download><i class="fas fa-address-book"></i> Contacts Primary (.csv)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/csv_zip?authToken=${authToken}" class="file-link" download><i class="fas fa-file-archive"></i> Contacts CSV Splits (.zip)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/txt_zip?authToken=${authToken}" class="file-link" download><i class="fas fa-file-alt"></i> Contacts TXT Splits (.zip)</a>
        `;

        return `
            <div class="job-item" id="job-card-${id}">
                <div class="job-header">
                    <div class="job-title-wrapper">
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
                        <strong>Keywords:</strong> ${keywordList}
                    </div>
                    <div style="line-height: 1.6;">
                        <span style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 0.7rem;">System Settings</span><br>
                        <strong>AI Enrichment:</strong> ${p.useAiEnrichment ? "ENABLED" : "DISABLED"}<br>
                        <strong>Limit:</strong> ${p.count === -1 ? "All Available" : p.count}
                    </div>
                </div>

                <div class="job-meta">
                    <span><i class="fas fa-calendar-alt"></i> ${date}</span>
                    <span id="job-count-${id}"><i class="fas fa-database"></i> ${totalResults} Results Found</span>
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
                            <button class="job-action-btn clone-job-btn" style="background: #e0f2fe; border-color: #bae6fd; color: #0369a1;" data-job-id="${id}"><i class="fas fa-sync-alt"></i> Repeat This Search</button>
                        </div>
                    </div>
                </div>
                ` : ''}
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

    async function fetchAndRenderJobs() {
        if (!listContainer) return;
        const token = tokenProvider();
        if (!token) return;
        try {
            const response = await fetch(`${backendUrl}/api/jobs/history`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (response.ok) {
                const jobs = await response.json();
                historyCache = jobs;
                if (jobs.length === 0) { listContainer.innerHTML = '<p class="placeholder-text">No jobs found.</p>'; return; }
                listContainer.innerHTML = jobs.map(renderJob).join('');
            }
        } catch (error) { listContainer.innerHTML = '<p class="error-text">An error occurred while loading history.</p>'; }
    }

    return { init, fetchAndRenderJobs };
})();