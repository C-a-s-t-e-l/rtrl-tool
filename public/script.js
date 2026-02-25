document.addEventListener("DOMContentLoaded", () => {
  const BACKEND_URL = "https://backend.rtrlprospector.space";
  const SUPABASE_URL = window.CONFIG.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.CONFIG.SUPABASE_ANON_KEY;

  const { createClient } = supabase;
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let currentUserSession = null;
  let currentJobId = null;
  let subscribedJobId = null;

  window.rtrlApp = {
    ...window.rtrlApp,
    state: {
      selectedAnchorPoint: null,
      currentSearchParameters: {},
      googleMapsService: null,
      googleMapsGeocoder: null,
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
    drawSearchCircle: () => {},
  };

  function initializeMainApp() {
    async function refreshUsageTracker() {
      if (!currentUserSession) return;

      const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("usage_today, daily_limit, last_reset_date")
        .eq("id", currentUserSession.user.id)
        .single();

      if (error || !profile) {
        console.error("Error fetching user profile for usage tracker:", error);
        return;
      }

      const current = profile.usage_today || 0;
      const limit = profile.daily_limit || 500;
      const lastResetDateStr = profile.last_reset_date;

      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, "0");
      const day = String(today.getDate()).padStart(2, "0");
      const todayStr = `${year}-${month}-${day}`;

      let displayCurrentUsage = current;

      if (lastResetDateStr && lastResetDateStr < todayStr) {
        displayCurrentUsage = 0;
      }

      const percentage = Math.min(
        Math.round((displayCurrentUsage / limit) * 100),
        100
      );

      if (elements.dashUsageCurrent)
        elements.dashUsageCurrent.textContent =
          displayCurrentUsage.toLocaleString();
      if (elements.dashUsageLimit)
        elements.dashUsageLimit.textContent = limit.toLocaleString();
      if (elements.dashUsagePercent)
        elements.dashUsagePercent.textContent = `${percentage}% consumed`;

      if (elements.dashUsageFill) {
        elements.dashUsageFill.style.width = `${percentage}%`;
        elements.dashUsageFill.style.backgroundColor =
          percentage > 90 ? "#ef4444" : "#8b5cf6";
      }

      let planName = "Standard Plan";
      if (limit <= 100) planName = "Starter Plan";
      if (limit >= 1000 && limit < 5000) planName = "Power Plan";
      if (limit >= 5000) planName = "Executive Plan";
      if (elements.dashPlanBadge) elements.dashPlanBadge.textContent = planName;

      if (elements.dashUsageStatus) {
        if (displayCurrentUsage >= limit) {
          elements.dashUsageStatus.textContent =
            "Daily limit reached. Resets at midnight.";
          elements.dashUsageStatus.style.color = "#ef4444";
        } else {
          elements.dashUsageStatus.textContent = "Account in good standing";
          elements.dashUsageStatus.style.color = "#64748b";
        }
      }

      const now = new Date();
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      const diffMs = midnight.getTime() - now.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.round(
        (diffMs % (1000 * 60 * 60)) / (1000 * 60)
      );

      let resetTimerText = "";
      if (diffHours > 0) {
        resetTimerText = `Resets in ${diffHours}h`;
        if (diffMinutes > 0) resetTimerText += ` ${diffMinutes}m`;
      } else if (diffMinutes > 0) {
        resetTimerText = `Resets in ${diffMinutes}m`;
      } else {
        resetTimerText = "Resetting soon...";
      }

      if (elements.dashResetTimer)
        elements.dashResetTimer.textContent = resetTimerText;
    }

    async function loadGoogleMaps() {
      try {
        const response = await fetch(`${BACKEND_URL}/api/config`, {
          headers: { "ngrok-skip-browser-warning": "true" },
        });
        const config = await response.json();
        const googleMapsApiKey = config.googleMapsApiKey;

        if (googleMapsApiKey) {
          const script = document.createElement("script");
          script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places&callback=initMap`;
          script.async = true;
          document.head.appendChild(script);
        }
      } catch (error) {
        console.error("Failed to fetch config from server:", error);
      }
    }

    const elements = {
      startButton: document.getElementById("startButton"),
      useAiToggle: document.getElementById("useAiToggle"),
      primaryCategorySelect: document.getElementById("primaryCategorySelect"),
      subCategoryGroup: document.getElementById("subCategoryGroup"),
      subCategoryCheckboxContainer: document.getElementById(
        "subCategoryCheckboxContainer"
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
      bulkSearchContainer: document.getElementById("bulkSearchContainer"),
      locationSearchContainer: document.getElementById(
        "locationSearchContainer"
      ),
      radiusSearchContainer: document.getElementById("radiusSearchContainer"),
      anchorPointInput: document.getElementById("anchorPointInput"),
      anchorPointSuggestionsEl: document.getElementById(
        "anchorPointSuggestions"
      ),
      radiusSlider: document.getElementById("radiusSlider"),
      radiusValue: document.getElementById("radiusValue"),
      logEl: document.getElementById("status-text"),
      postcodeListSelect: document.getElementById("postcodeListSelect"),
      savePostcodeListButton: document.getElementById("savePostcodeListButton"),
      deletePostcodeListButton: document.getElementById(
        "deletePostcodeListButton"
      ),
      categoryModifierGroup: document.getElementById("categoryModifierGroup"),
      categoryModifierInput: document.getElementById("categoryModifierInput"),
      loginGoogleBtn: document.getElementById("login-google"),
      loginMicrosoftBtn: document.getElementById("login-microsoft"),
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
      progressBar: document.getElementById("progressBar"),
      progressPercentage: document.getElementById("progressPercentage"),
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
    };

    if (elements.useAiToggle) {
      const savedAiState = localStorage.getItem("rtrl_use_ai_enrichment");
      if (savedAiState !== null) {
        elements.useAiToggle.checked = savedAiState === "true";
      } else {
        elements.useAiToggle.checked = true;
      }
      elements.useAiToggle.addEventListener("change", (e) => {
        localStorage.setItem("rtrl_use_ai_enrichment", e.target.checked);
      });
    }

    const socket = io(BACKEND_URL, {
      extraHeaders: { "ngrok-skip-browser-warning": "true" },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      timeout: 240000,
    });

    let disconnectTimeout = null;
    let hasLoggedDisconnect = false;
    let isFirstConnection = true;

    socket.on("connect", () => {
      if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
      }
      if (isFirstConnection || hasLoggedDisconnect) {
        logMessage(elements.logEl, "Connected to server.", "success");
        isFirstConnection = false;
        hasLoggedDisconnect = false;
      }
      const savedJobId = localStorage.getItem("rtrl_active_job_id");
      if (savedJobId && currentUserSession) {
        currentJobId = savedJobId;
        subscribedJobId = savedJobId;
        socket.emit("subscribe_to_job", {
          jobId: savedJobId,
          authToken: currentUserSession.access_token,
        });
      }
    });

    socket.on("disconnect", (reason) => {
      disconnectTimeout = setTimeout(() => {
        logMessage(elements.logEl, "Connection lost. Reconnecting...", "error");
        hasLoggedDisconnect = true;
      }, 15000);
    });

    socket.on("job_created", ({ jobId }) => {
      logMessage(elements.logEl, "Job added to queue.", "info");
      
      if (window.rtrlApp.jobHistory) {
        window.rtrlApp.jobHistory.fetchAndRenderJobs();
      }
      
      socket.emit("subscribe_to_job", {
        jobId,
        authToken: currentUserSession.access_token,
      });
      subscribedJobId = jobId;
    });

    socket.on("user_queue_update", (myJobs) => {
        const queueCard = document.getElementById("queue-card");
        const listContainer = document.getElementById("queue-list-container");
        const countBadge = document.getElementById("queue-count-badge");

        if (!myJobs || myJobs.length === 0) {
            if (queueCard) queueCard.style.display = "none";
            return;
        }

        if (queueCard) queueCard.style.display = "block";
        if (countBadge) countBadge.textContent = `${myJobs.length} Job${myJobs.length > 1 ? 's' : ''}`;
        
        if (listContainer) {
            listContainer.innerHTML = myJobs.map(job => `
                <div class="queue-item" style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 12px; border-radius: 8px; font-size: 0.85rem; color: #475569; margin-bottom: 8px;">
                    <div style="display:flex; align-items:center;">
                        <span class="queue-pos-badge" style="background: #e2e8f0; color: #475569; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; margin-right: 8px;">#${job.globalPosition}</span>
                        <span>Waiting for slot...</span> 
                    </div>
                    <i class="fas fa-hourglass-half" style="color: #f59e0b; animation: spin 2s linear infinite;"></i>
                </div>
            `).join('');
        }
    });

    function resetStatusUI() {
        const fill = document.getElementById("progress-fill");
        const pctLabel = document.getElementById("pct-label");
        const phaseLabel = document.getElementById("phase-label");
        if (fill) fill.style.width = `0%`;
        if (pctLabel) pctLabel.textContent = `0%`;
        if (phaseLabel) phaseLabel.textContent = "Phase 0/3: Starting...";
        
        if (document.getElementById("stat-found")) document.getElementById("stat-found").textContent = "0";
        if (document.getElementById("stat-processed")) document.getElementById("stat-processed").textContent = "0";
        if (document.getElementById("stat-enriched")) document.getElementById("stat-enriched").textContent = "0";
    }

    socket.on("job_state", (job) => {
      if (job.status === "running") {
        currentJobId = job.id;
        localStorage.setItem("rtrl_active_job_id", job.id);
        resetStatusUI();
        updateDashboardUi("running");
      } 
      else if (job.status === "completed" || job.status === "failed") {
        if (job.id === currentJobId) {
            localStorage.removeItem("rtrl_active_job_id");
            currentJobId = null;
            updateDashboardUi(job.status);
        }
      }
    });

    socket.on("job_log", (message) =>
      logMessage(elements.logEl, message, "info")
    );

    socket.on("job_error", ({ error }) => {
      logMessage(elements.logEl, `Error: ${error}`, "error");
    });

    socket.on("business_found", (data) => {
      refreshUsageTracker();
    });

    socket.on("user_profile_updated", () => {
      refreshUsageTracker();
    });

    socket.on("job_update", (update) => {
      if (update.status) {
        if (window.rtrlApp.jobHistory) {
          window.rtrlApp.jobHistory.fetchAndRenderJobs();
        }

        const targetId = update.id; 
        if (targetId) {
          const historyBadge = document.getElementById(`job-status-${targetId}`);
          if (historyBadge) {
            if (update.status === "completed") {
              historyBadge.className = "job-status status-completed";
              historyBadge.innerHTML =
                '<i class="fas fa-check-circle"></i> <span>Completed</span>';
            } else if (update.status === "failed") {
              historyBadge.className = "job-status status-failed";
              historyBadge.innerHTML =
                '<i class="fas fa-exclamation-triangle"></i> <span>Failed</span>';
            } else if (update.status === "running") {
              historyBadge.className = "job-status status-running";
              historyBadge.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> <span>Running</span>';
            } else if (update.status === "queued") {
                historyBadge.className = "job-status status-queued";
                historyBadge.innerHTML =
                  '<i class="fas fa-clock"></i> <span>Queued</span>';
            }
          }

          if (update.status === "running") {
              currentJobId = targetId;
              localStorage.setItem("rtrl_active_job_id", targetId);
              resetStatusUI();
              updateDashboardUi("running");
          } else if (update.status === "completed" || update.status === "failed") {
              if (targetId === currentJobId) {
                  localStorage.removeItem("rtrl_active_job_id");
                  currentJobId = null;
                  updateDashboardUi(update.status);
              }
          }
        }
      }
    });

    socket.on("progress_update", (data) => {
      const {
        phase,
        processed,
        discovered,
        added,
        target,
        enriched,
        aiProcessed,
        aiTarget,
      } = data;
      let visualPercent = 0;
      let phaseText = "Initializing...";
      if (phase === "discovery") {
        phaseText = "Phase 1/3: Scanning Maps";
        visualPercent = 5 + (discovered > 0 ? 5 : 0);
        updateStatusCardPhase("discovery");
      } else if (phase === "scraping") {
        phaseText = "Phase 1/3: Scraping Data";
        let scrapePct = 0;
        if (target === -1) {
          if (discovered > 0) scrapePct = processed / discovered;
        } else {
          if (target > 0) scrapePct = added / target;
        }
        visualPercent = 10 + Math.round((scrapePct > 1 ? 1 : scrapePct) * 60);
        updateStatusCardPhase("scraping");
      } else if (phase === "ai") {
        phaseText = "Phase 2/3: AI Enrichment";
        let aiPct = 0;
        if (aiTarget > 0) aiPct = aiProcessed / aiTarget;
        visualPercent = 70 + Math.round((aiPct > 1 ? 1 : aiPct) * 25);
        updateStatusCardPhase("ai");
      } else if (phase === "completed") {
        visualPercent = 100;
        phaseText = "Phase 3/3: Complete";
        updateStatusCardPhase("complete");
      }
      const fill = document.getElementById("progress-fill");
      const pctLabel = document.getElementById("pct-label");
      const phaseLabel = document.getElementById("phase-label");
      if (fill) fill.style.width = `${visualPercent}%`;
      if (pctLabel) pctLabel.textContent = `${visualPercent}%`;
      if (phaseLabel) phaseLabel.textContent = phaseText;
      if (document.getElementById("stat-found"))
        document.getElementById("stat-found").textContent = discovered || 0;
      if (document.getElementById("stat-processed"))
        document.getElementById("stat-processed").textContent = added || 0;
      if (document.getElementById("stat-enriched"))
        document.getElementById("stat-enriched").textContent = enriched || 0;
    });

    function updateDashboardUi(status, data = {}) {
      const headline = document.getElementById("status-headline");
      const subtext = document.getElementById("status-subtext");
      const icon = document.getElementById("status-icon");
      const card = document.getElementById("status-card");

      if (!headline || !card) return;

      card.className = "status-card";

      if (status === "running") {
        card.classList.add("state-working", "phase-scraping");
        headline.textContent = "Job Active";
        subtext.textContent = "Processing data...";
        if (icon) icon.className = "fas fa-circle-notch fa-spin";
      } else if (status === "completed") {
        card.classList.add("phase-complete");
        headline.textContent = "Job Completed";
        subtext.textContent = "Check your email for results.";
        if (icon) icon.className = "fas fa-check-circle";

        const fill = document.getElementById("progress-fill");
        const pct = document.getElementById("pct-label");
        const phase = document.getElementById("phase-label");

        if (fill) fill.style.width = "100%";
        if (pct) pct.textContent = "100%";
        if (phase) phase.textContent = "Phase 3/3: Complete";
      } else if (status === "failed") {
        card.classList.add("phase-error");
        headline.textContent = "Job Failed";
        subtext.textContent = "Please check job history or try again.";
        if (icon) icon.className = "fas fa-times-circle";
      } else {
        card.className = "status-card";
        headline.textContent = "Ready to Start";
        subtext.textContent = "Waiting for input...";
        if (icon) icon.className = "fas fa-play";
      }
    }

    function updateStatusCardPhase(phase) {
      const card = document.getElementById("status-card");
      const icon = document.getElementById("status-icon");
      const headline = document.getElementById("status-headline");
      if (!card) return;
      card.classList.remove(
        "phase-scraping",
        "phase-ai",
        "phase-complete",
        "phase-error"
      );
      if (phase === "discovery") {
        card.classList.add("phase-scraping");
        if (icon) icon.className = "fas fa-map-marked-alt spin-slow";
        if (headline) headline.textContent = "Scanning Area...";
      } else if (phase === "scraping") {
        card.classList.add("phase-scraping");
        if (icon) icon.className = "fas fa-satellite-dish spin-slow";
        if (headline) headline.textContent = "Extracting Data...";
      } else if (phase === "ai") {
        card.classList.add("phase-ai");
        if (icon) icon.className = "fas fa-brain spin-slow";
        if (headline) headline.textContent = "AI Analysis Active...";
      } else if (phase === "complete") {
        card.classList.add("phase-complete");
        if (icon) icon.className = "fas fa-check-circle";
        if (headline) headline.textContent = "Job Completed";
      }
    }

    function setupPasswordToggle(toggleId, inputId) {
      const toggleBtn = document.getElementById(toggleId);
      const inputField = document.getElementById(inputId);
      if (toggleBtn && inputField) {
        toggleBtn.addEventListener("click", () => {
          const type =
            inputField.getAttribute("type") === "password"
              ? "text"
              : "password";
          inputField.setAttribute("type", type);
          toggleBtn.classList.toggle("fa-eye");
          toggleBtn.classList.toggle("fa-eye-slash");
        });
      }
    }

    setupPasswordToggle("toggle-login-password", "password-input");
    setupPasswordToggle("toggle-signup-password", "signup-password-input");

    document
      .getElementById("login-google")
      ?.addEventListener("click", async () => {
        await supabaseClient.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.origin },
        });
      });
    document
      .getElementById("login-microsoft")
      ?.addEventListener("click", async () => {
        await supabaseClient.auth.signInWithOAuth({
          provider: "azure",
          options: { scopes: "email", redirectTo: window.location.origin },
        });
      });
    document.getElementById("to-signup-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      elements.flipCardContainer.classList.add("flipped");
    });
    document.getElementById("to-signin-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      elements.flipCardContainer.classList.remove("flipped");
    });

    elements.loginEmailBtn?.addEventListener("click", async () => {
      const email = elements.emailInputAuth.value;
      const password = elements.passwordInputAuth.value;
      if (!email || !password)
        return alert("Please enter both email and password.");
      elements.loginEmailBtn.disabled = true;
      const { error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        alert(error.message);
        elements.loginEmailBtn.disabled = false;
      }
    });

    elements.signupEmailBtn?.addEventListener("click", async () => {
      const email = elements.signupEmailInput.value;
      const password = elements.signupPasswordInput.value;
      if (!email || !password)
        return alert("Please enter both email and password.");
      elements.signupEmailBtn.disabled = true;
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
      });
      if (error) {
        alert(error.message);
        elements.signupEmailBtn.disabled = false;
      } else if (!data.session) {
        alert("Check email!");
        elements.flipCardContainer.classList.remove("flipped");
        elements.signupEmailBtn.disabled = false;
      }
    });

    elements.logoutButton?.addEventListener("click", async (e) => {
      e.preventDefault();
      await supabaseClient.auth.signOut();
      window.location.reload();
    });

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      currentUserSession = session;
      if (session) {
        if (socket.connected)
          socket.emit("authenticate_socket", session.access_token);

        elements.loginOverlay.style.display = "none";
        elements.appContent.style.display = "block";
        elements.userMenu.style.display = "block";
        elements.userInfoSpan.textContent =
          session.user.user_metadata.full_name || "User";
        elements.userEmailDisplay.textContent = session.user.email;

        refreshUsageTracker();

        supabaseClient
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single()
          .then(({ data: profile }) => {
            if (profile && profile.role === "admin") {
              const adminLink = document.getElementById("admin-control-link");
              if (adminLink) adminLink.style.display = "flex";
            }
          })
          .catch((err) =>
            console.error("Admin check failed, but continuing...")
          );

        if (elements.userEmailInput.value.trim() === "")
          elements.userEmailInput.value = session.user.email;

        fetchPostcodeLists();

        if (window.rtrlApp.jobHistory) {
          window.rtrlApp.jobHistory.fetchAndRenderJobs();
        }

        fetch(`${BACKEND_URL}/api/exclusions`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data)
              window.rtrlApp.exclusionFeature.populateTags(data.exclusionList);
          });
      } else {
        elements.loginOverlay.style.display = "flex";
        elements.appContent.style.display = "none";
        elements.userMenu.style.display = "none";
      }
    });

    let savedPostcodeLists = [];
    async function fetchPostcodeLists() {
      if (!currentUserSession) return;
      try {
        const response = await fetch(`${BACKEND_URL}/api/postcode-lists`, {
          headers: {
            Authorization: `Bearer ${currentUserSession.access_token}`,
          },
        });
        if (response.ok) {
          savedPostcodeLists = await response.json();
          elements.postcodeListSelect.innerHTML =
            '<option value="">Load a saved list...</option>';
          savedPostcodeLists.forEach((list) => {
            const option = document.createElement("option");
            option.value = list.id;
            option.textContent = list.list_name;
            elements.postcodeListSelect.appendChild(option);
          });
        }
      } catch (e) {}
    }

    function setupPostcodeListHandlers() {
      elements.postcodeListSelect.addEventListener("change", () => {
        const sl = savedPostcodeLists.find(
          (list) => list.id == elements.postcodeListSelect.value
        );
        window.rtrlApp.postalCodes.length = 0;
        elements.postalCodeContainer
          .querySelectorAll(".tag")
          .forEach((tag) => tag.remove());
        if (sl) {
          sl.postcodes.forEach((pc) => window.rtrlApp.validateAndAddTag(pc));
          elements.deletePostcodeListButton.style.display = "inline-flex";
        } else {
          elements.deletePostcodeListButton.style.display = "none";
        }
      });
      const observer = new MutationObserver(
        () =>
          (elements.savePostcodeListButton.disabled =
            elements.postalCodeContainer.querySelector(".tag") === null)
      );
      observer.observe(elements.postalCodeContainer, { childList: true });
      elements.savePostcodeListButton.addEventListener("click", async () => {
        if (!currentUserSession || window.rtrlApp.postalCodes.length === 0)
          return;
        const listName = prompt("Name this list:", "");
        if (!listName) return;
        const response = await fetch(`${BACKEND_URL}/api/postcode-lists`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentUserSession.access_token}`,
          },
          body: JSON.stringify({
            list_name: listName.trim(),
            postcodes: window.rtrlApp.postalCodes,
          }),
        });
        if (response.status === 201) await fetchPostcodeLists();
      });
      elements.deletePostcodeListButton.addEventListener("click", async () => {
        if (
          elements.postcodeListSelect.value &&
          currentUserSession &&
          confirm("Delete?")
        ) {
          const response = await fetch(
            `${BACKEND_URL}/api/postcode-lists/${elements.postcodeListSelect.value}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${currentUserSession.access_token}`,
              },
            }
          );
          if (response.ok) await fetchPostcodeLists();
        }
      });
    }

    const categories = {
      "Select Category": [],
      "Alterations and tailoring": [],
      "Baby and nursery": [
        "ALL",
        "Baby and infant toys",
        "Baby bedding",
        "Nursery furniture",
        "Prams, strollers and carriers",
        "Tableware and feeding",
      ],
      Banks: [],
      "Beauty and wellness": [
        "ALL",
        "Bath and body",
        "Fragrance",
        "Hair and beauty",
        "Hair care",
        "Makeup",
        "Skincare",
        "Vitamins and supplements",
      ],
      "Books, stationery and gifts": [
        "ALL",
        "Book stores",
        "Cards and gift wrap",
        "Newsagencies",
        "Office supplies",
        "Stationery",
      ],
      "Car and auto": [],
      Childcare: [],
      "Clothing and accessories": [
        "ALL",
        "Babies' and toddlers'",
        "Footwear",
        "Jewellery and watches",
        "Kids' and junior",
        "Men's fashion",
        "Sunglasses",
        "Women's fashion",
      ],
      "Community services": [],
      "Department stores": [],
      "Designer and boutique": [],
      "Discount and variety": [],
      "Dry cleaning": [],
      "Electronics and technology": [
        "ALL",
        "Cameras",
        "Computers and tablets",
        "Gaming and consoles",
        "Mobile and accessories",
        "Navigation",
        "TV and audio",
      ],
      "Entertainment and activities": [
        "ALL",
        "Arcades and games",
        "Bowling",
        "Cinemas",
        "Kids activities",
        "Learning and education",
        "Music",
      ],
      Florists: [],
      "Food and drink": [
        "ALL",
        "Asian",
        "Bars and pubs",
        "Breakfast and brunch",
        "Cafes",
        "Casual dining",
        "Chocolate cafes",
        "Desserts",
        "Dietary requirements",
        "Fast food",
        "Fine dining",
        "Greek",
        "Grill houses",
        "Halal",
        "Healthy options",
        "Italian",
        "Juice bars",
        "Kid-friendly",
        "Lebanese",
        "Mexican and Latin American",
        "Middle Eastern",
        "Modern Australian",
        "Sandwiches and salads",
        "Takeaway",
      ],
      "Foreign currency exchange": [],
      "Fresh food and groceries": [
        "ALL",
        "Bakeries",
        "Butchers",
        "Confectionery",
        "Delicatessens",
        "Fresh produce",
        "Liquor",
        "Patisseries",
        "Poultry",
        "Seafood",
        "Specialty foods",
        "Supermarkets",
      ],
      "Health and fitness": [
        "ALL",
        "Chemists",
        "Dentists",
        "Gyms and fitness studios",
        "Health insurers",
        "Medical centres",
        "Medicare",
        "Optometrists",
        "Specialty health providers",
      ],
      Home: [
        "ALL",
        "Bath and home fragrances",
        "Bedding",
        "Furniture",
        "Gifts",
        "Hardware",
        "Home appliances",
        "Home decor",
        "Kitchen",
        "Pets",
        "Photography and art",
        "Picture frames",
      ],
      "Luggage and travel accessories": [
        "ALL",
        "Backpacks and gym duffle bags",
        "Laptop cases and sleeves",
        "Small leather goods",
        "Suitcases and travel accessories",
        "Work and laptop bags",
      ],
      "Luxury and premium": [
        "ALL",
        "Australian designer",
        "International designer",
        "Luxury",
        "Premium brands",
      ],
      "Pawn brokers": [],
      "Phone repairs": [],
      "Photographic services": [],
      "Post office": [],
      "Power, gas and communication services": [],
      "Professional services": [],
      "Real estate agents": [],
      "Shoe repair and key cutting": [],
      "Sporting goods": [
        "ALL",
        "Activewear",
        "Fitness and gym equipment",
        "Outdoors and camping",
        "Tech and wearables",
      ],
      Tobacconists: [],
      "Toys and hobbies": [
        "ALL",
        "Arts and crafts",
        "Games",
        "Hobbies",
        "Toys",
      ],
      "Travel agents": [],
    };
    const countries = [
      { value: "AU", text: "Australia" },
      { value: "NZ", text: "New Zealand" },
      { value: "US", text: "United States" },
      { value: "GB", text: "United Kingdom" },
      { value: "CA", text: "Canada" },
      { value: "PH", text: "Philippines" },
    ];

    async function getPlaceDetails(placeId) {
      return new Promise((resolve, reject) => {
        if (!window.rtrlApp.state.googleMapsGeocoder) return reject();
        window.rtrlApp.state.googleMapsGeocoder.geocode(
          { placeId },
          (results, status) => {
            if (status === google.maps.GeocoderStatus.OK && results[0])
              resolve(results[0]);
            else reject();
          }
        );
      });
    }

    window.rtrlApp.handleLocationSelection = async (item) => {
      try {
        const details = await getPlaceDetails(item.place_id);
        const countryName =
          (
            details.address_components.find((c) =>
              c.types.includes("country")
            ) || {}
          ).long_name || "";
        if (countryName) elements.countryInput.value = countryName;
        elements.locationInput.value = item.description;
      } catch (error) {
        elements.locationInput.value = item.description.split(",")[0];
      }
    };

    window.rtrlApp.handleAnchorPointSelection = async (item) => {
      try {
        const details = await getPlaceDetails(item.place_id);
        const { lat, lng } = details.geometry.location;
        const newCenter = L.latLng(lat(), lng());
        window.rtrlApp.state.selectedAnchorPoint = {
          center: newCenter,
          name: item.description,
        };
        elements.anchorPointInput.value = item.description;
        document.getElementById("anchorPointSuggestions").style.display =
          "none";
        window.rtrlApp.map.setView(newCenter, 11);
        window.rtrlApp.drawSearchCircle(newCenter);
      } catch (error) {}
    };

    window.rtrlApp.handlePostalCodeSelection = async (item) => {
      try {
        const details = await getPlaceDetails(item.place_id);
        const pc = details.address_components.find((c) =>
          c.types.includes("postal_code")
        );
        if (pc) {
          await window.rtrlApp.validateAndAddTag(pc.long_name);
          elements.postalCodeInput.value = "";
        }
      } catch (error) {}
    };

    window.rtrlApp.validateAndAddTag = async (postcode) => {
      const v = postcode.trim();
      if (!v || isNaN(v) || window.rtrlApp.postalCodes.includes(v)) {
        elements.postalCodeInput.value = "";
        return;
      }
      const iso = countries.find(
        (c) =>
          c.text.toLowerCase() === elements.countryInput.value.toLowerCase()
      )?.value;
      if (!iso || !window.rtrlApp.state.googleMapsGeocoder) return;
      window.rtrlApp.state.googleMapsGeocoder.geocode(
        { componentRestrictions: { country: iso, postalCode: v } },
        (res, status) => {
          if (status === google.maps.GeocoderStatus.OK && res[0]) {
            const pcComp = res[0].address_components.find((c) =>
              c.types.includes("postal_code")
            );
            if (pcComp && pcComp.long_name === v) {
              const sub = res[0].address_components.find((c) =>
                c.types.includes("locality")
              );
              window.rtrlApp.postalCodes.push(v);
              const tagEl = document.createElement("span");
              tagEl.className = "tag";
              tagEl.innerHTML = `<span>${sub ? sub.long_name + " " : ""}${v}</span> <span class="tag-close-btn" data-value="${v}">&times;</span>`;
              elements.postalCodeContainer.insertBefore(
                tagEl,
                elements.postalCodeInput
              );
              elements.postalCodeInput.value = "";
            }
          }
        }
      );
    };

    window.rtrlApp.setLocationInputsState = (d) => {
      elements.locationInput.disabled = d;
      elements.postalCodeInput.disabled = d;
      if (d) {
        elements.locationInput.value = "";
        window.rtrlApp.postalCodes.length = 0;
        elements.postalCodeContainer
          .querySelectorAll(".tag")
          .forEach((tag) => tag.remove());
      }
    };

    window.rtrlApp.setRadiusInputsState = (d) => {
      elements.anchorPointInput.disabled = d;
      elements.radiusSlider.disabled = d;
      if (d) {
        elements.anchorPointInput.value = "";
        window.rtrlApp.state.selectedAnchorPoint = null;
        if (window.rtrlApp.searchCircle) {
          window.rtrlApp.map.removeLayer(window.rtrlApp.searchCircle);
          window.rtrlApp.searchCircle = null;
        }
      }
    };

    window.rtrlApp.drawSearchCircle = (c) => {
      const r = parseInt(elements.radiusSlider.value, 10) * 1000;
      if (window.rtrlApp.searchCircle) {
        window.rtrlApp.searchCircle.setLatLng(c);
        window.rtrlApp.searchCircle.setRadius(r);
      } else {
        window.rtrlApp.searchCircle = L.circle(c, {
          radius: r,
          color: "#20c997",
          fillColor: "#20c997",
          fillOpacity: 0.2,
        }).addTo(window.rtrlApp.map);
      }
      window.rtrlApp.map.fitBounds(window.rtrlApp.searchCircle.getBounds());
    };

    window.rtrlApp.initializeMapServices = () => {
      if (window.google && google.maps && google.maps.places) {
        window.rtrlApp.state.googleMapsService =
          new google.maps.places.AutocompleteService();
        window.rtrlApp.state.googleMapsGeocoder = new google.maps.Geocoder();
      }
    };

    window.rtrlApp.fetchPlaceSuggestions = (el, sel, t, onSelect) => {
      if (!window.rtrlApp.state.googleMapsService || el.value.trim().length < 2)
        return (sel.style.display = "none");
      const iso = countries.find(
        (c) =>
          c.text.toLowerCase() === elements.countryInput.value.toLowerCase()
      )?.value;
      const req = { input: el.value, types: t };
      if (iso) req.componentRestrictions = { country: iso };
      window.rtrlApp.state.googleMapsService.getPlacePredictions(
        req,
        (p, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && p)
            renderSuggestions(
              el,
              sel,
              p.map((x) => ({
                description: x.description,
                place_id: x.place_id,
              })),
              "description",
              "place_id",
              onSelect
            );
          else sel.style.display = "none";
        }
      );
    };

    window.rtrlApp.startResearch = () => {
      if (!currentUserSession) return;
      
      const ns = elements.businessNamesInput.value
        .trim()
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean);
      const ss = Array.from(
        elements.subCategoryCheckboxContainer.querySelectorAll("input:checked")
      )
        .map((c) => c.value)
        .filter((v) => v !== "select_all");

      const localToday = new Date();
      const localYear = localToday.getFullYear();
      const localMonth = String(localToday.getMonth() + 1).padStart(2, "0");
      const localDay = String(localToday.getDate()).padStart(2, "0");
      const clientLocalDateParam = `${localYear}-${localMonth}-${localDay}`;

      const p = {
        country: elements.countryInput.value,
        businessNames: ns,
        userEmail: elements.userEmailInput.value.trim(),
        exclusionList: window.rtrlApp.exclusionFeature.getExclusionList(),
        useAiEnrichment: elements.useAiToggle.checked,
      };
      if (window.rtrlApp.state.selectedAnchorPoint) {
        const { lat, lng } = window.rtrlApp.state.selectedAnchorPoint.center;
        p.anchorPoint = `${lat},${lng}`;
        p.radiusKm = parseInt(elements.radiusSlider.value, 10);
      } else {
        p.location = elements.locationInput.value.trim();
        p.postalCode = window.rtrlApp.postalCodes;
      }
      if (ns.length > 0) p.count = -1;
      else if (window.rtrlApp.customKeywords.length > 0)
        p.categoriesToLoop = window.rtrlApp.customKeywords;
      else {
        let b = ss.length > 0 ? ss : [elements.primaryCategorySelect.value];
        p.categoriesToLoop = elements.categoryModifierInput.value.trim()
          ? b.map(
              (c) => `"${elements.categoryModifierInput.value.trim()}" ${c}`
            )
          : b;
      }
      if (ns.length === 0)
        p.count =
          elements.findAllBusinessesCheckbox.checked ||
          !elements.countInput.value.trim()
            ? -1
            : parseInt(elements.countInput.value, 10);
      const areaKey = window.rtrlApp.state.selectedAnchorPoint
        ? elements.anchorPointInput.value.split(",")[0]
        : window.rtrlApp.postalCodes.length > 0
        ? window.rtrlApp.postalCodes.join("_")
        : elements.locationInput.value.split(",")[0];
      p.searchParamsForEmail = {
        primaryCategory: elements.primaryCategorySelect.value,
        subCategory: ss.length > 1 ? "multiple_subcategories" : ss[0] || "",
        subCategoryList: ss,
        customCategory:
          window.rtrlApp.customKeywords.length > 0
            ? window.rtrlApp.customKeywords.join(", ")
            : elements.categoryModifierInput.value,
        area: areaKey,
        postcodes: window.rtrlApp.postalCodes,
        country: elements.countryInput.value,
      };
      
      socket.emit("start_scrape_job", {
        authToken: currentUserSession.access_token,
        clientLocalDate: clientLocalDateParam,
        ...p,
      });

      // UI Feedback to show it was added to queue, instead of locking the UI
      const originalText = elements.startButton.innerHTML;
      elements.startButton.innerHTML = '<i class="fas fa-check"></i> Added to Queue!';
      elements.startButton.style.backgroundColor = "#10b981";
      setTimeout(() => {
          elements.startButton.innerHTML = originalText;
          elements.startButton.style.backgroundColor = "";
      }, 2000);
    };

    function handleScrapeError() {
      document.getElementById("status-card").className =
        "status-card state-error";
    }

    function initializeApp() {
      window.rtrlApp.jobHistory.init(
        () => currentUserSession?.access_token,
        BACKEND_URL
      );
      window.rtrlApp.exclusionFeature.init(
        () => currentUserSession?.access_token
      );
      if (localStorage.getItem("rtrl_last_used_email"))
        elements.userEmailInput.value = localStorage.getItem(
          "rtrl_last_used_email"
        );
      populatePrimaryCategories(elements.primaryCategorySelect, categories, "");
      setupPostcodeListHandlers();
      setupEventListeners(
        elements,
        socket,
        categories,
        countries,
        window.rtrlApp.postalCodes,
        window.rtrlApp.customKeywords,
        window.rtrlApp.map,
        window.rtrlApp.searchCircle
      );
      loadGoogleMaps();
    }

    window.rtrlApp.map = L.map("map").setView([-33.8688, 151.2093], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
    }).addTo(window.rtrlApp.map);
    initializeApp();
  }

  initializeMainApp();

  window.rtrlApp.cloneJobIntoForm = (p) => {
    const el = {
      primaryCat: document.getElementById("primaryCategorySelect"),
      customCat: document.getElementById("customCategoryInput"),
      location: document.getElementById("locationInput"),
      country: document.getElementById("countryInput"),
      count: document.getElementById("count"),
      findAll: document.getElementById("findAllBusinesses"),
      names: document.getElementById("businessNamesInput"),
      anchor: document.getElementById("anchorPointInput"),
      radius: document.getElementById("radiusSlider"),
      aiToggle: document.getElementById("useAiToggle"),
    };

    el.location.value = "";
    el.anchor.value = "";
    el.names.value = "";
    window.rtrlApp.postalCodes.length = 0;
    window.rtrlApp.customKeywords.length = 0;
    window.rtrlApp.state.selectedAnchorPoint = null;
    document.querySelectorAll(".tag").forEach((t) => t.remove());

    if (window.rtrlApp.searchCircle) {
      window.rtrlApp.map.removeLayer(window.rtrlApp.searchCircle);
      window.rtrlApp.searchCircle = null;
    }

    if (el.aiToggle) el.aiToggle.checked = p.useAiEnrichment !== false;
    el.country.value = p.country || "Australia";

    if (p.count === -1) {
      el.findAll.checked = true;
      el.count.value = "";
      el.count.disabled = true;
    } else {
      el.findAll.checked = false;
      el.count.value = p.count || "";
      el.count.disabled = false;
    }

    if (p.businessNames && p.businessNames.length > 0) {
      el.names.value = p.businessNames.join("\n");
      document
        .getElementById("individualSearchContainer")
        .classList.remove("collapsed");
    } else {
      el.names.value = "";
      if (p.categoriesToLoop) {
        p.categoriesToLoop.forEach((kw) => {
          window.rtrlApp.customKeywords.push(kw);
          const t = document.createElement("span");
          t.className = "tag";
          t.innerHTML = `<span>${kw}</span> <span class="tag-close-btn" data-value="${kw}">&times;</span>`;
          document
            .getElementById("customKeywordContainer")
            .insertBefore(t, el.customCat);
        });
      }
    }

    if (p.radiusKm && p.anchorPoint) {
      el.radius.value = p.radiusKm;
      document.getElementById("radiusValue").textContent = `${p.radiusKm} km`;
      el.anchor.value = p.searchParamsForEmail?.area || "Selected Area";

      const co = p.anchorPoint.split(",");
      if (co.length === 2) {
        const nc = L.latLng(parseFloat(co[0]), parseFloat(co[1]));
        window.rtrlApp.state.selectedAnchorPoint = {
          center: nc,
          name: el.anchor.value,
        };

        document
          .getElementById("radiusSearchContainer")
          .classList.remove("collapsed");

        setTimeout(() => {
          window.rtrlApp.map.invalidateSize();
          window.rtrlApp.map.setView(nc, 11);
          window.rtrlApp.drawSearchCircle(nc);
        }, 150);
      }
    } else {
      el.location.value = p.location || "";
      if (p.postalCode) {
        p.postalCode.forEach((pc) => window.rtrlApp.validateAndAddTag(pc));
      }
      document
        .getElementById("locationSearchContainer")
        .classList.remove("collapsed");
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  };
});