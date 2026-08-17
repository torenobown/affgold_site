import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOMAIN = 'https://www.affgoldprod.com';
// GitHub Pages публикует репозиторий по адресу /affgold_site/.
// Для основного домена запустите сборку так:
// AFFGOLD_BASE_PATH= node scripts/build-seo.mjs
const BASE_PATH = String(process.env.AFFGOLD_BASE_PATH ?? '/affgold_site')
  .trim()
  .replace(/^\/*/, '/')
  .replace(/\/+$/, '');
const UPDATED = '2026-08-03';
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/projects-data.js'), 'utf8'), context);
const projects = context.window.AFFGOLD_PROJECTS;
const writtenRoutes = [];

// Эти папки полностью формируются генератором. Очистка удаляет устаревшие
// обзоры после удаления проекта через админку.
['reviews','ratings','bonuses','compare','payments','guides','about','contacts','privacy','terms','news','updates']
  .forEach((directory) => fs.rmSync(path.join(ROOT, directory), { recursive: true, force: true }));

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const xmlEscape = (value = '') => escapeHtml(value);
const cleanSeoText = (value = '') => String(value)
  .replaceAll('AFFGOLD', '')
  .replace(/\s+([.,:;])/g, '$1')
  .replace(/\s{2,}/g, ' ')
  .replace(/\s+[—-]\s*$/g, '')
  .trim();
const routeToFile = (route) => route === '/'
  ? path.join(ROOT, 'index.html')
  : path.join(ROOT, route.replace(/^\//, ''), 'index.html');

const withBasePath = (url = '/') => {
  const value = String(url);
  if (!BASE_PATH || !value.startsWith('/') || value.startsWith('//')) return value;
  if (value === BASE_PATH || value.startsWith(`${BASE_PATH}/`)) return value;
  return value === '/' ? `${BASE_PATH}/` : `${BASE_PATH}${value}`;
};

// Меняем только локальные href/src. Canonical, Open Graph и JSON-LD
// продолжают указывать на основной домен без служебного префикса GitHub.
const applyBasePath = (html) => html.replace(
  /(\b(?:href|src)=["'])(\/(?!\/)[^"']*)/g,
  (match, attribute, url) => `${attribute}${withBasePath(url)}`
);

const writeRoute = (route, content, index = true) => {
  const target = routeToFile(route);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, applyBasePath(content));
  if (index) writtenRoutes.push(route);
};

const legacyRedirect = (target, label) => {
  const deployTarget = withBasePath(target);
  return `<!doctype html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(label)} — раздел перенесён</title><meta name="robots" content="noindex,follow">
  <link rel="canonical" href="${DOMAIN}${target}"><meta http-equiv="refresh" content="0;url=${deployTarget}">
</head><body><p>Раздел перенесён. <a href="${deployTarget}">Перейти к актуальной странице</a>.</p><script>location.replace(${JSON.stringify(deployTarget)})</script></body></html>`;
};

const projectUrl = (project) => `/reviews/${project.slug || project.id}/`;
const absoluteLogo = (project) => /^(data:|https?:)/i.test(project.logo)
  ? project.logo
  : `/${project.logo.replace(/^\.\//, '')}`;
const offerUrl = (project) => {
  try {
    const url = new URL(project.url);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
};

const nav = (active) => `
  <header class="header">
    <div class="container header-inner">
      <a class="logo" href="/"><span class="logo-badge">♛</span><span>AFFGOLD</span></a>
      <nav class="nav" aria-label="Основная навигация">
        <a href="/catalog.html" data-page-link="catalog"${active === 'catalog' ? ' class="active" aria-current="page"' : ''}>Каталог</a>
        <a href="/ratings/"${active === 'ratings' ? ' class="active" aria-current="page"' : ''}>Рейтинги</a>
        <a href="/bonuses/"${active === 'bonuses' ? ' class="active" aria-current="page"' : ''}>Бонусы</a>
        <a href="/guides/"${active === 'guides' ? ' class="active" aria-current="page"' : ''}>Гайды</a>
        <a href="/about/"${active === 'about' ? ' class="active" aria-current="page"' : ''}>О проекте</a>
      </nav>
      <div class="header-actions"><button class="icon-btn menu-toggle" type="button" aria-label="Открыть меню" aria-expanded="false" data-menu-toggle>☰</button></div>
    </div>
  </header>`;

const footer = () => `
  <footer class="footer" id="footer">
        <div class="container">
          <div class="card card-pad">
            <div class="footer-grid">
              <div>
                <div class="footer-title">AFFGOLD</div>
                <p class="seo-footer-note">
                  Каталог обзоров и справочных материалов. Условия могут измениться после даты проверки.
                </p>
              </div>

              <div>
                <div class="footer-title">Каталог</div>
                <div class="footer-links">
                  <a href="/catalog.html">Все проекты</a>
                  <a href="/ratings/">Рейтинги</a>
                  <a href="/bonuses/">Бонусы</a>
                </div>
              </div>

              <div>
                <div class="footer-title">Материалы</div>
                <div class="footer-links">
                  <a href="/guides/">Гайды</a>
                  <a href="/payments/">Платежи</a>
                </div>
              </div>

              <div>
                <div class="footer-title">О проекте</div>
                <div class="footer-links">
                  <a href="/about/methodology/">Методика</a>
                  <a href="/about/affiliate-disclosure/">Партнёрское уведомление</a>
                  <a href="/about/responsible-play/">Ответственная игра 18+</a>
                  <a href="/contacts/">Контакты</a>
                  <a href="/privacy/">Конфиденциальность</a>
                  <a href="/terms/">Условия использования</a>
                </div>
              </div>
            </div>

            <div class="foot-note">
              <span>© 2026 AFFGOLD</span>
              <span>18+ Играйте ответственно</span>
            </div>
          </div>
        </div>
      </footer>`;

const mobileDock = (active) => `
  <div class="mobile-dock"><div class="mobile-dock-grid">
    <a href="/"${active === 'home' ? ' class="active"' : ''}><span class="mobile-icon">⌂</span><span>Главная</span></a>
    <a href="/catalog.html"${active === 'catalog' ? ' class="active"' : ''}><span class="mobile-icon">◫</span><span>Каталог</span></a>
    <a href="/bonuses/"${active === 'bonuses' ? ' class="active"' : ''}><span class="mobile-icon">◆</span><span>Бонусы</span></a>
    <a href="#footer"><span class="mobile-icon">☰</span><span>Меню</span></a>
  </div></div>`;

const breadcrumbSchema = (items) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: `${DOMAIN}${item.url}` }))
});

const breadcrumbsHtml = (items) => `<nav class="breadcrumbs" aria-label="Хлебные крошки">${items.map((item, index) => index === items.length - 1
  ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
  : `<a href="${item.url}">${escapeHtml(item.name)}</a><span>›</span>`).join('')}</nav>`;

const page = ({ route, title, description, eyebrow, h1, lead, active, breadcrumbs, content, sidebar = '', schema = null, updated = UPDATED, index = true }) => {
  const canonical = `${DOMAIN}${route}`;
  const metaTitle = cleanSeoText(title);
  const metaDescription = cleanSeoText(description);
  const items = [{ name: 'Главная', url: '/' }, ...breadcrumbs];
  const schemas = [breadcrumbSchema(items), schema || {
    '@context': 'https://schema.org', '@type': 'WebPage', name: h1, description, url: canonical,
    dateModified: updated, publisher: { '@type': 'Organization', name: 'AFFGOLD', url: DOMAIN }
  }];
  return `<!doctype html>
<html lang="ru"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(metaTitle)}</title><meta name="description" content="${escapeHtml(metaDescription)}">
  <meta name="robots" content="${index ? 'index,follow,max-image-preview:large' : 'noindex,follow'}">
  <link rel="canonical" href="${canonical}"><link rel="icon" type="image/svg+xml" href="/assets/icons/favicon.svg">
  <meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(metaTitle)}"><meta property="og:description" content="${escapeHtml(metaDescription)}"><meta property="og:url" content="${canonical}">
  <link rel="stylesheet" href="/css/styles.css">
  ${schemas.map((item) => `<script type="application/ld+json">${JSON.stringify(item).replaceAll('</script', '<\\/script')}</script>`).join('\n  ')}
</head><body data-page="${active || ''}"><div class="site-shell"><div class="bg-glow one"></div><div class="bg-glow two"></div>
${nav(active)}
<main>
  <section class="seo-hero"><div class="container seo-hero-inner reveal">
    ${breadcrumbsHtml(items)}<span class="seo-eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(h1)}</h1><p class="seo-lead">${escapeHtml(lead)}</p>
    <div class="seo-meta"><span>Обновлено: <time datetime="${updated}">03.08.2026</time></span><span>Автор: редакция AFFGOLD</span><span>18+</span></div>
  </div></section>
  <section class="section"><div class="container ${sidebar ? 'seo-layout' : ''}"><div class="seo-main">${content}</div>${sidebar ? `<aside class="seo-sidebar">${sidebar}</aside>` : ''}</div></section>
</main>${footer()}${mobileDock(active)}</div><script src="/js/main.js"></script></body></html>`;
};

const cardGrid = (cards) => `<div class="seo-grid">${cards.map((card) => `<a class="card seo-card" href="${card.url}"><span class="seo-card-icon">${card.icon || '◆'}</span><h2>${escapeHtml(card.title)}</h2><p>${escapeHtml(card.text)}</p><span class="seo-card-link">Открыть →</span></a>`).join('')}</div>`;

const projectCards = (items) => `<div class="project-grid">${items.map((project) => `
  <article class="card project-card" data-project-theme="${escapeHtml(project.id)}" aria-label="${escapeHtml(project.name)}">
    <div class="project-card__head">
      <a class="project-card__logo" href="${projectUrl(project)}" aria-label="Обзор ${escapeHtml(project.name)}"><img src="${absoluteLogo(project)}" alt="${escapeHtml(project.name)}"></a>
      <div class="project-card__rating"><span class="rating-chip">★ ${project.rating.toFixed(1)}</span><span>${escapeHtml(project.verdict)}</span></div>
    </div>
    <div><span class="project-card__label">Бонус</span><div class="project-card__bonus">${escapeHtml(project.bonus)}</div><p class="project-card__sub">${escapeHtml(project.bonusSubtitle)}</p></div>
    <dl class="project-card__facts"><div><dt>Вывод</dt><dd>${escapeHtml(project.payoutLabel)}</dd></div><div><dt>Вейджер</dt><dd>x${project.wager}</dd></div></dl>
    <button class="promo-code promo-code-sm" type="button" data-copy-code="${escapeHtml(project.promoCode || 'BETGOLDTEAM')}" title="Скопировать промокод"><span>Промокод</span><strong>${escapeHtml(project.promoCode || 'BETGOLDTEAM')}</strong></button>
    <div class="project-card__actions"><a class="btn btn-secondary btn-sm" href="${projectUrl(project)}">Обзор</a>${offerUrl(project) ? `<a class="btn btn-primary btn-project btn-sm" href="${escapeHtml(offerUrl(project))}" target="_blank" rel="sponsored nofollow noopener">На сайт</a>` : ''}</div>
  </article>`).join('')}</div>`;

const textPanel = (id, title, paragraphs, list = []) => `<section class="card seo-panel" id="${id}"><h2>${escapeHtml(title)}</h2>${paragraphs.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}${list.length ? `<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</section>`;
const sidebar = (links = []) => `<div class="card seo-toc"><h2>На этой странице</h2>${links.map((link) => `<a href="#${link.id}">${escapeHtml(link.title)}</a>`).join('')}</div><div class="card seo-trust"><strong>Как мы работаем</strong><p>Сравниваем условия из базы проекта, отмечаем дату проверки и не скрываем, что предложения могут измениться.</p><a class="seo-card-link" href="/about/methodology/">Методика рейтинга →</a></div>`;

const REVIEW_ICONS = {
  document: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v5h5M10 12h6M10 16h6"/>',
  gift: '<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M12 9v12M3 13h18M12 9H8.5a2.5 2.5 0 1 1 2.1-3.85L12 9Zm0 0h3.5a2.5 2.5 0 1 0-2.1-3.85L12 9Z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-5"/>',
  wallet: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v2H6.5A2.5 2.5 0 0 0 4 10.5v7A2.5 2.5 0 0 0 6.5 20H20V8"/><path d="M16 12h5v4h-5a2 2 0 1 1 0-4Z"/>',
  games: '<rect x="3" y="5" width="18" height="14" rx="4"/><path d="M8 10v4M6 12h4M15.5 11.5h.01M18 14h.01"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M18 19c0 1.1-.9 2-2 2h-3M4 14h3v5H5a2 2 0 0 1-2-2v-1a2 2 0 0 1 1-2Zm16 0h-3v5h2a2 2 0 0 0 2-2v-1a2 2 0 0 0-1-2Z"/>',
  spark: '<path d="m13 2-1 7h6l-8 13 1-8H5l8-12Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>'
};

const reviewIcon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${REVIEW_ICONS[name] || REVIEW_ICONS.spark}</svg>`;
const reviewScore = (value) => Math.max(0, Math.min(5, Number(value) || 0));
const reviewStars = (value) => {
  const score = reviewScore(value);
  return `<span class="review-stars" style="--review-stars:${score * 20}%" role="img" aria-label="${score.toFixed(1)} из 5"><span aria-hidden="true">★★★★★</span></span>`;
};
const reviewScoreRows = (scores = {}) => [
  ['reliability', 'Надёжность', 'shield'],
  ['bonuses', 'Бонусы', 'gift'],
  ['slots', 'Игровой каталог', 'games'],
  ['payouts', 'Выплаты', 'wallet'],
  ['support', 'Поддержка', 'headset']
].map(([key, label, icon]) => {
  const score = reviewScore(scores[key]);
  return `<div class="review-score-row"><span class="review-score-row__icon">${reviewIcon(icon)}</span><span class="review-score-row__label" id="review-score-${key}">${label}</span><strong>${score.toFixed(1)}</strong><meter class="review-score-row__bar" min="0" max="5" value="${score.toFixed(1)}" aria-labelledby="review-score-${key}">${score.toFixed(1)} из 5</meter></div>`;
}).join('');

const reviewPage = (project, related, schema) => {
  const route = projectUrl(project);
  const canonical = `${DOMAIN}${route}`;
  const title = cleanSeoText(`${project.name}: обзор, бонус ${project.bonus} и условия — AFFGOLD`);
  const description = cleanSeoText(`${project.name}: обзор бонуса ${project.bonus}, вейджер x${project.wager}, платежные методы и важные условия.`);
  const items = [{ name: 'Главная', url: '/' }, { name: 'Каталог', url: '/catalog.html' }, { name: project.name, url: route }];
  const externalUrl = offerUrl(project);
  const promoCode = project.promoCode || 'BETGOLDTEAM';
  const schemas = [breadcrumbSchema(items), schema];

  return `<!DOCTYPE html>
<html lang="ru"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}"><link rel="icon" type="image/svg+xml" href="/assets/icons/favicon.svg">
  <meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${canonical}">
  <link rel="stylesheet" href="/css/styles.css">
  ${schemas.map((item) => `<script type="application/ld+json">${JSON.stringify(item).replaceAll('</script', '<\\/script')}</script>`).join('\n  ')}
</head><body data-page="catalog" data-project-theme="${escapeHtml(project.id)}" class="review-page"><div class="site-shell"><div class="bg-glow one"></div><div class="bg-glow two"></div>
${nav('catalog')}
<main class="review-main">
  <section class="review-intro"><div class="container">
    ${breadcrumbsHtml(items)}
    <div class="review-dashboard">
      <article class="card review-hero-card reveal" id="overview">
        <div class="review-hero-card__copy">
          <div class="review-hero-card__brand">
            <div class="review-hero-card__logo"><img src="${absoluteLogo(project)}" alt="${escapeHtml(project.name)}"></div>
            <div><span class="review-kicker">Редакционный обзор</span><h1>Обзор <span>${escapeHtml(project.name)}</span></h1><div class="review-hero-card__rating">${reviewStars(project.rating)}<strong>${project.rating.toFixed(1)}</strong><span>${escapeHtml(project.verdict)}</span></div></div>
          </div>
          <p class="review-hero-card__lead">${escapeHtml(project.description)}</p>
          <p class="review-hero-card__summary">Стартовое предложение — ${escapeHtml(project.bonus)}, требование к отыгрышу — x${project.wager}. Перед активацией проверьте актуальные правила и доступность в своём регионе.</p>
          <div class="review-tags">${project.tags.map((tag) => `<span class="review-tag">${escapeHtml(tag)}</span>`).join('')}</div>
          <dl class="review-hero-facts"><div><dt>Бонус</dt><dd>${escapeHtml(project.bonus)}</dd></div><div><dt>Вывод</dt><dd>${escapeHtml(project.payoutLabel)}</dd></div></dl>
        </div>
      </article>

      <aside class="card review-score-card reveal" id="rating" aria-labelledby="review-score-title">
        <div class="review-score-card__head"><div><span class="review-kicker">Оценка редакции</span><h2 id="review-score-title">Коротко о проекте</h2></div><span class="review-score-card__badge">5 критериев</span></div>
        <div class="review-score-list">${reviewScoreRows(project.scores)}</div>
        <div class="review-score-total"><div><span>Общая оценка</span><strong>${project.rating.toFixed(1)}</strong><small>/ 5</small></div>${reviewStars(project.rating)}<p>${escapeHtml(project.verdict)}</p></div>
        <a class="review-inline-link" href="/about/methodology/">Как считаем рейтинг <span aria-hidden="true">→</span></a>
      </aside>

      <aside class="card review-cta-card reveal" aria-labelledby="review-cta-title">
        <div class="review-cta-card__content"><span class="review-kicker">Предложение проекта</span><h2 id="review-cta-title">Готовы перейти?</h2><p>Сначала сверьте правила и региональную доступность на стороне проекта.</p><strong class="review-cta-card__bonus">${escapeHtml(project.bonus)}</strong><button class="promo-code" type="button" data-copy-code="${escapeHtml(promoCode)}" title="Скопировать промокод"><span>Промокод</span><strong>${escapeHtml(promoCode)}</strong></button>${externalUrl ? `<a class="btn btn-primary btn-project" href="${escapeHtml(externalUrl)}" target="_blank" rel="sponsored nofollow noopener">Открыть предложение</a>` : ''}<small>18+. Условия и доступность могут меняться.</small></div>
      </aside>

      <section class="review-highlight-grid" aria-label="Главное об условиях">
        <article class="card review-highlight-card reveal" id="features"><span class="review-card-icon">${reviewIcon('document')}</span><h2>Что отмечено в обзоре</h2><ul class="review-feature-list">${project.features.slice(0, 4).map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul></article>
        <article class="card review-highlight-card reveal"><span class="review-card-icon">${reviewIcon('gift')}</span><h2>Бонусные условия</h2><strong class="review-highlight-value review-highlight-value--gold">${escapeHtml(project.bonus)}</strong><p>${escapeHtml(project.bonusSubtitle)}</p><a class="review-inline-link" href="#bonus-details">Подробнее об условиях <span aria-hidden="true">→</span></a></article>
        <article class="card review-highlight-card reveal"><span class="review-card-icon">${reviewIcon('shield')}</span><h2>Условия отыгрыша</h2><strong class="review-highlight-value">x${project.wager}</strong><p>Указанное требование применяется к сумме бонуса. Сверьте ограничения перед активацией.</p><a class="review-inline-link" href="/guides/what-is-wager/">Что такое вейджер <span aria-hidden="true">→</span></a></article>
      </section>

      <div class="review-notice reveal" role="note"><span class="review-notice__icon">${reviewIcon('info')}</span><p><strong>Важно:</strong> обзор носит информационный характер. Перед активацией проверьте актуальные правила, ограничения и региональную доступность на сайте проекта.</p></div>
    </div>
  </div></section>

  <section class="section review-content-section"><div class="container">
    <div class="section-header reveal"><div><h2>Подробности обзора</h2><p>Основные условия собраны в спокойном формате без лишних повторов.</p></div></div>
    <div class="review-body-layout">
      <article class="card review-article reveal">
        <section class="review-article__section" id="bonus-details"><span class="review-card-icon review-card-icon--small">${reviewIcon('gift')}</span><div><h2>Бонус и важные условия</h2><p>${escapeHtml(project.tabs.bonuses)}</p><p>Обратите внимание на базу расчёта вейджера, максимальную ставку, срок отыгрыша и список исключённых игр.</p></div></section>
        <section class="review-article__section" id="games"><span class="review-card-icon review-card-icon--small">${reviewIcon('games')}</span><div><h2>Игровой каталог</h2><p>${escapeHtml(project.tabs.slots)}</p><p>Состав библиотеки и доступность отдельных категорий могут зависеть от региона и меняться со временем.</p></div></section>
        <section class="review-article__section" id="payments"><span class="review-card-icon review-card-icon--small">${reviewIcon('wallet')}</span><div><h2>Пополнение и вывод</h2><p>${escapeHtml(project.tabs.payments)}</p><p>Заявленный срок обработки: <strong>${escapeHtml(project.payoutLabel)}</strong>. Фактическое время зависит от метода, валюты и статуса аккаунта.</p><ul class="review-payment-list" aria-label="Поддерживаемые платёжные методы">${project.payments.map((method) => `<li>${escapeHtml(method)}</li>`).join('')}</ul></div></section>
      </article>
      <aside class="review-body-aside" aria-label="Навигация и методика обзора">
        <nav class="card review-toc reveal" aria-label="Содержание обзора"><h2>На этой странице</h2><a href="#overview">Краткий обзор</a><a href="#rating">Оценка проекта</a><a href="#features">Особенности</a><a href="#bonus-details">Бонус</a><a href="#games">Игры</a><a href="#payments">Платежи</a><a href="#related">Похожие проекты</a></nav>
        <div class="card review-method-card reveal"><span class="review-card-icon review-card-icon--small">${reviewIcon('shield')}</span><h2>Как мы работаем</h2><p>Фиксируем данные из карточки проекта, дату проверки и отдельно отмечаем условия, которые могут измениться.</p><a class="review-inline-link" href="/about/methodology/">Методика рейтинга <span aria-hidden="true">→</span></a></div>
      </aside>
    </div>
  </div></section>

  <section class="section review-related-section" id="related"><div class="container"><div class="section-header reveal"><div><h2>Похожие проекты</h2><p>Ещё несколько обзоров с тем же форматом данных.</p></div><a class="link-more" href="/catalog.html">Весь каталог →</a></div>${projectCards(related)}</div></section>
</main>${footer()}${mobileDock('catalog')}</div><script src="/js/main.js"></script></body></html>`;
};

const hubs = [
  {
    route: '/ratings/', active: 'ratings', eyebrow: 'Подборки', h1: 'Рейтинги онлайн-проектов',
    title: 'Рейтинги онлайн-проектов 2026 — AFFGOLD',
    description: 'Рейтинги онлайн-проектов по скорости выплат, вейджеру, мобильной версии и другим понятным критериям.',
    lead: 'Выбирайте подборку по важному для вас критерию. Внутри — наглядные карточки, дата проверки и ссылки на подробные обзоры.',
    cards: [
      { title: 'Быстрые выплаты', text: 'Проекты со сроком обработки моментально или до одного часа.', url: '/ratings/fast-payouts/', icon: '↗' },
      { title: 'Низкий вейджер', text: 'Сортировка предложений от меньшего требования к отыгрышу.', url: '/ratings/low-wager/', icon: '×' },
      { title: 'Мобильные проекты', text: 'Подборка проектов с адаптивным интерфейсом для смартфона.', url: '/ratings/mobile/', icon: '▣' },
      { title: 'Все проекты', text: 'Полный каталог с фильтрами и сортировкой.', url: '/catalog.html', icon: '☷' }
    ]
  },
  {
    route: '/bonuses/', active: 'bonuses', eyebrow: 'Предложения', h1: 'Бонусы и промопредложения',
    title: 'Бонусы онлайн-проектов 2026: условия и вейджер — AFFGOLD',
    description: 'Актуальные приветственные бонусы, фриспины и разбор условий отыгрыша в одном разделе.',
    lead: 'Размер бонуса — только часть предложения. Мы отдельно показываем вейджер, тип бонуса и дату последнего обновления.',
    cards: [
      { title: 'Приветственные бонусы', text: 'Предложения для новых пользователей на первые пополнения.', url: '/bonuses/welcome/', icon: '★' },
      { title: 'Фриспины', text: 'Подборка предложений с бесплатными вращениями.', url: '/bonuses/free-spins/', icon: '↻' },
      { title: 'Бездепозитные бонусы', text: 'Как проверить предложение без обязательного пополнения.', url: '/bonuses/no-deposit/', icon: '◇' },
      { title: 'Кэшбэк', text: 'Проекты, где возврат части средств указан в типах предложения.', url: '/bonuses/cashback/', icon: '↩' },
      { title: 'Промокоды', text: 'Как проверить код, срок действия и ограничения.', url: '/bonuses/promo-codes/', icon: '%' },
      { title: 'Что такое вейджер', text: 'Простой разбор главного условия отыгрыша.', url: '/guides/what-is-wager/', icon: '?' }
    ]
  },
  {
    route: '/payments/', active: 'guides', eyebrow: 'Платежи', h1: 'Пополнение и вывод средств',
    title: 'Способы пополнения и вывода средств — AFFGOLD',
    description: 'Справочник по банковским картам, криптовалюте и срокам обработки выплат в онлайн-проектах.',
    lead: 'Доступность метода ещё не означает одинаковые сроки и лимиты. Перед операцией проверяйте данные в кассе выбранного проекта.',
    cards: [
      { title: 'Банковские карты', text: 'Что проверять перед пополнением и запросом выплаты.', url: '/payments/bank-cards/', icon: '▤' },
      { title: 'Криптовалюта', text: 'Проекты из базы с Bitcoin или Tether в списке методов.', url: '/payments/crypto/', icon: '₿' },
      { title: 'Электронные кошельки', text: 'Подборка проектов с электронными методами из базы.', url: '/payments/e-wallets/', icon: '◈' },
      { title: 'Срок вывода', text: 'Почему фактическое время может отличаться от заявленного.', url: '/guides/withdrawal-time/', icon: '◷' }
    ]
  },
  {
    route: '/guides/', active: 'guides', eyebrow: 'База знаний', h1: 'Гайды для пользователей',
    title: 'Гайды: бонусы, вейджер, выплаты и безопасность — AFFGOLD',
    description: 'Понятные инструкции о бонусах, вейджере, верификации, выводе средств и проверке официального сайта.',
    lead: 'Материалы без сложных терминов: что проверить до регистрации, пополнения или активации бонуса.',
    cards: [
      { title: 'Что такое вейджер', text: 'Как читать обозначение x30, x35 или x40.', url: '/guides/what-is-wager/', icon: '×' },
      { title: 'Как работают фриспины', text: 'Активация, ограничения и отыгрыш выигрыша.', url: '/guides/how-free-spins-work/', icon: '↻' },
      { title: 'Верификация', text: 'Когда могут запросить документы и как подготовиться.', url: '/guides/verification/', icon: '✓' },
      { title: 'Срок вывода', text: 'Из чего складывается время обработки заявки.', url: '/guides/withdrawal-time/', icon: '◷' },
      { title: 'Как выбрать проект', text: 'Практический чек-лист перед регистрацией.', url: '/guides/how-to-choose/', icon: '☷' },
      { title: 'Проверка официального сайта', text: 'Как снизить риск перехода на копию или фишинговую страницу.', url: '/guides/official-site-safety/', icon: '⚑' }
    ]
  },
  {
    route: '/about/', active: 'about', eyebrow: 'Прозрачность', h1: 'О проекте AFFGOLD',
    title: 'О проекте AFFGOLD: редакция и методика работы',
    description: 'Как AFFGOLD собирает данные, рассчитывает оценки, обновляет обзоры и отмечает партнерские материалы.',
    lead: 'Наша задача — собрать сравнимые данные в одном месте и показать ограничения каждого предложения понятным языком.',
    cards: [
      { title: 'Методика рейтинга', text: 'Критерии оценки и правила обновления данных.', url: '/about/methodology/', icon: '★' },
      { title: 'Редакционная политика', text: 'Как отделяются факты, мнение и партнерские ссылки.', url: '/about/editorial-policy/', icon: '✎' },
      { title: 'Партнёрское уведомление', text: 'Как сайт может получать вознаграждение за переходы.', url: '/about/affiliate-disclosure/', icon: 'i' },
      { title: 'Ответственная игра', text: 'Ограничения 18+, лимиты и признаки потери контроля.', url: '/about/responsible-play/', icon: '!' }
    ]
  }
];

hubs.forEach((hub) => writeRoute(hub.route, page({
  ...hub, breadcrumbs: [{ name: hub.h1, url: hub.route }],
  content: `${cardGrid(hub.cards)}${textPanel('principles', 'Как пользоваться разделом', [
    'Откройте нужную подборку, сравните ключевые условия и только после этого переходите к подробному обзору. Рейтинг не заменяет самостоятельную проверку правил на официальном сайте.',
    'Предложения могут меняться. Поэтому рядом с материалами указана дата обновления, а в обзорах отдельно перечислены проверяемые параметры.'
  ])}`
})));

const collectionPages = [
  { route: '/ratings/fast-payouts/', active: 'ratings', eyebrow: 'Рейтинг', h1: 'Проекты с быстрыми выплатами', title: 'Проекты с быстрыми выплатами — рейтинг AFFGOLD', description: 'Подборка проектов со сроком обработки моментально или до одного часа по данным каталога AFFGOLD.', lead: 'Сравнение заявленной скорости обработки, рейтинга и бонусных условий.', items: projects.filter((p) => ['instant','hour'].includes(p.payout)), intro: ['В список попадают проекты, у которых в базе указан срок «моментально» или «до одного часа». Это ориентир, а не гарантия фактического зачисления.', 'На итоговое время влияют платежная система, проверка аккаунта, лимиты и загруженность финансового отдела.'], list: ['проверьте статус верификации до заявки;', 'сравните лимиты конкретного метода;', 'сохраняйте подтверждение операции.'] },
  { route: '/ratings/low-wager/', active: 'ratings', eyebrow: 'Рейтинг', h1: 'Бонусы с низким вейджером', title: 'Проекты с низким вейджером бонуса — AFFGOLD', description: 'Сортировка предложений по вейджеру: от меньшего требования к отыгрышу к большему.', lead: 'Чем ниже множитель, тем меньше общий оборот для выполнения базового условия, но всегда важны дополнительные ограничения.', items: [...projects].sort((a,b) => a.wager-b.wager), intro: ['Вейджер показывает, сколько раз необходимо поставить бонус или другую указанную в правилах сумму. На странице используется значение из базы обзоров.', 'Низкий множитель сам по себе не делает предложение выгодным: проверьте максимальную ставку, срок действия и список исключённых игр.'], list: ['что именно умножается на вейджер;', 'какие игры участвуют в отыгрыше;', 'есть ли ограничение максимального выигрыша.'] },
  { route: '/ratings/mobile/', active: 'ratings', eyebrow: 'Рейтинг', h1: 'Лучшие мобильные проекты', title: 'Мобильные онлайн-проекты 2026 — AFFGOLD', description: 'Подборка проектов с адаптивной мобильной версией по данным обзоров AFFGOLD.', lead: 'Проекты, в описании которых отмечена адаптация интерфейса под смартфоны.', items: projects.filter((p) => p.tags.some((tag) => /мобиль|адаптив/i.test(tag))), intro: ['Мобильная версия должна сохранять основные функции: вход, каталог, кассу, историю операций, настройки лимитов и поддержку.', 'Перед использованием проверьте скорость загрузки на своей сети и не устанавливайте приложения из непроверенных источников.'], list: ['удобство навигации одной рукой;', 'доступность поддержки и истории платежей;', 'корректное отображение правил бонуса.'] },
  { route: '/bonuses/welcome/', active: 'bonuses', eyebrow: 'Бонусы', h1: 'Приветственные бонусы', title: 'Приветственные бонусы онлайн-проектов 2026 — AFFGOLD', description: 'Сравнение приветственных предложений: проценты, фриспины, вейджер и дата обновления.', lead: 'Стартовые предложения из каталога с быстрым переходом к полным условиям.', items: projects.filter((p) => p.bonusTypes.includes('welcome')), intro: ['Приветственный пакет может начисляться за один или несколько депозитов. Сравнивать только максимальный процент неправильно — учитывайте вейджер и порядок начисления фриспинов.', 'До активации проверьте минимальную сумму, срок выполнения условий и допустимые способы пополнения.'], list: ['размер и количество этапов пакета;', 'вейджер и срок отыгрыша;', 'ограничение ставки и доступные игры.'] },
  { route: '/bonuses/free-spins/', active: 'bonuses', eyebrow: 'Бонусы', h1: 'Бонусы с фриспинами', title: 'Фриспины за регистрацию и депозит — AFFGOLD', description: 'Предложения с бесплатными вращениями: количество FS, вейджер и условия активации.', lead: 'Сравнение предложений с фриспинами из базы AFFGOLD.', items: projects.filter((p) => p.bonusTypes.includes('freespins')), intro: ['Количество фриспинов не показывает их реальную ценность без информации о номинале вращения и правилах отыгрыша выигрыша.', 'Иногда вращения выдаются частями в течение нескольких дней. Пропущенная активация может привести к потере очередной части.'], list: ['номинал одного вращения;', 'игра, для которой выданы FS;', 'срок активации и вейджер выигрыша.'] },
  { route: '/payments/crypto/', active: 'guides', eyebrow: 'Платежи', h1: 'Проекты с Bitcoin и Tether', title: 'Проекты с криптовалютой: Bitcoin и Tether — AFFGOLD', description: 'Подборка проектов, где Bitcoin или Tether указаны среди платежных методов.', lead: 'Список из базы AFFGOLD и базовые правила безопасной криптовалютной операции.', items: projects.filter((p) => p.payments.some((m) => ['Bitcoin','Tether'].includes(m))), intro: ['Криптовалютный перевод обычно нельзя отменить. Проверяйте сеть, адрес и минимальную сумму перед подтверждением транзакции.', 'Совпадение названия токена недостаточно: одна и та же валюта может работать в нескольких сетях с разными адресами.'], list: ['сеть перевода должна совпадать;', 'учитывайте комиссию сети;', 'проверьте количество подтверждений.'] },
  { route: '/payments/bank-cards/', active: 'guides', eyebrow: 'Платежи', h1: 'Пополнение банковской картой', title: 'Пополнение и вывод на банковские карты — AFFGOLD', description: 'Проекты с VISA, Mastercard или МИР в базе AFFGOLD и чек-лист перед платежом.', lead: 'Карточные методы из базы проектов и факторы, влияющие на проведение операции.', items: projects.filter((p) => p.payments.some((m) => ['VISA','Mastercard','МИР'].includes(m))), intro: ['Наличие логотипа карты в списке методов не гарантирует доступность операции для каждого банка и региона.', 'До пополнения проверьте комиссию, минимальную сумму, имя получателя и возможность возврата на тот же метод.'], list: ['карта оформлена на владельца аккаунта;', 'лимиты банка позволяют операцию;', 'данные вводятся на защищённой странице.'] }
  ,{ route: '/bonuses/cashback/', active: 'bonuses', eyebrow: 'Бонусы', h1: 'Кэшбэк в онлайн-проектах', title: 'Кэшбэк: проекты и условия возврата — AFFGOLD', description: 'Проекты, где кэшбэк указан среди типов предложения, и правила проверки периода, процента и вейджера.', lead: 'Сравните карточки и обязательно уточните, от какой суммы рассчитывается возврат.', items: projects.filter((p) => p.bonusTypes.includes('cashback')), intro: ['Кэшбэк может рассчитываться от чистого проигрыша за день, неделю или другой период. Процент без базы расчёта ничего не говорит о фактической сумме.', 'Также проверьте, начисляется ли возврат реальными или бонусными средствами и применяется ли к нему вейджер.'], list: ['период расчёта;','минимальная сумма;','тип баланса после начисления;','ограничение на вывод.'] }
  ,{ route: '/payments/e-wallets/', active: 'guides', eyebrow: 'Платежи', h1: 'Электронные кошельки', title: 'Электронные кошельки для пополнения и вывода — AFFGOLD', description: 'Проекты с электронными кошельками в базе и чек-лист комиссии, лимитов и принадлежности аккаунта.', lead: 'Подборка проектов, где WebMoney указан среди доступных методов.', items: projects.filter((p) => p.payments.includes('WebMoney')), intro: ['Электронный кошелёк должен принадлежать владельцу аккаунта, если правила проекта требуют совпадения данных.', 'Доступность метода и валюта операции зависят от региона. Проверьте комиссию на обеих сторонах до перевода.'], list: ['верификация кошелька;','минимальная и максимальная сумма;','срок зачисления;','комиссия за операцию.'] }
];

collectionPages.forEach((item) => writeRoute(item.route, page({
  ...item, breadcrumbs: [item.parent || { name: item.active === 'bonuses' ? 'Бонусы' : item.active === 'ratings' ? 'Рейтинги' : 'Гайды', url: item.active === 'bonuses' ? '/bonuses/' : item.active === 'ratings' ? '/ratings/' : '/guides/' }, { name: item.h1, url: item.route }],
  content: `${textPanel('about', 'Как составлена подборка', item.intro)}${projectCards(item.items)}${textPanel('checklist', 'Что проверить самостоятельно', ['Откройте правила выбранного проекта непосредственно перед действием: условия и доступность методов меняются.'], item.list)}`,
  sidebar: sidebar([{ id: 'about', title: 'О подборке' }, { id: 'checklist', title: 'Чек-лист' }]),
  schema: { '@context': 'https://schema.org', '@type': 'ItemList', name: item.h1, numberOfItems: item.items.length, itemListElement: item.items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${DOMAIN}${projectUrl(p)}`, name: p.name })) }
})));

const informationalPages = [
  { route: '/bonuses/no-deposit/', active: 'bonuses', eyebrow: 'Бонусы', h1: 'Бездепозитные бонусы: как проверить условия', title: 'Бездепозитные бонусы: проверка условий и ограничений — AFFGOLD', description: 'Как проверять бездепозитные бонусы, промокоды и бесплатные вращения без обязательного пополнения.', lead: 'В текущей базе нет подтверждённого постоянного бездепозитного предложения, поэтому мы не публикуем неподтверждённые обещания.', blocks: [
    ['status','Почему список может быть пустым',['Бездепозитные акции часто действуют ограниченное время, зависят от региона или доступны только по отдельному промокоду. Публикация старого предложения создаёт ложные ожидания.','Мы добавим проект в подборку только после фиксации условий: кто может участвовать, срок активации, вейджер и лимит выигрыша.'],[]],
    ['check','Как проверить предложение',['Найдите правила акции на официальном сайте и убедитесь, что они относятся к вашей стране и типу аккаунта. Не ориентируйтесь только на рекламный баннер.'],['требуется ли депозит позже;','какой вейджер применяется к выигрышу;','есть ли лимит на вывод;','сколько времени даётся на активацию.']]
  ]},
  { route: '/guides/what-is-wager/', active: 'guides', eyebrow: 'Гайд', h1: 'Что такое вейджер бонуса', title: 'Что такое вейджер x30, x35 и x40 — простое объяснение', description: 'Простое объяснение вейджера бонуса с примером расчёта и списком дополнительных условий.', lead: 'Вейджер — множитель, который показывает требуемый оборот до выполнения условий бонуса.', blocks: [
    ['formula','Пример расчёта',['Если правила требуют отыграть бонус 1 000 ₽ с вейджером x35, базовый расчёт оборота составляет 35 000 ₽. Но иногда множитель применяется к сумме бонуса и депозита вместе — это обязательно нужно уточнить в правилах.'],[]],
    ['details','Почему одного числа недостаточно',['Разные игры могут давать разный процент вклада в отыгрыш. Также часто устанавливаются максимальная ставка, срок выполнения и ограничение на вывод выигрыша.'],['что умножается: бонус или бонус плюс депозит;','какие игры засчитываются;','максимальный размер ставки;','срок выполнения условий.']]
  ]},
  { route: '/guides/how-free-spins-work/', active: 'guides', eyebrow: 'Гайд', h1: 'Как работают фриспины', title: 'Как работают фриспины: активация, номинал и вейджер', description: 'Как начисляются бесплатные вращения, что такое номинал FS и как отыгрывается полученный выигрыш.', lead: 'FS — это бесплатное вращение в определённой игре, но его номинал и условия задаёт конкретная акция.', blocks: [
    ['activation','Начисление и активация',['Фриспины могут поступить сразу, частями по дням или после выполнения дополнительного действия. Иногда их нужно активировать в личном кабинете до указанного времени.'],[]],
    ['result','Что происходит с выигрышем',['Выигрыш от бесплатных вращений часто переводится на бонусный баланс и получает отдельный вейджер. До его выполнения вывод может быть недоступен.'],['проверьте номинал одного FS;','найдите название доступной игры;','уточните срок активации;','прочитайте условия отыгрыша выигрыша.']]
  ]},
  { route: '/guides/verification/', active: 'guides', eyebrow: 'Гайд', h1: 'Верификация аккаунта', title: 'Верификация аккаунта: документы и сроки проверки — AFFGOLD', description: 'Когда запрашивается верификация, какие документы могут потребоваться и как безопасно пройти проверку.', lead: 'Проверка личности может проводиться при регистрации, перед выплатой или при срабатывании правил безопасности.', blocks: [
    ['documents','Что могут запросить',['Обычно проверяются личность, возраст, адрес и принадлежность платежного метода. Точный список зависит от правил проекта и требований обслуживающей платежной системы.'],['документ, удостоверяющий личность;','подтверждение адреса;','подтверждение принадлежности карты или кошелька.']],
    ['safety','Как передавать документы безопасно',['Загружайте файлы только через защищённый раздел официального сайта. Не отправляйте полный номер карты, CVV-код, пароль или одноразовые коды из сообщений.'],[]]
  ]},
  { route: '/guides/withdrawal-time/', active: 'guides', eyebrow: 'Гайд', h1: 'Сколько времени занимает вывод', title: 'Срок вывода средств: обработка заявки и задержки — AFFGOLD', description: 'Из чего складывается срок вывода, почему заявка задерживается и что проверить до обращения в поддержку.', lead: 'Обработка проектом и зачисление платежной системой — два разных этапа.', blocks: [
    ['stages','Этапы операции',['Сначала заявка проходит внутреннюю обработку, затем передаётся банку, кошельку или блокчейну. Даже мгновенно одобренная заявка может зачисляться дольше на стороне метода.'],[]],
    ['delay','Причины задержки',['Частые причины — первая выплата, незавершённая верификация, несовпадение владельца платежного метода, превышение лимита или дополнительная проверка бонусных условий.'],['проверьте статус заявки;','сравните срок с правилами кассы;','подготовьте идентификатор операции;','обращайтесь только в официальную поддержку.']]
  ]},
  { route: '/guides/how-to-choose/', active: 'guides', eyebrow: 'Гайд', h1: 'Как выбрать онлайн-проект', title: 'Как выбрать онлайн-проект: практический чек-лист — AFFGOLD', description: 'Чек-лист выбора проекта: правила, выплаты, вейджер, поддержка, лимиты и мобильная версия.', lead: 'Начинайте не с размера бонуса, а с правил, методов оплаты и возможности контролировать расходы.', blocks: [
    ['criteria','Основные критерии',['Сравните доступность проекта для вашего региона, правила проверки личности, сроки обработки, платежные лимиты и качество поддержки. Затем оценивайте бонус.'],['понятные правила и контакты;','доступные методы оплаты;','лимиты и самоограничения;','полные условия бонуса;','дата обновления обзора.']],
    ['test','Проверка до пополнения',['Изучите интерфейс, найдите правила, откройте раздел поддержки и убедитесь, что понимаете процедуру вывода. Не используйте деньги, потеря которых повлияет на обязательные расходы.'],[]]
  ]},
  { route: '/guides/official-site-safety/', active: 'guides', eyebrow: 'Безопасность', h1: 'Как проверить официальный сайт', title: 'Как отличить официальный сайт от копии и фишинга — AFFGOLD', description: 'Проверка адреса сайта, защищённого соединения, формы входа и каналов поддержки перед вводом данных.', lead: 'Поддельная страница может копировать дизайн, поэтому проверять нужно адрес и источник ссылки.', blocks: [
    ['address','Проверка адреса',['Сравните домен с адресом из проверенного источника, обратите внимание на лишние символы и подмену букв. Значок HTTPS означает защищённое соединение, но сам по себе не подтверждает подлинность сайта.'],[]],
    ['warning','Признаки риска',['Закройте страницу, если она просит пароль от почты, CVV, код из SMS, секретную фразу кошелька или установку неизвестного расширения.'],['не переходите по сокращённым ссылкам от незнакомых людей;','не сохраняйте пароль на общем устройстве;','включите двухфакторную защиту, если она доступна.']]
  ]},
  { route: '/about/methodology/', active: 'about', eyebrow: 'Прозрачность', h1: 'Методика рейтинга AFFGOLD', title: 'Методика рейтинга и проверки проектов — AFFGOLD', description: 'Критерии рейтинга AFFGOLD: надёжность, бонусы, каталог, выплаты, поддержка и правила обновления.', lead: 'Оценка строится из пяти блоков и служит инструментом сравнения, а не гарантией результата.', blocks: [
    ['criteria','Критерии оценки',['В базе отдельно хранятся оценки надёжности, бонусов, каталога, выплат и поддержки. Итоговая оценка отображается по десятичной шкале до 5,0.'],['понятность правил и доступность информации;','полнота бонусных условий;','набор функций и адаптивность;','заявленные сроки обработки;','доступность каналов поддержки.']],
    ['updates','Обновление данных',['Материал получает дату последней существенной проверки. Если условия не подтверждаются или страница недоступна, информация должна быть исправлена, а неподтверждённое предложение исключено из подборки.'],[]]
  ]},
  { route: '/about/editorial-policy/', active: 'about', eyebrow: 'Редакция', h1: 'Редакционная политика', title: 'Редакционная политика и партнёрские материалы — AFFGOLD', description: 'Правила подготовки обзоров, исправления ошибок и обозначения партнёрских ссылок на AFFGOLD.', lead: 'Коммерческое сотрудничество не должно скрывать ограничения предложения или менять фактические данные.', blocks: [
    ['principles','Редакционные принципы',['Мы разделяем факты из условий, редакционную оценку и рекламные утверждения. Существенные ограничения должны быть видимы рядом с преимуществами.'],['не публиковать неподтверждённые гарантии;','указывать дату обновления;','исправлять найденные ошибки;','обозначать партнёрские переходы.']],
    ['corrections','Исправления',['Если вы нашли неточность, отправьте ссылку на страницу и подтверждающий источник через раздел контактов. После проверки материал обновляется с новой датой.'],[]]
  ]},
  { route: '/about/responsible-play/', active: 'about', eyebrow: '18+', h1: 'Ответственная игра', title: 'Ответственная игра, лимиты и самоограничение — AFFGOLD', description: 'Принципы ответственной игры: лимиты, пауза, самоисключение и признаки потери контроля.', lead: 'Развлечение не должно становиться способом заработка или решением финансовых проблем.', blocks: [
    ['rules','Базовые правила',['Заранее установите лимит денег и времени, не пытайтесь отыграть потери и не используйте заёмные средства. Остановитесь, если нарушаете собственные ограничения.'],['только для совершеннолетних;','не использовать деньги на обязательные расходы;','не играть в состоянии сильного стресса или опьянения;','делать регулярные паузы.']],
    ['help','Когда нужна пауза',['Если вы скрываете расходы, увеличиваете ставки после потерь или игра мешает работе и отношениям, используйте лимиты, временную блокировку или самоисключение и обратитесь за профессиональной помощью в своей стране.'],[]]
  ]},
  { route: '/about/affiliate-disclosure/', active: 'about', eyebrow: 'Прозрачность', h1: 'Партнёрское уведомление', title: 'Партнёрские ссылки и финансирование проекта — AFFGOLD', description: 'Как информационный сайт может получать вознаграждение за переходы и почему это не должно менять редакционные оценки.', lead: 'Некоторые ссылки могут быть партнёрскими: сайт получает вознаграждение, если пользователь совершает оговорённое действие.', blocks: [
    ['model','Как работает партнёрская модель',['Партнёрское вознаграждение помогает оплачивать разработку и обновление сайта. Оно не увеличивает цену для пользователя и не должно влиять на отображение существенных ограничений.'],[]],
    ['independence','Редакционная независимость',['Позиция в рейтинге определяется критериями методики. Наличие партнёрской ссылки должно обозначаться, а отсутствие сотрудничества не является основанием скрывать проект из каталога.'],['сравнивать проекты по одинаковым параметрам;','отмечать рекламные переходы;','исправлять ошибки независимо от сотрудничества.']]
  ]},
  { route: '/bonuses/promo-codes/', active: 'bonuses', eyebrow: 'Бонусы', h1: 'Промокоды: проверка и активация', title: 'Промокоды: где вводить и как проверить условия — AFFGOLD', description: 'Как проверить актуальность промокода, место ввода, срок действия, регион и бонусные ограничения.', lead: 'Код имеет смысл публиковать только вместе с подтверждёнными условиями и датой проверки.', blocks: [
    ['activation','Где вводить код',['Поле может находиться в форме регистрации, кассе или отдельном разделе акций. Если поле отсутствует, не передавайте код сотрудникам или сторонним людям в личных сообщениях.'],[]],
    ['check','Что проверить',['Убедитесь, что код действует для новых или существующих пользователей, подходит вашему региону и не конфликтует с другой активной акцией.'],['срок действия;','минимальное пополнение;','размер и тип бонуса;','вейджер и лимит вывода.']]
  ]},
  { route: '/terms/', active: 'about', eyebrow: 'Документы', h1: 'Условия использования сайта', title: 'Условия использования информационного сайта — AFFGOLD', description: 'Назначение материалов, ограничение ответственности, внешние ссылки и правила использования содержимого сайта.', lead: 'Сайт предоставляет справочную информацию и не принимает платежи пользователей.', blocks: [
    ['purpose','Назначение материалов',['Каталог, рейтинги и гайды предназначены для сравнения общедоступной информации. Они не являются финансовой рекомендацией, гарантией результата или заменой официальных правил проекта.'],[]],
    ['external','Внешние ресурсы',['Внешние сайты самостоятельно отвечают за свои условия, доступность и обработку данных. Пользователь обязан учитывать возрастные и правовые ограничения своей страны.'],['проверяйте дату обновления;','читайте официальные правила;','не передавайте чувствительные данные редакции.']]
  ]},
  { route: '/contacts/', active: 'about', eyebrow: 'Связь', h1: 'Контакты AFFGOLD', title: 'Контакты редакции AFFGOLD', description: 'Как связаться с редакцией AFFGOLD, сообщить об ошибке или предложить обновление данных.', lead: 'Для быстрой проверки укажите адрес страницы и конкретный фрагмент, который нужно исправить.', blocks: [
    ['contact','Каналы связи',['Telegram: @affgolld. Для вопросов по содержанию сайта используйте сообщение с пометкой «редакция».'],['ссылка на страницу;','описание неточности;','ссылка на подтверждающий источник;','дата, когда вы заметили проблему.']],
    ['scope','Что мы не запрашиваем',['Редакция не запрашивает пароли, коды подтверждения, данные банковской карты или документы пользователей. Вопросы по конкретному аккаунту направляйте официальной поддержке соответствующего проекта.'],[]]
  ]},
  { route: '/privacy/', active: 'about', eyebrow: 'Документы', h1: 'Политика конфиденциальности', title: 'Политика конфиденциальности AFFGOLD', description: 'Основные правила обработки технических данных и обращения пользователей на сайте AFFGOLD.', lead: 'Эта страница описывает базовые принципы работы информационного сайта без личного кабинета.', blocks: [
    ['data','Какие данные могут обрабатываться',['Хостинг и системы аналитики могут получать технические сведения: IP-адрес, тип браузера, адрес посещённой страницы, время запроса и источник перехода.'],[]],
    ['links','Внешние ссылки',['При переходе на внешний сайт начинают действовать его собственные правила конфиденциальности. Перед передачей данных ознакомьтесь с документами выбранного проекта.'],['не отправляйте чувствительные данные через общие формы;','проверяйте адрес внешней страницы;','управляйте cookie через настройки браузера.']]
  ]}
];

informationalPages.forEach((item) => {
  const parent = item.route.startsWith('/bonuses/') ? { name: 'Бонусы', url: '/bonuses/' }
    : item.route.startsWith('/guides/') ? { name: 'Гайды', url: '/guides/' }
    : { name: 'О проекте', url: '/about/' };
  const links = item.blocks.map(([id, title]) => ({ id, title }));
  writeRoute(item.route, page({
    ...item, breadcrumbs: [parent, { name: item.h1, url: item.route }],
    content: `${item.blocks.map(([id, title, paragraphs, list]) => textPanel(id, title, paragraphs, list)).join('')}<div class="seo-notice"><strong>Важно:</strong> материалы носят информационный характер. Проверяйте актуальные правила и возрастные ограничения.</div>`,
    sidebar: sidebar(links)
  }));
});

projects.forEach((project) => {
  const route = projectUrl(project);
  const schema = {
    '@context': 'https://schema.org', '@type': 'Article', headline: `Обзор ${project.name}`,
    description: project.description, dateModified: project.lastUpdated || UPDATED,
    author: { '@type': 'Organization', name: 'Редакция AFFGOLD' }, publisher: { '@type': 'Organization', name: 'AFFGOLD', url: DOMAIN },
    mainEntityOfPage: `${DOMAIN}${route}`
  };
  const related = projects.filter((item) => item.id !== project.id).slice(0, 3);
  writeRoute(route, reviewPage(project, related, schema));
});

[
  ['/compare/', '/catalog.html', 'Сравнения'],
  ['/compare/norm-vs-joycasino/', '/catalog.html', 'Сравнение NORM и JoyCasino'],
  ['/compare/apex-vs-tiger/', '/catalog.html', 'Сравнение APEX и TIGER'],
  ['/news/', '/bonuses/', 'Новости и акции'],
  ['/updates/', '/about/methodology/', 'Журнал обновлений'],
  ['/about/authors/', '/about/editorial-policy/', 'Авторы']
].forEach(([route, target, label]) => writeRoute(route, legacyRedirect(target, label), false));

const catalogPath = path.join(ROOT, 'catalog.html');
const catalogSchema = {
  '@context': 'https://schema.org', '@type': 'ItemList', name: 'Каталог проектов AFFGOLD',
  numberOfItems: projects.length,
  itemListElement: projects.map((project, index) => ({
    '@type': 'ListItem', position: index + 1, url: `${DOMAIN}${projectUrl(project)}`, name: project.name
  }))
};
const catalogSource = fs.readFileSync(catalogPath, 'utf8');
fs.writeFileSync(catalogPath, catalogSource.replace(
  /<script type="application\/ld\+json" data-catalog-schema>.*?<\/script>/s,
  `<script type="application/ld+json" data-catalog-schema>${JSON.stringify(catalogSchema).replaceAll('</script', '<\\/script')}</script>`
));

const sitemapRoutes = ['/', '/catalog.html', ...writtenRoutes];
const reviewUpdatedByRoute = new Map(projects.map((project) => [projectUrl(project), project.lastUpdated || UPDATED]));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(sitemapRoutes)].map((route) => `  <url><loc>${xmlEscape(`${DOMAIN}${route}`)}</loc><lastmod>${reviewUpdatedByRoute.get(route) || UPDATED}</lastmod></url>`).join('\n')}\n</urlset>\n`;
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);

const notFound = page({ route: '/404.html', active: '', eyebrow: 'Ошибка 404', h1: 'Страница не найдена', title: 'Страница не найдена — AFFGOLD', description: 'Запрошенная страница не найдена.', lead: 'Возможно, адрес изменился. Перейдите в каталог или выберите раздел сайта.', breadcrumbs: [{ name: '404', url: '/404.html' }], index: false,
  content: `<div class="seo-grid"><a class="card seo-card" href="/catalog.html"><span class="seo-card-icon">☷</span><h2>Каталог</h2><p>Все проекты и фильтры.</p><span class="seo-card-link">Открыть →</span></a><a class="card seo-card" href="/guides/"><span class="seo-card-icon">?</span><h2>Гайды</h2><p>Полезные инструкции.</p><span class="seo-card-link">Открыть →</span></a></div>`
});
fs.writeFileSync(path.join(ROOT, '404.html'), applyBasePath(notFound));

console.log(`Generated ${writtenRoutes.length} SEO routes and sitemap.xml`);
