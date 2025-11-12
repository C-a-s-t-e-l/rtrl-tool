function populatePrimaryCategories(selectEl, categoriesData, defaultCategory) {
  selectEl.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Select Business Category";
  selectEl.appendChild(defaultOption);

  for (const categoryName in categoriesData) {
    if (categoryName !== "Select Category") {
      const option = document.createElement("option");
      option.value = categoryName;
      option.textContent = categoryName;
      selectEl.appendChild(option);
    }
  }
  selectEl.value = defaultCategory;
}

function populateSubCategories(
  containerEl,
  groupEl,
  selectedCategory,
  categoriesData
) {
  containerEl.innerHTML = "";
  const subCategories = categoriesData[selectedCategory];

  if (subCategories && subCategories.length > 1 && selectedCategory) {
    groupEl.style.display = "block";

    const createCheckboxItem = (value, text, isBold = false) => {
      const itemDiv = document.createElement("div");
      itemDiv.className = "checkbox-item";
      if (isBold) itemDiv.classList.add("checkbox-item-all");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `subcat-${value.replace(/\s/g, "_")}`;
      checkbox.value = value;

      const label = document.createElement("label");
      label.htmlFor = `subcat-${value.replace(/\s/g, "_")}`;
      label.textContent = text;

      itemDiv.appendChild(checkbox);
      itemDiv.appendChild(label);
      return { itemDiv, checkbox };
    };

    const allSubCategories = subCategories.filter(
      (sc) => sc !== "ALL" && sc !== ""
    );
    if (allSubCategories.length === 0) {
      groupEl.style.display = "none";
      return;
    }

    const { itemDiv: allDiv, checkbox: allCheckbox } = createCheckboxItem(
      "select_all",
      "Select All",
      true
    );
    containerEl.appendChild(allDiv);

    const individualCheckboxes = [];

    allSubCategories.forEach((subCat) => {
      if (subCat) {
        const { itemDiv, checkbox } = createCheckboxItem(subCat, subCat);
        individualCheckboxes.push(checkbox);
        containerEl.appendChild(itemDiv);
      }
    });

    allCheckbox.addEventListener("change", () => {
      individualCheckboxes.forEach((cb) => {
        cb.checked = allCheckbox.checked;
      });
    });

    individualCheckboxes.forEach((cb) => {
      cb.addEventListener("change", () => {
        if (!cb.checked) {
          allCheckbox.checked = false;
        } else if (individualCheckboxes.every((iCb) => iCb.checked)) {
          allCheckbox.checked = true;
        }
      });
    });
  } else {
    groupEl.style.display = "none";
  }
}

function renderSuggestions(
  inputElement,
  suggestionsContainer,
  items,
  displayKey,
  valueKey,
  onSelectCallback
) {
  suggestionsContainer.innerHTML = "";
  if (items.length === 0 || inputElement.value.trim() === "") {
    suggestionsContainer.style.display = "none";
    return;
  }

  const ul = document.createElement("ul");
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item[displayKey];
    li.dataset.value = item[valueKey];
    li.dataset.original = JSON.stringify(item);
    li.addEventListener("click", () => {
      onSelectCallback(item);
      suggestionsContainer.style.display = "none";
    });
    ul.appendChild(li);
  });
  suggestionsContainer.appendChild(ul);
  suggestionsContainer.style.display = "block";
}

function cleanDisplayValue(text) {
  if (!text) return "";
  let cleaned = String(text).replace(/^[^a-zA-Z0-9\s.,'#\-+/&_]+/u, "");
  cleaned = cleaned.replace(/\p{Z}/gu, " ");
  cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F\uFEFF\n\r]/g, "");
  return cleaned.replace(/\s+/g, " ").trim();
}

