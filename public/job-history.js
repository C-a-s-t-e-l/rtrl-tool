window.rtrlApp.jobHistory = (function () {
    let containerEl, listContainer;
    let tokenProvider = () => null;
    let backendUrl = '';

    function init(provider, url) {
        containerEl = document.getElementById('jobHistoryCard');
        if (!containerEl) {
            console.error('Job History container not found!');
            return;
        }
        listContainer = document.getElementById('job-list-container');
        tokenProvider = provider;
        backendUrl = url;

        if (listContainer) {
            listContainer.addEventListener('click', (e) => {
                const resendButton = e.target.closest('.resend-email-btn');
                if (resendButton) {
                    const jobId = resendButton.dataset.jobId;
                    resendEmail(jobId, resendButton);
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
                    <strong>Items:</strong> ${keywordList}
                </div>
                <div style="line-height: 1.6;">
                    <span style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 0.7rem;">System Settings</span><br>
                    <strong>AI Enrichment:</strong> ${p.useAiEnrichment ? "ENABLED (High Detail)" : "DISABLED (Basic Info)"}<br>
                    <strong>Limit:</strong> ${p.count === -1 ? "Find All Available" : p.count + " Businesses"}
                </div>
            </div>

            <div class="job-meta" style="border-bottom: 1px solid #eef2f6; padding-bottom: 10px;">
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
                        <button class="job-action-btn clone-job-btn" style="background: #e0f2fe; border-color: #bae6fd; color: #0369a1;" onclick="alert('Clone feature coming next week! Parameters: ${keywordList}')"><i class="fas fa-sync-alt"></i> Repeat This Search</button>
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
            const response = await fetch(`${backendUrl}/api/jobs/${jobId}/resend-email`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                buttonEl.innerHTML = `<i class="fas fa-check"></i> Sent!`;
            } else {
                buttonEl.innerHTML = `<i class="fas fa-times"></i> Failed`;
            }
        } catch (error) {
            console.error('Error resending email:', error);
            buttonEl.innerHTML = `<i class="fas fa-times"></i> Error`;
        } finally {
            setTimeout(() => {
                buttonEl.innerHTML = originalText;
                buttonEl.disabled = false;
            }, 3000);
        }
    }

    async function fetchAndRenderJobs() {
        if (!listContainer) return;
        const token = tokenProvider();
        if (!token) return;

        const hasExistingJobs = listContainer.querySelector('.job-item');
        
        if (!hasExistingJobs) {
            listContainer.innerHTML = '<p class="loading-text">Loading history...</p>';
        }

        try {
            const response = await fetch(`${backendUrl}/api/jobs/history`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                listContainer.innerHTML = '<p class="error-text">Failed to load job history.</p>';
                return;
            }

            const jobs = await response.json();
            if (jobs.length === 0) {
                listContainer.innerHTML = '<p class="placeholder-text">No jobs found. Start a new research to see your history here.</p>';
                return;
            }
            
            listContainer.innerHTML = jobs.map(renderJob).join('');

        } catch (error) {
            console.error('Error fetching job history:', error);
            if (!hasExistingJobs) {
                listContainer.innerHTML = '<p class="error-text">An error occurred while loading job history.</p>';
            }
        }
    }

    return {
        init,
        fetchAndRenderJobs
    };
})();