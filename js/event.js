function bindEvents() {
    const $ = (sel) => document.querySelector(sel);

    $('#sheetTitle').addEventListener('change', () => {
        const proj = window.getCurrentProject();
        if (!proj) return;
        proj.title = $('#sheetTitle').value.trim() || 'Untitled Sheet';
        window.saveProjects();
        document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
    });

    $('#searchInput').addEventListener('input', (e) => {
        window.searchTerm = e.target.value;
        window.renderSheet();
    });

    $('#addRowBtn').addEventListener('click', window.addEmptyRow);
    $('#addColBtn').addEventListener('click', window.openAddColumnModal);
    $('#addHeaderBtn').addEventListener('click', window.toggleHeaderTitle);
    $('#clearAllBtn').addEventListener('click', window.clearAllData);
    $('#resetDataBtn').addEventListener('click', window.resetToDefault);
    $('#exportCsvBtn').addEventListener('click', window.exportCSV);
    $('#importCsvBtn').addEventListener('click', () => $('#csvFileInput').click());
    $('#csvFileInput').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            window.importCSV(e.target.files[0]);
            e.target.value = '';
        }
    });
    $('#themeToggle').addEventListener('click', window.toggleTheme);
    $('#saveToSupabaseBtn').addEventListener('click', window.saveCurrentProjectToSupabase);
    $('#addProjectBtn').addEventListener('click', window.addProject);
    $('#renameProjectBtn').addEventListener('click', () => {
        if (window.currentProjectId) window.openRenameProjectModal(window.currentProjectId);
    });
    $('#deleteProjectBtn').addEventListener('click', () => {
        if (window.currentProjectId) window.deleteProject(window.currentProjectId);
    });
    $('#settingsBtn').addEventListener('click', window.openSettingsModal);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
            e.preventDefault();
            window.addEmptyRow();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            window.saveCurrentProjectToSupabase();
        }
    });

    // Modal events
    const modalConfirmBtn = $('#modalConfirmBtn');
    const modalCancelBtn = $('#modalCancelBtn');
    const modalOverlay = $('#modalOverlay');
    modalConfirmBtn.addEventListener('click', window.modalConfirmHandler);
    modalCancelBtn.addEventListener('click', () => window.closeModal(null));
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) window.closeModal(null); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalOverlay.classList.contains('open')) window.closeModal(null);
        if (e.key === 'Enter' && modalOverlay.classList.contains('open') && !window.isSettingsModalOpen) {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) modalConfirmBtn.click();
        }
    });
}