function addTableRow(gridBody, data, index) {
    const row = document.createElement('div');
    row.className = 'grid-row';

    const createCell = (content = '', title = '') => {
        const cell = document.createElement('span');
        if (typeof content === 'object') {
            cell.appendChild(content);
        } else {
            cell.textContent = content;
        }
        cell.title = title || content;
        return cell;
    };

    const createLinkCell = (url) => {
        const cell = document.createElement('span');
        if (url) {
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.textContent = url;
            link.title = url;
            cell.appendChild(link);
        }
        return cell;
    };

    const checkboxContainer = document.createElement('span');
    checkboxContainer.className = 'checkbox-column';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'row-checkbox';
    checkbox.dataset.index = index;
    checkbox.checked = true;
    checkboxContainer.appendChild(checkbox);

    const mapsLink = document.createElement('a');
    mapsLink.href = data.GoogleMapsURL || '#';
    mapsLink.target = '_blank';
    mapsLink.title = data.GoogleMapsURL || 'View on Google Maps';
    
    const mapsContent = document.createElement('span');
    mapsContent.className = 'maps-link-content';
    const circle = document.createElement('span');
    circle.className = 'maps-status-icon';
    mapsContent.appendChild(circle);
    mapsContent.appendChild(document.createTextNode(' View'));
    mapsLink.appendChild(mapsContent);

    const cells = [
        checkboxContainer,
        createCell(cleanDisplayValue(data.BusinessName)),
        createCell(cleanDisplayValue(data.Category)),
        createCell(cleanDisplayValue(data.StarRating)),
        createCell(cleanDisplayValue(data.ReviewCount)),
        createCell(cleanDisplayValue(data.Suburb)),
        createCell(cleanDisplayValue(data.StreetAddress)),
        createLinkCell(data.Website),
        createCell(cleanDisplayValue(data.OwnerName)),
        createCell(cleanDisplayValue(data.Email1)),
        createCell(cleanDisplayValue(data.Email2)),
        createCell(cleanDisplayValue(data.Email3)),
        createCell(cleanDisplayValue(data.Phone)),
        createLinkCell(data.InstagramURL),
        createLinkCell(data.FacebookURL),
        createCell(mapsLink)
    ];

    cells.forEach(cell => row.appendChild(cell));
    gridBody.appendChild(row);
}

function setUiState(isBusy, elements) {
  const isIndividualSearch =
    elements.businessNamesInput.value.trim().length > 0;

  for (const key in elements) {
    if (!elements.hasOwnProperty(key)) continue;

    if (key === "subCategoryCheckboxContainer") {
      elements[key]
        .querySelectorAll('input[type="checkbox"]')
        .forEach((cb) => (cb.disabled = isBusy));
    } else if (
      key !== "downloadButtons" &&
      key !== "displayedData" &&
      key !== "bulkSearchContainer"
    ) {
      if (elements[key] && typeof elements[key].disabled !== "undefined") {
        elements[key].disabled = isBusy;
      }
    }
  }

  if (!isBusy) {
    elements.countInput.disabled =
      elements.findAllBusinessesCheckbox.checked || isIndividualSearch;
    document
      .querySelectorAll(
        "#bulkSearchContainer input, #bulkSearchContainer select"
      )
      .forEach((el) => {
        el.disabled = isIndividualSearch;
      });
    elements.subCategoryCheckboxContainer
      .querySelectorAll('input[type="checkbox"]')
      .forEach((cb) => (cb.disabled = isIndividualSearch));
  }

  setDownloadButtonStates(
    isBusy,
    elements.downloadButtons,
    elements.displayedData
  );
}

function setDownloadButtonStates(isBusy, buttons, displayedData) {
  const hasData = displayedData.length > 0;
  buttons.fullExcel.disabled = isBusy || !hasData;
  buttons.notifyre.disabled =
    isBusy ||
    !hasData ||
    !displayedData.some((item) => item.Phone && item.Phone.trim() !== "");
  buttons.contacts.disabled =
    isBusy ||
    !hasData ||
    !displayedData.some((item) => item.Email1 && item.Email1.trim() !== "");
}

function logMessage(logEl, message, type = "default") {
  const timestamp = new Date().toLocaleTimeString();
  const formattedMessage = `[${timestamp}] ${message}`;

  const span = document.createElement("span");
  span.textContent = formattedMessage;
  span.className = `log-entry log-${type}`;

  logEl.appendChild(span);
  logEl.appendChild(document.createTextNode("\n"));
  logEl.scrollTop = logEl.scrollHeight;
}

