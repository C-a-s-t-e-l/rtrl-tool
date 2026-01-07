// public/job-history.js
window.rtrlApp.jobHistory = (function () {
    let containerEl;
    let tokenProvider = () => null;
    let backendUrl = '';

    function init(provider, url) {
        containerEl = document.getElementById('jobHistoryCard');
        if (!containerEl) {
            console.error('Job History container not found!');
            return;
        }
        tokenProvider = provider;
        backendUrl = url;
    }

    function renderJob(job) {
        const { id, created_at, parameters, status, results } = job;
        const date = new Date(created_at).toLocaleString();
        const totalResults = results ? results.length : 0;

        let statusIcon = 'fa-clock';
        let statusClass = 'status-queued';
        let statusText = 'Queued';

        if (status === 'running') {
            statusIcon = 'fa-spinner fa-spin';
            statusClass = 'status-running';
            statusText = 'Running';
        } else if (status === 'completed') {
            statusIcon = 'fa-check-circle';
            statusClass = 'status-completed';
            statusText = 'Completed';
        } else if (status === 'failed') {
            statusIcon = 'fa-exclamation-triangle';
            statusClass = 'status-failed';
            statusText = 'Failed';
        }
        
        let title = 'Untitled Search';
        if (parameters) {
            if (parameters.businessNames && parameters.businessNames.length > 0) {
                title = `"${parameters.businessNames.slice(0, 2).join(', ')}"`;
            } else if (parameters.categoriesToLoop && parameters.categoriesToLoop.length > 0) {
                const location = parameters.location || (parameters.postalCode ? parameters.postalCode.join(', ') : 'area');
                title = `"${parameters.categoriesToLoop[0]}" in ${location}`;
            }
        }
        if (title.length > 80) title = title.substring(0, 77) + '...';
        
        const authToken = tokenProvider();
        
        const fileLinks = `
            <a href="${backendUrl}/api/jobs/${id}/download/full_xlsx?authToken=${authToken}" class="file-link" download><i class="fas fa-file-excel"></i> Full List (.xlsx)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/duplicates_xlsx?authToken=${authToken}" class="file-link" download><i class="fas fa-copy"></i> Duplicates (.xlsx)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/sms_csv?authToken=${authToken}" class="file-link" download><i class="fas fa-mobile-alt"></i> SMS List (.csv)</a>
            <a href="${backendUrl}/api/jobs/${id}/download/csv_zip?authToken=${authToken}" class="file-link" download><i class="fas fa-file-archive"></i> Contacts Splits (.zip)</a>
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
                <div class="job-files">
                    <h5>Downloads</h5>
                    <div class="file-links-container">
                        ${fileLinks}
                    </div>
                </div>
                ` : ''}
            </div>
        `;
    }

    async function fetchAndRenderJobs() {
        if (!containerEl) return;
        
        const token = tokenProvider();
        if (!token) return;

        const listContainer = containerEl.querySelector('#job-list-container');
        listContainer.innerHTML = '<p class="loading-text">Loading history...</p>';

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
            listContainer.innerHTML = '<p class="error-text">An error occurred while loading job history.</p>';
        }
    }

    return {
        init,
        fetchAndRenderJobs
    };
})();