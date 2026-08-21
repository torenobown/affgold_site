import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildStyles } from './build-css.mjs';
import { loadProjects, publishedProjects } from './lib/projects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readContentJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
const SITE_CONTENT = readContentJson('content/site.json');
const SEO_CONTENT = readContentJson('content/seo-pages.json');
if (!/^\d{4}-\d{2}-\d{2}$/.test(String(SITE_CONTENT.contentUpdated || ''))) {
  throw new Error('content/site.json: contentUpdated должен быть датой YYYY-MM-DD.');
}
if (!/^\/assets\/[a-z0-9_./-]+\.(?:png|jpe?g|webp)$/i.test(String(SITE_CONTENT.defaultSocialImage || ''))) {
  throw new Error('content/site.json: defaultSocialImage должен быть root-absolute путём к растровому изображению в assets.');
}
if (!fs.existsSync(path.join(ROOT, SITE_CONTENT.defaultSocialImage.replace(/^\//, '')))) {
  throw new Error(`Не найдено social image: ${SITE_CONTENT.defaultSocialImage}`);
}
if (!Array.isArray(SEO_CONTENT.hubs) || !Array.isArray(SEO_CONTENT.informationalPages) || !Array.isArray(SEO_CONTENT.editorialProfile?.blocks)) {
  throw new Error('content/seo-pages.json должен содержать hubs, informationalPages и editorialProfile.blocks.');
}
for (const pageKey of ['home', 'catalog']) {
  if (!SITE_CONTENT.pages?.[pageKey]?.title || !SITE_CONTENT.pages?.[pageKey]?.description) {
    throw new Error(`content/site.json: для pages.${pageKey} нужны title и description.`);
  }
}
const DOMAIN = String(process.env.AFFGOLD_SITE_URL || 'https://affgoldprod.com').replace(/\/+$/, '');
if (!/^https:\/\/[^/]+$/i.test(DOMAIN)) {
  throw new Error('AFFGOLD_SITE_URL должен быть HTTPS-адресом без пути, например https://example.com.');
}
// Внутренние ссылки генерируются относительными. Одна и та же сборка работает
// локально, на GitHub Pages в подпапке репозитория и на основном домене.
const UPDATED = SITE_CONTENT.contentUpdated;
const SOCIAL_IMAGE = `${DOMAIN}${SITE_CONTENT.defaultSocialImage}`;
const ORGANIZATION_ID = `${DOMAIN}/#organization`;
const projects = publishedProjects(loadProjects(ROOT));
if (!projects.length) throw new Error('Нет опубликованных проектов для публичной сборки.');
const writtenRoutes = [];
const GENERATED_DIRECTORIES = ['reviews','ratings','bonuses','compare','payments','guides','about','contacts','privacy','terms','news','updates'];
const GENERATED_FILES = [
  'index.html', 'catalog.html', 'review.html', '404.html', 'robots.txt', 'sitemap.xml',
  'css/site.css', 'css/home-page.css', 'css/catalog-page.css',
  'css/seo-page.css', 'css/review-page.css', 'css/project-theme-tokens.css'
];

// Сначала формируем полный сайт рядом с рабочими файлами. Публикация начинается
// только после успешного рендера всех страниц, поэтому ошибка не удалит старую версию.
const BUILD_ROOT = fs.mkdtempSync(path.join(ROOT, '.affgold-build-'));
process.on('exit', () => fs.rmSync(BUILD_ROOT, { recursive: true, force: true }));
buildStyles(projects, { outputDirectory: path.join(BUILD_ROOT, 'css') });

const assetFiles = [path.join(BUILD_ROOT, 'css'), path.join(ROOT, 'js'), path.join(ROOT, 'assets')]
  .flatMap((directory) => {
    const files = [];
    const visit = (current) => fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
      .forEach((entry) => {
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) visit(target);
        else if (entry.isFile()) files.push(target);
      });
    visit(directory);
    return files;
  });
const assetHash = crypto.createHash('sha256');
assetFiles.forEach((file) => {
  assetHash.update(fs.readFileSync(file));
});
const ASSET_VERSION = assetHash.digest('hex').slice(0, 10);

/* ---------- Безопасная запись и URL ---------- */

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const xmlEscape = (value = '') => escapeHtml(value);
const cleanSeoText = (value = '') => String(value)
  .replace(/\s+([.,:;])/g, '$1')
  .replace(/\s{2,}/g, ' ')
  .replace(/\s+[—-]\s*$/g, '')
  .trim();
const routeToFile = (route) => route === '/'
  ? path.join(BUILD_ROOT, 'index.html')
  : path.join(BUILD_ROOT, route.replace(/^\//, ''), 'index.html');

const routeDocument = (route) => {
  if (route === '/') return '/index.html';
  if (route.endsWith('/')) return `${route}index.html`;
  return route;
};

const relativeSiteUrl = (route, url = '/') => {
  const value = String(url);
  if (!value.startsWith('/') || value.startsWith('//')) return value;

  const fromDirectory = path.posix.dirname(routeDocument(route));
  const queryIndex = value.search(/[?#]/);
  const targetPath = queryIndex >= 0 ? value.slice(0, queryIndex) : value;
  const suffix = queryIndex >= 0 ? value.slice(queryIndex) : '';
  let relative = path.posix.relative(fromDirectory, targetPath || '/');

  if (!relative) relative = './';
  if (targetPath.endsWith('/') && !relative.endsWith('/')) relative += '/';
  return `${relative}${suffix}`;
};

// Меняем только локальные href/src на относительные пути. Canonical, Open Graph
// и JSON-LD продолжают указывать на основной домен абсолютными URL.
const applyRelativePaths = (html, route) => html.replace(
  /(\b(?:href|src)=["'])(\/(?!\/)[^"']*)/g,
  (match, attribute, url) => `${attribute}${relativeSiteUrl(route, url)}`
);

const versionAssetUrl = (rawUrl) => {
  const value = String(rawUrl);
  if (!value || /^(?:data:|https?:|\/\/|#)/i.test(value)) return value;

  const hashIndex = value.indexOf('#');
  const beforeHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const fragment = hashIndex >= 0 ? value.slice(hashIndex) : '';
  const queryIndex = beforeHash.indexOf('?');
  const pathname = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';
  if (!/\.(?:css|js|svg|png|jpe?g|webp|avif)$/i.test(pathname)) return value;

  const parameters = query.split('&').filter(Boolean).filter((item) => !/^v=/i.test(item));
  parameters.push(`v=${ASSET_VERSION}`);
  return `${pathname}?${parameters.join('&')}${fragment}`;
};

const applyAssetVersions = (html) => html
  .replace(/\b(href|src)=(['"])([^'"]*)\2/gi, (match, name, quote, url) => `${name}=${quote}${versionAssetUrl(url)}${quote}`)
  .replace(/\bsrcset=(['"])([^'"]*)\1/gi, (match, quote, value) => {
    if (/^\s*data:/i.test(value)) return match;
    const candidates = value.split(',').map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      if (!parts[0]) return candidate;
      parts[0] = versionAssetUrl(parts[0]);
      return parts.join(' ');
    });
    return `srcset=${quote}${candidates.join(', ')}${quote}`;
  });

const writeRoute = (route, content, index = true) => {
  const target = routeToFile(route);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, applyRelativePaths(applyAssetVersions(content), route));
  if (index) writtenRoutes.push(route);
};

const replaceManagedBlock = (source, name, content) => {
  const start = `<!-- AFFGOLD:${name}:START -->`;
  const end = `<!-- AFFGOLD:${name}:END -->`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex) throw new Error(`Не найдены маркеры ${name}.`);
  return `${source.slice(0, startIndex + start.length)}\n${content}\n${source.slice(endIndex)}`;
};

const upsertHeadBlock = (source, name, content) => {
  const start = `<!-- AFFGOLD:${name}:START -->`;
  const end = `<!-- AFFGOLD:${name}:END -->`;
  const block = `${start}${content}\n  ${end}`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex >= 0 && endIndex >= startIndex) {
    return `${source.slice(0, startIndex)}${block}${source.slice(endIndex + end.length)}`;
  }
  return source.replace('</head>', `  ${block}\n</head>`);
};

const publishGeneratedSite = () => {
  const backupRoot = fs.mkdtempSync(path.join(ROOT, '.affgold-backup-'));
  const targets = [...GENERATED_DIRECTORIES, ...GENERATED_FILES];
  const backedUp = new Set();
  let mutationStarted = false;

  try {
    // На Windows IDE может держать открытый каталог обзора и запрещать rename.
    // Поэтому сначала создаём полный recoverable backup, затем заменяем содержимое.
    targets.forEach((target) => {
      const destination = path.join(ROOT, target);
      const backup = path.join(backupRoot, target);
      if (fs.existsSync(destination)) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.cpSync(destination, backup, { recursive: true });
        backedUp.add(target);
      }
    });

    mutationStarted = true;
    targets.forEach((target) => {
      const source = path.join(BUILD_ROOT, target);
      const destination = path.join(ROOT, target);
      fs.rmSync(destination, { recursive: true, force: true });
      if (!fs.existsSync(source)) return;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(source, destination, { recursive: true });
    });
  } catch (error) {
    if (mutationStarted) {
      targets.forEach((target) => {
        const backup = path.join(backupRoot, target);
        const destination = path.join(ROOT, target);
        fs.rmSync(destination, { recursive: true, force: true });
        if (backedUp.has(target)) {
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.cpSync(backup, destination, { recursive: true });
        }
      });
    }
    throw error;
  } finally {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
};

const assertBuildComplete = () => {
  const missing = [...GENERATED_DIRECTORIES, ...GENERATED_FILES]
    .filter((target) => !fs.existsSync(path.join(BUILD_ROOT, target)));
  projects.forEach((project) => {
    const review = path.join(BUILD_ROOT, 'reviews', project.slug || project.id, 'index.html');
    if (!fs.existsSync(review)) missing.push(path.relative(BUILD_ROOT, review));
  });
  if (missing.length) throw new Error(`Сборка неполная. Не созданы: ${[...new Set(missing)].join(', ')}`);
};

const legacyRedirect = (route, target, label) => {
  const deployTarget = relativeSiteUrl(route, target);
  return `<!DOCTYPE html>
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

const documentTitle = (html) => cleanSeoText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || SITE_CONTENT.organization.name);
const documentDescription = (html) => cleanSeoText(html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']\s*\/?>/i)?.[1] || SITE_CONTENT.organization.description);
const applyPageMetadata = (html, metadata) => html
  .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(cleanSeoText(metadata.title))}</title>`)
  .replace(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']\s*\/?>/i, `<meta name="description" content="${escapeHtml(cleanSeoText(metadata.description))}">`);

/* ---------- Общие части страниц ---------- */

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
                  Каталог обзоров и справочных материалов. Перед использованием сверяйте условия на стороне проекта.
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
                  <a href="/about/authors/">Команда</a>
                  <a href="/about/methodology/">Методика</a>
                  <a href="/contacts/">Контакты</a>
                  <a href="/privacy/">Конфиденциальность</a>
                  <a href="/terms/">Условия использования</a>
                </div>
              </div>
            </div>

            <div class="foot-note">
              <span>© ${escapeHtml(UPDATED.slice(0, 4))} AFFGOLD</span>
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

const organizationReference = () => ({
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: SITE_CONTENT.organization.name,
  url: `${DOMAIN}/`,
  description: SITE_CONTENT.organization.description,
  logo: { '@type': 'ImageObject', url: `${DOMAIN}/assets/icons/favicon.svg` }
});

const socialMeta = ({ title, description, canonical, type = 'website' }) => `
  <meta property="og:locale" content="ru_RU"><meta property="og:site_name" content="${escapeHtml(SITE_CONTENT.organization.name)}">
  <meta property="og:type" content="${escapeHtml(type)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(SOCIAL_IMAGE)}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="AFFGOLD — обзоры и справочные материалы">
  <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(SOCIAL_IMAGE)}"><meta name="twitter:image:alt" content="AFFGOLD — обзоры и справочные материалы">`;

const breadcrumbsHtml = (items) => `<nav class="breadcrumbs" aria-label="Хлебные крошки">${items.map((item, index) => index === items.length - 1
  ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
  : `<a href="${item.url}">${escapeHtml(item.name)}</a><span>›</span>`).join('')}</nav>`;

const page = ({ route, title, description, eyebrow, h1, lead, active, breadcrumbs, content, sidebar = '', schema = null, index = true }) => {
  const canonical = `${DOMAIN}${route}`;
  const metaTitle = cleanSeoText(title);
  const metaDescription = cleanSeoText(description);
  const items = [{ name: 'Главная', url: '/' }, ...breadcrumbs];
  const schemas = [breadcrumbSchema(items), {
    '@context': 'https://schema.org', '@type': 'WebPage', name: h1, description, url: canonical,
    publisher: organizationReference(),
    primaryImageOfPage: { '@type': 'ImageObject', url: SOCIAL_IMAGE }, inLanguage: 'ru'
  }, ...(schema ? [schema] : [])];
  return `<!DOCTYPE html>
<html lang="ru"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(metaTitle)}</title><meta name="description" content="${escapeHtml(metaDescription)}">
  <meta name="robots" content="${index ? 'index,follow,max-image-preview:large' : 'noindex,follow'}">
  <link rel="canonical" href="${canonical}"><link rel="icon" type="image/svg+xml" href="/assets/icons/favicon.svg">
  ${socialMeta({ title: metaTitle, description: metaDescription, canonical, type: schema?.['@type'] === 'Article' ? 'article' : 'website' }).trimStart()}
  <script>document.documentElement.classList.add('motion-ready');window.__affgoldMotionFallback=setTimeout(()=>document.documentElement.classList.remove('motion-ready'),3000)</script>
  <link rel="stylesheet" href="/css/seo-page.css">
  ${schemas.map((item) => `<script type="application/ld+json">${JSON.stringify(item).replaceAll('</script', '<\\/script')}</script>`).join('\n  ')}
</head><body data-page="${active || ''}"><div class="site-shell"><div class="bg-glow one"></div><div class="bg-glow two"></div>
${nav(active)}
<main>
  <section class="seo-hero"><div class="container seo-hero-inner reveal">
    ${breadcrumbsHtml(items)}<span class="seo-eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(h1)}</h1><p class="seo-lead">${escapeHtml(lead)}</p>
  </div></section>
  <section class="section"><div class="container ${sidebar ? 'seo-layout' : ''}"><div class="seo-main">${content}</div>${sidebar ? `<aside class="seo-sidebar">${sidebar}</aside>` : ''}</div></section>
</main>${footer()}${mobileDock(active)}</div><script src="/js/main.js"></script></body></html>`;
};

const cardGrid = (cards) => `<div class="seo-grid">${cards.map((card) => `<a class="card seo-card" href="${card.url}"><span class="seo-card-icon">${card.icon || '◆'}</span><h2>${escapeHtml(card.title)}</h2><p>${escapeHtml(card.text)}</p><span class="seo-card-link">Открыть →</span></a>`).join('')}</div>`;

const projectCardArticles = (items) => items.map((project) => `
  <article class="card project-card reveal" data-project-theme="${escapeHtml(project.id)}" data-project-id="${escapeHtml(project.id)}" data-project-name="${escapeHtml(project.name)}" data-project-search="${escapeHtml(`${project.name} ${project.bonus} ${project.promoCode || ''}`)}" data-payout="${escapeHtml(project.payout)}" data-bonus-types="${escapeHtml(project.bonusTypes.join(','))}" data-rating="${project.rating}" data-wager="${project.wager}" aria-label="${escapeHtml(project.name)}">
    <div class="project-card__head">
      <a class="project-card__logo" href="${projectUrl(project)}" aria-label="Обзор ${escapeHtml(project.name)}"><img src="${escapeHtml(absoluteLogo(project))}" alt="${escapeHtml(project.name)}" width="96" height="38" loading="lazy" decoding="async"></a>
      <div class="project-card__rating"><span class="rating-chip">★ ${project.rating.toFixed(1)}</span><span>${escapeHtml(project.verdict)}</span></div>
    </div>
    <div><span class="project-card__label">Бонус</span><div class="project-card__bonus">${escapeHtml(project.bonus)}</div><p class="project-card__sub">${escapeHtml(project.bonusSubtitle)}</p></div>
    <dl class="project-card__facts"><div><dt>Заявленный срок</dt><dd>${escapeHtml(project.payoutLabel)}</dd></div><div><dt>Вейджер</dt><dd>x${project.wager}</dd></div></dl>
    <button class="promo-code promo-code-sm" type="button" data-copy-code="${escapeHtml(project.promoCode || 'BETGOLDTEAM')}" title="Скопировать промокод"><span>Промокод</span><strong>${escapeHtml(project.promoCode || 'BETGOLDTEAM')}</strong></button>
    <div class="project-card__actions"><a class="btn btn-secondary btn-sm" href="${projectUrl(project)}">Обзор</a>${offerUrl(project) ? `<a class="btn btn-primary btn-project btn-sm" href="${escapeHtml(offerUrl(project))}" target="_blank" rel="sponsored nofollow noopener noreferrer" aria-label="Перейти к предложению ${escapeHtml(project.name)}">Перейти</a>` : ''}</div>
  </article>`).join('');
const projectCards = (items) => `<div class="project-grid">${projectCardArticles(items)}</div>`;

const textPanel = (id, title, paragraphs, list = []) => `<section class="card seo-panel" id="${id}"><h2>${escapeHtml(title)}</h2>${paragraphs.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}${list.length ? `<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</section>`;
const faqPanel = (items = []) => items.length ? `<section class="card seo-panel" id="faq"><h2>Частые вопросы</h2>${items.map(([question, answer]) => `<h3>${escapeHtml(question)}</h3><p>${escapeHtml(answer)}</p>`).join('')}</section>` : '';
const sidebar = (links = []) => `<div class="card seo-toc"><h2>На этой странице</h2>${links.map((link) => `<a href="#${link.id}">${escapeHtml(link.title)}</a>`).join('')}</div><div class="card seo-trust"><strong>Как мы работаем</strong><p>Сравниваем условия из базы проекта и напоминаем, что предложения могут измениться.</p><a class="seo-card-link" href="/about/methodology/">Методика рейтинга →</a></div>`;

/* ---------- Компоненты и шаблон обзора проекта ---------- */

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
  const methods = project.payments.join(', ');
  const sources = Array.isArray(project.sources) ? project.sources : [];
  const sourceDetails = sources.length
    ? `<p>Источники данных:</p><ul>${sources.map((source) => {
      const relation = source.url === externalUrl ? 'sponsored nofollow noopener noreferrer' : 'noopener noreferrer';
      return `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="${relation}">${escapeHtml(source.label)}</a></li>`;
    }).join('')}</ul>`
    : '<p>Внешние первичные источники в карточке не указаны. Значения помечены как заявленные; до использования их необходимо сверить в правилах проекта.</p>';

  return `<!DOCTYPE html>
<html lang="ru"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${canonical}"><link rel="icon" type="image/svg+xml" href="/assets/icons/favicon.svg">
  ${socialMeta({ title, description, canonical, type: 'article' }).trimStart()}
  <script>document.documentElement.classList.add('motion-ready');window.__affgoldMotionFallback=setTimeout(()=>document.documentElement.classList.remove('motion-ready'),3000)</script>
  <link rel="stylesheet" href="/css/review-page.css">
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
            <div class="review-hero-card__logo"><img src="${escapeHtml(absoluteLogo(project))}" alt="${escapeHtml(project.name)}" width="126" height="32" decoding="async"></div>
            <div><span class="review-kicker">Обзор проекта</span><h1>Обзор <span>${escapeHtml(project.name)}</span></h1><div class="review-hero-card__rating">${reviewStars(project.rating)}<strong>${project.rating.toFixed(1)}</strong><span>${escapeHtml(project.verdict)}</span></div></div>
          </div>
          <p class="review-hero-card__lead">${escapeHtml(project.description)}</p>
          <p class="review-hero-card__summary">Стартовое предложение — ${escapeHtml(project.bonus)}, требование к отыгрышу — x${project.wager}. Перед активацией проверьте актуальные правила и доступность в своём регионе.</p>
          <div class="review-tags">${project.tags.map((tag) => `<span class="review-tag">${escapeHtml(tag)}</span>`).join('')}</div>
          <dl class="review-hero-facts"><div><dt>Бонус по данным проекта</dt><dd>${escapeHtml(project.bonus)}</dd></div><div><dt>Заявленный срок обработки</dt><dd>${escapeHtml(project.payoutLabel)}</dd></div></dl>
        </div>
      </article>

      <aside class="card review-score-card reveal" id="rating" aria-labelledby="review-score-title">
        <div class="review-score-card__head"><div><span class="review-kicker">Оценка проекта</span><h2 id="review-score-title">Коротко о проекте</h2></div><span class="review-score-card__badge">5 критериев</span></div>
        <div class="review-score-list">${reviewScoreRows(project.scores)}</div>
        <div class="review-score-total"><div><span>Общая оценка</span><strong>${project.rating.toFixed(1)}</strong><small>/ 5</small></div>${reviewStars(project.rating)}<p>${escapeHtml(project.verdict)}</p></div>
        <a class="review-inline-link" href="/about/methodology/">Как считаем рейтинг <span aria-hidden="true">→</span></a>
      </aside>

      <aside class="card review-cta-card reveal" aria-labelledby="review-cta-title">
        <div class="review-cta-card__content"><span class="review-kicker">Предложение проекта</span><h2 id="review-cta-title">Готовы перейти?</h2><p>Сначала сверьте правила и региональную доступность на стороне проекта.</p><strong class="review-cta-card__bonus">${escapeHtml(project.bonus)}</strong><button class="promo-code" type="button" data-copy-code="${escapeHtml(promoCode)}" title="Скопировать промокод"><span>Промокод</span><strong>${escapeHtml(promoCode)}</strong></button>${externalUrl ? `<a class="btn btn-primary btn-project" href="${escapeHtml(externalUrl)}" target="_blank" rel="sponsored nofollow noopener noreferrer">Открыть предложение</a>` : ''}</div>
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
        <section class="review-article__section" id="bonus-details"><span class="review-card-icon review-card-icon--small">${reviewIcon('gift')}</span><div><h2>Бонус и важные условия</h2><p>${escapeHtml(project.tabs.bonuses)}</p><p>Для ${escapeHtml(project.name)} в базе зафиксирован вейджер x${project.wager}. До активации уточните, применяется ли он только к бонусу или также к депозиту, а также проверьте максимальную ставку, срок и исключённые игры.</p></div></section>
        <section class="review-article__section" id="games"><span class="review-card-icon review-card-icon--small">${reviewIcon('games')}</span><div><h2>Игровой каталог</h2><p>${escapeHtml(project.tabs.slots)}</p><p>Наличие конкретной игры в ${escapeHtml(project.name)} проверяйте непосредственно перед запуском: состав каталога и региональная доступность меняются независимо от даты обзора.</p></div></section>
        <section class="review-article__section" id="payments"><span class="review-card-icon review-card-icon--small">${reviewIcon('wallet')}</span><div><h2>Пополнение и вывод</h2><p>${escapeHtml(project.tabs.payments)}</p><p>В карточке перечислены ${escapeHtml(methods)}; заявленный срок обработки — <strong>${escapeHtml(project.payoutLabel)}</strong>. Это не гарантия зачисления: время зависит от метода, валюты, верификации и статуса аккаунта.</p><ul class="review-payment-list" aria-label="Платёжные методы по данным проекта">${project.payments.map((method) => `<li>${escapeHtml(method)}</li>`).join('')}</ul></div></section>
        <section class="review-article__section" id="sources"><span class="review-card-icon review-card-icon--small">${reviewIcon('info')}</span><div><h2>Источники данных</h2>${sourceDetails}<p>Будущая доступность предложения и выплата не гарантируются. О критериях оценки читайте в <a href="/about/methodology/">методике рейтинга</a>.</p></div></section>
      </article>
      <aside class="review-body-aside" aria-label="Навигация и методика обзора">
        <nav class="card review-toc reveal" aria-label="Содержание обзора"><h2>На этой странице</h2><a href="#overview">Краткий обзор</a><a href="#rating">Оценка проекта</a><a href="#features">Особенности</a><a href="#bonus-details">Бонус</a><a href="#games">Игры</a><a href="#payments">Платежи</a><a href="#sources">Источники</a><a href="#related">Похожие проекты</a></nav>
        <div class="card review-method-card reveal"><span class="review-card-icon review-card-icon--small">${reviewIcon('shield')}</span><h2>Как мы работаем</h2><p>Пять критериев имеют равный вес 20%. Итог — их среднее значение, округлённое до десятых. Оценка помогает сравнивать проекты, но не гарантирует результат.</p><a class="review-inline-link" href="/about/methodology/">Методика рейтинга <span aria-hidden="true">→</span></a></div>
      </aside>
    </div>
  </div></section>

  <section class="section review-related-section" id="related"><div class="container"><div class="section-header reveal"><div><h2>Похожие проекты</h2><p>Ещё несколько обзоров с тем же форматом данных.</p></div><a class="link-more" href="/catalog.html">Весь каталог →</a></div>${projectCards(related)}</div></section>
</main>${footer()}${mobileDock('catalog')}</div><script src="/js/main.js"></script></body></html>`;
};

/* ---------- Редактируемый контент разделов ---------- */

const hubs = SEO_CONTENT.hubs;

hubs.forEach((hub) => writeRoute(hub.route, page({
  ...hub, breadcrumbs: [{ name: hub.h1, url: hub.route }],
  content: `${cardGrid(hub.cards)}${textPanel('principles', 'Как пользоваться разделом', [
    'Откройте нужную подборку, сравните ключевые условия и только после этого переходите к подробному обзору. Рейтинг не заменяет самостоятельную проверку правил на официальном сайте.',
    'Предложения могут меняться. В обзорах отдельно перечислены параметры, которые стоит сверить на стороне проекта.'
  ])}`
})));

const collectionPages = [
  { route: '/ratings/fast-payouts/', active: 'ratings', eyebrow: 'Рейтинг', h1: 'Проекты с заявленным быстрым выводом', title: 'Заявленный быстрый вывод средств — рейтинг AFFGOLD', description: 'Подборка проектов со сроком обработки моментально или до одного часа по данным каталога AFFGOLD.', lead: 'Сравнение заявленной скорости обработки, рейтинга и бонусных условий.', items: projects.filter((p) => ['instant','hour'].includes(p.payout)), intro: ['В список попадают проекты, у которых в базе указан срок «моментально» или «до одного часа». Это ориентир, а не гарантия фактического зачисления.', 'На итоговое время влияют платежная система, проверка аккаунта, лимиты и загруженность финансового отдела.'], list: ['проверьте статус верификации до заявки;', 'сравните лимиты конкретного метода;', 'сохраняйте подтверждение операции.'] },
  { route: '/ratings/low-wager/', active: 'ratings', eyebrow: 'Рейтинг', h1: 'Бонусы с низким вейджером', title: 'Проекты с низким вейджером бонуса — AFFGOLD', description: 'Сортировка предложений по вейджеру: от меньшего требования к отыгрышу к большему.', lead: 'Чем ниже множитель, тем меньше общий оборот для выполнения базового условия, но всегда важны дополнительные ограничения.', items: [...projects].sort((a,b) => a.wager-b.wager), intro: ['Вейджер показывает, сколько раз необходимо поставить бонус или другую указанную в правилах сумму. На странице используется значение из базы обзоров.', 'Низкий множитель сам по себе не делает предложение выгодным: проверьте максимальную ставку, срок действия и список исключённых игр.'], list: ['что именно умножается на вейджер;', 'какие игры участвуют в отыгрыше;', 'есть ли ограничение максимального выигрыша.'] },
  { route: '/ratings/mobile/', active: 'ratings', eyebrow: 'Рейтинг', h1: 'Мобильные онлайн-проекты', title: 'Мобильные онлайн-проекты 2026 — AFFGOLD', description: 'Подборка проектов с заявленной адаптивной мобильной версией по данным обзоров AFFGOLD.', lead: 'Проекты, в карточке которых отмечена адаптация интерфейса под смартфоны.', items: projects.filter((p) => p.tags.some((tag) => /мобиль|адаптив/i.test(tag))), intro: ['Мобильная версия должна сохранять основные функции: вход, каталог, кассу, историю операций, настройки лимитов и поддержку.', 'Перед использованием проверьте скорость загрузки на своей сети и не устанавливайте приложения из непроверенных источников.'], list: ['удобство навигации одной рукой;', 'доступность поддержки и истории платежей;', 'корректное отображение правил бонуса.'] },
  { route: '/bonuses/welcome/', active: 'bonuses', eyebrow: 'Бонусы', h1: 'Приветственные бонусы', title: 'Приветственные бонусы онлайн-проектов 2026 — AFFGOLD', description: 'Сравнение приветственных предложений: проценты, фриспины, вейджер и условия.', lead: 'Стартовые предложения из каталога с быстрым переходом к полным условиям.', items: projects.filter((p) => p.bonusTypes.includes('welcome')), intro: ['Приветственный пакет может начисляться за один или несколько депозитов. Сравнивать только максимальный процент неправильно — учитывайте вейджер и порядок начисления фриспинов.', 'До активации проверьте минимальную сумму, срок выполнения условий и допустимые способы пополнения.'], list: ['размер и количество этапов пакета;', 'вейджер и срок отыгрыша;', 'ограничение ставки и доступные игры.'] },
  { route: '/bonuses/free-spins/', active: 'bonuses', eyebrow: 'Бонусы', h1: 'Бонусы с фриспинами', title: 'Фриспины за регистрацию и депозит — AFFGOLD', description: 'Предложения с бесплатными вращениями: количество FS, вейджер и условия активации.', lead: 'Сравнение предложений с фриспинами из базы AFFGOLD.', items: projects.filter((p) => p.bonusTypes.includes('freespins')), intro: ['Количество фриспинов не показывает их реальную ценность без информации о номинале вращения и правилах отыгрыша выигрыша.', 'Иногда вращения выдаются частями в течение нескольких дней. Пропущенная активация может привести к потере очередной части.'], list: ['номинал одного вращения;', 'игра, для которой выданы FS;', 'срок активации и вейджер выигрыша.'] },
  { route: '/payments/crypto/', active: 'guides', eyebrow: 'Платежи', h1: 'Проекты с Bitcoin и Tether', title: 'Проекты с криптовалютой: Bitcoin и Tether — AFFGOLD', description: 'Подборка проектов, где Bitcoin или Tether указаны среди платежных методов.', lead: 'Список из базы AFFGOLD и базовые правила безопасной криптовалютной операции.', items: projects.filter((p) => p.payments.some((m) => ['Bitcoin','Tether'].includes(m))), intro: ['Криптовалютный перевод обычно нельзя отменить. Проверяйте сеть, адрес и минимальную сумму перед подтверждением транзакции.', 'Совпадение названия токена недостаточно: одна и та же валюта может работать в нескольких сетях с разными адресами.'], list: ['сеть перевода должна совпадать;', 'учитывайте комиссию сети;', 'проверьте количество подтверждений.'] },
  { route: '/payments/bank-cards/', active: 'guides', eyebrow: 'Платежи', h1: 'Пополнение банковской картой', title: 'Пополнение и вывод на банковские карты — AFFGOLD', description: 'Проекты с VISA, Mastercard или МИР в базе AFFGOLD и чек-лист перед платежом.', lead: 'Карточные методы из базы проектов и факторы, влияющие на проведение операции.', items: projects.filter((p) => p.payments.some((m) => ['VISA','Mastercard','МИР'].includes(m))), intro: ['Наличие логотипа карты в списке методов не гарантирует доступность операции для каждого банка и региона.', 'До пополнения проверьте комиссию, минимальную сумму, имя получателя и возможность возврата на тот же метод.'], list: ['карта оформлена на владельца аккаунта;', 'лимиты банка позволяют операцию;', 'данные вводятся на защищённой странице.'] }
  ,{ route: '/bonuses/cashback/', active: 'bonuses', eyebrow: 'Бонусы', h1: 'Кэшбэк в онлайн-проектах', title: 'Кэшбэк: проекты и условия возврата — AFFGOLD', description: 'Проекты, где кэшбэк указан среди типов предложения, и правила проверки периода, процента и вейджера.', lead: 'Сравните карточки и обязательно уточните, от какой суммы рассчитывается возврат.', items: projects.filter((p) => p.bonusTypes.includes('cashback')), intro: ['Кэшбэк может рассчитываться от чистого проигрыша за день, неделю или другой период. Процент без базы расчёта ничего не говорит о фактической сумме.', 'Также проверьте, начисляется ли возврат реальными или бонусными средствами и применяется ли к нему вейджер.'], list: ['период расчёта;','минимальная сумма;','тип баланса после начисления;','ограничение на вывод.'] }
  ,{ route: '/payments/e-wallets/', active: 'guides', eyebrow: 'Платежи', h1: 'Электронные кошельки', title: 'Электронные кошельки для пополнения и вывода — AFFGOLD', description: 'Проекты с электронными кошельками в базе и чек-лист комиссии, лимитов и принадлежности аккаунта.', lead: 'Подборка проектов, где WebMoney указан среди доступных методов.', items: projects.filter((p) => p.payments.includes('WebMoney')), intro: ['Электронный кошелёк должен принадлежать владельцу аккаунта, если правила проекта требуют совпадения данных.', 'Доступность метода и валюта операции зависят от региона. Проверьте комиссию на обеих сторонах до перевода.'], list: ['верификация кошелька;','минимальная и максимальная сумма;','срок зачисления;','комиссия за операцию.'] }
];

collectionPages.forEach((item) => {
  const enhancement = SEO_CONTENT.collectionEnhancements?.[item.route] || {};
  const sections = Array.isArray(enhancement.sections) ? enhancement.sections : [];
  const questions = Array.isArray(enhancement.faq) ? enhancement.faq : [];
  const sectionLinks = sections.map(([id, title]) => ({ id, title }));
  const enhancedContent = sections.map(([id, title, paragraphs, list]) => textPanel(id, title, paragraphs, list)).join('');
  writeRoute(item.route, page({
    ...item, breadcrumbs: [item.parent || { name: item.active === 'bonuses' ? 'Бонусы' : item.active === 'ratings' ? 'Рейтинги' : 'Гайды', url: item.active === 'bonuses' ? '/bonuses/' : item.active === 'ratings' ? '/ratings/' : '/guides/' }, { name: item.h1, url: item.route }],
    content: `${textPanel('about', 'Как составлена подборка', item.intro)}${enhancedContent}${projectCards(item.items)}${textPanel('checklist', 'Что проверить самостоятельно', ['Откройте правила выбранного проекта непосредственно перед действием: условия и доступность методов меняются.'], item.list)}${faqPanel(questions)}`,
    sidebar: sidebar([{ id: 'about', title: 'О подборке' }, ...sectionLinks, { id: 'checklist', title: 'Чек-лист' }, ...(questions.length ? [{ id: 'faq', title: 'Частые вопросы' }] : [])]),
    schema: { '@context': 'https://schema.org', '@type': 'ItemList', name: item.h1, numberOfItems: item.items.length, itemListElement: item.items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${DOMAIN}${projectUrl(p)}`, name: p.name })) }
  }));
});

const informationalPages = SEO_CONTENT.informationalPages;

informationalPages.forEach((item) => {
  const parent = item.route.startsWith('/bonuses/') ? { name: 'Бонусы', url: '/bonuses/' }
    : item.route.startsWith('/guides/') ? { name: 'Гайды', url: '/guides/' }
    : { name: 'О проекте', url: '/about/' };
  const links = item.blocks.map(([id, title]) => ({ id, title }));
  writeRoute(item.route, page({
    ...item, breadcrumbs: [parent, { name: item.h1, url: item.route }],
    content: `${item.blocks.map(([id, title, paragraphs, list]) => textPanel(id, title, paragraphs, list)).join('')}<div class="seo-notice"><strong>Важно:</strong> материалы носят информационный характер. Проверяйте актуальные правила непосредственно перед использованием.</div>`,
    sidebar: sidebar(links)
  }));
});

const editorialProfile = SEO_CONTENT.editorialProfile;
const editorialLinks = editorialProfile.blocks.map(([id, title]) => ({ id, title }));
writeRoute(editorialProfile.route, page({
  ...editorialProfile,
  breadcrumbs: [{ name: 'О проекте', url: '/about/' }, { name: 'Команда', url: editorialProfile.route }],
  content: `${editorialProfile.blocks.map(([id, title, paragraphs, list]) => textPanel(id, title, paragraphs, list)).join('')}<div class="seo-notice"><strong>Обратная связь:</strong> <a href="/contacts/">контакты и порядок сообщения об ошибке</a>. Подробнее: <a href="/about/methodology/">методика рейтинга</a>.</div>`,
  sidebar: sidebar(editorialLinks)
}));

/* ---------- Проектные страницы, главная, каталог и sitemap ---------- */

projects.forEach((project) => {
  const route = projectUrl(project);
  const canonical = `${DOMAIN}${route}`;
  const schema = {
    '@context': 'https://schema.org', '@type': 'Article', '@id': `${canonical}#article`, headline: `Обзор ${project.name}`,
    description: project.description,
    image: { '@type': 'ImageObject', url: SOCIAL_IMAGE, width: 1200, height: 630 },
    publisher: organizationReference(),
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    about: { '@type': 'Thing', name: project.name },
    inLanguage: 'ru', isAccessibleForFree: true,
    ...(Array.isArray(project.sources) && project.sources.length ? { citation: project.sources.map((source) => source.url) } : {})
  };
  const related = projects.filter((item) => item.id !== project.id).slice(0, 3);
  writeRoute(route, reviewPage(project, related, schema));
});

[
  ['/compare/', '/catalog.html', 'Сравнения'],
  ['/compare/norm-vs-joycasino/', '/catalog.html', 'Сравнение NORM и JoyCasino'],
  ['/compare/apex-vs-tiger/', '/catalog.html', 'Сравнение APEX и TIGER'],
  ['/news/', '/bonuses/', 'Новости и акции'],
  ['/updates/', '/about/methodology/', 'Архив материалов']
].forEach(([route, target, label]) => writeRoute(route, legacyRedirect(route, target, label), false));

const catalogPath = path.join(ROOT, 'catalog.html');
const catalogSchema = {
  '@context': 'https://schema.org', '@type': 'ItemList', name: 'Каталог проектов AFFGOLD',
  numberOfItems: projects.length,
  itemListElement: projects.map((project, index) => ({
    '@type': 'ListItem', position: index + 1, url: `${DOMAIN}${projectUrl(project)}`, name: project.name
  }))
};
let catalogSource = applyPageMetadata(fs.readFileSync(catalogPath, 'utf8'), SITE_CONTENT.pages.catalog).replace(
  /(<link rel="canonical" href=")[^"]+("\s*>)/,
  `$1${DOMAIN}/catalog.html$2`
);
catalogSource = upsertHeadBlock(catalogSource, 'SOCIAL_META', socialMeta({
  title: documentTitle(catalogSource),
  description: documentDescription(catalogSource),
  canonical: `${DOMAIN}/catalog.html`,
  type: 'website'
}));
const rankedProjects = [...projects].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, 'ru'));
const catalogWithSchema = catalogSource.replace(
  /<script type="application\/ld\+json" data-catalog-schema>.*?<\/script>/s,
  `<script type="application/ld+json" data-catalog-schema>${JSON.stringify(catalogSchema).replaceAll('</script', '<\\/script')}</script>`
);
const catalogWithCards = replaceManagedBlock(
  catalogWithSchema,
  'CATALOG_PROJECTS',
  applyRelativePaths(projectCardArticles(rankedProjects), '/catalog.html')
).replace(
  /(<span id="catalog-count" aria-live="polite">).*?(<\/span>)/,
  `$1Найдено проектов: ${projects.length}$2`
);
fs.writeFileSync(path.join(BUILD_ROOT, 'catalog.html'), applyAssetVersions(catalogWithCards));

