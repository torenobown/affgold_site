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
export const PROJECT_STATUSES = Object.freeze(['draft', 'published', 'archived']);
const PROJECT_STATUS_SET = new Set(PROJECT_STATUSES);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const PROJECT_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PROJECTS = 200;
const MAX_TEXT_LENGTH = 12000;
const OPTIONAL_TEXT_FIELDS = ['reviewerId', 'operator', 'licenseAuthority', 'licenseNumber'];
const EDITOR_LINE_BREAK = /[\r\n]/;
const EDITOR_SOURCE_SEPARATOR = /[|\r\n]/;
const EDITOR_COMMA_LIST_SEPARATOR = /[,\r\n]/;
const LOCAL_LOGO_EXTENSION = /\.(?:svg|png|jpe?g|webp|avif)$/i;

export const DEFAULT_PROJECT_THEME = {
  primary: '#9767ff',
  secondary: '#b24dff',
  buttonStart: '#6433cc',
  buttonEnd: '#8a2fb5',
  onPrimary: '#ffffff'
};

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isScore = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5;
const isNonEmptyText = (value) => typeof value === 'string' && Boolean(value.trim());
const isIsoDate = (value) => {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

// Old database entries predate publication statuses. Treating a missing status
// as published keeps existing builds backward compatible.
export const projectStatus = (project) => PROJECT_STATUS_SET.has(project?.status) ? project.status : 'published';
export const isPublishedProject = (project) => projectStatus(project) === 'published';
export const publishedProjects = (projects) => projects.filter(isPublishedProject);

const reviewRoute = (slug) => `/reviews/${slug}/`;

const validateOptionalDate = (value, field, label, errors) => {
  if (value === undefined || value === null || value === '') return;
  if (!isIsoDate(value)) errors.push(`${label}: ${field} должен быть корректной датой YYYY-MM-DD.`);
};

const validateOptionalText = (value, field, label, errors) => {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string' || value.trim().length > 500) {
    errors.push(`${label}: ${field} должен быть короткой строкой.`);
  }
};

const validateHttpsUrl = (value, field, label, errors) => {
  if (typeof value !== 'string') {
    errors.push(`${label}: ${field} должен быть строкой с полным HTTPS-адресом.`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') errors.push(`${label}: ${field} должен использовать HTTPS.`);
    if (url.username || url.password) errors.push(`${label}: ${field} не должен содержать логин или пароль.`);
    if (String(value).length > 2048) errors.push(`${label}: ${field} слишком длинный.`);
  } catch {
    errors.push(`${label}: ${field} должен быть полным HTTPS-адресом.`);
  }
};

const validateRedirectAlias = (value, label, errors) => {
  if (!isNonEmptyText(value) || value.length > 200 || !/^\/reviews\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(value)) {
    errors.push(`${label}: redirectAliases должен содержать локальные пути вида /reviews/old-address/.`);
    return;
  }
  const segments = value.split('/');
  if (value.includes('//') || segments.some((segment) => segment === '.' || segment === '..') || !/^\/[a-z0-9._/-]+$/i.test(value)) {
    errors.push(`${label}: недопустимый путь редиректа «${value}».`);
  }
};

const validateSources = (value, label, errors) => {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${label}: sources должен быть массивом.`);
    return;
  }
  if (value.length > 30) errors.push(`${label}: sources содержит слишком много источников.`);
  value.forEach((source, sourceIndex) => {
    const sourceLabel = `${label}: sources[${sourceIndex}]`;
    if (!isPlainObject(source)) {
      errors.push(`${sourceLabel} должен быть объектом.`);
      return;
    }
    if (!isNonEmptyText(source.label) || source.label.length > 200) {
      errors.push(`${sourceLabel}.label должен быть непустой короткой строкой.`);
    } else if (EDITOR_SOURCE_SEPARATOR.test(source.label)) {
      errors.push(`${sourceLabel}.label не должен содержать символ | или перенос строки: они зарезервированы форматом редактора.`);
    }
    if (typeof source.url === 'string' && EDITOR_SOURCE_SEPARATOR.test(source.url)) {
      errors.push(`${sourceLabel}.url не должен содержать символ | или перенос строки: они зарезервированы форматом редактора.`);
    }
    validateHttpsUrl(source.url, `sources[${sourceIndex}].url`, label, errors);
    validateOptionalDate(source.checkedAt, `sources[${sourceIndex}].checkedAt`, label, errors);
  });
};

const validateChangelog = (value, label, errors) => {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${label}: changelog должен быть массивом.`);
    return;
  }
  if (value.length > 100) errors.push(`${label}: changelog содержит слишком много записей.`);
  value.forEach((entry, entryIndex) => {
    const entryLabel = `${label}: changelog[${entryIndex}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${entryLabel} должен быть объектом.`);
      return;
    }
    if (!isIsoDate(entry.date)) errors.push(`${entryLabel}.date должен быть датой YYYY-MM-DD.`);
    if (!isNonEmptyText(entry.note) || entry.note.length > 500) {
      errors.push(`${entryLabel}.note должен быть непустой короткой строкой.`);
    } else if (EDITOR_LINE_BREAK.test(entry.note)) {
      errors.push(`${entryLabel}.note должен помещаться в одну строку редактора.`);
    }
  });
};

