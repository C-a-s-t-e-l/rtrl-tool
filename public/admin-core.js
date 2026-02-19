window.CONFIG = {
    SUPABASE_URL: "https://qbktnernawpprarckvzx.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFia3RuZXJuYXdwcHJhcmNrdnp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1OTQ3NTgsImV4cCI6MjA3MzE3MDc1OH0.9asOynIZEOqc8f_mNTjWTNXIPK1ph6IQF6ADbYdFclM"
};

const SB_URL = window.CONFIG.SUPABASE_URL;
const SB_KEY = window.CONFIG.SUPABASE_ANON_KEY;
const API_URL = "https://backend.rtrlprospector.space";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

async function initAdminCore() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return window.location.href = "index.html";
    
    const { data: profile } = await supabaseClient.from('profiles').select('role').eq('id', session.user.id).single();
    if (!profile || profile.role !== 'admin') { 
        window.location.href = "index.html"; 
        return null;
    }

    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
        };
        if(localStorage.getItem('sidebar-collapsed') === 'true') sidebar.classList.add('collapsed');
    }

    initKillSwitch();
    return session;
}

async function initKillSwitch() {
    const btn = document.getElementById('global-kill-switch');
    if(!btn) return;

    // 1. Initial State Load
    let { data: s } = await supabaseClient.from('system_settings').select('is_paused').single();
    
    const updateBtnUI = (isPaused) => {
        if (isPaused) {
            btn.innerHTML = '<i class="fas fa-play"></i> <span class="nav-text">Resume Systems</span>';
            btn.style.borderColor = '#22c55e'; // Green for resume
        } else {
            btn.innerHTML = '<i class="fas fa-power-off"></i> <span class="nav-text">Emergency Stop</span>';
            btn.style.borderColor = 'rgba(255,255,255,0.2)'; // Default
        }
    };

    if (s) updateBtnUI(s.is_paused);

    // 2. Click Handler with Safety Modal
    btn.onclick = async () => {
        let { data: currentStatus } = await supabaseClient.from('system_settings').select('is_paused').single();
        
        if (!currentStatus.is_paused) {
            window.adminConfirm(
                'Emergency Shutdown',
                'Are you sure you want to pause all scraping activity? Active searches will be cancelled and new ones blocked.',
                async () => {
                    await supabaseClient.from('system_settings').update({ is_paused: true }).eq('id', 1);
                    updateBtnUI(true);
                    window.adminAlert('Systems Paused', 'Platform activity has been suspended.', 'danger');
                },
                'danger'
            );
        } else {
            window.adminConfirm(
                'Resume Systems',
                'Do you want to re-enable scraping activity across the platform?',
                async () => {
                    await supabaseClient.from('system_settings').update({ is_paused: false }).eq('id', 1);
                    updateBtnUI(false);
                    window.adminAlert('Systems Active', 'The platform is now accepting new research jobs.', 'success');
                }
            );
        }
    };
}


function showModal(type, title, message, onConfirm = null) {
    const modal = document.getElementById('generic-modal');
    const iconEl = document.getElementById('modal-icon');
    const titleEl = document.getElementById('modal-title');
    const msgEl = document.getElementById('modal-message');
    const actionsEl = document.getElementById('modal-actions');

    if(!modal) return;

    titleEl.textContent = title;
    msgEl.textContent = message;

    let iconClass = 'fa-info-circle';
    let iconBg = '#eff6ff'; 
    let iconColor = '#3b82f6'; 

    if (type === 'success') {
        iconClass = 'fa-check';
        iconBg = '#f0fdf4'; 
        iconColor = '#22c55e'; 
    } else if (type === 'danger') {
        iconClass = 'fa-exclamation-triangle';
        iconBg = '#fef2f2'; 
        iconColor = '#ef4444'; 
    }

    iconEl.style.background = iconBg;
    iconEl.style.color = iconColor;
    iconEl.innerHTML = `<i class="fas ${iconClass}"></i>`;

    actionsEl.innerHTML = ''; 

    if (onConfirm) {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-ghost';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.border = '1px solid #e2e8f0';
        cancelBtn.style.padding = '8px 16px';
        cancelBtn.onclick = () => modal.style.display = 'none';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn-primary-blue';
        confirmBtn.textContent = type === 'danger' ? 'Yes, Proceed' : 'Confirm';
        if (type === 'danger') confirmBtn.style.backgroundColor = '#ef4444';
        confirmBtn.onclick = () => {
            modal.style.display = 'none';
            onConfirm();
        };

        actionsEl.appendChild(cancelBtn);
        actionsEl.appendChild(confirmBtn);
    } else {
        const okBtn = document.createElement('button');
        okBtn.className = 'btn-primary-blue';
        okBtn.textContent = 'Okay';
        okBtn.onclick = () => modal.style.display = 'none';
        actionsEl.appendChild(okBtn);
    }

    modal.style.display = 'flex';
}

window.adminAlert = (title, message, type = 'info') => showModal(type, title, message);
window.adminConfirm = (title, message, onConfirm, type = 'info') => showModal(type, title, message, onConfirm);