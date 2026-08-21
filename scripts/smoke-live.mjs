import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SITE = 'https://affgoldprod.com';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_MANIFEST = path.join(ROOT, 'beget-upload', 'release-manifest.json');
const argument = process.argv.find((value) => value.startsWith('--base-url='));
const baseUrl = new URL(argument?.slice('--base-url='.length) || process.env.AFFGOLD_SITE_URL || DEFAULT_SITE);
if (baseUrl.protocol !== 'https:' || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
  throw new Error('Укажите HTTPS origin без пути, например --base-url=https://affgoldprod.com');
}
if (baseUrl.origin !== DEFAULT_SITE) {
  throw new Error('Текущий production .htaccess закреплён за https://affgoldprod.com; измените конфигурацию перед smoke другого домена.');
}

const errors = [];
const passed = [];
const fail = (message) => errors.push(message);

const request = async (pathname, options = {}) => {
  const target = new URL(pathname, baseUrl);
  const response = await fetch(target, {
    redirect: options.redirect || 'manual',
    headers: { 'User-Agent': 'AFFGOLD-release-smoke/1.0', Accept: options.accept || '*/*' },
    signal: AbortSignal.timeout(15_000)
  });
  let body = '';
  if (options.readBody === false) await response.body?.cancel();
  else body = await response.text();
  return { target, response, body };
};

const expectPage = async (pathname, marker) => {
  const { response, body } = await request(pathname);
  if (response.status !== 200) return fail(`${pathname}: HTTP ${response.status}, ожидался 200`);
  if (!body.includes(marker)) return fail(`${pathname}: не найден маркер актуальной версии «${marker}»`);
  passed.push(`${pathname} → 200`);
};

const expectRedirect = async (pathname, destination) => {
  const { response } = await request(pathname, { readBody: false });
  const actual = response.headers.get('location');
  const resolved = actual ? new URL(actual, new URL(pathname, baseUrl)).href : '';
  if (response.status !== 301 || resolved !== destination) {
    return fail(`${pathname}: ожидался 301 → ${destination}, получено ${response.status} → ${resolved || '(нет Location)'}`);
  }
  passed.push(`${pathname} → 301`);
};

