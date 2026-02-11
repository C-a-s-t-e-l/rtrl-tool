const SUPABASE_URL = window.CONFIG.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.CONFIG.SUPABASE_ANON_KEY;
const BACKEND_URL = "https://backend.rtrlprospector.space";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener("DOMContentLoaded", async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    // 1. BOUNCER: Redirect if not logged in or not Admin
    if (!session) return window.location.href = "index.html";
    
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

    if (!profile || profile.role !== 'admin') {
        alert("Access Denied");
        window.location.href = "index.html";
    }

    // 2. Fetch and Render Users
    fetchAndRenderUsers();

    // 3. Modal Controls
    document.getElementById('open-invite-modal').onclick = () => document.getElementById('invite-modal').style.display = 'flex';
    document.getElementById('close-modal').onclick = () => document.getElementById('invite-modal').style.display = 'none';

    // 4. Send Invite Logic
    document.getElementById('send-invite-btn').onclick = async () => {
        const email = document.getElementById('invite-email').value;
        const btn = document.getElementById('send-invite-btn');
        btn.disabled = true;
        btn.textContent = "Sending...";

        try {
            const response = await fetch(`${BACKEND_URL}/api/admin/invite`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ email })
            });
            if(response.ok) {
                alert("Invite sent successfully!");
                location.reload();
            } else {
                const err = await response.json();
                alert("Error: " + err.error);
            }
        } finally {
            btn.disabled = false;
            btn.textContent = "Send Invite";
        }
    };
});

async function fetchAndRenderUsers() {
    const { data: users, error } = await supabase
        .from('profiles')
        .select('*')
        .order('email');

    const tbody = document.getElementById('user-table-body');
    tbody.innerHTML = "";

    let totalUsage = 0;

    users.forEach(u => {
        totalUsage += u.usage_today;
        const row = `
            <tr>
                <td>${u.email}</td>
                <td><span class="badge ${u.role}">${u.role}</span></td>
                <td><span class="usage-pill">${u.usage_today}</span></td>
                <td>
                    <select onchange="updateUserLimit('${u.id}', this.value)">
                        <option value="250" ${u.daily_limit == 250 ? 'selected' : ''}>250</option>
                        <option value="500" ${u.daily_limit == 500 ? 'selected' : ''}>500</option>
                        <option value="1000" ${u.daily_limit == 1000 ? 'selected' : ''}>1000</option>
                        <option value="5000" ${u.daily_limit == 5000 ? 'selected' : ''}>Unlimited</option>
                    </select>
                </td>
                <td>
                    <button onclick="deleteUser('${u.id}')" class="btn-icon text-red"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });

    // Update Gemini health bar
    const geminiPct = (totalUsage / 1500) * 100;
    document.getElementById('gemini-bar').style.width = geminiPct + "%";
    document.getElementById('gemini-text').textContent = `${totalUsage} / 1500 daily credits used`;
}

async function updateUserLimit(userId, newLimit) {
    const { error } = await supabase
        .from('profiles')
        .update({ daily_limit: parseInt(newLimit) })
        .eq('id', userId);
    
    if (error) alert("Failed to update: " + error.message);
}