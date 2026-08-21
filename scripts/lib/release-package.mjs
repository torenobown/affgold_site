import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_FILES = [
  '.htaccess',
  '404.html',
  'catalog.html',
  'index.html',
  'release-manifest.json',
  'review.html',
  'robots.txt',
  'sitemap.xml',
  'css/catalog-page.css',
  'css/home-page.css',
  'css/review-page.css',
  'css/seo-page.css',
  'js/catalog.js',
  'js/main.js'
];

const FORBIDDEN_PATHS = [
  'admin',
  'css/admin.css',
  'js/admin.js',
  'js/projects-data.js',
  'scripts'
];

const FORBIDDEN_EXTENSIONS = new Set(['.bat', '.cmd', '.map', '.mjs', '.ps1', '.ts']);

const toPosix = (value) => value.split(path.sep).join('/');
const compareNames = (left, right) => left === right ? 0 : (left < right ? -1 : 1);

const isInside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export function listReleaseFiles(root) {
  const absoluteRoot = path.resolve(root);
  const files = [];

  const visit = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareNames(left.name, right.name))
      .forEach((entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Символические ссылки запрещены в релизе: ${toPosix(path.relative(absoluteRoot, target))}`);
        if (entry.isDirectory()) visit(target);
        else if (entry.isFile()) files.push(toPosix(path.relative(absoluteRoot, target)));
        else throw new Error(`Неподдерживаемый объект в релизе: ${toPosix(path.relative(absoluteRoot, target))}`);
      });
  };

  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Каталог релиза не найден: ${absoluteRoot}`);
  }
  visit(absoluteRoot);
  return files.sort(compareNames);
}

export function releaseBuildId(root, publishedProjectList = []) {
  const absoluteRoot = path.resolve(root);
  const files = listReleaseFiles(absoluteRoot).filter((file) => file !== 'release-manifest.json');
  const projects = publishedProjectList
    .map(({ id, slug }) => ({ id: String(id), slug: String(slug) }))
    .sort((left, right) => compareNames(left.id, right.id));
  const hash = crypto.createHash('sha256');
  hash.update('AFFGOLD-RELEASE-v1\0');
  files.forEach((file) => {
    hash.update(file);
    hash.update('\0');
    hash.update(crypto.createHash('sha256').update(fs.readFileSync(path.join(absoluteRoot, ...file.split('/')))).digest());
  });
  hash.update('\0PROJECTS\0');
  hash.update(JSON.stringify(projects));
  return hash.digest('hex');
}

export function writeReleaseManifest(root, publishedProjects) {
  const absoluteRoot = path.resolve(root);
  const projects = publishedProjects
    .map(({ id, slug }) => ({ id, slug }))
    .sort((left, right) => compareNames(left.id, right.id));
  const buildId = releaseBuildId(absoluteRoot, projects);
  const fileCount = listReleaseFiles(absoluteRoot).filter((file) => file !== 'release-manifest.json').length + 1;
  const manifest = {
    schemaVersion: 1,
    siteOrigin: 'https://affgoldprod.com',
    buildId,
    fileCount,
    publishedProjects: projects
  };
  fs.writeFileSync(path.join(absoluteRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

const resolveLocalReference = (root, htmlFile, rawReference) => {
  const trimmed = rawReference.trim();
  if (!trimmed || trimmed === '#' || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed)) return null;

  const pathname = trimmed.split('#', 1)[0].split('?', 1)[0];
  if (!pathname) return htmlFile;

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new Error(`Некорректное URL-кодирование «${rawReference}» в ${toPosix(path.relative(root, htmlFile))}`);
  }

  const target = decoded.startsWith('/')
    ? path.resolve(root, decoded.replace(/^\/+/, ''))
    : path.resolve(path.dirname(htmlFile), decoded);

  if (!isInside(root, target)) {
    throw new Error(`Локальная ссылка выходит за пределы релиза: ${rawReference} в ${toPosix(path.relative(root, htmlFile))}`);
  }
  return target;
};

const assertLocalReferences = (root, files) => {
  const htmlFiles = files.filter((file) => file.endsWith('.html'));
  const attributePattern = /\b(?:href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

  htmlFiles.forEach((relativeFile) => {
    const htmlFile = path.join(root, ...relativeFile.split('/'));
    const html = fs.readFileSync(htmlFile, 'utf8');
    for (const match of html.matchAll(attributePattern)) {
      const rawValue = match[1] ?? match[2] ?? '';
      const candidates = /^\s*data:/i.test(rawValue)
        ? [rawValue]
        : rawValue.split(',').map((candidate) => candidate.trim().split(/\s+/, 1)[0]).filter(Boolean);

      candidates.forEach((candidate) => {
        const target = resolveLocalReference(root, htmlFile, candidate);
        if (!target) return;
        let resolved = target;
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) resolved = path.join(resolved, 'index.html');
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
          throw new Error(`В релизе отсутствует локальная цель «${candidate}» из ${relativeFile}`);
        }
      });
    }
  });
};

