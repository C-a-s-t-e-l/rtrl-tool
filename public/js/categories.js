(function () {
    let masterCategoryData = [];
    let categoryHierarchy = {};
    let selectedIndustry = null;
    let activeSelections = [];

    function clearCustomKeywords() {
        window.rtrlApp.customKeywords = [];
        const kwContainer = document.getElementById('customKeywordContainer');
        if (kwContainer) {
            kwContainer.querySelectorAll('.tag').forEach(t => t.remove());
            const input = kwContainer.querySelector('input');
            if (input) input.value = '';
        }
    }

    function updateSelectionPills() {
        const container = document.getElementById('selectionPillsContainer');
        const summary = document.getElementById('categorySummaryText');
        if (!container) return;
        container.innerHTML = activeSelections.map(sel =>
            `<span class="tag" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;"><span>${sel.label}</span><span class="tag-close-btn" onclick="window.rtrlApp.toggleCategory(${sel.id})">&times;</span></span>`
        ).join('');
        const totalLoops = activeSelections.reduce((acc, curr) => acc + (curr.terms?.length || 0), 0);
        if (summary) summary.textContent = `${activeSelections.length} Categories selected (${totalLoops} Search loops)`;
    }

    function renderExplorer(filterText = "") {
        const container = document.getElementById('subCategoryCheckboxContainer');
        if (!container || !selectedIndustry) return;
        const currentlyOpen = Array.from(container.querySelectorAll('.explorer-group.open')).map(el => el.id);
        const groups = categoryHierarchy[selectedIndustry];
        let html = "";
        for (const [groupName, items] of Object.entries(groups)) {
            const filteredItems = items.filter(item =>
                item.label.toLowerCase().includes(filterText.toLowerCase()) ||
                groupName.toLowerCase().includes(filterText.toLowerCase())
            );
            if (filteredItems.length === 0) continue;
            const groupId = `group_${groupName.replace(/[^a-zA-Z0-9]/g, '')}`;
            if (items.length === 1) {
                const item = items[0];
                const isChecked = activeSelections.some(s => s.id === item.id);
                html += `<div class="standalone-item"><input type="checkbox" id="check_${item.id}" ${isChecked ? 'checked' : ''} onchange="window.rtrlApp.toggleCategory(${item.id})"><label for="check_${item.id}">${groupName}</label></div>`;
            } else {
                const isOpen = currentlyOpen.includes(groupId) ? 'open' : '';
                html += `<div class="explorer-group ${isOpen}" id="${groupId}"><div class="explorer-group-header" onclick="this.parentElement.classList.toggle('open')"><div class="group-title-wrapper"><i class="fas fa-chevron-right group-arrow"></i><span>${groupName}</span></div><button class="btn-select-group" onclick="event.stopPropagation(); window.rtrlApp.selectGroup('${groupName.replace(/'/g, "\\'")}')">SELECT ALL</button></div><div class="explorer-group-content">${filteredItems.map(item => { const isChecked = activeSelections.some(s => s.id === item.id); return `<div class="ui-label-item"><input type="checkbox" id="check_${item.id}" ${isChecked ? 'checked' : ''} onchange="window.rtrlApp.toggleCategory(${item.id})"><label for="check_${item.id}">${item.label}</label></div>`; }).join('')}</div></div>`;
            }
        }
        container.innerHTML = html;
    }

    function renderIndustryPills(industries) {
        const container = document.getElementById('industryPillsContainer');
        if (!container) return;
        const select = document.createElement('select');
        select.id = 'industrySelect';
        industries.forEach(ind => {
            const opt = document.createElement('option');
            opt.value = ind;
            opt.textContent = ind;
            select.appendChild(opt);
        });
        select.onchange = () => {
            selectedIndustry = select.value;
            clearCustomKeywords();
            activeSelections = [];
            renderExplorer();
            updateSelectionPills();
        };
        container.innerHTML = '';
        container.appendChild(select);
        if (industries.length > 0) {
            selectedIndustry = industries[0];
            renderExplorer();
            updateSelectionPills();
        }
    }

    async function fetchCategoryDefinitions() {
        try {
            const { data, error } = await window.rtrlApp.supabaseClient
                .from('category_definitions')
                .select('*')
                .order('group_name', { ascending: true });
            if (error) throw error;
            masterCategoryData = data;
            categoryHierarchy = data.reduce((acc, row) => {
                const { industry, group_name, ui_label, search_terms } = row;
                if (!acc[industry]) acc[industry] = {};
                if (!acc[industry][group_name]) acc[industry][group_name] = [];
                acc[industry][group_name].push({ label: ui_label, terms: search_terms, id: row.id });
                return acc;
            }, {});
            return Object.keys(categoryHierarchy);
        } catch (err) {
            console.error("Error loading categories:", err);
            return [];
        }
    }

    window.rtrlApp.toggleCategory = (id) => {
        const item = masterCategoryData.find(d => d.id === id);
        const index = activeSelections.findIndex(s => s.id === id);
        if (index > -1) {
            activeSelections.splice(index, 1);
        } else {
            clearCustomKeywords();
            activeSelections.push({ id: item.id, label: item.ui_label, terms: item.search_terms });
        }
        updateSelectionPills();
        renderExplorer(document.getElementById('categorySearchInput')?.value || "");
    };

    window.rtrlApp.selectGroup = (groupName) => {
        if (!selectedIndustry || !categoryHierarchy[selectedIndustry]) return;
        const items = categoryHierarchy[selectedIndustry][groupName];
        if (!items) return;
        clearCustomKeywords();
        items.forEach(item => {
            if (!activeSelections.some(s => s.id === item.id)) {
                activeSelections.push({ id: item.id, label: item.label, terms: item.search_terms });
            }
        });
        updateSelectionPills();
        renderExplorer(document.getElementById('categorySearchInput')?.value || "");
    };

    window.rtrlApp.categories = {
        fetchCategoryDefinitions,
        renderIndustryPills,
        renderExplorer,
        updateSelectionPills,
        clearCustomKeywords,
        getActiveSelections: () => activeSelections,
        getSelectedIndustry: () => selectedIndustry,
        getCategoryHierarchy: () => categoryHierarchy,
        clearAndRender: () => { activeSelections = []; updateSelectionPills(); renderExplorer(); },
    };
})();
