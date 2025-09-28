const BACKEND_URL = "https://brieflessly-unlovely-constance.ngrok-free.app";

function initializeMainApp() {
  async function loadGoogleMaps() {
    try {
      const response = await fetch(`${BACKEND_URL}/api/config`, {
        headers: {
          "ngrok-skip-browser-warning": "true",
        },
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
      "ngrok-skip-browser-warning": "true",
    },
  });

  const elements = {
    startButton: document.getElementById("startButton"),
    downloadFullExcelButton: document.getElementById("downloadFullExcelButton"),
    downloadNotifyreCSVButton: document.getElementById("downloadNotifyreCSVButton"),
    downloadContactsCSVButton: document.getElementById("downloadContactsCSVButton"), 
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
  let allCollectedData = [],
    displayedData = [],
    service,
    geocoder,
    locationAutocompleteTimer,
    postalCodeAutocompleteTimer,
    countryAutocompleteTimer,
    anchorPointAutocompleteTimer,
    currentSearchParameters = {},
    postalCodes = [];
  let currentSort = { key: "BusinessName", direction: "asc" };
  let map, searchCircle, selectedAnchorPoint = null;
  const radiusSteps = [2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

  const categories = {
    "Select Category": [], "Alterations and tailoring": [], "Baby and nursery": ["ALL", "Baby and infant toys", "Baby bedding", "Nursery furniture", "Prams, strollers and carriers", "Tableware and feeding"], "Banks": [], "Beauty and wellness": ["ALL", "Bath and body", "Fragrance", "Hair and beauty", "Hair care", "Makeup", "Skincare", "Vitamins and supplements"], "Books, stationery and gifts": ["ALL", "Book stores", "Cards and gift wrap", "Newsagencies", "Office supplies", "Stationery"], "Car and auto": [], "Childcare": [], "Clothing and accessories": ["ALL", "Babies' and toddlers'", "Footwear", "Jewellery and watches", "Kids' and junior", "Men's fashion", "Sunglasses", "Women's fashion"], "Community services": [], "Department stores": [], "Designer and boutique": [], "Discount and variety": [], "Dry cleaning": [], "Electronics and technology": ["ALL", "Cameras", "Computers and tablets", "Gaming and consoles", "Mobile and accessories", "Navigation", "TV and audio"], "Entertainment and activities": ["ALL", "Arcades and games", "Bowling", "Cinemas", "Kids activities", "Learning and education", "Music"], "Florists": [], "Food and drink": ["ALL", "Asian", "Bars and pubs", "Breakfast and brunch", "Cafes", "Casual dining", "Chocolate cafes", "Desserts", "Dietary requirements", "Fast food", "Fine dining", "Greek", "Grill houses", "Halal", "Healthy options", "Italian", "Juice bars", "Kid-friendly", "Lebanese", "Mexican and Latin American", "Middle Eastern", "Modern Australian", "Sandwiches and salads", "Takeaway"], "Foreign currency exchange": [], "Fresh food and groceries": ["ALL", "Bakeries", "Butchers", "Confectionery", "Delicatessens", "Fresh produce", "Liquor", "Patisseries", "Poultry", "Seafood", "Specialty foods", "Supermarkets"], "Health and fitness": ["ALL", "Chemists", "Dentists", "Gyms and fitness studios", "Health insurers", "Medical centres", "Medicare", "Optometrists", "Specialty health providers"], "Home": ["ALL", "Bath and home fragrances", "Bedding", "Furniture", "Gifts", "Hardware", "Home appliances", "Home decor", "Kitchen", "Pets", "Photography and art", "Picture frames"], "Luggage and travel accessories": ["ALL", "Backpacks and gym duffle bags", "Laptop cases and sleeves", "Small leather goods", "Suitcases and travel accessories", "Work and laptop bags"], "Luxury and premium": ["ALL", "Australian designer", "International designer", "Luxury", "Premium brands"], "Pawn brokers": [], "Phone repairs": [], "Photographic services": [], "Post office": [], "Power, gas and communication services": [], "Professional services": [], "Real estate agents": [], "Shoe repair and key cutting": [], "Sporting goods": ["ALL", "Activewear", "Fitness and gym equipment", "Outdoors and camping", "Tech and wearables"], "Tobacconists": [], "Toys and hobbies": ["ALL", "Arts and crafts", "Games", "Hobbies", "Toys"], "Travel agents": []
  };
  const countries = [
    { value: "AU", text: "Australia" }, { value: "NZ", text: "New Zealand" }, { value: "US", text: "United States" }, { value: "GB", text: "United Kingdom" }, { value: "CA", text: "Canada" }, { value: "DE", text: "Germany" }, { value: "FR", text: "France" }, { value: "ES", text: "Spain" }, { value: "IT", text: "Italy" }, { value: "JP", text: "Japan" }, { value: "SG", text: "Singapore" }, { value: "HK", text: "Hong Kong" },
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
      components[component.types[0]] = { long_name: component.long_name, short_name: component.short_name };
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

  async function handleAnchorPointSelection(item) {
    try {
        const details = await getPlaceDetails(item.place_id);
        const { lat, lng } = details.geometry.location;
        const newCenter = L.latLng(lat(), lng());

        selectedAnchorPoint = { center: newCenter, name: item.description };
        elements.anchorPointInput.value = item.description;
        elements.anchorPointSuggestionsEl.style.display = 'none';

        map.setView(newCenter, 11);
        drawSearchCircle(newCenter);
    } catch (error) {
        console.error("Could not get place details for anchor point:", error);
    }
  }

  async function handlePostalCodeSelection(item) {
    try {
      const details = await getPlaceDetails(item.place_id);
      await populateFieldsFromPlaceDetails(details);
      const postalCodeComponent = details.address_components.find((c) => c.types.includes("postal_code"));
      if (postalCodeComponent) {
        validateAndAddTag(postalCodeComponent.long_name);
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

    const savedData = localStorage.getItem("rtrl_collected_data");
    const savedParams = localStorage.getItem("rtrl_search_params");

    if (savedData) {
      logMessage(elements.logEl, "Found and loaded previous results from local storage.", "success");
      allCollectedData = JSON.parse(savedData);
      if (savedParams) {
        currentSearchParameters = JSON.parse(savedParams);
        logMessage(elements.logEl, `Loaded search parameters: ${currentSearchParameters.category} in ${currentSearchParameters.area}.`, "info");
      }
      if (allCollectedData.length > 0) {
        elements.collectedDataCard.classList.add("has-results");
      }
      applyFilterAndSort();
      elements.selectAllCheckbox.checked = true;
      setUiState(false, getUiElementsForStateChange());
    }

    populatePrimaryCategories(elements.primaryCategorySelect, categories, "");
    initializeMap();
    setupEventListeners();
    
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

  function applyFilterAndSort() {
    const filterText = elements.filterInput.value.toLowerCase();
    let filteredData;
    if (filterText) {
      filteredData = allCollectedData.filter((item) => {
        return (item.BusinessName?.toLowerCase().startsWith(filterText) || item.Category?.toLowerCase().startsWith(filterText) || item.StreetAddress?.toLowerCase().startsWith(filterText) || item.SuburbArea?.toLowerCase().startsWith(filterText));
      });
    } else {
      filteredData = [...allCollectedData];
    }
    const { key, direction } = currentSort;
    if (key) {
      filteredData.sort((a, b) => {
        const valA = a[key] || "";
        const valB = b[key] || "";
        const comparison = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: "base" });
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

  function setLocationInputsState(disabled) {
      elements.locationInput.disabled = disabled;
      elements.postalCodeInput.disabled = disabled;
      elements.locationSearchContainer.style.opacity = disabled ? 0.5 : 1;
      if (disabled) {
        elements.locationInput.value = '';
        postalCodes = [];
        elements.postalCodeContainer.querySelectorAll('.tag').forEach(tag => tag.remove());
      }
  }

  function setRadiusInputsState(disabled) {
      elements.anchorPointInput.disabled = disabled;
      elements.radiusSlider.disabled = disabled;
      elements.radiusSearchContainer.style.opacity = disabled ? 0.5 : 1;
      if (disabled) {
        elements.anchorPointInput.value = '';
        selectedAnchorPoint = null;
        if (searchCircle) {
            map.removeLayer(searchCircle);
            searchCircle = null;
        }
      }
  }

  function drawSearchCircle(center) {
    const stepIndex = parseInt(elements.radiusSlider.value, 10);
    const radiusMeters = radiusSteps[stepIndex] * 1000;

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

  function setupTagInput() {
    elements.postalCodeContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("tag-close-btn")) {
        const postcode = e.target.dataset.value;
        const index = postalCodes.indexOf(postcode);
        if (index > -1) {
          postalCodes.splice(index, 1);
        }
        e.target.parentElement.remove();
        if (postalCodes.length === 0 && !elements.locationInput.value.trim()) {
            setRadiusInputsState(false);
        }
      } else {
        elements.postalCodeInput.focus();
      }
    });
    elements.postalCodeInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const value = elements.postalCodeInput.value.trim();
        if (value) {
          await validateAndAddTag(value);
        }
      } else if (e.key === "Backspace" && elements.postalCodeInput.value === "") {
        if (postalCodes.length > 0) {
          const lastTag = elements.postalCodeContainer.querySelector(".tag:last-of-type");
          if (lastTag) {
            const closeBtn = lastTag.querySelector(".tag-close-btn");
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
    elements.postalCodeContainer.addEventListener('input', () => {
        const hasTags = postalCodes.length > 0 || elements.postalCodeInput.value.trim();
        if (hasTags) setRadiusInputsState(true);
    });
  }

  function setupEventListeners() {
    setupTagInput();
    elements.customCategoryInput.addEventListener("input", () => {
      const hasCustomText = elements.customCategoryInput.value.trim() !== "";
      elements.primaryCategorySelect.disabled = hasCustomText;
      elements.subCategorySelect.disabled = hasCustomText;
      if (hasCustomText) {
        elements.primaryCategorySelect.value = "";
        elements.primaryCategorySelect.dispatchEvent(new Event("change"));
      }
    });
    elements.primaryCategorySelect.addEventListener("change", (event) => {
      const selectedCategory = event.target.value;
      populateSubCategories(elements.subCategorySelect, elements.subCategoryGroup, selectedCategory, categories);
      const hasCategorySelection = selectedCategory !== "";
      elements.customCategoryInput.disabled = hasCategorySelection;
      if (hasCategorySelection) {
        elements.customCategoryInput.value = "";
      }
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
        const filteredCountries = countries.filter((c) => c.text.toLowerCase().includes(query));
        renderSuggestions(elements.countryInput, elements.countrySuggestionsEl, filteredCountries, "text", "value", (c) => {
          elements.countryInput.value = c.text;
        });
      }, 300);
    });
    elements.locationInput.addEventListener("input", () => {
      clearTimeout(locationAutocompleteTimer);
      locationAutocompleteTimer = setTimeout(() => fetchPlaceSuggestions(elements.locationInput, elements.locationSuggestionsEl, ["geocode"], handleLocationSelection), 300);
      setRadiusInputsState(elements.locationInput.value.trim().length > 0);
    });
    elements.postalCodeInput.addEventListener("input", () => {
      clearTimeout(postalCodeAutocompleteTimer);
      postalCodeAutocompleteTimer = setTimeout(() => fetchPlaceSuggestions(elements.postalCodeInput, elements.postalCodeSuggestionsEl, ["(regions)"], handlePostalCodeSelection), 300);
    });
    elements.anchorPointInput.addEventListener('input', () => {
        const hasText = elements.anchorPointInput.value.trim().length > 0;
        setLocationInputsState(hasText);
        if (selectedAnchorPoint && elements.anchorPointInput.value.trim() !== selectedAnchorPoint.name) {
            selectedAnchorPoint = null;
        }
        clearTimeout(anchorPointAutocompleteTimer);
        anchorPointAutocompleteTimer = setTimeout(() => {
            // --- THIS IS THE FIX ---
            fetchPlaceSuggestions(elements.anchorPointInput, elements.anchorPointSuggestionsEl, ['geocode'], handleAnchorPointSelection);
            // --- END OF FIX ---
        }, 300);
    });
    elements.radiusSlider.addEventListener('input', () => {
        const stepIndex = parseInt(elements.radiusSlider.value, 10);
        const km = radiusSteps[stepIndex];
        elements.radiusValue.textContent = `${km} km`;
        if (selectedAnchorPoint) {
            drawSearchCircle(selectedAnchorPoint.center);
        }
    });
    document.addEventListener("click", (event) => {
      if (!elements.locationInput.contains(event.target)) elements.locationSuggestionsEl.style.display = "none";
      if (!elements.postalCodeContainer.contains(event.target)) elements.postalCodeSuggestionsEl.style.display = "none";
      if (!elements.countryInput.contains(event.target)) elements.countrySuggestionsEl.style.display = "none";
      if (!elements.anchorPointInput.contains(event.target)) elements.anchorPointSuggestionsEl.style.display = "none";
    });
    elements.startButton.addEventListener("click", startResearch);
    elements.businessNamesInput.addEventListener("input", (e) => {
      const isIndividualSearch = e.target.value.trim().length > 0;
      const elementsToToggle = elements.bulkSearchContainer.querySelectorAll(".form-group, .form-row");
      elementsToToggle.forEach((el) => {
        const inputs = el.querySelectorAll("input, select");
          el.style.opacity = isIndividualSearch ? "0.5" : "1";
          inputs.forEach((input) => {
            input.disabled = isIndividualSearch;
          });
      });
      if(isIndividualSearch){
          setRadiusInputsState(true);
          setLocationInputsState(true);
      } else {
          setRadiusInputsState(false);
          setLocationInputsState(false);
      }
    });
    elements.selectAllCheckbox.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      elements.resultsTableBody.querySelectorAll(".row-checkbox").forEach((checkbox) => {
        checkbox.checked = isChecked;
      });
    });
    const getSelectedData = () => {
      const selectedIndices = [];
      elements.resultsTableBody.querySelectorAll(".row-checkbox:checked").forEach((checkbox) => {
        selectedIndices.push(parseInt(checkbox.dataset.index, 10));
      });
      return selectedIndices.map((index) => displayedData[index]).filter(Boolean);
    };
    elements.downloadFullExcelButton.addEventListener("click", async () => {
      const selectedData = getSelectedData();
      await downloadExcel(selectedData, currentSearchParameters, "full", "xlsx", elements.logEl, null, geocoder, elements.countryInput.value);
    });
    elements.downloadNotifyreCSVButton.addEventListener("click", async () => {
      const selectedData = getSelectedData();
      const notifyreHeaders = ["FirstName", "LastName", "Organization", "Email", "FaxNumber", "MobileNumber", "CustomField1", "CustomField2", "CustomField3", "CustomField4", "Unsubscribed"];
      const notifyreFormattedData = selectedData.filter((business) => business.Phone && business.Phone.startsWith("614")).map((business) => {
        let firstName = "";
        let lastName = "";
        if (business.OwnerName && business.OwnerName.trim() !== "") {
          const nameParts = business.OwnerName.trim().split(" ");
          firstName = nameParts.shift();
          lastName = nameParts.join(" ");
        }
        return { FirstName: firstName, LastName: lastName, Organization: business.BusinessName || "", Email: business.Email1 || "", FaxNumber: "", MobileNumber: business.Phone || "", CustomField1: business.Category || "", CustomField2: business.SuburbArea || "", CustomField3: "", CustomField4: "", Unsubscribed: "" };
      });
      await downloadExcel(notifyreFormattedData, currentSearchParameters, "sms", "csv", elements.logEl, notifyreHeaders, geocoder, elements.countryInput.value);
    });
    elements.downloadContactsCSVButton.addEventListener("click", async () => {
      const selectedRawData = getSelectedData();
      const dataWithEmails = selectedRawData.filter((d) => (d.Email1 && d.Email1.trim() !== "") || (d.Email2 && d.Email2.trim() !== ""));
      if (dataWithEmails.length === 0) {
        logMessage(elements.logEl, "No selected businesses have a primary or secondary email to export.", "error");
        return;
      }

      let locationString = currentSearchParameters.area;
      if (currentSearchParameters.postcodes && currentSearchParameters.postcodes.length > 0) {
          try {
              const postcodeToLookup = currentSearchParameters.postcodes[0];
              const countryName = elements.countryInput.value;
              const response = await new Promise((resolve, reject) => {
                  geocoder.geocode({ address: `${postcodeToLookup}, ${countryName}` }, (results, status) => {
                      if (status === 'OK' && results[0]) {
                          resolve(results[0]);
                      } else {
                          reject(new Error(`Geocode failed: ${status}`));
                      }
                  });
              });
              const suburbComponent = response.address_components.find(c => c.types.includes('locality'));
              if (suburbComponent) {
                  locationString = suburbComponent.long_name.replace(/[\s/]/g, "_").toLowerCase();
              }
          } catch (error) {
              console.warn("Could not geocode for Notes field, using default.", error);
              locationString = currentSearchParameters.area;
          }
      }

      const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const primaryCat = currentSearchParameters.primaryCategory?.replace(/[\s/&]/g, "_") || 'general';
      const subCat = (currentSearchParameters.subCategory && currentSearchParameters.subCategory !== 'ALL') ? currentSearchParameters.subCategory.replace(/[\s/&]/g, "_") : '';
      const customCat = currentSearchParameters.customCategory?.replace(/[\s/&]/g, "_") || '';

      let categoryString = customCat || primaryCat;
      if (subCat) {
          categoryString += `_${subCat}`;
      }
      
      const notesContent = `${date}_${categoryString}_${locationString}`;
      
      const newHeaders = [
          "Company", "Address_(other)_Sub", "Address_(other)_State", "Notes", 
          "facebook", "instagram", "linkedin", 
          "email_1", "email_2", "email_3"
      ];

      const contactsData = dataWithEmails.map((d) => {
        let state = '';
        if (d.StreetAddress) {
            const stateMatch = d.StreetAddress.match(/\b([A-Z]{2,3})\b(?= \d{4,})/);
            state = stateMatch ? stateMatch[1] : ''; 
        }

        return {
          "Company": d.BusinessName || '',
          "Address_(other)_Sub": d.SuburbArea || '',
          "Address_(other)_State": state, 
          "Notes": notesContent,
          "facebook": d.FacebookURL || '',
          "instagram": d.InstagramURL || '',
          "linkedin": '', 
          "email_1": d.Email1 || '',
          "email_2": d.Email2 || '',
          "email_3": d.Email3 || ''
        };
      });

      await downloadExcel(contactsData, currentSearchParameters, "emails", "csv", elements.logEl, newHeaders, geocoder, elements.countryInput.value);
    });

    elements.filterInput.addEventListener("input", applyFilterAndSort);
    elements.resultsTableHeader.addEventListener("click", (e) => {
      const header = e.target.closest(".sortable");
      if (!header) return;
      const key = header.dataset.sortKey;
      if (currentSort.key === key) {
        currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
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
      console.warn("Google Maps Places API not fully loaded. Autocomplete may not function.");
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
    const newBusiness = { OwnerName: "", Email1: "", Email2: "", Email3: "", ...business, SuburbArea: business.Suburb || elements.locationInput.value.split(",")[0].trim(), LastVerifiedDate: new Date().toISOString().split("T")[0] };
    allCollectedData.push(newBusiness);
    applyFilterAndSort();
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

  function startResearch() {
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
    const payload = { 
        country: elements.countryInput.value, 
        businessNames: businessNames.length > 0 ? businessNames : [] 
    };
    
    if (selectedAnchorPoint) {
        const center = selectedAnchorPoint.center;
        payload.anchorPoint = `${center.lat},${center.lng}`;
        const stepIndex = parseInt(elements.radiusSlider.value, 10);
        payload.radiusKm = radiusSteps[stepIndex];
    } else {
        payload.location = elements.locationInput.value.trim();
        payload.postalCode = postalCodes;
    }

    const customCategory = elements.customCategoryInput.value.trim();
    const primaryCategory = elements.primaryCategorySelect.value;
    const subCategory = elements.subCategorySelect.value;
    if (businessNames.length > 0) {
      payload.count = -1;
    } else if (customCategory) {
      payload.category = customCategory;
    } else if (subCategory === 'ALL') {
      payload.categoriesToLoop = categories[primaryCategory].filter(sc => sc !== 'ALL' && sc !== '');
    } else {
      payload.category = subCategory || primaryCategory;
    }
    
    const hasLocation = payload.location || (payload.postalCode && payload.postalCode.length > 0) || (payload.anchorPoint && payload.radiusKm);
    const hasSearchTerm = payload.businessNames.length > 0 || payload.category || (payload.categoriesToLoop && payload.categoriesToLoop.length > 0);

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

    const searchAreaKey = (postalCodes.length > 0 ? postalCodes.join("_") : elements.locationInput.value.trim().split(",")[0].replace(/[\s/,]/g, "_")).toLowerCase();
    
    currentSearchParameters = {
      primaryCategory: primaryCategory,
      subCategory: subCategory,
      customCategory: customCategory,
      area: searchAreaKey,
      postcodes: postalCodes,
      country: elements.countryInput.value,
    };
    localStorage.setItem("rtrl_search_params", JSON.stringify(currentSearchParameters));
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
      subCategorySelect: elements.subCategorySelect,
      customCategoryInput: elements.customCategoryInput,
      locationInput: elements.locationInput,
      postalCodeInput: elements.postalCodeInput,
      countryInput: elements.countryInput,
      countInput: elements.countInput,
      findAllBusinessesCheckbox: elements.findAllBusinessesCheckbox,
      businessNamesInput: elements.businessNamesInput,
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