window.rtrlApp = window.rtrlApp || {};

window.rtrlApp.searchManager = (function () {
  const countries = [
    { value: "AU", text: "Australia" },
    { value: "NZ", text: "New Zealand" },
    { value: "US", text: "United States" },
    { value: "GB", text: "United Kingdom" },
    { value: "CA", text: "Canada" },
    { value: "PH", text: "Philippines" },
  ];

  const categories = {
    "Select Category": [],
    "Alterations and tailoring": [],
    "Baby and nursery": [
      "ALL",
      "Baby and infant toys",
      "Baby bedding",
      "Nursery furniture",
      "Prams, strollers and carriers",
      "Tableware and feeding",
    ],
    Banks: [],
    "Beauty and wellness": [
      "ALL",
      "Bath and body",
      "Fragrance",
      "Hair and beauty",
      "Hair care",
      "Makeup",
      "Skincare",
      "Vitamins and supplements",
    ],
    "Books, stationery and gifts": [
      "ALL",
      "Book stores",
      "Cards and gift wrap",
      "Newsagencies",
      "Office supplies",
      "Stationery",
    ],
    "Car and auto": [],
    Childcare: [],
    "Clothing and accessories": [
      "ALL",
      "Babies' and toddlers'",
      "Footwear",
      "Jewellery and watches",
      "Kids' and junior",
      "Men's fashion",
      "Sunglasses",
      "Women's fashion",
    ],
    "Community services": [],
    "Department stores": [],
    "Designer and boutique": [],
    "Discount and variety": [],
    "Dry cleaning": [],
    "Electronics and technology": [
      "ALL",
      "Cameras",
      "Computers and tablets",
      "Gaming and consoles",
      "Mobile and accessories",
      "Navigation",
      "TV and audio",
    ],
    "Entertainment and activities": [
      "ALL",
      "Arcades and games",
      "Bowling",
      "Cinemas",
      "Kids activities",
      "Learning and education",
      "Music",
    ],
    Florists: [],
    "Food and drink": [
      "ALL",
      "Asian",
      "Bars and pubs",
      "Breakfast and brunch",
      "Cafes",
      "Casual dining",
      "Chocolate cafes",
      "Desserts",
      "Dietary requirements",
      "Fast food",
      "Fine dining",
      "Greek",
      "Grill houses",
      "Halal",
      "Healthy options",
      "Italian",
      "Juice bars",
      "Kid-friendly",
      "Lebanese",
      "Mexican and Latin American",
      "Middle Eastern",
      "Modern Australian",
      "Sandwiches and salads",
      "Takeaway",
    ],
    "Foreign currency exchange": [],
    "Fresh food and groceries": [
      "ALL",
      "Bakeries",
      "Butchers",
      "Confectionery",
      "Delicatessens",
      "Fresh produce",
      "Liquor",
      "Patisseries",
      "Poultry",
      "Seafood",
      "Specialty foods",
      "Supermarkets",
    ],
    "Health and fitness": [
      "ALL",
      "Chemists",
      "Dentists",
      "Gyms and fitness studios",
      "Health insurers",
      "Medical centres",
      "Medicare",
      "Optometrists",
      "Specialty health providers",
    ],
    Home: [
      "ALL",
      "Bath and home fragrances",
      "Bedding",
      "Furniture",
      "Gifts",
      "Hardware",
      "Home appliances",
      "Home decor",
      "Kitchen",
      "Pets",
      "Photography and art",
      "Picture frames",
    ],
    "Luggage and travel accessories": [
      "ALL",
      "Backpacks and gym duffle bags",
      "Laptop cases and sleeves",
      "Small leather goods",
      "Suitcases and travel accessories",
      "Work and laptop bags",
    ],
    "Luxury and premium": [
      "ALL",
      "Australian designer",
      "International designer",
      "Luxury",
      "Premium brands",
    ],
    "Pawn brokers": [],
    "Phone repairs": [],
    "Photographic services": [],
    "Post office": [],
    "Power, gas and communication services": [],
    "Professional services": [],
    "Real estate agents": [],
    "Shoe repair and key cutting": [],
    "Sporting goods": [
      "ALL",
      "Activewear",
      "Fitness and gym equipment",
      "Outdoors and camping",
      "Tech and wearables",
    ],
    Tobacconists: [],
    "Toys and hobbies": ["ALL", "Arts and crafts", "Games", "Hobbies", "Toys"],
    "Travel agents": [],
  };

  function initMap() {
    if (window.rtrlApp.map) return;
    window.rtrlApp.map = L.map("map").setView([-33.8688, 151.2093], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
    }).addTo(window.rtrlApp.map);
  }

  async function getPlaceDetails(placeId) {
    return new Promise((resolve, reject) => {
      if (!window.rtrlApp.state.googleMapsGeocoder) return reject();
      window.rtrlApp.state.googleMapsGeocoder.geocode(
        { placeId },
        (results, status) => {
          if (status === "OK" && results[0]) resolve(results[0]);
          else reject();
        },
      );
    });
  }

  // --- Core Functions Shared with Event-Handlers ---

  window.rtrlApp.fetchPlaceSuggestions = (el, sel, t, onSelect) => {
    if (!window.rtrlApp.state.googleMapsService || el.value.trim().length < 2)
      return (sel.style.display = "none");
    const iso = countries.find(
      (c) =>
        c.text.toLowerCase() ===
        document.getElementById("countryInput").value.toLowerCase(),
    )?.value;
    const req = { input: el.value, types: t };
    if (iso) req.componentRestrictions = { country: iso };
    window.rtrlApp.state.googleMapsService.getPlacePredictions(
      req,
      (p, status) => {
        if (status === "OK" && p)
          renderSuggestions(
            el,
            sel,
            p.map((x) => ({
              description: x.description,
              place_id: x.place_id,
            })),
            "description",
            "place_id",
            onSelect,
          );
        else sel.style.display = "none";
      },
    );
  };

  window.rtrlApp.handleLocationSelection = async (item) => {
    try {
      const details = await getPlaceDetails(item.place_id);
      const countryName =
        (
          details.address_components.find((c) => c.types.includes("country")) ||
          {}
        ).long_name || "";
      if (countryName)
        document.getElementById("countryInput").value = countryName;
      document.getElementById("locationInput").value = item.description;
    } catch (e) {
      document.getElementById("locationInput").value =
        item.description.split(",")[0];
    }
  };

  window.rtrlApp.handleAnchorPointSelection = async (item) => {
    try {
      const details = await getPlaceDetails(item.place_id);
      const { lat, lng } = details.geometry.location;
      const newCenter = L.latLng(lat(), lng());
      window.rtrlApp.state.selectedAnchorPoint = {
        center: newCenter,
        name: item.description,
      };
      document.getElementById("anchorPointInput").value = item.description;
      document.getElementById("anchorPointSuggestions").style.display = "none";
      window.rtrlApp.map.setView(newCenter, 11);
      window.rtrlApp.drawSearchCircle(newCenter);
    } catch (e) {}
  };

  window.rtrlApp.handlePostalCodeSelection = async (item) => {
    try {
      const details = await getPlaceDetails(item.place_id);
      const pc = details.address_components.find((c) =>
        c.types.includes("postal_code"),
      );
      if (pc) {
        await window.rtrlApp.validateAndAddTag(pc.long_name);
        document.getElementById("postalCodeInput").value = "";
      }
    } catch (e) {}
  };

  window.rtrlApp.validateAndAddTag = async (postcode) => {
    const v = postcode.trim();
    if (!v || isNaN(v) || window.rtrlApp.postalCodes.includes(v)) return;
    const iso = countries.find(
      (c) =>
        c.text.toLowerCase() ===
        document.getElementById("countryInput").value.toLowerCase(),
    )?.value;
    if (!iso || !window.rtrlApp.state.googleMapsGeocoder) return;
    window.rtrlApp.state.googleMapsGeocoder.geocode(
      { componentRestrictions: { country: iso, postalCode: v } },
      (res, status) => {
        if (status === "OK" && res[0]) {
          const pcComp = res[0].address_components.find((c) =>
            c.types.includes("postal_code"),
          );
          if (pcComp && pcComp.long_name === v) {
            const sub = res[0].address_components.find((c) =>
              c.types.includes("locality"),
            );
            window.rtrlApp.postalCodes.push(v);
            const tagEl = document.createElement("span");
            tagEl.className = "tag";
            tagEl.innerHTML = `<span>${sub ? sub.long_name + " " : ""}${v}</span> <span class="tag-close-btn" data-value="${v}">&times;</span>`;
            document
              .getElementById("postalCodeContainer")
              .insertBefore(tagEl, document.getElementById("postalCodeInput"));
            document.getElementById("postalCodeInput").value = "";
          }
        }
      },
    );
  };

  window.rtrlApp.setLocationInputsState = (d) => {
    document.getElementById("locationInput").disabled = d;
    document.getElementById("postalCodeInput").disabled = d;
    if (d) {
      document.getElementById("locationInput").value = "";
      window.rtrlApp.postalCodes.length = 0;
      document
        .querySelectorAll("#postalCodeContainer .tag")
        .forEach((t) => t.remove());
    }
  };

  window.rtrlApp.setRadiusInputsState = (d) => {
    document.getElementById("anchorPointInput").disabled = d;
    document.getElementById("radiusSlider").disabled = d;
    if (d) {
      document.getElementById("anchorPointInput").value = "";
      window.rtrlApp.state.selectedAnchorPoint = null;
      if (window.rtrlApp.searchCircle) {
        window.rtrlApp.map.removeLayer(window.rtrlApp.searchCircle);
        window.rtrlApp.searchCircle = null;
      }
    }
  };

  window.rtrlApp.drawSearchCircle = (c) => {
    const r =
      parseInt(document.getElementById("radiusSlider").value, 10) * 1000;
    if (window.rtrlApp.searchCircle) {
      window.rtrlApp.searchCircle.setLatLng(c);
      window.rtrlApp.searchCircle.setRadius(r);
    } else {
      window.rtrlApp.searchCircle = L.circle(c, {
        radius: r,
        color: "#20c997",
        fillColor: "#20c997",
        fillOpacity: 0.2,
      }).addTo(window.rtrlApp.map);
    }
    window.rtrlApp.map.fitBounds(window.rtrlApp.searchCircle.getBounds());
  };

  function assemblePayload(elements) {
    const ns = elements.businessNamesInput.value
      .trim()
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
    const ss = Array.from(
      elements.subCategoryCheckboxContainer.querySelectorAll("input:checked"),
    )
      .map((c) => c.value)
      .filter((v) => v !== "select_all");
    const p = {
      country: elements.countryInput.value,
      businessNames: ns,
      userEmail: elements.userEmailInput.value.trim(),
      exclusionList: window.rtrlApp.exclusionFeature.getExclusionList(),
      useAiEnrichment: elements.useAiToggle.checked,
    };

    if (window.rtrlApp.state.selectedAnchorPoint) {
      const { lat, lng } = window.rtrlApp.state.selectedAnchorPoint.center;
      p.anchorPoint = `${lat},${lng}`;
      p.radiusKm = parseInt(elements.radiusSlider.value, 10);
    } else {
      p.location = elements.locationInput.value.trim();
      p.postalCode = window.rtrlApp.postalCodes;
    }

    if (ns.length > 0) p.count = -1;
    else if (window.rtrlApp.customKeywords.length > 0)
      p.categoriesToLoop = window.rtrlApp.customKeywords;
    else {
      let b = ss.length > 0 ? ss : [elements.primaryCategorySelect.value];
      p.categoriesToLoop = elements.categoryModifierInput.value.trim()
        ? b.map((c) => `"${elements.categoryModifierInput.value.trim()}" ${c}`)
        : b;
    }

    if (ns.length === 0)
      p.count =
        elements.findAllBusinessesCheckbox.checked ||
        !elements.countInput.value.trim()
          ? -1
          : parseInt(elements.countInput.value, 10);

    const areaKey = window.rtrlApp.state.selectedAnchorPoint
      ? elements.anchorPointInput.value.split(",")[0]
      : window.rtrlApp.postalCodes.length > 0
        ? window.rtrlApp.postalCodes.join("_")
        : elements.locationInput.value.split(",")[0];

    p.searchParamsForEmail = {
      primaryCategory: elements.primaryCategorySelect.value,
      subCategory: ss.length > 1 ? "multiple_subcategories" : ss[0] || "",
      subCategoryList: ss,
      customCategory:
        window.rtrlApp.customKeywords.length > 0
          ? window.rtrlApp.customKeywords.join(", ")
          : elements.categoryModifierInput.value,
      area: areaKey,
      postcodes: window.rtrlApp.postalCodes,
      country: elements.countryInput.value,
    };
    return p;
  }

  return { countries, categories, initMap, assemblePayload };
})();
