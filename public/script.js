document.addEventListener('DOMContentLoaded', () => {

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
      } else {
        console.error("Google Maps API key not received from server.");
      }
    } catch (error) {
      console.error("Failed to fetch config from server:", error);
    }
  }

  const elements = {
    startButton: document.getElementById("startButton"),
    primaryCategorySelect: document.getElementById("primaryCategorySelect"),
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
    bulkSearchContainer: document.getElementById("bulkSearchContainer"),
    locationSearchContainer: document.getElementById("locationSearchContainer"),
    radiusSearchContainer: document.getElementById("radiusSearchContainer"),
    anchorPointInput: document.getElementById("anchorPointInput"),
    anchorPointSuggestionsEl: document.getElementById("anchorPointSuggestions"),
    radiusSlider: document.getElementById("radiusSlider"),
    radiusValue: document.getElementById("radiusValue"),
    progressBar: document.getElementById("progressBar"),
    logEl: document.getElementById("log"),
    researchStatusIcon: document.getElementById("researchStatusIcon"),
    progressPercentage: document.getElementById("progressPercentage"),
    postcodeListSelect: document.getElementById("postcodeListSelect"),
    savePostcodeListButton: document.getElementById("savePostcodeListButton"),
    deletePostcodeListButton: document.getElementById("deletePostcodeListButton"),
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
    authTitle: document.getElementById("auth-title"),
    authTogglePrompt: document.getElementById("auth-toggle-prompt"),
    authModeToggle: document.getElementById("auth-mode-toggle"),
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
  
  const socket = io(BACKEND_URL, {
    extraHeaders: { "ngrok-skip-browser-warning": "true" },
    transports: ["websocket", "polling"],
    timeout: 70000,
  });

  socket.on("connect", () => {
    logMessage(
      elements.logEl,
      "Successfully connected to the server. Ready.",
      "success"
    );

    if (currentUserSession) {
      socket.emit("authenticate_socket", currentUserSession.access_token);
    }

    if (subscribedJobId && currentUserSession) {
      logMessage(
        elements.logEl,
        `Re-subscribing to active job: ${subscribedJobId}...`,
        "info"
      );
      socket.emit("subscribe_to_job", {
        jobId: subscribedJobId,
        authToken: currentUserSession.access_token,
      });
    }
  });

  socket.on("disconnect", (reason) => {
    logMessage(
      elements.logEl,
      "Connection to server lost. Attempting to reconnect...",
      "error"
    );
    console.error("Socket disconnected due to:", reason);
  });

    function setupPasswordToggle(toggleId, inputId) {
    const toggleBtn = document.getElementById(toggleId);
    const inputField = document.getElementById(inputId);

    if (toggleBtn && inputField) {
      toggleBtn.addEventListener("click", () => {
        const type = inputField.getAttribute("type") === "password" ? "text" : "password";
        inputField.setAttribute("type", type);

        toggleBtn.classList.toggle("fa-eye");
        toggleBtn.classList.toggle("fa-eye-slash");
      });
    }
  }

  setupPasswordToggle("toggle-login-password", "password-input");
  setupPasswordToggle("toggle-signup-password", "signup-password-input");

  if (elements.loginGoogleBtn) {
    elements.loginGoogleBtn.addEventListener("click", async () => {
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin }
      });
      if (error) alert("Login Error: " + error.message);
    });
  }

  if (elements.loginMicrosoftBtn) {
    elements.loginMicrosoftBtn.addEventListener("click", async () => {
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: "azure",
        options: {
          scopes: 'email',
          redirectTo: window.location.origin
        }
      });
      if (error) alert("Login Error: " + error.message);
    });
  }

  if (elements.toSignupBtn) {
    elements.toSignupBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (elements.flipCardContainer) elements.flipCardContainer.classList.add("flipped");
    });
  }

  if (elements.toSigninBtn) {
    elements.toSigninBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (elements.flipCardContainer) elements.flipCardContainer.classList.remove("flipped");
    });
  }

  if (elements.loginEmailBtn) {
    elements.loginEmailBtn.addEventListener("click", async () => {
      const email = elements.emailInputAuth.value;
      const password = elements.passwordInputAuth.value;

      if (!email || !password) {
        alert("Please enter both email and password.");
        return;
      }

      const originalText = elements.loginEmailBtn.textContent;
      elements.loginEmailBtn.textContent = "Verifying...";
      elements.loginEmailBtn.disabled = true;

      const { error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (error) {
        alert("Login Failed: " + error.message);
        elements.loginEmailBtn.textContent = originalText;
        elements.loginEmailBtn.disabled = false;
      }
    });
  }

  if (elements.signupEmailBtn) {
    elements.signupEmailBtn.addEventListener("click", async () => {
      const email = elements.signupEmailInput.value;
      const password = elements.signupPasswordInput.value;

      if (!email || !password) {
        alert("Please enter both email and password.");
        return;
      }

      const originalText = elements.signupEmailBtn.textContent;
      elements.signupEmailBtn.textContent = "Creating...";
      elements.signupEmailBtn.disabled = true;

      const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
      });

      if (error) {
        alert("Signup Failed: " + error.message);
        elements.signupEmailBtn.textContent = originalText;
        elements.signupEmailBtn.disabled = false;
      } else if (!data.session) {
        alert("Account created! Please check your email to confirm your account.");
        if (elements.flipCardContainer) elements.flipCardContainer.classList.remove("flipped");
        elements.signupEmailBtn.textContent = originalText;
        elements.signupEmailBtn.disabled = false;
      }
    });
  }

  if (elements.logoutButton) {
    elements.logoutButton.addEventListener("click", async (e) => {
      e.preventDefault();
      await supabaseClient.auth.signOut();
      window.location.reload();
    });
  }

  socket.on("job_created", ({ jobId }) => {
    logMessage(
      elements.logEl,
      `Job successfully created with ID: ${jobId}. It is now in the queue.`,
      "success"
    );
    currentJobId = jobId;
    if (currentUserSession && currentUserSession.user) {
      const userId = currentUserSession.user.id;
      localStorage.setItem(`rtrl_last_job_id_${userId}`, jobId);
    }
    
    if (window.rtrlApp.jobHistory) {
      window.rtrlApp.jobHistory.fetchAndRenderJobs();
    }

    if (subscribedJobId !== currentJobId) {
      socket.emit("subscribe_to_job", {
        jobId,
        authToken: currentUserSession.access_token,
      });
      subscribedJobId = currentJobId;
    }
  });

  socket.on("job_log", (message) =>
    logMessage(elements.logEl, message, "info")
  );
  socket.on("job_error", ({ error }) => {
    logMessage(elements.logEl, `JOB ERROR: ${error}`, "error");
    setUiState(false, getUiElementsForStateChange());
  });

  socket.on("job_update", (update) => {
    if (update.status) {
      logMessage(
        elements.logEl,
        `Job status changed to: ${update.status}`,
        "info"
      );
      elements.researchStatusIcon.className =
        update.status === "running" ? "fas fa-spinner fa-spin" : "fas fa-tasks";
      
      if (window.rtrlApp.jobHistory) {
        window.rtrlApp.jobHistory.fetchAndRenderJobs();
      }

      if (update.status === "completed" || update.status === "failed") {
        currentJobId = null;
        setUiState(false, getUiElementsForStateChange());
        if (update.status === "completed")
          elements.researchStatusIcon.className = "fas fa-check-circle";
          elements.progressBar.style.width = "100%";
          elements.progressPercentage.textContent = "100% (Done)";
      }
    }
  });

  socket.on("business_found", (business) => {
  });

  socket.on("progress_update", ({ processed, discovered, added, target }) => {
    let percentage = 0;
    const isSearchAll = target === -1;
    if (isSearchAll) {
      if (discovered > 0) percentage = (processed / discovered) * 100;
    } else {
      if (target > 0) percentage = (added / target) * 100;
    }
    if (percentage > 100) percentage = 100;
    const roundedPercentage = Math.round(percentage);
    elements.progressBar.style.width = `${roundedPercentage}%`;
    elements.progressPercentage.textContent = `${roundedPercentage}%`;
  });


  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    currentUserSession = session;

    if (event === 'TOKEN_REFRESHED') {
    return; 
    }

    if (session) {
      if (socket.connected) {
        socket.emit("authenticate_socket", session.access_token);
      }
    
      if (elements.loginOverlay) elements.loginOverlay.style.display = "none";
      if (elements.appContent) elements.appContent.style.display = "block";
      if (elements.userMenu) elements.userMenu.style.display = "block";

      if (elements.userInfoSpan) {
        elements.userInfoSpan.textContent = session.user.user_metadata.full_name || "User";
      }
      if (elements.userEmailDisplay) {
        elements.userEmailDisplay.textContent = session.user.email;
      }

      elements.startButton.disabled = false;

      if (elements.userEmailInput.value.trim() === '') {
        elements.userEmailInput.value = session.user.email;
        localStorage.setItem('rtrl_last_used_email', session.user.email);
      }

      await fetchPostcodeLists();

      try {
        const response = await fetch(`${BACKEND_URL}/api/exclusions`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (response.ok) {
          const { exclusionList } = await response.json();
          window.rtrlApp.exclusionFeature.populateTags(exclusionList);
        }
      } catch (error) {
        console.error("Could not fetch exclusion list:", error);
      }
      
      if (window.rtrlApp.jobHistory) {
        window.rtrlApp.jobHistory.fetchAndRenderJobs();
      }

    } else {
      if (elements.loginOverlay) elements.loginOverlay.style.display = "flex";
      if (elements.appContent) elements.appContent.style.display = "none";
      if (elements.userMenu) elements.userMenu.style.display = "none";

      elements.startButton.disabled = true;

      if (elements.userEmailInput) elements.userEmailInput.value = '';
      localStorage.removeItem('rtrl_last_used_email');

      currentJobId = null;
      subscribedJobId = null;
      window.rtrlApp.exclusionFeature.populateTags([]);
      populatePostcodeListDropdown([]);
    }
  });

  let postalCodes = [];
  let customKeywords = [];
  let map, searchCircle;
  let savedPostcodeLists = [];

  function populatePostcodeListDropdown(lists) {
    savedPostcodeLists = lists;
    elements.postcodeListSelect.innerHTML =
      '<option value="">Load a saved list...</option>';
    lists.forEach((list) => {
      const option = document.createElement("option");
      option.value = list.id;
      option.textContent = list.list_name;
      elements.postcodeListSelect.appendChild(option);
    });
    elements.deletePostcodeListButton.style.display = "none";
  }

  async function fetchPostcodeLists() {
    if (!currentUserSession) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/postcode-lists`, {
        headers: { Authorization: `Bearer ${currentUserSession.access_token}` },
      });
      if (response.ok) {
        const lists = await response.json();
        populatePostcodeListDropdown(lists);
      } else {
        logMessage(
          elements.logEl,
          "Failed to load saved postcode lists.",
          "error"
        );
      }
    } catch (error) {
      console.error("Error fetching postcode lists:", error);
      logMessage(elements.logEl, "Error fetching postcode lists.", "error");
    }
  }

  async function saveCurrentPostcodeList() {
    if (!currentUserSession || postalCodes.length === 0) return;

    const listName = prompt("Please enter a name for this postcode list:", "");
    if (!listName || listName.trim() === "") {
      logMessage(
        elements.logEl,
        "Save cancelled: List name cannot be empty.",
        "info"
      );
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/postcode-lists`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentUserSession.access_token}`,
        },
        body: JSON.stringify({
          list_name: listName.trim(),
          postcodes: postalCodes,
        }),
      });

      if (response.status === 201) {
        logMessage(
          elements.logEl,
          `Successfully saved list "${listName.trim()}".`,
          "success"
        );
        await fetchPostcodeLists();
      } else {
        const { error } = await response.json();
        logMessage(elements.logEl, `Error saving list: ${error}`, "error");
      }
    } catch (error) {
      console.error("Failed to save postcode list:", error);
      logMessage(
        elements.logEl,
        "A network error occurred while saving the list.",
        "error"
      );
    }
  }

  async function deleteSelectedPostcodeList() {
    const selectedId = elements.postcodeListSelect.value;
    if (!selectedId || !currentUserSession) return;

    const selectedList = savedPostcodeLists.find((l) => l.id == selectedId);
    if (!selectedList) return;

    if (
      !confirm(
        `Are you sure you want to delete the list "${selectedList.list_name}"?`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/postcode-lists/${selectedId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${currentUserSession.access_token}`,
          },
        }
      );

      if (response.ok) {
        logMessage(
          elements.logEl,
          `Successfully deleted list "${selectedList.list_name}".`,
          "success"
        );
        await fetchPostcodeLists();
      } else {
        logMessage(elements.logEl, "Failed to delete the list.", "error");
      }
    } catch (error) {
      console.error("Failed to delete postcode list:", error);
      logMessage(
        elements.logEl,
        "A network error occurred while deleting the list.",
        "error"
      );
    }
  }

  function setupPostcodeListHandlers() {
    elements.postcodeListSelect.addEventListener("change", () => {
      const selectedId = elements.postcodeListSelect.value;
      const selectedList = savedPostcodeLists.find(
        (list) => list.id == selectedId
      );

      postalCodes.length = 0;
      elements.postalCodeContainer
        .querySelectorAll(".tag")
        .forEach((tag) => tag.remove());

      if (selectedList) {
        selectedList.postcodes.forEach((pc) =>
          window.rtrlApp.validateAndAddTag(pc)
        );
        elements.deletePostcodeListButton.style.display = "inline-flex";
      } else {
        elements.deletePostcodeListButton.style.display = "none";
      }
    });

    const observer = new MutationObserver(() => {
      const hasTags =
        elements.postalCodeContainer.querySelector(".tag") !== null;
      elements.savePostcodeListButton.disabled = !hasTags;
    });
    observer.observe(elements.postalCodeContainer, { childList: true });

    elements.savePostcodeListButton.addEventListener(
      "click",
      saveCurrentPostcodeList
    );
    elements.deletePostcodeListButton.addEventListener(
      "click",
      deleteSelectedPostcodeList
    );
  }

  window.rtrlApp.state = {
    selectedAnchorPoint: null,
    currentSearchParameters: {},
    googleMapsService: null,
    googleMapsGeocoder: null,
  };

  const categories = {
    "Select Category": [],
    "Alterations and tailoring": [],
    "Baby and nursery": [
      "ALL", "Baby and infant toys", "Baby bedding", "Nursery furniture",
      "Prams, strollers and carriers", "Tableware and feeding",
    ],
    Banks: [],
    "Beauty and wellness": [
      "ALL", "Bath and body", "Fragrance", "Hair and beauty", "Hair care",
      "Makeup", "Skincare", "Vitamins and supplements",
    ],
    "Books, stationery and gifts": [
      "ALL", "Book stores", "Cards and gift wrap", "Newsagencies",
      "Office supplies", "Stationery",
    ],
    "Car and auto": [],
    Childcare: [],
    "Clothing and accessories": [
      "ALL", "Babies' and toddlers'", "Footwear", "Jewellery and watches",
      "Kids' and junior", "Men's fashion", "Sunglasses", "Women's fashion",
    ],
    "Community services": [], "Department stores": [], "Designer and boutique": [],
    "Discount and variety": [], "Dry cleaning": [],
    "Electronics and technology": [
      "ALL", "Cameras", "Computers and tablets", "Gaming and consoles",
      "Mobile and accessories", "Navigation", "TV and audio",
    ],
    "Entertainment and activities": [
      "ALL", "Arcades and games", "Bowling", "Cinemas", "Kids activities",
      "Learning and education", "Music",
    ],
    Florists: [],
    "Food and drink": [
      "ALL", "Asian", "Bars and pubs", "Breakfast and brunch", "Cafes",
      "Casual dining", "Chocolate cafes", "Desserts", "Dietary requirements",
      "Fast food", "Fine dining", "Greek", "Grill houses", "Halal", "Healthy options",
      "Italian", "Juice bars", "Kid-friendly", "Lebanese", "Mexican and Latin American",
      "Middle Eastern", "Modern Australian", "Sandwiches and salads", "Takeaway",
    ],
    "Foreign currency exchange": [],
    "Fresh food and groceries": [
      "ALL", "Bakeries", "Butchers", "Confectionery", "Delicatessens",
      "Fresh produce", "Liquor", "Patisseries", "Poultry", "Seafood",
      "Specialty foods", "Supermarkets",
    ],
    "Health and fitness": [
      "ALL", "Chemists", "Dentists", "Gyms and fitness studios", "Health insurers",
      "Medical centres", "Medicare", "Optometrists", "Specialty health providers",
    ],
    Home: [
      "ALL", "Bath and home fragrances", "Bedding", "Furniture", "Gifts",
      "Hardware", "Home appliances", "Home decor", "Kitchen", "Pets",
      "Photography and art", "Picture frames",
    ],
    "Luggage and travel accessories": [
      "ALL", "Backpacks and gym duffle bags", "Laptop cases and sleeves",
      "Small leather goods", "Suitcases and travel accessories", "Work and laptop bags",
    ],
    "Luxury and premium": [
      "ALL", "Australian designer", "International designer", "Luxury", "Premium brands",
    ],
    "Pawn brokers": [], "Phone repairs": [], "Photographic services": [], "Post office": [],
    "Power, gas and communication services": [], "Professional services": [],
    "Real estate agents": [], "Shoe repair and key cutting": [],
    "Sporting goods": [
      "ALL", "Activewear", "Fitness and gym equipment", "Outdoors and camping", "Tech and wearables",
    ],
    Tobacconists: [],
    "Toys and hobbies": ["ALL", "Arts and crafts", "Games", "Hobbies", "Toys"],
    "Travel agents": [],
  };
  const countries = [
    { value: "AU", text: "Australia" }, { value: "NZ", text: "New Zealand" },
    { value: "US", text: "United States" }, { value: "GB", text: "United Kingdom" },
    { value: "CA", text: "Canada" }, { value: "DE", text: "Germany" },
    { value: "FR", text: "France" }, { value: "ES", text: "Spain" },
    { value: "IT", text: "Italy" }, { value: "JP", text: "Japan" },
    { value: "SG", text: "Singapore" }, { value: "HK", text: "Hong Kong" },
  ];

  async function getPlaceDetails(placeId) {
    return new Promise((resolve, reject) => {
      const geocoder = window.rtrlApp.state.googleMapsGeocoder;
      if (!geocoder)
        return reject(new Error("Geocoder service not initialized."));
      geocoder.geocode({ placeId }, (results, status) => {
        if (status === google.maps.GeocoderStatus.OK && results[0])
          resolve(results[0]);
        else reject(new Error(`Geocoder failed with status: ${status}`));
      });
    });
  }

  async function populateFieldsFromPlaceDetails(details) {
    const components = {};
    details.address_components.forEach((c) => {
      components[c.types[0]] = {
        long_name: c.long_name,
        short_name: c.short_name,
      };
    });
    const countryName = (components.country || {}).long_name || "";
    if (countryName) elements.countryInput.value = countryName;
  }

  window.rtrlApp.handleLocationSelection = async (item) => {
    try {
      const details = await getPlaceDetails(item.place_id);
      await populateFieldsFromPlaceDetails(details);
      elements.locationInput.value = item.description;
    } catch (error) {
      console.error("Could not get place details:", error);
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
      elements.anchorPointSuggestionsEl.style.display = "none";
      map.invalidateSize(); 
      map.setView(newCenter, 11);
      window.rtrlApp.drawSearchCircle(newCenter);
    } catch (error) {
      console.error("Could not get place details for anchor point:", error);
    }
  };

  window.rtrlApp.handlePostalCodeSelection = async (item) => {
    try {
      const details = await getPlaceDetails(item.place_id);
      await populateFieldsFromPlaceDetails(details);
      const postalCodeComponent = details.address_components.find((c) =>
        c.types.includes("postal_code")
      );
      if (postalCodeComponent) {
        await window.rtrlApp.validateAndAddTag(postalCodeComponent.long_name);
        elements.postalCodeInput.value = "";
      }
    } catch (error) {
      console.error("Could not get place details for postcode:", error);
    }
  };

  function initializeMap() {
    const defaultCenter =
      elements.countryInput.value.toLowerCase() === "australia"
        ? [-33.8688, 151.2093]
        : [34.0522, -118.2437];
    map = L.map("map").setView(defaultCenter, 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  }

  function initializeApp() {
    window.rtrlApp.jobHistory.init(
        () => currentUserSession?.access_token,
        BACKEND_URL
    );

    window.rtrlApp.exclusionFeature.init(
      () => currentUserSession?.access_token
    );


    const savedEmail = localStorage.getItem("rtrl_last_used_email");
    if (savedEmail) elements.userEmailInput.value = savedEmail;

    populatePrimaryCategories(elements.primaryCategorySelect, categories, "");
    initializeMap();
    setupPostcodeListHandlers();
    setupEventListeners(
      elements,
      socket,
      categories,
      countries,
      postalCodes,
      customKeywords,
      map,
      searchCircle
    );

    if (elements.findAllBusinessesCheckbox.checked) {
      elements.countInput.disabled = true;
      elements.countInput.value = "";
    }
    loadGoogleMaps();
  }

  window.rtrlApp.validateAndAddTag = async (postcode) => {
    const geocoder = window.rtrlApp.state.googleMapsGeocoder;
    const cleanedValue = postcode.trim();
    if (
      !cleanedValue ||
      isNaN(cleanedValue) ||
      postalCodes.includes(cleanedValue)
    ) {
      elements.postalCodeInput.value = "";
      return;
    }
    const countryName = elements.countryInput.value.trim();
    const countryIsoCode = countries.find(
      (c) => c.text.toLowerCase() === countryName.toLowerCase()
    )?.value;
    if (!countryIsoCode) {
      logMessage(
        elements.logEl,
        "Please select a country before adding a postcode.",
        "error"
      );
      triggerTagError();
      return;
    }
    if (!geocoder) {
      logMessage(
        elements.logEl,
        "Geocoder not ready. Please wait a moment.",
        "error"
      );
      triggerTagError();
      return;
    }
    try {
      const request = {
        componentRestrictions: {
          country: countryIsoCode,
          postalCode: cleanedValue,
        },
      };
      geocoder.geocode(request, (results, status) => {
        if (status === google.maps.GeocoderStatus.OK && results[0]) {
          const result = results[0];
          const components = result.address_components;
          const suburbComponent = components.find((c) =>
            c.types.includes("locality")
          );
          const postcodeComponent = components.find((c) =>
            c.types.includes("postal_code")
          );
          if (
            postcodeComponent &&
            postcodeComponent.long_name === cleanedValue
          ) {
            const suburbName = suburbComponent ? suburbComponent.long_name : "";
            addTagElement(cleanedValue, suburbName);
            elements.postalCodeInput.value = "";
          } else {
            triggerTagError();
          }
        } else {
          triggerTagError();
        }
      });
    } catch (error) {
      triggerTagError();
    }
  };

  function triggerTagError() {
    elements.postalCodeContainer.classList.add("error");
    setTimeout(() => {
      elements.postalCodeContainer.classList.remove("error");
    }, 500);
  }

  function addTagElement(postcode, suburb = "") {
    postalCodes.push(postcode);
    const tagText = suburb ? `${suburb} ${postcode}` : postcode;
    const tagEl = document.createElement("span");
    tagEl.className = "tag";
    tagEl.innerHTML = `<span>${tagText}</span> <span class="tag-close-btn" data-value="${postcode}">&times;</span>`;
    elements.postalCodeContainer.insertBefore(tagEl, elements.postalCodeInput);
  }

  window.rtrlApp.setLocationInputsState = (disabled) => {
    elements.locationInput.disabled = disabled;
    elements.postalCodeInput.disabled = disabled;
    elements.locationSearchContainer.style.opacity = disabled ? 0.5 : 1;
    if (disabled) {
      elements.locationInput.value = "";
      postalCodes = [];
      elements.postalCodeContainer
        .querySelectorAll(".tag")
        .forEach((tag) => tag.remove());
    }
  };

  window.rtrlApp.setRadiusInputsState = (disabled) => {
    elements.anchorPointInput.disabled = disabled;
    elements.radiusSlider.disabled = disabled;
    elements.radiusSearchContainer.style.opacity = disabled ? 0.5 : 1;
    if (disabled) {
      elements.anchorPointInput.value = "";
      window.rtrlApp.state.selectedAnchorPoint = null;
      if (searchCircle) {
        map.removeLayer(searchCircle);
        searchCircle = null;
      }
    }
  };

  window.rtrlApp.drawSearchCircle = (center) => {
    const radiusMeters = parseInt(elements.radiusSlider.value, 10) * 1000;
    if (searchCircle) {
      searchCircle.setLatLng(center);
      searchCircle.setRadius(radiusMeters);
    } else {
      searchCircle = L.circle(center, {
        radius: radiusMeters,
        color: "#20c997",
        fillColor: "#20c997",
        fillOpacity: 0.2,
      }).addTo(map);
    }
    map.fitBounds(searchCircle.getBounds());
  };

  window.rtrlApp.initializeMapServices = () => {
    if (window.google && google.maps && google.maps.places) {
      window.rtrlApp.state.googleMapsService =
        new google.maps.places.AutocompleteService();
      window.rtrlApp.state.googleMapsGeocoder = new google.maps.Geocoder();
      console.log("Google Places Autocomplete Service initialized.");
    } else {
      console.warn(
        "Google Maps Places API not fully loaded. Autocomplete may not function."
      );
    }
  };

  window.rtrlApp.fetchPlaceSuggestions = (
    inputEl,
    suggestionsEl,
    types,
    onSelect
  ) => {
    const service = window.rtrlApp.state.googleMapsService;
    if (!service || inputEl.value.trim().length < 2) {
      suggestionsEl.style.display = "none";
      return;
    }
    const countryIsoCode = countries.find(
      (c) => c.text.toLowerCase() === elements.countryInput.value.toLowerCase()
    )?.value;
    const request = { input: inputEl.value, types };
    if (countryIsoCode)
      request.componentRestrictions = { country: countryIsoCode };
    service.getPlacePredictions(request, (predictions, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
        const items = predictions.map((p) => ({
          description: p.description,
          place_id: p.place_id,
        }));
        renderSuggestions(
          inputEl,
          suggestionsEl,
          items,
          "description",
          "place_id",
          onSelect
        );
      } else {
        suggestionsEl.style.display = "none";
      }
    });
  };

