import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkSite } from './check-site.mjs';
import {
  databaseSource,
  parseProjectsSource,
  projectSignature,
  validateProjects
} from './lib/projects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.AFFGOLD_EDITOR_PORT || '4177', 10);
const ORIGIN = `http://${HOST}:${PORT}`;
const PROJECTS_FILE = path.join(ROOT, 'js', 'projects-data.js');
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build-seo.mjs');
const PROJECT_IMAGES_DIRECTORY = path.join(ROOT, 'assets', 'images', 'projects');
const API_TOKEN = randomBytes(24).toString('hex');
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const BUILD_TIMEOUT_MS = 120000;
const OUTPUT_LIMIT = 512 * 1024;
const MAX_LOGO_BYTES = 128 * 1024;
const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/]+={0,2})$/i;
const IMAGE_EXTENSIONS = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const PUBLIC_ROOT_FILES = new Set([
  'index.html', 'catalog.html', 'review.html', '404.html', 'robots.txt', 'sitemap.xml'
]);
const PUBLIC_DIRECTORIES = new Set([
  'admin', 'assets', 'css', 'js', 'reviews', 'ratings', 'bonuses', 'compare',
  'payments', 'guides', 'about', 'contacts', 'privacy', 'terms', 'news', 'updates'
]);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon'
};

let publishing = false;
let lastPublishedAt = null;

class HttpError extends Error {
  constructor(status, message, details = '') {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const responseHeaders = (extra = {}) => ({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  ...extra
});

const sendJson = (response, status, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, responseHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  }));
  response.end(body);
};

const sendText = (response, status, body) => {
  response.writeHead(status, responseHeaders({
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  }));
  response.end(body);
};

const readJson = async (request) => {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim();
  if (contentType !== 'application/json') throw new HttpError(415, 'Ожидается тело запроса в формате JSON.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Данные редактора превышают допустимый размер 8 МБ.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Не удалось прочитать JSON из запроса.'); }
};

const atomicWrite = async (target, content) => {
  const directory = path.dirname(target);
  await fsp.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await fsp.open(temporary, 'wx', 0o600);
    if (typeof content === 'string') await handle.writeFile(content, 'utf8');
    else await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(temporary, target);
  } finally {
    await handle?.close().catch(() => {});
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
};

const hasExpectedImageSignature = (buffer, type) => {
  if (type === 'png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (type === 'jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === 'webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
};

const prepareLogoUploads = (sourceProjects) => {
  const uploads = [];
  const projects = sourceProjects.map((project, index) => {
    if (!project || typeof project !== 'object' || Array.isArray(project)) return project;
    const next = { ...project };
    if (typeof next.logo !== 'string' || !next.logo.startsWith('data:image/')) return next;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(next.id || '')) throw new HttpError(422, `Проект #${index + 1}: сначала укажите безопасный ID для логотипа.`);
    if (next.logo.length > Math.ceil(MAX_LOGO_BYTES * 4 / 3) + 100) throw new HttpError(422, `Проект «${next.id}»: логотип превышает 128 КБ.`);
    const match = next.logo.match(DATA_IMAGE);
    if (!match) throw new HttpError(422, `Проект «${next.id}»: поддерживаются только PNG, JPEG и WebP в формате base64.`);
    const type = match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > MAX_LOGO_BYTES) throw new HttpError(422, `Проект «${next.id}»: логотип должен быть не больше 128 КБ.`);
    if (!hasExpectedImageSignature(buffer, type)) throw new HttpError(422, `Проект «${next.id}»: содержимое логотипа не соответствует формату ${type.toUpperCase()}.`);
    const relativePath = `assets/images/projects/${next.id}-logo.${IMAGE_EXTENSIONS[type]}`;
    uploads.push({ target: path.join(ROOT, ...relativePath.split('/')), buffer });
    next.logo = relativePath;
    return next;
  });
  return { projects, uploads };
};

const rollbackLogoUploads = async (backups) => {
  for (const backup of [...backups].reverse()) {
    if (backup.previous === null) await fsp.rm(backup.target, { force: true });
    else await atomicWrite(backup.target, backup.previous);
  }
};