const homePath = path.join(ROOT, 'index.html');
const organizationSchema = {
  '@context': 'https://schema.org',
  '@graph': [
    organizationReference(),
    { '@type': 'WebSite', '@id': `${DOMAIN}/#website`, name: SITE_CONTENT.organization.name, url: `${DOMAIN}/`, publisher: { '@id': ORGANIZATION_ID }, inLanguage: 'ru' }
  ]
};
let homeSource = applyPageMetadata(fs.readFileSync(homePath, 'utf8'), SITE_CONTENT.pages.home)
  .replace(/(<link rel="canonical" href=")[^"]+("\s*>)/, `$1${DOMAIN}/$2`)
  .replace(
    /<script type="application\/ld\+json" data-site-schema>.*?<\/script>/s,
    `<script type="application/ld+json" data-site-schema>${JSON.stringify(organizationSchema).replaceAll('</script', '<\\/script')}</script>`
  );
homeSource = upsertHeadBlock(homeSource, 'SOCIAL_META', socialMeta({
  title: documentTitle(homeSource),
  description: documentDescription(homeSource),
  canonical: `${DOMAIN}/`,
  type: 'website'
}));
const homeWithCards = replaceManagedBlock(
  homeSource,
  'HOME_PROJECTS',
  applyRelativePaths(projectCardArticles(rankedProjects.slice(0, 4)), '/')
).replace(
  /(<div class="num" data-project-count data-count=")\d+(" data-suffix="">)\d+(<\/div>)/,
  `$1${projects.length}$2${projects.length}$3`
).replace(
  /(<div class="num" data-review-count data-count=")\d+(" data-suffix="">)\d+(<\/div>)/,
  `$1${projects.length}$2${projects.length}$3`
);
fs.writeFileSync(path.join(BUILD_ROOT, 'index.html'), applyAssetVersions(homeWithCards));

const legacyReviewSource = fs.readFileSync(path.join(ROOT, 'review.html'), 'utf8');
const legacyReviewRoutes = Object.fromEntries(projects.map((project) => [project.id, project.slug || project.id]));
const legacyReview = legacyReviewSource.replace(
  /const routes = \{.*?\};/s,
  `const routes = ${JSON.stringify(legacyReviewRoutes)};`
);
fs.writeFileSync(path.join(BUILD_ROOT, 'review.html'), applyAssetVersions(legacyReview));

const sitemapRoutes = ['/', '/catalog.html', ...writtenRoutes];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(sitemapRoutes)].map((route) => `  <url><loc>${xmlEscape(`${DOMAIN}${route}`)}</loc></url>`).join('\n')}\n</urlset>\n`;
fs.writeFileSync(path.join(BUILD_ROOT, 'sitemap.xml'), sitemap);
fs.writeFileSync(
  path.join(BUILD_ROOT, 'robots.txt'),
  `User-agent: *\nAllow: /\nClean-param: q&payout&types&sort /catalog.html\n\nSitemap: ${DOMAIN}/sitemap.xml\n`
);

const notFound = page({ route: '/404.html', active: '', eyebrow: 'Ошибка 404', h1: 'Страница не найдена', title: 'Страница не найдена — AFFGOLD', description: 'Запрошенная страница не найдена.', lead: 'Возможно, адрес изменился. Перейдите в каталог или выберите раздел сайта.', breadcrumbs: [{ name: '404', url: '/404.html' }], index: false,
  content: `<div class="seo-grid"><a class="card seo-card" href="/catalog.html"><span class="seo-card-icon">☷</span><h2>Каталог</h2><p>Все проекты и фильтры.</p><span class="seo-card-link">Открыть →</span></a><a class="card seo-card" href="/guides/"><span class="seo-card-icon">?</span><h2>Гайды</h2><p>Полезные инструкции.</p><span class="seo-card-link">Открыть →</span></a></div>`
});
// ErrorDocument может отдать этот файл на любом глубоком URL, поэтому все локальные
// пути в 404 остаются root-absolute. Иначе /foo/bar искал бы /foo/css/*.css.
fs.writeFileSync(path.join(BUILD_ROOT, '404.html'), applyAssetVersions(notFound));

assertBuildComplete();
publishGeneratedSite();

console.log(`Generated ${writtenRoutes.length} SEO routes and sitemap.xml`);
