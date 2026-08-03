(() => {
  const container = document.querySelector('#home-projects');
  if (!container) return;
  const projects = [...(window.AFFGOLD_PROJECTS || [])].sort((a, b) => b.rating - a.rating).slice(0, 4);
  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const safeUrl = (value = '') => {
    try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  };
  container.innerHTML = projects.map((project) => {
    const url = safeUrl(project.url);
    return `<article class="card project-card reveal">
      <div class="top-row"><div class="casino-logo"><img src="${escapeHtml(project.logo)}" alt="${escapeHtml(project.name)}"></div><span class="rating-chip">★ ${Number(project.rating).toFixed(1)}</span></div>
      <div class="project-bonus">${escapeHtml(project.bonus)}</div><div class="project-sub">${escapeHtml(project.bonusSubtitle)}</div>
      <button class="promo-code promo-code-sm" type="button" data-copy-code="${escapeHtml(project.promoCode || 'BETGOLDTEAM')}"><span>Промокод</span><strong>${escapeHtml(project.promoCode || 'BETGOLDTEAM')}</strong></button>
      <div class="card-actions"><a class="btn btn-secondary btn-sm" href="reviews/${encodeURIComponent(project.slug || project.id)}/">Обзор</a>${url ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(url)}" target="_blank" rel="sponsored nofollow noopener">На сайт</a>` : ''}</div>
    </article>`;
  }).join('');
  const projectCount = document.querySelector('[data-project-count]');
  if (projectCount) { projectCount.dataset.count = String((window.AFFGOLD_PROJECTS || []).length); projectCount.textContent = '0'; }
})();