const writeLogoUploads = async (uploads) => {
  const backups = [];
  try {
    for (const upload of uploads) {
      let previous = null;
      try { previous = await fsp.readFile(upload.target); }
      catch (event) { if (event.code !== 'ENOENT') throw event; }
      backups.push({ target: upload.target, previous });
      await atomicWrite(upload.target, upload.buffer);
    }
    return backups;
  } catch (event) {
    await rollbackLogoUploads(backups);
    throw event;
  }
};

const runBuild = () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [BUILD_SCRIPT], {
    cwd: ROOT,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let killedByTimeout = false;
  const append = (chunk) => {
    output += chunk.toString('utf8');
    if (output.length > OUTPUT_LIMIT) output = output.slice(-OUTPUT_LIMIT);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const timer = setTimeout(() => {
    killedByTimeout = true;
    child.kill();
  }, BUILD_TIMEOUT_MS);
  child.once('error', (event) => {
    clearTimeout(timer);
    reject(new Error(`Не удалось запустить сборку: ${event.message}`));
  });
  child.once('close', (code) => {
    clearTimeout(timer);
    if (killedByTimeout) reject(new Error('Сборка остановлена: превышено время ожидания 120 секунд.'));
    else if (code !== 0) reject(new Error(`Сборка завершилась с кодом ${code}.\n${output.trim()}`));
    else resolve(output.trim());
  });
});

const runSiteCheck = () => {
  const result = checkSite(ROOT);
  if (!result.ok) {
    const details = result.errors.slice(0, 30)
      .map((error) => `${error.check}: ${error.message}`)
      .join('\n');
    throw new Error(`Проверка готового сайта не пройдена (${result.errors.length} ошибок).\n${details}`);
  }
  return `Проверка сайта пройдена за ${result.durationMs} мс.`;
};

const assertLocalRequest = (request) => {
  const allowedHosts = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
  if (!allowedHosts.has(String(request.headers.host || '').toLowerCase())) throw new HttpError(403, 'Недопустимый адрес локального редактора.');
  const origin = request.headers.origin;
  if (origin && origin !== ORIGIN && origin !== `http://localhost:${PORT}`) throw new HttpError(403, 'Запрос отклонён проверкой источника.');
};

const editorStatus = async () => {
  const source = await fsp.readFile(PROJECTS_FILE, 'utf8');
  const projects = parseProjectsSource(source);
  return {
    ok: true,
    mode: 'local',
    editorVersion: 1,
    projectCount: projects.length,
    sourceSignature: projectSignature(projects),
    publishing,
    lastPublishedAt,
    token: API_TOKEN
  };
};

const publishProjects = async (request, response) => {
  assertLocalRequest(request);
  if (request.headers['x-affgold-admin-token'] !== API_TOKEN) throw new HttpError(403, 'Сессия локального редактора устарела. Обновите страницу.');
  if (publishing) throw new HttpError(409, 'Сборка уже выполняется. Дождитесь её завершения.');
  const payload = await readJson(request);
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.projects)) throw new HttpError(400, 'В запросе отсутствует массив projects.');

  const oldSource = await fsp.readFile(PROJECTS_FILE, 'utf8');
  const currentProjects = parseProjectsSource(oldSource);
  const currentSignature = projectSignature(currentProjects);
  if (payload.sourceSignature !== currentSignature) {
    throw new HttpError(409, 'Файл базы изменился после открытия редактора. Обновите страницу, чтобы не затереть свежие данные.');
  }

  let projects;
  let uploads;
  try {
    const prepared = prepareLogoUploads(payload.projects);
    projects = validateProjects(prepared.projects);
    uploads = prepared.uploads;
  }
  catch (event) { throw new HttpError(422, event.message); }
  const nextSource = databaseSource(projects);

  publishing = true;
  let logoBackups = [];
  try {
    try {
      logoBackups = await writeLogoUploads(uploads);
      await atomicWrite(PROJECTS_FILE, nextSource);
    } catch (writeError) {
      await rollbackLogoUploads(logoBackups);
      throw new HttpError(500, `Не удалось безопасно записать данные: ${writeError.message}`);
    }
    let buildOutput;
    try {
      buildOutput = await runBuild();
      buildOutput = [buildOutput, runSiteCheck()].filter(Boolean).join('\n');
    } catch (buildError) {
      await atomicWrite(PROJECTS_FILE, oldSource);
      await rollbackLogoUploads(logoBackups);
      let recovery = '';
      try {
        recovery = await runBuild();
        recovery = [recovery, runSiteCheck()].filter(Boolean).join('\n');
      }
      catch (recoveryError) { recovery = `Восстановительная сборка также завершилась ошибкой: ${recoveryError.message}`; }
      throw new HttpError(500, 'Сборка не завершена. Исходная база проектов восстановлена.', `${buildError.message}\n${recovery}`.trim());
    }
    lastPublishedAt = new Date().toISOString();
    sendJson(response, 200, {
      ok: true,
      message: `Сохранено проектов: ${projects.length}. Сайт успешно пересобран.`,
      projectCount: projects.length,
      projects,
      sourceSignature: projectSignature(projects),
      publishedAt: lastPublishedAt,
      buildOutput
    });
  } finally {
    publishing = false;
  }
};