function getColumnWidths(data, headers) {
  if (!data || data.length === 0 || !headers || headers.length === 0) return [];
  const widths = headers.map((header) => ({ wch: String(header).length + 2 }));

  data.forEach((item) => {
    headers.forEach((header, colIndex) => {
      const cellValue = String(item[header] || "");
      const effectiveLength =
        header.includes("URL") && cellValue.length > 50 ? 50 : cellValue.length;
      if (effectiveLength + 2 > widths[colIndex].wch) {
        widths[colIndex].wch = effectiveLength + 2;
      }
    });
  });
  return widths.map((w) => ({ wch: Math.max(w.wch, 10) }));
}

async function downloadExcel(
  data,
  searchParams,
  fileSuffix,
  fileType,
  logEl,
  specificHeaders = null,
  geocoder,
  countryName
) {
  if (data.length === 0) {
    logMessage(logEl, "No data to download for this format!", "error");
    return;
  }

  const createLinkObject = (url) => {
    if (!url || typeof url !== "string" || !url.trim()) return "";
    const formula = `HYPERLINK("${url}", "${url}")`;
    return {
      f: formula,
      v: url,
      s: { font: { color: { rgb: "0563C1" }, underline: true } },
    };
  };

  let exportData;
  let headers;

  if (specificHeaders) {
    exportData = data.map((item) => {
      const row = {};
      specificHeaders.forEach((h) => {
        row[h] =
          h.toLowerCase().includes("url") || h.toLowerCase().includes("website")
            ? createLinkObject(item[h])
            : item[h] || "";
      });
      if (fileSuffix === "emails" && item.Website) {
        row["Website"] = createLinkObject(item.Website);
        if (!specificHeaders.includes("Website"))
          specificHeaders.push("Website");
      }
      return row;
    });
    headers = specificHeaders;
  } else {
    exportData = data.map((item) => ({
      BusinessName: item.BusinessName,
      Category: item.Category,
      "Suburb/Area": item.SuburbArea,
      StreetAddress: item.StreetAddress,
      Website: createLinkObject(item.Website),
      OwnerName: item.OwnerName,
      "Email 1": item.Email1,
      "Email 2": item.Email2,
      "Email 3": item.Email3,
      Phone: item.Phone,
      InstagramURL: createLinkObject(item.InstagramURL),
      FacebookURL: createLinkObject(item.FacebookURL),
      GoogleMapsURL: createLinkObject(item.GoogleMapsURL),
    }));
    headers = Object.keys(exportData[0] || {});
  }

  const ws = XLSX.utils.json_to_sheet(exportData, { header: headers });
  ws["!cols"] = getColumnWidths(exportData, headers);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Business List");

  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const company = "rtrl";

  let categoryString;
  if (searchParams.customCategory) {
    categoryString = searchParams.customCategory.replace(/[\s/&]/g, "_");
  } else if (
    searchParams.subCategory === "multiple_subcategories" &&
    searchParams.subCategoryList &&
    searchParams.subCategoryList.length > 0
  ) {
    categoryString = `${(searchParams.primaryCategory || "").replace(
      /[\s/&]/g,
      "_"
    )}_${searchParams.subCategoryList
      .map((s) => s.replace(/[\s/&]/g, "_"))
      .join("_")}`;
  } else if (searchParams.subCategory) {
    categoryString = `${(searchParams.primaryCategory || "").replace(
      /[\s/&]/g,
      "_"
    )}_${searchParams.subCategory.replace(/[\s/&]/g, "_")}`;
  } else {
    categoryString =
      searchParams.primaryCategory?.replace(/[\s/&]/g, "_") || "businesses";
  }

  let locationString = (searchParams.area || "location")
    .replace(/[\s/,]/g, "_")
    .toLowerCase();

  const fileExtension = fileType === "xlsx" ? "xlsx" : "csv";
  const fullFilename = `${date}_${company}_${categoryString}_${locationString}_${fileSuffix}.${fileExtension}`;

  XLSX.writeFile(wb, fullFilename, {
    bookType: fileExtension,
    cellDates: true,
  });
  logMessage(
    logEl,
    `${data.length} records exported to '${fullFilename}' successfully!`,
    "success"
  );
}
