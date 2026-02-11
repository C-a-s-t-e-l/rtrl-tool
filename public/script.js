document.addEventListener("DOMContentLoaded", () => {
  const BACKEND_URL = "https://backend.rtrlprospector.space";
  const SUPABASE_URL = window.CONFIG.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.CONFIG.SUPABASE_ANON_KEY;

  const { createClient } = supabase;
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let currentUserSession = null;
  let currentJobId = null;

  // Initialize Global State
  window.rtrlApp = {
    ...window.rtrlApp,
    state: {
      selectedAnchorPoint: null,
      googleMapsService: null,
      googleMapsGeocoder: null,
    },
    timers: {},
    postalCodes: [],
    customKeywords: [],
  };

  const elements = {
    startButton: document.getElementById("startButton"),
    useAiToggle: document.getElementById("useAiToggle"),
    primaryCategorySelect: document.getElementById("primaryCategorySelect"),
    subCategoryGroup: document.getElementById("subCategoryGroup"),
    subCategoryCheckboxContainer: document.getElementById(
      "subCategoryCheckboxContainer",
    ),
    customCategoryGroup: document.getElementById("customCategoryGroup"),
    customCategoryInput: document.getElementById("customCategoryInput"),
    customKeywordContainer: document.getElementById("customKeywordContainer"),
    locationInput: document.getElementById("locationInput"),
    locationSuggestionsEl: document.getElementById("locationSuggestions"),
    postalCodeInput: document.getElementById("postalCodeInput"),
    postalCodeContainer: document.getElementById("postalCodeContainer"),
    postalCodeSuggestionsEl: document.getElementById("postalCodeSuggestions"),
    countryInput: document.getElementById("countryInput"),
    countrySuggestionsEl: document.getElementById("countrySuggestions"),
    countInput: document.getElementById("count"),
    findAllBusinessesCheckbox: document.getElementById("findAllBusinesses"),
    businessNamesInput: document.getElementById("businessNamesInput"),
    userEmailInput: document.getElementById("userEmailInput"),
    anchorPointInput: document.getElementById("anchorPointInput"),
    anchorPointSuggestionsEl: document.getElementById("anchorPointSuggestions"),
    radiusSlider: document.getElementById("radiusSlider"),
    radiusValue: document.getElementById("radiusValue"),
    logEl: document.getElementById("status-text"),
    postcodeListSelect: document.getElementById("postcodeListSelect"),
    savePostcodeListButton: document.getElementById("savePostcodeListButton"),
    deletePostcodeListButton: document.getElementById(
      "deletePostcodeListButton",
    ),
    categoryModifierGroup: document.getElementById("categoryModifierGroup"),
    categoryModifierInput: document.getElementById("categoryModifierInput"),
    loginOverlay: document.getElementById("login-overlay"),
    appContent: document.getElementById("app-content"),
    logoutButton: document.getElementById("logout-button"),
    userInfoSpan: document.getElementById("user-info"),
    userMenu: document.getElementById("user-menu"),
    userEmailDisplay: document.getElementById("user-email-display"),
    loginEmailBtn: document.getElementById("login-email-btn"),
    emailInputAuth: document.getElementById("email-input"),
    passwordInputAuth: document.getElementById("password-input"),
    signupEmailInput: document.getElementById("signup-email-input"),
    signupPasswordInput: document.getElementById("signup-password-input"),
    signupEmailBtn: document.getElementById("signup-email-btn"),
    flipCardContainer: document.getElementById("flip-card"),
    toSignupBtn: document.getElementById("to-signup-btn"),
    toSigninBtn: document.getElementById("to-signin-btn"),
  };

  // SOCKET SETUP
  const socket = io(BACKEND_URL, {
    transports: ["websocket", "polling"],
    timeout: 240000,
  });

  socket.on("connect", () => {
    const savedJobId = localStorage.getItem("rtrl_active_job_id");
    if (savedJobId && currentUserSession) {
      socket.emit("subscribe_to_job", {
        jobId: savedJobId,
        authToken: currentUserSession.access_token,
      });
    }
  });

  socket.on("business_found", () => window.rtrlApp.usage.incrementLocal());
  socket.on("job_created", ({ jobId }) => {
    currentJobId = jobId;
    localStorage.setItem("rtrl_active_job_id", jobId);
    updateDashboardUi("queued", { position: "..." });
    socket.emit("subscribe_to_job", {
      jobId,
      authToken: currentUserSession.access_token,
    });
    if (window.rtrlApp.jobHistory)
      window.rtrlApp.jobHistory.fetchAndRenderJobs();
  });

  socket.on("queue_position", (data) => updateDashboardUi("queued", data));
  socket.on("job_state", (job) => {
    if (job.status === "completed" || job.status === "failed") {
      localStorage.removeItem("rtrl_active_job_id");
      setUiState(false, elements);
    } else {
      setUiState(true, elements);
    }
    updateDashboardUi(job.status);
  });

  socket.on("progress_update", (data) => {
    // Shared global function in ui-helpers.js or event-handlers
    if (typeof window.updateStatusCardPhase === "function")
      window.updateStatusCardPhase(data.phase);
    // ... (Update stat counters in UI)
  });

  // AUTH SETUP
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    currentUserSession = session;
    if (session) {
      socket.emit("authenticate_socket", session.access_token);
      elements.loginOverlay.style.display = "none";
      elements.appContent.style.display = "block";
      elements.userMenu.style.display = "block";
      elements.userEmailDisplay.textContent = session.user.email;
      elements.userInfoSpan.textContent =
        session.user.user_metadata.full_name || "User";

      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();
      if (profile) {
        window.rtrlApp.usage.update(profile);
        if (profile.role === "admin")
          document.getElementById("admin-control-link").style.display = "flex";
      }

      if (elements.userEmailInput) {
        elements.userEmailInput.value =
          localStorage.getItem("rtrl_last_used_email") || session.user.email;
      }

      fetchPostcodeLists();
      window.rtrlApp.jobHistory.fetchAndRenderJobs();
    } else {
      elements.loginOverlay.style.display = "flex";
      elements.appContent.style.display = "none";
    }
  });

  // MAPS CALLBACK
  window.initMap = () => {
    window.rtrlApp.searchManager.initMap();
    window.rtrlApp.state.googleMapsService =
      new google.maps.places.AutocompleteService();
    window.rtrlApp.state.googleMapsGeocoder = new google.maps.Geocoder();
  };

  // RESEARCH START
  window.rtrlApp.startResearch = () => {
    if (!currentUserSession) return;
    const payload = window.rtrlApp.searchManager.assemblePayload(elements);
    socket.emit("start_scrape_job", {
      authToken: currentUserSession.access_token,
      ...payload,
    });
    setUiState(true, elements);
  };

  // INITIALIZE UI
  const searchMgr = window.rtrlApp.searchManager;
  populatePrimaryCategories(
    elements.primaryCategorySelect,
    searchMgr.categories,
    "",
  );

  // Attach event listeners (logic from event-handlers.js)
  setupEventListeners(
    elements,
    socket,
    searchMgr.categories,
    searchMgr.countries,
    window.rtrlApp.postalCodes,
    window.rtrlApp.customKeywords,
    window.rtrlApp.map,
    window.rtrlApp.searchCircle,
  );

  // Fetch config and load Google script
  fetch(`${BACKEND_URL}/api/config`)
    .then((r) => r.json())
    .then((config) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${config.googleMapsApiKey}&libraries=places&callback=initMap`;
      script.async = true;
      document.head.appendChild(script);
    });

  async function fetchPostcodeLists() {
    if (!currentUserSession) return;
    const res = await fetch(`${BACKEND_URL}/api/postcode-lists`, {
      headers: { Authorization: `Bearer ${currentUserSession.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      elements.postcodeListSelect.innerHTML =
        '<option value="">Load a saved list...</option>';
      data.forEach((l) => {
        const opt = document.createElement("option");
        opt.value = l.id;
        opt.textContent = l.list_name;
        elements.postcodeListSelect.appendChild(opt);
      });
      window.rtrlApp.savedPostcodeLists = data;
    }
  }

  // Auth Form Interactions
  elements.toSignupBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    elements.flipCardContainer.classList.add("flipped");
  });
  elements.toSigninBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    elements.flipCardContainer.classList.remove("flipped");
  });
  elements.loginEmailBtn?.addEventListener("click", () => {
    supabaseClient.auth
      .signInWithPassword({
        email: elements.emailInputAuth.value,
        password: elements.passwordInputAuth.value,
      })
      .then(({ error }) => {
        if (error) alert(error.message);
      });
  });
  elements.signupEmailBtn?.addEventListener("click", () => {
    supabaseClient.auth
      .signUp({
        email: elements.signupEmailInput.value,
        password: elements.signupPasswordInput.value,
      })
      .then(({ error }) => {
        if (error) alert(error.message);
        else alert("Check your email!");
      });
  });
  elements.logoutButton?.addEventListener("click", (e) => {
    e.preventDefault();
    supabaseClient.auth.signOut().then(() => location.reload());
  });
});

// Helper for CloneJobIntoForm (linked to history items)
window.rtrlApp.cloneJobIntoForm = (p) =>
  window.rtrlApp.searchManager.cloneJobIntoForm(p);
