document.addEventListener("DOMContentLoaded", () => {
  let isSubscribed = false;

  const BACKEND_URL = "https://backend.rtrlprospector.space";
  const SUPABASE_URL = window.CONFIG.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.CONFIG.SUPABASE_ANON_KEY;

  const { createClient } = supabase;
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let currentUserSession = null;
  let currentJobId = null;
  let lastAuthenticatedSocketId = null;
  let lastAuthenticatedToken = null;

  window.rtrlApp = {
    ...window.rtrlApp,
    state: {
      anchors: [],
      currentSearchParameters: {},
      googleMapsService: null,
      googleMapsGeocoder: null,
      activeLocationId: null, 
      isDirty: false,          
      locations: []           
    },
    timers: {},
    postalCodes: [],
    customKeywords: [],
    map: null,
    searchCircle: null,
    startResearch: () => {},
    fetchPlaceSuggestions: () => {},
    handleLocationSelection: () => {},
    handleAnchorPointSelection: () => {},
    handlePostalCodeSelection: () => {},
    validateAndAddTag: () => {},
    setRadiusInputsState: () => {},
    setLocationInputsState: () => {},
    addAnchor: () => {}
  };

  function initializeMainApp() {
    let masterCategoryData = [];
    let categoryHierarchy = {};
    let selectedIndustry = null;
    let activeSelections = [];

    const countries = [
      { value: "AU", text: "Australia" },
      { value: "NZ", text: "New Zealand" },
      { value: "US", text: "United States" },
      { value: "GB", text: "United Kingdom" },
      { value: "CA", text: "Canada" },
      { value: "PH", text: "Philippines" },
    ];

    // --- LOCATION UI HELPERS ---
    window.rtrlApp.showToast = (msg, type = 'success') => {
        const toast = document.createElement('div');
        toast.className = `rtrl-toast toast-${type}`;
        toast.innerHTML = `<i class="fas ${type==='success'?'fa-check-circle':'fa-exclamation-circle'}"></i><span>${msg}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('visible'), 100);
        setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, 3000);
    };

    window.rtrlApp.promptLocationName = (currentName = "") => {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'rtrl-modal-overlay';
            modal.innerHTML = `
                <div class="rtrl-modal-window">
                    <h3><i class="fas fa-map-marker-alt"></i> Save Search Location</h3>
                    <p>Give this collection of pins a name for future searches.</p>
                    <input type="text" id="loc-name-input" placeholder="e.g. Albury_Wodonga" value="${currentName}">
                    <div class="rtrl-modal-actions">
                        <button class="btn btn-secondary" id="modal-cancel-btn" style="margin:0">Cancel</button>
                        <button class="btn btn-primary" id="modal-save-btn" style="margin:0; width:auto; padding: 0.65rem 1.5rem;">Save Location</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            const input = modal.querySelector('#loc-name-input');
            input.focus();
            modal.querySelector('#modal-cancel-btn').onclick = () => { modal.remove(); resolve(null); };
            modal.querySelector('#modal-save-btn').onclick = () => { const val = input.value.trim(); modal.remove(); resolve(val || null); };
        });
    };

    window.rtrlApp.confirmDiscard = () => {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'rtrl-modal-overlay';
            modal.style.zIndex = "110002"; 
            modal.innerHTML = `
                <div class="rtrl-modal-window" style="text-align:center;">
                    <div style="color: #ef4444; font-size: 2rem; margin-bottom: 1rem;"><i class="fas fa-exclamation-triangle"></i></div>
                    <h3>Unsaved Changes</h3>
                    <p>You have unsaved modifications to this location. Are you sure you want to discard them?</p>
                    <div class="rtrl-modal-actions" style="justify-content: center; margin-top: 20px;">
                        <button class="btn btn-secondary" id="discard-no" style="margin:0">Keep Editing</button>
                        <button class="btn btn-primary" id="discard-yes" style="margin:0; width:auto; background:#ef4444;">Discard Changes</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#discard-no').onclick = () => { modal.remove(); resolve(false); };
            modal.querySelector('#discard-yes').onclick = () => { modal.remove(); resolve(true); };
        });
    };

    // --- CORE LOCATION LOGIC ---
    window.rtrlApp.setLocationDirty = (val) => {
        window.rtrlApp.state.isDirty = val;
        window.rtrlApp.renderZoneList(); 
    };

    window.rtrlApp.fetchLocations = async () => {
        if (!currentUserSession) return;
        try {
            const response = await fetch(`${BACKEND_URL}/api/territories`, { headers: { Authorization: `Bearer ${currentUserSession.access_token}` } });
            if (response.ok) { 
                window.rtrlApp.state.locations = await response.json(); 
                window.rtrlApp.renderZoneList(); 
            }
        } catch (e) { console.error(e); }
    };

    window.rtrlApp.loadLocation = async (id) => {
        if (window.rtrlApp.state.isDirty) {
            const confirmed = await window.rtrlApp.confirmDiscard();
            if (!confirmed) {
                window.rtrlApp.renderZoneList();
                return;
            }
        }
        
        const loc = window.rtrlApp.state.locations.find(l => l.id === id);
        if (!loc) return;
        
        window.rtrlApp.state.anchors.forEach(a => { 
            if(a.marker) window.rtrlApp.map.removeLayer(a.marker); 
            if(a.circle) window.rtrlApp.map.removeLayer(a.circle); 
        });
        window.rtrlApp.state.anchors = [];

        loc.zone_data.forEach(z => { 
            window.rtrlApp.addAnchor({ lat: z.lat, lng: z.lng }, z.name, z.radius, Date.now() + Math.random()); 
        });

        window.rtrlApp.state.activeLocationId = id;
        window.rtrlApp.state.isDirty = false;
        window.rtrlApp.renderZoneList();
        window.rtrlApp.showToast(`Loaded: ${loc.name}`);
    };

    window.rtrlApp.saveLocation = async (isUpdate = false) => {
        if (window.rtrlApp.state.anchors.length === 0) return window.rtrlApp.showToast("Add some pins first!", "error");
        let name = "";
        if (isUpdate && window.rtrlApp.state.activeLocationId) {
            name = window.rtrlApp.state.locations.find(l => l.id === window.rtrlApp.state.activeLocationId).name;
        } else {
            name = await window.rtrlApp.promptLocationName();
            if (!name) return;
        }
        const zoneData = window.rtrlApp.state.anchors.map(a => ({ lat: a.lat, lng: a.lng, radius: a.radius, name: a.name }));
        const method = isUpdate ? 'PUT' : 'POST';
        const url = isUpdate ? `${BACKEND_URL}/api/territories/${window.rtrlApp.state.activeLocationId}` : `${BACKEND_URL}/api/territories`;
        try {
            const res = await fetch(url, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentUserSession.access_token}` }, body: JSON.stringify({ name, zone_data: zoneData }) });
            if (res.ok) {
                const result = await res.json();
                if (!isUpdate) window.rtrlApp.state.activeLocationId = result.id;
                window.rtrlApp.state.isDirty = false;
                await window.rtrlApp.fetchLocations();
                window.rtrlApp.showToast(isUpdate ? "Location updated" : "Location saved");
            }
        } catch (e) { window.rtrlApp.showToast("Server error", "error"); }
    };