export function validateReleaseDirectory(root) {
  const absoluteRoot = path.resolve(root);
  const files = listReleaseFiles(absoluteRoot);
  const fileSet = new Set(files);

  REQUIRED_FILES.forEach((file) => {
    if (!fileSet.has(file)) throw new Error(`В релизном комплекте отсутствует ${file}`);
  });

  FORBIDDEN_PATHS.forEach((forbidden) => {
    if (fileSet.has(forbidden) || files.some((file) => file.startsWith(`${forbidden}/`))) {
      throw new Error(`В публичный релиз попал служебный путь: ${forbidden}`);
    }
  });

  files.forEach((file) => {
    if (file.includes('\\')) throw new Error(`Непереносимый разделитель пути: ${file}`);
    if (FORBIDDEN_EXTENSIONS.has(path.posix.extname(file).toLowerCase())) {
      throw new Error(`В публичный релиз попал исходный файл: ${file}`);
    }
  });

  const htaccess = fs.readFileSync(path.join(absoluteRoot, '.htaccess'), 'utf8');
  [
    'RewriteEngine On',
    'affgoldprod.com',
    'joycasino\\.html',
    'norm-casino\\.html',
    'luminous-stride.com/svpm9qq3e',
    'RewriteRule ^about/(?:affiliate-disclosure|responsible-play)(?:/.*)?$ - [G,L,NC]',
    'AFFGOLD:PROJECT_REDIRECTS:START',
    'AFFGOLD:PROJECT_REDIRECTS:END',
    'RewriteCond %{QUERY_STRING}',
    'RewriteRule ^review\\.html$',
    'ErrorDocument 404 /404.html',
    'Content-Security-Policy',
    'Strict-Transport-Security'
  ].forEach((fragment) => {
    if (!htaccess.includes(fragment)) throw new Error(`В .htaccess отсутствует обязательная настройка: ${fragment}`);
  });
  if (htaccess.includes('Query and redirectAliases rules are inserted')) {
    throw new Error('В релизном .htaccess осталась незаполненная секция project redirects.');
  }

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(absoluteRoot, 'release-manifest.json'), 'utf8')); }
  catch (error) { throw new Error(`release-manifest.json повреждён: ${error.message}`); }
  if (manifest.schemaVersion !== 1 || manifest.siteOrigin !== 'https://affgoldprod.com'
    || !/^[0-9a-f]{64}$/.test(manifest.buildId || '') || !Array.isArray(manifest.publishedProjects)) {
    throw new Error('release-manifest.json имеет неподдерживаемый формат.');
  }
  const manifestProjects = new Set();
  const manifestProjectSlugs = new Set();
  manifest.publishedProjects.forEach((project) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project?.id || '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project?.slug || '')) {
      throw new Error('release-manifest.json содержит некорректный проект.');
    }
    if (manifestProjects.has(project.id)) throw new Error(`release-manifest.json повторяет project id: ${project.id}`);
    if (manifestProjectSlugs.has(project.slug)) throw new Error(`release-manifest.json повторяет project slug: ${project.slug}`);
    manifestProjects.add(project.id);
    manifestProjectSlugs.add(project.slug);
  });
  const manifestSlugs = new Set(manifest.publishedProjects.map(({ slug }) => slug));
  const reviewSlugs = new Set(files.map((file) => file.match(/^reviews\/([^/]+)\/index\.html$/)?.[1]).filter(Boolean));
  if ([...manifestSlugs].some((slug) => !reviewSlugs.has(slug)) || [...reviewSlugs].some((slug) => !manifestSlugs.has(slug))) {
    throw new Error('Список опубликованных проектов в manifest не совпадает с reviews/.');
  }
  if (manifest.fileCount !== files.length) throw new Error('release-manifest.json содержит неверное количество файлов.');
  const expectedBuildId = releaseBuildId(absoluteRoot, manifest.publishedProjects);
  if (manifest.buildId !== expectedBuildId) throw new Error('Build ID не совпадает с содержимым релизного каталога.');

  assertLocalReferences(absoluteRoot, files);

  const totalBytes = files.reduce((total, file) => total + fs.statSync(path.join(absoluteRoot, ...file.split('/'))).size, 0);
  return {
    root: absoluteRoot,
    files,
    htmlFiles: files.filter((file) => file.endsWith('.html')).length,
    totalBytes,
    buildId: manifest.buildId
  };
}
