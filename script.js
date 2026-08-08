(function() {
            'use strict';

            // ──── SUPABASE CONFIGURATION ────
            const SUPABASE_URL = 'https://opfvcedujhxstxvcpwkr.supabase.co';
            const SUPABASE_ANON_KEY = 'sb_publishable__uLZlddeqqU-ZJ1eVgtVPQ_rZ11YgFF';
            const LOBBY_PROJECTS_TABLE = 'lobby_projects';
            
            let supabase;
            let supabaseConnected = false;

            // ──── PUBLIC SHARING STATE ────
            let lobbyTab = 'mine'; // 'mine' | 'public'
            let publicResults = [];
            let publicSearchDebounce = null;
            let isPublicViewMode = false;   // true while viewing someone else's public project (read-only)

            async function sha256Hex(text) {
                const enc = new TextEncoder().encode(text);
                const buf = await crypto.subtle.digest('SHA-256', enc);
                return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
            }

            // ──── STATE (lobby → projects → files) ────

            const STORAGE_PREFIX = 'norvex_projects_data_v3';
            const THEME_KEY = 'norvex_theme';
            const CURRENT_PROJECT_PREFIX = 'norvex_current_project';
            const LOBBY_KEY = 'norvex_lobby_projects_v1';
            const LEGACY_DATA_KEYS = ['norvex_projects_data_v3', 'norvex_projects_data_v2', 'norvex_projects_data'];
            const LEGACY_CURRENT_KEY = 'norvex_current_project';

            function dataStorageKey() { return STORAGE_PREFIX + '__' + activeLobbyId; }
            function currentFileStorageKey() { return CURRENT_PROJECT_PREFIX + '__' + activeLobbyId; }

            function createDefaultProject(name) {
                const cols = ['Page', 'URL', 'Status', 'Priority'];
                const rows = [];
                for (let i = 0; i < 100; i++) {
                    rows.push(cols.map(() => ''));
                }
                return {
                    name: name || 'Untitled',
                    title: 'Website Data',
                    columns: cols,
                    rows: rows,
                    columnDividers: cols.map(() => true),
                    headingRows: [],
                    highlightedRows: [],
                    highlightedCols: [],
                    hasHeaderTitle: false,
                };
            }

            let lobbyProjects = {};
            let activeLobbyId = null;
            let projects = {};
            let currentProjectId = null;
            let searchTerm = '';
            let currentTheme = 'light';
            let modalResolve = null;
            let isSettingsModalOpen = false;
            let isSaving = false;
            
            // Autocomplete state
            let autocompleteDropdown = null;
            let autocompleteItems = [];
            let selectedAutocompleteIndex = -1;
            let activeAutocompleteInput = null;

            // DOM refs
            const $ = (sel) => document.querySelector(sel);
            const $$ = (sel) => document.querySelectorAll(sel);

            const lobbyScreen = $('#lobbyScreen');
            const appEl = $('#app');
            const lobbyGrid = $('#lobbyGrid');
            const lobbyEmpty = $('#lobbyEmpty');
            const lobbyNewProjectBtn = $('#lobbyNewProjectBtn');
            const lobbySearchInput = $('#lobbySearchInput');
            const backToLobbyBtn = $('#backToLobbyBtn');
            const activeProjectName = $('#activeProjectName');
            const lobbyTabMine = $('#lobbyTabMine');
            const lobbyTabPublic = $('#lobbyTabPublic');
            const publicGrid = $('#publicGrid');
            const publicEmpty = $('#publicEmpty');
            const publicLoading = $('#publicLoading');
            const viewOnlyBanner = $('#viewOnlyBanner');
            const viewOnlyBannerText = $('#viewOnlyBannerText');
            let lobbySearchTerm = '';

            const projectTabs = $('#projectTabs');
            const addProjectBtn = $('#addProjectBtn');
            const renameProjectBtn = $('#renameProjectBtn');
            const deleteProjectBtn = $('#deleteProjectBtn');
            const sheetTitle = $('#sheetTitle');
            const tableHead = $('#tableHead');
            const tableBody = $('#tableBody');
            const searchInput = $('#searchInput');
            const rowCount = $('#rowCount');
            const lastUpdated = $('#lastUpdated');
            const themeToggle = $('#themeToggle');
            const settingsBtn = $('#settingsBtn');
            const addRowBtn = $('#addRowBtn');
            const addColBtn = $('#addColBtn');
            const addHeaderBtn = $('#addHeaderBtn');
            const clearAllBtn = $('#clearAllBtn');
            const resetDataBtn = $('#resetDataBtn');
            const exportCsvBtn = $('#exportCsvBtn');
            const importCsvBtn = $('#importCsvBtn');
            const csvFileInput = $('#csvFileInput');
            const modalOverlay = $('#modalOverlay');
            const modalTitle = $('#modalTitle');
            const modalSub = $('#modalSub');
            const modalBody = $('#modalBody');
            const modalScroll = $('#modalScroll');
            const modalConfirmBtn = $('#modalConfirmBtn');
            const modalCancelBtn = $('#modalCancelBtn');
            const toastContainer = $('#toastContainer');
            const saveToSupabaseBtn = $('#saveToSupabaseBtn');
            const saveStatusText = $('#saveStatusText');
            const saveIndicator = $('#saveIndicator');
            const connectionStatus = $('#connectionStatus');
            const connectionDot = $('#connectionDot');
            const connectionText = $('#connectionText');

            // ──── SUPABASE INIT ────
            
            function initSupabase() {
                try {
                    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
                    supabaseConnected = true;
                    updateConnectionStatus(true);
                    toast('✅ Connected to Supabase!', 'success');
                    return true;
                } catch (error) {
                    console.error('Failed to initialize Supabase:', error);
                    supabaseConnected = false;
                    updateConnectionStatus(false);
                    toast('❌ Failed to connect to Supabase: ' + error.message, 'error');
                    return false;
                }
            }

            function updateConnectionStatus(connected) {
                if (connected) {
                    connectionDot.className = 'dot connected';
                    connectionText.textContent = 'Connected';
                } else {
                    connectionDot.className = 'dot disconnected';
                    connectionText.textContent = 'Disconnected';
                }
            }

            // ──── SAVE TO SUPABASE ────
            
            async function saveProjectToSupabase(projectId) {
                if (!supabase || !supabaseConnected) {
                    toast('⚠️ Not connected to Supabase.', 'error');
                    return false;
                }
                
                const proj = projects[projectId];
                if (!proj) {
                    toast('❌ File not found.', 'error');
                    return false;
                }
                
                try {
                    const data = {
                        id: projectId,
                        name: proj.name,
                        title: proj.title,
                        columns: proj.columns,
                        rows: proj.rows,
                        column_dividers: proj.columnDividers,
                        heading_rows: proj.headingRows,
                        highlighted_rows: proj.highlightedRows,
                        highlighted_cols: proj.highlightedCols,
                        has_header_title: proj.hasHeaderTitle,
                        updated_at: new Date().toISOString()
                    };

                    const { error } = await supabase
                        .from('projects')
                        .upsert(data, { 
                            onConflict: 'id',
                            ignoreDuplicates: false 
                        });
                    
                    if (error) {
                        console.error('Supabase save error:', error);
                        toast('❌ Failed to save: ' + error.message, 'error');
                        return false;
                    }
                    
                    toast('✅ Data saved to Supabase successfully!', 'success', 3000);
                    return true;
                } catch (error) {
                    console.error('Failed to save to Supabase:', error);
                    toast('❌ Failed to save: ' + error.message, 'error');
                    return false;
                }
            }

            // ──── SAVE BUTTON HANDLER ────

            async function saveCurrentProjectToSupabase() {
                if (isPublicViewMode) return;
                if (isSaving) return;
                if (!currentProjectId || !projects[currentProjectId]) {
                    toast('No file to save.', 'error');
                    return;
                }

                if (!supabaseConnected) {
                    toast('❌ Not connected to Supabase.', 'error');
                    return;
                }

                isSaving = true;
                saveToSupabaseBtn.disabled = true;
                saveToSupabaseBtn.innerHTML = '<i class="fas fa-spinner"></i> Saving...';
                saveStatusText.textContent = 'Saving...';
                saveIndicator.className = 'save-indicator saving';
                
                try {
                    const success = await saveProjectToSupabase(currentProjectId);
                    
                    if (success) {
                        saveStatusText.textContent = 'Saved to Cloud ✓';
                        saveIndicator.className = 'save-indicator saved';
                    } else {
                        saveStatusText.textContent = 'Save failed!';
                        saveIndicator.className = 'save-indicator error';
                    }
                } catch (error) {
                    saveStatusText.textContent = 'Save failed!';
                    saveIndicator.className = 'save-indicator error';
                    toast('❌ Error saving: ' + error.message, 'error', 4000);
                } finally {
                    isSaving = false;
                    saveToSupabaseBtn.disabled = false;
                    saveToSupabaseBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Save to Cloud';
                    setTimeout(() => {
                        if (!isSaving && saveStatusText.textContent !== 'Saving...') {
                            saveStatusText.textContent = 'Ready';
                            saveIndicator.className = 'save-indicator saved';
                        }
                    }, 5000);
                }
            }

            // ──── PERSISTENCE ────

            function saveProjects() {
                if (!activeLobbyId) return;
                try {
                    localStorage.setItem(dataStorageKey(), JSON.stringify(projects));
                    localStorage.setItem(currentFileStorageKey(), currentProjectId || '');
                    if (!isSaving) {
                        saveStatusText.textContent = 'Unsaved changes';
                        saveIndicator.className = 'save-indicator unsaved';
                    }
                } catch (_) { /* ignore */ }
            }

            function migrateProject(proj) {
                if (!proj.name) proj.name = 'Untitled';
                if (!proj.title) proj.title = 'Untitled Sheet';
                if (!Array.isArray(proj.columns)) proj.columns = ['Column 1'];
                if (!Array.isArray(proj.rows)) proj.rows = [];
                if (!Array.isArray(proj.columnDividers)) {
                    proj.columnDividers = proj.columns.map(() => true);
                } else {
                    while (proj.columnDividers.length < proj.columns.length) proj.columnDividers.push(true);
                    while (proj.columnDividers.length > proj.columns.length) proj.columnDividers.pop();
                }
                if (proj.headingColumns) delete proj.headingColumns;
                if (!Array.isArray(proj.headingRows)) proj.headingRows = [];
                if (!Array.isArray(proj.highlightedRows)) proj.highlightedRows = [];
                if (!Array.isArray(proj.highlightedCols)) proj.highlightedCols = [];
                if (proj.hasHeaderTitle === undefined) proj.hasHeaderTitle = false;
                proj.headingRows = proj.headingRows.filter(r => r >= 0 && r < proj.rows.length);
                proj.highlightedRows = proj.highlightedRows.filter(r => r >= 0 && r < proj.rows.length);
                proj.highlightedCols = proj.highlightedCols.filter(c => c >= 0 && c < proj.columns.length);
            }

            function loadProjects() {
                if (!activeLobbyId) return false;
                try {
                    const data = localStorage.getItem(dataStorageKey());
                    if (data) {
                        const parsed = JSON.parse(data);
                        if (typeof parsed === 'object' && parsed !== null) {
                            projects = parsed;
                            for (const [, proj] of Object.entries(projects)) {
                                migrateProject(proj);
                            }
                            const savedCurrent = localStorage.getItem(currentFileStorageKey());
                            if (savedCurrent && projects[savedCurrent]) {
                                currentProjectId = savedCurrent;
                            } else {
                                const ids = Object.keys(projects);
                                if (ids.length) currentProjectId = ids[0];
                                else currentProjectId = null;
                            }
                            return true;
                        }
                    }
                } catch (_) { /* ignore */ }
                return false;
            }

            function loadTheme() {
                try {
                    const val = localStorage.getItem(THEME_KEY);
                    if (val) {
                        currentTheme = val;
                        applyTheme(val);
                    } else {
                        currentTheme = 'light';
                        applyTheme('light');
                    }
                } catch (_) {
                    currentTheme = 'light';
                    applyTheme('light');
                }
            }

            function saveTheme() {
                try { localStorage.setItem(THEME_KEY, currentTheme); } catch (_) { /* ignore */ }
            }

            function applyTheme(theme) {
                document.documentElement.className = '';
                if (theme !== 'light') {
                    document.documentElement.classList.add('theme-' + theme);
                }
                if (theme === 'dark') {
                    themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
                } else {
                    themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
                }
                currentTheme = theme;
                saveTheme();
            }

            function toggleTheme() {
                const themes = ['light', 'dark', 'ocean', 'forest', 'sunset', 'purple'];
                const idx = themes.indexOf(currentTheme);
                const next = (idx + 1) % themes.length;
                applyTheme(themes[next]);
                toast('Theme: ' + themes[next], 'info');
                if (isSettingsModalOpen) refreshSettingsModalContent();
            }

            // ──── HELPERS ────

            function getCurrentProject() {
                if (!currentProjectId || !projects[currentProjectId]) return null;
                return projects[currentProjectId];
            }

            function escapeHtml(str) {
                const div = document.createElement('div');
                div.textContent = str;
                return div.innerHTML;
            }

            function generateId() {
                return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
            }

            function updateTimestamp() {
                lastUpdated.textContent = new Date().toLocaleTimeString();
            }

            function toggleInArray(arr, value) {
                const idx = arr.indexOf(value);
                if (idx === -1) {
                    arr.push(value);
                    return true;
                } else {
                    arr.splice(idx, 1);
                    return false;
                }
            }

            // ──── AUTOCOMPLETE SYSTEM ────

            function createAutocompleteDropdown() {
                if (autocompleteDropdown) return;
                autocompleteDropdown = document.createElement('div');
                autocompleteDropdown.className = 'autocomplete-dropdown';
                autocompleteDropdown.id = 'autocompleteDropdown';
                document.body.appendChild(autocompleteDropdown);

                document.addEventListener('click', (e) => {
                    if (autocompleteDropdown && !autocompleteDropdown.contains(e.target) && 
                        e.target !== activeAutocompleteInput) {
                        hideAutocomplete();
                    }
                });
                
                autocompleteDropdown.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                });
            }

            function getColumnValues(colIndex) {
                const proj = getCurrentProject();
                if (!proj) return { columnValues: new Map(), allValues: new Map() };
                
                const columnValues = new Map();
                const allValues = new Map();
                
                proj.rows.forEach(row => {
                    const colVal = String(row[colIndex] || '').trim();
                    if (colVal) {
                        columnValues.set(colVal, (columnValues.get(colVal) || 0) + 1);
                    }
                    
                    row.forEach(cell => {
                        const val = String(cell || '').trim();
                        if (val) {
                            allValues.set(val, (allValues.get(val) || 0) + 1);
                        }
                    });
                });
                
                return { columnValues, allValues };
            }

            function showAutocomplete(input, colIndex) {
                const value = input.value.trim();
                if (!value) {
                    hideAutocomplete();
                    return;
                }

                const { columnValues, allValues } = getColumnValues(colIndex);
                const suggestions = new Map();
                
                columnValues.forEach((count, word) => {
                    if (word.toLowerCase().includes(value.toLowerCase()) && word.toLowerCase() !== value.toLowerCase()) {
                        suggestions.set(word, { count, priority: 1 });
                    }
                });
                
                allValues.forEach((count, word) => {
                    if (!suggestions.has(word) && 
                        word.toLowerCase().includes(value.toLowerCase()) && 
                        word.toLowerCase() !== value.toLowerCase()) {
                        suggestions.set(word, { count, priority: 2 });
                    }
                });

                autocompleteItems = Array.from(suggestions.entries())
                    .map(([word, data]) => ({ word, count: data.count, priority: data.priority }))
                    .sort((a, b) => {
                        if (a.priority !== b.priority) return a.priority - b.priority;
                        return b.count - a.count;
                    })
                    .slice(0, 8);

                if (autocompleteItems.length === 0) {
                    hideAutocomplete();
                    return;
                }

                activeAutocompleteInput = input;
                selectedAutocompleteIndex = -1;

                const rect = input.getBoundingClientRect();
                autocompleteDropdown.style.position = 'fixed';
                autocompleteDropdown.style.top = (rect.bottom + 4) + 'px';
                autocompleteDropdown.style.left = rect.left + 'px';
                autocompleteDropdown.style.minWidth = Math.max(rect.width, 150) + 'px';

                let html = '';
                autocompleteItems.forEach((item, index) => {
                    const regex = new RegExp(`(${escapeRegex(value)})`, 'gi');
                    const highlighted = item.word.replace(regex, '<span class="match-highlight">$1</span>');
                    html += `
                        <div class="autocomplete-item" data-index="${index}">
                            <span>${highlighted}</span>
                            <span class="item-count">${item.count}x</span>
                        </div>
                    `;
                });
                autocompleteDropdown.innerHTML = html;
                autocompleteDropdown.classList.add('active');

                autocompleteDropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                    item.addEventListener('click', (e) => {
                        const idx = parseInt(item.dataset.index);
                        selectAutocompleteItem(idx);
                    });
                });
            }

            function hideAutocomplete() {
                if (autocompleteDropdown) {
                    autocompleteDropdown.classList.remove('active');
                    autocompleteDropdown.innerHTML = '';
                }
                autocompleteItems = [];
                selectedAutocompleteIndex = -1;
                activeAutocompleteInput = null;
            }

            function selectAutocompleteItem(index) {
                if (index >= 0 && index < autocompleteItems.length && activeAutocompleteInput) {
                    activeAutocompleteInput.value = autocompleteItems[index].word;
                    const event = new Event('change', { bubbles: true });
                    activeAutocompleteInput.dispatchEvent(event);
                    hideAutocomplete();
                    activeAutocompleteInput.focus();
                }
            }

            function highlightAutocompleteItem(index) {
                const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
                items.forEach(item => item.classList.remove('selected'));
                if (index >= 0 && index < items.length) {
                    items[index].classList.add('selected');
                    items[index].scrollIntoView({ block: 'nearest' });
                }
            }

            function escapeRegex(string) {
                return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }

            function navigateAutocomplete(direction) {
                if (!autocompleteDropdown || !autocompleteDropdown.classList.contains('active')) return false;
                
                if (direction === 'down') {
                    selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, autocompleteItems.length - 1);
                } else if (direction === 'up') {
                    selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, -1);
                }
                
                highlightAutocompleteItem(selectedAutocompleteIndex);
                return true;
            }

            // ──── RENDER ────

            function renderAll() {
                renderProjectTabs();
                renderSheet();
                if (isSettingsModalOpen) refreshSettingsModalContent();
            }

            function renderProjectTabs() {
                const ids = Object.keys(projects);
                if (ids.length === 0) {
                    const id = generateId();
                    projects[id] = createDefaultProject('File 1');
                    currentProjectId = id;
                    saveProjects();
                    renderProjectTabs();
                    renderSheet();
                    return;
                }
                let html = '';
                ids.forEach(id => {
                    const proj = projects[id];
                    const active = id === currentProjectId ? 'active' : '';
                    html += `
                        <div class="project-tab ${active}" data-project-id="${id}">
                            <span class="tab-label">${escapeHtml(proj.name)}</span>
                            <span class="tab-actions">
                                <button class="rename-tab-btn" data-project-id="${id}" title="Rename"><i class="fas fa-pen"></i></button>
                                ${ids.length > 1 ? `<button class="delete-tab-btn danger" data-project-id="${id}" title="Delete"><i class="fas fa-times"></i></button>` : ''}
                            </span>
                        </div>
                    `;
                });
                projectTabs.innerHTML = html;

                projectTabs.querySelectorAll('.project-tab').forEach(tab => {
                    tab.addEventListener('click', (e) => {
                        if (e.target.closest('button')) return;
                        const id = tab.dataset.projectId;
                        if (id && id !== currentProjectId) switchProject(id);
                    });
                });
                projectTabs.querySelectorAll('.rename-tab-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const id = btn.dataset.projectId;
                        if (id) openRenameProjectModal(id);
                    });
                });
                projectTabs.querySelectorAll('.delete-tab-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const id = btn.dataset.projectId;
                        if (id) deleteProject(id);
                    });
                });
            }

            function renderSheet() {
                const proj = getCurrentProject();
                if (!proj) {
                    const id = generateId();
                    projects[id] = createDefaultProject('File 1');
                    currentProjectId = id;
                    saveProjects();
                    renderAll();
                    return;
                }

                sheetTitle.value = proj.title || '';
                sheetTitle.readOnly = !!isPublicViewMode;

                const term = searchTerm.trim().toLowerCase();
                let filteredRows = proj.rows;
                if (term) {
                    filteredRows = proj.rows.filter(row =>
                        row.some(cell => String(cell).toLowerCase().includes(term))
                    );
                }

                while (proj.columnDividers.length < proj.columns.length) proj.columnDividers.push(true);
                while (proj.columnDividers.length > proj.columns.length) proj.columnDividers.pop();
                while (proj.highlightedCols.length > proj.columns.length) proj.highlightedCols.pop();
                proj.headingRows = proj.headingRows.filter(r => r >= 0 && r < proj.rows.length);
                proj.highlightedRows = proj.highlightedRows.filter(r => r >= 0 && r < proj.rows.length);
                proj.highlightedCols = proj.highlightedCols.filter(c => c >= 0 && c < proj.columns.length);

                // Head
                let headHtml = '<tr><th style="width:40px;text-align:center;">#</th>';
                proj.columns.forEach((col, idx) => {
                    const dividerClass = proj.columnDividers[idx] ? '' : 'no-divider';
                    const highlightClass = proj.highlightedCols.includes(idx) ? 'highlighted-col' : '';
                    headHtml += `
                        <th class="${dividerClass} ${highlightClass}">
                            <div class="col-header-wrapper">
                                <span class="col-label">
                                    <input type="text" value="${escapeHtml(col)}" data-col-index="${idx}" class="col-name-input" placeholder="Column…" />
                                </span>
                                <span class="col-actions">
                                    <button data-col-index="${idx}" class="rename-col-btn" title="Rename column"><i class="fas fa-pen"></i></button>
                                    <button data-col-index="${idx}" class="toggle-divider-btn" title="Toggle divider"><i class="fas fa-${proj.columnDividers[idx] ? 'minus' : 'plus'}-circle"></i></button>
                                    <button data-col-index="${idx}" class="highlight-col-btn ${proj.highlightedCols.includes(idx) ? 'active-highlight' : ''}" title="Toggle column highlight"><i class="fas fa-highlighter"></i></button>
                                    <button data-col-index="${idx}" class="delete-col-btn danger" title="Delete column"><i class="fas fa-trash"></i></button>
                                </span>
                            </div>
                        </th>
                    `;
                });
                headHtml += `
                    <th style="width:140px;text-align:center;">
                        <span style="color:var(--text2);font-size:12px;">Actions</span>
                    </th>
                </tr>`;
                tableHead.innerHTML = headHtml;

                // Body
                if (filteredRows.length === 0 && !proj.hasHeaderTitle) {
                    tableBody.innerHTML = `
                        <tr class="empty-row">
                            <td colspan="${proj.columns.length + 2}">
                                ${term ? 'No rows match your search.' : 'No data yet. Click "Add Row" to get started.'}
                            </td>
                        </tr>
                    `;
                } else {
                    let bodyHtml = '';
                    
                    if (proj.hasHeaderTitle) {
                        bodyHtml += `
                            <tr class="header-title-row">
                                <td colspan="${proj.columns.length + 2}">${escapeHtml(proj.title || 'Website Data')}</td>
                            </tr>
                        `;
                    }
                    
                    if (filteredRows.length === 0 && proj.hasHeaderTitle) {
                        bodyHtml += `
                            <tr class="empty-row">
                                <td colspan="${proj.columns.length + 2}">
                                    ${term ? 'No rows match your search.' : 'No data yet.'}
                                </td>
                            </tr>
                        `;
                    } else {
                        filteredRows.forEach((row, idx) => {
                            const realIndex = proj.rows.indexOf(row);
                            const isHeading = proj.headingRows.includes(realIndex);
                            const isHighlighted = proj.highlightedRows.includes(realIndex);
                            const rowClasses = [];
                            if (isHeading) rowClasses.push('heading-row');
                            if (isHighlighted) rowClasses.push('highlighted-row');
                            bodyHtml += `<tr data-row-idx="${realIndex}" class="${rowClasses.join(' ')}">`;
                            bodyHtml += `<td style="text-align:center;color:var(--text2);font-size:13px;">${idx + 1}</td>`;
                            proj.columns.forEach((col, colIdx) => {
                                const val = row[colIdx] !== undefined ? row[colIdx] : '';
                                const dividerClass = proj.columnDividers[colIdx] ? '' : 'no-divider';
                                const highlightClass = proj.highlightedCols.includes(colIdx) ? 'highlighted-col' : '';
                                bodyHtml += `
                                    <td class="${dividerClass} ${highlightClass}">
                                        <input type="text" class="cell-input" value="${escapeHtml(String(val))}" data-row="${realIndex}" data-col="${colIdx}" autocomplete="off" />
                                    </td>
                                `;
                            });
                            bodyHtml += `
                                <td>
                                    <div class="row-actions">
                                        <button class="primary edit-row-btn" data-row="${realIndex}" title="Edit row"><i class="fas fa-edit"></i></button>
                                        <button class="highlight-row-btn ${isHighlighted ? 'active-highlight' : ''}" data-row="${realIndex}" title="Toggle row highlight"><i class="fas fa-highlighter"></i></button>
                                        <button class="duplicate-row-btn" data-row="${realIndex}" title="Duplicate row"><i class="fas fa-copy"></i></button>
                                        <button class="danger delete-row-btn" data-row="${realIndex}" title="Delete row"><i class="fas fa-trash"></i></button>
                                    </div>
                                </td>
                            `;
                            bodyHtml += `</tr>`;
                        });
                    }
                    tableBody.innerHTML = bodyHtml;
                }

                rowCount.textContent = filteredRows.length;
                updateTimestamp();
                saveProjects();
                bindTableEvents();
            }

            // ──── TABLE EVENTS ────

            function bindTableEvents() {
                if (isPublicViewMode) {
                    document.querySelectorAll('.cell-input, .col-name-input').forEach(inp => {
                        inp.readOnly = true;
                        inp.tabIndex = -1;
                    });
                    return; // no edit listeners attached in read-only public view mode
                }
                document.querySelectorAll('.cell-input').forEach(inp => {
                    inp.removeEventListener('change', onCellChange);
                    inp.addEventListener('change', onCellChange);
                    inp.removeEventListener('input', onCellInput);
                    inp.addEventListener('input', onCellInput);
                    inp.removeEventListener('keydown', onCellKeydown);
                    inp.addEventListener('keydown', onCellKeydown);
                    inp.removeEventListener('blur', onCellBlur);
                    inp.addEventListener('blur', onCellBlur);
                });
                document.querySelectorAll('.col-name-input').forEach(inp => {
                    inp.removeEventListener('change', onColNameChange);
                    inp.addEventListener('change', onColNameChange);
                });
                document.querySelectorAll('.delete-col-btn').forEach(btn => {
                    btn.removeEventListener('click', onDeleteCol);
                    btn.addEventListener('click', onDeleteCol);
                });
                document.querySelectorAll('.toggle-divider-btn').forEach(btn => {
                    btn.removeEventListener('click', onToggleDivider);
                    btn.addEventListener('click', onToggleDivider);
                });
                document.querySelectorAll('.rename-col-btn').forEach(btn => {
                    btn.removeEventListener('click', onRenameCol);
                    btn.addEventListener('click', onRenameCol);
                });
                document.querySelectorAll('.highlight-col-btn').forEach(btn => {
                    btn.removeEventListener('click', onToggleColHighlight);
                    btn.addEventListener('click', onToggleColHighlight);
                });
                document.querySelectorAll('.delete-row-btn').forEach(btn => {
                    btn.removeEventListener('click', onDeleteRow);
                    btn.addEventListener('click', onDeleteRow);
                });
                document.querySelectorAll('.edit-row-btn').forEach(btn => {
                    btn.removeEventListener('click', onEditRow);
                    btn.addEventListener('click', onEditRow);
                });
                document.querySelectorAll('.duplicate-row-btn').forEach(btn => {
                    btn.removeEventListener('click', onDuplicateRow);
                    btn.addEventListener('click', onDuplicateRow);
                });
                document.querySelectorAll('.highlight-row-btn').forEach(btn => {
                    btn.removeEventListener('click', onToggleRowHighlight);
                    btn.addEventListener('click', onToggleRowHighlight);
                });
            }

            function onCellChange(e) {
                const inp = e.target;
                const row = parseInt(inp.dataset.row);
                const col = parseInt(inp.dataset.col);
                const proj = getCurrentProject();
                if (!proj) return;
                if (!isNaN(row) && !isNaN(col) && proj.rows[row]) {
                    proj.rows[row][col] = inp.value;
                    saveProjects();
                    updateTimestamp();
                }
            }

            function onCellInput(e) {
                const inp = e.target;
                const col = parseInt(inp.dataset.col);
                if (!isNaN(col)) {
                    showAutocomplete(inp, col);
                }
            }

            function onCellKeydown(e) {
                const inp = e.target;
                const proj = getCurrentProject();
                if (!proj) return;
                
                if (autocompleteDropdown && autocompleteDropdown.classList.contains('active')) {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        navigateAutocomplete('down');
                        return;
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        navigateAutocomplete('up');
                        return;
                    }
                    if (e.key === 'Enter') {
                        if (selectedAutocompleteIndex >= 0 && selectedAutocompleteIndex < autocompleteItems.length) {
                            e.preventDefault();
                            selectAutocompleteItem(selectedAutocompleteIndex);
                            return;
                        } else {
                            e.preventDefault();
                            hideAutocomplete();
                            moveToNextCell(inp, proj);
                            return;
                        }
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        hideAutocomplete();
                        return;
                    }
                } else {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        moveToNextCell(inp, proj);
                    }
                }
            }
            
            function moveToNextCell(currentInput, proj) {
                const currentRow = parseInt(currentInput.dataset.row);
                const currentCol = parseInt(currentInput.dataset.col);
                const numCols = proj.columns.length;
                const allInputs = Array.from(document.querySelectorAll('.cell-input'));
                
                if (currentCol < numCols - 1) {
                    const nextInput = allInputs.find(inp => 
                        parseInt(inp.dataset.row) === currentRow && 
                        parseInt(inp.dataset.col) === currentCol + 1
                    );
                    if (nextInput) {
                        nextInput.focus();
                        nextInput.select();
                        return;
                    }
                }
                
                const nextRowInputs = allInputs.filter(inp => parseInt(inp.dataset.row) === currentRow + 1);
                if (nextRowInputs.length > 0) {
                    const firstColInput = nextRowInputs.find(inp => parseInt(inp.dataset.col) === 0);
                    if (firstColInput) {
                        firstColInput.focus();
                        firstColInput.select();
                        return;
                    }
                }
                
                const firstRowInputs = allInputs.filter(inp => parseInt(inp.dataset.row) === 0);
                if (firstRowInputs.length > 0) {
                    const firstColInput = firstRowInputs.find(inp => parseInt(inp.dataset.col) === 0);
                    if (firstColInput) {
                        firstColInput.focus();
                        firstColInput.select();
                    }
                }
            }

            function onCellBlur(e) {
                setTimeout(() => {
                    if (activeAutocompleteInput === e.target && 
                        autocompleteDropdown && 
                        !autocompleteDropdown.matches(':hover')) {
                        hideAutocomplete();
                    }
                }, 150);
            }

            function onColNameChange(e) {
                const inp = e.target;
                const idx = parseInt(inp.dataset.colIndex);
                const proj = getCurrentProject();
                if (!proj) return;
                if (!isNaN(idx) && proj.columns[idx] !== undefined) {
                    const newName = inp.value.trim() || 'Column';
                    proj.columns[idx] = newName;
                    inp.value = newName;
                    saveProjects();
                    updateTimestamp();
                    renderSheet();
                }
            }

            function onDeleteCol(e) {
                const btn = e.currentTarget;
                const idx = parseInt(btn.dataset.colIndex);
                const proj = getCurrentProject();
                if (!proj) return;
                if (isNaN(idx) || idx < 0 || idx >= proj.columns.length) return;
                if (!confirm(`Delete column "${proj.columns[idx]}" and all its data?`)) return;
                proj.columns.splice(idx, 1);
                proj.rows.forEach(row => row.splice(idx, 1));
                proj.columnDividers.splice(idx, 1);
                proj.highlightedCols = proj.highlightedCols
                    .filter(c => c !== idx)
                    .map(c => c > idx ? c - 1 : c);
                saveProjects();
                renderSheet();
                toast('Column deleted. Click "Save to Cloud" to sync.', 'success');
            }

            function onToggleDivider(e) {
                const btn = e.currentTarget;
                const idx = parseInt(btn.dataset.colIndex);
                const proj = getCurrentProject();
                if (!proj) return;
                if (!isNaN(idx) && proj.columnDividers[idx] !== undefined) {
                    proj.columnDividers[idx] = !proj.columnDividers[idx];
                    saveProjects();
                    renderSheet();
                    toast(`Divider ${proj.columnDividers[idx] ? 'shown' : 'hidden'}. Click "Save to Cloud" to sync.`, 'info');
                }
            }

            function onToggleColHighlight(e) {
                const btn = e.currentTarget;
                const idx = parseInt(btn.dataset.colIndex);
                const proj = getCurrentProject();
                if (!proj) return;
                if (!isNaN(idx) && idx >= 0 && idx < proj.columns.length) {
                    const added = toggleInArray(proj.highlightedCols, idx);
                    saveProjects();
                    renderSheet();
                    toast(`Column "${proj.columns[idx]}" ${added ? 'highlighted' : 'unhighlighted'}. Click "Save to Cloud" to sync.`, 'info');
                }
            }

            function onRenameCol(e) {
                const btn = e.currentTarget;
                const idx = parseInt(btn.dataset.colIndex);
                if (!isNaN(idx)) {
                    const inputs = document.querySelectorAll('.col-name-input');
                    const target = Array.from(inputs).find(inp => parseInt(inp.dataset.colIndex) === idx);
                    if (target) { target.focus(); target.select(); }
                }
            }

            function onToggleRowHighlight(e) {
                const btn = e.currentTarget;
                const row = parseInt(btn.dataset.row);
                const proj = getCurrentProject();
                if (!proj) return;
                if (isNaN(row) || !proj.rows[row]) return;
                const added = toggleInArray(proj.highlightedRows, row);
                saveProjects();
                renderSheet();
                toast(`Row ${row + 1} ${added ? 'highlighted' : 'unhighlighted'}. Click "Save to Cloud" to sync.`, 'info');
            }

            function onDeleteRow(e) {
                const btn = e.currentTarget;
                const row = parseInt(btn.dataset.row);
                const proj = getCurrentProject();
                if (!proj) return;
                if (isNaN(row) || !proj.rows[row]) return;
                if (!confirm('Delete this row?')) return;
                proj.rows.splice(row, 1);
                proj.headingRows = proj.headingRows
                    .filter(r => r !== row)
                    .map(r => r > row ? r - 1 : r);
                proj.highlightedRows = proj.highlightedRows
                    .filter(r => r !== row)
                    .map(r => r > row ? r - 1 : r);
                saveProjects();
                renderSheet();
                toast('Row deleted. Click "Save to Cloud" to sync.', 'success');
            }

            function onEditRow(e) {
                const btn = e.currentTarget;
                const row = parseInt(btn.dataset.row);
                const proj = getCurrentProject();
                if (!proj) return;
                if (isNaN(row) || !proj.rows[row]) return;
                openEditRowModal(row);
            }

            function onDuplicateRow(e) {
                const btn = e.currentTarget;
                const row = parseInt(btn.dataset.row);
                const proj = getCurrentProject();
                if (!proj) return;
                if (isNaN(row) || !proj.rows[row]) return;
                const copy = [...proj.rows[row]];
                proj.rows.push(copy);
                saveProjects();
                renderSheet();
                toast('Row duplicated. Click "Save to Cloud" to sync.', 'success');
            }

            // ──── PROJECT MANAGEMENT ────

            function switchProject(id) {
                if (id === currentProjectId) return;
                if (projects[id]) {
                    currentProjectId = id;
                    saveProjects();
                    renderAll();
                    toast(`Switched to file "${projects[id].name}"`, 'info');
                }
            }

            function addProject() {
                if (isPublicViewMode) return;
                const name = prompt('Enter new file name:', 'File ' + (Object.keys(projects).length + 1));
                if (name === null) return;
                const trimmed = name.trim() || 'Untitled';
                const id = generateId();
                projects[id] = createDefaultProject(trimmed);
                currentProjectId = id;
                saveProjects();
                renderAll();
                toast(`File "${trimmed}" created. Click "Save to Cloud" to sync.`, 'success');
            }

            function openRenameProjectModal(id) {
                if (isPublicViewMode) return;
                const proj = projects[id];
                if (!proj) return;
                const newName = prompt('Rename file:', proj.name);
                if (newName === null) return;
                const trimmed = newName.trim() || 'Untitled';
                proj.name = trimmed;
                saveProjects();
                renderAll();
                toast(`File renamed to "${trimmed}". Click "Save to Cloud" to sync.`, 'success');
            }

            function deleteProject(id) {
                if (isPublicViewMode) return;
                if (!projects[id]) return;
                const ids = Object.keys(projects);
                if (ids.length <= 1) {
                    toast('Cannot delete the last file.', 'error');
                    return;
                }
                if (!confirm(`Delete file "${projects[id].name}"? This cannot be undone.`)) return;
                delete projects[id];
                if (currentProjectId === id) {
                    const remaining = Object.keys(projects);
                    currentProjectId = remaining[0] || null;
                }
                saveProjects();
                renderAll();
                toast('File deleted.', 'success');
            }

            // ──── MODAL SYSTEM ────

            function openModal(title, sub, bodyHtml, confirmLabel = 'Save', confirmClass = 'primary') {
                return new Promise((resolve) => {
                    modalTitle.textContent = title;
                    modalSub.textContent = sub;
                    modalBody.innerHTML = bodyHtml;
                    modalConfirmBtn.textContent = confirmLabel;
                    modalConfirmBtn.className = confirmClass;
                    modalOverlay.classList.add('open');
                    modalResolve = resolve;
                    modalScroll.scrollTop = 0;
                    setTimeout(() => {
                        const firstInput = modalBody.querySelector('input, select, textarea');
                        if (firstInput) firstInput.focus();
                    }, 80);
                });
            }

            function closeModal(result) {
                modalOverlay.classList.remove('open');
                isSettingsModalOpen = false;
                if (modalResolve) {
                    const resolve = modalResolve;
                    modalResolve = null;
                    resolve(result);
                }
            }

            modalConfirmBtn.addEventListener('click', () => {
                if (isSettingsModalOpen) {
                    closeModal(null);
                    return;
                }
                const inputs = modalBody.querySelectorAll('input, select, textarea');
                const data = Array.from(inputs).map(inp => {
                    if (inp.type === 'checkbox') return inp.checked;
                    return inp.value;
                });
                closeModal(data);
            });
            modalCancelBtn.addEventListener('click', () => { closeModal(null); });
            modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(null); });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal(null);
                if (e.key === 'Enter' && modalOverlay.classList.contains('open') && !isSettingsModalOpen) {
                    const active = document.activeElement;
                    if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) modalConfirmBtn.click();
                }
            });

            modalBody.addEventListener('click', (e) => {
                if (!isSettingsModalOpen) return;
                const target = e.target.closest('[data-settings-action]');
                if (!target) return;
                e.preventDefault();
                const action = target.dataset.settingsAction;
                const projectId = target.dataset.projectId;
                const theme = target.dataset.theme;

                switch (action) {
                    case 'switch-project':
                        if (projectId && projectId !== currentProjectId) {
                            switchProject(projectId);
                            refreshSettingsModalContent();
                        }
                        break;
                    case 'rename-project':
                        if (projectId) {
                            const proj = projects[projectId];
                            if (proj) {
                                const newName = prompt('Rename file:', proj.name);
                                if (newName !== null) {
                                    proj.name = newName.trim() || 'Untitled';
                                    saveProjects();
                                    renderAll();
                                    refreshSettingsModalContent();
                                    toast(`File renamed. Click "Save to Cloud" to sync.`, 'success');
                                }
                            }
                        }
                        break;
                    case 'delete-project':
                        if (projectId) {
                            const ids = Object.keys(projects);
                            if (ids.length <= 1) {
                                toast('Cannot delete the last file.', 'error');
                                return;
                            }
                            const proj = projects[projectId];
                            if (proj && confirm(`Delete file "${proj.name}"?`)) {
                                delete projects[projectId];
                                if (currentProjectId === projectId) {
                                    const remaining = Object.keys(projects);
                                    currentProjectId = remaining[0] || null;
                                }
                                saveProjects();
                                renderAll();
                                refreshSettingsModalContent();
                                toast('File deleted.', 'success');
                            }
                        }
                        break;
                    case 'add-project':
                        const name = prompt('Enter new file name:', 'File ' + (Object.keys(projects).length + 1));
                        if (name !== null) {
                            const trimmed = name.trim() || 'Untitled';
                            const id = generateId();
                            projects[id] = createDefaultProject(trimmed);
                            currentProjectId = id;
                            saveProjects();
                            renderAll();
                            refreshSettingsModalContent();
                            toast(`File "${trimmed}" created. Click "Save to Cloud" to sync.`, 'success');
                        }
                        break;
                    case 'set-theme':
                        if (theme && theme !== currentTheme) {
                            applyTheme(theme);
                            refreshSettingsModalContent();
                            toast('Theme: ' + theme, 'info');
                        }
                        break;
                    case 'close-settings':
                        closeModal(null);
                        break;
                }
            });

            function generateSettingsHTML() {
                let projectListHtml = '';
                const ids = Object.keys(projects);
                ids.forEach(id => {
                    const proj = projects[id];
                    const isActive = id === currentProjectId;
                    projectListHtml += `
                        <div class="settings-project-item">
                            <span class="name">${escapeHtml(proj.name)} ${isActive ? '⭐' : ''}</span>
                            <div class="actions">
                                <button data-settings-action="switch-project" data-project-id="${id}" title="Switch to this file"><i class="fas fa-arrow-right"></i> Switch</button>
                                <button data-settings-action="rename-project" data-project-id="${id}" title="Rename"><i class="fas fa-pen"></i></button>
                                ${ids.length > 1 ? `<button data-settings-action="delete-project" data-project-id="${id}" class="danger" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                            </div>
                        </div>
                    `;
                });

                const themeOptions = ['light', 'dark', 'ocean', 'forest', 'sunset', 'purple'];
                let themeHtml = '';
                themeOptions.forEach(t => {
                    const active = t === currentTheme ? 'active-theme' : '';
                    themeHtml += `
                        <button data-settings-action="set-theme" data-theme="${t}" class="${active}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>
                    `;
                });

                return `
                    <div style="margin-bottom:20px;">
                        <div class="settings-section-title"><i class="fas fa-folder-tree"></i> Files</div>
                        <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">
                            ${projectListHtml}
                        </div>
                        <button data-settings-action="add-project" class="primary" style="margin-top:10px;padding:8px 18px;border:none;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;font-family:var(--font);font-size:13px;font-weight:500;"><i class="fas fa-plus"></i> New File</button>
                    </div>
                    <div style="margin-bottom:8px;">
                        <div class="settings-section-title"><i class="fas fa-palette"></i> Theme</div>
                        <div class="settings-theme-option">
                            ${themeHtml}
                        </div>
                    </div>
                    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);font-size:13px;color:var(--text2);">
                        <i class="fas fa-info-circle"></i> <strong>Navigation:</strong> Press Enter to move right through columns. At the last column, Enter moves to the first column of the next row.
                    </div>
                `;
            }

            function refreshSettingsModalContent() {
                if (!isSettingsModalOpen) return;
                modalBody.innerHTML = generateSettingsHTML();
                modalScroll.scrollTop = 0;
            }

            async function openSettingsModal() {
                isSettingsModalOpen = true;
                const bodyHtml = generateSettingsHTML();
                modalConfirmBtn.textContent = 'Close';
                modalConfirmBtn.className = 'primary';
                const result = await openModal('Settings', 'Manage files, themes, and view highlight options.', bodyHtml, 'Close', 'primary');
                isSettingsModalOpen = false;
            }

            // ──── EDIT ROW MODAL ────

            async function openEditRowModal(rowIdx) {
                const proj = getCurrentProject();
                if (!proj) return;
                const row = proj.rows[rowIdx];
                if (!row) return;
                let html = '';
                proj.columns.forEach((col, idx) => {
                    const val = row[idx] !== undefined ? row[idx] : '';
                    html += `
                        <div class="form-group">
                            <label>${escapeHtml(col)}</label>
                            <input type="text" value="${escapeHtml(String(val))}" data-col="${idx}" placeholder="${escapeHtml(col)}" />
                        </div>
                    `;
                });
                const result = await openModal('Edit Row', 'Update the values below. Click "Save to Cloud" after to sync.', html, 'Update', 'primary');
                if (result && result.length === proj.columns.length) {
                    proj.rows[rowIdx] = result;
                    saveProjects();
                    renderSheet();
                    toast('Row updated! Click "Save to Cloud" to sync to Supabase.', 'success');
                }
            }

            function addEmptyRow() {
                if (isPublicViewMode) return;
                const proj = getCurrentProject();
                if (!proj) return;
                const emptyRow = proj.columns.map(() => '');
                proj.rows.push(emptyRow);
                saveProjects();
                renderSheet();
                toast('Empty row added. Click "Save to Cloud" to sync.', 'success');
            }

            async function openAddColumnModal() {
                if (isPublicViewMode) return;
                const proj = getCurrentProject();
                if (!proj) return;
                const html = `
                    <div class="form-group">
                        <label>Column Name</label>
                        <input type="text" id="newColName" placeholder="e.g. Category" value="New Column" />
                    </div>
                    <div class="form-group">
                        <label>Default Value (for all rows)</label>
                        <input type="text" id="newColDefault" placeholder="Optional default value" value="" />
                    </div>
                `;
                const result = await openModal('Add Column', 'Enter the new column details.', html, 'Add Column', 'primary');
                if (result && result.length >= 2) {
                    const name = result[0].trim() || 'New Column';
                    const def = result[1] || '';
                    proj.columns.push(name);
                    proj.rows.forEach(row => row.push(def));
                    proj.columnDividers.push(true);
                    saveProjects();
                    renderSheet();
                    toast(`Column "${name}" added. Click "Save to Cloud" to sync.`, 'success');
                }
            }

            function toggleHeaderTitle() {
                if (isPublicViewMode) return;
                const proj = getCurrentProject();
                if (!proj) return;
                proj.hasHeaderTitle = !proj.hasHeaderTitle;
                saveProjects();
                renderSheet();
                toast(`Header title ${proj.hasHeaderTitle ? 'shown' : 'hidden'}. Click "Save to Cloud" to sync.`, 'info');
            }

            // ──── TOAST ────

            function toast(message, type = 'info', duration = 2800) {
                const el = document.createElement('div');
                el.className = `toast ${type}`;
                const icon = type === 'success' ? 'fa-check-circle' :
                    type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
                el.innerHTML = `
                    <i class="fas ${icon}"></i>
                    <span>${message}</span>
                    <button class="toast-close"><i class="fas fa-times"></i></button>
                `;
                toastContainer.appendChild(el);
                const closeBtn = el.querySelector('.toast-close');
                const remove = () => { if (el.parentNode) el.remove(); };
                closeBtn.addEventListener('click', remove);
                setTimeout(remove, duration);
            }

            // ──── CSV EXPORT / IMPORT ────

            function exportCSV() {
                const proj = getCurrentProject();
                if (!proj) return;
                const header = proj.columns.join(',');
                const rows = proj.rows.map(row =>
                    row.map(cell => {
                        const str = String(cell);
                        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                            return '"' + str.replace(/"/g, '""') + '"';
                        }
                        return str;
                    }).join(',')
                );
                const csv = [header, ...rows].join('\n');
                const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `${proj.name.replace(/\s+/g, '_')}_data.csv`;
                link.click();
                URL.revokeObjectURL(link.href);
                toast('CSV exported.', 'success');
            }

            function importCSV(file) {
                if (isPublicViewMode) return;
                const proj = getCurrentProject();
                if (!proj) return;
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const text = e.target.result;
                        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
                        if (lines.length < 1) { toast('CSV is empty.', 'error'); return; }
                        const parseRow = (line) => {
                            const result = [];
                            let current = '', inQuotes = false;
                            for (let i = 0; i < line.length; i++) {
                                const ch = line[i];
                                if (inQuotes) {
                                    if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
                                    else if (ch === '"') { inQuotes = false; }
                                    else { current += ch; }
                                } else {
                                    if (ch === '"') { inQuotes = true; }
                                    else if (ch === ',') { result.push(current.trim()); current = ''; }
                                    else { current += ch; }
                                }
                            }
                            result.push(current.trim());
                            return result;
                        };
                        const headerRow = parseRow(lines[0]);
                        const newColumns = headerRow.filter(c => c !== '');
                        if (newColumns.length === 0) { toast('CSV has no columns.', 'error'); return; }
                        const newRows = [];
                        for (let i = 1; i < lines.length; i++) {
                            const vals = parseRow(lines[i]);
                            while (vals.length < newColumns.length) vals.push('');
                            newRows.push(vals.slice(0, newColumns.length));
                        }
                        if (proj.rows.length > 0 || proj.columns.length > 0) {
                            if (!confirm(`Replace all data with ${newRows.length} rows and ${newColumns.length} columns?`)) return;
                        }
                        proj.columns = newColumns;
                        proj.rows = newRows;
                        proj.columnDividers = newColumns.map(() => true);
                        proj.headingRows = [];
                        proj.highlightedRows = [];
                        proj.highlightedCols = [];
                        proj.hasHeaderTitle = false;
                        saveProjects();
                        renderSheet();
                        toast(`Imported ${newRows.length} rows. Click "Save to Cloud" to sync.`, 'success');
                    } catch (err) { toast('Failed to parse CSV: ' + err.message, 'error'); }
                };
                reader.readAsText(file, 'UTF-8');
            }

            // ──── RESET / CLEAR ────

            function resetToDefault() {
                if (isPublicViewMode) return;
                const proj = getCurrentProject();
                if (!proj) return;
                if (!confirm('Reset this file to default data (100 empty rows)?')) return;
                const defaultProj = createDefaultProject(proj.name);
                proj.title = defaultProj.title;
                proj.columns = defaultProj.columns;
                proj.rows = defaultProj.rows;
                proj.columnDividers = defaultProj.columnDividers;
                proj.headingRows = defaultProj.headingRows;
                proj.highlightedRows = defaultProj.highlightedRows;
                proj.highlightedCols = defaultProj.highlightedCols;
                proj.hasHeaderTitle = false;
                saveProjects();
                renderSheet();
                toast('File reset to 100 empty rows. Click "Save to Cloud" to sync.', 'success');
            }

            function clearAllData() {
                if (isPublicViewMode) return;
                const proj = getCurrentProject();
                if (!proj) return;
                if (proj.rows.length === 0) { toast('Already empty.', 'info'); return; }
                if (!confirm('Delete ALL rows in this file?')) return;
                proj.rows = [];
                proj.headingRows = [];
                proj.highlightedRows = [];
                saveProjects();
                renderSheet();
                toast('All rows cleared. Click "Save to Cloud" to sync.', 'success');
            }

            // ──── INIT ────

            // ──── LOBBY (top-level projects) ────

            function saveLobby() {
                try {
                    localStorage.setItem(LOBBY_KEY, JSON.stringify(lobbyProjects));
                } catch (_) { /* ignore */ }
            }

            function loadLobby() {
                try {
                    const raw = localStorage.getItem(LOBBY_KEY);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (typeof parsed === 'object' && parsed !== null) {
                            lobbyProjects = parsed;
                            return;
                        }
                    }
                } catch (_) { /* ignore */ }
                lobbyProjects = {};
            }

            // One-time migration: if this browser has old single-namespace data
            // from before the Lobby existed, adopt it as the first project.
            function migrateLegacyDataIfNeeded() {
                if (Object.keys(lobbyProjects).length > 0) return;
                let legacyRaw = null;
                let legacyKeyUsed = null;
                for (const key of LEGACY_DATA_KEYS) {
                    const val = localStorage.getItem(key);
                    if (val) { legacyRaw = val; legacyKeyUsed = key; break; }
                }
                if (!legacyRaw) return;
                try {
                    const parsed = JSON.parse(legacyRaw);
                    if (typeof parsed !== 'object' || parsed === null) return;
                    const id = generateId();
                    lobbyProjects[id] = { name: 'My Project', createdAt: Date.now(), updatedAt: Date.now() };
                    localStorage.setItem(STORAGE_PREFIX + '__' + id, legacyRaw);
                    const legacyCurrent = localStorage.getItem(LEGACY_CURRENT_KEY);
                    if (legacyCurrent) {
                        localStorage.setItem(CURRENT_PROJECT_PREFIX + '__' + id, legacyCurrent);
                    }
                    saveLobby();
                    LEGACY_DATA_KEYS.forEach(k => localStorage.removeItem(k));
                    localStorage.removeItem(LEGACY_CURRENT_KEY);
                } catch (_) { /* ignore */ }
            }

            function countFilesInLobbyProject(id) {
                try {
                    const raw = localStorage.getItem(STORAGE_PREFIX + '__' + id);
                    if (!raw) return 0;
                    const parsed = JSON.parse(raw);
                    return Object.keys(parsed || {}).length;
                } catch (_) { return 0; }
            }

            function renderLobby() {
                const ids = Object.keys(lobbyProjects).sort((a, b) =>
                    (lobbyProjects[b].updatedAt || 0) - (lobbyProjects[a].updatedAt || 0));
                const term = lobbySearchTerm.trim().toLowerCase();
                const filtered = term ? ids.filter(id => lobbyProjects[id].name.toLowerCase().includes(term)) : ids;

                if (ids.length === 0) {
                    lobbyGrid.innerHTML = '';
                    lobbyEmpty.style.display = '';
                    return;
                }
                lobbyEmpty.style.display = 'none';

                let html = '';
                filtered.forEach(id => {
                    const p = lobbyProjects[id];
                    const fileCount = countFilesInLobbyProject(id);
                    const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '';
                    const isPublic = p.visibility === 'public';
                    const badge = isPublic
                        ? `<span class="lobby-badge public"><i class="fas fa-globe"></i> Public${p.hasPassword ? ' <i class="fas fa-key" title="Password protected"></i>' : ''}</span>`
                        : `<span class="lobby-badge private"><i class="fas fa-lock"></i> Private</span>`;
                    html += `
                        <div class="lobby-card" data-lobby-id="${id}">
                            <div class="lobby-card-actions">
                                <button class="lobby-share-btn ${isPublic ? 'is-public' : ''}" data-lobby-id="${id}" title="${isPublic ? 'Manage sharing' : 'Make public'}"><i class="fas fa-${isPublic ? 'globe' : 'share-alt'}"></i></button>
                                <button class="lobby-rename-btn" data-lobby-id="${id}" title="Rename"><i class="fas fa-pen"></i></button>
                                <button class="lobby-delete-btn danger" data-lobby-id="${id}" title="Delete"><i class="fas fa-trash"></i></button>
                            </div>
                            <div class="lobby-card-icon"><i class="fas fa-folder"></i></div>
                            <div class="lobby-card-name">${escapeHtml(p.name)}</div>
                            <div class="lobby-card-meta">${fileCount} file${fileCount === 1 ? '' : 's'} · created ${dateStr}</div>
                            ${badge}
                        </div>
                    `;
                });
                lobbyGrid.innerHTML = html;

                lobbyGrid.querySelectorAll('.lobby-card').forEach(card => {
                    card.addEventListener('click', (e) => {
                        if (e.target.closest('button')) return;
                        openLobbyProject(card.dataset.lobbyId);
                    });
                });
                lobbyGrid.querySelectorAll('.lobby-rename-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        renameLobbyProject(btn.dataset.lobbyId);
                    });
                });
                lobbyGrid.querySelectorAll('.lobby-delete-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        deleteLobbyProject(btn.dataset.lobbyId);
                    });
                });
                lobbyGrid.querySelectorAll('.lobby-share-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openShareModal(btn.dataset.lobbyId);
                    });
                });
            }

            // ──── PUBLIC / PRIVATE SHARING ────

            function switchLobbyTab(tab) {
                lobbyTab = tab;
                lobbyTabMine.classList.toggle('active', tab === 'mine');
                lobbyTabPublic.classList.toggle('active', tab === 'public');
                lobbyNewProjectBtn.style.display = tab === 'mine' ? '' : 'none';
                lobbyGrid.style.display = tab === 'mine' ? '' : 'none';
                lobbyEmpty.style.display = 'none';
                publicGrid.style.display = tab === 'public' ? '' : 'none';
                publicEmpty.style.display = 'none';
                publicLoading.style.display = 'none';
                lobbySearchInput.value = '';
                lobbySearchTerm = '';
                if (tab === 'mine') {
                    renderLobby();
                } else {
                    publicGrid.innerHTML = '';
                    runPublicSearch('');
                }
            }

            async function runPublicSearch(term) {
                if (!supabaseConnected) {
                    publicLoading.style.display = 'none';
                    publicGrid.style.display = 'none';
                    publicEmpty.style.display = '';
                    publicEmpty.querySelector('p').textContent = 'Not connected to Supabase — public search is unavailable.';
                    return;
                }
                publicGrid.style.display = 'none';
                publicEmpty.style.display = 'none';
                publicLoading.style.display = '';
                try {
                    let query = supabase
                        .from(LOBBY_PROJECTS_TABLE)
                        .select('id,name,file_count,has_password,updated_at')
                        .eq('visibility', 'public')
                        .order('updated_at', { ascending: false })
                        .limit(60);
                    if (term.trim()) query = query.ilike('name', `%${term.trim()}%`);
                    const { data, error } = await query;
                    publicLoading.style.display = 'none';
                    if (error) {
                        console.error('Public search error:', error);
                        publicEmpty.style.display = '';
                        publicEmpty.querySelector('p').textContent = 'Could not load public projects: ' + error.message;
                        return;
                    }
                    publicResults = data || [];
                    renderPublicGrid();
                } catch (err) {
                    publicLoading.style.display = 'none';
                    publicEmpty.style.display = '';
                    publicEmpty.querySelector('p').textContent = 'Could not load public projects: ' + err.message;
                }
            }

            function renderPublicGrid() {
                if (publicResults.length === 0) {
                    publicGrid.style.display = 'none';
                    publicGrid.innerHTML = '';
                    publicEmpty.style.display = '';
                    publicEmpty.querySelector('p').textContent = 'No public projects found. Try a different search, or ask a project owner to publish theirs.';
                    return;
                }
                publicEmpty.style.display = 'none';
                publicGrid.style.display = '';
                let html = '';
                publicResults.forEach(p => {
                    const dateStr = p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '';
                    html += `
                        <div class="lobby-card" data-public-id="${p.id}">
                            <div class="lobby-card-icon"><i class="fas fa-folder"></i></div>
                            <div class="lobby-card-name">${escapeHtml(p.name)}</div>
                            <div class="lobby-card-meta">${p.file_count || 0} file${p.file_count === 1 ? '' : 's'} · updated ${dateStr}</div>
                            <span class="lobby-badge public"><i class="fas fa-eye"></i> View only${p.has_password ? ' <i class="fas fa-key" title="Password protected"></i>' : ''}</span>
                        </div>
                    `;
                });
                publicGrid.innerHTML = html;
                publicGrid.querySelectorAll('.lobby-card').forEach(card => {
                    card.addEventListener('click', () => openPublicProject(card.dataset.publicId));
                });
            }

            async function openShareModal(id) {
                const p = lobbyProjects[id];
                if (!p) return;
                const isPublic = p.visibility === 'public';
                let bodyHtml = '';
                if (isPublic) {
                    bodyHtml = `
                        <div class="share-status-line"><i class="fas fa-globe"></i> This project is public. Anyone can find and view it (read-only) in the Public Projects search.</div>
                        <div class="form-group">
                            <label>Password (optional)</label>
                            <input type="text" id="sharePasswordInput" placeholder="${p.hasPassword ? 'Leave blank to keep current password' : 'Leave blank for no password'}" />
                            <p class="share-note">Republishing uploads the current files as the shared copy. Leave the password field blank to keep it as-is; type a new one to change it, or type <strong>REMOVE</strong> to clear it.</p>
                        </div>
                        <button type="button" id="shareUnpublishBtn"><i class="fas fa-lock"></i> Make Private</button>
                    `;
                } else {
                    bodyHtml = `
                        <div class="form-group">
                            <label>Password (optional)</label>
                            <input type="text" id="sharePasswordInput" placeholder="Leave blank for no password" />
                            <p class="share-note">Anyone will be able to find "${escapeHtml(p.name)}" in Public Projects search and view its files as read-only. They can't edit or delete anything. Set a password if you only want people who have it to be able to open it.</p>
                        </div>
                    `;
                }

                let unpublishClicked = false;
                const wireUnpublishBtn = () => {
                    const unpublishBtn = document.getElementById('shareUnpublishBtn');
                    if (unpublishBtn) {
                        unpublishBtn.addEventListener('click', () => {
                            unpublishClicked = true;
                            closeModal(null);
                        });
                    }
                };
                setTimeout(wireUnpublishBtn, 50);

                const result = await openModal(
                    isPublic ? 'Sharing Settings' : 'Publish Project',
                    isPublic ? 'Update or remove sharing for this project.' : 'Make this project visible in the public search.',
                    bodyHtml,
                    isPublic ? 'Update & Republish' : 'Publish',
                    'primary'
                );

                if (unpublishClicked) {
                    await unpublishLobbyProject(id);
                    return;
                }
                if (result === null) return;
                const pwField = result[0];
                await publishLobbyProject(id, pwField);
            }

            async function publishLobbyProject(id, passwordFieldValue) {
                const p = lobbyProjects[id];
                if (!p) return;
                if (!supabaseConnected) { toast('❌ Not connected to Supabase.', 'error'); return; }

                let raw = null;
                try { raw = localStorage.getItem(STORAGE_PREFIX + '__' + id); } catch (_) { /* ignore */ }
                const filesSnapshot = raw ? JSON.parse(raw) : {};
                const fileCount = Object.keys(filesSnapshot || {}).length;

                let passwordHash = null;
                let hasPassword = p.hasPassword || false;
                const val = (passwordFieldValue || '').trim();
                if (val) {
                    if (val === 'REMOVE' && p.visibility === 'public') {
                        passwordHash = null;
                        hasPassword = false;
                    } else {
                        passwordHash = await sha256Hex(val);
                        hasPassword = true;
                    }
                } else if (p.visibility !== 'public') {
                    // fresh publish, no password entered
                    passwordHash = null;
                    hasPassword = false;
                } else {
                    // republish, keep existing password unchanged — fetch it so we don't wipe it
                    try {
                        const { data } = await supabase.from(LOBBY_PROJECTS_TABLE).select('password_hash').eq('id', id).single();
                        passwordHash = data ? data.password_hash : null;
                    } catch (_) { passwordHash = null; }
                }

                try {
                    const { error } = await supabase.from(LOBBY_PROJECTS_TABLE).upsert({
                        id,
                        name: p.name,
                        visibility: 'public',
                        password_hash: passwordHash,
                        has_password: hasPassword,
                        file_count: fileCount,
                        files: filesSnapshot,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'id' });
                    if (error) {
                        console.error('Publish error:', error);
                        toast('❌ Failed to publish: ' + error.message, 'error');
                        return;
                    }
                    p.visibility = 'public';
                    p.hasPassword = hasPassword;
                    saveLobby();
                    renderLobby();
                    toast(`✅ "${p.name}" is now public.`, 'success');
                } catch (err) {
                    toast('❌ Failed to publish: ' + err.message, 'error');
                }
            }

            async function unpublishLobbyProject(id) {
                const p = lobbyProjects[id];
                if (!p) return;
                if (!confirm(`Make "${p.name}" private again? It will be removed from public search.`)) return;
                if (supabaseConnected) {
                    try {
                        const { error } = await supabase.from(LOBBY_PROJECTS_TABLE).delete().eq('id', id);
                        if (error) console.error('Unpublish error:', error);
                    } catch (err) { console.error('Unpublish error:', err); }
                }
                p.visibility = 'private';
                p.hasPassword = false;
                saveLobby();
                renderLobby();
                toast(`"${p.name}" is now private.`, 'success');
            }

            async function openPublicProject(id) {
                if (!supabaseConnected) { toast('❌ Not connected to Supabase.', 'error'); return; }
                try {
                    const { data, error } = await supabase.from(LOBBY_PROJECTS_TABLE).select('*').eq('id', id).eq('visibility', 'public').single();
                    if (error || !data) {
                        toast('❌ Could not load that project.', 'error');
                        return;
                    }
                    if (data.password_hash) {
                        const pw = prompt(`"${data.name}" is password protected. Enter the password to view it:`);
                        if (pw === null) return;
                        const hash = await sha256Hex(pw);
                        if (hash !== data.password_hash) {
                            toast('❌ Incorrect password.', 'error');
                            return;
                        }
                    }
                    enterPublicViewMode(data);
                } catch (err) {
                    toast('❌ Could not load that project: ' + err.message, 'error');
                }
            }

            function enterPublicViewMode(data) {
                isPublicViewMode = true;
                activeLobbyId = null;
                projects = data.files || {};
                for (const [, proj] of Object.entries(projects)) migrateProject(proj);
                const ids = Object.keys(projects);
                currentProjectId = ids.length ? ids[0] : null;
                if (!currentProjectId) {
                    projects['_empty'] = createDefaultProject('File 1');
                    currentProjectId = '_empty';
                }

                activeProjectName.textContent = data.name;
                viewOnlyBannerText.textContent = `Public project "${data.name}" — view only`;
                appEl.classList.add('view-only-mode');
                lobbyScreen.style.display = 'none';
                appEl.style.display = '';
                renderAll();
            }

            function createLobbyProject() {
                const name = prompt('Enter new project name:', 'Project ' + (Object.keys(lobbyProjects).length + 1));
                if (name === null) return;
                const trimmed = name.trim() || 'Untitled Project';
                const id = generateId();
                lobbyProjects[id] = { name: trimmed, createdAt: Date.now(), updatedAt: Date.now(), visibility: 'private', hasPassword: false };
                saveLobby();
                renderLobby();
                toast(`Project "${trimmed}" created.`, 'success');
                openLobbyProject(id);
            }

            function renameLobbyProject(id) {
                const p = lobbyProjects[id];
                if (!p) return;
                const newName = prompt('Rename project:', p.name);
                if (newName === null) return;
                p.name = newName.trim() || 'Untitled Project';
                p.updatedAt = Date.now();
                saveLobby();
                renderLobby();
                if (activeLobbyId === id) activeProjectName.textContent = p.name;
            }

            function deleteLobbyProject(id) {
                const p = lobbyProjects[id];
                if (!p) return;
                if (!confirm(`Delete project "${p.name}" and all its files? This cannot be undone.`)) return;
                delete lobbyProjects[id];
                localStorage.removeItem(STORAGE_PREFIX + '__' + id);
                localStorage.removeItem(CURRENT_PROJECT_PREFIX + '__' + id);
                saveLobby();
                renderLobby();
                toast('Project deleted.', 'success');
            }

            function openLobbyProject(id) {
                const p = lobbyProjects[id];
                if (!p) return;
                activeLobbyId = id;
                p.updatedAt = Date.now();
                saveLobby();

                const hasSaved = loadProjects();
                if (!hasSaved || Object.keys(projects).length === 0) {
                    const fid = generateId();
                    projects[fid] = createDefaultProject('File 1');
                    currentProjectId = fid;
                    saveProjects();
                }
                if (!currentProjectId || !projects[currentProjectId]) {
                    const ids = Object.keys(projects);
                    currentProjectId = ids.length ? ids[0] : null;
                }

                activeProjectName.textContent = p.name;
                lobbyScreen.style.display = 'none';
                appEl.style.display = '';
                renderAll();
            }

            function backToLobby() {
                const wasPublicView = isPublicViewMode;
                isPublicViewMode = false;
                activeLobbyId = null;
                appEl.classList.remove('view-only-mode');
                appEl.style.display = 'none';
                lobbyScreen.style.display = '';
                if (wasPublicView) {
                    switchLobbyTab('public');
                } else {
                    renderLobby();
                }
            }

            function initApp() {
                loadTheme();

                // Initialize Supabase
                const connected = initSupabase();

                // Create autocomplete dropdown
                createAutocompleteDropdown();

                loadLobby();
                migrateLegacyDataIfNeeded();
                renderLobby();

                // ── Lobby event listeners ──
                lobbyNewProjectBtn.addEventListener('click', createLobbyProject);
                lobbySearchInput.addEventListener('input', (e) => {
                    const term = e.target.value;
                    if (lobbyTab === 'mine') {
                        lobbySearchTerm = term;
                        renderLobby();
                    } else {
                        clearTimeout(publicSearchDebounce);
                        publicSearchDebounce = setTimeout(() => runPublicSearch(term), 350);
                    }
                });
                lobbyTabMine.addEventListener('click', () => switchLobbyTab('mine'));
                lobbyTabPublic.addEventListener('click', () => switchLobbyTab('public'));
                backToLobbyBtn.addEventListener('click', backToLobby);

                // ── Workspace event listeners ──
                sheetTitle.addEventListener('change', () => {
                    if (isPublicViewMode) return;
                    const proj = getCurrentProject();
                    if (!proj) return;
                    proj.title = sheetTitle.value.trim() || 'Untitled Sheet';
                    saveProjects();
                    updateTimestamp();
                });

                searchInput.addEventListener('input', (e) => {
                    searchTerm = e.target.value;
                    renderSheet();
                });

                addRowBtn.addEventListener('click', addEmptyRow);
                addColBtn.addEventListener('click', openAddColumnModal);
                addHeaderBtn.addEventListener('click', toggleHeaderTitle);
                clearAllBtn.addEventListener('click', clearAllData);
                resetDataBtn.addEventListener('click', resetToDefault);
                exportCsvBtn.addEventListener('click', exportCSV);
                importCsvBtn.addEventListener('click', () => csvFileInput.click());
                csvFileInput.addEventListener('change', (e) => {
                    if (e.target.files.length > 0) {
                        importCSV(e.target.files[0]);
                        e.target.value = '';
                    }
                });
                themeToggle.addEventListener('click', toggleTheme);

                // ⭐ SAVE BUTTON ⭐
                saveToSupabaseBtn.addEventListener('click', saveCurrentProjectToSupabase);

                addProjectBtn.addEventListener('click', addProject);
                renameProjectBtn.addEventListener('click', () => {
                    if (currentProjectId) openRenameProjectModal(currentProjectId);
                });
                deleteProjectBtn.addEventListener('click', () => {
                    if (currentProjectId) deleteProject(currentProjectId);
                });

                settingsBtn.addEventListener('click', openSettingsModal);

                document.addEventListener('keydown', (e) => {
                    if (isPublicViewMode) return;
                    if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
                        e.preventDefault();
                        if (appEl.style.display !== 'none') addEmptyRow();
                    }
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                        e.preventDefault();
                        if (appEl.style.display !== 'none') saveCurrentProjectToSupabase();
                    }
                });

                saveStatusText.textContent = 'Unsaved changes';
                saveIndicator.className = 'save-indicator unsaved';

                if (connected) {
                    toast('✅ Ready! Pick a project to get started.', 'success', 4000);
                }
            }

            initApp();
        })();