window.rtrlApp.deleteLocation = async (id) => {
        const loc = window.rtrlApp.state.locations.find(l => l.id === id);
        if (!loc) return;

        const confirmed = await window.rtrlApp.confirmDelete(loc.name);
        if (!confirmed) return;

        try {
            const res = await fetch(`${BACKEND_URL}/api/territories/${id}`, { 
                method: 'DELETE', 
                headers: { Authorization: `Bearer ${currentUserSession.access_token}` } 
            });
            if (res.ok) {
                if (window.rtrlApp.state.activeLocationId === id) {
                    window.rtrlApp.clearAllPins(); 
                }
                
                await window.rtrlApp.fetchLocations();
                window.rtrlApp.showToast("Location deleted permanently");
            }
        } catch (e) { 
            window.rtrlApp.showToast("Failed to delete", "error");
        }
    };

    async function fetchCategoryDefinitions() {
      try {
        const { data, error } = await supabaseClient.from('category_definitions').select('*').order('group_name', { ascending: true });
        if (error) throw error;
        masterCategoryData = data;
        categoryHierarchy = data.reduce((acc, row) => {
          const { industry, group_name, ui_label, search_terms } = row;
          if (!acc[industry]) acc[industry] = {};
          if (!acc[industry][group_name]) acc[industry][group_name] = [];
          acc[industry][group_name].push({ label: ui_label, terms: search_terms, id: row.id });
          return acc;
        }, {});
        return Object.keys(categoryHierarchy);
      } catch (err) { console.error("Error loading categories:", err); return []; }
    }

    function renderIndustryPills(industries) {
      const container = document.getElementById('industryPillsContainer');
      if (!container) return;
      container.innerHTML = industries.map(ind => `<div class="industry-pill" data-industry="${ind}">${ind}</div>`).join('');
      container.querySelectorAll('.industry-pill').forEach(pill => {
        pill.onclick = () => {
          selectedIndustry = pill.dataset.industry;
          container.querySelectorAll('.industry-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          clearCustomKeywords(); activeSelections = []; renderExplorer(); updateSelectionPills();
        };
      });
      if (industries.length > 0) container.querySelector('.industry-pill').click();
    }

    function clearCustomKeywords() {
      window.rtrlApp.customKeywords = [];
      const kwContainer = document.getElementById('customKeywordContainer');
      if (kwContainer) {
        kwContainer.querySelectorAll('.tag').forEach(t => t.remove());
        const input = kwContainer.querySelector('input');
        if (input) input.value = '';
      }
    }

    function renderExplorer(filterText = "") {
      const container = document.getElementById('subCategoryCheckboxContainer');
      if (!container || !selectedIndustry) return;
      const currentlyOpen = Array.from(container.querySelectorAll('.explorer-group.open')).map(el => el.id);
      const groups = categoryHierarchy[selectedIndustry];
      let html = "";
      for (const [groupName, items] of Object.entries(groups)) {
        const filteredItems = items.filter(item => item.label.toLowerCase().includes(filterText.toLowerCase()) || groupName.toLowerCase().includes(filterText.toLowerCase()));
        if (filteredItems.length === 0) continue;
        const groupId = `group_${groupName.replace(/[^a-zA-Z0-9]/g, '')}`;
        if (items.length === 1) {
          const item = items[0];
          const isChecked = activeSelections.some(s => s.id === item.id);
          html += `<div class="standalone-item"><input type="checkbox" id="check_${item.id}" ${isChecked ? 'checked' : ''} onchange="window.rtrlApp.toggleCategory(${item.id})"><label for="check_${item.id}">${groupName}</label></div>`;
        } else {
          const isOpen = currentlyOpen.includes(groupId) ? 'open' : '';
          html += `<div class="explorer-group ${isOpen}" id="${groupId}"><div class="explorer-group-header" onclick="this.parentElement.classList.toggle('open')"><div class="group-title-wrapper"><i class="fas fa-chevron-right group-arrow"></i><span>${groupName}</span></div><button class="btn-select-group" onclick="event.stopPropagation(); window.rtrlApp.selectGroup('${groupName.replace(/'/g, "\\'")}')">SELECT ALL</button></div><div class="explorer-group-content">${filteredItems.map(item => { const isChecked = activeSelections.some(s => s.id === item.id); return `<div class="ui-label-item"><input type="checkbox" id="check_${item.id}" ${isChecked ? 'checked' : ''} onchange="window.rtrlApp.toggleCategory(${item.id})"><label for="check_${item.id}">${item.label}</label></div>`; }).join('')}</div></div>`;
        }
      }
      container.innerHTML = html;
    }

    function updateSelectionPills() {
      const container = document.getElementById('selectionPillsContainer');
      const summary = document.getElementById('categorySummaryText');
      if (!container) return;
      container.innerHTML = activeSelections.map(sel => `<span class="tag" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;"><span>${sel.label}</span><span class="tag-close-btn" onclick="window.rtrlApp.toggleCategory(${sel.id})">&times;</span></span>`).join('');
      const totalLoops = activeSelections.reduce((acc, curr) => acc + (curr.terms?.length || 0), 0);
      summary.textContent = `${activeSelections.length} Categories selected (${totalLoops} Search loops)`;
    }

    window.rtrlApp.toggleCategory = (id) => {
      const item = masterCategoryData.find(d => d.id === id);
      const index = activeSelections.findIndex(s => s.id === id);
      if (index > -1) { activeSelections.splice(index, 1); }
      else { clearCustomKeywords(); activeSelections.push({ id: item.id, label: item.ui_label, terms: item.search_terms }); }
      updateSelectionPills();
      renderExplorer(document.getElementById('categorySearchInput')?.value || "");
    };

    window.rtrlApp.selectGroup = (groupName) => {
      if (!selectedIndustry || !categoryHierarchy[selectedIndustry]) return;
      const items = categoryHierarchy[selectedIndustry][groupName];
      if (!items) return;
      clearCustomKeywords();
      items.forEach(item => { if (!activeSelections.some(s => s.id === item.id)) { activeSelections.push({ id: item.id, label: item.label, terms: item.search_terms }); } });
      updateSelectionPills();
      renderExplorer(document.getElementById('categorySearchInput')?.value || "");
    };

    window.rtrlApp.confirmDelete = (name) => {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'rtrl-modal-overlay';
            modal.style.zIndex = "110003"; // Top layer
            modal.innerHTML = `
                <div class="rtrl-modal-window" style="text-align:center;">
                    <div style="color: #ef4444; font-size: 2rem; margin-bottom: 1rem;"><i class="fas fa-trash-alt"></i></div>
                    <h3>Delete Location?</h3>
                    <p>Are you sure you want to permanently delete <b>"${name}"</b>? This action cannot be undone.</p>
                    <div class="rtrl-modal-actions" style="justify-content: center; margin-top: 20px;">
                        <button class="btn btn-secondary" id="delete-no" style="margin:0">Cancel</button>
                        <button class="btn btn-primary" id="delete-yes" style="margin:0; width:auto; background:#ef4444;">Delete Permanently</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#delete-no').onclick = () => { modal.remove(); resolve(false); };
            modal.querySelector('#delete-yes').onclick = () => { modal.remove(); resolve(true); };
        });
    };

    async function refreshUsageTracker() {
      if (!currentUserSession) return;
      const { data: profile, error } = await supabaseClient.from("profiles").select("usage_today, daily_limit, last_reset_date").eq("id", currentUserSession.user.id).single();
      if (error || !profile) return;
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      let displayUsage = profile.usage_today || 0;
      if (profile.last_reset_date && profile.last_reset_date < todayStr) { displayUsage = 0; }
      const limit = profile.daily_limit || 500;
      const percentage = Math.min(Math.round((displayUsage / limit) * 100), 100);
      if (elements.dashUsageCurrent) elements.dashUsageCurrent.textContent = displayUsage.toLocaleString();
      if (elements.dashUsageLimit) elements.dashUsageLimit.textContent = limit.toLocaleString();
      if (elements.dashUsageFill) { elements.dashUsageFill.style.width = `${percentage}%`; elements.dashUsageFill.style.backgroundColor = percentage > 90 ? "#ef4444" : "#8b5cf6"; }
      if (elements.dashUsagePercent) elements.dashUsagePercent.textContent = `${percentage}% consumed`;
      const midnight = new Date(); midnight.setHours(24, 0, 0, 0); const diffMs = midnight.getTime() - now.getTime(); const hours = Math.floor(diffMs / (1000 * 60 * 60)); const mins = Math.round((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      if (elements.dashResetTimer) elements.dashResetTimer.textContent = `Resets in ${hours}h ${mins}m`;
    }

    async function loadGoogleMaps() {
      try {
        const response = await fetch(`${BACKEND_URL}/api/config`, { headers: { "ngrok-skip-browser-warning": "true" }, });
        const config = await response.json();
        if (config.googleMapsApiKey) {
          const script = document.createElement("script");
          script.src = `https://maps.googleapis.com/maps/api/js?key=${config.googleMapsApiKey}&libraries=places&callback=initMap`;
          script.async = true;
          document.head.appendChild(script);
        }
      } catch (error) { console.error(error); }
    }

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
      loginOverlay: document.getElementById("login-overlay"),
      appContent: document.getElementById("app-content"),
      logoutButton: document.getElementById("logout-button"),
      userInfoSpan: document.getElementById("user-info"),
      userMenu: document.getElementById("user-menu"),
      userEmailDisplay: document.getElementById("user-email-display"),
      flipCardContainer: document.getElementById("flip-card"),
      toSignupBtn: document.getElementById("to-signup-btn"),
      toSigninBtn: document.getElementById("to-signin-btn"),
      emailInputAuth: document.getElementById("email-input"),
      passwordInputAuth: document.getElementById("password-input"),
      loginEmailBtn: document.getElementById("login-email-btn"),
      signupEmailInput: document.getElementById("signup-email-input"),
      signupPasswordInput: document.getElementById("signup-password-input"),
      signupEmailBtn: document.getElementById("signup-email-btn"),
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
      btnOpenMapWorkspace: document.getElementById("btn-open-map-workspace")
    };

    if (elements.useAiToggle) {
      elements.useAiToggle.checked = localStorage.getItem("rtrl_use_ai_enrichment") !== "false";
      elements.useAiToggle.addEventListener("change", (e) => localStorage.setItem("rtrl_use_ai_enrichment", e.target.checked));
    }

    if (elements.customCategoryInput) {
      elements.customCategoryInput.addEventListener('input', () => {
        if (elements.customCategoryInput.value.trim() !== "" && activeSelections.length > 0) {
          activeSelections = []; updateSelectionPills(); renderExplorer();
        }
      });
    }

    if (document.getElementById('categorySearchInput')) {
      document.getElementById('categorySearchInput').addEventListener('input', (e) => { renderExplorer(e.target.value); });
    }

    const socket = io(BACKEND_URL, { extraHeaders: { "ngrok-skip-browser-warning": "true" }, transports: ["websocket", "polling"], reconnection: true, timeout: 240000, });

    socket.on("connect", () => {
      if (isSubscribed) return;
      if (currentUserSession) {
        socket.emit("authenticate_socket", currentUserSession.access_token);
        const savedJobId = localStorage.getItem("rtrl_active_job_id");
        if (savedJobId) { socket.emit("subscribe_to_job", { jobId: savedJobId, authToken: currentUserSession.access_token, }); }
        else { updateDashboardUi("ready"); setUiState(false, elements); }
      }
      isSubscribed = true;
    });

    socket.on("disconnect", () => { isSubscribed = false; });

    socket.on("user_queue_update", (myJobs) => {
      if (!elements.queueCard || !elements.queueListContainer) return;
      if (!myJobs || myJobs.length === 0) { elements.queueCard.style.display = "none"; return; }
      elements.queueCard.style.display = "block";
      if (elements.queueCountBadge) { elements.queueCountBadge.textContent = `${myJobs.length} Job${myJobs.length !== 1 ? 's' : ''}`; }
      elements.queueListContainer.innerHTML = myJobs.map((job) => `<div class="queue-item" style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; margin-bottom: 8px; border-left: 4px solid #f59e0b;"><div style="display:flex; align-items:center; gap: 12px;"><span class="queue-pos-badge" style="background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5; font-weight: 800; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem;">#${job.globalPosition}</span><span style="font-weight: 600; color: #1e293b; font-size: 0.9rem;">${job.title}</span></div><div style="display: flex; align-items: center; gap: 10px; background: white; padding: 4px 10px; border-radius: 20px; border: 1px solid #e2e8f0;"><span style="font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">Waiting</span><i class="fas fa-hourglass-half" style="color: #f59e0b; font-size: 0.8rem; animation: spin 2s linear infinite;"></i></div></div>`).join("");
    });

    socket.on("job_created", ({ jobId }) => { if (window.rtrlApp.jobHistory) { window.rtrlApp.jobHistory.fetchAndRenderJobs(); } });

    socket.on("user_job_transition", ({ jobId, status }) => {
      if (status === "running") {
        currentJobId = jobId; localStorage.setItem("rtrl_active_job_id", jobId); socket.emit("subscribe_to_job", { jobId, authToken: currentUserSession.access_token });
        resetStatusUI(); updateDashboardUi("running"); if (window.rtrlApp.jobHistory) { window.rtrlApp.jobHistory.fetchAndRenderJobs(true); }
      }
    });

    socket.on("job_state", (job) => {
      if (currentJobId !== job.id) { currentJobId = job.id; resetStatusUI(); }
      localStorage.setItem("rtrl_active_job_id", job.id);
      if (job.status === "running") { updateDashboardUi("running"); }
      else if (job.status === "queued") { updateDashboardUi("ready"); setUiState(false, elements); }
      else if (job.status === "completed" || job.status === "failed") { updateDashboardUi(job.status); setUiState(false, elements); localStorage.removeItem("rtrl_active_job_id"); currentJobId = null; }
    });

    socket.on("job_update", (data) => {
      if (data.status === "running") { currentJobId = data.id; localStorage.setItem("rtrl_active_job_id", data.id); resetStatusUI(); updateDashboardUi("running"); }
      else if (data.status === "completed" || data.status === "failed") { updateDashboardUi(data.status); localStorage.removeItem("rtrl_active_job_id"); currentJobId = null; setUiState(false, elements); setTimeout(() => { if (window.rtrlApp.jobHistory) { window.rtrlApp.jobHistory.fetchAndRenderJobs(true); } }, 1500); }
    });

    socket.on("progress_update", (data) => {
      const card = document.getElementById("status-card");
      if (card && !card.classList.contains("state-working")) { updateDashboardUi("running"); }
      const { phase, processed, discovered, added, target, enriched, aiProcessed, aiTarget } = data;
      let visualPercent = 0, phaseText = "Initializing...";
      if (phase === "discovery") { phaseText = "Phase 1/3: Scanning Maps"; visualPercent = 10; updateStatusCardPhase("discovery"); }
      else if (phase === "scraping") { phaseText = "Phase 2/3: Data Extraction"; let scrapePct = target === -1 ? (discovered > 0 ? processed / discovered : 0) : (target > 0 ? added / target : 0); visualPercent = 10 + Math.round(Math.min(scrapePct, 1) * 60); updateStatusCardPhase("scraping"); }
      else if (phase === "ai") { phaseText = "Phase 2/3: AI Enrichment"; visualPercent = 70 + Math.round(Math.min(aiTarget > 0 ? aiProcessed / aiTarget : 0, 1) * 25); updateStatusCardPhase("ai"); }
      else if (phase === "completed") { visualPercent = 100; phaseText = "Phase 3/3: Complete"; updateStatusCardPhase("complete"); }
      const fill = document.getElementById("progress-fill"), pctLabel = document.getElementById("pct-label"), phaseLabel = document.getElementById("phase-label");
      if (fill) fill.style.width = `${visualPercent}%`; if (pctLabel) pctLabel.textContent = `${visualPercent}%`; if (phaseLabel) phaseLabel.textContent = phaseText;
      if (document.getElementById("stat-found")) document.getElementById("stat-found").textContent = discovered || 0;
      if (document.getElementById("stat-processed")) document.getElementById("stat-processed").textContent = added || 0;
      if (document.getElementById("stat-enriched")) document.getElementById("stat-enriched").textContent = enriched || 0;
    });

    socket.on("job_log", (msg) => logMessage(elements.logEl, msg, "info"));
    socket.on("job_error", ({ error }) => logMessage(elements.logEl, `Error: ${error}`, "error"));
    socket.on("business_found", (business) => {
      refreshUsageTracker();
      const countEl = document.getElementById(`job-count-${currentJobId}`);
      if (countEl) { let currentCount = parseInt(countEl.textContent.replace(/\D/g, "")) || 0; countEl.innerHTML = `<i class="fas fa-database"></i> ${currentCount + 1} Results Found`; }
    });
    socket.on("user_profile_updated", () => refreshUsageTracker());

    function resetStatusUI() {
      const fill = document.getElementById("progress-fill"), pctLabel = document.getElementById("pct-label"), phaseLabel = document.getElementById("phase-label");
      if (fill) fill.style.width = `0%`; if (pctLabel) pctLabel.textContent = `0%`; if (phaseLabel) phaseLabel.textContent = "Initializing...";
      ["stat-found", "stat-processed", "stat-enriched"].forEach((id) => { if (document.getElementById(id)) document.getElementById(id).textContent = "0"; });
      const icon = document.getElementById("status-icon"), headline = document.getElementById("status-headline"), subtext = document.getElementById("status-subtext");
      if (icon) icon.className = "fas fa-satellite-dish spin-slow"; if (headline) headline.textContent = "Extracting Data..."; if (subtext) subtext.textContent = "Moving job from queue to active thread...";
    }

    function updateDashboardUi(status) {
      const headline = document.getElementById("status-headline"), subtext = document.getElementById("status-subtext"), icon = document.getElementById("status-icon"), card = document.getElementById("status-card");
      if (!headline || !card) return; card.className = "status-card";
      if (status === "running") { card.classList.add("state-working", "phase-scraping"); if (!headline.textContent.includes("(")) { headline.textContent = "Job Active"; } if (!subtext.textContent.includes("Current:")) { subtext.textContent = "Processing data..."; } if (icon) icon.className = "fas fa-circle-notch fa-spin"; }
      else if (status === "completed") { card.classList.add("phase-complete"); headline.textContent = "Job Completed"; subtext.textContent = "Check your email for results."; if (icon) icon.className = "fas fa-check-circle"; const fill = document.getElementById("progress-fill"), pct = document.getElementById("pct-label"), phase = document.getElementById("phase-label"); if (fill) fill.style.width = "100%"; if (pct) pct.textContent = "100%"; if (phase) phase.textContent = "Phase 3/3: Complete"; }
      else if (status === "failed") { card.classList.add("phase-error"); headline.textContent = "Job Failed"; subtext.textContent = "Please check job history or try again."; if (icon) icon.className = "fas fa-times-circle"; }
      else { headline.textContent = "Ready to Start"; subtext.textContent = "Waiting for input..."; if (icon) icon.className = "fas fa-play"; }
    }

    function updateStatusCardPhase(phase) {
      const card = document.getElementById("status-card"), icon = document.getElementById("status-icon"), headline = document.getElementById("status-headline");
      if (!card) return; card.classList.remove("phase-scraping", "phase-ai", "phase-complete", "phase-error");
      if (phase === "discovery") { card.classList.add("phase-scraping"); if (icon) icon.className = "fas fa-map-marked-alt spin-slow"; if (headline && !headline.textContent.includes("(")) { headline.textContent = "Scanning Area..."; } }
      else if (phase === "scraping") { card.classList.add("phase-scraping"); if (icon) icon.className = "fas fa-satellite-dish spin-slow"; if (headline) headline.textContent = "Extracting Data..."; }
      else if (phase === "ai") { card.classList.add("phase-ai"); if (icon) icon.className = "fas fa-brain spin-slow"; if (headline) headline.textContent = "AI Analysis Active..."; }
      else if (phase === "complete") { card.classList.add("phase-complete"); if (icon) icon.className = "fas fa-check-circle"; if (headline) headline.textContent = "Job Completed"; }
    }

    function toggleMapWorkspace(open) {
      if (open) {
        elements.mapModal.style.display = 'flex'; elements.bigMapContainer.appendChild(elements.mapElement);
        setTimeout(() => { if (window.rtrlApp.map) { window.rtrlApp.map.invalidateSize(); if (window.rtrlApp.state.anchors.length > 0) { const group = new L.featureGroup(window.rtrlApp.state.anchors.map(a => a.circle)); window.rtrlApp.map.fitBounds(group.getBounds().pad(0.1)); } } }, 150);
      } else {
        elements.mapModal.style.display = 'none'; elements.smallMapContainer.appendChild(elements.mapElement);
        setTimeout(() => { if (window.rtrlApp.map) { window.rtrlApp.map.invalidateSize(true); if (window.rtrlApp.state.anchors.length > 0) { const group = new L.featureGroup(window.rtrlApp.state.anchors.map(a => a.circle)); window.rtrlApp.map.fitBounds(group.getBounds().pad(0.1)); } else { window.rtrlApp.map.setView([-33.8688, 151.2093], 10); } } updateMapPreviewText(); }, 200);
      }
    }

    if (elements.btnOpenMapWorkspace) { elements.btnOpenMapWorkspace.onclick = (e) => { e.preventDefault(); toggleMapWorkspace(true); }; }
    if (elements.btnCloseMapWorkspace) { elements.btnCloseMapWorkspace.onclick = (e) => { e.preventDefault(); toggleMapWorkspace(false); }; }

    function setupPasswordToggle(toggleId, inputId) {
      const toggleBtn = document.getElementById(toggleId), inputField = document.getElementById(inputId);
      if (toggleBtn && inputField) { toggleBtn.addEventListener("click", () => { const type = inputField.getAttribute("type") === "password" ? "text" : "password"; inputField.setAttribute("type", type); toggleBtn.classList.toggle("fa-eye"); toggleBtn.classList.toggle("fa-eye-slash"); }); }
    }
    setupPasswordToggle("toggle-login-password", "password-input");
    setupPasswordToggle("toggle-signup-password", "signup-password-input");

    elements.loginEmailBtn?.addEventListener("click", async () => {
      const email = elements.emailInputAuth.value, password = elements.passwordInputAuth.value;
      if (!email || !password) return alert("Please enter credentials.");
      elements.loginEmailBtn.disabled = true;
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) { alert(error.message); elements.loginEmailBtn.disabled = false; }
    });

    elements.signupEmailBtn?.addEventListener("click", async () => {
      const email = elements.signupEmailInput.value, password = elements.signupPasswordInput.value;
      if (!email || !password) return alert("Please enter credentials.");
      elements.signupEmailBtn.disabled = true;
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) { alert(error.message); elements.signupEmailBtn.disabled = false; } else if (!data.session) { alert("Check email!"); elements.flipCardContainer.classList.remove("flipped"); elements.signupEmailBtn.disabled = false; }
    });

    elements.logoutButton?.addEventListener("click", async (e) => { e.preventDefault(); await supabaseClient.auth.signOut(); window.location.reload(); });

