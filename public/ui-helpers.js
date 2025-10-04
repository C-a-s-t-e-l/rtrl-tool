function populatePrimaryCategories(selectEl, categoriesData, defaultCategory) {
    selectEl.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.textContent = "Select Business Category";
    selectEl.appendChild(defaultOption);

    for (const categoryName in categoriesData) {
        if (categoryName !== "Select Category") {
            const option = document.createElement('option');
            option.value = categoryName;
            option.textContent = categoryName;
            selectEl.appendChild(option);
        }
    }
    selectEl.value = defaultCategory;
}

function populateSubCategories(containerEl, groupEl, selectedCategory, categoriesData) {
    containerEl.innerHTML = '';
    const subCategories = categoriesData[selectedCategory];

    if (subCategories && subCategories.length > 1 && selectedCategory) { 
        groupEl.style.display = 'block';

        const createCheckboxItem = (value, text, isBold = false) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'checkbox-item';
            if (isBold) itemDiv.classList.add('checkbox-item-all');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `subcat-${value.replace(/\s/g, '_')}`;
            checkbox.value = value;

            const label = document.createElement('label');
            label.htmlFor = `subcat-${value.replace(/\s/g, '_')}`;
            label.textContent = text;

            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(label);
            return { itemDiv, checkbox };
        };

        const allSubCategories = subCategories.filter(sc => sc !== 'ALL' && sc !== '');
        if(allSubCategories.length === 0) {
            groupEl.style.display = 'none';
            return;
        }

        const { itemDiv: allDiv, checkbox: allCheckbox } = createCheckboxItem('select_all', 'Select All', true);
        containerEl.appendChild(allDiv);

        const individualCheckboxes = [];

        allSubCategories.forEach(subCat => {
            if (subCat) { 
                const { itemDiv, checkbox } = createCheckboxItem(subCat, subCat);
                individualCheckboxes.push(checkbox);
                containerEl.appendChild(itemDiv);
            }
        });

        allCheckbox.addEventListener('change', () => {
            individualCheckboxes.forEach(cb => {
                cb.checked = allCheckbox.checked;
            });
        });

        individualCheckboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                if (!cb.checked) {
                    allCheckbox.checked = false;
                } else if (individualCheckboxes.every(iCb => iCb.checked)) {
                    allCheckbox.checked = true;
                }
            });
        });

    } else {
        groupEl.style.display = 'none';
    }
}


function renderSuggestions(inputElement, suggestionsContainer, items, displayKey, valueKey, onSelectCallback) {
    suggestionsContainer.innerHTML = '';
    if (items.length === 0 || inputElement.value.trim() === '') {
        suggestionsContainer.style.display = 'none';
        return;
    }

    const ul = document.createElement('ul');
    items.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item[displayKey];
        li.dataset.value = item[valueKey];
        li.dataset.original = JSON.stringify(item);
        li.addEventListener('click', () => {
            onSelectCallback(item);
            suggestionsContainer.style.display = 'none';
        });
        ul.appendChild(li);
    });
    suggestionsContainer.appendChild(ul);
    suggestionsContainer.style.display = 'block';
}

