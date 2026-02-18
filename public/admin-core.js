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
    let { data: s } = await supabaseClient.from('system_settings').select('is_paused').single();
    const up = (p) => { btn.innerHTML = p ? '<i class="fas fa-play"></i> <span class="nav-text">Resume Systems</span>' : '<i class="fas fa-power-off"></i> <span class="nav-text">Emergency Stop</span>'; };
    if (s) up(s.is_paused);
    btn.onclick = async () => {
        let { data: c } = await supabaseClient.from('system_settings').select('is_paused').single();
        await supabaseClient.from('system_settings').update({ is_paused: !c.is_paused }).eq('id', 1);
        up(!c.is_paused);
    };
}