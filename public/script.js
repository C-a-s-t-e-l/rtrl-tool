document.addEventListener("DOMContentLoaded", () => {
  const BACKEND_URL = "https://backend.rtrlprospector.space";
  const SUPABASE_URL = "https://qbktnernawpprarckvzx.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFia3RuZXJuYXdwcHJhcmNrdnp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1OTQ3NTgsImV4cCI6MjA3MzE3MDc1OH0.9asOynIZEOqc8f_mNTjWTNXIPK1ph6IQF6ADbYdFclM";

  const { createClient } = supabase;
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let currentUserSession = null;
  let currentJobId = null;
  let subscribedJobId = null;

  window.rtrlApp = {
    ...window.rtrlApp,
    state: {},
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
        console.error("Failed to fetch config:", error);
      }
    }

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
      bulkSearchContainer: document.getElementById("bulkSearchContainer"),
      locationSearchContainer: document.getElementById(
        "locationSearchContainer",
      ),
      radiusSearchContainer: document.getElementById("radiusSearchContainer"),
      anchorPointInput: document.getElementById("anchorPointInput"),
      anchorPointSuggestionsEl: document.getElementById(
        "anchorPointSuggestions",
      ),
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
      flipCardContainer: document.getElementById("flip-card"),
      toSignupBtn: document.getElementById("to-signup-btn"),
      toSigninBtn: document.getElementById("to-signin-btn"),
      emailInputAuth: document.getElementById("email-input"),
      passwordInputAuth: document.getElementById("password-input"),
      loginEmailBtn: document.getElementById("login-email-btn"),
      signupEmailInput: document.getElementById("signup-email-input"),
      signupPasswordInput: document.getElementById("signup-password-input"),
      signupEmailBtn: document.getElementById("signup-email-btn"),
    };

    if (elements.useAiToggle) {
      const savedAiState = localStorage.getItem("rtrl_use_ai_enrichment");
      if (savedAiState !== null)
        elements.useAiToggle.checked = savedAiState === "true";
      else elements.useAiToggle.checked = true;
      elements.useAiToggle.addEventListener("change", (e) =>
        localStorage.setItem("rtrl_use_ai_enrichment", e.target.checked),
      );
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
        socket.emit("subscribe_to_job", {
          jobId: savedJobId,
          authToken: currentUserSession.access_token,
        });
      }
    });

    socket.on("disconnect", () => {
      disconnectTimeout = setTimeout(() => {
        logMessage(elements.logEl, "Connection lost. Reconnecting...", "error");
        hasLoggedDisconnect = true;
      }, 15000);
    });

    socket.on("job_created", ({ jobId }) => {
      logMessage(elements.logEl, "Job created. Waiting in queue...", "info");
      currentJobId = jobId;
      localStorage.setItem("rtrl_active_job_id", jobId);
      updateDashboardUi("queued", { position: "..." });
      if (currentUserSession)
        localStorage.setItem(
          `rtrl_last_job_id_${currentUserSession.user.id}`,
          jobId,
        );
      if (window.rtrlApp.jobHistory)
        window.rtrlApp.jobHistory.fetchAndRenderJobs();
      socket.emit("subscribe_to_job", {
        jobId,
        authToken: currentUserSession.access_token,
      });
    });

    socket.on("queue_position", (data) => {
      if (
        !document
          .getElementById("status-card")
          .classList.contains("state-working")
      )
        updateDashboardUi("queued", data);
    });

    socket.on("job_state", (job) => {
      if (job.status === "completed" || job.status === "failed") {
        localStorage.removeItem("rtrl_active_job_id");
        currentJobId = null;
        setUiState(false, getUiElementsForStateChange());
        updateDashboardUi(job.status);
      } else {
        currentJobId = job.id;
        setUiState(true, getUiElementsForStateChange());
        updateDashboardUi(job.status);
      }
    });

    socket.on("job_log", (message) =>
      logMessage(elements.logEl, message, "info"),
    );
    socket.on("job_error", ({ error }) => {
      logMessage(elements.logEl, `Error: ${error}`, "error");
      handleScrapeError();
    });

    socket.on("job_update", (update) => {
      if (update.status) {
        if (window.rtrlApp.jobHistory)
          window.rtrlApp.jobHistory.fetchAndRenderJobs();
        if (
          update.id === currentJobId ||
          (!currentJobId && update.status === "running")
        ) {
          currentJobId = update.id;
          if (update.status === "running") updateDashboardUi("running");
          else if (
            update.status === "completed" ||
            update.status === "failed"
          ) {
            localStorage.removeItem("rtrl_active_job_id");
            setUiState(false, getUiElementsForStateChange());
            updateDashboardUi(update.status);
          }
        }
      }
    });

    socket.on("progress_update", (data) => {
      const {
        phase,
        added,
        target,
        discovered,
        processed,
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
        let sp =
          target === -1
            ? discovered > 0
              ? processed / discovered
              : 0
            : target > 0
              ? added / target
              : 0;
        visualPercent = 10 + Math.round((sp > 1 ? 1 : sp) * 60);
        updateStatusCardPhase("scraping");
      } else if (phase === "ai") {
        phaseText = "Phase 2/3: AI Enrichment";
        let ap = aiTarget > 0 ? aiProcessed / aiTarget : 0;
        visualPercent = 70 + Math.round((ap > 1 ? 1 : ap) * 25);
        updateStatusCardPhase("ai");
      } else if (phase === "completed") {
        visualPercent = 100;
        phaseText = "Phase 3/3: Complete";
        updateStatusCardPhase("complete");
      }

      document.getElementById("progress-fill").style.width =
        `${visualPercent}%`;
      document.getElementById("pct-label").textContent = `${visualPercent}%`;
      document.getElementById("phase-label").textContent = phaseText;
      document.getElementById("stat-found").textContent = discovered || 0;
      document.getElementById("stat-processed").textContent = added || 0;
      document.getElementById("stat-enriched").textContent = enriched || 0;
    });

    function updateDashboardUi(status, data = {}) {
      const h = document.getElementById("status-headline");
      const s = document.getElementById("status-subtext");
      const i = document.getElementById("status-icon");
      const c = document.getElementById("status-card");
      if (!h || !c) return;
      c.className = "status-card";
      if (status === "running") {
        c.classList.add("state-working", "phase-scraping");
        h.textContent = "Job Active";
        s.textContent = "Processing data...";
        if (i) i.className = "fas fa-circle-notch fa-spin";
      } else if (status === "queued") {
        h.textContent = "Job Queued";
        s.textContent = `Server is busy. You are #${data.position || "?"} in the waiting list.`;
        if (i) i.className = "fas fa-clock";
      } else if (status === "completed") {
        c.classList.add("phase-complete");
        h.textContent = "Job Completed";
        s.textContent = "Check your email for results.";
        if (i) i.className = "fas fa-check-circle";
        document.getElementById("progress-fill").style.width = "100%";
        document.getElementById("pct-label").textContent = "100%";
        document.getElementById("phase-label").textContent =
          "Phase 3/3: Complete";
      } else if (status === "failed") {
        c.classList.add("phase-error");
        h.textContent = "Job Failed";
        s.textContent = "Please check job history or try again.";
        if (i) i.className = "fas fa-times-circle";
      }
    }

    function updateStatusCardPhase(phase) {
      const c = document.getElementById("status-card");
      const i = document.getElementById("status-icon");
      const h = document.getElementById("status-headline");
      if (!c) return;
      c.classList.remove(
        "phase-scraping",
        "phase-ai",
        "phase-complete",
        "phase-error",
      );
      if (phase === "discovery") {
        c.classList.add("phase-scraping");
        if (i) i.className = "fas fa-map-marked-alt spin-slow";
        if (h) h.textContent = "Scanning Area...";
      } else if (phase === "scraping") {
        c.classList.add("phase-scraping");
        if (i) i.className = "fas fa-satellite-dish spin-slow";
        if (h) h.textContent = "Extracting Data...";
      } else if (phase === "ai") {
        c.classList.add("phase-ai");
        if (i) i.className = "fas fa-brain spin-slow";
        if (h) h.textContent = "AI Analysis Active...";
      } else if (phase === "complete") {
        c.classList.add("phase-complete");
        if (i) i.className = "fas fa-check-circle";
        if (h) h.textContent = "Job Completed";
      }
    }

    function setupPasswordToggle(tid, iid) {
      const tb = document.getElementById(tid);
      const inf = document.getElementById(iid);
      if (tb && inf)
        tb.addEventListener("click", () => {
          const t =
            inf.getAttribute("type") === "password" ? "text" : "password";
          inf.setAttribute("type", t);
          tb.classList.toggle("fa-eye");
          tb.classList.toggle("fa-eye-slash");
        });
    }
    setupPasswordToggle("toggle-login-password", "password-input");
    setupPasswordToggle("toggle-signup-password", "signup-password-input");

    document
      .getElementById("login-google")
      ?.addEventListener(
        "click",
        async () =>
          await supabaseClient.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: window.location.origin },
          }),
      );
    document
      .getElementById("login-microsoft")
      ?.addEventListener(
        "click",
        async () =>
          await supabaseClient.auth.signInWithOAuth({
            provider: "azure",
            options: { scopes: "email", redirectTo: window.location.origin },
          }),
      );
    document.getElementById("to-signup-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      elements.flipCardContainer.classList.add("flipped");
    });
    document.getElementById("to-signin-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      elements.flipCardContainer.classList.remove("flipped");
    });

    elements.loginEmailBtn?.addEventListener("click", async () => {
      const e = elements.emailInputAuth.value;
      const p = elements.passwordInputAuth.value;
      if (!e || !p) return alert("Enter credentials.");
      elements.loginEmailBtn.disabled = true;
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: e,
        password: p,
      });
      if (error) {
        alert(error.message);
        elements.loginEmailBtn.disabled = false;
      }
    });

    elements.signupEmailBtn?.addEventListener("click", async () => {
      const e = elements.signupEmailInput.value;
      const p = elements.signupPasswordInput.value;
      if (!e || !p) return alert("Enter credentials.");
      elements.signupEmailBtn.disabled = true;
      const { data, error } = await supabaseClient.auth.signUp({
        email: e,
        password: p,
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
        elements.startButton.disabled = false;
        if (!elements.userEmailInput.value.trim())
          elements.userEmailInput.value = session.user.email;
        await fetchPostcodeLists();
        const res = await fetch(`${BACKEND_URL}/api/exclusions`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok)
          window.rtrlApp.exclusionFeature.populateTags(
            (await res.json()).exclusionList,
          );
        const sj = localStorage.getItem(`rtrl_last_job_id_${session.user.id}`);
        if (sj && socket.connected)
          socket.emit("subscribe_to_job", {
            jobId: sj,
            authToken: session.access_token,
          });
        if (window.rtrlApp.jobHistory)
          window.rtrlApp.jobHistory.fetchAndRenderJobs();
      } else {
        elements.loginOverlay.style.display = "flex";
        elements.appContent.style.display = "none";
        elements.userMenu.style.display = "none";
        elements.startButton.disabled = true;
        window.rtrlApp.exclusionFeature.populateTags([]);
      }
    });

    let savedPostcodeLists = [];
    async function fetchPostcodeLists() {
      if (!currentUserSession) return;
      const res = await fetch(`${BACKEND_URL}/api/postcode-lists`, {
        headers: { Authorization: `Bearer ${currentUserSession.access_token}` },
      });
      if (res.ok) {
        savedPostcodeLists = await res.json();
        elements.postcodeListSelect.innerHTML =
          '<option value="">Load a saved list...</option>';
        savedPostcodeLists.forEach((l) => {
          const o = document.createElement("option");
          o.value = l.id;
          o.textContent = l.list_name;
          elements.postcodeListSelect.appendChild(o);
        });
      }
    }

    elements.postcodeListSelect.addEventListener("change", () => {
      const sl = savedPostcodeLists.find(
        (l) => l.id == elements.postcodeListSelect.value,
      );
      window.rtrlApp.postalCodes.length = 0;
      elements.postalCodeContainer
        .querySelectorAll(".tag")
        .forEach((t) => t.remove());
      if (sl) {
        sl.postcodes.forEach((pc) => window.rtrlApp.validateAndAddTag(pc));
        elements.deletePostcodeListButton.style.display = "inline-flex";
      } else elements.deletePostcodeListButton.style.display = "none";
    });
    new MutationObserver(
      () =>
        (elements.savePostcodeListButton.disabled =
          !elements.postalCodeContainer.querySelector(".tag")),
    ).observe(elements.postalCodeContainer, { childList: true });
    elements.savePostcodeListButton.addEventListener("click", async () => {
      if (!currentUserSession || !window.rtrlApp.postalCodes.length) return;
      const n = prompt("Name this list:", "");
      if (!n) return;
      const res = await fetch(`${BACKEND_URL}/api/postcode-lists`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentUserSession.access_token}`,
        },
        body: JSON.stringify({
          list_name: n.trim(),
          postcodes: window.rtrlApp.postalCodes,
        }),
      });
      if (res.status === 201) await fetchPostcodeLists();
    });
    elements.deletePostcodeListButton.addEventListener("click", async () => {
      if (
        elements.postcodeListSelect.value &&
        currentUserSession &&
        confirm("Delete?")
      ) {
        const res = await fetch(
          `${BACKEND_URL}/api/postcode-lists/${elements.postcodeListSelect.value}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${currentUserSession.access_token}`,
            },
          },
        );
        if (res.ok) await fetchPostcodeLists();
      }
    });

    window.rtrlApp.state = {
      selectedAnchorPoint: null,
      googleMapsService: null,
      googleMapsGeocoder: null,
    };
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

    window.rtrlApp.handleLocationSelection = async (item) => {
      const res = await new Promise((r) =>
        window.rtrlApp.state.googleMapsGeocoder.geocode(
          { placeId: item.place_id },
          (results) => r(results[0]),
        ),
      );
      elements.countryInput.value =
        res.address_components.find((c) => c.types.includes("country"))
          ?.long_name || "";
      elements.locationInput.value = item.description;
    };
    window.rtrlApp.handleAnchorPointSelection = async (item) => {
      const res = await new Promise((r) =>
        window.rtrlApp.state.googleMapsGeocoder.geocode(
          { placeId: item.place_id },
          (results) => r(results[0]),
        ),
      );
      const loc = res.geometry.location;
      const c = L.latLng(loc.lat(), loc.lng());
      window.rtrlApp.state.selectedAnchorPoint = {
        center: c,
        name: item.description,
      };
      elements.anchorPointInput.value = item.description;
      document.getElementById("anchorPointSuggestions").style.display = "none";
      window.rtrlApp.map.setView(c, 11);
      window.rtrlApp.drawSearchCircle(c);
    };
    window.rtrlApp.handlePostalCodeSelection = async (item) => {
      const res = await new Promise((r) =>
        window.rtrlApp.state.googleMapsGeocoder.geocode(
          { placeId: item.place_id },
          (results) => r(results[0]),
        ),
      );
      const pc = res.address_components.find((c) =>
        c.types.includes("postal_code"),
      );
      if (pc) {
        await window.rtrlApp.validateAndAddTag(pc.long_name);
        elements.postalCodeInput.value = "";
      }
    };

    window.rtrlApp.validateAndAddTag = async (pc) => {
      const v = pc.trim();
      if (!v || isNaN(v) || window.rtrlApp.postalCodes.includes(v)) return;
      const iso = countries.find(
        (c) =>
          c.text.toLowerCase() === elements.countryInput.value.toLowerCase(),
      )?.value;
      window.rtrlApp.state.googleMapsGeocoder.geocode(
        { componentRestrictions: { country: iso || "AU", postalCode: v } },
        (res, status) => {
          if (status === "OK" && res[0]) {
            const pcComp = res[0].address_components.find((c) =>
              c.types.includes("postal_code"),
            );
            if (pcComp && pcComp.long_name === v) {
              const sub = res[0].address_components.find((c) =>
                c.types.includes("locality"),
              );
              window.rtrlApp.postalCodes.push(v);
              const tag = document.createElement("span");
              tag.className = "tag";
              tag.innerHTML = `<span>${sub ? sub.long_name + " " : ""}${v}</span> <span class="tag-close-btn" data-value="${v}">&times;</span>`;
              elements.postalCodeContainer.insertBefore(
                tag,
                elements.postalCodeInput,
              );
              elements.postalCodeInput.value = "";
            }
          }
        },
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
          .forEach((t) => t.remove());
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
      } else
        window.rtrlApp.searchCircle = L.circle(c, {
          radius: r,
          color: "#20c997",
          fillColor: "#20c997",
          fillOpacity: 0.2,
        }).addTo(window.rtrlApp.map);
      window.rtrlApp.map.fitBounds(window.rtrlApp.searchCircle.getBounds());
    };
    window.rtrlApp.initializeMapServices = () => {
      window.rtrlApp.state.googleMapsService =
        new google.maps.places.AutocompleteService();
      window.rtrlApp.state.googleMapsGeocoder = new google.maps.Geocoder();
    };
    window.rtrlApp.fetchPlaceSuggestions = (el, sel, t, on) => {
      if (!window.rtrlApp.state.googleMapsService || el.value.trim().length < 2)
        return (sel.style.display = "none");
      const iso = countries.find(
        (c) =>
          c.text.toLowerCase() === elements.countryInput.value.toLowerCase(),
      )?.value;
      const req = { input: el.value, types: t };
      if (iso) req.componentRestrictions = { country: iso };
      window.rtrlApp.state.googleMapsService.getPlacePredictions(req, (p) => {
        if (p)
          renderSuggestions(
            el,
            sel,
            p.map((x) => ({
              description: x.description,
              place_id: x.place_id,
            })),
            "description",
            "place_id",
            on,
          );
        else sel.style.display = "none";
      });
    };

    window.rtrlApp.startResearch = () => {
      if (!currentUserSession) return;
      setUiState(true, getUiElementsForStateChange());
      document.getElementById("status-card").className =
        "status-card state-working phase-scraping";
      const ns = elements.businessNamesInput.value
        .trim()
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean);
      const ss = Array.from(
        elements.subCategoryCheckboxContainer.querySelectorAll("input:checked"),
      )
        .map((c) => c.value)
        .filter((v) => v !== "select_all");
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
              (c) => `"${elements.categoryModifierInput.value.trim()}" ${c}`,
            )
          : b;
      }
      if (ns.length === 0)
        p.count =
          elements.findAllBusinessesCheckbox.checked ||
          !elements.countInput.value.trim()
            ? -1
            : parseInt(elements.countInput.value, 10);
      const ak = window.rtrlApp.state.selectedAnchorPoint
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
        area: ak,
        postcodes: window.rtrlApp.postalCodes,
        country: elements.countryInput.value,
      };
      socket.emit("start_scrape_job", {
        authToken: currentUserSession.access_token,
        ...p,
      });
    };

    function handleScrapeError() {
      setUiState(false, getUiElementsForStateChange());
      document.getElementById("status-card").className =
        "status-card state-error";
    }
    function getUiElementsForStateChange() {
      return {
        startButton: elements.startButton,
        primaryCategorySelect: elements.primaryCategorySelect,
        subCategoryCheckboxContainer: elements.subCategoryCheckboxContainer,
        customCategoryInput: elements.customCategoryInput,
        locationInput: elements.locationInput,
        postalCodeInput: elements.postalCodeInput,
        countryInput: elements.countryInput,
        countInput: elements.countInput,
        findAllBusinessesCheckbox: elements.findAllBusinessesCheckbox,
        businessNamesInput: elements.businessNamesInput,
        userEmailInput: elements.userEmailInput,
        anchorPointInput: elements.anchorPointInput,
        radiusSlider: elements.radiusSlider,
      };
    }

    function initializeApp() {
      window.rtrlApp.jobHistory.init(
        () => currentUserSession?.access_token,
        BACKEND_URL,
      );
      window.rtrlApp.exclusionFeature.init(
        () => currentUserSession?.access_token,
      );
      if (localStorage.getItem("rtrl_last_used_email"))
        elements.userEmailInput.value = localStorage.getItem(
          "rtrl_last_used_email",
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
        window.rtrlApp.searchCircle,
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
    const ui = {
      h: document.getElementById("status-headline"),
      s: document.getElementById("status-subtext"),
      i: document.getElementById("status-icon"),
      c: document.getElementById("status-card"),
      f: document.getElementById("progress-fill"),
      p: document.getElementById("pct-label"),
      ph: document.getElementById("phase-label"),
      fnd: document.getElementById("stat-found"),
      prc: document.getElementById("stat-processed"),
      enr: document.getElementById("stat-enriched"),
    };
    if (ui.c) ui.c.className = "status-card";
    if (ui.h) ui.h.textContent = "Search Parameters Loaded";
    if (ui.s) ui.s.textContent = "Sidebar updated from history.";
    if (ui.i) ui.i.className = "fas fa-file-import";
    if (ui.f) ui.f.style.width = "0%";
    if (ui.p) ui.p.textContent = "0%";
    if (ui.ph) ui.ph.textContent = "Phase 0/3: Ready";
    if (ui.fnd) ui.fnd.textContent = "0";
    if (ui.prc) ui.prc.textContent = "0";
    if (ui.enr) ui.enr.textContent = "0";
    window.rtrlApp.postalCodes.length = 0;
    window.rtrlApp.customKeywords.length = 0;
    document.querySelectorAll(".tag").forEach((t) => t.remove());
    if (el.aiToggle) el.aiToggle.checked = p.useAiEnrichment !== false;
    el.country.value = p.country || "Australia";
    if (p.count === -1) {
      el.findAll.checked = true;
      el.count.value = "";
      el.count.disabled = true;
    } else {
      el.findAll.checked = false;
      el.count.value = p.count;
      el.count.disabled = false;
    }
    if (p.businessNames?.length > 0) {
      el.names.value = p.businessNames.join("\n");
      document
        .getElementById("individualSearchContainer")
        .classList.remove("collapsed");
    } else {
      el.names.value = "";
      p.categoriesToLoop?.forEach((kw) => {
        window.rtrlApp.customKeywords.push(kw);
        const t = document.createElement("span");
        t.className = "tag";
        t.innerHTML = `<span>${kw}</span> <span class="tag-close-btn" data-value="${kw}">&times;</span>`;
        document
          .getElementById("customKeywordContainer")
          .insertBefore(t, el.customCat);
      });
    }
    if (p.radiusKm && p.anchorPoint) {
      el.radius.value = p.radiusKm;
      document.getElementById("radiusValue").textContent = `${p.radiusKm} km`;
      el.anchor.value = p.searchParamsForEmail?.area || "Selected Area";
      const co = p.anchorPoint.split(",");
      if (co.length === 2) {
        const lat = parseFloat(co[0]);
        const lng = parseFloat(co[1]);
        const nc = L.latLng(lat, lng);
        window.rtrlApp.state.selectedAnchorPoint = {
          center: nc,
          name: p.searchParamsForEmail?.area || "Selected Area",
        };
        document
          .getElementById("radiusSearchContainer")
          .classList.remove("collapsed");
        setTimeout(() => {
          window.rtrlApp.map.invalidateSize();
          window.rtrlApp.map.setView(nc, 11);
          window.rtrlApp.drawSearchCircle(nc);
        }, 100);
      }
    } else {
      el.location.value = p.location || "";
      p.postalCode?.forEach((x) => window.rtrlApp.validateAndAddTag(x));
      document
        .getElementById("locationSearchContainer")
        .classList.remove("collapsed");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
});