const previewBasePath = String(process.env.AFFGOLD_BASE_PATH ?? '/affgold_site')
  .trim().replace(/^\/*/, '/').replace(/\/+$/, '');

const resolveStaticFile = async (requestUrl) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(requestUrl, ORIGIN).pathname); }
  catch { throw new HttpError(400, 'Некорректный адрес.'); }
  if (previewBasePath && (pathname === previewBasePath || pathname.startsWith(`${previewBasePath}/`))) {
    pathname = pathname.slice(previewBasePath.length) || '/';
  }
  const relative = pathname.replace(/^\/+/, '');
  const firstSegment = relative.split('/')[0];
  if (relative && !PUBLIC_ROOT_FILES.has(relative) && !PUBLIC_DIRECTORIES.has(firstSegment)) throw new HttpError(404, 'Файл не найден.');
  if (relative.split('/').some((segment) => segment.startsWith('.'))) throw new HttpError(404, 'Файл не найден.');

  let target = path.resolve(ROOT, relative || 'index.html');
  if (target !== ROOT && !target.startsWith(`${ROOT}${path.sep}`)) throw new HttpError(403, 'Доступ к этому пути запрещён.');
  let stat;
  try { stat = await fsp.stat(target); }
  catch { throw new HttpError(404, 'Файл не найден.'); }
  if (stat.isDirectory()) {
    target = path.join(target, 'index.html');
    try { stat = await fsp.stat(target); }
    catch { throw new HttpError(404, 'Файл не найден.'); }
  }
  if (!stat.isFile()) throw new HttpError(404, 'Файл не найден.');
  return { target, stat };
};

const serveStatic = async (request, response) => {
  const { target, stat } = await resolveStaticFile(request.url);
  const contentType = MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
  response.writeHead(200, responseHeaders({
    'Content-Type': contentType,
    'Content-Length': stat.size
  }));
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(target).pipe(response);
};

const server = http.createServer(async (request, response) => {
  try {
    assertLocalRequest(request);
    const pathname = new URL(request.url, ORIGIN).pathname;
    if (pathname === '/api/admin/status' && request.method === 'GET') {
      sendJson(response, 200, await editorStatus());
      return;
    }
    if (pathname === '/api/admin/publish' && request.method === 'POST') {
      await publishProjects(request, response);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'Метод запроса не поддерживается.');
    await serveStatic(request, response);
  } catch (event) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const status = event instanceof HttpError ? event.status : 500;
    const payload = { ok: false, message: status === 500 && !(event instanceof HttpError) ? 'Внутренняя ошибка локального редактора.' : event.message };
    if (event.details) payload.details = event.details;
    if (new URL(request.url, ORIGIN).pathname.startsWith('/api/')) sendJson(response, status, payload);
    else sendText(response, status, payload.message);
    if (status >= 500) console.error(event);
  }
});

export { server };

server.on('error', (event) => {
  if (event.code === 'EADDRINUSE') console.error(`Порт ${PORT} уже занят. Возможно, редактор уже запущен: ${ORIGIN}/admin/`);
  else console.error(event);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  const editorUrl = `${ORIGIN}/admin/`;
  console.log(`AFFGOLD: локальный редактор запущен\n${editorUrl}\nДля остановки нажмите Ctrl+C.`);
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const opener = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', editorUrl], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    opener.unref();
  }
});
