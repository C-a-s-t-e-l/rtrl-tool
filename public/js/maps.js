(function () {
    // --- TOAST & MODALS ---

    window.rtrlApp.showToast = (msg, type = 'success') => {
        const toast = document.createElement('div');
        toast.className = `rtrl-toast toast-${type}`;
        toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i><span>${msg}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('visible'), 100);
        setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, 3000);
    };

    window.rtrlApp.promptLocationName = (currentName = "") => {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'rtrl-modal-overlay';
            modal.innerHTML = `
                <div class="rtrl-modal-window">
                    <h3><i class="fas fa-map-marker-alt"></i> Save Search Location</h3>
                    <p>Give this collection of pins a name for future searches.</p>
                    <input type="text" id="loc-name-input" placeholder="e.g. Albury_Wodonga" value="${currentName}">
                    <div class="rtrl-modal-actions">
                        <button class="btn btn-secondary" id="modal-cancel-btn" style="margin:0">Cancel</button>
                        <button class="btn btn-primary" id="modal-save-btn" style="margin:0; width:auto; padding: 0.65rem 1.5rem;">Save Location</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            const input = modal.querySelector('#loc-name-input');
            input.focus();
            modal.querySelector('#modal-cancel-btn').onclick = () => { modal.remove(); resolve(null); };
            modal.querySelector('#modal-save-btn').onclick = () => { const val = input.value.trim(); modal.remove(); resolve(val || null); };
        });
    };

    window.rtrlApp.confirmDiscard = () => {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'rtrl-modal-overlay';
            modal.style.zIndex = "110002";
            modal.innerHTML = `
                <div class="rtrl-modal-window" style="text-align:center;">
                    <div style="color: #ef4444; font-size: 2rem; margin-bottom: 1rem;"><i class="fas fa-exclamation-triangle"></i></div>
                    <h3>Unsaved Changes</h3>
                    <p>You have unsaved modifications to this location. Are you sure you want to discard them?</p>
                    <div class="rtrl-modal-actions" style="justify-content: center; margin-top: 20px;">
                        <button class="btn btn-secondary" id="discard-no" style="margin:0">Keep Editing</button>
                        <button class="btn btn-primary" id="discard-yes" style="margin:0; width:auto; background:#ef4444;">Discard Changes</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#discard-no').onclick = () => { modal.remove(); resolve(false); };
            modal.querySelector('#discard-yes').onclick = () => { modal.remove(); resolve(true); };
        });
    };

    window.rtrlApp.confirmDelete = (name) => {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'rtrl-modal-overlay';
            modal.style.zIndex = "110003";
            modal.innerHTML = `
                <div class="rtrl-modal-window" style="text-align:center;">
                    <div style="color: #ef4444; font-size: 2rem; margin-bottom: 1rem;"><i class="fas fa-trash-alt"></i></div>
                    <h3>Delete Location?</h3>
                    <p>Are you sure you want to permanently delete <b>"${name}"</b>? This action cannot be undone.</p>
                    <div class="rtrl-modal-actions" style="justify-content: center; margin-top: 20px;">
                        <button class="btn btn-secondary" id="delete-no" style="margin:0">Cancel</button>
                        <button class="btn btn-primary" id="delete-yes" style="margin:0; width:auto; background:#ef4444;">Delete Permanently</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#delete-no').onclick = () => { modal.remove(); resolve(false); };
            modal.querySelector('#delete-yes').onclick = () => { modal.remove(); resolve(true); };
        });
    };

    // --- LOCATION LOGIC ---

    window.rtrlApp.setLocationDirty = (val) => {
        window.rtrlApp.state.isDirty = val;
        renderZoneList();
    };

    window.rtrlApp.fetchLocations = async () => {
        const session = window.rtrlApp.session;
        if (!session) return;
        try {
            const response = await fetch(`${window.BACKEND_URL}/api/territories`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (response.ok) {
                window.rtrlApp.state.locations = await response.json();
                renderZoneList();
            }
        } catch (e) { console.error(e); }
    };

    window.rtrlApp.loadLocation = async (id) => {
        if (window.rtrlApp.state.isDirty) {
            const confirmed = await window.rtrlApp.confirmDiscard();
            if (!confirmed) { renderZoneList(); return; }
        }
        const loc = window.rtrlApp.state.locations.find(l => l.id === id);
        if (!loc) return;
        window.rtrlApp.state.anchors.forEach(a => {
            if (a.marker) window.rtrlApp.map.removeLayer(a.marker);
            if (a.circle) window.rtrlApp.map.removeLayer(a.circle);
        });
        window.rtrlApp.state.anchors = [];
        loc.zone_data.forEach(z => {
            window.rtrlApp.addAnchor({ lat: z.lat, lng: z.lng }, z.name, z.radius, Date.now() + Math.random());
        });
        window.rtrlApp.state.activeLocationId = id;
        window.rtrlApp.state.isDirty = false;
        renderZoneList();
        window.rtrlApp.showToast(`Loaded: ${loc.name}`);
    };

    window.rtrlApp.saveLocation = async (isUpdate = false) => {
        if (window.rtrlApp.state.anchors.length === 0) return window.rtrlApp.showToast("Add some pins first!", "error");
        let name = "";
        if (isUpdate && window.rtrlApp.state.activeLocationId) {
            name = window.rtrlApp.state.locations.find(l => l.id === window.rtrlApp.state.activeLocationId).name;
        } else {
            name = await window.rtrlApp.promptLocationName();
            if (!name) return;
        }
        const session = window.rtrlApp.session;
        const zoneData = window.rtrlApp.state.anchors.map(a => ({ lat: a.lat, lng: a.lng, radius: a.radius, name: a.name }));
        const method = isUpdate ? 'PUT' : 'POST';
        const url = isUpdate
            ? `${window.BACKEND_URL}/api/territories/${window.rtrlApp.state.activeLocationId}`
            : `${window.BACKEND_URL}/api/territories`;
        try {
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ name, zone_data: zoneData }),
            });
            if (res.ok) {
                const result = await res.json();
                if (!isUpdate) window.rtrlApp.state.activeLocationId = result.id;
                window.rtrlApp.state.isDirty = false;
                await window.rtrlApp.fetchLocations();
                window.rtrlApp.showToast(isUpdate ? "Location updated" : "Location saved");
            }
        } catch (e) { window.rtrlApp.showToast("Server error", "error"); }
    };

    window.rtrlApp.deleteLocation = async (id) => {
        const loc = window.rtrlApp.state.locations.find(l => l.id === id);
        if (!loc) return;
        const confirmed = await window.rtrlApp.confirmDelete(loc.name);
        if (!confirmed) return;
        const session = window.rtrlApp.session;
        try {
            const res = await fetch(`${window.BACKEND_URL}/api/territories/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (res.ok) {
                if (window.rtrlApp.state.activeLocationId === id) window.rtrlApp.clearAllPins();
                await window.rtrlApp.fetchLocations();
                window.rtrlApp.showToast("Location deleted permanently");
            }
        } catch (e) { window.rtrlApp.showToast("Failed to delete", "error"); }
    };

    // --- MAP DISPLAY ---

    function renderZoneList() {
        const list = document.getElementById('zone-list');
        if (!list) return;
        const activeId = window.rtrlApp.state.activeLocationId;
        const isDirty = window.rtrlApp.state.isDirty;
        const activeLoc = window.rtrlApp.state.locations.find(l => l.id === activeId);
        let statusClass = "state-draft", statusLabel = "New Search Layout", statusIcon = "fa-pencil-ruler";
        if (activeId) {
            statusClass = isDirty ? "state-modified" : "state-synced";
            statusLabel = isDirty ? `${activeLoc.name}* (Modified)` : activeLoc.name;
            statusIcon = isDirty ? "fa-sync-alt" : "fa-check-circle";
        }
        list.innerHTML = `
            <div class="loc-manager-header ${statusClass}">
                <div class="loc-status-row">
                    <i class="fas ${statusIcon} ${isDirty && activeId ? 'fa-spin' : ''}"></i>
                    <span class="loc-name-display">${statusLabel}</span>
                    ${activeId || window.rtrlApp.state.anchors.length > 0 ? `<button onclick="window.rtrlApp.clearAllPins()" class="btn-unload" title="Clear Map">&times;</button>` : ''}
                </div>
                <div class="loc-controls">
                    <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                        <select id="location-preset-dropdown" class="loc-select" style="margin-bottom:0; flex:1;">
                            <option value="">-- Load Saved Location --</option>
                            ${window.rtrlApp.state.locations.map(l => `<option value="${l.id}" ${activeId === l.id ? 'selected' : ''}>${l.name}</option>`).join('')}
                        </select>
                        ${activeId ? `
                            <button onclick="window.rtrlApp.deleteLocation('${activeId}')" class="zone-delete-btn" style="height: 34px; width: 34px; background: #fee2e2; border-radius: 6px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#ef4444; border:none; cursor:pointer;" title="Delete Preset Permanently">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        ` : ''}
                    </div>
                    <div class="loc-action-btns" style="display:flex; gap:8px;">
                        <button onclick="window.rtrlApp.saveLocation(false)" class="btn-save-new" style="flex:1">Save New</button>
                        ${activeId && isDirty ? `<button onclick="window.rtrlApp.saveLocation(true)" class="btn-update" style="flex:1">Update '${activeLoc.name}'</button>` : ''}
                    </div>
                </div>
            </div>`;
        setTimeout(() => {
            const sel = document.getElementById('location-preset-dropdown');
            if (sel) sel.onchange = (e) => { if (e.target.value) window.rtrlApp.loadLocation(e.target.value); };
        }, 0);
        window.rtrlApp.state.anchors.forEach(a => {
            const card = document.createElement('div');
            card.className = "zone-card";
            card.innerHTML = `
                <div class="zone-card-header">
                    <span class="zone-card-title">${a.name}</span>
                    <button class="zone-delete-btn" onclick="window.rtrlApp.deleteZone('${a.id}')"><i class="fas fa-trash-alt"></i></button>
                </div>
                <div class="zone-slider-container">
                    <input type="range" class="zone-slider-input" min="1" max="25" value="${a.radius}" oninput="window.rtrlApp.updateRadius('${a.id}', this.value)">
                    <span class="zone-radius-display">${a.radius}km</span>
                </div>`;
            list.appendChild(card);
        });
        updateMapPreviewText();
    }

    function updateMapPreviewText() {
        const txt = document.getElementById('map-preview-text');
        if (!txt) return;
        const activeId = window.rtrlApp.state.activeLocationId;
        const location = window.rtrlApp.state.locations.find(l => l.id === activeId);
        if (location) {
            txt.innerHTML = `Target Area: <strong style="color: #3b82f6;">${location.name}</strong> (${window.rtrlApp.state.anchors.length} zones active).`;
        } else {
            txt.textContent = `${window.rtrlApp.state.anchors.length} active search zone(s) defined.`;
        }
    }

    window.rtrlApp.updateRadius = (id, val) => {
        const a = window.rtrlApp.state.anchors.find(x => x.id == id);
        if (a) { a.radius = parseInt(val); a.circle.setRadius(a.radius * 1000); window.rtrlApp.setLocationDirty(true); }
    };

    window.rtrlApp.deleteZone = (id) => {
        const a = window.rtrlApp.state.anchors.find(x => x.id == id);
        if (a) {
            window.rtrlApp.map.removeLayer(a.marker);
            window.rtrlApp.map.removeLayer(a.circle);
            window.rtrlApp.state.anchors = window.rtrlApp.state.anchors.filter(x => x.id != id);
            window.rtrlApp.setLocationDirty(true);
        }
    };

    window.rtrlApp.clearAllPins = () => {
        window.rtrlApp.state.anchors.forEach(a => {
            if (a.marker) window.rtrlApp.map.removeLayer(a.marker);
            if (a.circle) window.rtrlApp.map.removeLayer(a.circle);
        });
        window.rtrlApp.state.anchors = [];
        window.rtrlApp.state.activeLocationId = null;
        window.rtrlApp.state.isDirty = false;
        renderZoneList();
    };

    window.rtrlApp.renderZoneList = renderZoneList;
    window.rtrlApp.updateMapPreviewText = updateMapPreviewText;

    // --- MAP WORKSPACE TOGGLE ---

    function toggleMapWorkspace(open) {
        const elements = window.rtrlApp.elements;
        if (open) {
            elements.mapModal.style.display = 'flex';
            elements.bigMapContainer.appendChild(elements.mapElement);
            setTimeout(() => {
                if (window.rtrlApp.map) {
                    window.rtrlApp.map.invalidateSize();
                    if (window.rtrlApp.state.anchors.length > 0) {
                        const group = new L.featureGroup(window.rtrlApp.state.anchors.map(a => a.circle));
                        window.rtrlApp.map.fitBounds(group.getBounds().pad(0.1));
                    }
                }
            }, 150);
        } else {
            elements.mapModal.style.display = 'none';
            elements.smallMapContainer.appendChild(elements.mapElement);
            setTimeout(() => {
                if (window.rtrlApp.map) {
                    window.rtrlApp.map.invalidateSize(true);
                    if (window.rtrlApp.state.anchors.length > 0) {
                        const group = new L.featureGroup(window.rtrlApp.state.anchors.map(a => a.circle));
                        window.rtrlApp.map.fitBounds(group.getBounds().pad(0.1));
                    } else {
                        window.rtrlApp.map.setView([-33.8688, 151.2093], 10);
                    }
                }
                updateMapPreviewText();
            }, 200);
        }
    }

    // --- LOCATION / RADIUS INPUT STATE ---

    window.rtrlApp.setLocationInputsState = (d) => {
        const elements = window.rtrlApp.elements;
        elements.locationInput.disabled = d;
        elements.postalCodeInput.disabled = d;
        if (d) {
            elements.locationInput.value = "";
            window.rtrlApp.postalCodes.length = 0;
            elements.postalCodeContainer.querySelectorAll(".tag").forEach((tag) => tag.remove());
        }
    };

    window.rtrlApp.setRadiusInputsState = (d) => {
        const elements = window.rtrlApp.elements;
        if (elements.btnOpenMapWorkspace) elements.btnOpenMapWorkspace.disabled = d;
        if (d) {
            window.rtrlApp.state.anchors.forEach(a => {
                if (window.rtrlApp.map && a.marker && a.circle) {
                    window.rtrlApp.map.removeLayer(a.marker);
                    window.rtrlApp.map.removeLayer(a.circle);
                }
            });
            window.rtrlApp.state.anchors = [];
            window.rtrlApp.state.activeLocationId = null;
            updateMapPreviewText();
            renderZoneList();
        }
    };

    // --- GOOGLE MAPS SERVICES ---

    window.rtrlApp.initializeMapServices = () => {
        if (window.google?.maps?.places) {
            window.rtrlApp.state.googleMapsService = new google.maps.places.AutocompleteService();
            window.rtrlApp.state.googleMapsGeocoder = new google.maps.Geocoder();
        }
    };

    window.rtrlApp.fetchPlaceSuggestions = (el, sel, t, onSelect) => {
        const elements = window.rtrlApp.elements;
        if (!window.rtrlApp.state.googleMapsService || el.value.trim().length < 2) return (sel.style.display = "none");
        const iso = window.rtrlApp.countries.find((c) => c.text.toLowerCase() === elements.countryInput.value.toLowerCase())?.value;
        const req = { input: el.value, types: t };
        if (iso) req.componentRestrictions = { country: iso };
        window.rtrlApp.state.googleMapsService.getPlacePredictions(req, (p, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && p) {
                renderSuggestions(el, sel, p.map((x) => ({ description: x.description, place_id: x.place_id })), "description", "place_id", onSelect);
            } else {
                sel.style.display = "none";
            }
        });
    };

    function getPlaceDetails(placeId) {
        return new Promise((resolve, reject) => {
            if (!window.rtrlApp.state.googleMapsGeocoder) return reject();
            window.rtrlApp.state.googleMapsGeocoder.geocode({ placeId }, (results, status) => {
                if (status === google.maps.GeocoderStatus.OK && results[0]) resolve(results[0]);
                else reject();
            });
        });
    }

    window.rtrlApp.handleLocationSelection = async (item) => {
        const elements = window.rtrlApp.elements;
        try {
            const details = await getPlaceDetails(item.place_id);
            const countryName = (details.address_components.find((c) => c.types.includes("country")) || {}).long_name || "";
            if (countryName) elements.countryInput.value = countryName;
            elements.locationInput.value = item.description;
        } catch (error) {
            elements.locationInput.value = item.description.split(",")[0];
        }
    };

    window.rtrlApp.handleAnchorPointSelection = async (item) => {
        const details = await new Promise((resolve, reject) => {
            window.rtrlApp.state.googleMapsGeocoder.geocode({ placeId: item.place_id }, (results, status) => {
                if (status === "OK" && results[0]) resolve(results[0]);
                else reject();
            });
        });
        const { lat, lng } = details.geometry.location;
        window.rtrlApp.addAnchor({ lat: lat(), lng: lng() }, item.description.split(',')[0]);
        const wsInput = document.getElementById('workspace-search-input');
        if (wsInput) wsInput.value = '';
        const elements = window.rtrlApp.elements;
        if (elements.mapModal && elements.mapModal.style.display !== 'flex') toggleMapWorkspace(true);
    };

    window.rtrlApp.handlePostalCodeSelection = async (item) => {
        try {
            const details = await getPlaceDetails(item.place_id);
            const pc = details.address_components.find((c) => c.types.includes("postal_code"));
            if (pc) {
                await window.rtrlApp.validateAndAddTag(pc.long_name);
                window.rtrlApp.elements.postalCodeInput.value = "";
            }
        } catch (error) { }
    };

    // --- LEAFLET MAP + ANCHOR ---

    window.rtrlApp.addAnchor = function (latlng, name, savedRadius = 3, savedId = null) {
        const id = savedId || Date.now();
        const radius = parseFloat(savedRadius);
        const marker = L.marker(latlng, { draggable: true }).addTo(window.rtrlApp.map);
        const circle = L.circle(latlng, { radius: radius * 1000, color: "#3b82f6", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.15 }).addTo(window.rtrlApp.map);
        const anchor = { id, marker, circle, radius, name, lat: latlng.lat, lng: latlng.lng };
        window.rtrlApp.state.anchors.push(anchor);
        marker.on('drag', (e) => { const pos = e.target.getLatLng(); circle.setLatLng(pos); anchor.lat = pos.lat; anchor.lng = pos.lng; });
        marker.on('dragend', async (e) => {
            const pos = e.target.getLatLng();
            if (window.rtrlApp.state.googleMapsGeocoder) {
                try {
                    const results = await new Promise((resolve, reject) => {
                        window.rtrlApp.state.googleMapsGeocoder.geocode({ location: pos }, (res, status) => {
                            if (status === "OK" && res[0]) resolve(res);
                            else reject(status);
                        });
                    });
                    const locality = results[0].address_components.find(c => c.types.includes("locality"));
                    anchor.name = locality ? locality.long_name : results[0].formatted_address.split(',')[0];
                } catch (err) { }
            }
            window.rtrlApp.setLocationDirty(true);
        });
        renderZoneList();
        if (window.rtrlApp.state.anchors.length === 1 && !savedId) {
            window.rtrlApp.map.setView(latlng, 12);
        } else if (!savedId) {
            const group = new L.featureGroup(window.rtrlApp.state.anchors.map(a => a.circle));
            window.rtrlApp.map.fitBounds(group.getBounds().pad(0.1));
        }
        if (!savedId) window.rtrlApp.setLocationDirty(true);
    };

    if (document.getElementById("map")) {
        window.rtrlApp.map = L.map("map").setView([-33.8688, 151.2093], 10);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" }).addTo(window.rtrlApp.map);
        window.rtrlApp.map.on('click', async function (e) {
            const elements = window.rtrlApp.elements;
            if (elements && elements.mapModal && elements.mapModal.style.display === 'flex') {
                let name = `Zone ${window.rtrlApp.state.anchors.length + 1}`;
                if (window.rtrlApp.state.googleMapsGeocoder) {
                    try {
                        const results = await new Promise((resolve, reject) => {
                            window.rtrlApp.state.googleMapsGeocoder.geocode({ location: e.latlng }, (res, status) => {
                                if (status === "OK" && res[0]) resolve(res);
                                else reject(status);
                            });
                        });
                        const locality = results[0].address_components.find(c => c.types.includes("locality"));
                        name = locality ? locality.long_name : results[0].formatted_address.split(',')[0];
                    } catch (err) { }
                }
                window.rtrlApp.addAnchor(e.latlng, name);
            }
        });
    }

    // --- MAP WORKSPACE BUTTONS & SEARCH (DOM is ready at this point) ---

    const btnOpen = document.getElementById('btn-open-map-workspace');
    const btnClose = document.getElementById('btn-close-map-workspace');
    if (btnOpen) btnOpen.onclick = (e) => { e.preventDefault(); toggleMapWorkspace(true); };
    if (btnClose) btnClose.onclick = (e) => { e.preventDefault(); toggleMapWorkspace(false); };

    const wsInput = document.getElementById('workspace-search-input');
    if (wsInput) {
        wsInput.addEventListener('input', () => {
            clearTimeout(window.rtrlApp.timers.workspace);
            window.rtrlApp.timers.workspace = setTimeout(() => {
                window.rtrlApp.fetchPlaceSuggestions(
                    wsInput,
                    document.getElementById('workspace-suggestions'),
                    ["geocode"],
                    window.rtrlApp.handleAnchorPointSelection
                );
            }, 300);
        });
    }
})();
