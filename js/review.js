/** Конструктор страницы обзора на основе AFFGOLD_PROJECTS. */
(() => {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('project') || 'joycasino';
  const projects = window.AFFGOLD_PROJECTS || [];
  const project = projects.find((item) => item.id === projectId);

  const app = document.querySelector('#review-app');
  const loading = document.querySelector('#review-loading');
  const notFound = document.querySelector('#review-not-found');

  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const scoreRows = (scores) => [
    ['Надёжность', scores.reliability],
    ['Бонусы', scores.bonuses],
    ['Слоты', scores.slots],
    ['Вывод средств', scores.payouts],
    ['Поддержка', scores.support]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${Number(value).toFixed(1)}</strong></div>`).join('');

  const paymentClass = (name) => name.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-');

  if (!project) {
    loading.hidden = true;
    notFound.hidden = false;
    return;
  }

  document.title = `AFFGOLD — Обзор ${project.name}`;

  app.innerHTML = `
    <div class="breadcrumbs review-breadcrumbs reveal visible">
      <a href="index.html">Главная</a><span>›</span>
      <a href="catalog.html">Каталог</a><span>›</span>
      <span>${escapeHtml(project.name)}</span>
    </div>

    <section class="review-top-grid">
      <div class="review-top-content reveal visible">
        <div class="review-brand-row">
          <div class="review-logo-card">
            <img src="${escapeHtml(project.logo)}" alt="${escapeHtml(project.name)}" />
          </div>
          <div class="review-brand-info">
            <h1>${escapeHtml(project.name)}</h1>
            <div class="review-rating-line">
              <span class="review-stars">★★★★★</span>
              <strong>${project.rating.toFixed(1)}</strong>
              <span>${escapeHtml(project.verdict)}</span>
            </div>
            <div class="review-tags">
              ${project.tags.map((tag, index) => `<span class="review-tag${index === 0 ? ' green' : ''}">${escapeHtml(tag)}</span>`).join('')}
            </div>
          </div>
        </div>

        <div class="review-bonus-card">
          <div>
            <span class="review-muted">Приветственный бонус</span>
            <div class="review-bonus-value">${escapeHtml(project.bonus)}</div>
            <span class="review-muted">${escapeHtml(project.bonusSubtitle)}</span>
          </div>
          <div class="review-bonus-actions">
            <a class="btn btn-primary" href="${escapeHtml(project.url)}">Получить бонус</a>
            <a class="btn btn-secondary" href="${escapeHtml(project.url)}">Перейти на сайт</a>
          </div>
        </div>
      </div>

      <aside class="review-score-card reveal visible">
        <span class="review-score-label">Общая оценка</span>
        <div class="review-score-number">${project.rating.toFixed(1)}</div>
        <div class="review-score-stars"><span>★★★★★</span><em>${escapeHtml(project.verdict)}</em></div>
        <div class="review-score-list">${scoreRows(project.scores)}</div>
      </aside>
    </section>

    <section class="review-tabs-shell reveal visible">
      <div class="tabs review-tabs">
        <button class="tab-btn active" type="button" data-tab-target="overview">Обзор</button>
        <button class="tab-btn" type="button" data-tab-target="bonuses">Бонусы</button>
        <button class="tab-btn" type="button" data-tab-target="slots">Слоты</button>
        <button class="tab-btn" type="button" data-tab-target="payments">Вывод средств</button>
      </div>

      <div class="review-content-card">
        <div class="review-copy">
          <div class="tab-panel active" data-tab-panel="overview">
            <h2>Обзор проекта ${escapeHtml(project.name)}</h2>
            <p class="review-description">${escapeHtml(project.description)}</p>
            <ul class="review-check-list">
              ${project.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}
            </ul>
          </div>
          <div class="tab-panel" data-tab-panel="bonuses">
            <h2>Бонусы ${escapeHtml(project.name)}</h2>
            <p>${escapeHtml(project.tabs.bonuses)}</p>
          </div>
          <div class="tab-panel" data-tab-panel="slots">
            <h2>Слоты ${escapeHtml(project.name)}</h2>
            <p>${escapeHtml(project.tabs.slots)}</p>
          </div>
          <div class="tab-panel" data-tab-panel="payments">
            <h2>Вывод средств</h2>
            <p>${escapeHtml(project.tabs.payments)}</p>
          </div>
        </div>

        <aside class="review-methods-card">
          <h3>Платёжные методы</h3>
          <div class="review-methods-grid">
            ${project.payments.map((method) => `<div class="pay-logo ${paymentClass(method)}">${escapeHtml(method)}</div>`).join('')}
          </div>
          <div class="review-methods-more">и другие</div>
        </aside>
      </div>
    </section>
  `;

  loading.hidden = true;
  app.hidden = false;
})();
