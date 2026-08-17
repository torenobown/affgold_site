import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjects } from './lib/projects.mjs';

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_FILE), '..');
const BASE_PATH = '/affgold_site';
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);
const PUBLISHABLE_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.xml']);
const LEGACY_SCAN_EXCLUSIONS = new Set([
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
          if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.affgold-')) return;
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

  let projects = null;
  run('База проектов', () => {
    projects = loadProjects(rootPath);
    return `${projects.length} проектов, данные валидны`;
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

  run('Страницы обзоров', (fail) => {
    projects.forEach((project) => {
      const review = path.join(rootPath, 'reviews', project.slug, 'index.html');
      if (!fs.existsSync(review) || !fs.statSync(review).isFile()) {
        fail(`${project.id}: отсутствует reviews/${project.slug}/index.html.`);
      }
    });
    return `${projects.length} из ${projects.length} обзоров найдены`;
  }, Boolean(projects));

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