const isSafeLocalLogoPath = (value) => {
  if (typeof value !== 'string' || !value.startsWith('assets/') || !LOCAL_LOGO_EXTENSION.test(value)) return false;
  const segments = value.split('/');
  return segments.length >= 2 && segments.every((segment, index) => {
    if (index === 0) return segment === 'assets';
    return Boolean(segment) && !segment.startsWith('.') && /^[a-z0-9_.-]+$/i.test(segment);
  });
};

const validateLogo = (value, label, errors) => {
  if (!isNonEmptyText(value)) return;
  if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(value)) {
    if (value.length > 180000) errors.push(`${label}: встроенный логотип превышает допустимый размер 128 КБ.`);
    return;
  }
  if (isSafeLocalLogoPath(value)) return;
  errors.push(`${label}: logo должен быть путём внутри assets или безопасным data URL для загрузки через редактор.`);
};

const validateTextList = (value, field, label, errors) => {
  if (!Array.isArray(value)) {
    errors.push(`${label}: ${field} должен быть массивом.`);
    return;
  }
  if (value.length > 50) errors.push(`${label}: ${field} содержит слишком много элементов.`);
  value.forEach((item, itemIndex) => {
    if (!isNonEmptyText(item) || item.length > 500) {
      errors.push(`${label}: ${field}[${itemIndex}] должен быть непустой короткой строкой.`);
      return;
    }
    const separator = field === 'features' ? EDITOR_LINE_BREAK : EDITOR_COMMA_LIST_SEPARATOR;
    if (separator.test(item)) {
      const format = field === 'features' ? 'перенос строки' : 'запятую или перенос строки';
      errors.push(`${label}: ${field}[${itemIndex}] не должен содержать ${format}: редактор использует их как разделители.`);
    }
  });
};

