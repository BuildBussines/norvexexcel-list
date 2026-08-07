// State management for multi-project data
window.STORAGE_KEY = 'norvex_projects_data_v3';
window.THEME_KEY = 'norvex_theme';
window.CURRENT_PROJECT_KEY = 'norvex_current_project';

let projects = {};
let currentProjectId = null;
let searchTerm = '';
let currentTheme = 'light';
let isSaving = false;

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
    try {
        const raw = localStorage.getItem(window.STORAGE_KEY);
        const oldRaw = localStorage.getItem('norvex_projects_data_v2') || localStorage.getItem('norvex_projects_data');
        const data = raw || oldRaw;
        if (data) {
            const parsed = JSON.parse(data);
            if (typeof parsed === 'object' && parsed !== null) {
                projects = parsed;
                for (const [, proj] of Object.entries(projects)) {
                    migrateProject(proj);
                }
                const savedCurrent = localStorage.getItem(window.CURRENT_PROJECT_KEY);
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

function saveProjects() {
    try {
        localStorage.setItem(window.STORAGE_KEY, JSON.stringify(projects));
        localStorage.setItem(window.CURRENT_PROJECT_KEY, currentProjectId || '');
        if (!isSaving) {
            document.getElementById('saveStatusText').textContent = 'Unsaved changes';
            document.getElementById('saveIndicator').className = 'save-indicator unsaved';
        }
    } catch (_) { /* ignore */ }
}

function getCurrentProject() {
    if (!currentProjectId || !projects[currentProjectId]) return null;
    return projects[currentProjectId];
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
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

// Expose to global scope
window.createDefaultProject = createDefaultProject;
window.projects = projects;
window.currentProjectId = currentProjectId;
window.searchTerm = searchTerm;
window.currentTheme = currentTheme;
window.loadProjects = loadProjects;
window.saveProjects = saveProjects;
window.getCurrentProject = getCurrentProject;
window.generateId = generateId;
window.toggleInArray = toggleInArray;
