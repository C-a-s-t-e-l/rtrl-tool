window.rtrlApp = window.rtrlApp || {};

window.rtrlApp.usage = (function () {
    function update(profile) {
        const current = profile.usage_today || 0;
        const limit = profile.daily_limit || 500;
        const pct = Math.min((current / limit) * 100, 100);

        // Update Numbers
        const curEl = document.getElementById('dash-usage-current');
        const limEl = document.getElementById('dash-usage-limit');
        if (curEl) curEl.textContent = current;
        if (limEl) limEl.textContent = limit;
        
        // Update Progress Bar
        const fill = document.getElementById('dash-usage-fill');
        if (fill) fill.style.width = `${pct}%`;
        
        // Update Labels
        const pctLabel = document.getElementById('usage-percentage-label');
        if (pctLabel) pctLabel.textContent = `${Math.round(pct)}% consumed`;
        
        // Plan Badge & Styles
        const badge = document.getElementById('dash-plan-badge');
        const card = document.getElementById('usage-dashboard-card');
        const statusText = document.getElementById('usage-status-text');

        if (!badge || !card || !statusText) return;

        let planName = "Starter Plan";
        badge.className = "plan-badge-large";

        if (limit >= 5000) { planName = "Unlimited Plan"; badge.classList.add('plan-unlimited'); }
        else if (limit >= 1000) { planName = "Power Plan"; badge.classList.add('plan-power'); }
        else if (limit >= 500) { planName = "Standard Plan"; }
        
        badge.textContent = planName;

        card.classList.remove('usage-warning', 'usage-danger');
        if (pct >= 100) {
            card.classList.add('usage-danger');
            statusText.textContent = "Daily limit reached";
        } else if (pct > 80) {
            card.classList.add('usage-warning');
            statusText.textContent = "Nearing daily limit";
        } else {
            statusText.textContent = "Account in good standing";
        }
    }

    function incrementLocal() {
        const currentEl = document.getElementById('dash-usage-current');
        const limitEl = document.getElementById('dash-usage-limit');
        if (!currentEl || !limitEl) return;

        let current = parseInt(currentEl.textContent) + 1;
        let limit = parseInt(limitEl.textContent);
        update({ usage_today: current, daily_limit: limit });
    }

    return { update, incrementLocal };
})();