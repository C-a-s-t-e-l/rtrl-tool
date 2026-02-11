// 1. CONFIGURATION
const SB_URL = window.CONFIG.SUPABASE_URL;
const SB_KEY = window.CONFIG.SUPABASE_ANON_KEY;
const API_URL = "https://backend.rtrlprospector.space";

const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

let allUsers = []; // Global cache to allow searching without re-fetching

document.addEventListener("DOMContentLoaded", async () => {
    // 2. AUTHENTICATION BOUNCER
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (!session) return window.location.href = "index.html";
    
    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

    if (!profile || profile.role !== 'admin') {
        window.location.href = "index.html";
        return;
    }

    // 3. INITIALIZE DASHBOARD
    fetchAndRenderUsers();
    initKillSwitch();

    // 4. SEARCH LOGIC
    const searchInput = document.getElementById('user-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = allUsers.filter(u => 
                u.email.toLowerCase().includes(term) || 
                u.id.toLowerCase().includes(term)
            );
            renderUserRows(filtered);
        });
    }

    // 5. MODAL & INVITE HANDLERS
    const inviteModal = document.getElementById('invite-modal');
    document.getElementById('open-invite-modal').onclick = () => inviteModal.style.display = 'flex';
    document.getElementById('close-modal').onclick = () => inviteModal.style.display = 'none';
    document.getElementById('cancel-modal-btn').onclick = () => inviteModal.style.display = 'none';

    document.getElementById('send-invite-btn').onclick = async () => {
        const email = document.getElementById('invite-email').value;
        const btn = document.getElementById('send-invite-btn');
        if (!email) return alert("Please enter an email");

        btn.disabled = true;
        btn.textContent = "Sending...";

        try {
            const response = await fetch(`${API_URL}/api/admin/invite`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ email })
            });
            if(response.ok) {
                alert("Invitation sent successfully!");
                inviteModal.style.display = 'none';
                fetchAndRenderUsers(); // Refresh list
            } else {
                const err = await response.json();
                alert("Invite failed: " + err.error);
            }
        } finally {
            btn.disabled = false;
            btn.textContent = "Send Invite";
        }
    };
});

// 6. FETCHING DATA
async function fetchAndRenderUsers() {
    const { data: users, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .order('email', { ascending: true });

    if (error) return console.error("Fetch error:", error);

    allUsers = users; // Save to cache
    updateSummaryStats(users);
    renderUserRows(users);
}

// 7. SUMMARY STATS (The 3 cards at the top)
function updateSummaryStats(users) {
    let totalUsage = 0;
    let totalLimit = 0;

    users.forEach(u => {
        totalUsage += (u.usage_today || 0);
        totalLimit += (u.daily_limit || 0);
    });

    document.getElementById('stat-team-count').textContent = users.length;
    document.getElementById('stat-total-usage').textContent = `${totalUsage.toLocaleString()} / ${totalLimit.toLocaleString()}`;
    document.getElementById('stat-daily-limit').textContent = totalLimit.toLocaleString();
    
    const pct = totalLimit > 0 ? Math.min(Math.round((totalUsage / totalLimit) * 100), 100) : 0;
    const bar = document.getElementById('stat-usage-bar');
    const pctText = document.getElementById('stat-usage-pct');
    
    if (bar) bar.style.width = pct + "%";
    if (pctText) pctText.textContent = `${pct}% used`;
}

// 8. TABLE RENDERING
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
                        <div style="font-weight: 600; color: #1e293b;">${u.email}</div>
                        <div style="font-size: 0.75rem; color: #94a3b8;">${u.id.substring(0,8)}...</div>
                    </div>
                </div>
            </td>
            <td><span class="role-badge">${u.role.toUpperCase()}</span></td>
            <td>
                <div style="font-weight: 600; margin-bottom: 4px;">${usage} / ${limit}</div>
                <div class="usage-mini-bar" style="width: 100px;">
                    <div class="usage-mini-fill" style="width: ${usagePct}%"></div>
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
                <div style="display: flex; gap: 10px;">
                    <button onclick="promoteUser('${u.id}', '${u.role}')" class="btn-ghost" style="padding: 5px 10px;" title="Change Role">
                        <i class="fas fa-user-tag"></i>
                    </button>
                    <button onclick="deleteUser('${u.id}')" class="btn-ghost" style="color: #ef4444; padding: 5px 10px;" title="Remove User">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// 9. ACTION FUNCTIONS
async function updateUserLimit(userId, newLimit) {
    const { error } = await supabaseClient
        .from('profiles')
        .update({ daily_limit: parseInt(newLimit) })
        .eq('id', userId);
    
    if (error) alert("Update failed: " + error.message);
    else fetchAndRenderUsers();
}

async function promoteUser(userId, currentRole) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    if (!confirm(`Change user to ${newRole.toUpperCase()}?`)) return;

    const { error } = await supabaseClient
        .from('profiles')
        .update({ role: newRole })
        .eq('id', userId);
    
    if (error) alert(error.message);
    else fetchAndRenderUsers();
}

async function deleteUser(userId) {
    if (!confirm("Are you sure? This will remove their access to the tool.")) return;
    const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);
    if (error) alert(error.message);
    else fetchAndRenderUsers();
}

// 10. KILL SWITCH
async function initKillSwitch() {
    const killBtn = document.getElementById('global-kill-switch');
    let { data: settings } = await supabaseClient.from('system_settings').select('is_paused').single();
    
    const updateUI = (paused) => {
        killBtn.innerHTML = paused ? '<i class="fas fa-play"></i> Resume Systems' : '<i class="fas fa-power-off"></i> Emergency Stop';
        killBtn.style.background = paused ? "#22c55e" : "#ef4444";
    };

    if (settings) updateUI(settings.is_paused);

    killBtn.onclick = async () => {
        const { data: current } = await supabaseClient.from('system_settings').select('is_paused').single();
        const newState = !current.is_paused;
        const { error } = await supabaseClient.from('system_settings').update({ is_paused: newState }).eq('id', 1);
        if (!error) {
            updateUI(newState);
            alert(newState ? "Scraping PAUSED for all users." : "Scraping RESUMED.");
        }
    };
}