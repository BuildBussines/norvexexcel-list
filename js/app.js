let supabase;
let supabaseConnected = false;

function initSupabase() {
    try {
        supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
        supabaseConnected = true;
        window.updateConnectionStatus(true);
        window.toast('âœ… Connected to Supabase!', 'success');
        return true;
    } catch (error) {
        supabaseConnected = false;
        window.updateConnectionStatus(false);
        window.toast('âŒ Failed to connect to Supabase: ' + error.message, 'error');
        return false;
    }
}

async function saveProjectToSupabase(projectId) {
    if (!supabase || !supabaseConnected) {
        window.toast('âš ï¸ Not connected to Supabase.', 'error');
        return false;
    }
    const proj = window.projects[projectId];
    if (!proj) return false;
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
            .upsert(data, { onConflict: 'id', ignoreDuplicates: false });
        if (error) {
            window.toast('âŒ Failed to save: ' + error.message, 'error');
            return false;
        }
        window.toast('âœ… Data saved to Supabase successfully!', 'success', 3000);
        return true;
    } catch (error) {
        window.toast('âŒ Failed to save: ' + error.message, 'error');
        return false;
    }
}

async function saveCurrentProjectToSupabase() {
    if (isSaving) return;
    if (!window.currentProjectId || !window.projects[window.currentProjectId]) {
        window.toast('No project to save.', 'error');
        return;
    }
    if (!supabaseConnected) {
        window.toast('âŒ Not connected to Supabase.', 'error');
        return;
    }
    isSaving = true;
    const btn = document.getElementById('saveToSupabaseBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner"></i> Saving...';
    document.getElementById('saveStatusText').textContent = 'Saving...';
    document.getElementById('saveIndicator').className = 'save-indicator saving';
    try {
        const success = await saveProjectToSupabase(window.currentProjectId);
        if (success) {
            document.getElementById('saveStatusText').textContent = 'Saved to Cloud âœ“';
            document.getElementById('saveIndicator').className = 'save-indicator saved';
        } else {
            document.getElementById('saveStatusText').textContent = 'Save failed!';
            document.getElementById('saveIndicator').className = 'save-indicator error';
        }
    } catch (error) {
        document.getElementById('saveStatusText').textContent = 'Save failed!';
        document.getElementById('saveIndicator').className = 'save-indicator error';
    } finally {
        isSaving = false;
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Save to Cloud';
        setTimeout(() => {
            if (!isSaving && document.getElementById('saveStatusText').textContent !== 'Saving...') {
                document.getElementById('saveStatusText').textContent = 'Ready';
                document.getElementById('saveIndicator').className = 'save-indicator saved';
            }
        }, 5000);
    }
}

function updateConnectionStatus(connected) {
    const dot = document.getElementById('connectionDot');
    const text = document.getElementById('connectionText');
    if (connected) {
        dot.className = 'dot connected';
        text.textContent = 'Connected';
    } else {
        dot.className = 'dot disconnected';
        text.textContent = 'Disconnected';
    }
}

function applyTheme(theme) {
    document.documentElement.className = '';
    if (theme !== 'light') document.documentElement.classList.add('theme-' + theme);
    const toggle = document.getElementById('themeToggle');
    toggle.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    window.currentTheme = theme;
    localStorage.setItem(window.THEME_KEY, theme);
}

function toggleTheme() {
    const themes = ['light', 'dark', 'ocean', 'forest', 'sunset', 'purple'];
    const idx = themes.indexOf(window.currentTheme);
    const next = (idx + 1) % themes.length;
    applyTheme(themes[next]);
    window.toast('Theme: ' + themes[next], 'info');
    if (window.isSettingsModalOpen) window.refreshSettingsModalContent();
}

// Make global
window.saveProjectToSupabase = saveProjectToSupabase;
window.saveCurrentProjectToSupabase = saveCurrentProjectToSupabase;
window.updateConnectionStatus = updateConnectionStatus;
window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;

// Load theme
(function loadTheme() {
    const saved = localStorage.getItem(window.THEME_KEY) || 'light';
    window.currentTheme = saved;
    applyTheme(saved);
})();

// Initialise everything
document.addEventListener('DOMContentLoaded', () => {
    const hasSaved = window.loadProjects();
    if (!hasSaved || Object.keys(window.projects).length === 0) {
        const id = window.generateId();
        window.projects[id] = window.createDefaultProject('Project 1');
        window.currentProjectId = id;
        window.saveProjects();
    }
    if (!window.currentProjectId || !window.projects[window.currentProjectId]) {
        const ids = Object.keys(window.projects);
        window.currentProjectId = ids.length ? ids[0] : null;
        if (!window.currentProjectId) {
            const id = window.generateId();
            window.projects[id] = window.createDefaultProject('Project 1');
            window.currentProjectId = id;
            window.saveProjects();
        }
    }

    initSupabase();
    window.createAutocompleteDropdown();
    window.renderAll();
    window.bindEvents();  // from events.js

    document.getElementById('saveStatusText').textContent = 'Unsaved changes';
    document.getElementById('saveIndicator').className = 'save-indicator unsaved';
});