function cleanDisplayValue(text) {
    if (!text) return '';
    let cleaned = String(text).replace(/^[^a-zA-Z0-9\s.,'#\-+/&_]+/u, ''); 
    cleaned = cleaned.replace(/\p{Z}/gu, ' ');
    cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F\uFEFF\n\r]/g, '');
    return cleaned.replace(/\s+/g, ' ').trim();
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
        if (title) {
            cell.title = title;
        }
        return cell;
    };

    const createLinkCell = (url, text, len) => {
        const cell = document.createElement('span');
        if (url) {
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.textContent = (text && text.length > len) ? text.slice(0, len) + '...' : text;
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
    mapsLink.title = data.GoogleMapsURL || '';
    mapsLink.innerHTML = `<i class="fas fa-map-marker-alt"></i> View`;

    const cells = [
        checkboxContainer,
        createCell(cleanDisplayValue(data.BusinessName), cleanDisplayValue(data.BusinessName)),
        createCell(cleanDisplayValue(data.Category), cleanDisplayValue(data.Category)),
        createCell(cleanDisplayValue(data.StarRating), `Rating: ${data.StarRating}`),
        createCell(cleanDisplayValue(data.ReviewCount), `Reviews: ${data.ReviewCount}`),
        createCell(cleanDisplayValue(data.SuburbArea), cleanDisplayValue(data.SuburbArea)),
        createCell(cleanDisplayValue(data.StreetAddress), cleanDisplayValue(data.StreetAddress)),
        createLinkCell(data.Website, cleanDisplayValue(data.Website), 25),
        createCell(cleanDisplayValue(data.OwnerName), cleanDisplayValue(data.OwnerName)),
        createCell(cleanDisplayValue(data.Email1), cleanDisplayValue(data.Email1)),
        createCell(cleanDisplayValue(data.Email2), cleanDisplayValue(data.Email2)),
        createCell(cleanDisplayValue(data.Email3), cleanDisplayValue(data.Email3)),
        createCell(cleanDisplayValue(data.Phone), cleanDisplayValue(data.Phone)),
        createLinkCell(data.InstagramURL, cleanDisplayValue(data.InstagramURL), 20),
        createLinkCell(data.FacebookURL, cleanDisplayValue(data.FacebookURL), 20),
        createCell(mapsLink)
    ];
    
    cells.forEach(cell => row.appendChild(cell));
    gridBody.appendChild(row);
}

function setUiState(isBusy, elements) {
    const isIndividualSearch = elements.businessNamesInput.value.trim().length > 0;
    
    for (const key in elements) {
        if (!elements.hasOwnProperty(key)) continue;

        if (key === 'subCategoryCheckboxContainer') {
            elements[key].querySelectorAll('input[type="checkbox"]').forEach(cb => cb.disabled = isBusy);
        } else if (key !== 'downloadButtons' && key !== 'displayedData' && key !== 'bulkSearchContainer') {
            if (elements[key] && typeof elements[key].disabled !== 'undefined') {
                elements[key].disabled = isBusy;
            }
        }
    }
    
    if (!isBusy) {
        elements.countInput.disabled = elements.findAllBusinessesCheckbox.checked || isIndividualSearch;

        document.getElementById('bulkSearchContainer').querySelectorAll('input, select').forEach(el => {
            if (el.id !== 'countryInput' && el.id !== 'locationInput' && el.id !== 'postalCodeInput') {
                 el.disabled = isIndividualSearch;
            }
        });
        
        elements.subCategoryCheckboxContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.disabled = isIndividualSearch);
    }

    setDownloadButtonStates(isBusy, elements.downloadButtons, elements.displayedData);
}

function setDownloadButtonStates(isBusy, buttons, displayedData) {
    const hasData = displayedData.length > 0;
    buttons.fullExcel.disabled = isBusy || !hasData;
    buttons.notifyre.disabled = isBusy || !hasData || !displayedData.some(item => item.Phone && item.Phone.trim() !== '');
    buttons.contacts.disabled = isBusy || !hasData || !displayedData.some(item => item.Email1 && item.Email1.trim() !== '');
}

