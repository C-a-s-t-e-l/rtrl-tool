window.rtrlApp = window.rtrlApp || {};

window.rtrlApp.exclusionFeature = (function () {
    let exclusionList = [];
    let containerEl, inputEl;
    let tokenProvider = () => null;
    let saveTimeout;

    function renderTags() {
        containerEl.querySelectorAll('.tag').forEach(tag => tag.remove());

        exclusionList.forEach(name => {
            const tagEl = document.createElement("span");
            tagEl.className = "tag";
            tagEl.innerHTML = `<span>${name}</span> <span class="tag-close-btn" data-value="${name}">&times;</span>`;
            containerEl.insertBefore(tagEl, inputEl);
        });
    }
    
    async function saveExclusionList() {
        const token = tokenProvider();
        if (!token) return; 

        try {
            await fetch(`${BACKEND_URL}/api/exclusions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ exclusionList: exclusionList })
            });
        } catch (error) {
            console.error('Failed to save exclusion list:', error);
        }
    }

    function debouncedSave() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveExclusionList, 1000); 
    }

    function addExclusionTag(name) {
        const cleanedName = name.trim();
        if (!cleanedName || exclusionList.map(n => n.toLowerCase()).includes(cleanedName.toLowerCase())) {
            inputEl.value = '';
            return;
        }

        exclusionList.push(cleanedName);
        renderTags();
        debouncedSave();
        inputEl.value = '';
    }

    function removeExclusionTag(name) {
        exclusionList = exclusionList.filter(item => item.toLowerCase() !== name.toLowerCase());
        renderTags();
        debouncedSave();
    }

    function init(provider) {
        containerEl = document.getElementById('exclusionContainer');
        inputEl = document.getElementById('exclusionInput');
        tokenProvider = provider;

        containerEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('tag-close-btn')) {
                const name = e.target.dataset.value;
                removeExclusionTag(name);
            } else {
                inputEl.focus();
            }
        });

        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addExclusionTag(inputEl.value);
            }
        });
    }

    function populateTags(list) {
        exclusionList = Array.isArray(list) ? list : [];
        renderTags();
    }

    function getExclusionList() {
        return exclusionList;
    }

    return {
        init,
        getExclusionList,
        populateTags
    };
})();