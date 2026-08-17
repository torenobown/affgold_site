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
    return `<article class="card project-card">
      <div class="project-card__head">
        <a class="project-card__logo" href="reviews/${encodeURIComponent(project.slug || project.id)}/" aria-label="Обзор ${escapeHtml(project.name)}"><img src="${escapeHtml(project.logo)}" alt="${escapeHtml(project.name)}"></a>
        <div class="project-card__rating"><span class="rating-chip">★ ${Number(project.rating).toFixed(1)}</span><span>${escapeHtml(project.verdict)}</span></div>
      </div>
      <h3 class="project-card__title"><a href="reviews/${encodeURIComponent(project.slug || project.id)}/">${escapeHtml(project.name)}</a></h3>
      <div><span class="project-card__label">Бонус</span><div class="project-card__bonus">${escapeHtml(project.bonus)}</div><p class="project-card__sub">${escapeHtml(project.bonusSubtitle)}</p></div>
      <dl class="project-card__facts"><div><dt>Вывод</dt><dd>${escapeHtml(project.payoutLabel)}</dd></div><div><dt>Вейджер</dt><dd>x${Number(project.wager)}</dd></div></dl>
      <button class="promo-code promo-code-sm" type="button" data-copy-code="${escapeHtml(project.promoCode || 'BETGOLDTEAM')}" title="Скопировать промокод"><span>Промокод</span><strong>${escapeHtml(project.promoCode || 'BETGOLDTEAM')}</strong></button>
      <div class="project-card__actions"><a class="btn btn-secondary btn-sm" href="reviews/${encodeURIComponent(project.slug || project.id)}/">Обзор</a>${url ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(url)}" target="_blank" rel="sponsored nofollow noopener">На сайт</a>` : ''}</div>
    </article>`;
  }).join('');
  const projectCount = document.querySelector('[data-project-count]');
  if (projectCount) { projectCount.dataset.count = String((window.AFFGOLD_PROJECTS || []).length); projectCount.textContent = '0'; }
})();
