(function () {
    function initSocket() {
        const socket = io(window.BACKEND_URL, {
            extraHeaders: { "ngrok-skip-browser-warning": "true" },
            transports: ["websocket", "polling"],
            reconnection: true,
            timeout: 240000,
        });
        window.rtrlApp.socket = socket;

        socket.on("connect", () => {
            if (window.rtrlApp.isSubscribed) return;
            if (window.rtrlApp.session) {
                socket.emit("authenticate_socket", window.rtrlApp.session.access_token);
                const savedJobId = localStorage.getItem("rtrl_active_job_id");
                if (savedJobId) {
                    if (window.rtrlApp.showStatusCard) window.rtrlApp.showStatusCard();
                    socket.emit("subscribe_to_job", { jobId: savedJobId, authToken: window.rtrlApp.session.access_token });
                } else {
                    window.rtrlApp.updateDashboardUi("ready");
                    setUiState(false, window.rtrlApp.elements);
                }
            }
            window.rtrlApp.isSubscribed = true;
        });

        socket.on("disconnect", () => { window.rtrlApp.isSubscribed = false; });

        socket.on("user_queue_update", (myJobs) => {
            const elements = window.rtrlApp.elements;
            if (!elements.queueCard || !elements.queueListContainer) return;
            if (!myJobs || myJobs.length === 0) { elements.queueCard.style.display = "none"; return; }
            elements.queueCard.style.display = "block";
            if (elements.queueCountBadge) elements.queueCountBadge.textContent = `${myJobs.length} Job${myJobs.length !== 1 ? 's' : ''}`;
            elements.queueListContainer.innerHTML = myJobs.map((job) =>
                `<div class="queue-item" style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; margin-bottom: 8px; border-left: 4px solid #f59e0b;"><div style="display:flex; align-items:center; gap: 12px;"><span class="queue-pos-badge" style="background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5; font-weight: 800; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem;">#${job.globalPosition}</span><span style="font-weight: 600; color: #1e293b; font-size: 0.9rem;">${job.title}</span></div><div style="display: flex; align-items: center; gap: 10px; background: white; padding: 4px 10px; border-radius: 20px; border: 1px solid #e2e8f0;"><span style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Waiting</span><i class="fas fa-hourglass-half" style="color: #f59e0b; font-size: 0.8rem; animation: spin 2s linear infinite;"></i></div></div>`
            ).join("");
        });

        socket.on("job_created", () => {
            if (window.rtrlApp.jobHistory) window.rtrlApp.jobHistory.fetchAndRenderJobs();
        });

        socket.on("user_job_transition", ({ jobId, status }) => {
            if (status === "running") {
                window.rtrlApp.currentJobId = jobId;
                localStorage.setItem("rtrl_active_job_id", jobId);
                socket.emit("subscribe_to_job", { jobId, authToken: window.rtrlApp.session.access_token });
                window.rtrlApp.resetStatusUI();
                window.rtrlApp.updateDashboardUi("running");
                if (window.rtrlApp.jobHistory) window.rtrlApp.jobHistory.fetchAndRenderJobs(true);
            }
        });

        socket.on("job_state", (job) => {
            if (window.rtrlApp.currentJobId !== job.id) { window.rtrlApp.currentJobId = job.id; window.rtrlApp.resetStatusUI(); }
            localStorage.setItem("rtrl_active_job_id", job.id);
            if (job.status === "running") { window.rtrlApp.updateDashboardUi("running"); }
            else if (job.status === "queued") { window.rtrlApp.updateDashboardUi("ready"); setUiState(false, window.rtrlApp.elements); }
            else if (job.status === "completed" || job.status === "failed") {
                window.rtrlApp.updateDashboardUi(job.status);
                setUiState(false, window.rtrlApp.elements);
                localStorage.removeItem("rtrl_active_job_id");
                window.rtrlApp.currentJobId = null;
            }
        });

        socket.on("job_update", (data) => {
            if (data.status === "running") {
                window.rtrlApp.currentJobId = data.id;
                localStorage.setItem("rtrl_active_job_id", data.id);
                window.rtrlApp.resetStatusUI();
                window.rtrlApp.updateDashboardUi("running");
            } else if (data.status === "completed" || data.status === "failed") {
                window.rtrlApp.updateDashboardUi(data.status);
                localStorage.removeItem("rtrl_active_job_id");
                window.rtrlApp.currentJobId = null;
                setUiState(false, window.rtrlApp.elements);
                setTimeout(() => { if (window.rtrlApp.jobHistory) window.rtrlApp.jobHistory.fetchAndRenderJobs(true); }, 5000);
            }
        });

        socket.on("progress_update", (data) => {
            const card = document.getElementById("status-card");
            if (card && !card.classList.contains("state-working")) window.rtrlApp.updateDashboardUi("running");
            const { phase, processed, discovered, added, target, enriched, aiProcessed, aiTarget } = data;
            let visualPercent = 0, phaseText = "Initializing...";
            if (phase === "discovery") { phaseText = "Phase 1/3: Scanning Maps"; visualPercent = 10; window.rtrlApp.updateStatusCardPhase("discovery"); }
            else if (phase === "scraping") { phaseText = "Phase 2/3: Data Extraction"; let scrapePct = target === -1 ? (discovered > 0 ? processed / discovered : 0) : (target > 0 ? added / target : 0); visualPercent = 10 + Math.round(Math.min(scrapePct, 1) * 60); window.rtrlApp.updateStatusCardPhase("scraping"); }
            else if (phase === "ai") { phaseText = "Phase 2/3: AI Enrichment"; visualPercent = 70 + Math.round(Math.min(aiTarget > 0 ? aiProcessed / aiTarget : 0, 1) * 25); window.rtrlApp.updateStatusCardPhase("ai"); }
            else if (phase === "completed") { visualPercent = 100; phaseText = "Phase 3/3: Complete"; window.rtrlApp.updateStatusCardPhase("complete"); }
            const fill = document.getElementById("progress-fill");
            const pctLabel = document.getElementById("pct-label");
            const phaseLabel = document.getElementById("phase-label");
            if (fill) fill.style.width = `${visualPercent}%`;
            if (pctLabel) pctLabel.textContent = `${visualPercent}%`;
            if (phaseLabel) phaseLabel.textContent = phaseText;
            if (document.getElementById("stat-found")) document.getElementById("stat-found").textContent = discovered || 0;
            if (document.getElementById("stat-processed")) document.getElementById("stat-processed").textContent = added || 0;
            if (document.getElementById("stat-enriched")) document.getElementById("stat-enriched").textContent = enriched || 0;
        });

        socket.on("job_log", (msg) => logMessage(window.rtrlApp.elements.logEl, msg, "info"));
        socket.on("job_error", ({ error }) => logMessage(window.rtrlApp.elements.logEl, `Error: ${error}`, "error"));

        socket.on("business_found", () => {
            window.rtrlApp.refreshUsageTracker();
            const countEl = document.getElementById(`job-count-${window.rtrlApp.currentJobId}`);
            if (countEl) {
                let currentCount = parseInt(countEl.textContent.replace(/\D/g, "")) || 0;
                countEl.innerHTML = `<i class="fas fa-database"></i> ${currentCount + 1} Results Found`;
            }
        });

        socket.on("user_profile_updated", () => window.rtrlApp.refreshUsageTracker());
    }

    window.rtrlApp.initSocket = initSocket;
})();
