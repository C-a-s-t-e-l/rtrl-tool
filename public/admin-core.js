window.CONFIG = {
    SUPABASE_URL: "https://qbktnernawpprarckvzx.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFia3RuZXJuYXdwcHJhcmNrdnp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1OTQ3NTgsImV4cCI6MjA3MzE3MDc1OH0.9asOynIZEOqc8f_mNTjWTNXIPK1ph6IQF6ADbYdFclM"
};

const SB_URL = window.CONFIG.SUPABASE_URL;
const SB_KEY = window.CONFIG.SUPABASE_ANON_KEY;
const API_URL = "https://backend.rtrlprospector.space";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

async function initAdminCore() {
    const layout = document.getElementById('admin-page-content');
    const unauthorized = document.getElementById('unauthorized-msg');

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();

        if (!session) {
            window.location.replace("index.html");
            return null;
        }

        const { data: profile, error } = await supabaseClient
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .single();

        if (error || !profile || profile.role !== 'admin') {
            // User is not an admin: Show 404 look then redirect
            if (layout) layout.style.display = 'none';
            if (unauthorized) unauthorized.style.display = 'flex';
            
            setTimeout(() => {
                window.location.replace("index.html");
            }, 1000);
            return null;
        }

        // USER IS ADMIN: Reveal the page
        if (unauthorized) unauthorized.style.display = 'none';
        if (layout) layout.style.display = 'flex';

        // Setup Sidebar logic
        const sidebar = document.getElementById('sidebar');
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn && sidebar) {
            toggleBtn.onclick = () => {
                sidebar.classList.toggle('collapsed');
                localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
            };
            if(localStorage.getItem('sidebar-collapsed') === 'true') sidebar.classList.add('collapsed');
        }

        initKillSwitch();
        return session;

    } catch (err) {
        console.error("Auth System Error:", err);
        window.location.replace("index.html");
        return null;
    }
}

// Global Modal Helpers
window.adminAlert = (title, message, type = 'info') => showModal(type, title, message);
window.adminConfirm = (title, message, onConfirm, type = 'info') => showModal(type, title, message, onConfirm);

function showModal(type, title, message, onConfirm = null) {
    const modal = document.getElementById('generic-modal');
    const iconEl = document.getElementById('modal-icon');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const actionsEl = document.getElementById('modal-actions');

    if(!modal) return;

    titleEl.textContent = title;
    msgEl.textContent = message;
    actionsEl.innerHTML = ''; 

    if (onConfirm) {
        const cBtn = document.createElement('button');
        cBtn.className = 'btn-ghost';
        cBtn.textContent = 'Cancel';
        cBtn.style.border = '1px solid #e2e8f0';
        cBtn.style.padding = '8px 16px';
        cBtn.onclick = () => modal.style.display = 'none';

        const okBtn = document.createElement('button');
        okBtn.className = 'btn-primary-blue';
        okBtn.textContent = type === 'danger' ? 'Yes, Proceed' : 'Confirm';
        if (type === 'danger') okBtn.style.backgroundColor = '#ef4444';
        okBtn.onclick = () => { modal.style.display = 'none'; onConfirm(); };

        actionsEl.appendChild(cBtn);
        actionsEl.appendChild(okBtn);
    } else {
        const okBtn = document.createElement('button');
        okBtn.className = 'btn-primary-blue';
        okBtn.textContent = 'Okay';
        okBtn.onclick = () => modal.style.display = 'none';
        actionsEl.appendChild(okBtn);
    }

    modal.style.display = 'flex';
}

async function initKillSwitch() {
    const btn = document.getElementById('global-kill-switch');
    if(!btn) return;
    let { data: s } = await supabaseClient.from('system_settings').select('is_paused').single();
    const up = (p) => { 
        btn.innerHTML = p ? '<i class="fas fa-play"></i> <span class="nav-text">Resume Systems</span>' : '<i class="fas fa-power-off"></i> <span class="nav-text">Emergency Stop</span>'; 
        btn.style.borderColor = p ? '#22c55e' : 'rgba(255,255,255,0.2)';
    };
    if (s) up(s.is_paused);
    btn.onclick = async () => {
        let { data: c } = await supabaseClient.from('system_settings').select('is_paused').single();
        const action = c.is_paused ? 'Resume' : 'Stop';
        window.adminConfirm(`${action} Systems?`, `Are you sure you want to ${action.toLowerCase()} all scraping?`, async () => {
            await supabaseClient.from('system_settings').update({ is_paused: !c.is_paused }).eq('id', 1);
            up(!c.is_paused);
        });
    };
}