supabaseClient.auth.onAuthStateChange(async (event, session) => {
      currentUserSession = session;
      if (session) {
        const currentSocketId = socket.id;
        const currentToken = session.access_token;

        if (socket.connected && (currentSocketId !== lastAuthenticatedSocketId || currentToken !== lastAuthenticatedToken)) {
            socket.emit("authenticate_socket", currentToken);
            lastAuthenticatedSocketId = currentSocketId;
            lastAuthenticatedToken = currentToken;
        }

        elements.loginOverlay.style.display = "none"; 
        elements.appContent.style.display = "block"; 
        elements.userMenu.style.display = "block";
        elements.userInfoSpan.textContent = session.user.user_metadata.full_name || "User"; 
        elements.userEmailDisplay.textContent = session.user.email;
        
        refreshUsageTracker();
        
        supabaseClient.from("profiles").select("role").eq("id", session.user.id).single().then(({ data: profile }) => { 
            if (profile?.role === "admin") document.getElementById("admin-control-link").style.display = "flex"; 
        });

        if (elements.userEmailInput.value === "") elements.userEmailInput.value = session.user.email;
        
        fetchPostcodeLists();
        window.rtrlApp.fetchLocations(); 
        window.rtrlApp.jobHistory.fetchAndRenderJobs();

        fetch(`${BACKEND_URL}/api/exclusions`, { headers: { Authorization: `Bearer ${session.access_token}` } })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => { 
                if (data) window.rtrlApp.exclusionFeature.populateTags(data.exclusionList); 
            });
      } else {
        elements.loginOverlay.style.display = "flex"; 
        elements.appContent.style.display = "none"; 
        elements.userMenu.style.display = "none";
        lastAuthenticatedSocketId = null;
        lastAuthenticatedToken = null;
      }
    });

    let savedPostcodeLists = [];
    async function fetchPostcodeLists() {
      if (!currentUserSession) return;
      try {
        const response = await fetch(`${BACKEND_URL}/api/postcode-lists`, { headers: { Authorization: `Bearer ${currentUserSession.access_token}` } });
        if (response.ok) {
          savedPostcodeLists = await response.json();
          elements.postcodeListSelect.innerHTML = '<option value="" disabled selected hidden>-- Load Saved Location --</option>';
          savedPostcodeLists.forEach((list) => { const option = document.createElement("option"); option.value = list.id; option.textContent = list.list_name; elements.postcodeListSelect.appendChild(option); });
        }
      } catch (e) { }
    }

    function setupPostcodeListHandlers() {
      if (!elements.postcodeListSelect) return;
      elements.postcodeListSelect.addEventListener("change", () => {
        const sl = savedPostcodeLists.find((list) => list.id == elements.postcodeListSelect.value);
        window.rtrlApp.postalCodes.length = 0; elements.postalCodeContainer.querySelectorAll(".tag").forEach((tag) => tag.remove());
        if (sl) { sl.postcodes.forEach((pc) => window.rtrlApp.validateAndAddTag(pc)); elements.deletePostcodeListButton.style.display = "inline-flex"; }
        else { elements.deletePostcodeListButton.style.display = "none"; }
      });
      new MutationObserver(() => elements.savePostcodeListButton.disabled = elements.postalCodeContainer.querySelector(".tag") === null).observe(elements.postalCodeContainer, { childList: true });
      elements.savePostcodeListButton.addEventListener("click", async () => {
        const listName = prompt("Name this list:", ""); if (!listName || !currentUserSession) return;
        const response = await fetch(`${BACKEND_URL}/api/postcode-lists`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentUserSession.access_token}` }, body: JSON.stringify({ list_name: listName.trim(), postcodes: window.rtrlApp.postalCodes }), });
        if (response.status === 201) fetchPostcodeLists();
      });
      elements.deletePostcodeListButton.addEventListener("click", async () => { if (elements.postcodeListSelect.value && currentUserSession && confirm("Delete?")) { const response = await fetch(`${BACKEND_URL}/api/postcode-lists/${elements.postcodeListSelect.value}`, { method: "DELETE", headers: { Authorization: `Bearer ${currentUserSession.access_token}` }, }); if (response.ok) fetchPostcodeLists(); } });
    }

    async function getPlaceDetails(placeId) {
      return new Promise((resolve, reject) => {
        if (!window.rtrlApp.state.googleMapsGeocoder) return reject();
        window.rtrlApp.state.googleMapsGeocoder.geocode({ placeId }, (results, status) => { if (status === google.maps.GeocoderStatus.OK && results[0]) resolve(results[0]); else reject(); });
      });
    }

    window.rtrlApp.handleLocationSelection = async (item) => {
      try {
        const details = await getPlaceDetails(item.place_id);
        const countryName = (details.address_components.find((c) => c.types.includes("country")) || {}).long_name || "";
        if (countryName) elements.countryInput.value = countryName;
        elements.locationInput.value = item.description;
      } catch (error) { elements.locationInput.value = item.description.split(",")[0]; }
    };

    window.rtrlApp.handleAnchorPointSelection = async (item) => {
      const details = await new Promise((resolve, reject) => { window.rtrlApp.state.googleMapsGeocoder.geocode({ placeId: item.place_id }, (results, status) => { if (status === "OK" && results[0]) resolve(results[0]); else reject(); }); });
      const { lat, lng } = details.geometry.location;
      window.rtrlApp.addAnchor({ lat: lat(), lng: lng() }, item.description.split(',')[0]);
      const wsInput = document.getElementById('workspace-search-input'); if (wsInput) wsInput.value = '';
      if (elements.mapModal && elements.mapModal.style.display !== 'flex') { toggleMapWorkspace(true); }
    };

    window.rtrlApp.handlePostalCodeSelection = async (item) => {
      try {
        const details = await getPlaceDetails(item.place_id);
        const pc = details.address_components.find((c) => c.types.includes("postal_code"));
        if (pc) { await window.rtrlApp.validateAndAddTag(pc.long_name); elements.postalCodeInput.value = ""; }
      } catch (error) { }
    };

    window.rtrlApp.validateAndAddTag = async (postcode) => {
      const v = postcode.trim(); if (!v || isNaN(v) || window.rtrlApp.postalCodes.includes(v)) { elements.postalCodeInput.value = ""; return; }
      const iso = countries.find((c) => c.text.toLowerCase() === elements.countryInput.value.toLowerCase())?.value;
      if (!iso || !window.rtrlApp.state.googleMapsGeocoder) return;
      window.rtrlApp.state.googleMapsGeocoder.geocode({ componentRestrictions: { country: iso, postalCode: v } }, (res, status) => {
        if (status === google.maps.GeocoderStatus.OK && res[0]) {
          const pcComp = res[0].address_components.find((c) => c.types.includes("postal_code"));
          if (pcComp?.long_name === v) {
            const sub = res[0].address_components.find((c) => c.types.includes("locality"));
            window.rtrlApp.postalCodes.push(v);
            const tagEl = document.createElement("span"); tagEl.className = "tag"; tagEl.innerHTML = `<span>${sub ? sub.long_name + " " : ""}${v}</span> <span class="tag-close-btn" data-value="${v}">&times;</span>`;
            elements.postalCodeContainer.insertBefore(tagEl, elements.postalCodeInput); elements.postalCodeInput.value = "";
          }
        }
      });
    };

    window.rtrlApp.setLocationInputsState = (d) => {
      elements.locationInput.disabled = d; elements.postalCodeInput.disabled = d;
      if (d) { elements.locationInput.value = ""; window.rtrlApp.postalCodes.length = 0; elements.postalCodeContainer.querySelectorAll(".tag").forEach((tag) => tag.remove()); }
    };

    window.rtrlApp.setRadiusInputsState = (d) => {
      if (elements.btnOpenMapWorkspace) elements.btnOpenMapWorkspace.disabled = d;
      if (d) {
        window.rtrlApp.state.anchors.forEach(a => { if (window.rtrlApp.map && a.marker && a.circle) { window.rtrlApp.map.removeLayer(a.marker); window.rtrlApp.map.removeLayer(a.circle); } });
        window.rtrlApp.state.anchors = []; window.rtrlApp.state.activeLocationId = null;
        updateMapPreviewText(); renderZoneList();
      }
    };

    window.rtrlApp.initializeMapServices = () => { if (window.google?.maps?.places) { window.rtrlApp.state.googleMapsService = new google.maps.places.AutocompleteService(); window.rtrlApp.state.googleMapsGeocoder = new google.maps.Geocoder(); } };

    window.rtrlApp.fetchPlaceSuggestions = (el, sel, t, onSelect) => {
      if (!window.rtrlApp.state.googleMapsService || el.value.trim().length < 2) return (sel.style.display = "none");
      const iso = countries.find((c) => c.text.toLowerCase() === elements.countryInput.value.toLowerCase())?.value;
      const req = { input: el.value, types: t };
      if (iso) req.componentRestrictions = { country: iso };
      window.rtrlApp.state.googleMapsService.getPlacePredictions(req, (p, status) => { if (status === google.maps.places.PlacesServiceStatus.OK && p) renderSuggestions(el, sel, p.map((x) => ({ description: x.description, place_id: x.place_id })), "description", "place_id", onSelect); else sel.style.display = "none"; });
    };

    if (document.getElementById("map")) {
      window.rtrlApp.map = L.map("map").setView([-33.8688, 151.2093], 10);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" }).addTo(window.rtrlApp.map);
      window.rtrlApp.map.on('click', async function (e) {
        if (elements.mapModal && elements.mapModal.style.display === 'flex') {
          let name = `Zone ${window.rtrlApp.state.anchors.length + 1}`;
          if (window.rtrlApp.state.googleMapsGeocoder) {
            try {
              const results = await new Promise((resolve, reject) => { window.rtrlApp.state.googleMapsGeocoder.geocode({ location: e.latlng }, (res, status) => { if (status === "OK" && res[0]) resolve(res); else reject(status); }); });
              let locality = results[0].address_components.find(c => c.types.includes("locality"));
              if (locality) name = locality.long_name; else name = results[0].formatted_address.split(',')[0];
            } catch (err) { }
          }
          window.rtrlApp.addAnchor(e.latlng, name);
        }
      });
    }

    window.rtrlApp.addAnchor = function (latlng, name, savedRadius = 3, savedId = null) {
      const id = savedId || Date.now();
      const radius = parseFloat(savedRadius);
      const marker = L.marker(latlng, { draggable: true }).addTo(window.rtrlApp.map);
      const circle = L.circle(latlng, { radius: radius * 1000, color: "#3b82f6", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.15 }).addTo(window.rtrlApp.map);
      const anchor = { id, marker, circle, radius: radius, name, lat: latlng.lat, lng: latlng.lng };
      window.rtrlApp.state.anchors.push(anchor);
      
      marker.on('drag', (e) => { const pos = e.target.getLatLng(); circle.setLatLng(pos); anchor.lat = pos.lat; anchor.lng = pos.lng; });
      marker.on('dragend', async (e) => {
        const pos = e.target.getLatLng();
        if (window.rtrlApp.state.googleMapsGeocoder) {
          try {
            const results = await new Promise((resolve, reject) => { window.rtrlApp.state.googleMapsGeocoder.geocode({ location: pos }, (res, status) => { if (status === "OK" && res[0]) resolve(res); else reject(status); }); });
            let locality = results[0].address_components.find(c => c.types.includes("locality"));
            if (locality) anchor.name = locality.long_name; else anchor.name = results[0].formatted_address.split(',')[0];
          } catch (err) { }
        }
        window.rtrlApp.setLocationDirty(true);
      });
      
      window.rtrlApp.renderZoneList();
      
      if (window.rtrlApp.state.anchors.length === 1 && !savedId) { window.rtrlApp.map.setView(latlng, 12); }
      else if (!savedId) { const group = new L.featureGroup(window.rtrlApp.state.anchors.map(a => a.circle)); window.rtrlApp.map.fitBounds(group.getBounds().pad(0.1)); }
      
      if (!savedId) { window.rtrlApp.setLocationDirty(true); }
    };

    window.rtrlApp.clearAllPins = () => {
        window.rtrlApp.state.anchors.forEach(a => {
            if(a.marker) window.rtrlApp.map.removeLayer(a.marker);
            if(a.circle) window.rtrlApp.map.removeLayer(a.circle);
        });
        window.rtrlApp.state.anchors = [];
        window.rtrlApp.state.activeLocationId = null;
        window.rtrlApp.state.isDirty = false;
        window.rtrlApp.renderZoneList();
    };

    function renderZoneList() {
      const list = document.getElementById('zone-list');
      if (!list) return;

      const activeId = window.rtrlApp.state.activeLocationId;
      const isDirty = window.rtrlApp.state.isDirty;
      const activeLoc = window.rtrlApp.state.locations.find(l => l.id === activeId);

      let statusClass = "state-draft", statusLabel = "New Search Layout", statusIcon = "fa-pencil-ruler";
      if (activeId) {
        statusClass = isDirty ? "state-modified" : "state-synced";
        statusLabel = isDirty ? `${activeLoc.name}* (Modified)` : activeLoc.name;
        statusIcon = isDirty ? "fa-sync-alt" : "fa-check-circle";
      }

      list.innerHTML = `
        <div class="loc-manager-header ${statusClass}">
            <div class="loc-status-row">
                <i class="fas ${statusIcon} ${isDirty && activeId ? 'fa-spin' : ''}"></i>
                <span class="loc-name-display">${statusLabel}</span>
                ${activeId || window.rtrlApp.state.anchors.length > 0 ? `<button onclick="window.rtrlApp.clearAllPins()" class="btn-unload" title="Clear Map">&times;</button>` : ''}
            </div>
            <div class="loc-controls">
                <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                    <select id="location-preset-dropdown" class="loc-select" style="margin-bottom:0; flex:1;">
                        <option value="">-- Load Saved Location --</option>
                        ${window.rtrlApp.state.locations.map(l => `<option value="${l.id}" ${activeId === l.id ? 'selected' : ''}>${l.name}</option>`).join('')}
                    </select>
                    
                    ${activeId ? `
                        <button onclick="window.rtrlApp.deleteLocation('${activeId}')" class="zone-delete-btn" style="height: 34px; width: 34px; background: #fee2e2; border-radius: 6px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#ef4444; border:none; cursor:pointer;" title="Delete Preset Permanently">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    ` : ''}
                </div>
                
                <div class="loc-action-btns" style="display:flex; gap:8px;">
                    <button onclick="window.rtrlApp.saveLocation(false)" class="btn-save-new" style="flex:1">Save New</button>
                    ${activeId && isDirty ? `<button onclick="window.rtrlApp.saveLocation(true)" class="btn-update" style="flex:1">Update '${activeLoc.name}'</button>` : ''}
                </div>
            </div>
        </div>
      `;

      setTimeout(() => {
          const sel = document.getElementById('location-preset-dropdown');
          if(sel) sel.onchange = (e) => { if(e.target.value) window.rtrlApp.loadLocation(e.target.value); };
      }, 0);

      window.rtrlApp.state.anchors.forEach(a => {
        const card = document.createElement('div');
        card.className = "zone-card";
        card.innerHTML = `
            <div class="zone-card-header">
                <span class="zone-card-title">${a.name}</span>
                <button class="zone-delete-btn" onclick="window.rtrlApp.deleteZone('${a.id}')"><i class="fas fa-trash-alt"></i></button>
            </div>
            <div class="zone-slider-container">
                <input type="range" class="zone-slider-input" min="1" max="25" value="${a.radius}" oninput="window.rtrlApp.updateRadius('${a.id}', this.value)">
                <span class="zone-radius-display">${a.radius}km</span>
            </div>`;
        list.appendChild(card);
      });
      updateMapPreviewText();
    }


    window.rtrlApp.updateRadius = (id, val) => {
        const a = window.rtrlApp.state.anchors.find(x => x.id == id);
        if(a) { a.radius = parseInt(val); a.circle.setRadius(a.radius * 1000); window.rtrlApp.setLocationDirty(true); }
    };

    window.rtrlApp.deleteZone = (id) => {
        const a = window.rtrlApp.state.anchors.find(x => x.id == id);
        if(a) { window.rtrlApp.map.removeLayer(a.marker); window.rtrlApp.map.removeLayer(a.circle); window.rtrlApp.state.anchors = window.rtrlApp.state.anchors.filter(x => x.id != id); window.rtrlApp.setLocationDirty(true); }
    };

    function updateMapPreviewText() {
      const txt = document.getElementById('map-preview-text');
      if (!txt) return;
      const activeId = window.rtrlApp.state.activeLocationId;
      const location = window.rtrlApp.state.locations.find(l => l.id === activeId);
      if (location) { txt.innerHTML = `Target Area: <strong style="color: #3b82f6;">${location.name}</strong> (${window.rtrlApp.state.anchors.length} zones active).`; } 
      else { txt.textContent = `${window.rtrlApp.state.anchors.length} active search zone(s) defined.`; }
    }

    window.rtrlApp.renderZoneList = renderZoneList;
    window.rtrlApp.updateMapPreviewText = updateMapPreviewText;

    if (elements.workspaceSearchInput) {
      elements.workspaceSearchInput.addEventListener('input', () => {
        clearTimeout(window.rtrlApp.timers.workspace);
        window.rtrlApp.timers.workspace = setTimeout(() => {
          window.rtrlApp.fetchPlaceSuggestions(elements.workspaceSearchInput, elements.workspaceSuggestions, ["geocode"], window.rtrlApp.handleAnchorPointSelection);
        }, 300);
      });
    }

    window.rtrlApp.startResearch = () => {
      if (!currentUserSession) return;
      document.querySelectorAll(".collapsible-section").forEach(s => { s.style.borderColor = ""; s.style.boxShadow = ""; });
      const errorModal = document.getElementById("alert-modal");
      const errorText = document.getElementById("alert-modal-message");
      const businessNamesRaw = elements.businessNamesInput.value.trim();
      const businessNamesArr = businessNamesRaw.split("\n").map((n) => n.trim()).filter(Boolean);
      const hasCustomKeywords = window.rtrlApp.customKeywords.length > 0;
      const hasTieredSelection = activeSelections.length > 0;
      const hasBusinessDef = businessNamesArr.length > 0 || hasCustomKeywords || hasTieredSelection;
      const hasLocationText = elements.locationInput.value.trim().length > 0;
      const hasPostcodes = window.rtrlApp.postalCodes.length > 0;
      const hasRadiusAnchors = window.rtrlApp.state.anchors.length > 0;
      const hasLocationDef = hasLocationText || hasPostcodes || hasRadiusAnchors;
      const expandAndHighlight = (elementId) => {
        const content = document.getElementById(elementId);
        if (content && content.classList.contains("collapsed")) { content.classList.remove("collapsed"); const icon = content.previousElementSibling.querySelector(".toggle-icon"); if (icon) icon.classList.add("open"); if (elementId === "radiusSearchContainer" && window.rtrlApp.map) { setTimeout(() => window.rtrlApp.map.invalidateSize(), 300); } }
        const section = content.closest(".collapsible-section"); section.style.borderColor = "#ef4444"; section.style.boxShadow = "0 0 0 1px #ef4444";
      };
      if (!hasBusinessDef && !hasLocationDef) { errorText.innerHTML = "You haven't defined <b>what</b> to search for or <b>where</b> to search. Please complete the highlighted sections."; expandAndHighlight("bulkSearchContainer"); expandAndHighlight("locationSearchContainer"); expandAndHighlight("radiusSearchContainer"); errorModal.style.display = "flex"; return; }
      if (!hasBusinessDef) { errorText.innerHTML = "Please specify a <b>Category</b> or enter <b>Business Names</b> so the system knows what to look for."; expandAndHighlight("bulkSearchContainer"); expandAndHighlight("individualSearchContainer"); errorModal.style.display = "flex"; return; }
      if (!hasLocationDef) { errorText.innerHTML = "The system needs a <b>Location</b>. Please provide a Suburb or define a Search Radius."; expandAndHighlight("locationSearchContainer"); expandAndHighlight("radiusSearchContainer"); errorModal.style.display = "flex"; return; }
      
      let finalLoopList = []; const modifier = elements.categoryModifierInput.value.trim();
      if (businessNamesArr.length > 0) { finalLoopList = businessNamesArr; } else if (hasCustomKeywords) { finalLoopList = window.rtrlApp.customKeywords; } else { activeSelections.forEach(sel => { sel.terms.forEach(term => { finalLoopList.push(modifier ? `"${modifier}" ${term}` : term); }); }); }
      
      const localToday = new Date(); const multiPoints = window.rtrlApp.state.anchors.map(a => ({ coords: `${a.lat},${a.lng}`, radius: a.radius, name: a.name }));
      const p = { country: elements.countryInput.value, businessNames: businessNamesArr, userEmail: elements.userEmailInput.value.trim(), exclusionList: window.rtrlApp.exclusionFeature.getExclusionList(), useAiEnrichment: elements.useAiToggle.checked, categoriesToLoop: finalLoopList, count: elements.findAllBusinessesCheckbox.checked || !elements.countInput.value.trim() ? -1 : parseInt(elements.countInput.value, 10) };
      
      if (multiPoints.length > 0) { p.multiRadiusPoints = multiPoints; p.anchorPoint = null; } else { p.location = elements.locationInput.value.trim(); p.postalCode = window.rtrlApp.postalCodes; }
      
let areaKey = ""; 
      if (window.rtrlApp.state.anchors.length > 0) {
          areaKey = window.rtrlApp.state.anchors
              .map(a => `${a.name.split(',')[0].trim()} (${a.radius}km)`)
              .join(', ');
          
          const activeId = window.rtrlApp.state.activeLocationId;
          const locationObj = window.rtrlApp.state.locations.find(l => l.id === activeId);
          if (locationObj) {
              areaKey = `${locationObj.name}: ${areaKey}`;
          }
      } else if (window.rtrlApp.postalCodes.length > 0) { 
          areaKey = `Postcodes: ${window.rtrlApp.postalCodes.join(", ")}`; 
      } else { 
          areaKey = elements.locationInput.value.split(",")[0]; 
      } if (areaKey.length > 100) areaKey = areaKey.substring(0, 97) + "...";
      
      p.searchParamsForEmail = { primaryCategory: selectedIndustry || "Custom Search", subCategory: activeSelections.length > 1 ? "multiple_categories" : (activeSelections[0]?.label || ""), subCategoryList: activeSelections.map(s => s.label), customCategory: window.rtrlApp.customKeywords.length > 0 ? window.rtrlApp.customKeywords.join(", ") : modifier, area: areaKey, postcodes: window.rtrlApp.postalCodes, country: elements.countryInput.value, };
      socket.emit("start_scrape_job", { authToken: currentUserSession.access_token, clientLocalDate: `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, "0")}-${String(localToday.getDate()).padStart(2, "0")}`, ...p, });
      
      const originalText = elements.startButton.innerHTML; elements.startButton.innerHTML = '<i class="fas fa-check"></i> Added to Queue!'; elements.startButton.style.backgroundColor = "#10b981"; elements.startButton.disabled = true;
      setTimeout(() => {
        elements.locationInput.value = "";
        elements.startButton.innerHTML = originalText; elements.startButton.style.backgroundColor = ""; elements.startButton.disabled = false; elements.locationInput.value = ""; elements.businessNamesInput.value = ""; window.rtrlApp.postalCodes = []; window.rtrlApp.customKeywords = []; activeSelections = []; updateSelectionPills(); renderExplorer(); document.querySelectorAll(".tag").forEach(t => t.remove()); if (typeof window.rtrlApp.setRadiusInputsState === 'function') window.rtrlApp.setRadiusInputsState(true);
      }, 2000);
    };

    async function initializeApp() {
      window.rtrlApp.jobHistory.init(() => currentUserSession?.access_token, BACKEND_URL);
      window.rtrlApp.review.init(() => currentUserSession?.access_token, BACKEND_URL);
      window.rtrlApp.exclusionFeature.init(() => currentUserSession?.access_token);
      const industries = await fetchCategoryDefinitions();
      if (industries.length > 0) { const subGroup = document.getElementById('subCategoryGroup'); if (subGroup) subGroup.style.display = 'block'; renderIndustryPills(industries); }
      if (localStorage.getItem("rtrl_last_used_email")) { elements.userEmailInput.value = localStorage.getItem("rtrl_last_used_email"); }
      setupPostcodeListHandlers();
      if (typeof setupEventListeners === 'function') { setupEventListeners(elements, socket, categoryHierarchy, countries, window.rtrlApp.postalCodes, window.rtrlApp.customKeywords, window.rtrlApp.map, window.rtrlApp.searchCircle,); }
      loadGoogleMaps();
    }
    initializeApp();
  }
  initializeMainApp();

  window.rtrlApp.cloneJobIntoForm = (p) => {
    window.rtrlApp.state.activeLocationId = null;
    window.rtrlApp.state.isDirty = false;
    const el = { primaryCat: document.getElementById("primaryCategorySelect"), customCat: document.getElementById("customCategoryInput"), location: document.getElementById("locationInput"), country: document.getElementById("countryInput"), count: document.getElementById("count"), findAll: document.getElementById("findAllBusinesses"), names: document.getElementById("businessNamesInput"), aiToggle: document.getElementById("useAiToggle"), };
    if (window.rtrlApp.state.anchors && window.rtrlApp.state.anchors.length > 0) { window.rtrlApp.state.anchors.forEach(a => { if (a.marker) window.rtrlApp.map.removeLayer(a.marker); if (a.circle) window.rtrlApp.map.removeLayer(a.circle); }); }
    window.rtrlApp.state.anchors = []; window.rtrlApp.postalCodes = []; window.rtrlApp.customKeywords = [];
    if (el.location) el.location.value = ""; if (el.names) el.names.value = ""; document.querySelectorAll(".tag").forEach((t) => t.remove());
    if (window.rtrlApp.renderZoneList) window.rtrlApp.renderZoneList(); if (window.rtrlApp.updateMapPreviewText) window.rtrlApp.updateMapPreviewText();
    if (el.aiToggle) el.aiToggle.checked = p.useAiEnrichment !== false; if (el.country) el.country.value = p.country || "Australia";
    if (p.count === -1) { if (el.findAll) el.findAll.checked = true; if (el.count) { el.count.value = ""; el.count.disabled = true; } }
    else { if (el.findAll) el.findAll.checked = false; if (el.count) { el.count.value = p.count || ""; el.count.disabled = false; } }
    if (p.businessNames?.length > 0) { if (el.names) el.names.value = p.businessNames.join("\n"); const indContainer = document.getElementById("individualSearchContainer"); if (indContainer) indContainer.classList.remove("collapsed"); }
    else if (p.categoriesToLoop) {
      p.categoriesToLoop.forEach((kw) => {
        window.rtrlApp.customKeywords.push(kw); const t = document.createElement("span"); t.className = "tag"; t.innerHTML = `<span>${kw}</span> <span class="tag-close-btn" data-value="${kw}">&times;</span>`;
        const kwContainer = document.getElementById("customKeywordContainer"); if (kwContainer && el.customCat) kwContainer.insertBefore(t, el.customCat);
      });
    }
    if (p.multiRadiusPoints && p.multiRadiusPoints.length > 0) {
      p.multiRadiusPoints.forEach((point, i) => { const co = point.coords.split(","); const latlng = { lat: parseFloat(co[0]), lng: parseFloat(co[1]) }; const zoneName = point.name || `Zone ${i + 1}`; window.rtrlApp.addAnchor(latlng, zoneName, point.radius); });
      const radContainer = document.getElementById("radiusSearchContainer"); if (radContainer) { radContainer.classList.remove("collapsed"); const icon = radContainer.previousElementSibling.querySelector(".toggle-icon"); if (icon) icon.classList.add("open"); }
    } else if (p.radiusKm && p.anchorPoint) {
      const co = p.anchorPoint.split(","); if (co.length === 2) { const latlng = { lat: parseFloat(co[0]), lng: parseFloat(co[1]) }; window.rtrlApp.addAnchor(latlng, p.searchParamsForEmail?.area || "Search Area", p.radiusKm); const radContainer = document.getElementById("radiusSearchContainer"); if (radContainer) radContainer.classList.remove("collapsed"); }
    } else {
      if (el.location) el.location.value = p.location || ""; if (p.postalCode) p.postalCode.forEach((pc) => window.rtrlApp.validateAndAddTag(pc));
      const locContainer = document.getElementById("locationSearchContainer"); if (locContainer) { locContainer.classList.remove("collapsed"); const icon = locContainer.previousElementSibling.querySelector(".toggle-icon"); if (icon) icon.classList.add("open"); }
    }
    if (window.rtrlApp.renderZoneList) window.rtrlApp.renderZoneList(); if (window.rtrlApp.updateMapPreviewText) window.rtrlApp.updateMapPreviewText();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
});