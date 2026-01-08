function logMessage(el, message, type = "info") {
  if (!el) return;
  const timestamp = new Date().toLocaleTimeString();
  el.textContent += `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
  el.scrollTop = el.scrollHeight;
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