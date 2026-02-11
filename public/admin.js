const SB_URL = window.CONFIG.SUPABASE_URL;
const SB_KEY = window.CONFIG.SUPABASE_ANON_KEY;
const API_URL = "https://backend.rtrlprospector.space";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);
let allUsers = [];
document.addEventListener("DOMContentLoaded", async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return window.location.href = "index.html";
    const { data: profile } = await supabaseClient.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || profile.role !== 'admin') { window.location.href = "index.html"; return; }
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
        };
        if(localStorage.getItem('sidebar-collapsed') === 'true') sidebar.classList.add('collapsed');
    }
    fetchAndRenderUsers();
    initKillSwitch();
    const modal = document.getElementById('invite-modal');
    document.getElementById('open-invite-modal').onclick = () => modal.style.display = 'flex';
    document.getElementById('close-modal').onclick = () => modal.style.display = 'none';
    document.getElementById('cancel-modal-btn').onclick = () => modal.style.display = 'none';
    document.getElementById('user-search').oninput = (e) => {
        const term = e.target.value.toLowerCase();
        renderUserRows(allUsers.filter(u => u.email.toLowerCase().includes(term)));
    };
    document.getElementById('send-invite-btn').onclick = async () => {
        const email = document.getElementById('invite-email').value;
        if (!email) return;
        try {
            const res = await fetch(`${API_URL}/api/admin/invite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify({ email })
            });
            if (res.ok) { alert("Invite sent!"); location.reload(); }
        } catch (e) { alert("Failed"); }
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
    document.getElementById('stat-total-usage').textContent = `${totalUsage} / ${SYSTEM_MAX}`;
    const pct = (totalUsage / SYSTEM_MAX) * 100;
    const bar = document.getElementById('stat-usage-bar');
    if (bar) bar.style.width = Math.min(pct, 100) + "%";
    document.getElementById('stat-usage-pct').textContent = (pct > 0 && pct < 1 ? pct.toFixed(1) : Math.round(pct)) + "% used";
}
function renderUserRows(users) {
    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;
    tbody.innerHTML = "";
    users.forEach(u => {
        const usage = u.usage_today || 0;
        const limit = u.daily_limit || 500;
        const usagePct = Math.min((usage / limit) * 100, 100);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><div class="member-cell"><div class="avatar">${u.email.charAt(0).toUpperCase()}</div><div><div style="font-weight:600">${u.email}</div><div style="font-size:0.7rem;color:#94a3b8">${u.id.substring(0,8)}...</div></div></div></td>
            <td><span class="role-badge">${u.role.toUpperCase()}</span></td>
            <td><div style="font-weight:600;font-size:0.8rem">${usage} / ${limit}</div><div class="stat-progress-bg" style="width:80px;margin:0"><div class="stat-progress-fill" style="width:${usagePct}%;background:${usagePct > 90 ? '#ef4444' : '#22c55e'}"></div></div></td>
            <td><select class="limit-select" onchange="updateUserLimit('${u.id}', this.value)">
                <option value="100" ${limit == 100 ? 'selected' : ''}>100 (Starter)</option>
                <option value="500" ${limit == 500 ? 'selected' : ''}>500 (Standard)</option>
                <option value="1000" ${limit == 1000 ? 'selected' : ''}>1000 (Power)</option>
                <option value="5000" ${limit == 5000 ? 'selected' : ''}>5000 (Executive)</option
            </select></td>
            <td><div style="display:flex;gap:4px"><button onclick="promoteUser('${u.id}','${u.role}')" class="btn-ghost"><i class="fas fa-user-tag"></i></button><button onclick="deleteUser('${u.id}')" class="btn-ghost" style="color:#ef4444"><i class="fas fa-trash"></i></button></div></td>`;
        tbody.appendChild(row);
    });
}
async function updateUserLimit(id, val) { await supabaseClient.from('profiles').update({ daily_limit: parseInt(val) }).eq('id', id); fetchAndRenderUsers(); }
async function promoteUser(id, curr) { 
    const next = curr === 'admin' ? 'user' : 'admin';
    if (confirm(`Change to ${next.toUpperCase()}?`)) { await supabaseClient.from('profiles').update({ role: next }).eq('id', id); fetchAndRenderUsers(); }
}
async function deleteUser(id) { if (confirm("Remove user?")) { await supabaseClient.from('profiles').delete().eq('id', id); fetchAndRenderUsers(); } }
async function initKillSwitch() {
    const btn = document.getElementById('global-kill-switch');
    let { data: s } = await supabaseClient.from('system_settings').select('is_paused').single();
    const up = (p) => { btn.innerHTML = p ? '<i class="fas fa-play"></i> <span class="nav-text">Resume Systems</span>' : '<i class="fas fa-power-off"></i> <span class="nav-text">Emergency Stop</span>'; };
    if (s) up(s.is_paused);
    btn.onclick = async () => {
        let { data: c } = await supabaseClient.from('system_settings').select('is_paused').single();
        await supabaseClient.from('system_settings').update({ is_paused: !c.is_paused }).eq('id', 1);
        up(!c.is_paused);
    };
}