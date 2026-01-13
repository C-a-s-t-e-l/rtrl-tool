function logMessage(el, message, type = "info") {
  const card = document.getElementById("status-card");
  const icon = document.getElementById("status-icon");
  const text = document.getElementById("status-text");
  const progressWrapper = document.getElementById("status-progress-wrapper");

  if (!card || !icon || !text) return;

  const lowerMsg = message.toLowerCase();

  if (type === "error" && (lowerMsg.includes("connection lost") || lowerMsg.includes("socket"))) {
    card.className = "status-card state-error";
    icon.className = "fas fa-wifi";
    text.textContent = "Connection Lost";
    return;
  }
  
  if (type === "success" && lowerMsg.includes("connected")) {
    text.textContent = "Reconnected";
    setTimeout(() => {
        if(text.textContent === "Reconnected") {
            card.className = "status-card";
            icon.className = "fas fa-play";
            text.textContent = "Ready to Start";
        }
    }, 2000);
    return;
  }

  if (type === "info" && !lowerMsg.includes("complete") && !lowerMsg.includes("finished")) {
    card.className = "status-card state-working";
    
    if (lowerMsg.includes("ai")) {
        icon.className = "fas fa-brain";
        text.textContent = "AI Analyzing Data...";
    } 
    else if (lowerMsg.includes("email")) {
        icon.className = "fas fa-paper-plane";
        text.textContent = "Sending Results...";
    }
    else {
        icon.className = "fas fa-search-location";
        text.textContent = "Scraping in Progress...";
    }

    if(progressWrapper) progressWrapper.style.opacity = "1";
    return;
  }

  if (lowerMsg.includes("completed") || lowerMsg.includes("success")) {
    card.className = "status-card state-success";
    icon.className = "fas fa-check-circle";
    text.textContent = "Research Complete";
    
    // Max out progress bar
    const fill = document.getElementById("status-progress-fill");
    const label = document.getElementById("status-progress-text");
    if(fill) fill.style.width = "100%";
    if(label) label.textContent = "100%";
    
    return;
  }

  if (type === "error") {
    card.className = "status-card state-error";
    icon.className = "fas fa-exclamation-triangle";
    text.textContent = "An Error Occurred";
  }
}

function setUiState(isResearching, elements) {
  const {
    startButton,
    primaryCategorySelect,
    subCategoryCheckboxContainer,
    customCategoryInput,
    locationInput,
    postalCodeInput,
    countryInput,
    countInput,
    findAllBusinessesCheckbox,
    businessNamesInput,
    userEmailInput,
    anchorPointInput,
    radiusSlider,
  } = elements;

  const disabled = isResearching;

  if (startButton) {
    startButton.disabled = disabled;
    startButton.innerHTML = disabled
      ? '<i class="fas fa-spinner fa-spin"></i> Researching...'
      : '<i class="fas fa-play"></i> Start Research';
  }

  const inputs = [
    primaryCategorySelect,
    customCategoryInput,
    locationInput,
    postalCodeInput,
    countryInput,
    countInput,
    findAllBusinessesCheckbox,
    businessNamesInput,
    userEmailInput,
    anchorPointInput,
    radiusSlider,
  ];

  inputs.forEach((input) => {
    if (input) input.disabled = disabled;
  });

  if (subCategoryCheckboxContainer) {
    subCategoryCheckboxContainer
      .querySelectorAll("input")
      .forEach((cb) => (cb.disabled = disabled));
  }
}

function populatePrimaryCategories(selectEl, categories, selectedValue) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  
  Object.keys(categories).forEach((category) => {
    const option = document.createElement("option");
    option.value = category === "Select Category" ? "" : category;
    option.textContent = category;
    if (category === selectedValue) {
      option.selected = true;
    }
    selectEl.appendChild(option);
  });
}

function populateSubCategories(container, group, selectedCategory, categories) {
  if (!container || !group) return;

  container.innerHTML = "";
  const subs = categories[selectedCategory];

  if (subs && subs.length > 0) {
    group.style.display = "block";

    if (subs.includes("ALL")) {
        const div = document.createElement("div");
        div.className = "checkbox-item checkbox-item-all";
        div.innerHTML = `
            <input type="checkbox" id="sub_all" value="select_all">
            <label for="sub_all">Select All</label>
        `;
        container.appendChild(div);
        
        const allCheckbox = div.querySelector('input');
        allCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            container.querySelectorAll('input:not(#sub_all)').forEach(cb => {
                cb.checked = isChecked;
            });
        });
    }

    subs.forEach((sub, index) => {
      if (sub === "ALL") return; 
      const safeSub = sub.replace(/\s+/g, "_").toLowerCase() + index;
      const div = document.createElement("div");
      div.className = "checkbox-item";
      div.innerHTML = `
        <input type="checkbox" id="sub_${safeSub}" value="${sub}">
        <label for="sub_${safeSub}">${sub}</label>
      `;
      container.appendChild(div);
    });
  } else {
    group.style.display = "none";
  }
}

function renderSuggestions(inputEl, containerEl, items, textKey, valueKey, onSelect) {
  if (!containerEl) return;
  containerEl.innerHTML = "";
  
  if (!items || items.length === 0) {
    containerEl.style.display = "none";
    return;
  }

  const ul = document.createElement("ul");
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item[textKey];
    li.addEventListener("click", () => {
      onSelect(item);
      containerEl.style.display = "none";
    });
    ul.appendChild(li);
  });

  containerEl.appendChild(ul);
  containerEl.style.display = "block";
}