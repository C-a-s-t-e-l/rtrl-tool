const BACKEND_URL = "https://brieflessly-unlovely-constance.ngrok-free.app"; 
function initializeMainApp() {
  async function loadGoogleMaps() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/config`, {
            headers: {
                "ngrok-skip-browser-warning": "true"
            }
        });
      const config = await response.json();
      const googleMapsApiKey = config.googleMapsApiKey;

      if (googleMapsApiKey) {
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places&callback=initMap`;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      } else {
        console.error("Google Maps API key not received from server.");
      }
    } catch (error) {
      console.error("Failed to fetch config from server:", error);
    }
  }

  const socket = io(BACKEND_URL, {
    extraHeaders: {
        "ngrok-skip-browser-warning": "true"
    }
});

  const elements = {
    startButton: document.getElementById("startButton"),
    downloadFullExcelButton: document.getElementById("downloadFullExcelButton"),
    downloadNotifyreCSVButton: document.getElementById(
      "downloadNotifyreCSVButton"
    ),
    downloadGoogleWorkspaceCSVButton: document.getElementById(
      "downloadGoogleWorkspaceCSVButton"
    ),
    primaryCategorySelect: document.getElementById("primaryCategorySelect"),
    subCategoryGroup: document.getElementById("subCategoryGroup"),
    subCategorySelect: document.getElementById("subCategorySelect"),
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
    bulkSearchContainer: document.getElementById("bulkSearchContainer"),
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
  let allCollectedData = [],
    displayedData = [],
    service,
    geocoder,
    locationAutocompleteTimer,
    postalCodeAutocompleteTimer,
    countryAutocompleteTimer,
    currentSearchParameters = {},
    postalCodes = [];
  let currentSort = { key: "BusinessName", direction: "asc" };
  const categories = {
    "Select Category": [],
    "Other/Custom": [],
    Café: ["Café", "Coffee shop"],
    Bakery: ["Bakery", "Patisserie", "Cake shop", "Donut shop"],
    Restaurant: [
      "Restaurant",
      "Thai restaurant",
      "Italian restaurant",
      "Japanese restaurant",
      "Indian restaurant",
      "Chinese restaurant",
      "Mexican restaurant",
      "Vietnamese restaurant",
      "Sushi",
      "Kebab shop",
      "Fish and chips",
      "Pizza takeaway",
    ],
    "Fast Food": [
      "Fast food restaurant",
      "Burger restaurant",
      "Fried chicken takeaway",
    ],
    Grocer: [
      "Supermarket",
      "Grocer",
      "Butcher",
      "Seafood shop",
      "Fruit and vegetable store",
      "Deli",
      "Health food store",
      "Gourmet grocery store",
    ],
    "Specialty Drinks": [
      "Bubble tea shop",
      "Juice bar",
      "Liquor store",
      "Bottle shop",
    ],
    Fashion: [
      "Clothing store",
      "Women's clothing store",
      "Men's clothing store",
      "Boutique",
      "Lingerie store",
      "Swimwear store",
      "Surf shop",
    ],
    "Footwear & Bags": ["Shoe store", "Handbag store", "Luggage store"],
    "Jewellery & Accessories": [
      "Jewellery store",
      "Watch shop",
      "Accessory store",
    ],
    "Children & Babies": [
      "Children's clothing store",
      "Toy store",
      "Baby store",
    ],
    "Department & Discount": [
      "Department store",
      "Discount store",
      "Variety store",
    ],
    "Homewares & Gifts": [
      "Homewares store",
      "Kitchenware store",
      "Gift shop",
      "Florist",
      "Stationery store",
    ],
    "Electronics & Entertainment": [
      "Electronics store",
      "Mobile phone store",
      "Phone repair shop",
      "Video game store",
      "Book store",
      "Newsagent",
    ],
    "Sport & Fitness": [
      "Sporting goods store",
      "Sportswear store",
      "Bicycle shop",
      "Gym",
    ],
    "Hobbies & Lifestyle": [
      "Pet store",
      "Craft store",
      "Tobacconist",
      "Vape shop",
    ],
    "Health Services": [
      "Pharmacy",
      "Chemist",
      "Optometrist",
      "Dentist",
      "Medical Centre",
      "Audiology clinic",
      "Massage therapist",
      "Physiotherapist",
      "Chiropractor",
    ],
    "Beauty & Hair": [
      "Hair salon",
      "Barber shop",
      "Nail salon",
      "Beauty salon",
      "Cosmetics store",
      "Perfumery",
      "Tanning salon",
    ],
    "Financial & Professional": [
      "Bank",
      "Post Office",
      "Travel agent",
      "Real estate agent",
      "Accountant",
      "Law firm",
    ],
    "Personal Services": [
      "Dry cleaner",
      "Laundry service",
      "Shoe repair",
      "Key cutting service",
      "Alterations service",
      "Tattoo shop",
    ],
  };
  const countries = [
    { value: "AU", text: "Australia" },
    { value: "NZ", text: "New Zealand" },
    { value: "US", text: "United States" },
    { value: "GB", text: "United Kingdom" },
    { value: "CA", text: "Canada" },
    { value: "DE", text: "Germany" },
    { value: "FR", text: "France" },
    { value: "ES", text: "Spain" },
    { value: "IT", text: "Italy" },
    { value: "JP", text: "Japan" },
    { value: "SG", text: "Singapore" },
    { value: "HK", text: "Hong Kong" },
  ];

    async function getPlaceDetails(placeId) {
        return new Promise((resolve, reject) => {
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
            components[component.types[0]] = {
                long_name: component.long_name,
                short_name: component.short_name,
            };
        });
        const countryName = (components.country || {}).long_name || "";
        if (countryName) {
             elements.countryInput.value = countryName;
        }
    }

    async function handleLocationSelection(item) {
        try {
            const details = await getPlaceDetails(item.place_id);
            await populateFieldsFromPlaceDetails(details);
            elements.locationInput.value = item.description;

        } catch (error) {
            console.error("Could not get place details:", error);
            elements.locationInput.value = item.description.split(",")[0];
        }
    }

    async function handlePostalCodeSelection(item) {
        try {
            const details = await getPlaceDetails(item.place_id);
            await populateFieldsFromPlaceDetails(details);
            const postalCodeComponent = details.address_components.find(c => c.types.includes('postal_code'));
            if (postalCodeComponent) {
                validateAndAddTag(postalCodeComponent.long_name);
                 elements.postalCodeInput.value = '';
            }
        } catch (error) {
             console.error("Could not get place details for postcode:", error);
        }
    }

  function initializeApp() {
    document.getElementById("currentYear").textContent =
      new Date().getFullYear();
    if (elements.researchStatusIcon)
      elements.researchStatusIcon.className = "fas fa-check-circle";

    const savedData = localStorage.getItem("rtrl_collected_data");
    if (savedData) {
      logMessage(
        elements.logEl,
        "Found and loaded previous results from local storage.",
        "success"
      );
      allCollectedData = JSON.parse(savedData);
      if (allCollectedData.length > 0) {
        elements.collectedDataCard.classList.add("has-results");
      }
      applyFilterAndSort();
      elements.selectAllCheckbox.checked = true;
      setUiState(false, getUiElementsForStateChange());
    }

    populatePrimaryCategories(elements.primaryCategorySelect, categories, "");
    handleCategoryChange(
      "",
      elements.subCategoryGroup,
      elements.subCategorySelect,
      elements.customCategoryGroup,
      elements.customCategoryInput,
      categories
    );
    setupEventListeners();
    loadGoogleMaps();
  }

  function renderTable() {
    elements.resultsTableBody.innerHTML = "";
    if (displayedData.length > 0) {
      displayedData.forEach((business, index) =>
        addTableRow(elements.resultsTableBody, business, index)
      );
    }
    updateSortHeaders();
  }

  function applyFilterAndSort() {
    const filterText = elements.filterInput.value.toLowerCase();

    let filteredData;
if (filterText) {
    filteredData = allCollectedData.filter(item => {
        return (item.BusinessName?.toLowerCase().startsWith(filterText) ||
                item.Category?.toLowerCase().startsWith(filterText) ||
                item.StreetAddress?.toLowerCase().startsWith(filterText) ||
                item.SuburbArea?.toLowerCase().startsWith(filterText));
    });
} else {
      filteredData = [...allCollectedData];
    }

    const { key, direction } = currentSort;
    if (key) {
      filteredData.sort((a, b) => {
        const valA = a[key] || "";
        const valB = b[key] || "";
        const comparison = valA.localeCompare(valB, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return direction === "asc" ? comparison : -comparison;
      });
    }

    displayedData = filteredData;
    renderTable();
  }

  function updateSortHeaders() {
    elements.resultsTableHeader.querySelectorAll(".sortable").forEach((th) => {
      th.classList.remove("asc", "desc");
      if (th.dataset.sortKey === currentSort.key) {
        th.classList.add(currentSort.direction);
      }
    });
  }

    async function validateAndAddTag(postcode) {
        const cleanedValue = postcode.trim();
        if (!cleanedValue || isNaN(cleanedValue) || postalCodes.includes(cleanedValue)) {
            elements.postalCodeInput.value = '';
            return;
        }

        const countryName = elements.countryInput.value.trim();
        const countryIsoCode = countries.find(c => c.text.toLowerCase() === countryName.toLowerCase())?.value;
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
            const request = {
                componentRestrictions: {
                    country: countryIsoCode,
                    postalCode: cleanedValue
                }
            };
            geocoder.geocode(request, (results, status) => {
                if (status === google.maps.GeocoderStatus.OK && results[0]) {
                    const result = results[0];
                    const components = result.address_components;
                    const suburbComponent = components.find(c => c.types.includes('locality'));
                    const postcodeComponent = components.find(c => c.types.includes('postal_code'));

                    if (postcodeComponent && postcodeComponent.long_name === cleanedValue) {
                        const suburbName = suburbComponent ? suburbComponent.long_name : '';
                        addTagElement(cleanedValue, suburbName);
                        elements.postalCodeInput.value = '';
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
        elements.postalCodeContainer.classList.add('error');
        setTimeout(() => {
            elements.postalCodeContainer.classList.remove('error');
        }, 500);
    }
    
    function addTagElement(postcode, suburb = '') {
        postalCodes.push(postcode);
        const tagText = suburb ? `${suburb} ${postcode}` : postcode;
        const tagEl = document.createElement('span');
        tagEl.className = 'tag';
        tagEl.innerHTML = `<span>${tagText}</span> <span class="tag-close-btn" data-value="${postcode}">&times;</span>`;
        elements.postalCodeContainer.insertBefore(tagEl, elements.postalCodeInput);
    }

    function setupTagInput() {
        elements.postalCodeContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('tag-close-btn')) {
                const postcode = e.target.dataset.value;
                const index = postalCodes.indexOf(postcode);
                if (index > -1) {
                    postalCodes.splice(index, 1);
                }
                e.target.parentElement.remove();
            } else {
                elements.postalCodeInput.focus();
            }
        });

        elements.postalCodeInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                const value = elements.postalCodeInput.value.trim();
                if (value) {
                    await validateAndAddTag(value);
                }
            } else if (e.key === 'Backspace' && elements.postalCodeInput.value === '') {
                if (postalCodes.length > 0) {
                    const lastTag = elements.postalCodeContainer.querySelector('.tag:last-of-type');
                    if (lastTag) {
                         const closeBtn = lastTag.querySelector('.tag-close-btn');
                         const postcode = closeBtn.dataset.value;
                         const index = postalCodes.indexOf(postcode);
                         if (index > -1) {
                             postalCodes.splice(index, 1);
                         }
                         lastTag.remove();
                    }
                }
            }
        });
    }

  function setupEventListeners() {
    setupTagInput();
    elements.primaryCategorySelect.addEventListener("change", (event) => {
      handleCategoryChange(
        event.target.value,
        elements.subCategoryGroup,
        elements.subCategorySelect,
        elements.customCategoryGroup,
        elements.customCategoryInput,
        categories
      );
    });
    elements.findAllBusinessesCheckbox.addEventListener("change", (e) => {
      elements.countInput.disabled = e.target.checked;
      if (e.target.checked) elements.countInput.value = "";
    });
    elements.countryInput.addEventListener("input", () => {
      clearTimeout(countryAutocompleteTimer);
      countryAutocompleteTimer = setTimeout(() => {
        const query = elements.countryInput.value.toLowerCase();
        if (query.length < 1) {
          elements.countrySuggestionsEl.style.display = "none";
          return;
        }
        const filteredCountries = countries.filter((c) =>
          c.text.toLowerCase().includes(query)
        );
        renderSuggestions(
          elements.countryInput,
          elements.countrySuggestionsEl,
          filteredCountries,
          "text",
          "value",
          (c) => {
            elements.countryInput.value = c.text;
          }
        );
      }, 300);
    });
    
    elements.locationInput.addEventListener("input", () => {
      clearTimeout(locationAutocompleteTimer);
      locationAutocompleteTimer = setTimeout(
        () =>
          fetchPlaceSuggestions(
            elements.locationInput,
            elements.locationSuggestionsEl,
            ["geocode"],
            handleLocationSelection
          ),
        300
      );
    });

    elements.postalCodeInput.addEventListener("input", () => {
      clearTimeout(postalCodeAutocompleteTimer);
      postalCodeAutocompleteTimer = setTimeout(
        () =>
          fetchPlaceSuggestions(
            elements.postalCodeInput,
            elements.postalCodeSuggestionsEl,
            ["(regions)"],
            handlePostalCodeSelection
          ),
        300
      );
    });
    
    document.addEventListener("click", (event) => {
      if (!elements.locationInput.contains(event.target))
        elements.locationSuggestionsEl.style.display = "none";
      if (!elements.postalCodeContainer.contains(event.target))
        elements.postalCodeSuggestionsEl.style.display = "none";
      if (!elements.countryInput.contains(event.target))
        elements.countrySuggestionsEl.style.display = "none";
    });

    elements.startButton.addEventListener("click", startResearch);

    // --- START: BUG FIX for UI Dimming ---
    elements.businessNamesInput.addEventListener("input", (e) => {
      const isIndividualSearch = e.target.value.trim().length > 0;

      // Select all form groups and the checkbox group within the category search area
      const elementsToToggle = elements.bulkSearchContainer.querySelectorAll('.form-group, .form-row');

      elementsToToggle.forEach(el => {
        // Find inputs/selects within this group
        const inputs = el.querySelectorAll('input, select');
        let isLocationGroup = false;
        
        // Check if any input in this group is a location field
        inputs.forEach(input => {
            if (['locationInput', 'postalCodeInput', 'countryInput'].includes(input.id)) {
                isLocationGroup = true;
            }
        });

        if (isLocationGroup) {
            // Never dim or disable location fields
            el.style.opacity = '1';
        } else {
            // For all other fields (Category, Count, Checkbox), apply the logic
            el.style.opacity = isIndividualSearch ? '0.5' : '1';
            inputs.forEach(input => {
                input.disabled = isIndividualSearch;
            });
        }
      });
    });
    // --- END: BUG FIX for UI Dimming ---

    elements.selectAllCheckbox.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      elements.resultsTableBody
        .querySelectorAll(".row-checkbox")
        .forEach((checkbox) => {
          checkbox.checked = isChecked;
        });
    });

    const getSelectedData = () => {
      const selectedIndices = [];
      elements.resultsTableBody
        .querySelectorAll(".row-checkbox:checked")
        .forEach((checkbox) => {
          selectedIndices.push(parseInt(checkbox.dataset.index, 10));
        });
      return selectedIndices
        .map((index) => displayedData[index])
        .filter(Boolean);
    };

    elements.downloadFullExcelButton.addEventListener("click", () => {
      const selectedData = getSelectedData();
      downloadExcel(
        selectedData,
        currentSearchParameters,
        "full",
        "xlsx",
        elements.logEl
      );
    });
    elements.downloadNotifyreCSVButton.addEventListener("click", () => {
      const selectedData = getSelectedData();
      downloadExcel(
        selectedData.filter(d => d.Phone && d.Phone.startsWith('614')),
        currentSearchParameters,
        "notifyre_sms",
        "csv",
        elements.logEl,
        [
          "Phone",
          "OwnerName",
          "BusinessName",
          "SuburbArea",
          "Category",
          "Website",
        ]
      );
    });
    
    elements.downloadGoogleWorkspaceCSVButton.addEventListener("click", () => {
      const selectedRawData = getSelectedData();
      
      const dataWithEmails = selectedRawData.filter(d => d.Email1 && d.Email1.trim() !== '');

      if (dataWithEmails.length === 0) {
          logMessage(elements.logEl, 'No selected businesses have a primary email to export.', 'error');
          return;
      }
      
      const googleWorkspaceData = dataWithEmails.map(d => ({
            Email: d.Email1,
            OwnerName: d.OwnerName,
            BusinessName: d.BusinessName,
            StreetAddress: d.StreetAddress,
            SuburbArea: d.SuburbArea,
            Website: d.Website,
            InstagramURL: d.InstagramURL,
            FacebookURL: d.FacebookURL,
            GoogleMapsURL: d.GoogleMapsURL,
            Category: d.Category
        }));

      downloadExcel(
        googleWorkspaceData,
        currentSearchParameters,
        "google_workspace_email",
        "csv",
        elements.logEl,
        [
          "Email",
          "OwnerName",
          "BusinessName",
          "StreetAddress",
          "SuburbArea",
          "Website",
          "InstagramURL",
          "FacebookURL",
          "GoogleMapsURL",
          "Category",
        ]
      );
    });

    elements.filterInput.addEventListener("input", applyFilterAndSort);
    elements.resultsTableHeader.addEventListener("click", (e) => {
      const header = e.target.closest(".sortable");
      if (!header) return;

      const key = header.dataset.sortKey;
      if (currentSort.key === key) {
        currentSort.direction =
          currentSort.direction === "asc" ? "desc" : "asc";
      } else {
        currentSort.key = key;
        currentSort.direction = "asc";
      }
      applyFilterAndSort();
    });
  }

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
      service = new google.maps.places.AutocompleteService();
      geocoder = new google.maps.Geocoder();
      console.log("Google Places Autocomplete Service initialized.");
    } else {
      console.warn(
        "Google Maps Places API not fully loaded. Autocomplete may not function."
      );
    }
  };
  if (window.google && google.maps && google.maps.places && !service) {
    window.rtrlApp.initializeMapServices();
  }
  function fetchPlaceSuggestions(inputEl, suggestionsEl, types, onSelect) {
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
  }

  socket.on("connect", () => {
    logMessage(elements.logEl, "Connected to the real-time server!", "success");
    if (elements.researchStatusIcon)
      elements.researchStatusIcon.className = "fas fa-check-circle";
  });
  socket.on("disconnect", () => {
    logMessage(
      elements.logEl,
      "Disconnected from the real-time server.",
      "error"
    );
    setUiState(false, getUiElementsForStateChange());
    if (elements.researchStatusIcon)
      elements.researchStatusIcon.className = "fas fa-exclamation-triangle";
  });
  socket.on("log", (message) => logMessage(elements.logEl, message, "info"));
  socket.on("scrape_error", (error) => handleScrapeError(error));

  socket.on("business_found", (business) => {
    if (allCollectedData.length === 0) {
      elements.collectedDataCard.classList.add("has-results");
    }

    const newBusiness = {
      OwnerName: "",
      Email1: "",
      Email2: "",
      Email3: "",
      ...business,
      SuburbArea: business.Suburb || elements.locationInput.value.split(",")[0].trim(),
      LastVerifiedDate: new Date().toISOString().split("T")[0],
    };

    allCollectedData.push(newBusiness);
    applyFilterAndSort();
  });

  socket.on("scrape_complete", () => {
    logMessage(elements.logEl, `Scraping process finished.`, "success");

    try {
      localStorage.setItem(
        "rtrl_collected_data",
        JSON.stringify(allCollectedData)
      );
      logMessage(
        elements.logEl,
        `Saved ${allCollectedData.length} records to local storage.`,
        "info"
      );
    } catch (e) {
      logMessage(
        elements.logEl,
        `Could not save to local storage: ${e.message}`,
        "error"
      );
    }

    elements.selectAllCheckbox.checked = true;
    elements.progressBar.style.width = "100%";
    elements.progressPercentage.textContent = "100%";
    if (elements.researchStatusIcon)
      elements.researchStatusIcon.className = "fas fa-check-circle";

    setUiState(false, getUiElementsForStateChange());
  });

  function startResearch() {
    localStorage.removeItem("rtrl_collected_data");
    setUiState(true, getUiElementsForStateChange());
    allCollectedData = [];
    displayedData = [];
    elements.logEl.textContent = "Waiting to start research...";
    elements.resultsTableBody.innerHTML = "";
    elements.progressBar.style.width = "0%";
    elements.progressPercentage.textContent = "0%";
    elements.collectedDataCard.classList.remove("has-results");
    if (elements.researchStatusIcon)
      elements.researchStatusIcon.className = "fas fa-spinner fa-spin";

    const namesText = elements.businessNamesInput.value.trim();
    const businessNames = namesText.split('\n').map(name => name.trim()).filter(Boolean);
    
    const location = elements.locationInput.value.trim();
    const country = elements.countryInput.value;
    const countInputVal = elements.countInput.value.trim();
    
    let categorySearchTerm = elements.primaryCategorySelect.value === "Other/Custom"
        ? elements.customCategoryInput.value
        : elements.subCategorySelect.value || elements.primaryCategorySelect.value;
    
    const searchCategoryKey = (businessNames.length > 0 ? 'bulk_name_search' : categorySearchTerm).replace(/[\s/]/g, '_').toLowerCase();
    const searchAreaKey = (postalCodes.length > 0 ? postalCodes.join('_') : location.split(',')[0].replace(/[\s/,]/g, '_')).toLowerCase();
    const searchDate = new Date().toISOString().split('T')[0];
    const searchKey = `${searchDate}-${searchCategoryKey}-${searchAreaKey}`;

    let searchLog = JSON.parse(localStorage.getItem('rtrl_search_log')) || {};
    if (searchLog.date !== searchDate) {
      searchLog = { date: searchDate };
    }
    
    const currentCount = searchLog[searchKey] || 0;
    const newCount = currentCount + 1;
    searchLog[searchKey] = newCount;
    localStorage.setItem('rtrl_search_log', JSON.stringify(searchLog));
    
    const currentSearchVersion = newCount;

    currentSearchParameters = {
      category: searchCategoryKey,
      area: searchAreaKey,
      version: currentSearchVersion
    };

    if (businessNames.length > 0) {
      if (!location && postalCodes.length === 0) {
        logMessage(
          elements.logEl,
          `Input Error: Please provide a location or postal code for the bulk business search.`,
          "error"
        );
        handleScrapeError({ error: "Invalid input" });
        return;
      }
      logMessage(
        elements.logEl,
        `Sending request to find ${businessNames.length} specific businesses...`,
        "info"
      );
      socket.emit("start_scrape", {
        businessNames,
        location,
        postalCode: postalCodes,
        country,
        count: -1,
      });
    } else {
      const countValue = parseInt(countInputVal, 10);
      const find_all =
        elements.findAllBusinessesCheckbox.checked ||
        !countInputVal ||
        countValue <= 0;
      const count = find_all ? -1 : countValue;

      if (!categorySearchTerm || (postalCodes.length === 0 && !location) || !country) {
        logMessage(
          elements.logEl,
          `Input Error: Please provide a category, location/postal code, and country for bulk search.`,
          "error"
        );
        handleScrapeError({ error: "Invalid input" });
        return;
      }
      const targetDisplay = count === -1 ? "all available" : count;
      logMessage(
        elements.logEl,
        `Sending request to server to find ${targetDisplay} '${categorySearchTerm}' businesses...`,
        "info"
      );
      const payload = {
        category: categorySearchTerm,
        location,
        postalCode: postalCodes,
        country,
        count,
      };
      socket.emit("start_scrape", payload);
    }
  }

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
      subCategorySelect: elements.subCategorySelect,
      customCategoryInput: elements.customCategoryInput,
      locationInput: elements.locationInput,
      postalCodeInput: elements.postalCodeInput,
      countryInput: elements.countryInput,
      countInput: elements.countInput,
      findAllBusinessesCheckbox: elements.findAllBusinessesCheckbox,
      businessNamesInput: elements.businessNamesInput,
      downloadButtons: {
        fullExcel: elements.downloadFullExcelButton,
        notifyre: elements.downloadNotifyreCSVButton,
        googleWorkspace: elements.downloadGoogleWorkspaceCSVButton,
      },
      displayedData: displayedData,
    };
  }

  initializeApp();
}

const socketIoScript = document.createElement("script");
socketIoScript.src =
  "https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.5/socket.io.min.js";

socketIoScript.onload = initializeMainApp;

socketIoScript.onerror = () => {
  console.error("Failed to load Socket.IO script from CDN.");
  const logEl = document.getElementById("log");
  if (logEl) {
    logEl.innerHTML =
      "FATAL ERROR: Could not load core networking library. Please check your internet connection and refresh the page.";
  }
};

document.head.appendChild(socketIoScript);