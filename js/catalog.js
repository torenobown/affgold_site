/** Рабочая фильтрация и динамическая отрисовка каталога. */
(() => {
  const projects = window.AFFGOLD_PROJECTS || [];
  const projectsContainer = document.querySelector('#catalog-projects');
  const emptyState = document.querySelector('#catalog-empty');
  const countElement = document.querySelector('#catalog-count');
  const searchInput = document.querySelector('#catalog-search');
  const payoutSelect = document.querySelector('#payout-filter');
  const sortSelect = document.querySelector('#catalog-sort');
  const applyButton = document.querySelector('#apply-filters');
  const resetButton = document.querySelector('#reset-filters');
  const typeInputs = [...document.querySelectorAll('[name="bonus-type"]')];
  const filterPanel = document.querySelector('#catalog-filters');
  const filterOpen = document.querySelector('[data-filter-open]');
  const filterCloseButtons = document.querySelectorAll('[data-filter-close]');
  const filterBackdrop = document.querySelector('.filter-backdrop');

  if (!projectsContainer) return;

  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const safeUrl = (value = '') => {
    try {
      const url = new URL(value, window.location.origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };

  const renderCard = (project) => {
    const offerUrl = safeUrl(project.url);
    return `
    <article class="card project-card">
      <div class="project-card__head">
        <a class="project-card__logo" href="reviews/${encodeURIComponent(project.slug || project.id)}/" aria-label="Обзор ${escapeHtml(project.name)}"><img src="${escapeHtml(project.logo)}" alt="${escapeHtml(project.name)}" /></a>
        <div class="project-card__rating"><span class="rating-chip">★ ${Number(project.rating).toFixed(1)}</span><span>${escapeHtml(project.verdict)}</span></div>
      </div>
      <h3 class="project-card__title"><a href="reviews/${encodeURIComponent(project.slug || project.id)}/">${escapeHtml(project.name)}</a></h3>
      <div><span class="project-card__label">Бонус</span><div class="project-card__bonus">${escapeHtml(project.bonus)}</div><p class="project-card__sub">${escapeHtml(project.bonusSubtitle)}</p></div>
      <dl class="project-card__facts"><div><dt>Вывод</dt><dd>${escapeHtml(project.payoutLabel)}</dd></div><div><dt>Вейджер</dt><dd>x${Number(project.wager)}</dd></div></dl>
      <button class="promo-code promo-code-sm" type="button" data-copy-code="${escapeHtml(project.promoCode || 'BETGOLDTEAM')}" title="Скопировать промокод"><span>Промокод</span><strong>${escapeHtml(project.promoCode || 'BETGOLDTEAM')}</strong></button>
      <div class="project-card__actions"><a class="btn btn-secondary btn-sm" href="reviews/${encodeURIComponent(project.slug || project.id)}/">Обзор</a>${offerUrl ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(offerUrl)}" target="_blank" rel="sponsored nofollow noopener">На сайт</a>` : ''}</div>
    </article>`;
  };

  const selectedTypes = () => typeInputs.filter((input) => input.checked).map((input) => input.value);

  const applyFilters = () => {
    const query = searchInput.value.trim().toLocaleLowerCase('ru');
    const payout = payoutSelect.value;
    const types = selectedTypes();

    let result = projects.filter((project) => {
      const matchesSearch = !query || [project.name, project.bonus, project.promoCode]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ru').includes(query));
      const matchesPayout = !payout || project.payout === payout;
      const matchesType = types.length === 0 || types.some((type) => project.bonusTypes.includes(type));
      return matchesSearch && matchesPayout && matchesType;
    });

    const sort = sortSelect.value;
    result = [...result].sort((a, b) => {
      if (sort === 'rating-asc') return a.rating - b.rating;
      if (sort === 'wager-asc') return a.wager - b.wager;
      if (sort === 'name') return a.name.localeCompare(b.name, 'ru');
      return b.rating - a.rating;
    });

    projectsContainer.innerHTML = result.map(renderCard).join('');
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
    window.syncCustomSelects?.();
    applyFilters();
  };

  applyButton.addEventListener('click', applyFilters);
  resetButton.addEventListener('click', resetFilters);
  searchInput.addEventListener('input', applyFilters);
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
  payoutSelect.value = initial.get('payout') || '';
  sortSelect.value = initial.get('sort') || 'rating-desc';
  const initialTypes = (initial.get('types') || '').split(',');
  typeInputs.forEach((input) => { input.checked = initialTypes.includes(input.value); });

  applyFilters();
})();