function logMessage(logEl, message, type = 'default') {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] ${message}`;
    
    const span = document.createElement('span');
    span.textContent = formattedMessage;
    span.classList.add('log-entry', `log-${type}`);

    logEl.appendChild(span);
    logEl.appendChild(document.createTextNode('\n'));
    logEl.scrollTop = logEl.scrollHeight;
}

function updateProgressBar(progressBarEl, statusIconEl, processed, discovered, added, target) {
    let percentage = 0;
    let isSearchAll = target === -1;

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

    progressBarEl.style.width = `${percentage}%`;
    progressBarEl.textContent = `${Math.round(percentage)}%`;
    
    const isComplete = !isSearchAll ? (added >= target) : (processed === discovered && discovered > 0);

    if (isComplete) {
        statusIconEl.className = 'fas fa-check-circle';
    } else {
        statusIconEl.className = 'fas fa-spinner fa-spin';
    }
}

function getColumnWidths(data, headers) {
    if (!data || data.length === 0 || !headers || headers.length === 0) return [];
    const widths = headers.map(header => ({ wch: String(header).length + 2 }));

    data.forEach(item => {
        headers.forEach((header, colIndex) => {
            const cellValue = String(item[header] || '');
            const effectiveLength = (header.includes('URL') && cellValue.length > 50) ? 50 : cellValue.length;
            if (effectiveLength + 2 > widths[colIndex].wch) {
                widths[colIndex].wch = effectiveLength + 2;
            }
        });
    });
    return widths.map(w => ({ wch: Math.max(w.wch, 10) }));
}


async function downloadExcel(data, searchParams, fileSuffix, fileType, logEl, specificHeaders = null, geocoder, countryName) {
    if (data.length === 0) {
        logMessage(logEl, 'No data to download for this format!', 'error');
        return;
    }

    const createLinkObject = (url) => {
        if (!url || typeof url !== 'string' || !url.trim()) {
            return '';
        }
       
        const formula = `HYPERLINK("${url}", "${url}")`;
        return {
            f: formula, 
            v: url,     
            s: {        
                font: {
                    color: { rgb: "0563C1" },
                    underline: true
                }
            }
        };
    };

    let exportData;
    let headers;

    if (specificHeaders) {
        exportData = data.map(item => {
            const row = {};
            specificHeaders.forEach(h => {
                if (h.toLowerCase().includes('url') || h.toLowerCase().includes('website')) {
                    row[h] = createLinkObject(item[h]);
                } else {
                    row[h] = item[h] || '';
                }
            });
            if (fileSuffix === 'emails' && item.Website) {
                 row['Website'] = createLinkObject(item.Website);
                 if (!specificHeaders.includes('Website')) specificHeaders.push('Website');
            }
            return row;
        });
        headers = specificHeaders;
    } else {
        exportData = data.map(item => ({
            BusinessName: item.BusinessName, Category: item.Category, 'Suburb/Area': item.SuburbArea,
            StreetAddress: item.StreetAddress, Website: createLinkObject(item.Website), OwnerName: item.OwnerName,
            'Email 1': item.Email1, 'Email 2': item.Email2, 'Email 3': item.Email3, 
            Phone: item.Phone, InstagramURL: createLinkObject(item.InstagramURL),
            FacebookURL: createLinkObject(item.FacebookURL), GoogleMapsURL: createLinkObject(item.GoogleMapsURL),
            SourceURLs: [item.GoogleMapsURL, item.Website].filter(Boolean).join(';'),
            LastVerifiedDate: item.LastVerifiedDate, StarRating: item.StarRating, ReviewCount: item.ReviewCount
        }));
        headers = Object.keys(exportData[0] || {});
    }

    const ws = XLSX.utils.json_to_sheet(exportData, { header: headers });
    ws['!cols'] = getColumnWidths(exportData, headers);
    
    for (const cellAddress in ws) {
        if (ws.hasOwnProperty(cellAddress)) {
            const cell = ws[cellAddress];
            if (cell && (cell.l || cell.f)) { 
                cell.t = 's';
            }
        }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Business List");

    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const company = 'rtrl';
    
    const primaryCat = searchParams.primaryCategory?.replace(/[\s/&]/g, "_") || '';
    const subCat = (searchParams.subCategory && searchParams.subCategory !== 'ALL') ? searchParams.subCategory.replace(/[\s/&]/g, "_") : '';
    const customCat = searchParams.customCategory?.replace(/[\s/&]/g, "_") || '';

    let categoryString = customCat || primaryCat;
    if (subCat) { categoryString += `_${subCat}`; }

    let locationString = searchParams.area || 'location';
    if (searchParams.postcodes && searchParams.postcodes.length > 0) {
        try {
            const postcodeToLookup = searchParams.postcodes[0];
            const response = await new Promise((resolve, reject) => {
                geocoder.geocode({ address: `${postcodeToLookup}, ${countryName}` }, (results, status) => {
                    if (status === 'OK' && results[0]) { resolve(results[0]); } 
                    else { reject(new Error(`Geocode failed: ${status}`)); }
                });
            });
            const suburbComponent = response.address_components.find(c => c.types.includes('locality'));
            if (subComponent) { locationString = suburbComponent.long_name.replace(/[\s/]/g, "_").toLowerCase(); }
        } catch (error) {
            console.warn("Could not geocode for filename, using default.", error);
            locationString = searchParams.area;
        }
    }
    
    const fileExtension = fileType === 'xlsx' ? 'xlsx' : 'csv';
    const fullFilename = `${date}_${company}_${categoryString}_${locationString}_${fileSuffix}.${fileExtension}`;

    if (fileExtension === 'csv') {
        XLSX.writeFile(wb, fullFilename, { bookType: 'csv', cellDates: true });
    } else {
        XLSX.writeFile(wb, fullFilename);
    }
    
    logMessage(logEl, `${data.length} records exported to '${fullFilename}' successfully!`, 'success');
}