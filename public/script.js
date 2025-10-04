const BACKEND_URL = "https://brieflessly-unlovely-constance.ngrok-free.app";

window.rtrlApp = {
    ...window.rtrlApp,
    state: {},
    timers: {},
    startResearch: () => {},
    applyFilterAndSort: () => {},
    getDisplayedData: () => [],
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
      const response = await fetch(`${BACKEND_URL}/api/config`, { headers: { "ngrok-skip-browser-warning": "true" } });
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

  const socket = io(BACKEND_URL, { extraHeaders: { "ngrok-skip-browser-warning": "true" } });

  const elements = {
    startButton: document.getElementById("startButton"),
    ratingFilter: document.getElementById("ratingFilter"),
    reviewCountFilter: document.getElementById("reviewCountFilter"),
    downloadFullExcelButton: document.getElementById("downloadFullExcelButton"),
    downloadNotifyreCSVButton: document.getElementById("downloadNotifyreCSVButton"),
    downloadContactsCSVButton: document.getElementById("downloadContactsCSVButton"), 
    primaryCategorySelect: document.getElementById("primaryCategorySelect"),
    subCategoryGroup: document.getElementById("subCategoryGroup"),
    subCategoryCheckboxContainer: document.getElementById("subCategoryCheckboxContainer"),
    customCategoryGroup: document.getElementById("customCategoryGroup"),
    customCategoryInput: document.getElementById("customCategoryInput"),
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
    locationSearchContainer: document.getElementById('locationSearchContainer'),
    radiusSearchContainer: document.getElementById('radiusSearchContainer'),
    anchorPointInput: document.getElementById('anchorPointInput'),
    anchorPointSuggestionsEl: document.getElementById('anchorPointSuggestions'),
    radiusSlider: document.getElementById('radiusSlider'),
    radiusValue: document.getElementById('radiusValue'),
    progressBar: document.getElementById("progressBar"),
    logEl: document.getElementById("log"),
    resultsTableBody: document.getElementById("resultsTableBody"),
    resultsTableHeader: document.getElementById("resultsTableHeader"),
    selectAllCheckbox: document.getElementById("selectAllCheckbox"),
    researchStatusIcon: document.getElementById("researchStatusIcon"),
    progressPercentage: document.getElementById("progressPercentage"),
    collectedDataCard: document.getElementById("collectedDataCard"),
    filterInput: document.getElementById("filterInput"),
  };

  let allCollectedData = [];
  let displayedData = [];
  let postalCodes = [];
  let map, searchCircle;
  
  window.rtrlApp.state = {
      selectedAnchorPoint: null,
      currentSearchParameters: {},
      currentSort: { key: "BusinessName", direction: "asc" },
      googleMapsService: null,
      googleMapsGeocoder: null,
  };

  window.rtrlApp.getDisplayedData = () => displayedData;
  
  const categories = {
    "Select Category": [], "Alterations and tailoring": [], "Baby and nursery": ["ALL", "Baby and infant toys", "Baby bedding", "Nursery furniture", "Prams, strollers and carriers", "Tableware and feeding"], "Banks": [], "Beauty and wellness": ["ALL", "Bath and body", "Fragrance", "Hair and beauty", "Hair care", "Makeup", "Skincare", "Vitamins and supplements"], "Books, stationery and gifts": ["ALL", "Book stores", "Cards and gift wrap", "Newsagencies", "Office supplies", "Stationery"], "Car and auto": [], "Childcare": [], "Clothing and accessories": ["ALL", "Babies' and toddlers'", "Footwear", "Jewellery and watches", "Kids' and junior", "Men's fashion", "Sunglasses", "Women's fashion"], "Community services": [], "Department stores": [], "Designer and boutique": [], "Discount and variety": [], "Dry cleaning": [], "Electronics and technology": ["ALL", "Cameras", "Computers and tablets", "Gaming and consoles", "Mobile and accessories", "Navigation", "TV and audio"], "Entertainment and activities": ["ALL", "Arcades and games", "Bowling", "Cinemas", "Kids activities", "Learning and education", "Music"], "Florists": [], "Food and drink": ["ALL", "Asian", "Bars and pubs", "Breakfast and brunch", "Cafes", "Casual dining", "Chocolate cafes", "Desserts", "Dietary requirements", "Fast food", "Fine dining", "Greek", "Grill houses", "Halal", "Healthy options", "Italian", "Juice bars", "Kid-friendly", "Lebanese", "Mexican and Latin American", "Middle Eastern", "Modern Australian", "Sandwiches and salads", "Takeaway"], "Foreign currency exchange": [], "Fresh food and groceries": ["ALL", "Bakeries", "Butchers", "Confectionery", "Delicatessens", "Fresh produce", "Liquor", "Patisseries", "Poultry", "Seafood", "Specialty foods", "Supermarkets"], "Health and fitness": ["ALL", "Chemists", "Dentists", "Gyms and fitness studios", "Health insurers", "Medical centres", "Medicare", "Optometrists", "Specialty health providers"], "Home": ["ALL", "Bath and home fragrances", "Bedding", "Furniture", "Gifts", "Hardware", "Home appliances", "Home decor", "Kitchen", "Pets", "Photography and art", "Picture frames"], "Luggage and travel accessories": ["ALL", "Backpacks and gym duffle bags", "Laptop cases and sleeves", "Small leather goods", "Suitcases and travel accessories", "Work and laptop bags"], "Luxury and premium": ["ALL", "Australian designer", "International designer", "Luxury", "Premium brands"], "Pawn brokers": [], "Phone repairs": [], "Photographic services": [], "Post office": [], "Power, gas and communication services": [], "Professional services": [], "Real estate agents": [], "Shoe repair and key cutting": [], "Sporting goods": ["ALL", "Activewear", "Fitness and gym equipment", "Outdoors and camping", "Tech and wearables"], "Tobacconists": [], "Toys and hobbies": ["ALL", "Arts and crafts", "Games", "Hobbies", "Toys"], "Travel agents": []
  };
  const countries = [
    { value: "AU", text: "Australia" }, { value: "NZ", text: "New Zealand" }, { value: "US", text: "United States" }, { value: "GB", text: "United Kingdom" }, { value: "CA", text: "Canada" }, { value: "DE", text: "Germany" }, { value: "FR", text: "France" }, { value: "ES", text: "Spain" }, { value: "IT", text: "Italy" }, { value: "JP", text: "Japan" }, { value: "SG", text: "Singapore" }, { value: "HK", text: "Hong Kong" },
  ];

  async function getPlaceDetails(placeId) {
    return new Promise((resolve, reject) => {
      const geocoder = window.rtrlApp.state.googleMapsGeocoder;
      if (!geocoder) return reject(new Error("Geocoder service not initialized."));
      geocoder.geocode({ placeId }, (results, status) => {
        if (status === google.maps.GeocoderStatus.OK && results[0]) {
          resolve(results[0]);
        } else {
          reject(new Error(`Geocoder failed with status: ${status}`));
        }
      });
    });
  }

  async function populateFieldsFromPlaceDetails(details) {
    const components = {};
    details.address_components.forEach((component) => {
      components[component.types[0]] = { long_name: component.long_name, short_name: component.short_name };
    });
    const countryName = (components.country || {}).long_name || "";
    if (countryName) {
      elements.countryInput.value = countryName;
    }
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
  }

  window.rtrlApp.handleAnchorPointSelection = async (item) => {
    try {
        const details = await getPlaceDetails(item.place_id);
        const { lat, lng } = details.geometry.location;
        const newCenter = L.latLng(lat(), lng());

        window.rtrlApp.state.selectedAnchorPoint = { center: newCenter, name: item.description };
        elements.anchorPointInput.value = item.description;
        elements.anchorPointSuggestionsEl.style.display = 'none';

        map.setView(newCenter, 11);
        window.rtrlApp.drawSearchCircle(newCenter);
    } catch (error) {
        console.error("Could not get place details for anchor point:", error);
    }
  }

  window.rtrlApp.handlePostalCodeSelection = async (item) => {
    try {
      const details = await getPlaceDetails(item.place_id);
      await populateFieldsFromPlaceDetails(details);
      const postalCodeComponent = details.address_components.find((c) => c.types.includes("postal_code"));
      if (postalCodeComponent) {
        await window.rtrlApp.validateAndAddTag(postalCodeComponent.long_name);
        elements.postalCodeInput.value = "";
      }
    } catch (error) {
      console.error("Could not get place details for postcode:", error);
    }
  }
  
  function initializeMap() {
    const defaultCenter = elements.countryInput.value.toLowerCase() === 'australia' ? [-33.8688, 151.2093] : [34.0522, -118.2437];
    map = L.map('map').setView(defaultCenter, 10);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
  }

  function initializeApp() {
    document.getElementById("currentYear").textContent = new Date().getFullYear();
    if (elements.researchStatusIcon) elements.researchStatusIcon.className = "fas fa-check-circle";

        const savedEmail = localStorage.getItem('rtrl_last_used_email');
    if (savedEmail) {
        elements.userEmailInput.value = savedEmail;
        console.log('Loaded last used email from localStorage.');
    }

    const savedData = localStorage.getItem("rtrl_collected_data");
    const savedParams = localStorage.getItem("rtrl_search_params");

    if (savedData) {
      logMessage(elements.logEl, "Found and loaded previous results from local storage.", "success");
      allCollectedData = JSON.parse(savedData);
      if (savedParams) {
        window.rtrlApp.state.currentSearchParameters = JSON.parse(savedParams);
        logMessage(elements.logEl, `Loaded search parameters: ${window.rtrlApp.state.currentSearchParameters.category} in ${window.rtrlApp.state.currentSearchParameters.area}.`, "info");
      }
      if (allCollectedData.length > 0) {
        elements.collectedDataCard.classList.add("has-results");
      }
      window.rtrlApp.applyFilterAndSort();
      elements.selectAllCheckbox.checked = true;
      setUiState(false, getUiElementsForStateChange());
    }

    populatePrimaryCategories(elements.primaryCategorySelect, categories, "");
    initializeMap();
    setupEventListeners(elements, socket, categories, countries, allCollectedData, displayedData, postalCodes, map, searchCircle);
    
    if (elements.findAllBusinessesCheckbox.checked) {
        elements.countInput.disabled = true;
        elements.countInput.value = "";
    }
    
    loadGoogleMaps();
  }

  function renderTable() {
    elements.resultsTableBody.innerHTML = "";
    if (displayedData.length > 0) {
      displayedData.forEach((business, index) => addTableRow(elements.resultsTableBody, business, index));
    }
    updateSortHeaders();
  }

  window.rtrlApp.applyFilterAndSort = () => {
    const filterText = elements.filterInput.value.toLowerCase();
    const minRating = parseFloat(elements.ratingFilter.value);
    const reviewFilterValue = elements.reviewCountFilter.value;
    let filteredData;

    if (filterText) {
        filteredData = allCollectedData.filter(item => 
            item.BusinessName?.toLowerCase().includes(filterText) || 
            item.Category?.toLowerCase().includes(filterText) || 
            item.StreetAddress?.toLowerCase().includes(filterText) || 
            item.SuburbArea?.toLowerCase().includes(filterText)
        );
    } else {
        filteredData = [...allCollectedData];
    }

    if (!isNaN(minRating) && minRating > 0) {
        filteredData = filteredData.filter(item => (parseFloat(item.StarRating) || 0) >= minRating);
    }

    if (reviewFilterValue) {
        filteredData = filteredData.filter(item => {
            const reviewCount = parseInt(item.ReviewCount, 10) || 0;
            if (reviewFilterValue === '>50') return reviewCount > 50;
            if (reviewFilterValue === '>100') return reviewCount > 100;
            if (reviewFilterValue === '>250') return reviewCount > 250;
            return true;
        });
    }

    const { key, direction } = window.rtrlApp.state.currentSort;
    if (key) {
        filteredData.sort((a, b) => {
            let valA = a[key] || "";
            let valB = b[key] || "";
            if (key === 'StarRating' || key === 'ReviewCount') {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
                return direction === "asc" ? valA - valB : valB - valA;
            }
            const comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: "base" });
            return direction === "asc" ? comparison : -comparison;
        });
    }
    
    displayedData = filteredData;
    renderTable();
  }

  function updateSortHeaders() {
    elements.resultsTableHeader.querySelectorAll(".sortable").forEach((th) => {
      th.classList.remove("asc", "desc");
      if (th.dataset.sortKey === window.rtrlApp.state.currentSort.key) {
        th.classList.add(window.rtrlApp.state.currentSort.direction);
      }
    });
  }

  window.rtrlApp.validateAndAddTag = async (postcode) => {
    const geocoder = window.rtrlApp.state.googleMapsGeocoder;
    const cleanedValue = postcode.trim();
    if (!cleanedValue || isNaN(cleanedValue) || postalCodes.includes(cleanedValue)) {
      elements.postalCodeInput.value = "";
      return;
    }
    const countryName = elements.countryInput.value.trim();
    const countryIsoCode = countries.find((c) => c.text.toLowerCase() === countryName.toLowerCase())?.value;
    if (!countryIsoCode) {
      logMessage(elements.logEl, "Please select a country before adding a postcode.", "error");
      triggerTagError();
      return;
    }
    if (!geocoder) {
      logMessage(elements.logEl, "Geocoder not ready. Please wait a moment.", "error");
      triggerTagError();
      return;
    }
    try {
      const request = { componentRestrictions: { country: countryIsoCode, postalCode: cleanedValue } };
      geocoder.geocode(request, (results, status) => {
        if (status === google.maps.GeocoderStatus.OK && results[0]) {
          const result = results[0];
          const components = result.address_components;
          const suburbComponent = components.find((c) => c.types.includes("locality"));
          const postcodeComponent = components.find((c) => c.types.includes("postal_code"));
          if (postcodeComponent && postcodeComponent.long_name === cleanedValue) {
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
  }

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
        elements.locationInput.value = '';
        postalCodes = [];
        elements.postalCodeContainer.querySelectorAll('.tag').forEach(tag => tag.remove());
      }
  }

  window.rtrlApp.setRadiusInputsState = (disabled) => {
      elements.anchorPointInput.disabled = disabled;
      elements.radiusSlider.disabled = disabled;
      elements.radiusSearchContainer.style.opacity = disabled ? 0.5 : 1;
      if (disabled) {
        elements.anchorPointInput.value = '';
        window.rtrlApp.state.selectedAnchorPoint = null;
        if (searchCircle) {
            map.removeLayer(searchCircle);
            searchCircle = null;
        }
      }
  }

  window.rtrlApp.drawSearchCircle = (center) => {
    const radiusMeters = parseInt(elements.radiusSlider.value, 10) * 1000;

    if (searchCircle) {
        searchCircle.setLatLng(center);
        searchCircle.setRadius(radiusMeters);
    } else {
        searchCircle = L.circle(center, {
            radius: radiusMeters,
            color: '#20c997',
            fillColor: '#20c997',
            fillOpacity: 0.2
        }).addTo(map);
    }
    map.fitBounds(searchCircle.getBounds());
  }

  socket.on("connect", () => {
    logMessage(elements.logEl, "Connected to the real-time server!", "success");
    if (elements.researchStatusIcon) elements.researchStatusIcon.className = "fas fa-check-circle";
  });
  socket.on("disconnect", () => {
    logMessage(elements.logEl, "Disconnected from the real-time server.", "error");
    setUiState(false, getUiElementsForStateChange());
    if (elements.researchStatusIcon) elements.researchStatusIcon.className = "fas fa-exclamation-triangle";
  });
  socket.on("log", (message) => logMessage(elements.logEl, message, "info"));
  socket.on("scrape_error", (error) => handleScrapeError(error));
  socket.on("business_found", (business) => {
    if (allCollectedData.length === 0) {
        elements.collectedDataCard.classList.add("has-results");
    }
    const newBusiness = { 
        OwnerName: "", Email1: "", Email2: "", Email3: "", 
        ...business, 
        SuburbArea: business.Suburb || elements.locationInput.value.split(",")[0].trim(), 
        LastVerifiedDate: new Date().toISOString().split("T")[0] 
    };
    allCollectedData.push(newBusiness);
    
    try {
        localStorage.setItem("rtrl_collected_data", JSON.stringify(allCollectedData));

    } catch (e) {
        logMessage(elements.logEl, `Could not save to local storage: ${e.message}`, "error");
    }

    window.rtrlApp.applyFilterAndSort();
  });
  socket.on("scrape_complete", () => {
    logMessage(elements.logEl, `Scraping process finished.`, "success");
    try {
      localStorage.setItem("rtrl_collected_data", JSON.stringify(allCollectedData));
      logMessage(elements.logEl, `Saved ${allCollectedData.length} records to local storage.`, "info");
    } catch (e) {
      logMessage(elements.logEl, `Could not save to local storage: ${e.message}`, "error");
    }
    elements.selectAllCheckbox.checked = true;
    elements.progressBar.style.width = "100%";
    elements.progressPercentage.textContent = "100%";
    if (elements.researchStatusIcon) elements.researchStatusIcon.className = "fas fa-check-circle";
    setUiState(false, getUiElementsForStateChange());
  });
  socket.on("progress_update", ({ processed, discovered, added, target }) => {
    let percentage = 0;
    const isSearchAll = target === -1;
    if (isSearchAll) {
      if (discovered > 0) {
        percentage = (processed / discovered) * 100;
      }
    } else {
      if (target > 0) {
        percentage = (added / target) * 100;
      }
    }
    if (percentage > 100) percentage = 100;
    const roundedPercentage = Math.round(percentage);
    elements.progressBar.style.width = `${roundedPercentage}%`;
    elements.progressPercentage.textContent = `${roundedPercentage}%`;
  });

  window.rtrlApp.initializeMapServices = () => {
    if (window.google && google.maps && google.maps.places) {
      window.rtrlApp.state.googleMapsService = new google.maps.places.AutocompleteService();
      window.rtrlApp.state.googleMapsGeocoder = new google.maps.Geocoder();
      console.log("Google Places Autocomplete Service initialized.");
    } else {
      console.warn("Google Maps Places API not fully loaded. Autocomplete may not function.");
    }
  };
  if (window.google && google.maps && google.maps.places && !window.rtrlApp.state.googleMapsService) {
    window.rtrlApp.initializeMapServices();
  }
  
  window.rtrlApp.fetchPlaceSuggestions = (inputEl, suggestionsEl, types, onSelect) => {
    const service = window.rtrlApp.state.googleMapsService;
    if (!service || inputEl.value.trim().length < 2) {
      suggestionsEl.style.display = "none";
      return;
    }
    const countryIsoCode = countries.find((c) => c.text.toLowerCase() === elements.countryInput.value.toLowerCase())?.value;
    const request = { input: inputEl.value, types };
    if (countryIsoCode) request.componentRestrictions = { country: countryIsoCode };
    service.getPlacePredictions(request, (predictions, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
        const items = predictions.map((p) => ({ description: p.description, place_id: p.place_id }));
        renderSuggestions(inputEl, suggestionsEl, items, "description", "place_id", onSelect);
      } else {
        suggestionsEl.style.display = "none";
      }
    });
  }

  window.rtrlApp.startResearch = () => {
    localStorage.removeItem("rtrl_collected_data");
    localStorage.removeItem("rtrl_search_params");
    setUiState(true, getUiElementsForStateChange());
    allCollectedData = [];
    displayedData = [];
    elements.logEl.textContent = "Waiting to start research...";
    elements.resultsTableBody.innerHTML = "";
    elements.progressBar.style.width = "0%";
    elements.progressPercentage.textContent = "0%";
    elements.collectedDataCard.classList.remove("has-results");
    if (elements.researchStatusIcon) elements.researchStatusIcon.className = "fas fa-spinner fa-spin";
    
    const namesText = elements.businessNamesInput.value.trim();
    const businessNames = namesText.split("\n").map((name) => name.trim()).filter(Boolean);
    
    const customCategory = elements.customCategoryInput.value.trim();
    const primaryCategory = elements.primaryCategorySelect.value;
    const selectedSubCategories = Array.from(elements.subCategoryCheckboxContainer.querySelectorAll('input[type="checkbox"]:checked'))
                                          .map(cb => cb.value)
                                          .filter(value => value !== 'select_all');

    const payload = { 
        country: elements.countryInput.value, 
        businessNames: businessNames.length > 0 ? businessNames : [],
        userEmail: elements.userEmailInput.value.trim(),
    };
    
    if (window.rtrlApp.state.selectedAnchorPoint) {
        const { lat, lng } = window.rtrlApp.state.selectedAnchorPoint.center;
        payload.anchorPoint = `${lat},${lng}`;
        payload.radiusKm = parseInt(elements.radiusSlider.value, 10);
    } else {
        payload.location = elements.locationInput.value.trim();
        payload.postalCode = postalCodes;
    }

    if (businessNames.length > 0) {
      payload.count = -1;
    } else if (customCategory) {
      payload.categoriesToLoop = [customCategory];
    } else if (selectedSubCategories.length > 0) {
      payload.categoriesToLoop = selectedSubCategories;
    } else {
      payload.categoriesToLoop = [primaryCategory];
    }
    
    const hasLocation = payload.location || (payload.postalCode && payload.postalCode.length > 0) || (payload.anchorPoint && payload.radiusKm);
    const hasSearchTerm = payload.businessNames.length > 0 || (payload.categoriesToLoop && payload.categoriesToLoop.length > 0 && payload.categoriesToLoop[0]);

    if ((!hasSearchTerm || !hasLocation || !payload.country) && businessNames.length === 0) {
      logMessage(elements.logEl, `Input Error: Please provide a category/keyword, a location type, and country.`, "error");
      handleScrapeError({ error: "Invalid input" });
      return;
    }
    if (businessNames.length === 0) {
      const countValue = parseInt(elements.countInput.value.trim(), 10);
      const find_all = elements.findAllBusinessesCheckbox.checked || !elements.countInput.value.trim() || countValue <= 0;
      payload.count = find_all ? -1 : countValue;
    }

    let searchAreaKey;
    if (window.rtrlApp.state.selectedAnchorPoint) {
        searchAreaKey = elements.anchorPointInput.value.trim().split(",")[0];
    } else {
        searchAreaKey = (postalCodes.length > 0 ? postalCodes.join("_") : elements.locationInput.value.trim().split(",")[0]);
    }
    
    const searchParameters = {
      primaryCategory: primaryCategory,
      subCategory: selectedSubCategories.length > 1 ? 'multiple_subcategories' : (selectedSubCategories[0] || ''),
      subCategoryList: selectedSubCategories, 
      customCategory: customCategory,
      area: searchAreaKey, 
      postcodes: postalCodes,
      country: elements.countryInput.value,
    };
    
    window.rtrlApp.state.currentSearchParameters = searchParameters;
    payload.searchParamsForEmail = searchParameters; 

    localStorage.setItem("rtrl_search_params", JSON.stringify(window.rtrlApp.state.currentSearchParameters));
    logMessage(elements.logEl, `Sending request to server...`, "info");
    socket.emit("start_scrape", payload);
  }

  function handleScrapeError(error) {
    logMessage(elements.logEl, `SCRAPE ERROR: ${error.error || "An unknown server error occurred."}`, "error");
    setUiState(false, getUiElementsForStateChange());
    if (elements.researchStatusIcon) elements.researchStatusIcon.className = "fas fa-exclamation-triangle";
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
      downloadButtons: { fullExcel: elements.downloadFullExcelButton, notifyre: elements.downloadNotifyreCSVButton, contacts: elements.downloadContactsCSVButton },
      displayedData: displayedData,
    };
  }
  initializeApp();
}

const socketIoScript = document.createElement("script");
socketIoScript.src = "https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.5/socket.io.min.js";
socketIoScript.onload = initializeMainApp;
socketIoScript.onerror = () => {
  console.error("Failed to load Socket.IO script from CDN.");
  const logEl = document.getElementById("log");
  if (logEl) {
    logEl.innerHTML = "FATAL ERROR: Could not load core networking library. Please check your internet connection and refresh the page.";
  }
};
document.head.appendChild(socketIoScript);