try {
  if (!fs.existsSync(LOCAL_MANIFEST)) throw new Error('Сначала соберите локальный release: отсутствует beget-upload/release-manifest.json.');
  const localManifest = JSON.parse(fs.readFileSync(LOCAL_MANIFEST, 'utf8'));
  const remoteManifestResponse = await request('/release-manifest.json');
  let remoteManifest;
  try { remoteManifest = JSON.parse(remoteManifestResponse.body); }
  catch { remoteManifest = null; }
  if (remoteManifestResponse.response.status !== 200 || remoteManifest?.buildId !== localManifest.buildId) {
    fail(`/release-manifest.json: production не совпадает с локальным Build ID ${localManifest.buildId}`);
  } else if (!/no-store/i.test(remoteManifestResponse.response.headers.get('cache-control') || '')) {
    fail('/release-manifest.json: не применён Cache-Control no-store');
  } else passed.push(`Build ID совпадает: ${localManifest.buildId}`);

  await expectPage('/', '<body data-page="home">');
  await expectPage('/catalog.html', '<body data-page="catalog">');
  await expectPage('/reviews/joycasino/', 'data-project-theme="joycasino"');

  const css = await request('/css/home-page.css');
  if (css.response.status !== 200 || !css.response.headers.get('content-type')?.includes('text/css')) {
    fail(`/css/home-page.css: неверный ответ ${css.response.status} ${css.response.headers.get('content-type') || ''}`);
  } else if (!/max-age=31536000/i.test(css.response.headers.get('cache-control') || '')) {
    fail('/css/home-page.css: не применён годовой Cache-Control');
  } else passed.push('/css/home-page.css → 200 + cache');

  const logo = await request('/assets/images/velora-logo.svg');
  if (logo.response.status !== 200 || !logo.response.headers.get('content-type')?.includes('image/svg+xml')) {
    fail(`/assets/images/velora-logo.svg: неверный ответ ${logo.response.status} ${logo.response.headers.get('content-type') || ''}`);
  } else passed.push('/assets/images/velora-logo.svg → 200');

  for (const privatePath of ['/admin/', '/js/admin.js', '/js/projects-data.js', '/css/admin.css']) {
    const privateResponse = await request(privatePath, { readBody: false });
    if (![403, 404, 410].includes(privateResponse.response.status)) {
      fail(`${privatePath}: служебный путь вернул HTTP ${privateResponse.response.status} вместо 403/404/410`);
    }
    else passed.push(`${privatePath} → not public`);
  }

  for (const retiredPath of ['/about/affiliate-disclosure/', '/about/responsible-play/']) {
    const retiredResponse = await request(retiredPath, { readBody: false });
    if (retiredResponse.response.status !== 410) {
      fail(`${retiredPath}: удалённый раздел вернул HTTP ${retiredResponse.response.status} вместо 410`);
    } else passed.push(`${retiredPath} → 410`);
  }

  const redirects = new Map([
    ['/joycasino.html', `${baseUrl.origin}/reviews/joycasino/`],
    ['/norm-casino.html', `${baseUrl.origin}/reviews/norm-casino/`],
    ['/apex-casino.html', `${baseUrl.origin}/reviews/apex/`],
    ['/tiger-casino.html', `${baseUrl.origin}/reviews/tiger/`],
    ['/fenix-casino.html', `${baseUrl.origin}/reviews/fenix/`],
    ['/eva-casino.html', `${baseUrl.origin}/reviews/eva/`],
    ['/compare/apex-vs-tiger/', `${baseUrl.origin}/catalog.html`],
    ['/news/', `${baseUrl.origin}/bonuses/`],
    ['/updates/', `${baseUrl.origin}/about/methodology/`],
    ['/review.html?project=velora', `${baseUrl.origin}/reviews/velora/`],
    ['/velora', 'https://luminous-stride.com/svpm9qq3e']
  ]);
  for (const [pathname, destination] of redirects) await expectRedirect(pathname, destination);
  await expectRedirect(`http://${baseUrl.host}/catalog.html`, `${baseUrl.origin}/catalog.html`);
  await expectRedirect(`https://www.${baseUrl.hostname}/catalog.html`, `${baseUrl.origin}/catalog.html`);

  const missing = await request('/__affgold_release_404_check__/nested/path');
  if (missing.response.status !== 404 || !missing.body.includes('Страница не найдена')) {
    fail(`Custom 404: получен HTTP ${missing.response.status}, либо используется не новый 404.html`);
  } else if (!/<base\s+href=["']\/["']/i.test(missing.body) && !/<link[^>]+href=["']\/css\//i.test(missing.body)) {
    fail('Custom 404 использует относительные assets и сломается на вложенном неизвестном URL');
  } else passed.push('custom ErrorDocument → 404');

  const root = await request('/');
  const requiredHeaders = new Map([
    ['strict-transport-security', 'max-age='],
    ['content-security-policy', "default-src 'self'"],
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'strict-origin-when-cross-origin']
  ]);
  requiredHeaders.forEach((fragment, header) => {
    const value = root.response.headers.get(header) || '';
    if (!value.toLowerCase().includes(fragment.toLowerCase())) fail(`Главная: отсутствует/неверен заголовок ${header}`);
  });
  if (!/no-cache/i.test(root.response.headers.get('cache-control') || '')) {
    fail('Главная: HTML должен требовать revalidation через Cache-Control no-cache');
  }

  const robots = await request('/robots.txt');
  if (robots.response.status !== 200 || !robots.body.includes(`${baseUrl.origin}/sitemap.xml`)) fail('robots.txt не ссылается на production sitemap');
  else passed.push('/robots.txt → 200');

  const sitemap = await request('/sitemap.xml');
  if (sitemap.response.status !== 200 || !sitemap.body.includes(`${baseUrl.origin}/catalog.html`)) fail('sitemap.xml не содержит актуальный каталог');
  else passed.push('/sitemap.xml → 200');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

passed.forEach((message) => console.log(`✓ ${message}`));
if (errors.length) {
  errors.forEach((message) => console.error(`✗ ${message}`));
  console.error(`Live smoke: FAILED (${errors.length} ошибок)`);
  process.exitCode = 1;
} else {
  console.log(`Live smoke: OK (${passed.length} проверок), origin ${baseUrl.origin}`);
}