window.rtrlApp.startResearch = () => {
    if (!currentUserSession) {
      logMessage(
        elements.logEl,
        "You must be logged in to start a job.",
        "error"
      );
      return;
    }

    setUiState(true, getUiElementsForStateChange());
    elements.logEl.textContent = "Submitting job to the queue...";
    elements.progressBar.style.width = "0%";
    elements.progressPercentage.textContent = "0%";

    const namesText = elements.businessNamesInput.value.trim();
    const businessNames = namesText
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);

    const primaryCategory = elements.primaryCategorySelect.value;
    const selectedSubCategories = Array.from(
      elements.subCategoryCheckboxContainer.querySelectorAll(
        'input[type="checkbox"]:checked'
      )
    )
      .map((cb) => cb.value)
      .filter((v) => v !== "select_all");

    const exclusionList = window.rtrlApp.exclusionFeature.getExclusionList();
    
    const modifierText = elements.categoryModifierInput ? elements.categoryModifierInput.value.trim() : "";

    const scrapeParams = {
      country: elements.countryInput.value,
      businessNames: businessNames.length > 0 ? businessNames : [],
      userEmail: elements.userEmailInput.value.trim(),
      exclusionList: exclusionList,
    };

    if (window.rtrlApp.state.selectedAnchorPoint) {
      const { lat, lng } = window.rtrlApp.state.selectedAnchorPoint.center;
      scrapeParams.anchorPoint = `${lat},${lng}`;
      scrapeParams.radiusKm = parseInt(elements.radiusSlider.value, 10);
    } else {
      scrapeParams.location = elements.locationInput.value.trim();
      scrapeParams.postalCode = postalCodes;
    }

    if (businessNames.length > 0) {
      scrapeParams.count = -1;
    } else if (customKeywords.length > 0) {
      scrapeParams.categoriesToLoop = customKeywords;
    } else {
      let baseCategories = [];

      if (selectedSubCategories.length > 0) {
        baseCategories = selectedSubCategories;
      } else if (primaryCategory) {
        baseCategories = [primaryCategory];
      }

      if (baseCategories.length > 0) {
        if (modifierText) {
           scrapeParams.categoriesToLoop = baseCategories.map(cat => `"${modifierText}" ${cat}`);
        } else {
           scrapeParams.categoriesToLoop = baseCategories;
        }
      } else {
        scrapeParams.categoriesToLoop = [];
      }
    }

    const hasLocation =
      scrapeParams.location ||
      (scrapeParams.postalCode && scrapeParams.postalCode.length > 0) ||
      (scrapeParams.anchorPoint && scrapeParams.radiusKm);
    
    const hasSearchTerm =
      scrapeParams.businessNames.length > 0 ||
      (scrapeParams.categoriesToLoop &&
        scrapeParams.categoriesToLoop.length > 0 &&
        scrapeParams.categoriesToLoop[0]);

    if (
      (!hasSearchTerm || !hasLocation || !scrapeParams.country) &&
      businessNames.length === 0
    ) {
      logMessage(
        elements.logEl,
        `Input Error: Please provide a category/keyword, a location type, and country.`,
        "error"
      );
      handleScrapeError({ error: "Invalid input" });
      return;
    }

    if (businessNames.length === 0) {
      const countValue = parseInt(elements.countInput.value.trim(), 10);
      const find_all =
        elements.findAllBusinessesCheckbox.checked ||
        !elements.countInput.value.trim() ||
        countValue <= 0;
      scrapeParams.count = find_all ? -1 : countValue;
    }

    let searchAreaKey;
    if (window.rtrlApp.state.selectedAnchorPoint)
      searchAreaKey = elements.anchorPointInput.value.trim().split(",")[0];
    else
      searchAreaKey =
        postalCodes.length > 0
          ? postalCodes.join("_")
          : elements.locationInput.value.trim().split(",")[0];

    scrapeParams.searchParamsForEmail = {
      primaryCategory: primaryCategory,
      subCategory:
        selectedSubCategories.length > 1
          ? "multiple_subcategories"
          : selectedSubCategories[0] || "",
      subCategoryList: selectedSubCategories,
      customCategory: customKeywords.length > 0 ? customKeywords.join(", ") : modifierText, 
      area: searchAreaKey,
      postcodes: postalCodes,
      country: elements.countryInput.value,
    };

    socket.emit("start_scrape_job", {
      authToken: currentUserSession.access_token,
      ...scrapeParams,
    });
  };

  function handleScrapeError(error) {
    logMessage(
      elements.logEl,
      `SCRAPE ERROR: ${error.error || "An unknown server error occurred."}`,
      "error"
    );
    setUiState(false, getUiElementsForStateChange());
    if (elements.researchStatusIcon)
      elements.researchStatusIcon.className = "fas fa-exclamation-triangle";
    elements.progressBar.style.width = "0%";
    elements.progressPercentage.textContent = "Error";
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

  initializeApp();
}

initializeMainApp();

}); 