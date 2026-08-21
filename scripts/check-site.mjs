import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjects, publishedProjects } from './lib/projects.mjs';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_FILE), '..');
const BASE_PATH = '/affgold_site';
const PRODUCTION_ORIGIN = 'https://affgoldprod.com';
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'beget-upload']);
const PUBLISHABLE_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.xml']);
const LEGACY_SCAN_EXCLUSIONS = new Set([
  'scripts/build-beget.mjs',
  'scripts/check-site.mjs',
  'scripts/optimize-assets.mjs'
]);
const LEGACY_ASSETS = ['banner-velora.png', 'joy-logo.svg'];
const THEME_STYLESHEETS = [
  'css/project-theme-tokens.css',
  'css/home-page.css',
  'css/catalog-page.css',
  'css/seo-page.css',
  'css/review-page.css',
  'css/site.css'
];
const IMAGE_BUDGETS = new Map([
  ['assets/images/banner-velora-480.webp', 40 * 1024],
  ['assets/images/banner-velora-800.webp', 90 * 1024],
  ['assets/images/banner-velora-1200.webp', 160 * 1024],
  ['assets/images/banner-velora-1672.webp', 240 * 1024],
  ['assets/images/banner-velora-480.avif', 36 * 1024],
  ['assets/images/banner-velora-800.avif', 75 * 1024],
  ['assets/images/banner-velora-1200.avif', 130 * 1024],
  ['assets/images/banner-velora-1672.avif', 190 * 1024],
  ['assets/images/joy-logo.webp', 8 * 1024]
]);

const toPosix = (value) => value.split(path.sep).join('/');
const relativeName = (root, file) => toPosix(path.relative(root, file)) || '.';
const countOccurrences = (source, fragment) => source.split(fragment).length - 1;
const formatKiB = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

const isInside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const walkFiles = (directory, predicate) => {
  const files = [];
  const visit = (current) => {
    fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
      .forEach((entry) => {
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.affgold-') || entry.name.startsWith('.beget-upload-build-')) return;
          visit(path.join(current, entry.name));
          return;
        }
        if (entry.isFile()) {
          const file = path.join(current, entry.name);
          if (predicate(file)) files.push(file);
        }
      });
  };
  visit(directory);
  return files;
};

const attributeValue = (tag, name) => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : undefined;
};

const decodeHtmlAttribute = (value) => value
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#039;', "'")
  .replace(/&#(\d+);/g, (match, code) => {
    try { return String.fromCodePoint(Number(code)); } catch { return match; }
  })
  .replace(/&#x([0-9a-f]+);/gi, (match, code) => {
    try { return String.fromCodePoint(Number.parseInt(code, 16)); } catch { return match; }
  });

const decodeHtmlText = (value = '') => decodeHtmlAttribute(String(value))
  .replaceAll('&nbsp;', ' ')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&#x27;', "'");

const stripMarkup = (value = '') => decodeHtmlText(String(value)
  .replace(/<(?:script|style|svg|template)\b[\s\S]*?<\/(?:script|style|svg|template)>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

const tagText = (html, tagName) => stripMarkup(
  html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'))?.[1] || ''
);

const metaContent = (html, attribute, value) => {
  const pattern = /<meta\b[^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    const tag = match[0];
    if ((attributeValue(tag, attribute) || '').toLowerCase() === value.toLowerCase()) {
      return decodeHtmlAttribute(attributeValue(tag, 'content') || '');
    }
  }
  return '';
};

const linkHref = (html, relation) => {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const relations = (attributeValue(tag, 'rel') || '').toLowerCase().split(/\s+/);
    if (relations.includes(relation.toLowerCase())) return decodeHtmlAttribute(attributeValue(tag, 'href') || '');
  }
  return '';
};

const isNoindex = (html) => metaContent(html, 'name', 'robots').toLowerCase().split(/[\s,]+/).includes('noindex');

const expectedCanonical = (root, file) => {
  const relative = relativeName(root, file);
  let route;
  if (relative === 'index.html') route = '/';
  else if (relative.endsWith('/index.html')) route = `/${relative.slice(0, -'index.html'.length)}`;
  else route = `/${relative}`;
  return new URL(route, PRODUCTION_ORIGIN).href;
};

const extractJsonLd = (html) => {
  const values = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const tag = `<script${match[1]}>`;
    if ((attributeValue(tag, 'type') || '').toLowerCase() !== 'application/ld+json') continue;
    values.push(match[2].trim());
  }
  return values;
};

const schemaNodes = (value) => {
  if (Array.isArray(value)) return value.flatMap(schemaNodes);
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value['@graph'])) return [value, ...value['@graph'].flatMap(schemaNodes)];
  return [value];
};

