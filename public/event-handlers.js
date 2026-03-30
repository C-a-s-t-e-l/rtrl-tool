function setupEventListeners(
  elements,
  socket,
  categories,
  countries,
  postalCodes,
  customKeywords,
  map,
  searchCircle
) {
  const state = window.rtrlApp.state;

  // Accordion Logic
  document.querySelectorAll(".collapsible-header").forEach((header) => {
    header.addEventListener("click", () => {
      const content = header.nextElementSibling;
      const icon = header.querySelector(".toggle-icon");

      content.classList.toggle("collapsed");
      if (icon) icon.classList.toggle("open");

      if (!content.classList.contains("collapsed")) {
        // Fix for Leaflet gray tiles: Force map to recalculate its size after the CSS transition finishes
        if (content.id === "radiusSearchContainer" && window.rtrlApp.map) {
          setTimeout(() => {
            window.rtrlApp.map.invalidateSize();
            if (window.rtrlApp.state.anchors.length > 0) {
              const group = new L.featureGroup(window.rtrlApp.state.anchors.map(a => a.circle));
              window.rtrlApp.map.fitBounds(group.getBounds().pad(0.1));
            }
          }, 350); // 350ms delay to ensure the CSS expansion is 100% complete
        }

        // Refresh job history if that tab is opened
        if (content.querySelector('#job-list-container')) {
          window.rtrlApp.jobHistory.fetchAndRenderJobs();
        }
      }
    });
  });

  // User Menu Dropdown
  const userMenuButton = document.getElementById("user-menu-button");
  const userMenuDropdown = document.getElementById("user-menu-dropdown");
  if (userMenuButton) {
    userMenuButton.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = userMenuDropdown.style.display === "block";
      userMenuDropdown.style.display = isVisible ? "none" : "block";
    });
  }
  
  // Close suggestions and dropdowns on outside click
  document.addEventListener("click", (event) => {
    if (userMenuDropdown) userMenuDropdown.style.display = "none";

    if (elements.locationInput && !elements.locationInput.contains(event.target)) {
      if(elements.locationSuggestionsEl) elements.locationSuggestionsEl.style.display = "none";
    }
    if (elements.postalCodeContainer && !elements.postalCodeContainer.contains(event.target)) {
      if(elements.postalCodeSuggestionsEl) elements.postalCodeSuggestionsEl.style.display = "none";
    }
    if (elements.countryInput && !elements.countryInput.contains(event.target)) {
      if(elements.countrySuggestionsEl) elements.countrySuggestionsEl.style.display = "none";
    }
    
    // Workspace search suggestions check
    const wsInput = document.getElementById('workspace-search-input');
    const wsSugg = document.getElementById('workspace-suggestions');
    if(wsInput && wsSugg && !wsInput.contains(event.target)) {
        wsSugg.style.display = "none";
    }
  });

  function setupTagInput() {
    function updateSaveButtonState() {
      if(elements.savePostcodeListButton) {
          elements.savePostcodeListButton.disabled = postalCodes.length === 0;
      }
    }

    if(elements.postalCodeContainer) {
        elements.postalCodeContainer.addEventListener("click", (e) => {
          if (e.target.classList.contains("tag-close-btn")) {
            const postcode = e.target.dataset.value;
            const index = postalCodes.indexOf(postcode);
            if (index > -1) postalCodes.splice(index, 1);
            e.target.parentElement.remove();
            
            if (postalCodes.length === 0 && !elements.locationInput.value.trim()) {
              window.rtrlApp.setRadiusInputsState(false);
            }
            updateSaveButtonState();
          } else {
            elements.postalCodeInput.focus();
          }
        });
    }

    if(elements.postalCodeInput) {
        elements.postalCodeInput.addEventListener("keydown", async (e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            const value = elements.postalCodeInput.value.trim();
            if (value) {
              await window.rtrlApp.validateAndAddTag(value);
              updateSaveButtonState();
            }
          } else if (
            e.key === "Backspace" &&
            elements.postalCodeInput.value === ""
          ) {
            if (postalCodes.length > 0) {
              const lastTag = elements.postalCodeContainer.querySelector(".tag:last-of-type");
              if (lastTag) {
                const closeBtn = lastTag.querySelector(".tag-close-btn");
                const postcode = closeBtn.dataset.value;
                const index = postalCodes.indexOf(postcode);
                if (index > -1) postalCodes.splice(index, 1);
                lastTag.remove();
                updateSaveButtonState();
              }
            }
          }
        });

        elements.postalCodeInput.addEventListener("input", () => {
          clearTimeout(window.rtrlApp.timers.postalCode);
          window.rtrlApp.timers.postalCode = setTimeout(
            () =>
              window.rtrlApp.fetchPlaceSuggestions(
                elements.postalCodeInput,
                elements.postalCodeSuggestionsEl,
                ["(regions)"],
                window.rtrlApp.handlePostalCodeSelection
              ),
            300
          );
        });
    }

    if(elements.postalCodeContainer) {
        elements.postalCodeContainer.addEventListener("input", () => {
          const hasTags = postalCodes.length > 0 || elements.postalCodeInput.value.trim();
          if (hasTags) window.rtrlApp.setRadiusInputsState(true);
        });
    }
  }

  function setupKeywordTagInput() {
    if(!elements.customKeywordContainer || !elements.customCategoryInput) return;

    elements.customKeywordContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("tag-close-btn")) {
        const keyword = e.target.dataset.value;
        const index = customKeywords.indexOf(keyword);
        if (index > -1) customKeywords.splice(index, 1);
        e.target.parentElement.remove();

        const hasCustomText = customKeywords.length > 0;
        elements.primaryCategorySelect.disabled = hasCustomText;
        if(elements.subCategoryCheckboxContainer) {
            elements.subCategoryCheckboxContainer
              .querySelectorAll("input")
              .forEach((cb) => (cb.disabled = hasCustomText));
        }
      } else {
        elements.customCategoryInput.focus();
      }
    });

    elements.customCategoryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const value = elements.customCategoryInput.value.trim();
        if (
          value &&
          !customKeywords.some((k) => k.toLowerCase() === value.toLowerCase())
        ) {
          customKeywords.push(value);
          const tagEl = document.createElement("span");
          tagEl.className = "tag";
          tagEl.innerHTML = `<span>${value}</span> <span class="tag-close-btn" data-value="${value}">&times;</span>`;
          elements.customKeywordContainer.insertBefore(
            tagEl,
            elements.customCategoryInput
          );
          elements.customCategoryInput.value = "";
        } else {
          elements.customCategoryInput.value = "";
        }
      } else if (
        e.key === "Backspace" &&
        elements.customCategoryInput.value === "" &&
        customKeywords.length > 0
      ) {
        customKeywords.pop();
        const lastTagEl =
          elements.customKeywordContainer.querySelector(`.tag:last-of-type`);
        if (lastTagEl) lastTagEl.remove();
      }

      const hasCustomText =
        customKeywords.length > 0 ||
        elements.customCategoryInput.value.trim() !== "";
      elements.primaryCategorySelect.disabled = hasCustomText;
      if(elements.subCategoryCheckboxContainer) {
          elements.subCategoryCheckboxContainer
            .querySelectorAll("input")
            .forEach((cb) => (cb.disabled = hasCustomText));
      }
      if (hasCustomText) {
        elements.primaryCategorySelect.value = "";
        elements.primaryCategorySelect.dispatchEvent(new Event("change"));
      }
    });

    elements.customCategoryInput.addEventListener("input", () => {
      const hasCustomText =
        customKeywords.length > 0 ||
        elements.customCategoryInput.value.trim() !== "";
      elements.primaryCategorySelect.disabled = hasCustomText;
      if(elements.subCategoryCheckboxContainer) {
          elements.subCategoryCheckboxContainer
            .querySelectorAll("input")
            .forEach((cb) => (cb.disabled = hasCustomText));
      }
      if (elements.categoryModifierInput)
        elements.categoryModifierInput.disabled = hasCustomText;

      if (hasCustomText) {
        elements.primaryCategorySelect.value = "";
        elements.primaryCategorySelect.dispatchEvent(new Event("change"));
      }
    });
  }

  setupTagInput();
  setupKeywordTagInput();

  if(elements.primaryCategorySelect) {
      elements.primaryCategorySelect.addEventListener("change", (event) => {
        const selectedCategory = event.target.value;
        populateSubCategories(
          elements.subCategoryCheckboxContainer,
          elements.subCategoryGroup,
          selectedCategory,
          categories
        );

        const hasCategorySelection = selectedCategory !== "";
        elements.customCategoryInput.disabled = hasCategorySelection;
        if (elements.categoryModifierGroup) {
          elements.categoryModifierGroup.style.display = hasCategorySelection
            ? "block"
            : "none";
          if (!hasCategorySelection) elements.categoryModifierInput.value = "";
        }

        if (hasCategorySelection && elements.customKeywordContainer) {
          elements.customCategoryInput.value = "";
          customKeywords.length = 0;
          elements.customKeywordContainer
            .querySelectorAll(".tag")
            .forEach((tag) => tag.remove());
        }
      });
  }

  if(elements.findAllBusinessesCheckbox) {
      elements.findAllBusinessesCheckbox.addEventListener("change", (e) => {
        elements.countInput.disabled = e.target.checked;
        if (e.target.checked) elements.countInput.value = "";
      });
  }

  if(elements.countryInput) {
      elements.countryInput.addEventListener("input", () => {
        clearTimeout(window.rtrlApp.timers.country);
        window.rtrlApp.timers.country = setTimeout(() => {
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
  }

  if(elements.locationInput) {
      elements.locationInput.addEventListener("input", () => {
        clearTimeout(window.rtrlApp.timers.location);
        window.rtrlApp.timers.location = setTimeout(
          () =>
            window.rtrlApp.fetchPlaceSuggestions(
              elements.locationInput,
              elements.locationSuggestionsEl,
              ["geocode"],
              window.rtrlApp.handleLocationSelection
            ),
          300
        );
        window.rtrlApp.setRadiusInputsState(
          elements.locationInput.value.trim().length > 0
        );
      });
  }

  if(elements.startButton) {
      elements.startButton.addEventListener("click", () =>
        window.rtrlApp.startResearch()
      );
  }

  if(elements.businessNamesInput) {
      elements.businessNamesInput.addEventListener("input", (e) => {
        const isIndividualSearch = e.target.value.trim().length > 0;
        window.rtrlApp.setRadiusInputsState(isIndividualSearch);
        window.rtrlApp.setLocationInputsState(isIndividualSearch);
      });
  }

  let emailSaveTimeout;
  if(elements.userEmailInput) {
      elements.userEmailInput.addEventListener("input", (e) => {
        clearTimeout(emailSaveTimeout);
        const email = e.target.value;
        emailSaveTimeout = setTimeout(() => {
          if (email) {
            localStorage.setItem("rtrl_last_used_email", email);
          } else {
            localStorage.removeItem("rtrl_last_used_email");
          }
        }, 500);
      });
  }
}