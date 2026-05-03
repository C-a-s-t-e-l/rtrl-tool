document.addEventListener("DOMContentLoaded", async () => {
  const { createClient } = supabase;
  const supabaseClient = createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY);
  window.rtrlApp.supabaseClient = supabaseClient;

  const { data: { session: initialSession } } = await supabaseClient.auth.getSession();
  if (!initialSession) { window.location.href = 'index.html'; return; }

  window.rtrlApp.session = initialSession;
  window.rtrlApp.isSubscribed = false;
  window.rtrlApp.currentJobId = null;
  window.rtrlApp.lastAuthenticatedSocketId = null;
  window.rtrlApp.lastAuthenticatedToken = null;

  window.rtrlApp.countries = [
    { value: "AU", text: "Australia" },
    { value: "NZ", text: "New Zealand" },
    { value: "US", text: "United States" },
    { value: "GB", text: "United Kingdom" },
    { value: "CA", text: "Canada" },
    { value: "PH", text: "Philippines" },
  ];

  const elements = {
    startButton: document.getElementById("startButton"),
    useAiToggle: document.getElementById("useAiToggle"),
    industryPillsContainer: document.getElementById("industryPillsContainer"),
    categorySearchInput: document.getElementById("categorySearchInput"),
    selectionPillsContainer: document.getElementById("selectionPillsContainer"),
    explorerScrollArea: document.getElementById("explorerScrollArea"),
    subCategoryGroup: document.getElementById("subCategoryGroup"),
    subCategoryCheckboxContainer: document.getElementById("subCategoryCheckboxContainer"),
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
    logEl: document.getElementById("status-text"),
    postcodeListSelect: document.getElementById("postcodeListSelect"),
    savePostcodeListButton: document.getElementById("savePostcodeListButton"),
    deletePostcodeListButton: document.getElementById("deletePostcodeListButton"),
    categoryModifierInput: document.getElementById("categoryModifierInput"),
    logoutButton: document.getElementById("logout-button"),
    userInfoSpan: document.getElementById("user-info"),
    userMenu: document.getElementById("user-menu"),
    userEmailDisplay: document.getElementById("user-email-display"),
    dashUsageCurrent: document.getElementById("dash-usage-current"),
    dashUsageLimit: document.getElementById("dash-usage-limit"),
    dashUsageFill: document.getElementById("dash-usage-fill"),
    dashPlanBadge: document.getElementById("dash-plan-badge"),
    dashResetTimer: document.getElementById("reset-timer"),
    dashUsagePercent: document.getElementById("usage-percentage-label"),
    dashUsageStatus: document.getElementById("usage-status-text"),
    queueCard: document.getElementById("queue-card"),
    queueListContainer: document.getElementById("queue-list-container"),
    queueCountBadge: document.getElementById("queue-count-badge"),
    mapModal: document.getElementById("map-workspace-modal"),
    mapElement: document.getElementById("map"),
    bigMapContainer: document.getElementById("big-map-container"),
    smallMapContainer: document.getElementById("map-parent-container"),
    workspaceSearchInput: document.getElementById("workspace-search-input"),
    workspaceSuggestions: document.getElementById("workspace-suggestions"),
    btnCloseMapWorkspace: document.getElementById("btn-close-map-workspace"),
    btnOpenMapWorkspace: document.getElementById("btn-open-map-workspace"),
  };
  window.rtrlApp.elements = elements;

  if (elements.useAiToggle) {
    elements.useAiToggle.checked = localStorage.getItem("rtrl_use_ai_enrichment") !== "false";
    elements.useAiToggle.addEventListener("change", (e) => localStorage.setItem("rtrl_use_ai_enrichment", e.target.checked));
  }

  if (elements.categorySearchInput) {
    elements.categorySearchInput.addEventListener('input', (e) => {
      window.rtrlApp.categories.renderExplorer(e.target.value);
    });
  }

  if (elements.customCategoryInput) {
    elements.customCategoryInput.addEventListener('input', () => {
      if (elements.customCategoryInput.value.trim() !== "" && window.rtrlApp.categories.getActiveSelections().length > 0) {
        window.rtrlApp.categories.clearAndRender();
      }
    });
  }

  window.rtrlApp.initSocket();

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (!session) { window.location.href = 'index.html'; return; }

    window.rtrlApp.session = session;
    const socket = window.rtrlApp.socket;
    const currentSocketId = socket.id;
    const currentToken = session.access_token;

    if (socket.connected && (currentSocketId !== window.rtrlApp.lastAuthenticatedSocketId || currentToken !== window.rtrlApp.lastAuthenticatedToken)) {
      socket.emit("authenticate_socket", currentToken);
      window.rtrlApp.lastAuthenticatedSocketId = currentSocketId;
      window.rtrlApp.lastAuthenticatedToken = currentToken;
    }

    elements.userMenu.style.display = "block";
    elements.userInfoSpan.textContent = session.user.user_metadata.full_name || "User";
    elements.userEmailDisplay.textContent = session.user.email;

    window.rtrlApp.refreshUsageTracker();

    supabaseClient.from("profiles").select("role").eq("id", session.user.id).single().then(({ data: profile }) => {
      if (profile?.role === "admin") document.getElementById("admin-control-link").style.display = "flex";
    });

    if (elements.userEmailInput.value === "") elements.userEmailInput.value = session.user.email;

    window.rtrlApp.search.fetchPostcodeLists();
    window.rtrlApp.fetchLocations();
    window.rtrlApp.jobHistory.fetchAndRenderJobs();

    fetch(`${window.BACKEND_URL}/api/exclusions`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) window.rtrlApp.exclusionFeature.populateTags(data.exclusionList); });
  });

  elements.logoutButton?.addEventListener("click", async (e) => {
    e.preventDefault();
    await supabaseClient.auth.signOut();
  });

  await initializeApp();

  async function initializeApp() {
    window.rtrlApp.jobHistory.init(() => window.rtrlApp.session?.access_token, window.BACKEND_URL);
    window.rtrlApp.review.init(() => window.rtrlApp.session?.access_token, window.BACKEND_URL);
    window.rtrlApp.exclusionFeature.init(() => window.rtrlApp.session?.access_token);
    const industries = await window.rtrlApp.categories.fetchCategoryDefinitions();
    if (industries.length > 0) {
      const subGroup = document.getElementById('subCategoryGroup');
      if (subGroup) subGroup.style.display = 'block';
      window.rtrlApp.categories.renderIndustryPills(industries);
    }
    if (localStorage.getItem("rtrl_last_used_email")) {
      elements.userEmailInput.value = localStorage.getItem("rtrl_last_used_email");
    }
    window.rtrlApp.search.setupPostcodeListHandlers();
    if (typeof setupEventListeners === 'function') {
      setupEventListeners(
        elements,
        window.rtrlApp.socket,
        window.rtrlApp.categories.getCategoryHierarchy(),
        window.rtrlApp.countries,
        window.rtrlApp.postalCodes,
        window.rtrlApp.customKeywords,
        window.rtrlApp.map,
        window.rtrlApp.searchCircle
      );
    }
    window.rtrlApp.loadGoogleMaps();
  }
});