export const normalizeProjectTheme = (theme = {}) => {
  const source = isPlainObject(theme) ? theme : {};
  return Object.fromEntries(Object.entries(DEFAULT_PROJECT_THEME).map(([key, fallback]) => [
    key,
    typeof source[key] === 'string' && HEX_COLOR.test(source[key]) ? source[key].toLowerCase() : fallback
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
  const canonicalRoutes = new Map();
  const redirectRoutes = new Map();
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
    if (!isIsoDate(project.lastUpdated)) errors.push(`${label}: lastUpdated должен быть корректной датой YYYY-MM-DD.`);
    if (project.status !== undefined && !PROJECT_STATUS_SET.has(project.status)) {
      errors.push(`${label}: status должен быть draft, published или archived.`);
    }
    ['publishedAt', 'verifiedAt', 'offerExpiresAt'].forEach((field) => validateOptionalDate(project[field], field, label, errors));
    OPTIONAL_TEXT_FIELDS.forEach((field) => validateOptionalText(project[field], field, label, errors));
    if (project.reviewerId && (!PROJECT_KEY.test(project.reviewerId) || project.reviewerId.length > 80)) {
      errors.push(`${label}: reviewerId должен содержать только a-z, 0-9 и одиночные дефисы.`);
    }
    if (ids.has(project.id)) errors.push(`${label}: id «${project.id}» уже используется.`);
    if (slugs.has(project.slug)) errors.push(`${label}: slug «${project.slug}» уже используется.`);
    ids.add(project.id);
    slugs.add(project.slug);
    if (PROJECT_KEY.test(project.slug || '')) canonicalRoutes.set(reviewRoute(project.slug), label);

    if (!isScore(project.rating)) errors.push(`${label}: rating должен быть числом от 0 до 5.`);
    if (typeof project.wager !== 'number' || !Number.isFinite(project.wager) || project.wager < 0 || project.wager > 1000) errors.push(`${label}: wager должен быть числом от 0 до 1000.`);
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
    if (isPlainObject(project.scores) && SCORE_FIELDS.every((field) => isScore(project.scores[field])) && isScore(project.rating)) {
      const expectedRating = Math.round((SCORE_FIELDS.reduce((total, field) => total + Number(project.scores[field]), 0) / SCORE_FIELDS.length) * 10) / 10;
      if (Math.abs(Number(project.rating) - expectedRating) > 0.001) {
        errors.push(`${label}: rating должен быть средним пяти оценок с равным весом 20% (${expectedRating.toFixed(1)}).`);
      }
    }
    validateHttpsUrl(project.url, 'url', label, errors);
    validateLogo(project.logo, label, errors);

    if (project.jurisdictions !== undefined) validateTextList(project.jurisdictions, 'jurisdictions', label, errors);
    if (project.redirectAliases !== undefined) {
      if (!Array.isArray(project.redirectAliases)) errors.push(`${label}: redirectAliases должен быть массивом.`);
      else {
        if (project.redirectAliases.length > 50) errors.push(`${label}: redirectAliases содержит слишком много путей.`);
        const ownAliases = new Set();
        project.redirectAliases.forEach((alias) => {
          validateRedirectAlias(alias, label, errors);
          if (ownAliases.has(alias)) errors.push(`${label}: redirectAliases содержит повтор «${alias}».`);
          ownAliases.add(alias);
          if (redirectRoutes.has(alias)) errors.push(`${label}: путь редиректа «${alias}» уже используется в ${redirectRoutes.get(alias)}.`);
          else redirectRoutes.set(alias, label);
        });
      }
    }
    validateSources(project.sources, label, errors);
    validateChangelog(project.changelog, label, errors);

    const theme = isPlainObject(project.theme) ? project.theme : {};
    Object.keys(DEFAULT_PROJECT_THEME).forEach((field) => {
      if (typeof theme[field] !== 'string' || !HEX_COLOR.test(theme[field])) errors.push(`${label}: theme.${field} должен быть цветом в формате #RRGGBB.`);
    });
  });

  redirectRoutes.forEach((aliasLabel, alias) => {
    const canonicalLabel = canonicalRoutes.get(alias);
    if (canonicalLabel) errors.push(`${aliasLabel}: путь редиректа «${alias}» совпадает с каноническим адресом ${canonicalLabel}.`);
  });

  if (errors.length) throw new Error(`Ошибки в базе проектов:\n- ${errors.join('\n- ')}`);
  return projects;
};

export const validateProjectTransitions = (currentProjects, nextProjects) => {
  const errors = [];
  const currentById = new Map(currentProjects.map((project) => [project.id, project]));
  const nextById = new Map(nextProjects.map((project) => [project.id, project]));
  const nextBySlug = new Map(nextProjects.map((project) => [project.slug, project]));

  nextProjects.forEach((next) => {
    const current = currentById.get(next.id);
    const nextStatus = projectStatus(next);
    if (nextStatus !== 'published') return;
    if (!isIsoDate(next.publishedAt) || !isNonEmptyText(next.reviewerId)
      || !Array.isArray(next.sources) || !next.sources.length) {
      errors.push(`У опубликованного проекта «${next.name}» обязательны дата публикации, ответственный редактор и хотя бы один источник.`);
    }
    const firstPublication = !current || projectStatus(current) !== 'published';
    if (firstPublication && (!isIsoDate(next.verifiedAt) || next.sources.some((source) => !isIsoDate(source?.checkedAt)))) {
      errors.push(`Перед публикацией проекта «${next.name}» укажите дату публикации, ответственного редактора, дату проверки и источник с датой проверки.`);
    }
  });

  currentProjects.forEach((current) => {
    const currentStatus = projectStatus(current);
    if (currentStatus === 'draft') return;

    const next = nextById.get(current.id);
    if (!next) {
      const sameSlug = nextBySlug.get(current.slug);
      if (sameSlug) errors.push(`У опубликованного проекта «${current.name}» нельзя менять ID (${current.id} → ${sameSlug.id}).`);
      else errors.push(`Опубликованный проект «${current.name}» нельзя удалять: переведите его в архив.`);
      return;
    }

    const nextStatus = projectStatus(next);
    const nextAliases = new Set(Array.isArray(next.redirectAliases) ? next.redirectAliases : []);
    (Array.isArray(current.redirectAliases) ? current.redirectAliases : []).forEach((alias) => {
      if (!nextAliases.has(alias)) {
        errors.push(`У проекта «${current.name}» нельзя удалять сохранённый redirectAlias «${alias}».`);
      }
    });
    if (current.publishedAt && next.publishedAt !== current.publishedAt) {
      errors.push(`У проекта «${current.name}» дата первой публикации ${current.publishedAt} неизменяема.`);
    }
    if (current.lastUpdated && next.lastUpdated < current.lastUpdated) {
      errors.push(`У проекта «${current.name}» нельзя уменьшать дату изменения текста (${current.lastUpdated} → ${next.lastUpdated}).`);
    }
    if (current.verifiedAt && (!next.verifiedAt || next.verifiedAt < current.verifiedAt)) {
      errors.push(`У проекта «${current.name}» нельзя удалять или уменьшать дату проверки фактов ${current.verifiedAt}.`);
    }
    if (current.reviewerId && !isNonEmptyText(next.reviewerId)) {
      errors.push(`У проекта «${current.name}» нельзя удалять ответственного редактора.`);
    }
    if (Array.isArray(current.sources) && current.sources.length > 0
      && (!Array.isArray(next.sources) || next.sources.length === 0)) {
      errors.push(`У проекта «${current.name}» нельзя удалять все источники.`);
    }
    const nextHistory = new Set((Array.isArray(next.changelog) ? next.changelog : [])
      .map((entry) => `${entry?.date || ''}\0${entry?.note || ''}`));
    (Array.isArray(current.changelog) ? current.changelog : []).forEach((entry) => {
      const signature = `${entry?.date || ''}\0${entry?.note || ''}`;
      if (!nextHistory.has(signature)) errors.push(`У проекта «${current.name}» нельзя удалять запись журнала от ${entry?.date || 'неизвестной даты'}.`);
    });
    if (currentStatus === 'published' && nextStatus === 'draft') {
      errors.push(`Опубликованный проект «${current.name}» нельзя вернуть в черновик: используйте статус «Архив».`);
    }
    if (currentStatus === 'archived' && nextStatus === 'draft') {
      errors.push(`Архивный проект «${current.name}» нельзя удалить из истории через черновик: оставьте его в архиве или опубликуйте снова.`);
    }
    if (next.slug !== current.slug) {
      const oldRoute = reviewRoute(current.slug);
      if (!Array.isArray(next.redirectAliases) || !next.redirectAliases.includes(oldRoute)) {
        errors.push(`Для смены адреса «${current.slug}» → «${next.slug}» добавьте старый путь ${oldRoute} в redirectAliases.`);
      }
    }
  });

  if (errors.length) throw new Error(`Небезопасное изменение опубликованных проектов:\n- ${errors.join('\n- ')}`);
  return nextProjects;
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
