const SB_URL = window.CONFIG.SUPABASE_URL;
const SB_KEY = window.CONFIG.SUPABASE_ANON_KEY;
const API_URL = "https://backend.rtrlprospector.space";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

let allUsers = [];

document.addEventListener("DOMContentLoaded", async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return window.location.href = "index.html";
    
    const { data: profile } = await supabaseClient.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || profile.role !== 'admin') {
        window.location.href = "index.html";
        return;
    }

    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    
    toggleBtn.onclick = () => {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
    };

    if(localStorage.getItem('sidebar-collapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }

    fetchAndRenderUsers();
    initKillSwitch();

    const modal = document.getElementById('invite-modal');
    document.getElementById('open-invite-modal').onclick = () => modal.style.display = 'flex';
    document.getElementById('close-modal').onclick = () => modal.style.display = 'none';
    document.getElementById('cancel-modal-btn').onclick = () => modal.style.display = 'none';

    document.getElementById('user-search').oninput = (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter(u => u.email.toLowerCase().includes(term));
        renderUserRows(filtered);
    };

    document.getElementById('send-invite-btn').onclick = async () => {
        const email = document.getElementById('invite-email').value;
        if (!email) return;
        const btn = document.getElementById('send-invite-btn');
        btn.disabled = true;
        try {
            const res = await fetch(`${API_URL}/api/admin/invite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify({ email })
            });
            if (res.ok) { alert("Invite sent!"); location.reload(); }
            else { const err = await res.json(); alert(err.error); }
        } catch (e) { alert("Failed to send invite"); }
        finally { btn.disabled = false; }
    };
});

async function fetchAndRenderUsers() {
    const { data: users, error } = await supabaseClient.from('profiles').select('*').order('email');
    if (error) return;
    allUsers = users;
    renderUserRows(users);
    updateSummaryStats(users);
}

function updateSummaryStats(users) {
    let totalUsage = 0;
    const SYSTEM_MAX = 1500;
    users.forEach(u => { totalUsage += (u.usage_today || 0); });

    document.getElementById('stat-team-count').textContent = users.length;
    document.getElementById('stat-total-usage').textContent = `${totalUsage.toLocaleString()} / ${SYSTEM_MAX.toLocaleString()}`;
    
    const pct = (totalUsage / SYSTEM_MAX) * 100;
    const bar = document.getElementById('stat-usage-bar');
    const pctText = document.getElementById('stat-usage-pct');
    
    if (bar) bar.style.width = Math.min(pct, 100) + "%";
    if (pctText) pctText.textContent = (pct > 0 && pct < 1 ? pct.toFixed(1) : Math.round(pct)) + "% used";
}

function renderUserRows(users) {
    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    users.forEach(u => {
        const usage = u.usage_today || 0;
        const limit = u.daily_limit || 500;
        const initial = u.email ? u.email.charAt(0).toUpperCase() : '?';
        const usagePct = Math.min((usage / limit) * 100, 100);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div class="member-cell">
                    <div class="avatar">${initial}</div>
                    <div>
                        <div style="font-weight: 600;">${u.email}</div>
                        <div style="font-size: 0.7rem; color: #94a3b8; font-family: monospace;">${u.id.substring(0,8)}...</div>
                    </div>
                </div>
            </td>
            <td><span class="role-badge">${u.role.toUpperCase()}</span></td>
            <td>
                <div style="font-weight: 600; font-size: 0.8rem; margin-bottom: 4px;">${usage} / ${limit}</div>
                <div class="stat-progress-bg" style="width: 100px; margin: 0;">
                    <div class="stat-progress-fill" style="width: ${usagePct}%; background: ${usagePct > 90 ? '#ef4444' : '#22c55e'}"></div>
                </div>
            </td>
            <td>
                <select class="limit-select" onchange="updateUserLimit('${u.id}', this.value)">
                    <option value="100" ${limit == 100 ? 'selected' : ''}>100 (Starter)</option>
                    <option value="250" ${limit == 250 ? 'selected' : ''}>250 (Basic)</option>
                    <option value="500" ${limit == 500 ? 'selected' : ''}>500 (Standard)</option>
                    <option value="1000" ${limit == 1000 ? 'selected' : ''}>1000 (Power)</option>
                    <option value="5000" ${limit == 5000 ? 'selected' : ''}>Unlimited</option>
                </select>
            </td>
            <td>
                <div style="display: flex; gap: 4px;">
                    <button onclick="promoteUser('${u.id}', '${u.role}')" class="btn-ghost" title="Change Role"><i class="fas fa-user-tag"></i></button>
                    <button onclick="deleteUser('${u.id}')" class="btn-ghost" style="color: #ef4444;" title="Remove User"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function updateUserLimit(userId, newLimit) {
    await supabaseClient.from('profiles').update({ daily_limit: parseInt(newLimit) }).eq('id', userId);
    fetchAndRenderUsers();
}

async function promoteUser(userId, currentRole) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    if (!confirm(`Change user to ${newRole.toUpperCase()}?`)) return;
    await supabaseClient.from('profiles').update({ role: newRole }).eq('id', userId);
    fetchAndRenderUsers();
}

async function deleteUser(userId) {
    if (!confirm("Are you sure? This will remove their tool access.")) return;
    await supabaseClient.from('profiles').delete().eq('id', userId);
    fetchAndRenderUsers();
}

async function initKillSwitch() {
    const killBtn = document.getElementById('global-kill-switch');
    let { data: settings } = await supabaseClient.from('system_settings').select('is_paused').single();
    
    const updateUI = (paused) => {
        killBtn.innerHTML = paused ? '<i class="fas fa-play"></i> <span class="nav-text">Resume Systems</span>' : '<i class="fas fa-power-off"></i> <span class="nav-text">Emergency Stop</span>';
        killBtn.style.background = paused ? "#22c55e" : "#ef4444";
    };

    if (settings) updateUI(settings.is_paused);

    killBtn.onclick = async () => {
        const { data: current } = await supabaseClient.from('system_settings').select('is_paused').single();
        const newState = !current.is_paused;
        await supabaseClient.from('system_settings').update({ is_paused: newState }).eq('id', 1);
        updateUI(newState);
    };
}