const countWords = (value) => (stripMarkup(value).match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length;

const extractIds = (html) => {
  const ids = [];
  const pattern = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\`]+))/gi;
  for (const match of html.matchAll(pattern)) ids.push(decodeHtmlAttribute(match[1] ?? match[2] ?? match[3] ?? ''));
  return ids;
};

const extractProjectCards = (html) => {
  const cards = [];
  const pattern = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi;
  for (const match of html.matchAll(pattern)) {
    const openingTag = `<article${match[1]}>`;
    const classes = (attributeValue(openingTag, 'class') || '').split(/\s+/);
    if (classes.includes('project-card')) cards.push({ openingTag, body: match[2] });
  }
  return cards;
};

const managedBlock = (html, name, fail, file) => {
  const start = `<!-- AFFGOLD:${name}:START -->`;
  const end = `<!-- AFFGOLD:${name}:END -->`;
  const startCount = countOccurrences(html, start);
  const endCount = countOccurrences(html, end);
  if (startCount !== 1 || endCount !== 1) {
    fail(`${file}: маркеры ${name} должны встречаться ровно по одному разу (START: ${startCount}, END: ${endCount}).`);
    return '';
  }
  const startIndex = html.indexOf(start) + start.length;
  const endIndex = html.indexOf(end);
  if (endIndex < startIndex) {
    fail(`${file}: маркеры ${name} расположены в неверном порядке.`);
    return '';
  }
  return html.slice(startIndex, endIndex);
};

const localCandidates = (attribute, value) => {
  if (attribute !== 'srcset') return [value];
  if (/^data:/i.test(value.trim())) return [value];
  return value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean);
};

const resolveLocalReference = (root, sourceFile, rawValue) => {
  const value = decodeHtmlAttribute(rawValue.trim());
  if (!value || value === '#') return { ignored: true };
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return { ignored: true };

  const hashIndex = value.indexOf('#');
  const fragmentSource = hashIndex >= 0 ? value.slice(hashIndex + 1) : '';
  const withoutFragment = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const queryIndex = withoutFragment.indexOf('?');
  let pathname = queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
  let fragment = fragmentSource;
  try {
    pathname = decodeURIComponent(pathname);
    fragment = decodeURIComponent(fragment);
  } catch {
    return { error: `некорректное URL-кодирование в «${rawValue}»` };
  }

  let target;
  if (!pathname) {
    target = sourceFile;
  } else if (pathname.startsWith('/')) {
    if (pathname === BASE_PATH) pathname = '/';
    else if (pathname.startsWith(`${BASE_PATH}/`)) pathname = pathname.slice(BASE_PATH.length);
    target = path.resolve(root, pathname.replace(/^\/+/, ''));
  } else {
    target = path.resolve(path.dirname(sourceFile), pathname);
  }

  if (!isInside(root, target)) return { error: `путь «${rawValue}» выходит за пределы корня сайта` };
  if (!fs.existsSync(target)) return { error: `не найден «${relativeName(root, target)}» для «${rawValue}»` };

  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    target = path.join(target, 'index.html');
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return { error: `у каталога «${relativeName(root, path.dirname(target))}» нет index.html` };
    }
  } else if (!stat.isFile()) {
    return { error: `«${relativeName(root, target)}» не является файлом` };
  }
  return { target, fragment };
};

const hasExpectedImageSignature = (file, buffer) => {
  if (file.endsWith('.webp')) {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (file.endsWith('.avif')) return buffer.subarray(0, 32).toString('ascii').includes('ftypavif');
  return true;
};

export function checkSite(root = DEFAULT_ROOT) {
  const startedAt = Date.now();
  const rootPath = root instanceof URL ? path.resolve(fileURLToPath(root)) : path.resolve(String(root));
  const checks = [];
  const errors = [];

  const run = (name, callback, enabled = true) => {
    if (!enabled) {
      checks.push({ name, status: 'skipped', details: 'пропущено из-за предыдущей ошибки' });
      return;
    }
    const ownErrors = [];
    const fail = (message) => ownErrors.push(String(message));
    let details = '';
    try {
      details = callback(fail) || '';
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    ownErrors.forEach((message) => errors.push({ check: name, message }));
    checks.push({ name, status: ownErrors.length ? 'failed' : 'passed', details, errors: ownErrors });
  };

  let allProjects = null;
  let projects = null;
  run('База проектов', (fail) => {
    allProjects = loadProjects(rootPath);
    projects = publishedProjects(allProjects);
    projects.forEach((project) => {
      if (project.status !== 'published') fail(`${project.id}: status должен быть указан явно как published.`);
      if (!project.publishedAt || !project.reviewerId) fail(`${project.id}: отсутствует дата публикации или ответственный редактор.`);
      if (!Array.isArray(project.sources) || project.sources.length === 0) fail(`${project.id}: опубликованный проект должен содержать источник.`);
      if (!Array.isArray(project.changelog) || project.changelog.length === 0) fail(`${project.id}: опубликованный проект должен содержать журнал изменений.`);
      if (project.verifiedAt && project.sources.some((source) => !source.checkedAt)) fail(`${project.id}: при verifiedAt у каждого источника нужна дата checkedAt.`);
    });
    return `${allProjects.length} всего, ${projects.length} опубликовано, данные валидны`;
  });

  let htmlFiles = [];
  const htmlSources = new Map();
  const htmlIds = new Map();
  run('HTML и уникальные id', (fail) => {
    htmlFiles = walkFiles(rootPath, (file) => path.extname(file).toLowerCase() === '.html');
    if (!htmlFiles.length) {
      fail('В корне сайта не найдено ни одного HTML-файла.');
      return '';
    }
    let idCount = 0;
    htmlFiles.forEach((file) => {
      const html = fs.readFileSync(file, 'utf8');
      const ids = extractIds(html);
      const seen = new Set();
      htmlSources.set(file, html);
      htmlIds.set(file, new Set(ids));
      ids.forEach((id) => {
        idCount += 1;
        if (!id) fail(`${relativeName(rootPath, file)}: найден пустой id.`);
        else if (seen.has(id)) fail(`${relativeName(rootPath, file)}: id «${id}» повторяется.`);
        seen.add(id);
      });
    });
    return `${htmlFiles.length} файлов, ${idCount} id`;
  });

  let indexableHtmlFiles = [];
  const indexableCanonicals = new Set();
  run('SEO metadata и schema.org', (fail) => {
    const canonicalOwners = new Map();
    let schemaCount = 0;
    htmlFiles.forEach((file) => {
      const html = htmlSources.get(file);
      const name = relativeName(rootPath, file);
      if (isNoindex(html)) return;
      indexableHtmlFiles.push(file);

      if (!/<html\b[^>]*\blang=["']ru["']/i.test(html)) fail(`${name}: ожидается <html lang="ru">.`);
      const title = tagText(html, 'title');
      const description = metaContent(html, 'name', 'description').trim();
      const h1Count = [...html.matchAll(/<h1\b[^>]*>/gi)].length;
      if (title.length < 15 || title.length > 100) fail(`${name}: длина title ${title.length}, ожидается 15–100 символов.`);
      if (description.length < 70 || description.length > 240) fail(`${name}: длина description ${description.length}, ожидается 70–240 символов.`);
      if (h1Count !== 1) fail(`${name}: найдено H1: ${h1Count}, ожидается ровно 1.`);

      const canonical = linkHref(html, 'canonical');
      const expected = expectedCanonical(rootPath, file);
      if (canonical !== expected) fail(`${name}: canonical «${canonical || '(нет)'}», ожидается «${expected}».`);
      if (canonical) {
        if (canonicalOwners.has(canonical)) fail(`${name}: canonical повторяет ${canonicalOwners.get(canonical)}.`);
        else canonicalOwners.set(canonical, name);
        indexableCanonicals.add(canonical);
      }

      const socialFields = [
        ['property', 'og:type'], ['property', 'og:title'], ['property', 'og:description'],
        ['property', 'og:url'], ['property', 'og:image'], ['name', 'twitter:card'],
        ['name', 'twitter:title'], ['name', 'twitter:description'], ['name', 'twitter:image']
      ];
      socialFields.forEach(([attribute, key]) => {
        if (!metaContent(html, attribute, key).trim()) fail(`${name}: отсутствует ${key}.`);
      });
      const ogUrl = metaContent(html, 'property', 'og:url').trim();
      if (canonical && ogUrl !== canonical) fail(`${name}: og:url должен совпадать с canonical.`);
      const ogImage = metaContent(html, 'property', 'og:image').trim();
      if (ogImage) {
        try {
          const imageUrl = new URL(ogImage, expected);
          if (imageUrl.origin !== PRODUCTION_ORIGIN) fail(`${name}: og:image должен находиться на ${PRODUCTION_ORIGIN}.`);
          else {
            const imageFile = path.resolve(rootPath, imageUrl.pathname.replace(/^\/+/, ''));
            if (!isInside(rootPath, imageFile) || !fs.existsSync(imageFile) || !fs.statSync(imageFile).isFile()) {
              fail(`${name}: локальный файл og:image не найден.`);
            }
          }
        } catch { fail(`${name}: некорректный og:image.`); }
      }

      const jsonLdBlocks = extractJsonLd(html);
      if (!jsonLdBlocks.length) fail(`${name}: отсутствует JSON-LD.`);
      jsonLdBlocks.forEach((source, index) => {
        try {
          JSON.parse(source);
          schemaCount += 1;
        } catch (error) {
          fail(`${name}: JSON-LD #${index + 1} не разбирается (${error.message}).`);
        }
      });
    });
    return `${indexableHtmlFiles.length} индексируемых страниц, ${schemaCount} JSON-LD блоков`;
  }, htmlFiles.length > 0);

  run('Страницы обзоров', (fail) => {
    projects.forEach((project) => {
      const review = path.join(rootPath, 'reviews', project.slug, 'index.html');
      if (!fs.existsSync(review) || !fs.statSync(review).isFile()) {
        fail(`${project.id}: отсутствует reviews/${project.slug}/index.html.`);
      }
    });
    return `${projects.length} из ${projects.length} обзоров найдены`;
  }, Boolean(projects));

  run('Источники и Article schema обзоров', (fail) => {
    projects.forEach((project) => {
      const relative = `reviews/${project.slug}/index.html`;
      const file = path.join(rootPath, ...relative.split('/'));
      if (!fs.existsSync(file)) return;
      const html = htmlSources.get(file) || fs.readFileSync(file, 'utf8');
      if (html.includes('class="review-hero-card__source"')) fail(`${relative}: снова показан блок служебных дат или авторства.`);
      if (!html.includes('id="sources"')) fail(`${relative}: отсутствует видимый раздел источников.`);
      const visibleText = stripMarkup(html);
      if (Array.isArray(project.sources)) project.sources.forEach((source) => {
        if (!visibleText.includes(source.label)) fail(`${relative}: источник «${source.label}» отсутствует в видимом тексте.`);
      });

      const parsedSchemas = [];
      extractJsonLd(html).forEach((source, index) => {
        try { parsedSchemas.push(...schemaNodes(JSON.parse(source))); }
        catch { /* Parse error is reported by the general SEO check. */ }
      });
      const article = parsedSchemas.find((node) => {
        const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
        return types.includes('Article');
      });
      if (!article) {
        fail(`${relative}: отсутствует Article schema.`);
        return;
      }
      if (!article.headline || !article.image) fail(`${relative}: Article schema не содержит headline или image.`);
      if (!article.publisher?.logo || !article.mainEntityOfPage) fail(`${relative}: Article schema не содержит publisher logo или mainEntityOfPage.`);
      if ('author' in article || 'datePublished' in article || 'dateModified' in article) fail(`${relative}: Article schema снова содержит служебные поля author/datePublished/dateModified.`);
    });
    return `${projects.length} обзоров с источниками и Article schema без дат и авторства`;
  }, Boolean(projects));

  run('Sitemap и robots.txt', (fail) => {
    const sitemapFile = path.join(rootPath, 'sitemap.xml');
    const robotsFile = path.join(rootPath, 'robots.txt');
    if (!fs.existsSync(sitemapFile) || !fs.existsSync(robotsFile)) {
      fail('Отсутствует sitemap.xml или robots.txt.');
      return '';
    }
    const sitemap = fs.readFileSync(sitemapFile, 'utf8');
    const entries = [...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<\/url>/g)]
      .map((match) => ({ url: decodeHtmlAttribute(match[1].trim()) }));
    const urls = new Set();
    entries.forEach((entry) => {
      if (urls.has(entry.url)) fail(`sitemap.xml: повтор URL ${entry.url}.`);
      urls.add(entry.url);
      try {
        const parsed = new URL(entry.url);
        if (parsed.origin !== PRODUCTION_ORIGIN || parsed.search || parsed.hash) fail(`sitemap.xml: некорректный URL ${entry.url}.`);
      } catch { fail(`sitemap.xml: URL не разбирается ${entry.url}.`); }
    });
    if (/<lastmod\b/i.test(sitemap)) fail('sitemap.xml: служебные даты lastmod не должны публиковаться.');
    indexableCanonicals.forEach((canonical) => {
      if (!urls.has(canonical)) fail(`sitemap.xml: отсутствует индексируемый canonical ${canonical}.`);
    });
    urls.forEach((url) => {
      if (!indexableCanonicals.has(url)) fail(`sitemap.xml: URL не соответствует индексируемой HTML-странице ${url}.`);
    });

    const robots = fs.readFileSync(robotsFile, 'utf8');
    if (!/^User-agent:\s*\*$/mi.test(robots)) fail('robots.txt: нет группы User-agent: *.');
    if (!robots.includes(`Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml`)) fail('robots.txt: нет production Sitemap URL.');
    if (!/^Clean-param:\s*q&payout&types&sort\s+\/catalog\.html$/mi.test(robots)) fail('robots.txt: не закреплён Clean-param фильтров каталога.');
    return `${entries.length} URL, карта равна набору indexable canonical`;
  }, indexableHtmlFiles.length > 0);

  run('Локальные href/src/srcset', (fail) => {
    let referenceCount = 0;
    const pattern = /\b(href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\`]+))/gi;
    htmlFiles.forEach((sourceFile) => {
      const html = htmlSources.get(sourceFile);
      for (const match of html.matchAll(pattern)) {
        const attribute = match[1].toLowerCase();
        const value = match[2] ?? match[3] ?? match[4] ?? '';
        localCandidates(attribute, value).forEach((candidate) => {
          const resolved = resolveLocalReference(rootPath, sourceFile, candidate);
          if (resolved.ignored) return;
          referenceCount += 1;
          const sourceName = relativeName(rootPath, sourceFile);
          if (resolved.error) {
            fail(`${sourceName}: ${attribute} — ${resolved.error}.`);
            return;
          }
          if (resolved.fragment && path.extname(resolved.target).toLowerCase() === '.html') {
            let ids = htmlIds.get(resolved.target);
            if (!ids) {
              ids = new Set(extractIds(fs.readFileSync(resolved.target, 'utf8')));
              htmlIds.set(resolved.target, ids);
            }
            if (!ids.has(resolved.fragment)) {
              fail(`${sourceName}: якорь #${resolved.fragment} не найден в ${relativeName(rootPath, resolved.target)}.`);
            }
          }
        });
      }
    });
    return `${referenceCount} локальных ссылок проверено`;
  }, htmlFiles.length > 0);

  run('Публичный контент и внешние ссылки', (fail) => {
    const offerUrls = new Set(projects.map((project) => project.url));
    const forbiddenVisibleCopy = [
      ['упоминание партнёрской ссылки', /партн[её]рск/iu],
      ['affiliate', /\baffiliate\b/iu],
      ['маркировка 18+', /18\s*\+/u],
      ['упоминание азартных игр', /азарт/iu],
      ['предупреждение о финансовых потерях', /финансов\w*\s+потер/iu],
      ['упоминание зависимости', /зависимост/iu],
      ['формулировка «ответственная игра»', /ответственн\w*\s+игр/iu],
      ['возрастное ограничение', /(?:совершеннолет|возрастн\w*\s+огранич)/iu],
      ['служебная отметка изменения', /(?:редакт|обновл)/iu],
      ['служебная отметка авторства', /\bавтор(?:а|ов|ство|ства|ом|ы)?\b/iu],
      ['служебная дата или статус', /(?:дата\s+(?:публикации|проверки|изменения)|(?:опубликовано|проверено)\s+\d{2}\.\d{2}\.\d{4})/iu]
    ];
    const forbiddenMetadata = [
      ['link rel=author', /<link\b[^>]*\brel=["'][^"']*\bauthor\b/iu],
      ['author/datePublished/dateModified в JSON-LD', /"(?:author|datePublished|dateModified)"\s*:/u],
      ['article published/modified meta', /<meta\b[^>]*\bproperty=["']article:(?:published|modified)_time["']/iu],
      ['блок дат и авторства обзора', /review-hero-card__source/u]
    ];
    let offerLinks = 0;
    let blankLinks = 0;
    indexableHtmlFiles.forEach((file) => {
      const html = htmlSources.get(file);
      const name = relativeName(rootPath, file);
      const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || '';
      const words = countWords(main);
      if (words < 100) fail(`${name}: в main только ${words} слов, минимум 100.`);
      for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
        const tag = match[0];
        const href = decodeHtmlAttribute(attributeValue(tag, 'href') || '');
        const target = (attributeValue(tag, 'target') || '').toLowerCase();
        const rel = new Set((attributeValue(tag, 'rel') || '').toLowerCase().split(/\s+/).filter(Boolean));
        if (target === '_blank') {
          blankLinks += 1;
          if (!rel.has('noopener')) fail(`${name}: target="_blank" без rel="noopener" у ${href || '(без href)'}.`);
          if (!rel.has('noreferrer')) fail(`${name}: target="_blank" без rel="noreferrer" у ${href || '(без href)'}.`);
        }
        if (offerUrls.has(href)) {
          offerLinks += 1;
          ['sponsored', 'nofollow', 'noopener', 'noreferrer'].forEach((token) => {
            if (!rel.has(token)) fail(`${name}: внешняя ссылка предложения ${href} не содержит rel="${token}".`);
          });
        }
      }
    });

    htmlFiles.forEach((file) => {
      const name = relativeName(rootPath, file);
      if (name === 'admin/index.html' || name.startsWith('admin/')) return;
      const html = htmlSources.get(file);
      const visible = stripMarkup(html);
      forbiddenVisibleCopy.forEach(([label, pattern]) => {
        if (pattern.test(visible)) fail(`${name}: найдено запрещённое публичное ${label}.`);
      });
      forbiddenMetadata.forEach(([label, pattern]) => {
        if (pattern.test(html)) fail(`${name}: найдено запрещённое публичное поле ${label}.`);
      });
    });

    ['/about/affiliate-disclosure/', '/about/responsible-play/'].forEach((route) => {
      const routeFile = path.join(rootPath, route.replace(/^\/+/, ''), 'index.html');
      if (fs.existsSync(routeFile)) fail(`${relativeName(rootPath, routeFile)}: удалённая публичная страница снова создана.`);
    });

    const contentFiles = [
      ...htmlFiles,
      path.join(rootPath, 'js', 'projects-data.js'),
      path.join(rootPath, 'content', 'site.json'),
      path.join(rootPath, 'content', 'seo-pages.json')
    ].filter((file) => fs.existsSync(file));
    const forbidden = [/Здесь можно указать/iu, /lorem ipsum/iu, /Более 2000 игровых автоматов/iu, /Лицензия Кюрасао/iu];
    contentFiles.forEach((file) => {
      const source = fs.readFileSync(file, 'utf8');
      forbidden.forEach((pattern) => {
        if (pattern.test(source)) fail(`${relativeName(rootPath, file)}: найден placeholder или неподтверждённое абсолютное утверждение «${pattern.source}».`);
      });
    });
    if (!offerLinks) fail('Не найдено ни одной внешней ссылки предложения для проверки rel.');
    return `${offerLinks} ссылок предложений, ${blankLinks} target=_blank, запрещённых публичных пометок нет`;
  }, Boolean(projects) && indexableHtmlFiles.length > 0);

  run('404 для глубоких URL', (fail) => {
    const file = path.join(rootPath, '404.html');
    if (!fs.existsSync(file)) {
      fail('404.html отсутствует.');
      return '';
    }
    const html = fs.readFileSync(file, 'utf8');
    if (!isNoindex(html)) fail('404.html должен содержать noindex.');
    const pattern = /\b(href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    let references = 0;
    for (const match of html.matchAll(pattern)) {
      const attribute = match[1].toLowerCase();
      const value = match[2] ?? match[3] ?? '';
      localCandidates(attribute, value).forEach((candidate) => {
        const decoded = decodeHtmlAttribute(candidate.trim());
        if (!decoded || decoded.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(decoded)) return;
        references += 1;
        if (!decoded.startsWith('/')) fail(`404.html: локальная ссылка «${decoded}» должна быть root-absolute.`);
      });
    }
    return `${references} локальных ссылок безопасны при ErrorDocument на глубоком пути`;
  });

  run('Изображения project-card', (fail) => {
    let cardCount = 0;
    let imageCount = 0;
    htmlFiles.forEach((file) => {
      extractProjectCards(htmlSources.get(file)).forEach((card, cardIndex) => {
        cardCount += 1;
        const images = [...card.body.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
        if (!images.length) fail(`${relativeName(rootPath, file)}: у project-card #${cardIndex + 1} нет изображения.`);
        images.forEach((tag) => {
          imageCount += 1;
          const src = attributeValue(tag, 'src') || '(без src)';
          const width = attributeValue(tag, 'width');
          const height = attributeValue(tag, 'height');
          const loading = attributeValue(tag, 'loading');
          const decoding = attributeValue(tag, 'decoding');
          const prefix = `${relativeName(rootPath, file)}: img «${src}»`;
          if (!/^\d+$/.test(width || '') || Number(width) <= 0) fail(`${prefix} не имеет корректного width.`);
          if (!/^\d+$/.test(height || '') || Number(height) <= 0) fail(`${prefix} не имеет корректного height.`);
          if (loading !== 'lazy') fail(`${prefix} должен иметь loading="lazy".`);
          if (decoding !== 'async') fail(`${prefix} должен иметь decoding="async".`);
        });
      });
    });
    return `${imageCount} изображений в ${cardCount} карточках`;
  }, htmlFiles.length > 0);

  run('Старые ссылки на изображения', (fail) => {
    const files = walkFiles(rootPath, (file) => PUBLISHABLE_EXTENSIONS.has(path.extname(file).toLowerCase()));
    files.forEach((file) => {
      const name = relativeName(rootPath, file);
      if (LEGACY_SCAN_EXCLUSIONS.has(name)) return;
      const source = fs.readFileSync(file, 'utf8').toLowerCase();
      LEGACY_ASSETS.forEach((asset) => {
        if (source.includes(asset)) fail(`${name}: найдена ссылка на ${asset}.`);
      });
    });
    return `${files.length - LEGACY_SCAN_EXCLUSIONS.size} публикуемых/генерирующих файлов проверено`;
  });

  run('Бюджеты изображений', (fail) => {
    const sizes = [];
    IMAGE_BUDGETS.forEach((budget, relativeFile) => {
      const file = path.join(rootPath, ...relativeFile.split('/'));
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        fail(`${relativeFile}: файл отсутствует.`);
        return;
      }
      const bytes = fs.statSync(file).size;
      sizes.push(`${path.basename(file)} ${formatKiB(bytes)}/${formatKiB(budget)}`);
      if (bytes > budget) fail(`${relativeFile}: ${formatKiB(bytes)}, лимит ${formatKiB(budget)}.`);
      const header = fs.readFileSync(file).subarray(0, 32);
      if (!hasExpectedImageSignature(relativeFile, header)) fail(`${relativeFile}: содержимое не соответствует формату файла.`);
    });
    return sizes.join('; ');
  });

  run('Бюджеты логотипов проектов', (fail) => {
    const limit = 128 * 1024;
    const sizes = [];
    projects.forEach((project) => {
      if (!project.logo.startsWith('assets/')) return;
      const file = path.resolve(rootPath, ...project.logo.split('/'));
      if (!isInside(rootPath, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        fail(`${project.id}: локальный логотип «${project.logo}» не найден.`);
        return;
      }
      const bytes = fs.statSync(file).size;
      sizes.push(`${project.id} ${formatKiB(bytes)}`);
      if (bytes > limit) fail(`${project.id}: логотип весит ${formatKiB(bytes)}, лимит ${formatKiB(limit)}.`);
    });
    return `${sizes.length} локальных логотипов, лимит ${formatKiB(limit)}`;
  }, Boolean(projects));

  run('Покрытие project theme CSS', (fail) => {
    THEME_STYLESHEETS.forEach((relativeFile) => {
      const file = path.join(rootPath, ...relativeFile.split('/'));
      if (!fs.existsSync(file)) {
        fail(`${relativeFile}: файл отсутствует.`);
        return;
      }
      const css = fs.readFileSync(file, 'utf8');
      projects.forEach((project) => {
        const selector = `[data-project-theme="${project.id}"]`;
        if (!css.includes(selector)) fail(`${relativeFile}: нет темы «${project.id}».`);
      });
    });
    return `${projects.length} тем в ${THEME_STYLESHEETS.length} CSS-файлах`;
  }, Boolean(projects));

  run('Стабильная геометрия hover главного экрана', (fail) => {
    const homeFile = path.join(rootPath, 'index.html');
    const homeCssFile = path.join(rootPath, 'css', 'home.css');
    const baseCssFile = path.join(rootPath, 'css', 'base.css');
    const bundleFile = path.join(rootPath, 'css', 'home-page.css');
    if (![homeFile, homeCssFile, baseCssFile, bundleFile].every((file) => fs.existsSync(file))) {
      fail('Для проверки нужны index.html, css/home.css, css/base.css и css/home-page.css.');
      return '';
    }

    const html = htmlSources.get(homeFile) || fs.readFileSync(homeFile, 'utf8');
    const homeCss = fs.readFileSync(homeCssFile, 'utf8');
    const baseCss = fs.readFileSync(baseCssFile, 'utf8');
    const bundleCss = fs.readFileSync(bundleFile, 'utf8');
    if (!/class=["'][^"']*\bhero-panel\b[^"']*\bfloating\b/iu.test(html)) {
      fail('index.html: у hero-panel отсутствует фоновая floating-анимация.');
    }
    if (/\.hero-panel:hover\s*\{[^}]*(?:animation-play-state|\btransform|\btranslate|\bscale)\s*:/isu.test(homeCss)) {
      fail('css/home.css: hover hero-panel меняет геометрию или состояние фоновой анимации.');
    }
    if (/\.hero-panel:hover\s+img\s*\{[^}]*(?:\btransform|\btranslate|\bscale)\s*:/isu.test(homeCss)) {
      fail('css/home.css: hover изображения баннера меняет его геометрию.');
    }
    if (/\.logo:hover\s+\.logo-badge\s*\{[^}]*(?:\btransform|\btranslate|\bscale)\s*:/isu.test(baseCss)) {
      fail('css/base.css: hover логотипа снова смещает или масштабирует badge.');
    }
    if (!/\.floating\s*\{[^}]*animation\s*:\s*floatY\s+5s\s+ease-in-out\s+infinite/isu.test(bundleCss)
      || !/@keyframes\s+floatY\s*\{/iu.test(bundleCss)) {
      fail('css/home-page.css: безопасная непрерывная floating-анимация баннера не собрана.');
    }
    if (/\.hero-panel:hover\s*\{[^}]*animation-play-state\s*:/isu.test(homeCss)) {
      fail('css/home.css: hover баннера снова останавливает floating-анимацию и создаёт поздний возврат.');
    }
    return 'баннер движется непрерывно, hover не останавливает его и не меняет геометрию';
  });

  run('Managed-карточки home/catalog', (fail) => {
    const ranked = [...projects].sort((left, right) => right.rating - left.rating || left.name.localeCompare(right.name, 'ru'));
    const specifications = [
      { file: 'index.html', marker: 'HOME_PROJECTS', expected: ranked.slice(0, 4) },
      { file: 'catalog.html', marker: 'CATALOG_PROJECTS', expected: ranked }
    ];
    specifications.forEach((specification) => {
      const file = path.join(rootPath, specification.file);
      if (!fs.existsSync(file)) {
        fail(`${specification.file}: файл отсутствует.`);
        return;
      }
      const html = htmlSources.get(file) || fs.readFileSync(file, 'utf8');
      const block = managedBlock(html, specification.marker, fail, specification.file);
      if (!block) return;
      const cards = extractProjectCards(block);
      const ids = cards.map((card) => attributeValue(card.openingTag, 'data-project-id') || '');
      const expectedIds = specification.expected.map((project) => project.id);
      if (cards.length !== expectedIds.length) {
        fail(`${specification.file}: в ${specification.marker} ${cards.length} карточек вместо ${expectedIds.length}.`);
      }
      if (ids.join(',') !== expectedIds.join(',')) {
        fail(`${specification.file}: порядок/id карточек «${ids.join(', ')}», ожидалось «${expectedIds.join(', ')}».`);
      }
    });
    return `home: ${Math.min(4, projects.length)}, catalog: ${projects.length}`;
  }, Boolean(projects));

  run('Контракт фильтров каталога', (fail) => {
    const catalogFile = path.join(rootPath, 'catalog.html');
    const scriptFile = path.join(rootPath, 'js', 'catalog.js');
    const bundleFile = path.join(rootPath, 'css', 'catalog-page.css');
    if (![catalogFile, scriptFile, bundleFile].every((file) => fs.existsSync(file))) {
      fail('Для проверки нужны catalog.html, js/catalog.js и css/catalog-page.css.');
      return '';
    }

    const html = htmlSources.get(catalogFile) || fs.readFileSync(catalogFile, 'utf8');
    const cards = extractProjectCards(managedBlock(html, 'CATALOG_PROJECTS', fail, 'catalog.html'));
    const requiredAttributes = ['data-project-id', 'data-project-name', 'data-project-search', 'data-payout', 'data-bonus-types', 'data-rating', 'data-wager'];
    cards.forEach((card, index) => requiredAttributes.forEach((attribute) => {
      if (attributeValue(card.openingTag, attribute) === undefined) fail(`catalog.html: у карточки ${index + 1} отсутствует ${attribute}.`);
    }));

    const script = fs.readFileSync(scriptFile, 'utf8');
    const css = fs.readFileSync(bundleFile, 'utf8');
    if (!script.includes('card.hidden =')) fail('js/catalog.js: фильтрация не управляет атрибутом hidden.');
    if (!/\.project-card\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/si.test(css)) {
      fail('css/catalog-page.css: нет обязательного правила скрытия .project-card[hidden].');
    }
    return `${cards.length} карточек, hidden отображается корректно`;
  });

  return {
    ok: errors.length === 0,
    root: rootPath,
    projects: projects?.length || 0,
    htmlFiles: htmlFiles.length,
    durationMs: Date.now() - startedAt,
    checks,
    errors
  };
}

const printResult = (result) => {
  console.log(`Проверка сайта: ${result.root}`);
  result.checks.forEach((check) => {
    const icon = check.status === 'passed' ? '✓' : check.status === 'failed' ? '✗' : '–';
    const details = check.details ? ` — ${check.details}` : '';
    console.log(`${icon} ${check.name}${details}`);
    (check.errors || []).forEach((message) => console.error(`  • ${message}`));
  });
  if (result.ok) {
    console.log(`Готово: проверка пройдена за ${result.durationMs} мс.`);
  } else {
    console.error(`Проверка не пройдена: ошибок ${result.errors.length}.`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE) {
  try {
    const result = checkSite(process.argv[2] || DEFAULT_ROOT);
    printResult(result);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`Проверка не запущена: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
