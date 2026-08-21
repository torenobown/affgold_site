import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite } from './check-site.mjs';
import { validateReleaseDirectory, writeReleaseManifest } from './lib/release-package.mjs';
import { injectProjectRedirects } from './lib/release-redirects.mjs';
import { loadProjects, publishedProjects } from './lib/projects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'beget-upload');
const TEMP_OUTPUT = fs.mkdtempSync(path.join(ROOT, '.beget-upload-build-'));

const PUBLIC_FILES = [
  '.htaccess',
  '404.html',
  'catalog.html',
  'css/catalog-page.css',
  'css/home-page.css',
  'css/review-page.css',
  'css/seo-page.css',
  'index.html',
  'js/catalog.js',
  'js/main.js',
  'review.html',
  'robots.txt',
  'sitemap.xml'
];

const PUBLIC_DIRECTORIES = [
  'about',
  'assets',
  'bonuses',
  'compare',
  'contacts',
  'guides',
  'news',
  'payments',
  'privacy',
  'ratings',
  'terms',
  'updates'
];

const DEPLOY_EXCLUSIONS = new Set([
  'assets/images/affgold-social.svg',
  'assets/images/affgold-social.webp',
  'assets/images/banner-velora.png',
  'assets/images/bonus-orb.svg',
  'assets/images/hero-casino.svg',
  'assets/images/joy-logo.svg'
]);

const relativePosix = (target) => path.relative(ROOT, target).split(path.sep).join('/');

const assertInsideRoot = (target) => {
  const relative = path.relative(ROOT, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Небезопасный путь каталога публикации: ${target}`);
  }
};

const copyRequired = (relativePath) => {
  const source = path.join(ROOT, relativePath);
  const destination = path.join(TEMP_OUTPUT, relativePath);
  if (!fs.existsSync(source)) throw new Error(`Не найден обязательный файл или каталог: ${relativePath}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (candidate) => !DEPLOY_EXCLUSIONS.has(relativePosix(candidate))
  });
};

const publishOutput = () => {
  assertInsideRoot(OUTPUT);
  assertInsideRoot(TEMP_OUTPUT);
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  try {
    fs.renameSync(TEMP_OUTPUT, OUTPUT);
  } catch {
    fs.cpSync(TEMP_OUTPUT, OUTPUT, { recursive: true });
    fs.rmSync(TEMP_OUTPUT, { recursive: true, force: true });
  }
};

const assertPublishedReviewScope = (release, projects, published) => {
  const publishedSlugs = new Set(published.map(({ slug }) => slug));
  const packagedSlugs = new Set();
  release.files.forEach((file) => {
    const match = file.match(/^reviews\/([^/]+)\//);
    if (!match) return;
    packagedSlugs.add(match[1]);
    if (!publishedSlugs.has(match[1])) throw new Error(`В релиз попал обзор неопубликованного проекта: reviews/${match[1]}/`);
  });
  publishedSlugs.forEach((slug) => {
    if (!packagedSlugs.has(slug)) throw new Error(`В релизе отсутствует обзор опубликованного проекта: reviews/${slug}/`);
  });

  const sitemap = fs.readFileSync(path.join(TEMP_OUTPUT, 'sitemap.xml'), 'utf8');
  projects.filter((project) => !publishedSlugs.has(project.slug)).forEach((project) => {
    if (sitemap.includes(`/reviews/${project.slug}/`)) {
      throw new Error(`sitemap.xml содержит неопубликованный проект: ${project.slug}`);
    }
  });
};

const sitemapPaths = (sitemapFile) => {
  const xml = fs.readFileSync(sitemapFile, 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => {
    const url = new URL(match[1].replaceAll('&amp;', '&'));
    if (url.search || url.hash) throw new Error(`Некорректный canonical URL в sitemap: ${url.href}`);
    return url.pathname;
  });
};

try {
  const projects = loadProjects(ROOT);
  const published = publishedProjects(projects);
  const publishedIds = new Set(published.map(({ id }) => id));
  const publishedLogos = new Set(published.map(({ logo }) => logo));
  projects.filter((project) => !publishedIds.has(project.id)).forEach((project) => {
    if (project.logo.startsWith('assets/') && !publishedLogos.has(project.logo)) DEPLOY_EXCLUSIONS.add(project.logo);
  });
  const sourceCheck = checkSite(ROOT);
  if (!sourceCheck.ok) {
    const details = sourceCheck.errors.map(({ check, message }) => `${check}: ${message}`).join('\n');
    throw new Error(`Исходный сайт не прошёл проверку перед упаковкой:\n${details}`);
  }

  const reviewDirectories = published.map(({ slug }) => `reviews/${slug}`);
  [...PUBLIC_FILES, ...PUBLIC_DIRECTORIES, ...reviewDirectories].forEach(copyRequired);

  const releaseHtaccess = path.join(TEMP_OUTPUT, '.htaccess');
  const redirects = injectProjectRedirects(fs.readFileSync(releaseHtaccess, 'utf8'), projects, {
    reservedPaths: sitemapPaths(path.join(TEMP_OUTPUT, 'sitemap.xml'))
  });
  fs.writeFileSync(releaseHtaccess, redirects.source, 'utf8');
  const manifest = writeReleaseManifest(TEMP_OUTPUT, published);

  const release = validateReleaseDirectory(TEMP_OUTPUT);
  assertPublishedReviewScope(release, projects, published);

  publishOutput();
  console.log(`Готов каталог для Beget: ${OUTPUT} (${release.files.length} файлов, ${release.htmlFiles} HTML)`);
  console.log(`Build ID: ${manifest.buildId}`);
  console.log(`Опубликовано обзоров: ${published.length}; query 301: ${redirects.queryRules}; alias 301: ${redirects.rules}; private-route rules: ${redirects.hiddenRules}.`);
  console.log('Локальная админка, исходная база и служебные скрипты в публичный комплект не включены.');
  console.log('Загружайте содержимое этого каталога в корневую директорию домена.');
} catch (error) {
  fs.rmSync(TEMP_OUTPUT, { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
