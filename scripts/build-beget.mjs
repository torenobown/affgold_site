import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite } from './check-site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'beget-upload');
const TEMP_OUTPUT = fs.mkdtempSync(path.join(ROOT, '.beget-upload-build-'));

const PUBLIC_FILES = [
  '404.html',
  'catalog.html',
  'index.html',
  'review.html',
  'robots.txt',
  'sitemap.xml'
];

const PUBLIC_DIRECTORIES = [
  'about',
  'admin',
  'assets',
  'bonuses',
  'compare',
  'contacts',
  'css',
  'guides',
  'js',
  'news',
  'payments',
  'privacy',
  'ratings',
  'reviews',
  'terms',
  'updates'
];

const DEPLOY_EXCLUSIONS = new Set([
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

try {
  [...PUBLIC_FILES, ...PUBLIC_DIRECTORIES].forEach(copyRequired);

  const result = checkSite(TEMP_OUTPUT);
  if (!result.ok) {
    const details = result.errors.map(({ check, message }) => `${check}: ${message}`).join('\n');
    throw new Error(`Пакет Beget не прошёл проверку:\n${details}`);
  }

  publishOutput();
  console.log(`Готов каталог для Beget: ${OUTPUT}`);
  console.log('Загружайте содержимое этого каталога в корневую директорию домена.');
} catch (error) {
  fs.rmSync(TEMP_OUTPUT, { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
