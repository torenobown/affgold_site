import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_TEXT_FIELDS = [
  'id', 'slug', 'lastUpdated', 'name', 'logo', 'verdict', 'bonus', 'promoCode',
  'bonusSubtitle', 'payout', 'payoutLabel', 'url', 'description'
];
const SCORE_FIELDS = ['reliability', 'bonuses', 'slots', 'payouts', 'support'];
const LIST_FIELDS = ['bonusTypes', 'tags', 'features', 'payments'];
const BONUS_TYPES = new Set(['welcome', 'freespins', 'cashback', 'no-deposit']);
const PAYOUT_TYPES = new Set(['instant', 'hour', 'day']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const PROJECT_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PROJECTS = 200;
const MAX_TEXT_LENGTH = 12000;

export const DEFAULT_PROJECT_THEME = {
  primary: '#9767ff',
  secondary: '#b24dff',
  buttonStart: '#6433cc',
  buttonEnd: '#8a2fb5',
  onPrimary: '#ffffff'
};

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isScore = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 5;
const isNonEmptyText = (value) => typeof value === 'string' && Boolean(value.trim());

const validateLogo = (value, label, errors) => {
  if (!isNonEmptyText(value)) return;
  if (/^https:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.username || url.password || value.length > 2048) throw new Error('unsafe');
      return;
    } catch {
      errors.push(`${label}: внешний logo должен быть безопасным HTTPS-адресом без логина и пароля.`);
      return;
    }
  }
  if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(value)) {
    if (value.length > 180000) errors.push(`${label}: встроенный логотип превышает допустимый размер 128 КБ.`);
    return;
  }
  if (/^assets\/[a-z0-9_./-]+\.(?:svg|png|jpe?g|webp|avif)$/i.test(value) && !value.includes('..')) return;
  errors.push(`${label}: logo должен быть путём внутри assets, HTTPS-адресом или безопасным data URL.`);
};

const validateTextList = (value, field, label, errors) => {
  if (!Array.isArray(value)) {
    errors.push(`${label}: ${field} должен быть массивом.`);
    return;
  }
  if (value.length > 50) errors.push(`${label}: ${field} содержит слишком много элементов.`);
  value.forEach((item, itemIndex) => {
    if (!isNonEmptyText(item) || item.length > 500) errors.push(`${label}: ${field}[${itemIndex}] должен быть непустой короткой строкой.`);
  });
};

export const normalizeProjectTheme = (theme = {}) => {
  const source = isPlainObject(theme) ? theme : {};
  return Object.fromEntries(Object.entries(DEFAULT_PROJECT_THEME).map(([key, fallback]) => [
    key,
    HEX_COLOR.test(String(source[key] || '')) ? String(source[key]).toLowerCase() : fallback
  ]));
};

