window.rtrlApp = window.rtrlApp || {};

window.rtrlApp.searchManager = (function () {
  // 1. CONSTANTS
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

  // 2. MAP & GEOCODING
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

  // 3. REPEAT SEARCH LOGIC (The logic that fills the form from history)
  function cloneJobIntoForm(p) {
    const el = {
      primaryCat: document.getElementById("primaryCategorySelect"),
      customCat: document.getElementById("customCategoryInput"),
      location: document.getElementById("locationInput"),
      country: document.getElementById("countryInput"),
      count: document.getElementById("count"),
      findAll: document.getElementById("findAllBusinesses"),
      names: document.getElementById("businessNamesInput"),
      anchor: document.getElementById("anchorPointInput"),
      radius: document.getElementById("radiusSlider"),
      aiToggle: document.getElementById("useAiToggle"),
      modifier: document.getElementById("categoryModifierInput"),
    };

    // Reset UI
    el.location.value = "";
    el.anchor.value = "";
    el.names.value = "";
    window.rtrlApp.postalCodes.length = 0;
    window.rtrlApp.customKeywords.length = 0;
    window.rtrlApp.state.selectedAnchorPoint = null;
    document.querySelectorAll(".tag").forEach((t) => t.remove());

    if (window.rtrlApp.searchCircle) {
      window.rtrlApp.map.removeLayer(window.rtrlApp.searchCircle);
      window.rtrlApp.searchCircle = null;
    }

    // Apply parameters
    if (el.aiToggle) el.aiToggle.checked = p.useAiEnrichment !== false;
    el.country.value = p.country || "Australia";

    if (p.count === -1) {
      el.findAll.checked = true;
      el.count.value = "";
      el.count.disabled = true;
    } else {
      el.findAll.checked = false;
      el.count.value = p.count || "";
      el.count.disabled = false;
    }

    if (p.businessNames && p.businessNames.length > 0) {
      el.names.value = p.businessNames.join("\n");
      document
        .getElementById("individualSearchContainer")
        .classList.remove("collapsed");
    } else if (p.categoriesToLoop) {
      p.categoriesToLoop.forEach((kw) => {
        window.rtrlApp.customKeywords.push(kw);
        const t = document.createElement("span");
        t.className = "tag";
        t.innerHTML = `<span>${kw}</span> <span class="tag-close-btn" data-value="${kw}">&times;</span>`;
        document
          .getElementById("customKeywordContainer")
          .insertBefore(t, el.customCat);
      });
    }

    if (p.radiusKm && p.anchorPoint) {
      el.radius.value = p.radiusKm;
      document.getElementById("radiusValue").textContent = `${p.radiusKm} km`;
      el.anchor.value = p.searchParamsForEmail?.area || "Selected Area";
      const co = p.anchorPoint.split(",");
      if (co.length === 2) {
        const nc = L.latLng(parseFloat(co[0]), parseFloat(co[1]));
        window.rtrlApp.state.selectedAnchorPoint = {
          center: nc,
          name: el.anchor.value,
        };
        document
          .getElementById("radiusSearchContainer")
          .classList.remove("collapsed");
        setTimeout(() => {
          window.rtrlApp.map.invalidateSize();
          window.rtrlApp.map.setView(nc, 11);
          window.rtrlApp.drawSearchCircle(nc);
        }, 150);
      }
    } else {
      el.location.value = p.location || "";
      if (p.postalCode)
        p.postalCode.forEach((pc) => window.rtrlApp.validateAndAddTag(pc));
      document
        .getElementById("locationSearchContainer")
        .classList.remove("collapsed");
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // 4. PAYLOAD ASSEMBLY
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

  return {
    countries,
    categories,
    initMap,
    getPlaceDetails,
    assemblePayload,
    cloneJobIntoForm,
  };
})();
