let allUsers = [];
let currentSession = null;

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Initialize Core (Auth & Sidebar)
    currentSession = await initAdminCore();
    if (!currentSession) return;
    
    // 2. Load Data
    fetchAndRenderUsers();
    
    // 3. Setup Invite Modal Triggers
    const modal = document.getElementById('invite-modal');
    document.getElementById('open-invite-modal').onclick = () => modal.style.display = 'flex';
    document.getElementById('close-modal').onclick = () => modal.style.display = 'none';
    document.getElementById('cancel-modal-btn').onclick = () => modal.style.display = 'none';
    
    // 4. Setup Search
    document.getElementById('user-search').oninput = (e) => {
        const term = e.target.value.toLowerCase();
        renderUserRows(allUsers.filter(u => u.email.toLowerCase().includes(term)));
    };
    
    // 5. Setup Send Invite Handler
    document.getElementById('send-invite-btn').onclick = async () => {
        const email = document.getElementById('invite-email').value;
        
        if (!email) return;
        
        // Visual feedback state
        const btn = document.getElementById('send-invite-btn');
        const originalText = btn.textContent;
        btn.textContent = "Sending...";
        btn.disabled = true;

        try {
            const res = await fetch(`${API_URL}/api/admin/invite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentSession.access_token}` },
                body: JSON.stringify({ email })
            });
            
            const data = await res.json();
            modal.style.display = 'none'; // Close input modal

            if (res.ok) {
                window.adminAlert('Invitation Sent', `An invite has been sent to ${email}.`, 'success');
                // Reload after a short delay to allow user to read message
                setTimeout(() => location.reload(), 1500);
            } else {
                window.adminAlert('Invite Failed', data.error || 'Unknown error occurred.', 'danger');
            }
        } catch (e) {
            modal.style.display = 'none';
            window.adminAlert('System Error', 'Could not connect to server.', 'danger');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    };
});

async function fetchAndRenderUsers() {
    const { data: users, error } = await supabaseClient.from('profiles').select('*').order('email');
    if (error) {
        console.error('Error fetching users:', error);
        return;
    }
    allUsers = users;
    renderUserRows(users);
    updateSummaryStats(users);
}

function updateSummaryStats(users) {
    let totalUsage = 0;
    
    // Date Logic for Visual Reset
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const adminTodayStr = `${year}-${month}-${day}`;
    
    const SYSTEM_MAX = 1500; // Global Limit

    users.forEach(u => { 
        let effectiveUsage = u.usage_today || 0;
        // If last reset was previous day, count as 0 for display
        if (u.last_reset_date && u.last_reset_date < adminTodayStr) {
            effectiveUsage = 0;
        }
        totalUsage += effectiveUsage;
    });

    document.getElementById('stat-team-count').textContent = users.length;
    document.getElementById('stat-total-usage').textContent = `${totalUsage} / ${SYSTEM_MAX}`;
    
    const pct = (totalUsage / SYSTEM_MAX) * 100;
    const bar = document.getElementById('stat-usage-bar');
    if (bar) {
        bar.style.width = Math.min(pct, 100) + "%";
        // Color logic: Green normally, Red if over capacity
        bar.style.backgroundColor = pct > 100 ? '#ef4444' : '#22c55e';
    }
    
    document.getElementById('stat-usage-pct').textContent = (pct > 0 && pct < 1 ? pct.toFixed(1) : Math.round(pct)) + "% used";
}

function renderUserRows(users) {
    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    // Date Logic for Visual Reset
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const adminTodayStr = `${year}-${month}-${day}`;

    users.forEach(u => {
        let usage = u.usage_today || 0;
        // Visual Reset check
        if (u.last_reset_date && u.last_reset_date < adminTodayStr) {
            usage = 0;
        }

        const limit = u.daily_limit || 500;
        const usagePct = Math.min((usage / limit) * 100, 100);
        
        // Badge Logic
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

// Action: Update Limit (Direct Supabase)
async function updateUserLimit(id, val) { 
    await supabaseClient.from('profiles').update({ daily_limit: parseInt(val) }).eq('id', id); 
    fetchAndRenderUsers(); 
}

// Action: Promote/Demote User (With Safety Check)
async function promoteUser(id, curr) { 
    const next = curr === 'admin' ? 'user' : 'admin';
    
    // SAFETY: Prevent demoting last admin
    if (curr === 'admin' && next === 'user') {
        const adminCount = allUsers.filter(u => u.role === 'admin').length;
        if (adminCount <= 1) {
            window.adminAlert('Action Blocked', 'You cannot demote the last Administrator. There must always be at least one Admin.', 'danger');
            return;
        }
    }

    window.adminConfirm(
        'Confirm Role Change', 
        `Are you sure you want to change this user's role to ${next.toUpperCase()}?`,
        async () => {
            const { error } = await supabaseClient.from('profiles').update({ role: next }).eq('id', id);
            if (error) {
                window.adminAlert('Error', 'Failed to update role.', 'danger');
            } else {
                window.adminAlert('Success', 'User role updated successfully.', 'success');
                fetchAndRenderUsers();
            }
        }
    );
}

// Action: Delete User (Backend API + Safety Check)
async function deleteUser(id) { 
    const userToDelete = allUsers.find(u => u.id === id);
    if (!userToDelete) return;

    // SAFETY: Prevent deleting last admin
    if (userToDelete.role === 'admin') {
        const adminCount = allUsers.filter(u => u.role === 'admin').length;
        if (adminCount <= 1) {
            window.adminAlert('Action Blocked', 'You cannot delete the last Administrator.', 'danger');
            return;
        }
    }

    window.adminConfirm(
        'Delete User',
        `Are you sure you want to remove ${userToDelete.email}? This action cannot be undone.`,
        async () => {
            try {
                // Call Backend API to handle Auth deletion
                const res = await fetch(`${API_URL}/api/admin/users/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${currentSession.access_token}` }
                });

                if (res.ok) {
                    window.adminAlert('Deleted', 'User has been removed from the system.', 'success');
                    fetchAndRenderUsers();
                } else {
                    const data = await res.json();
                    window.adminAlert('Error', data.error || 'Failed to delete user.', 'danger');
                }
            } catch (e) {
                window.adminAlert('Error', 'Network error occurred.', 'danger');
            }
        },
        'danger'
    );
}