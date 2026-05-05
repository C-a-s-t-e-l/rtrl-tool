(function () {
    async function refreshUsageTracker() {
        const session = window.rtrlApp.session;
        if (!session) return;
        const { data: profile, error } = await window.rtrlApp.supabaseClient
            .from("profiles")
            .select("usage_today, daily_limit, last_reset_date")
            .eq("id", session.user.id)
            .single();
        if (error || !profile) return;
        const elements = window.rtrlApp.elements;
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        let displayUsage = profile.usage_today || 0;
        if (profile.last_reset_date && profile.last_reset_date < todayStr) displayUsage = 0;
        const limit = profile.daily_limit || 500;
        const percentage = Math.min(Math.round((displayUsage / limit) * 100), 100);
        if (elements.dashUsageCurrent) elements.dashUsageCurrent.textContent = displayUsage.toLocaleString();
        if (elements.dashUsageLimit) elements.dashUsageLimit.textContent = limit.toLocaleString();
        if (elements.dashUsageFill) {
            elements.dashUsageFill.style.width = `${percentage}%`;
            elements.dashUsageFill.style.backgroundColor = percentage > 90 ? "#ef4444" : "#8b5cf6";
        }
        if (elements.dashUsagePercent) elements.dashUsagePercent.textContent = `${percentage}% consumed`;
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        const diffMs = midnight.getTime() - now.getTime();
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const mins = Math.round((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        if (elements.dashResetTimer) elements.dashResetTimer.textContent = `Resets in ${hours}h ${mins}m`;
    }

    async function loadGoogleMaps() {
        try {
            const response = await fetch(`${window.BACKEND_URL}/api/config`, {
                headers: { "ngrok-skip-browser-warning": "true" },
            });
            const config = await response.json();
            if (config.googleMapsApiKey) {
                const script = document.createElement("script");
                script.src = `https://maps.googleapis.com/maps/api/js?key=${config.googleMapsApiKey}&libraries=places&callback=initMap`;
                script.async = true;
                document.head.appendChild(script);
            }
        } catch (error) {
            console.error(error);
        }
    }

    function showStatusCard() {
        const card = document.getElementById("status-card");
        if (!card) return;
        card.classList.remove("status-card-enter");
        void card.offsetWidth;
        card.style.display = "";
        card.classList.add("status-card-enter");
    }

    function resetStatusUI() {
        const fill = document.getElementById("progress-fill");
        const pctLabel = document.getElementById("pct-label");
        const phaseLabel = document.getElementById("phase-label");
        if (fill) fill.style.width = `0%`;
        if (pctLabel) pctLabel.textContent = `0%`;
        if (phaseLabel) phaseLabel.textContent = "Initializing...";
        ["stat-found", "stat-processed", "stat-enriched"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.textContent = "0";
        });
        const icon = document.getElementById("status-icon");
        const headline = document.getElementById("status-headline");
        const subtext = document.getElementById("status-subtext");
        if (icon) icon.className = "fas fa-satellite-dish spin-slow";
        if (headline) headline.textContent = "Extracting Data...";
        if (subtext) subtext.textContent = "Moving job from queue to active thread...";
        showStatusCard();
    }

    function updateDashboardUi(status) {
        const headline = document.getElementById("status-headline");
        const subtext = document.getElementById("status-subtext");
        const icon = document.getElementById("status-icon");
        const card = document.getElementById("status-card");
        if (!headline || !card) return;
        card.className = "status-card";
        if (status === "running") {
            card.classList.add("state-working", "phase-scraping");
            if (!headline.textContent.includes("(")) headline.textContent = "Job Active";
            if (!subtext.textContent.includes("Current:")) subtext.textContent = "Processing data...";
            if (icon) icon.className = "fas fa-circle-notch fa-spin";
            showStatusCard();
        } else if (status === "completed") {
            card.classList.add("phase-complete");
            headline.textContent = "Job Completed";
            subtext.textContent = "Check your email for results.";
            if (icon) icon.className = "fas fa-check-circle";
            const fill = document.getElementById("progress-fill");
            const pct = document.getElementById("pct-label");
            const phase = document.getElementById("phase-label");
            if (fill) fill.style.width = "100%";
            if (pct) pct.textContent = "100%";
            if (phase) phase.textContent = "Phase 3/3: Complete";
            showStatusCard();
        } else if (status === "failed") {
            card.classList.add("phase-error");
            headline.textContent = "Job Failed";
            subtext.textContent = "Please check job history or try again.";
            if (icon) icon.className = "fas fa-times-circle";
            showStatusCard();
        } else {
            headline.textContent = "Ready to Start";
            subtext.textContent = "Waiting for input...";
            if (icon) icon.className = "fas fa-play";
        }
    }

    function updateStatusCardPhase(phase) {
        const card = document.getElementById("status-card");
        const icon = document.getElementById("status-icon");
        const headline = document.getElementById("status-headline");
        if (!card) return;
        card.classList.remove("phase-scraping", "phase-ai", "phase-complete", "phase-error");
        if (phase === "discovery") {
            card.classList.add("phase-scraping");
            if (icon) icon.className = "fas fa-map-marked-alt spin-slow";
            if (headline && !headline.textContent.includes("(")) headline.textContent = "Scanning Area...";
        } else if (phase === "scraping") {
            card.classList.add("phase-scraping");
            if (icon) icon.className = "fas fa-satellite-dish spin-slow";
            if (headline) headline.textContent = "Extracting Data...";
        } else if (phase === "ai") {
            card.classList.add("phase-ai");
            if (icon) icon.className = "fas fa-brain spin-slow";
            if (headline) headline.textContent = "AI Analysis Active...";
        } else if (phase === "complete") {
            card.classList.add("phase-complete");
            if (icon) icon.className = "fas fa-check-circle";
            if (headline) headline.textContent = "Job Completed";
        }
    }

    window.rtrlApp.refreshUsageTracker = refreshUsageTracker;
    window.rtrlApp.loadGoogleMaps = loadGoogleMaps;
    window.rtrlApp.resetStatusUI = resetStatusUI;
    window.rtrlApp.showStatusCard = showStatusCard;
    window.rtrlApp.updateDashboardUi = updateDashboardUi;
    window.rtrlApp.updateStatusCardPhase = updateStatusCardPhase;
})();
