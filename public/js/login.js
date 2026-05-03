document.addEventListener('DOMContentLoaded', () => {
    const { createClient } = supabase;
    const supabaseClient = createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY);

    // Redirect if already logged in
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
        if (session) window.location.href = 'dashboard.html';
    });

    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session) window.location.href = 'dashboard.html';
    });

    // Password visibility toggles
    function setupPasswordToggle(toggleId, inputId) {
        const btn = document.getElementById(toggleId);
        const field = document.getElementById(inputId);
        if (btn && field) {
            btn.addEventListener('click', () => {
                const type = field.getAttribute('type') === 'password' ? 'text' : 'password';
                field.setAttribute('type', type);
                btn.classList.toggle('fa-eye');
                btn.classList.toggle('fa-eye-slash');
            });
        }
    }
    setupPasswordToggle('toggle-login-password', 'password-input');
    setupPasswordToggle('toggle-signup-password', 'signup-password-input');

    // Flip card
    document.getElementById('to-signup-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('flip-card').classList.add('flipped');
    });
    document.getElementById('to-signin-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('flip-card').classList.remove('flipped');
    });

    // Google OAuth
    document.getElementById('login-google')?.addEventListener('click', () =>
        supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    );

    // Microsoft OAuth
    document.getElementById('login-microsoft')?.addEventListener('click', () =>
        supabaseClient.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email', redirectTo: window.location.origin } })
    );

    // Email login
    document.getElementById('login-email-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('email-input').value;
        const password = document.getElementById('password-input').value;
        if (!email || !password) return alert('Please enter credentials.');
        const btn = document.getElementById('login-email-btn');
        btn.disabled = true;
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) { alert(error.message); btn.disabled = false; }
    });

    // Sign up
    document.getElementById('signup-email-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('signup-email-input').value;
        const password = document.getElementById('signup-password-input').value;
        if (!email || !password) return alert('Please enter credentials.');
        const btn = document.getElementById('signup-email-btn');
        btn.disabled = true;
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) { alert(error.message); btn.disabled = false; }
        else if (!data.session) {
            alert('Check your email to confirm your account!');
            document.getElementById('flip-card').classList.remove('flipped');
            btn.disabled = false;
        }
    });

    // Forgot password
    document.querySelector('.forgot-password')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email-input').value;
        if (!email) return alert('Enter your email address first.');
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) alert(error.message);
        else alert('Password reset email sent — check your inbox.');
    });
});
