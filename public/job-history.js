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
        const date = new Date(created_at).toLocaleString();
        const totalResults = results || 0;
        const searchParams = parameters?.searchParamsForEmail || {};

        let statusIcon = 'fa-clock', statusClass = 'status-queued', statusText = 'Queued';
        if (status === 'running') {
            statusIcon = 'fa-spinner fa-spin'; statusClass = 'status-running'; statusText = 'Running';
        } else if (status === 'completed') {
            statusIcon = 'fa-check-circle'; statusClass = 'status-completed'; statusText = 'Completed';
        } else if (status === 'failed') {
            statusIcon = 'fa-exclamation-triangle'; statusClass = 'status-failed'; statusText = 'Failed';
        }
        
        let title = 'Untitled Search';
        if (parameters) {
            const locationPart = (searchParams.area || 'area').replace(/_/g, ' ');
            if (parameters.businessNames && parameters.businessNames.length > 0) {
                title = `"${parameters.businessNames.slice(0, 2).join(', ')}"`;
            } else if (searchParams.customCategory) {
                title = `"${searchParams.customCategory}" in ${locationPart}`;
            } else if (searchParams.primaryCategory) {
                let categoryPart = searchParams.primaryCategory;
                if (searchParams.subCategoryList && searchParams.subCategoryList.length > 0) {
                    categoryPart += ` (${searchParams.subCategoryList.slice(0, 2).join(', ')}${searchParams.subCategoryList.length > 2 ? '...' : ''})`;
                }
                title = `"${categoryPart}" in ${locationPart}`;
            }
        }
        if (title.length > 80) title = title.substring(0, 77) + '...';
        
        const authToken = tokenProvider();
        
        const fileLinks = `
            <a href="${backendUrl}/api/jobs/${id}/download/full_xlsx?authToken=${authToken}" class="file-link" download><i class="fas fa-file-excel"></i> Full List (.xlsx)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/duplicates_xlsx?authToken=${authToken}" class="file-link" download><i class="fas fa-copy"></i> Duplicates (.xlsx)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/sms_csv?authToken=${authToken}" class="file-link" download><i class="fas fa-mobile-alt"></i> SMS List (.csv)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/contacts_csv?authToken=${authToken}" class="file-link" download><i class="fas fa-address-book"></i> Contacts Primary (.csv)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/csv_zip?authToken=${authToken}" class="file-link" download><i class="fas fa-file-archive"></i> Contacts CSV Splits (.zip)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/txt_zip?authToken=${authToken}" class="file-link" download><i class="fas fa-file-alt"></i> Contacts TXT Splits (.zip)</a>
        `;

        const actionButtons = `
            <a href="${backendUrl}/api/jobs/${id}/download/all?authToken=${authToken}" class="job-action-btn" download><i class="fas fa-file-zipper"></i> Download All (.zip)</a>
            <button class="job-action-btn resend-email-btn" data-job-id="${id}"><i class="fas fa-paper-plane"></i> Resend Email</button>
        `;

        return `
            <div class="job-item">
                <div class="job-header">
                    <div class="job-title-wrapper">
                        <i class="fas fa-briefcase job-icon"></i>
                        <h4 class="job-title">${title}</h4>
                    </div>
                    <div class="job-status ${statusClass}">
                        <i class="fas ${statusIcon}"></i>
                        <span>${statusText}</span>
                    </div>
                </div>
                <div class="job-meta">
                    <span><i class="fas fa-calendar-alt"></i> ${date}</span>
                    <span><i class="fas fa-database"></i> ${totalResults} Results Found</span>
                    <span><i class="fas fa-id-badge"></i> Job ID: ${id}</span>
                </div>
                ${status === 'completed' ? `
                <div class="job-downloads">
                    <div class="job-files">
                        <h5>Generated Files</h5>
                        <div class="file-links-container">
                            ${fileLinks}
                        </div>
                    </div>
                    <div class="job-actions">
                        <h5>Actions</h5>
                        <div class="action-buttons-container">
                           ${actionButtons}
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