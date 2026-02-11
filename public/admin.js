// 1. CONFIGURATION - Using different names to avoid browser collision
const SB_URL = window.CONFIG.SUPABASE_URL;
const SB_KEY = window.CONFIG.SUPABASE_ANON_KEY;
const API_URL = "https://backend.rtrlprospector.space";

// Create the client with a unique name
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

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
        alert("Access Denied: Admins Only");
        window.location.href = "index.html";
        return;
    }

    // 3. INITIALIZE DASHBOARD
    fetchAndRenderUsers();
    initKillSwitch();

    // 4. MODAL & INVITE HANDLERS
    const inviteModal = document.getElementById('invite-modal');
    document.getElementById('open-invite-modal').onclick = () => inviteModal.style.display = 'flex';
    document.getElementById('close-modal').onclick = () => inviteModal.style.display = 'none';

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
                alert("Invitation sent to " + email);
                inviteModal.style.display = 'none';
                location.reload();
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

// 5. USER MANAGEMENT LOGIC
async function fetchAndRenderUsers() {
    const { data: users, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .order('role', { ascending: true });

    if (error) {
        console.error("Fetch error:", error);
        const tbody = document.getElementById('user-table-body');
        tbody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center;">Error: ${error.message}. Check SQL RLS Policies.</td></tr>`;
        return;
    }

    const tbody = document.getElementById('user-table-body');
    tbody.innerHTML = "";
    let totalUsage = 0;

    users.forEach(u => {
        const usage = u.usage_today || 0;
        const limit = u.daily_limit || 500;
        totalUsage += usage;
        
        const usagePct = Math.min((usage / limit) * 100, 100);

        const row = `
            <tr>
                <td>
                    <div style="font-weight: 600; color: #1e293b;">${u.email}</div>
                    <div style="font-size: 0.7rem; color: #94a3b8;">${u.id}</div>
                </td>
                <td><span class="role-badge role-${u.role}">${u.role}</span></td>
                <td>
                    <div style="font-weight: 700; margin-bottom: 4px;">${usage} / ${limit}</div>
                    <div class="usage-mini-bar">
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
                    <div style="display: flex; gap: 8px;">
                        <button onclick="promoteUser('${u.id}', '${u.role}')" class="btn-secondary-small" title="Toggle Admin/User">
                            <i class="fas fa-user-shield"></i>
                        </button>
                        <button onclick="deleteUser('${u.id}')" class="btn-secondary-small" style="color: #ef4444;" title="Delete User">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });

    const totalPct = Math.min((totalUsage / 1500) * 100, 100);
    const bar = document.getElementById('gemini-bar');
    const text = document.getElementById('gemini-text');
    if (bar) bar.style.width = totalPct + "%";
    if (text) text.textContent = `${totalUsage} / 1500 daily credits used`;
}

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
    if (!confirm(`Change this user to ${newRole.toUpperCase()}?`)) return;

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

async function initKillSwitch() {
    const killBtn = document.getElementById('global-kill-switch');
    let { data: settings } = await supabaseClient.from('system_settings').select('is_paused').single();
    
    const updateUI = (paused) => {
        if (paused) {
            killBtn.innerHTML = '<i class="fas fa-play"></i> Resume Systems';
            killBtn.style.background = "#10b981"; 
        } else {
            killBtn.innerHTML = '<i class="fas fa-power-off"></i> Emergency Stop';
            killBtn.style.background = "#ef4444"; 
        }
    };

    if(settings) updateUI(settings.is_paused);

    killBtn.onclick = async () => {
        const { data: current } = await supabaseClient.from('system_settings').select('is_paused').single();
        const newState = !current.is_paused;
        const { error } = await supabaseClient.from('system_settings').update({ is_paused: newState }).eq('id', 1);
        if (!error) {
            updateUI(newState);
            alert(newState ? "All searching PAUSED." : "Systems RESUMED.");
        }
    };
}