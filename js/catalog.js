/** Фильтрация готовых HTML-карточек без повторного рендера и скачков макета. */
(() => {
  /** Улучшает native select только на странице каталога; без JS остаётся обычный select. */
  const setupCustomSelects = () => {
    const nativeSelects = [...document.querySelectorAll('.select-wrap select')];

    const closeAll = (except = null) => {
      document.querySelectorAll('.custom-select.open').forEach((select) => {
        if (select === except) return;
        select.classList.remove('open');
        select.closest('.catalog-toolbar')?.classList.remove('select-is-open');
        select.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
      });
    };

    nativeSelects.forEach((nativeSelect, selectIndex) => {
      const customSelect = document.createElement('div');
      const trigger = document.createElement('button');
      const menu = document.createElement('div');
      const listboxId = `custom-select-${selectIndex}`;
      const accessibleName = nativeSelect.closest('label')?.querySelector('.sr-only')?.textContent?.trim();

      customSelect.className = 'custom-select';
      trigger.className = 'custom-select-trigger';
      trigger.type = 'button';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', listboxId);
      if (accessibleName) trigger.setAttribute('aria-label', accessibleName);
      menu.className = 'custom-select-menu';
      menu.id = listboxId;
      menu.setAttribute('role', 'listbox');

      [...nativeSelect.options].forEach((option, optionIndex) => {
        const item = document.createElement('button');
        item.className = 'custom-select-option';
        item.type = 'button';
        item.dataset.value = option.value;
        item.dataset.index = String(optionIndex);
        item.textContent = option.textContent;
        item.setAttribute('role', 'option');
        menu.append(item);
      });

      nativeSelect.classList.add('custom-select-native');
      nativeSelect.tabIndex = -1;
      nativeSelect.setAttribute('aria-hidden', 'true');
      nativeSelect.closest('.select-wrap')?.classList.add('custom-select-ready');
      nativeSelect.after(customSelect);
      customSelect.append(trigger, menu);

      const items = [...menu.querySelectorAll('.custom-select-option')];
      const sync = () => {
        const selected = nativeSelect.options[nativeSelect.selectedIndex] || nativeSelect.options[0];
        trigger.replaceChildren();
        const label = document.createElement('span');
        const icon = document.createElement('i');
        label.textContent = selected?.textContent || '';
        icon.setAttribute('aria-hidden', 'true');
        trigger.append(label, icon);
        items.forEach((item) => {
          const active = item.dataset.value === nativeSelect.value;
          item.classList.toggle('selected', active);
          item.setAttribute('aria-selected', String(active));
        });
      };

      const choose = (item) => {
        nativeSelect.value = item.dataset.value;
        nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
        closeAll();
        trigger.focus();
      };

      trigger.addEventListener('click', () => {
        const willOpen = !customSelect.classList.contains('open');
        closeAll(customSelect);
        customSelect.classList.toggle('open', willOpen);
        customSelect.closest('.catalog-toolbar')?.classList.toggle('select-is-open', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) (menu.querySelector('.selected') || items[0])?.focus();
      });
      menu.addEventListener('click', (event) => {
        const item = event.target.closest('.custom-select-option');
        if (item) choose(item);
      });
      customSelect.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Escape') { closeAll(); trigger.focus(); return; }
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.custom-select-option')) {
          choose(event.target);
          return;
        }
        if (!customSelect.classList.contains('open')) { trigger.click(); return; }
        const current = Math.max(0, items.indexOf(document.activeElement));
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowUp' ? Math.max(0, current - 1) : Math.min(items.length - 1, current + 1);
        items[next]?.focus();
      });
      customSelect.addEventListener('focusout', (event) => {
        if (!customSelect.contains(event.relatedTarget)) closeAll();
      });
      nativeSelect.addEventListener('change', sync);
      nativeSelect._syncCustomSelect = sync;
      sync();
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.custom-select')) closeAll();
    });
    return () => nativeSelects.forEach((select) => select._syncCustomSelect?.());
  };

  const projectsContainer = document.querySelector('#catalog-projects');
  const emptyState = document.querySelector('#catalog-empty');
  const countElement = document.querySelector('#catalog-count');
  const searchInput = document.querySelector('#catalog-search');
  const payoutSelect = document.querySelector('#payout-filter');
  const sortSelect = document.querySelector('#catalog-sort');
  const applyButton = document.querySelector('#apply-filters');
  const resetButton = document.querySelector('#reset-filters');
  const typeInputs = [...document.querySelectorAll('[data-bonus-type]')];
  const filterPanel = document.querySelector('#catalog-filters');
  const filterOpen = document.querySelector('[data-filter-open]');
  const filterCloseButtons = document.querySelectorAll('[data-filter-close]');
  const filterBackdrop = document.querySelector('.filter-backdrop');
  const compactFilters = window.matchMedia('(max-width: 1280px)');

  if (!projectsContainer) return;
  const projectCards = [...projectsContainer.querySelectorAll('.project-card')];
  const syncCustomSelects = setupCustomSelects();

  const selectedTypes = () => typeInputs.filter((input) => input.checked).map((input) => input.value);

  const applyFilters = () => {
    const query = searchInput.value.trim().toLocaleLowerCase('ru');
    const payout = payoutSelect.value;
    const types = selectedTypes();

    const result = projectCards.filter((card) => {
      const cardTypes = (card.dataset.bonusTypes || '').split(',').filter(Boolean);
      const matchesSearch = !query || (card.dataset.projectSearch || '').toLocaleLowerCase('ru').includes(query);
      const matchesPayout = !payout || card.dataset.payout === payout;
      const matchesType = types.length === 0 || types.some((type) => cardTypes.includes(type));
      return matchesSearch && matchesPayout && matchesType;
    });

    const sort = sortSelect.value;
    result.sort((a, b) => {
      if (sort === 'rating-asc') return Number(a.dataset.rating) - Number(b.dataset.rating);
      if (sort === 'wager-asc') return Number(a.dataset.wager) - Number(b.dataset.wager);
      if (sort === 'name') return a.dataset.projectName.localeCompare(b.dataset.projectName, 'ru');
      return Number(b.dataset.rating) - Number(a.dataset.rating);
    });

    const visible = new Set(result);
    projectCards.forEach((card) => { card.hidden = !visible.has(card); });
    const desiredOrder = [...result, ...projectCards.filter((card) => !visible.has(card))];
    const currentOrder = [...projectsContainer.children];
    if (desiredOrder.some((card, index) => card !== currentOrder[index])) {
      const fragment = document.createDocumentFragment();
      desiredOrder.forEach((card) => fragment.append(card));
      projectsContainer.append(fragment);
    }
    countElement.textContent = `Найдено проектов: ${result.length}`;
    emptyState.hidden = result.length !== 0;

    const url = new URL(window.location.href);
    const state = { q: searchInput.value.trim(), payout, types: types.join(','), sort };
    Object.entries(state).forEach(([key, value]) => value && value !== 'rating-desc'
      ? url.searchParams.set(key, value)
      : url.searchParams.delete(key));
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const resetFilters = () => {
    searchInput.value = '';
    payoutSelect.value = '';
    sortSelect.value = 'rating-desc';
    typeInputs.forEach((input) => { input.checked = false; });
    syncCustomSelects();
    applyFilters();
  };

  applyButton.addEventListener('click', applyFilters);
  resetButton.addEventListener('click', resetFilters);
  searchInput.addEventListener('input', applyFilters);
  payoutSelect.addEventListener('change', applyFilters);
  sortSelect.addEventListener('change', applyFilters);
  typeInputs.forEach((input) => input.addEventListener('change', applyFilters));

  const setFiltersOpen = (open) => {
    const compact = compactFilters.matches;
    const nextOpen = compact && open;
    const wasOpen = filterPanel.classList.contains('open');
    filterPanel.classList.toggle('open', nextOpen);
    filterPanel.inert = compact && !nextOpen;
    filterBackdrop.hidden = !nextOpen;
    document.body.classList.toggle('filters-open', nextOpen);
    filterOpen?.setAttribute('aria-expanded', String(nextOpen));
    if (compact) {
      filterPanel.setAttribute('role', 'dialog');
      filterPanel.setAttribute('aria-modal', 'true');
      filterPanel.setAttribute('aria-label', 'Фильтры каталога');
    } else {
      filterPanel.removeAttribute('role');
      filterPanel.removeAttribute('aria-modal');
      filterPanel.removeAttribute('aria-label');
    }
    if (nextOpen) requestAnimationFrame(() => filterPanel.querySelector('[data-filter-close]')?.focus());
    else if (wasOpen) filterOpen?.focus();
  };
  filterOpen?.addEventListener('click', () => setFiltersOpen(true));
  filterCloseButtons.forEach((button) => button.addEventListener('click', () => setFiltersOpen(false)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && filterPanel.classList.contains('open')) {
      setFiltersOpen(false);
      return;
    }
    if (event.key !== 'Tab' || !filterPanel.classList.contains('open')) return;
    const focusable = [...filterPanel.querySelectorAll('input, select, button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.inert && element.getAttribute('aria-hidden') !== 'true');
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  applyButton.addEventListener('click', () => setFiltersOpen(false));
  compactFilters.addEventListener('change', () => setFiltersOpen(false));
  setFiltersOpen(false);

  const initial = new URLSearchParams(window.location.search);
  searchInput.value = initial.get('q') || '';
  payoutSelect.value = initial.get('payout') || '';
  sortSelect.value = initial.get('sort') || 'rating-desc';
  const initialTypes = (initial.get('types') || '').split(',');
  typeInputs.forEach((input) => { input.checked = initialTypes.includes(input.value); });

  syncCustomSelects();
  applyFilters();
})();
