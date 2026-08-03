/** Рабочая фильтрация и динамическая отрисовка каталога. */
(() => {
  const projects = window.AFFGOLD_PROJECTS || [];
  const rowsContainer = document.querySelector('#catalog-rows');
  const emptyState = document.querySelector('#catalog-empty');
  const countElement = document.querySelector('#catalog-count');
  const searchInput = document.querySelector('#catalog-search');
  const studioList = document.querySelector('#studio-filter-list');
  const studioCount = document.querySelector('#studio-filter-count');
  const payoutSelect = document.querySelector('#payout-filter');
  const sortSelect = document.querySelector('#catalog-sort');
  const applyButton = document.querySelector('#apply-filters');
  const resetButton = document.querySelector('#reset-filters');
  const typeInputs = [...document.querySelectorAll('[name="bonus-type"]')];
  const filterPanel = document.querySelector('#catalog-filters');
  const filterOpen = document.querySelector('[data-filter-open]');
  const filterCloseButtons = document.querySelectorAll('[data-filter-close]');
  const filterBackdrop = document.querySelector('.filter-backdrop');

  if (!rowsContainer) return;

  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const studiosOf = (project) => Array.isArray(project.studios)
    ? project.studios.filter(Boolean)
    : (project.provider ? [project.provider] : []);

  const studioUsage = new Map();
  projects.forEach((project) => studiosOf(project).forEach((studio) => {
    studioUsage.set(studio, (studioUsage.get(studio) || 0) + 1);
  }));
  const studios = [...studioUsage.keys()].sort((a, b) => a.localeCompare(b, 'ru'));
  studioList.innerHTML = studios.map((studio) => `
    <label class="studio-filter-option">
      <input class="checkbox" name="studio" value="${escapeHtml(studio)}" type="checkbox">
      <span>${escapeHtml(studio)}</span>
      <small>${studioUsage.get(studio)}</small>
    </label>`).join('');
  const studioInputs = [...studioList.querySelectorAll('[name="studio"]')];

  const safeUrl = (value = '') => {
    try {
      const url = new URL(value, window.location.origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };

  const renderRow = (project) => {
    const offerUrl = safeUrl(project.url);
    return `
    <article class="table-row">
      <div class="catalog-logo"><img src="${escapeHtml(project.logo)}" alt="${escapeHtml(project.name)}" /></div>
      <div>${escapeHtml(project.bonus)}</div>
      <div><button class="promo-code promo-code-sm" type="button" data-copy-code="${escapeHtml(project.promoCode || 'BETGOLDTEAM')}" title="Скопировать промокод"><span>Промокод</span><strong>${escapeHtml(project.promoCode || 'BETGOLDTEAM')}</strong></button></div>
      <div>x${project.wager}</div>
      <div><span class="rating-chip">★ ${project.rating.toFixed(1)}</span></div>
      <div class="catalog-actions"><a class="btn btn-secondary btn-sm" href="reviews/${encodeURIComponent(project.slug || project.id)}/">Обзор</a>${offerUrl ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(offerUrl)}" target="_blank" rel="sponsored nofollow noopener">На сайт</a>` : ''}</div>
    </article>`;
  };

  const selectedTypes = () => typeInputs.filter((input) => input.checked).map((input) => input.value);
  const selectedStudios = () => studioInputs.filter((input) => input.checked).map((input) => input.value);

  const applyFilters = () => {
    const query = searchInput.value.trim().toLocaleLowerCase('ru');
    const studios = selectedStudios();
    const payout = payoutSelect.value;
    const types = selectedTypes();

    let result = projects.filter((project) => {
      const projectStudios = studiosOf(project);
      const matchesSearch = !query || [project.name, project.bonus, ...projectStudios]
        .some((value) => String(value).toLocaleLowerCase('ru').includes(query));
      const matchesStudios = studios.length === 0 || studios.some((studio) => projectStudios.includes(studio));
      const matchesPayout = !payout || project.payout === payout;
      const matchesType = types.length === 0 || types.some((type) => project.bonusTypes.includes(type));
      return matchesSearch && matchesStudios && matchesPayout && matchesType;
    });

    const sort = sortSelect.value;
    result = [...result].sort((a, b) => {
      if (sort === 'rating-asc') return a.rating - b.rating;
      if (sort === 'wager-asc') return a.wager - b.wager;
      if (sort === 'name') return a.name.localeCompare(b.name, 'ru');
      return b.rating - a.rating;
    });

    rowsContainer.innerHTML = result.map(renderRow).join('');
    countElement.textContent = `Найдено проектов: ${result.length}`;
    studioCount.textContent = studios.length ? `Выбрано: ${studios.length}` : 'Любые';
    emptyState.hidden = result.length !== 0;

    const url = new URL(window.location.href);
    const state = { q: searchInput.value.trim(), studios: studios.join(','), payout, types: types.join(','), sort };
    Object.entries(state).forEach(([key, value]) => value && value !== 'rating-desc'
      ? url.searchParams.set(key, value)
      : url.searchParams.delete(key));
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const resetFilters = () => {
    searchInput.value = '';
    studioInputs.forEach((input) => { input.checked = false; });
    payoutSelect.value = '';
    sortSelect.value = 'rating-desc';
    typeInputs.forEach((input) => { input.checked = false; });
    window.syncCustomSelects?.();
    applyFilters();
  };

  applyButton.addEventListener('click', applyFilters);
  resetButton.addEventListener('click', resetFilters);
  searchInput.addEventListener('input', applyFilters);
  studioInputs.forEach((input) => input.addEventListener('change', applyFilters));
  payoutSelect.addEventListener('change', applyFilters);
  sortSelect.addEventListener('change', applyFilters);
  typeInputs.forEach((input) => input.addEventListener('change', applyFilters));

  const setFiltersOpen = (open) => {
    filterPanel.classList.toggle('open', open);
    filterBackdrop.hidden = !open;
    document.body.classList.toggle('filters-open', open);
    filterOpen?.setAttribute('aria-expanded', String(open));
  };
  filterOpen?.addEventListener('click', () => setFiltersOpen(true));
  filterCloseButtons.forEach((button) => button.addEventListener('click', () => setFiltersOpen(false)));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setFiltersOpen(false); });
  applyButton.addEventListener('click', () => setFiltersOpen(false));

  const initial = new URLSearchParams(window.location.search);
  searchInput.value = initial.get('q') || '';
  const initialStudios = (initial.get('studios') || initial.get('provider') || '').split(',').filter(Boolean);
  studioInputs.forEach((input) => { input.checked = initialStudios.includes(input.value); });
  payoutSelect.value = initial.get('payout') || '';
  sortSelect.value = initial.get('sort') || 'rating-desc';
  const initialTypes = (initial.get('types') || '').split(',');
  typeInputs.forEach((input) => { input.checked = initialTypes.includes(input.value); });

  applyFilters();
})();
