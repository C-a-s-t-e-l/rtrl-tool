window.rtrlApp = window.rtrlApp || {};

window.rtrlApp.exclusionFeature = (function () {
    let exclusionList = [];
    let containerEl, inputEl;

    function addExclusionTag(name) {
        const cleanedName = name.trim();
        if (!cleanedName || exclusionList.includes(cleanedName.toLowerCase())) {
            inputEl.value = '';
            return;
        }

        exclusionList.push(cleanedName.toLowerCase());

        const tagEl = document.createElement("span");
        tagEl.className = "tag";
        tagEl.innerHTML = `<span>${cleanedName}</span> <span class="tag-close-btn" data-value="${cleanedName}">&times;</span>`;
        
        containerEl.insertBefore(tagEl, inputEl);
        inputEl.value = '';
    }

    function removeExclusionTag(name) {
        const index = exclusionList.indexOf(name.toLowerCase());
        if (index > -1) {
            exclusionList.splice(index, 1);
        }
    }

    function init() {
        containerEl = document.getElementById('exclusionContainer');
        inputEl = document.getElementById('exclusionInput');

        containerEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('tag-close-btn')) {
                const name = e.target.dataset.value;
                removeExclusionTag(name);
                e.target.parentElement.remove();
            } else {
                inputEl.focus();
            }
        });

        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addExclusionTag(inputEl.value);
            } else if (e.key === 'Backspace' && inputEl.value === '') {
                if (exclusionList.length > 0) {
                    const lastTag = containerEl.querySelector('.tag:last-of-type');
                    if (lastTag) {
                        const closeBtn = lastTag.querySelector('.tag-close-btn');
                        const name = closeBtn.dataset.value;
                        removeExclusionTag(name);
                        lastTag.remove();
                    }
                }
            }
        });
    }

    function getExclusionList() {
        return exclusionList;
    }

    return {
        init,
        getExclusionList
    };
})();