export const validateProjects = (projects) => {
  const errors = [];
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('База проектов должна содержать хотя бы один проект.');
  }
  if (projects.length > MAX_PROJECTS) throw new Error(`В базе не может быть больше ${MAX_PROJECTS} проектов.`);

  const ids = new Set();
  const slugs = new Set();
  projects.forEach((project, index) => {
    const label = `Проект #${index + 1}`;
    if (!isPlainObject(project)) {
      errors.push(`${label}: ожидается объект.`);
      return;
    }
    REQUIRED_TEXT_FIELDS.forEach((field) => {
      if (!isNonEmptyText(project[field])) errors.push(`${label}: не заполнено поле ${field}.`);
      else if (project[field].length > MAX_TEXT_LENGTH) errors.push(`${label}: поле ${field} слишком длинное.`);
    });
    if (!PROJECT_KEY.test(project.id || '') || project.id.length > 80) errors.push(`${label}: id должен содержать только a-z, 0-9 и одиночные дефисы.`);
    if (!PROJECT_KEY.test(project.slug || '') || project.slug.length > 100) errors.push(`${label}: slug должен содержать только a-z, 0-9 и одиночные дефисы.`);
    if (!ISO_DATE.test(project.lastUpdated || '') || Number.isNaN(Date.parse(`${project.lastUpdated}T00:00:00Z`))) errors.push(`${label}: lastUpdated должен быть корректной датой YYYY-MM-DD.`);
    if (ids.has(project.id)) errors.push(`${label}: id «${project.id}» уже используется.`);
    if (slugs.has(project.slug)) errors.push(`${label}: slug «${project.slug}» уже используется.`);
    ids.add(project.id);
    slugs.add(project.slug);

    if (!isScore(project.rating)) errors.push(`${label}: rating должен быть числом от 0 до 5.`);
    if (!Number.isFinite(Number(project.wager)) || Number(project.wager) < 0 || Number(project.wager) > 1000) errors.push(`${label}: wager должен быть числом от 0 до 1000.`);
    LIST_FIELDS.forEach((field) => validateTextList(project[field], field, label, errors));
    if (Array.isArray(project.bonusTypes)) {
      if (!project.bonusTypes.length) errors.push(`${label}: bonusTypes не должен быть пустым.`);
      project.bonusTypes.forEach((type) => { if (!BONUS_TYPES.has(type)) errors.push(`${label}: неизвестный тип бонуса «${type}».`); });
    }
    if (!PAYOUT_TYPES.has(project.payout)) errors.push(`${label}: неизвестное значение payout «${project.payout}».`);
    if (!isPlainObject(project.tabs)) errors.push(`${label}: отсутствует объект tabs.`);
    else ['bonuses', 'slots', 'payments'].forEach((field) => {
      if (!isNonEmptyText(project.tabs[field]) || project.tabs[field].length > MAX_TEXT_LENGTH) errors.push(`${label}: tabs.${field} должен быть непустой строкой.`);
    });
    if (!isPlainObject(project.scores)) errors.push(`${label}: отсутствует объект scores.`);
    else SCORE_FIELDS.forEach((field) => {
      if (!isScore(project.scores[field])) errors.push(`${label}: scores.${field} должен быть числом от 0 до 5.`);
    });
    try {
      const url = new URL(project.url);
      if (url.protocol !== 'https:') errors.push(`${label}: url должен использовать HTTPS.`);
      if (url.username || url.password) errors.push(`${label}: url не должен содержать логин или пароль.`);
    } catch { errors.push(`${label}: url должен быть полным HTTPS-адресом.`); }
    validateLogo(project.logo, label, errors);

    const theme = isPlainObject(project.theme) ? project.theme : {};
    Object.keys(DEFAULT_PROJECT_THEME).forEach((field) => {
      if (!HEX_COLOR.test(String(theme[field] || ''))) errors.push(`${label}: theme.${field} должен быть цветом в формате #RRGGBB.`);
    });
  });

  if (errors.length) throw new Error(`Ошибки в базе проектов:\n- ${errors.join('\n- ')}`);
  return projects;
};

export const parseProjectsSource = (source) => {
  const match = source.match(/window\.AFFGOLD_PROJECTS\s*=\s*(\[[\s\S]*\])\s*;\s*$/);
  if (!match) throw new Error('js/projects-data.js имеет неподдерживаемый формат.');
  let projects;
  try { projects = JSON.parse(match[1]); }
  catch (event) { throw new Error(`Не удалось прочитать js/projects-data.js: ${event.message}`); }
  return validateProjects(projects);
};

export const loadProjects = (root) => parseProjectsSource(
  fs.readFileSync(path.join(root, 'js/projects-data.js'), 'utf8')
);

export const projectSignature = (projects) => {
  const source = JSON.stringify(projects);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}-${projects.length}`;
};

export const databaseSource = (projects) => {
  validateProjects(projects);
  const json = JSON.stringify(projects, null, 2).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return `/**\n * Единая база проектов.\n * Редактируйте через /admin/ и запускайте пересборку сайта.\n */\nwindow.AFFGOLD_PROJECTS = ${json};\n`;
};

const hexToRgb = (hex) => {
  const normalized = hex.slice(1);
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)).join(' ');
};

export const projectThemeCss = (projects) => `${projects.map((project) => {
  const theme = normalizeProjectTheme(project.theme);
  return `:where([data-project-theme="${project.id}"]) {\n  --project-primary-rgb: ${hexToRgb(theme.primary)};\n  --project-secondary-rgb: ${hexToRgb(theme.secondary)};\n  --project-button-start: ${theme.buttonStart};\n  --project-button-end: ${theme.buttonEnd};\n  --project-on-primary: ${theme.onPrimary};\n}`;
}).join('\n\n')}\n`;
