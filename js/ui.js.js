// ui.js – all rendering, modals, autocomplete, toasts, CSV export/import

(function () {
    'use strict';

    // ---------- DOM helpers ----------
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ---------- Autocomplete system ----------
    let autocompleteDropdown = null;
    let autocompleteItems = [];
    let selectedAutocompleteIndex = -1;
    let activeAutocompleteInput = null;

    function createAutocompleteDropdown() {
        if (autocompleteDropdown) return;
        autocompleteDropdown = document.createElement('div');
        autocompleteDropdown.className = 'autocomplete-dropdown';
        autocompleteDropdown.id = 'autocompleteDropdown';
        document.body.appendChild(autocompleteDropdown);

        document.addEventListener('click', (e) => {
            if (autocompleteDropdown && !autocompleteDropdown.contains(e.target) && e.target !== activeAutocompleteInput) {
                hideAutocomplete();
            }
        });
        autocompleteDropdown.addEventListener('mousedown', (e) => e.preventDefault());
    }

    function getColumnValues(colIndex) {
        const proj = window.getCurrentProject();
        if (!proj) return { columnValues: new Map(), allValues: new Map() };

        const columnValues = new Map();
        const allValues = new Map();

        proj.rows.forEach(row => {
            const colVal = String(row[colIndex] || '').trim();
            if (colVal) columnValues.set(colVal, (columnValues.get(colVal) || 0) + 1);

            row.forEach(cell => {
                const val = String(cell || '').trim();
                if (val) allValues.set(val, (allValues.get(val) || 0) + 1);
            });
        });
        return { columnValues, allValues };
    }

    function showAutocomplete(input, colIndex) {
        const value = input.value.trim();
        if (!value) { hideAutocomplete(); return; }

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

        if (autocompleteItems.length === 0) { hideAutocomplete(); return; }

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
            item.addEventListener('click', () => {
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
            activeAutocompleteInput.dispatchEvent(new Event('change', { bubbles: true }));
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

    // ---------- Table & sheet rendering ----------
    function renderAll() {
        renderProjectTabs();
        renderSheet();
        if (window.isSettingsModalOpen) refreshSettingsModalContent();
    }

    function renderProjectTabs() {
        const ids = Object.keys(window.projects);
        if (ids.length === 0) {
            const id = window.generateId();
            window.projects[id] = window.createDefaultProject('Project 1');
            window.currentProjectId = id;
            window.saveProjects();
            renderProjectTabs();
            renderSheet();
            return;
        }
        let html = '';
        ids.forEach(id => {
            const proj = window.projects[id];
            const active = id === window.currentProjectId ? 'active' : '';
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
        $('#projectTabs').innerHTML = html;

        $$('.project-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const id = tab.dataset.projectId;
                if (id && id !== window.currentProjectId) switchProject(id);
            });
        });
        $$('.rename-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.projectId;
                if (id) openRenameProjectModal(id);
            });
        });
        $$('.delete-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.projectId;
                if (id) deleteProject(id);
            });
        });
    }

    function renderSheet() {
        const proj = window.getCurrentProject();
        if (!proj) {
            const id = window.generateId();
            window.projects[id] = window.createDefaultProject('Project 1');
            window.currentProjectId = id;
            window.saveProjects();
            renderAll();
            return;
        }

        $('#sheetTitle').value = proj.title || '';

        const term = window.searchTerm.trim().toLowerCase();
        let filteredRows = proj.rows;
        if (term) {
            filteredRows = proj.rows.filter(row =>
                row.some(cell => String(cell).toLowerCase().includes(term))
            );
        }

        // Normalize arrays
        while (proj.columnDividers.length < proj.columns.length) proj.columnDividers.push(true);
        while (proj.columnDividers.length > proj.columns.length) proj.columnDividers.pop();
        while (proj.highlightedCols.length > proj.columns.length) proj.highlightedCols.pop();
        proj.headingRows = proj.headingRows.filter(r => r >= 0 && r < proj.rows.length);
        proj.highlightedRows = proj.highlightedRows.filter(r => r >= 0 && r < proj.rows.length);
        proj.highlightedCols = proj.highlightedCols.filter(c => c >= 0 && c < proj.columns.length);

        // Table head
        let headHtml = '<tr><th style="width:40px;text-align:center;">#</th>';
        proj.columns.forEach((col, idx) => {
            const dividerClass = proj.columnDividers[idx] ? '' : 'no-divider';
            const highlightClass = proj.highlightedCols.includes(idx) ? 'highlighted-col' : '';
            headHtml += `
                <th class="${dividerClass} ${highlightClass}">
                    <div class="col-header-wrapper">
                        <span class="col-label">
                            <input type="text" value="${escapeHtml(col)}" data-col-index="${idx}" class="col-name-input" placeholder="Column…">
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
        headHtml += `<th style="width:140px;text-align:center;"><span style="color:var(--text2);font-size:12px;">Actions</span></th></tr>`;
        $('#tableHead').innerHTML = headHtml;

        // Table body
        let bodyHtml = '';
        if (filteredRows.length === 0 && !proj.hasHeaderTitle) {
            bodyHtml = `<tr class="empty-row"><td colspan="${proj.columns.length + 2}">${term ? 'No rows match your search.' : 'No data yet. Click "Add Row" to get started.'}</td></tr>`;
        } else {
            if (proj.hasHeaderTitle) {
                bodyHtml += `<tr class="header-title-row"><td colspan="${proj.columns.length + 2}">${escapeHtml(proj.title || 'Website Data')}</td></tr>`;
            }
            if (filteredRows.length === 0 && proj.hasHeaderTitle) {
                bodyHtml += `<tr class="empty-row"><td colspan="${proj.columns.length + 2}">${term ? 'No rows match your search.' : 'No data yet.'}</td></tr>`;
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
                                <input type="text" class="cell-input" value="${escapeHtml(String(val))}" data-row="${realIndex}" data-col="${colIdx}" autocomplete="off">
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
        }
        $('#tableBody').innerHTML = bodyHtml;

        $('#rowCount').textContent = filteredRows.length;
        $('#lastUpdated').textContent = new Date().toLocaleTimeString();
        window.saveProjects();
        bindTableEvents();
    }

    // ---------- Table event handlers ----------
    function bindTableEvents() {
        $$('.cell-input').forEach(inp => {
            inp.removeEventListener('change', onCellChange);
            inp.addEventListener('change', onCellChange);
            inp.removeEventListener('input', onCellInput);
            inp.addEventListener('input', onCellInput);
            inp.removeEventListener('keydown', onCellKeydown);
            inp.addEventListener('keydown', onCellKeydown);
            inp.removeEventListener('blur', onCellBlur);
            inp.addEventListener('blur', onCellBlur);
        });
        $$('.col-name-input').forEach(inp => {
            inp.removeEventListener('change', onColNameChange);
            inp.addEventListener('change', onColNameChange);
        });
        $$('.delete-col-btn').forEach(btn => {
            btn.removeEventListener('click', onDeleteCol);
            btn.addEventListener('click', onDeleteCol);
        });
        $$('.toggle-divider-btn').forEach(btn => {
            btn.removeEventListener('click', onToggleDivider);
            btn.addEventListener('click', onToggleDivider);
        });
        $$('.rename-col-btn').forEach(btn => {
            btn.removeEventListener('click', onRenameCol);
            btn.addEventListener('click', onRenameCol);
        });
        $$('.highlight-col-btn').forEach(btn => {
            btn.removeEventListener('click', onToggleColHighlight);
            btn.addEventListener('click', onToggleColHighlight);
        });
        $$('.delete-row-btn').forEach(btn => {
            btn.removeEventListener('click', onDeleteRow);
            btn.addEventListener('click', onDeleteRow);
        });
        $$('.edit-row-btn').forEach(btn => {
            btn.removeEventListener('click', onEditRow);
            btn.addEventListener('click', onEditRow);
        });
        $$('.duplicate-row-btn').forEach(btn => {
            btn.removeEventListener('click', onDuplicateRow);
            btn.addEventListener('click', onDuplicateRow);
        });
        $$('.highlight-row-btn').forEach(btn => {
            btn.removeEventListener('click', onToggleRowHighlight);
            btn.addEventListener('click', onToggleRowHighlight);
        });
    }

    // Individual event callbacks
    function onCellChange(e) {
        const inp = e.target;
        const row = parseInt(inp.dataset.row);
        const col = parseInt(inp.dataset.col);
        const proj = window.getCurrentProject();
        if (!proj) return;
        if (!isNaN(row) && !isNaN(col) && proj.rows[row]) {
            proj.rows[row][col] = inp.value;
            window.saveProjects();
            $('#lastUpdated').textContent = new Date().toLocaleTimeString();
        }
    }

    function onCellInput(e) {
        const inp = e.target;
        const col = parseInt(inp.dataset.col);
        if (!isNaN(col)) showAutocomplete(inp, col);
    }

    function onCellKeydown(e) {
        const inp = e.target;
        const proj = window.getCurrentProject();
        if (!proj) return;

        if (autocompleteDropdown && autocompleteDropdown.classList.contains('active')) {
            if (e.key === 'ArrowDown') { e.preventDefault(); navigateAutocomplete('down'); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); navigateAutocomplete('up'); return; }
            if (e.key === 'Enter') {
                if (selectedAutocompleteIndex >= 0 && selectedAutocompleteIndex < autocompleteItems.length) {
                    e.preventDefault();
                    selectAutocompleteItem(selectedAutocompleteIndex);
                } else {
                    e.preventDefault();
                    hideAutocomplete();
                    moveToNextCell(inp, proj);
                }
                return;
            }
            if (e.key === 'Escape') { e.preventDefault(); hideAutocomplete(); return; }
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
        const allInputs = Array.from($$('.cell-input'));
        // Try next column in same row
        if (currentCol < numCols - 1) {
            const nextInput = allInputs.find(inp =>
                parseInt(inp.dataset.row) === currentRow && parseInt(inp.dataset.col) === currentCol + 1
            );
            if (nextInput) { nextInput.focus(); nextInput.select(); return; }
        }
        // Try first column of next row
        const nextRowInputs = allInputs.filter(inp => parseInt(inp.dataset.row) === currentRow + 1);
        if (nextRowInputs.length > 0) {
            const firstColInput = nextRowInputs.find(inp => parseInt(inp.dataset.col) === 0);
            if (firstColInput) { firstColInput.focus(); firstColInput.select(); return; }
        }
        // Wrap to first row, first column
        const firstRowInputs = allInputs.filter(inp => parseInt(inp.dataset.row) === 0);
        if (firstRowInputs.length > 0) {
            const firstColInput = firstRowInputs.find(inp => parseInt(inp.dataset.col) === 0);
            if (firstColInput) { firstColInput.focus(); firstColInput.select(); }
        }
    }

    function onCellBlur(e) {
        setTimeout(() => {
            if (activeAutocompleteInput === e.target && autocompleteDropdown && !autocompleteDropdown.matches(':hover')) {
                hideAutocomplete();
            }
        }, 150);
    }

    function onColNameChange(e) {
        const inp = e.target;
        const idx = parseInt(inp.dataset.colIndex);
        const proj = window.getCurrentProject();
        if (!proj) return;
        if (!isNaN(idx) && proj.columns[idx] !== undefined) {
            const newName = inp.value.trim() || 'Column';
            proj.columns[idx] = newName;
            inp.value = newName;
            window.saveProjects();
            $('#lastUpdated').textContent = new Date().toLocaleTimeString();
            renderSheet();
        }
    }

    function onDeleteCol(e) {
        const btn = e.currentTarget;
        const idx = parseInt(btn.dataset.colIndex);
        const proj = window.getCurrentProject();
        if (!proj) return;
        if (isNaN(idx) || idx < 0 || idx >= proj.columns.length) return;
        if (!confirm(`Delete column "${proj.columns[idx]}" and all its data?`)) return;
        proj.columns.splice(idx, 1);
        proj.rows.forEach(row => row.splice(idx, 1));
        proj.columnDividers.splice(idx, 1);
        proj.highlightedCols = proj.highlightedCols.filter(c => c !== idx).map(c => c > idx ? c - 1 : c);
        window.saveProjects();
        renderSheet();
        toast('Column deleted.', 'success');
    }

    function onToggleDivider(e) {
        const btn = e.currentTarget;
        const idx = parseInt(btn.dataset.colIndex);
        const proj = window.getCurrentProject();
        if (!proj) return;
        if (!isNaN(idx) && proj.columnDividers[idx] !== undefined) {
            proj.columnDividers[idx] = !proj.columnDividers[idx];
            window.saveProjects();
            renderSheet();
            toast(`Divider ${proj.columnDividers[idx] ? 'shown' : 'hidden'}.`, 'info');
        }
    }

    function onToggleColHighlight(e) {
        const btn = e.currentTarget;
        const idx = parseInt(btn.dataset.colIndex);
        const proj = window.getCurrentProject();
        if (!proj) return;
        if (!isNaN(idx) && idx >= 0 && idx < proj.columns.length) {
            const added = window.toggleInArray(proj.highlightedCols, idx);
            window.saveProjects();
            renderSheet();
            toast(`Column "${proj.columns[idx]}" ${added ? 'highlighted' : 'unhighlighted'}.`, 'info');
        }
    }

    function onRenameCol(e) {
        const btn = e.currentTarget;
        const idx = parseInt(btn.dataset.colIndex);
        if (!isNaN(idx)) {
            const inputs = $$('.col-name-input');
            const target = Array.from(inputs).find(inp => parseInt(inp.dataset.colIndex) === idx);
            if (target) { target.focus(); target.select(); }
        }
    }

    function onToggleRowHighlight(e) {
        const btn = e.currentTarget;
        const row = parseInt(btn.dataset.row);
        const proj = window.getCurrentProject();
        if (!proj) return;
        if (isNaN(row) || !proj.rows[row]) return;
        const added = window.toggleInArray(proj.highlightedRows, row);
        window.saveProjects();
        renderSheet();
        toast(`Row ${row + 1} ${added ? 'highlighted' : 'unhighlighted'}.`, 'info');
    }

    function onDeleteRow(e) {
        const btn = e.currentTarget;
        const row = parseInt(btn.dataset.row);
        const proj = window.getCurrentProject();
        if (!proj) return;
        if (isNaN(row) || !proj.rows[row]) return;
        if (!confirm('Delete this row?')) return;
        proj.rows.splice(row, 1);
        proj.headingRows = proj.headingRows.filter(r => r !== row).map(r => r > row ? r - 1 : r);
        proj.highlightedRows = proj.highlightedRows.filter(r => r !== row).map(r => r > row ? r - 1 : r);
        window.saveProjects();
        renderSheet();
        toast('Row deleted.', 'success');
    }

    function onEditRow(e) {
        const btn = e.currentTarget;
        const row = parseInt(btn.dataset.row);
        const proj = window.getCurrentProject();
        if (!proj) return;
        if (isNaN(row) || !proj.rows[row]) return;
        openEditRowModal(row);
    }

    function onDuplicateRow(e) {
        const btn = e.currentTarget;
        const row = parseInt(btn.dataset.row);
        const proj = window.getCurrentProject();
        if (!proj) return;
        if (isNaN(row) || !proj.rows[row]) return;
        const copy = [...proj.rows[row]];
        proj.rows.push(copy);
        window.saveProjects();
        renderSheet();
        toast('Row duplicated.', 'success');
    }

    // ---------- Project management ----------
    function switchProject(id) {
        if (id === window.currentProjectId) return;
        if (window.projects[id]) {
            window.currentProjectId = id;
            window.saveProjects();
            renderAll();
            toast(`Switched to "${window.projects[id].name}"`, 'info');
        }
    }

    function addProject() {
        const name = prompt('Enter new project name:', 'Project ' + (Object.keys(window.projects).length + 1));
        if (name === null) return;
        const trimmed = name.trim() || 'Untitled';
        const id = window.generateId();
        window.projects[id] = window.createDefaultProject(trimmed);
        window.currentProjectId = id;
        window.saveProjects();
        renderAll();
        toast(`Project "${trimmed}" created.`, 'success');
    }

    function openRenameProjectModal(id) {
        const proj = window.projects[id];
        if (!proj) return;
        const newName = prompt('Rename project:', proj.name);
        if (newName === null) return;
        const trimmed = newName.trim() || 'Untitled';
        proj.name = trimmed;
        window.saveProjects();
        renderAll();
        toast(`Project renamed to "${trimmed}".`, 'success');
    }

    function deleteProject(id) {
        if (!window.projects[id]) return;
        const ids = Object.keys(window.projects);
        if (ids.length <= 1) {
            toast('Cannot delete the last project.', 'error');
            return;
        }
        if (!confirm(`Delete project "${window.projects[id].name}"?`)) return;
        delete window.projects[id];
        if (window.currentProjectId === id) {
            const remaining = Object.keys(window.projects);
            window.currentProjectId = remaining[0] || null;
        }
        window.saveProjects();
        renderAll();
        toast('Project deleted.', 'success');
    }

    // ---------- Modal system ----------
    let modalResolve = null;
    window.isSettingsModalOpen = false;

    function openModal(title, sub, bodyHtml, confirmLabel = 'Save', confirmClass = 'primary') {
        return new Promise((resolve) => {
            $('#modalTitle').textContent = title;
            $('#modalSub').textContent = sub;
            $('#modalBody').innerHTML = bodyHtml;
            const confirmBtn = $('#modalConfirmBtn');
            confirmBtn.textContent = confirmLabel;
            confirmBtn.className = confirmClass;
            $('#modalOverlay').classList.add('open');
            modalResolve = resolve;
            $('#modalScroll').scrollTop = 0;
            setTimeout(() => {
                const firstInput = $('#modalBody').querySelector('input, select, textarea');
                if (firstInput) firstInput.focus();
            }, 80);
        });
    }

    function closeModal(result) {
        $('#modalOverlay').classList.remove('open');
        window.isSettingsModalOpen = false;
        if (modalResolve) {
            const resolve = modalResolve;
            modalResolve = null;
            resolve(result);
        }
    }

    // Handle modal confirm button
    function modalConfirmHandler() {
        if (window.isSettingsModalOpen) {
            closeModal(null);
            return;
        }
        const inputs = $('#modalBody').querySelectorAll('input, select, textarea');
        const data = Array.from(inputs).map(inp => {
            if (inp.type === 'checkbox') return inp.checked;
            return inp.value;
        });
        closeModal(data);
    }

    // Settings modal content
    function generateSettingsHTML() {
        let projectListHtml = '';
        const ids = Object.keys(window.projects);
        ids.forEach(id => {
            const proj = window.projects[id];
            const isActive = id === window.currentProjectId;
            projectListHtml += `
                <div class="settings-project-item">
                    <span class="name">${escapeHtml(proj.name)} ${isActive ? '⭐' : ''}</span>
                    <div class="actions">
                        <button data-settings-action="switch-project" data-project-id="${id}" title="Switch to this project"><i class="fas fa-arrow-right"></i> Switch</button>
                        <button data-settings-action="rename-project" data-project-id="${id}" title="Rename"><i class="fas fa-pen"></i></button>
                        ${ids.length > 1 ? `<button data-settings-action="delete-project" data-project-id="${id}" class="danger" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                    </div>
                </div>
            `;
        });

        const themeOptions = ['light', 'dark', 'ocean', 'forest', 'sunset', 'purple'];
        let themeHtml = '';
        themeOptions.forEach(t => {
            const active = t === window.currentTheme ? 'active-theme' : '';
            themeHtml += `<button data-settings-action="set-theme" data-theme="${t}" class="${active}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`;
        });

        return `
            <div style="margin-bottom:20px;">
                <div class="settings-section-title"><i class="fas fa-folder-tree"></i> Projects</div>
                <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">${projectListHtml}</div>
                <button data-settings-action="add-project" class="primary" style="margin-top:10px;padding:8px 18px;border:none;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;font-family:var(--font);font-size:13px;font-weight:500;"><i class="fas fa-plus"></i> New Project</button>
            </div>
            <div style="margin-bottom:8px;">
                <div class="settings-section-title"><i class="fas fa-palette"></i> Theme</div>
                <div class="settings-theme-option">${themeHtml}</div>
            </div>
            <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);font-size:13px;color:var(--text2);">
                <i class="fas fa-info-circle"></i> <strong>Navigation:</strong> Press Enter to move right through columns. At the last column, Enter moves to the first column of the next row.
            </div>
        `;
    }

    function refreshSettingsModalContent() {
        if (!window.isSettingsModalOpen) return;
        $('#modalBody').innerHTML = generateSettingsHTML();
        $('#modalScroll').scrollTop = 0;
    }

    async function openSettingsModal() {
        window.isSettingsModalOpen = true;
        const bodyHtml = generateSettingsHTML();
        const result = await openModal('Settings', 'Manage projects, themes, and view highlight options.', bodyHtml, 'Close', 'primary');
        window.isSettingsModalOpen = false;
    }

    // Handle settings modal clicks (delegated)
    $('#modalBody').addEventListener('click', (e) => {
        if (!window.isSettingsModalOpen) return;
        const target = e.target.closest('[data-settings-action]');
        if (!target) return;
        e.preventDefault();
        const action = target.dataset.settingsAction;
        const projectId = target.dataset.projectId;
        const theme = target.dataset.theme;

        switch (action) {
            case 'switch-project':
                if (projectId && projectId !== window.currentProjectId) {
                    switchProject(projectId);
                    refreshSettingsModalContent();
                }
                break;
            case 'rename-project':
                if (projectId) {
                    const proj = window.projects[projectId];
                    if (proj) {
                        const newName = prompt('Rename project:', proj.name);
                        if (newName !== null) {
                            proj.name = newName.trim() || 'Untitled';
                            window.saveProjects();
                            renderAll();
                            refreshSettingsModalContent();
                            toast(`Project renamed.`, 'success');
                        }
                    }
                }
                break;
            case 'delete-project':
                if (projectId) {
                    const ids = Object.keys(window.projects);
                    if (ids.length <= 1) { toast('Cannot delete the last project.', 'error'); return; }
                    const proj = window.projects[projectId];
                    if (proj && confirm(`Delete project "${proj.name}"?`)) {
                        delete window.projects[projectId];
                        if (window.currentProjectId === projectId) {
                            window.currentProjectId = ids[0] || null;
                        }
                        window.saveProjects();
                        renderAll();
                        refreshSettingsModalContent();
                        toast('Project deleted.', 'success');
                    }
                }
                break;
            case 'add-project':
                const name = prompt('Enter new project name:', 'Project ' + (Object.keys(window.projects).length + 1));
                if (name !== null) {
                    const trimmed = name.trim() || 'Untitled';
                    const id = window.generateId();
                    window.projects[id] = window.createDefaultProject(trimmed);
                    window.currentProjectId = id;
                    window.saveProjects();
                    renderAll();
                    refreshSettingsModalContent();
                    toast(`Project "${trimmed}" created.`, 'success');
                }
                break;
            case 'set-theme':
                if (theme && theme !== window.currentTheme) {
                    window.applyTheme(theme);
                    refreshSettingsModalContent();
                    toast('Theme: ' + theme, 'info');
                }
                break;
            case 'close-settings':
                closeModal(null);
                break;
        }
    });

    // Edit row modal
    async function openEditRowModal(rowIdx) {
        const proj = window.getCurrentProject();
        if (!proj) return;
        const row = proj.rows[rowIdx];
        if (!row) return;
        let html = '';
        proj.columns.forEach((col, idx) => {
            const val = row[idx] !== undefined ? row[idx] : '';
            html += `<div class="form-group"><label>${escapeHtml(col)}</label><input type="text" value="${escapeHtml(String(val))}" data-col="${idx}" placeholder="${escapeHtml(col)}"></div>`;
        });
        const result = await openModal('Edit Row', 'Update the values below.', html, 'Update', 'primary');
        if (result && result.length === proj.columns.length) {
            proj.rows[rowIdx] = result;
            window.saveProjects();
            renderSheet();
            toast('Row updated!', 'success');
        }
    }

    function addEmptyRow() {
        const proj = window.getCurrentProject();
        if (!proj) return;
        const emptyRow = proj.columns.map(() => '');
        proj.rows.push(emptyRow);
        window.saveProjects();
        renderSheet();
        toast('Empty row added.', 'success');
    }

    async function openAddColumnModal() {
        const proj = window.getCurrentProject();
        if (!proj) return;
        const html = `
            <div class="form-group"><label>Column Name</label><input type="text" id="newColName" placeholder="e.g. Category" value="New Column"></div>
            <div class="form-group"><label>Default Value (for all rows)</label><input type="text" id="newColDefault" placeholder="Optional default value" value=""></div>
        `;
        const result = await openModal('Add Column', 'Enter the new column details.', html, 'Add Column', 'primary');
        if (result && result.length >= 2) {
            const name = result[0].trim() || 'New Column';
            const def = result[1] || '';
            proj.columns.push(name);
            proj.rows.forEach(row => row.push(def));
            proj.columnDividers.push(true);
            window.saveProjects();
            renderSheet();
            toast(`Column "${name}" added.`, 'success');
        }
    }

    function toggleHeaderTitle() {
        const proj = window.getCurrentProject();
        if (!proj) return;
        proj.hasHeaderTitle = !proj.hasHeaderTitle;
        window.saveProjects();
        renderSheet();
        toast(`Header title ${proj.hasHeaderTitle ? 'shown' : 'hidden'}.`, 'info');
    }

    // ---------- Toast notifications ----------
    function toast(message, type = 'info', duration = 2800) {
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
        el.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span><button class="toast-close"><i class="fas fa-times"></i></button>`;
        $('#toastContainer').appendChild(el);
        const closeBtn = el.querySelector('.toast-close');
        const remove = () => { if (el.parentNode) el.remove(); };
        closeBtn.addEventListener('click', remove);
        setTimeout(remove, duration);
    }

    // ---------- CSV Export/Import ----------
    function exportCSV() {
        const proj = window.getCurrentProject();
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
        const proj = window.getCurrentProject();
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
                window.saveProjects();
                renderSheet();
                toast(`Imported ${newRows.length} rows.`, 'success');
            } catch (err) { toast('Failed to parse CSV: ' + err.message, 'error'); }
        };
        reader.readAsText(file, 'UTF-8');
    }

    function resetToDefault() {
        const proj = window.getCurrentProject();
        if (!proj) return;
        if (!confirm('Reset this project to default data (100 empty rows)?')) return;
        const defaultProj = window.createDefaultProject(proj.name);
        proj.title = defaultProj.title;
        proj.columns = defaultProj.columns;
        proj.rows = defaultProj.rows;
        proj.columnDividers = defaultProj.columnDividers;
        proj.headingRows = defaultProj.headingRows;
        proj.highlightedRows = defaultProj.highlightedRows;
        proj.highlightedCols = defaultProj.highlightedCols;
        proj.hasHeaderTitle = false;
        window.saveProjects();
        renderSheet();
        toast('Project reset to 100 empty rows.', 'success');
    }

    function clearAllData() {
        const proj = window.getCurrentProject();
        if (!proj) return;
        if (proj.rows.length === 0) { toast('Already empty.', 'info'); return; }
        if (!confirm('Delete ALL rows in this project?')) return;
        proj.rows = [];
        proj.headingRows = [];
        proj.highlightedRows = [];
        window.saveProjects();
        renderSheet();
        toast('All rows cleared.', 'success');
    }

    // Utility
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ----- Expose all needed functions globally -----
    window.createAutocompleteDropdown = createAutocompleteDropdown;
    window.showAutocomplete = showAutocomplete;
    window.hideAutocomplete = hideAutocomplete;
    window.renderAll = renderAll;
    window.renderProjectTabs = renderProjectTabs;
    window.renderSheet = renderSheet;
    window.bindTableEvents = bindTableEvents;
    window.openModal = openModal;
    window.closeModal = closeModal;
    window.modalConfirmHandler = modalConfirmHandler;
    window.openSettingsModal = openSettingsModal;
    window.refreshSettingsModalContent = refreshSettingsModalContent;
    window.generateSettingsHTML = generateSettingsHTML;
    window.openEditRowModal = openEditRowModal;
    window.addEmptyRow = addEmptyRow;
    window.openAddColumnModal = openAddColumnModal;
    window.toggleHeaderTitle = toggleHeaderTitle;
    window.toast = toast;
    window.exportCSV = exportCSV;
    window.importCSV = importCSV;
    window.resetToDefault = resetToDefault;
    window.clearAllData = clearAllData;
    window.switchProject = switchProject;
    window.addProject = addProject;
    window.openRenameProjectModal = openRenameProjectModal;
    window.deleteProject = deleteProject;
    window.escapeHtml = escapeHtml;
})();