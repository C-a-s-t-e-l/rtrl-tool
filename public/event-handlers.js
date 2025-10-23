function setupEventListeners(elements, socket, categories, countries, allCollectedData, displayedData, postalCodes, map, searchCircle) {

  const state = window.rtrlApp.state;

  function getSelectedData() {
    const selectedIndices = [];
    elements.resultsTableBody.querySelectorAll(".row-checkbox:checked").forEach((checkbox) => {
      selectedIndices.push(parseInt(checkbox.dataset.index, 10));
    });
    return window.rtrlApp.getDisplayedData().filter((_, index) => selectedIndices.includes(index));
  }
  
  function setupTagInput() {
    // This function will check the postalCodes array and update the button state
    function updateSaveButtonState() {
        elements.savePostcodeListButton.disabled = postalCodes.length === 0;
    }

    elements.postalCodeContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("tag-close-btn")) {
        const postcode = e.target.dataset.value;
        const index = postalCodes.indexOf(postcode);
        if (index > -1) postalCodes.splice(index, 1);
        e.target.parentElement.remove();
        if (postalCodes.length === 0 && !elements.locationInput.value.trim()) window.rtrlApp.setRadiusInputsState(false);
        
        // --- ADD THIS LINE ---
        updateSaveButtonState(); // Update button state on removal
      } else {
        elements.postalCodeInput.focus();
      }
    });
    elements.postalCodeInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const value = elements.postalCodeInput.value.trim();
        if (value) {
            // validateAndAddTag will add the tag and populate the postalCodes array
            await window.rtrlApp.validateAndAddTag(value); 
            // --- ADD THIS LINE ---
            updateSaveButtonState(); // Update button state after adding
        }
      } else if (e.key === "Backspace" && elements.postalCodeInput.value === "") {
        if (postalCodes.length > 0) {
          const lastTag = elements.postalCodeContainer.querySelector(".tag:last-of-type");
          if (lastTag) {
            const closeBtn = lastTag.querySelector(".tag-close-btn");
            const postcode = closeBtn.dataset.value;
            const index = postalCodes.indexOf(postcode);
            if (index > -1) postalCodes.splice(index, 1);
            lastTag.remove();
            // --- ADD THIS LINE ---
            updateSaveButtonState(); // Update button state on removal
          }
        }
      }
    });
    elements.postalCodeContainer.addEventListener('input', () => {
      const hasTags = postalCodes.length > 0 || elements.postalCodeInput.value.trim();
      if (hasTags) window.rtrlApp.setRadiusInputsState(true); 
    });
  }

  setupTagInput();
  elements.customCategoryInput.addEventListener("input", () => {
    const hasCustomText = elements.customCategoryInput.value.trim() !== "";
    elements.primaryCategorySelect.disabled = hasCustomText;
    elements.subCategoryCheckboxContainer.querySelectorAll('input').forEach(cb => cb.disabled = hasCustomText);
    if (hasCustomText) {
      elements.primaryCategorySelect.value = "";
      elements.primaryCategorySelect.dispatchEvent(new Event("change"));
    }
  });

  elements.primaryCategorySelect.addEventListener("change", (event) => {
    const selectedCategory = event.target.value;
    populateSubCategories(elements.subCategoryCheckboxContainer, elements.subCategoryGroup, selectedCategory, categories);
    const hasCategorySelection = selectedCategory !== "";
    elements.customCategoryInput.disabled = hasCategorySelection;
    if (hasCategorySelection) elements.customCategoryInput.value = "";
  });

  elements.findAllBusinessesCheckbox.addEventListener("change", (e) => {
    elements.countInput.disabled = e.target.checked;
    if (e.target.checked) elements.countInput.value = "";
  });

  elements.countryInput.addEventListener("input", () => {
    clearTimeout(window.rtrlApp.timers.country);
    window.rtrlApp.timers.country = setTimeout(() => {
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
    clearTimeout(window.rtrlApp.timers.location);
    window.rtrlApp.timers.location = setTimeout(() => window.rtrlApp.fetchPlaceSuggestions(elements.locationInput, elements.locationSuggestionsEl, ["geocode"], window.rtrlApp.handleLocationSelection), 300);
    window.rtrlApp.setRadiusInputsState(elements.locationInput.value.trim().length > 0); 
  });

  elements.postalCodeInput.addEventListener("input", () => {
    clearTimeout(window.rtrlApp.timers.postalCode);
    window.rtrlApp.timers.postalCode = setTimeout(() => window.rtrlApp.fetchPlaceSuggestions(elements.postalCodeInput, elements.postalCodeSuggestionsEl, ["(regions)"], window.rtrlApp.handlePostalCodeSelection), 300);
  });

  elements.anchorPointInput.addEventListener('input', () => {
    const hasText = elements.anchorPointInput.value.trim().length > 0;
    window.rtrlApp.setLocationInputsState(hasText); 
    if (state.selectedAnchorPoint && elements.anchorPointInput.value.trim() !== state.selectedAnchorPoint.name) {
      state.selectedAnchorPoint = null;
    }
    clearTimeout(window.rtrlApp.timers.anchorPoint);
    window.rtrlApp.timers.anchorPoint = setTimeout(() => {
      window.rtrlApp.fetchPlaceSuggestions(elements.anchorPointInput, elements.anchorPointSuggestionsEl, ['geocode'], window.rtrlApp.handleAnchorPointSelection);
    }, 300);
  });

  elements.radiusSlider.addEventListener('input', () => {
    const km = elements.radiusSlider.value;
    elements.radiusValue.textContent = `${km} km`;
    if (state.selectedAnchorPoint) {
      window.rtrlApp.drawSearchCircle(state.selectedAnchorPoint.center); 
    }
  });

  document.addEventListener("click", (event) => {
    if (!elements.locationInput.contains(event.target)) elements.locationSuggestionsEl.style.display = "none";
    if (!elements.postalCodeContainer.contains(event.target)) elements.postalCodeSuggestionsEl.style.display = "none";
    if (!elements.countryInput.contains(event.target)) elements.countrySuggestionsEl.style.display = "none";
    if (!elements.anchorPointInput.contains(event.target)) elements.anchorPointSuggestionsEl.style.display = "none";
  });

  elements.startButton.addEventListener("click", () => window.rtrlApp.startResearch());

  elements.businessNamesInput.addEventListener("input", (e) => {
    const isIndividualSearch = e.target.value.trim().length > 0;
    elements.bulkSearchContainer.querySelectorAll(".form-group, .form-row").forEach((el) => {
      el.style.opacity = isIndividualSearch ? "0.5" : "1";
      el.querySelectorAll("input, select").forEach(input => input.disabled = isIndividualSearch);
    });
    window.rtrlApp.setRadiusInputsState(isIndividualSearch); 
    window.rtrlApp.setLocationInputsState(isIndividualSearch); 
  });

    let emailSaveTimeout;
  elements.userEmailInput.addEventListener('input', (e) => {
    
      clearTimeout(emailSaveTimeout);
      
      const email = e.target.value;

      emailSaveTimeout = setTimeout(() => {
          if (email) {
              localStorage.setItem('rtrl_last_used_email', email);
              console.log('Saved email to localStorage.');
          } else {
             
              localStorage.removeItem('rtrl_last_used_email');
              console.log('Removed email from localStorage.');
          }
      }, 500); 
  });

  elements.selectAllCheckbox.addEventListener("change", (e) => {
    elements.resultsTableBody.querySelectorAll(".row-checkbox").forEach(checkbox => checkbox.checked = e.target.checked);
  });

  elements.downloadFullExcelButton.addEventListener("click", async () => {
    const geocoder = window.rtrlApp.state.googleMapsGeocoder;
    await downloadExcel(getSelectedData(), state.currentSearchParameters, "full", "xlsx", elements.logEl, null, geocoder, elements.countryInput.value);
  });

  elements.downloadNotifyreCSVButton.addEventListener("click", async () => {
    const geocoder = window.rtrlApp.state.googleMapsGeocoder; 
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
      await downloadExcel(notifyreFormattedData, state.currentSearchParameters, "sms", "csv", elements.logEl, notifyreHeaders, geocoder, elements.countryInput.value);
  });

  elements.downloadContactsCSVButton.addEventListener("click", async () => {
    const geocoder = window.rtrlApp.state.googleMapsGeocoder; 
    const selectedRawData = getSelectedData();
    const dataWithEmails = selectedRawData.filter((d) => (d.Email1 && d.Email1.trim() !== "") || (d.Email2 && d.Email2.trim() !== ""));
    if (dataWithEmails.length === 0) {
      logMessage(elements.logEl, "No selected businesses have a primary or secondary email to export.", "error");
      return;
    }

    let locationString = state.currentSearchParameters.area;
    if (state.currentSearchParameters.postcodes && state.currentSearchParameters.postcodes.length > 0) {
        try {
            const postcodeToLookup = state.currentSearchParameters.postcodes[0];
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
            locationString = state.currentSearchParameters.area;
        }
    }

    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const primaryCat = state.currentSearchParameters.primaryCategory?.replace(/[\s/&]/g, "_") || 'general';
    const subCat = (state.currentSearchParameters.subCategory && state.currentSearchParameters.subCategory !== 'ALL') ? state.currentSearchParameters.subCategory.replace(/[\s/&]/g, "_") : '';
    const customCat = state.currentSearchParameters.customCategory?.replace(/[\s/&]/g, "_") || '';

    let categoryString = customCat || primaryCat;
    if (subCat) {
        categoryString += `_${subCat}`;
    }
    
    const notesContent = `${date}_${categoryString}_${locationString}`;
    
    const newHeaders = [
        "Company", "Address_Suburb", "Address_State", "Notes", 
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
        "Address_Suburb": d.SuburbArea || '',
        "Address_State": state, 
        "Notes": notesContent,
        "facebook": d.FacebookURL || '',
        "instagram": d.InstagramURL || '',
        "linkedin": '', 
        "email_1": d.Email1 || '',
        "email_2": d.Email2 || '',
        "email_3": d.Email3 || ''
      };
    });

    await downloadExcel(contactsData, state.currentSearchParameters, "emails", "csv", elements.logEl, newHeaders, geocoder, elements.countryInput.value);
  });

  elements.filterInput.addEventListener("input", () => window.rtrlApp.applyFilterAndSort());
  elements.ratingFilter.addEventListener("input", () => window.rtrlApp.applyFilterAndSort());
  elements.reviewCountFilter.addEventListener("change", () => window.rtrlApp.applyFilterAndSort());

  elements.resultsTableHeader.addEventListener("click", (e) => {
    const header = e.target.closest(".sortable");
    if (!header) return;
    const key = header.dataset.sortKey;
    if (state.currentSort.key === key) {
      state.currentSort.direction = state.currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      state.currentSort.key = key;
      state.currentSort.direction = "asc";
    }
    window.rtrlApp.applyFilterAndSort();
  });
}