(function () {
    let savedPostcodeLists = [];

    window.rtrlApp.validateAndAddTag = async (postcode) => {
        const v = postcode.trim();
        const elements = window.rtrlApp.elements;
        const countryInputEl = document.getElementById('countryInput');
        const countryName = countryInputEl ? countryInputEl.value.toLowerCase() : 'australia';
        const isUK = countryName === 'united kingdom';
        const isValidFormat = isUK ? /^[a-z0-9 ]+$/i.test(v) : !isNaN(v);
        if (!v || !isValidFormat || window.rtrlApp.postalCodes.includes(v)) {
            if (elements.postalCodeInput) elements.postalCodeInput.value = "";
            return;
        }
        const iso = window.rtrlApp.countries.find((c) => c.text.toLowerCase() === countryName)?.value;
        if (!iso || !window.rtrlApp.state.googleMapsGeocoder) return;
        window.rtrlApp.state.googleMapsGeocoder.geocode({ componentRestrictions: { country: iso, postalCode: v } }, (res, status) => {
            if (status === google.maps.GeocoderStatus.OK && res[0]) {
                const pcComp = res[0].address_components.find((c) => c.types.includes("postal_code"));
                const validatedCode = pcComp ? pcComp.long_name : null;
                if (validatedCode) {
                    const sub = res[0].address_components.find((c) => c.types.includes("locality"));
                    window.rtrlApp.postalCodes.push(v);
                    const tagEl = document.createElement("span");
                    tagEl.className = "tag";
                    tagEl.innerHTML = `<span>${sub ? sub.long_name + " " : ""}${v}</span> <span class="tag-close-btn" data-value="${v}">&times;</span>`;
                    elements.postalCodeContainer.insertBefore(tagEl, elements.postalCodeInput);
                    elements.postalCodeInput.value = "";
                }
            }
        });
    };

    async function fetchPostcodeLists() {
        const session = window.rtrlApp.session;
        if (!session) return;
        const elements = window.rtrlApp.elements;
        try {
            const response = await fetch(`${window.BACKEND_URL}/api/postcode-lists`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (response.ok) {
                savedPostcodeLists = await response.json();
                elements.postcodeListSelect.innerHTML = '<option value="">Load a saved list...</option>';
                savedPostcodeLists.forEach((list) => {
                    const option = document.createElement("option");
                    option.value = list.id;
                    option.textContent = list.list_name;
                    elements.postcodeListSelect.appendChild(option);
                });
            }
        } catch (e) { }
    }

    function setupPostcodeListHandlers() {
        const elements = window.rtrlApp.elements;
        if (!elements.postcodeListSelect) return;
        elements.postcodeListSelect.addEventListener("change", () => {
            const sl = savedPostcodeLists.find((list) => list.id == elements.postcodeListSelect.value);
            window.rtrlApp.postalCodes.length = 0;
            elements.postalCodeContainer.querySelectorAll(".tag").forEach((tag) => tag.remove());
            if (sl) {
                sl.postcodes.forEach((pc) => window.rtrlApp.validateAndAddTag(pc));
                elements.deletePostcodeListButton.style.display = "inline-flex";
            } else {
                elements.deletePostcodeListButton.style.display = "none";
            }
        });
        new MutationObserver(() => {
            elements.savePostcodeListButton.disabled = elements.postalCodeContainer.querySelector(".tag") === null;
        }).observe(elements.postalCodeContainer, { childList: true });
        elements.savePostcodeListButton.addEventListener("click", async () => {
            const listName = prompt("Name this list:", "");
            if (!listName || !window.rtrlApp.session) return;
            const response = await fetch(`${window.BACKEND_URL}/api/postcode-lists`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.rtrlApp.session.access_token}` },
                body: JSON.stringify({ list_name: listName.trim(), postcodes: window.rtrlApp.postalCodes }),
            });
            if (response.status === 201) fetchPostcodeLists();
        });
        elements.deletePostcodeListButton.addEventListener("click", async () => {
            if (elements.postcodeListSelect.value && window.rtrlApp.session && confirm("Delete?")) {
                const response = await fetch(`${window.BACKEND_URL}/api/postcode-lists/${elements.postcodeListSelect.value}`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${window.rtrlApp.session.access_token}` },
                });
                if (response.ok) fetchPostcodeLists();
            }
        });
    }

    window.rtrlApp.startResearch = () => {
        const session = window.rtrlApp.session;
        if (!session) return;
        const elements = window.rtrlApp.elements;
        document.querySelectorAll(".collapsible-section").forEach(s => { s.style.borderColor = ""; s.style.boxShadow = ""; });
        const errorModal = document.getElementById("alert-modal");
        const errorText = document.getElementById("alert-modal-message");
        const businessNamesRaw = elements.businessNamesInput.value.trim();
        const businessNamesArr = businessNamesRaw.split("\n").map((n) => n.trim()).filter(Boolean);
        const hasCustomKeywords = window.rtrlApp.customKeywords.length > 0;
        const activeSelections = window.rtrlApp.categories.getActiveSelections();
        const hasTieredSelection = activeSelections.length > 0;
        const hasBusinessDef = businessNamesArr.length > 0 || hasCustomKeywords || hasTieredSelection;
        const hasLocationText = elements.locationInput.value.trim().length > 0;
        const hasPostcodes = window.rtrlApp.postalCodes.length > 0;
        const hasRadiusAnchors = window.rtrlApp.state.anchors.length > 0;
        const hasLocationDef = hasLocationText || hasPostcodes || hasRadiusAnchors;
        const expandAndHighlight = (elementId) => {
            const content = document.getElementById(elementId);
            if (content && content.classList.contains("collapsed")) {
                content.classList.remove("collapsed");
                const icon = content.previousElementSibling.querySelector(".toggle-icon");
                if (icon) icon.classList.add("open");
                if (elementId === "radiusSearchContainer" && window.rtrlApp.map) {
                    setTimeout(() => window.rtrlApp.map.invalidateSize(), 300);
                }
            }
            const section = content.closest(".collapsible-section");
            section.style.borderColor = "#ef4444";
            section.style.boxShadow = "0 0 0 1px #ef4444";
        };
        if (!hasBusinessDef && !hasLocationDef) { errorText.innerHTML = "You haven't defined <b>what</b> to search for or <b>where</b> to search. Please complete the highlighted sections."; expandAndHighlight("bulkSearchContainer"); expandAndHighlight("locationSearchContainer"); expandAndHighlight("radiusSearchContainer"); errorModal.style.display = "flex"; return; }
        if (!hasBusinessDef) { errorText.innerHTML = "Please specify a <b>Category</b> or enter <b>Business Names</b> so the system knows what to look for."; expandAndHighlight("bulkSearchContainer"); expandAndHighlight("individualSearchContainer"); errorModal.style.display = "flex"; return; }
        if (!hasLocationDef) { errorText.innerHTML = "The system needs a <b>Location</b>. Please provide a Suburb or define a Search Radius."; expandAndHighlight("locationSearchContainer"); expandAndHighlight("radiusSearchContainer"); errorModal.style.display = "flex"; return; }

        let finalLoopList = [];
        const modifier = elements.categoryModifierInput.value.trim();
        if (businessNamesArr.length > 0) {
            finalLoopList = businessNamesArr;
        } else if (hasCustomKeywords) {
            finalLoopList = window.rtrlApp.customKeywords;
        } else {
            activeSelections.forEach(sel => {
                sel.terms.forEach(term => { finalLoopList.push(modifier ? `"${modifier}" ${term}` : term); });
            });
        }

        const localToday = new Date();
        const multiPoints = window.rtrlApp.state.anchors.map(a => ({ coords: `${a.lat},${a.lng}`, radius: a.radius, name: a.name }));
        const p = {
            country: elements.countryInput.value,
            businessNames: businessNamesArr,
            userEmail: elements.userEmailInput.value.trim(),
            exclusionList: window.rtrlApp.exclusionFeature.getExclusionList(),
            useAiEnrichment: elements.useAiToggle.checked,
            categoriesToLoop: finalLoopList,
            count: elements.findAllBusinessesCheckbox.checked || !elements.countInput.value.trim() ? -1 : parseInt(elements.countInput.value, 10),
        };

        if (multiPoints.length > 0) { p.multiRadiusPoints = multiPoints; p.anchorPoint = null; }
        else { p.location = elements.locationInput.value.trim(); p.postalCode = window.rtrlApp.postalCodes; }

        let areaKey = "";
        if (window.rtrlApp.state.anchors.length > 0) {
            areaKey = window.rtrlApp.state.anchors.map(a => `${a.name.split(',')[0].trim()} (${a.radius}km)`).join(', ');
            const activeId = window.rtrlApp.state.activeLocationId;
            const locationObj = window.rtrlApp.state.locations.find(l => l.id === activeId);
            if (locationObj) areaKey = `${locationObj.name}: ${areaKey}`;
        } else if (window.rtrlApp.postalCodes.length > 0) {
            areaKey = `Postcodes: ${window.rtrlApp.postalCodes.join(", ")}`;
        } else {
            areaKey = elements.locationInput.value.split(",")[0];
        }
        if (areaKey.length > 100) areaKey = areaKey.substring(0, 97) + "...";

        const selectedIndustry = window.rtrlApp.categories.getSelectedIndustry();
        p.searchParamsForEmail = {
            primaryCategory: selectedIndustry || "Custom Search",
            subCategory: activeSelections.length > 1 ? "multiple_categories" : (activeSelections[0]?.label || ""),
            subCategoryList: activeSelections.map(s => s.label),
            customCategory: window.rtrlApp.customKeywords.length > 0 ? window.rtrlApp.customKeywords.join(", ") : modifier,
            area: areaKey,
            postcodes: window.rtrlApp.postalCodes,
            country: elements.countryInput.value,
        };

        window.rtrlApp.socket.emit("start_scrape_job", {
            authToken: session.access_token,
            clientLocalDate: `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, "0")}-${String(localToday.getDate()).padStart(2, "0")}`,
            ...p,
        });

        const originalText = elements.startButton.innerHTML;
        elements.startButton.innerHTML = '<i class="fas fa-check"></i> Added to Queue!';
        elements.startButton.style.backgroundColor = "#10b981";
        elements.startButton.disabled = true;
        setTimeout(() => {
            elements.locationInput.value = "";
            elements.startButton.innerHTML = originalText;
            elements.startButton.style.backgroundColor = "";
            elements.startButton.disabled = false;
            elements.locationInput.value = "";
            if (typeof window.rtrlApp.clearAllPins === 'function') window.rtrlApp.clearAllPins();
            elements.businessNamesInput.value = "";
            window.rtrlApp.postalCodes = [];
            window.rtrlApp.customKeywords = [];
            window.rtrlApp.categories.clearAndRender();
            document.querySelectorAll(".tag").forEach(t => t.remove());
            if (typeof window.rtrlApp.setRadiusInputsState === 'function') window.rtrlApp.setRadiusInputsState(false);
        }, 2000);
    };

    window.rtrlApp.cloneJobIntoForm = (p) => {
        window.rtrlApp.state.activeLocationId = null;
        window.rtrlApp.state.isDirty = false;
        const el = {
            customCat: document.getElementById("customCategoryInput"),
            location: document.getElementById("locationInput"),
            country: document.getElementById("countryInput"),
            count: document.getElementById("count"),
            findAll: document.getElementById("findAllBusinesses"),
            names: document.getElementById("businessNamesInput"),
            aiToggle: document.getElementById("useAiToggle"),
        };
        if (window.rtrlApp.state.anchors && window.rtrlApp.state.anchors.length > 0) {
            window.rtrlApp.state.anchors.forEach(a => {
                if (a.marker) window.rtrlApp.map.removeLayer(a.marker);
                if (a.circle) window.rtrlApp.map.removeLayer(a.circle);
            });
        }
        window.rtrlApp.state.anchors = [];
        window.rtrlApp.postalCodes.length = 0;
        window.rtrlApp.customKeywords.length = 0;
        if (el.location) el.location.value = "";
        if (el.names) el.names.value = "";
        document.querySelectorAll(".tag").forEach((t) => t.remove());
        if (window.rtrlApp.renderZoneList) window.rtrlApp.renderZoneList();
        if (window.rtrlApp.updateMapPreviewText) window.rtrlApp.updateMapPreviewText();
        if (el.aiToggle) el.aiToggle.checked = p.useAiEnrichment !== false;
        if (el.country) el.country.value = p.country || "Australia";
        if (p.count === -1) {
            if (el.findAll) el.findAll.checked = true;
            if (el.count) { el.count.value = ""; el.count.disabled = true; }
        } else {
            if (el.findAll) el.findAll.checked = false;
            if (el.count) { el.count.value = p.count || ""; el.count.disabled = false; }
        }
        if (p.businessNames?.length > 0) {
            if (el.names) el.names.value = p.businessNames.join("\n");
            const indContainer = document.getElementById("individualSearchContainer");
            if (indContainer) indContainer.classList.remove("collapsed");
        } else if (p.categoriesToLoop) {
            p.categoriesToLoop.forEach((kw) => {
                window.rtrlApp.customKeywords.push(kw);
                const t = document.createElement("span");
                t.className = "tag";
                t.innerHTML = `<span>${kw}</span> <span class="tag-close-btn" data-value="${kw}">&times;</span>`;
                const kwContainer = document.getElementById("customKeywordContainer");
                if (kwContainer && el.customCat) kwContainer.insertBefore(t, el.customCat);
            });
        }
        if (p.multiRadiusPoints && p.multiRadiusPoints.length > 0) {
            p.multiRadiusPoints.forEach((point, i) => {
                const co = point.coords.split(",");
                const latlng = { lat: parseFloat(co[0]), lng: parseFloat(co[1]) };
                window.rtrlApp.addAnchor(latlng, point.name || `Zone ${i + 1}`, point.radius);
            });
            const radContainer = document.getElementById("radiusSearchContainer");
            if (radContainer) {
                radContainer.classList.remove("collapsed");
                const icon = radContainer.previousElementSibling.querySelector(".toggle-icon");
                if (icon) icon.classList.add("open");
            }
        } else if (p.radiusKm && p.anchorPoint) {
            const co = p.anchorPoint.split(",");
            if (co.length === 2) {
                const latlng = { lat: parseFloat(co[0]), lng: parseFloat(co[1]) };
                window.rtrlApp.addAnchor(latlng, p.searchParamsForEmail?.area || "Search Area", p.radiusKm);
                const radContainer = document.getElementById("radiusSearchContainer");
                if (radContainer) radContainer.classList.remove("collapsed");
            }
        } else {
            if (el.location) el.location.value = p.location || "";
            if (p.postalCode) p.postalCode.forEach((pc) => window.rtrlApp.validateAndAddTag(pc));
            const locContainer = document.getElementById("locationSearchContainer");
            if (locContainer) {
                locContainer.classList.remove("collapsed");
                const icon = locContainer.previousElementSibling.querySelector(".toggle-icon");
                if (icon) icon.classList.add("open");
            }
        }
        if (window.rtrlApp.renderZoneList) window.rtrlApp.renderZoneList();
        if (window.rtrlApp.updateMapPreviewText) window.rtrlApp.updateMapPreviewText();
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    window.rtrlApp.search = {
        fetchPostcodeLists,
        setupPostcodeListHandlers,
    };
})();
