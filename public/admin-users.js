let allUsers = [];
let currentSession = null;

document.addEventListener("DOMContentLoaded", async () => {
    currentSession = await initAdminCore();
    if (!currentSession) return;
    
    fetchAndRenderUsers();
    
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
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentSession.access_token}` },
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
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const adminTodayStr = `${year}-${month}-${day}`;
    
    // CHANGED: Set Global limit to 1500 per your request
    const SYSTEM_MAX = 1500;

    users.forEach(u => { 
        let effectiveUsage = u.usage_today || 0;
        if (u.last_reset_date && u.last_reset_date < adminTodayStr) {
            effectiveUsage = 0;
        }
        totalUsage += effectiveUsage;
    });

    document.getElementById('stat-team-count').textContent = users.length;
    document.getElementById('stat-total-usage').textContent = `${totalUsage} / ${SYSTEM_MAX}`;
    
    const pct = (totalUsage / SYSTEM_MAX) * 100;
    const bar = document.getElementById('stat-usage-bar');
    if (bar) bar.style.width = Math.min(pct, 100) + "%";
    
    // Added color logic for the global bar
    if (bar) bar.style.backgroundColor = pct > 100 ? '#ef4444' : '#22c55e';
    
    document.getElementById('stat-usage-pct').textContent = (pct > 0 && pct < 1 ? pct.toFixed(1) : Math.round(pct)) + "% used";
}


function renderUserRows(users) {
    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const adminTodayStr = `${year}-${month}-${day}`;

    users.forEach(u => {
        let usage = u.usage_today || 0;
        if (u.last_reset_date && u.last_reset_date < adminTodayStr) {
            usage = 0;
        }

        const limit = u.daily_limit || 500;
        const usagePct = Math.min((usage / limit) * 100, 100);
        
        // LOGIC: Determine Badge Class
        const roleClass = u.role === 'admin' ? 'role-badge-admin' : 'role-badge-user';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div class="member-cell">
                    <div class="avatar">${u.email.charAt(0).toUpperCase()}</div>
                    <div>
                        <div style="font-weight:600; color:#1e293b;">${u.email}</div>
                        <div style="font-size:0.75rem;color:#94a3b8">ID: ${u.id.substring(0,8)}...</div>
                    </div>
                </div>
            </td>
            <td><span class="role-badge ${roleClass}">${u.role.toUpperCase()}</span></td>
            <td>
                <div style="font-weight:600;font-size:0.85rem; margin-bottom:4px;">${usage} / ${limit}</div>
                <div class="stat-progress-bg" style="width:100px;margin:0; height:6px;">
                    <div class="stat-progress-fill" style="width:${usagePct}%;background:${usagePct > 90 ? '#ef4444' : '#22c55e'}"></div>
                </div>
            </td>
            <td>
                <select class="limit-select" onchange="updateUserLimit('${u.id}', this.value)">
                    <option value="100" ${limit == 100 ? 'selected' : ''}>100 (Starter)</option>
                    <option value="250" ${limit == 250 ? 'selected' : ''}>250 (Basic)</option>
                    <option value="500" ${limit == 500 ? 'selected' : ''}>500 (Standard)</option>
                    <option value="1000" ${limit == 1000 ? 'selected' : ''}>1000 (Power)</option>
                    <option value="5000" ${limit == 5000 ? 'selected' : ''}>5000 (Executive)</option>
                </select>
            </td>
            <td>
                <div style="display:flex;gap:8px">
                    <button onclick="promoteUser('${u.id}','${u.role}')" class="btn-ghost" title="Toggle Admin Role"><i class="fas fa-user-shield"></i></button>
                    <button onclick="deleteUser('${u.id}')" class="btn-ghost" style="color:#ef4444" title="Remove User"><i class="fas fa-trash"></i></button>
                </div>
            </td>`;
        tbody.appendChild(row);
    });
}


async function updateUserLimit(id, val) { await supabaseClient.from('profiles').update({ daily_limit: parseInt(val) }).eq('id', id); fetchAndRenderUsers(); }
async function promoteUser(id, curr) { 
    const next = curr === 'admin' ? 'user' : 'admin';
    if (confirm(`Change to ${next.toUpperCase()}?`)) { await supabaseClient.from('profiles').update({ role: next }).eq('id', id); fetchAndRenderUsers(); }
}
async function deleteUser(id) { if (confirm("Remove user?")) { await supabaseClient.from('profiles').delete().eq('id', id); fetchAndRenderUsers(); } }