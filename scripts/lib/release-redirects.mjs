import { isPublishedProject } from './projects.mjs';

const START_MARKER = '# AFFGOLD:PROJECT_REDIRECTS:START';
const END_MARKER = '# AFFGOLD:PROJECT_REDIRECTS:END';
const PRODUCTION_ORIGIN = 'https://affgoldprod.com';
const LEGACY_INDEXED_ALIASES = new Map([
  ['joycasino', '/joycasino.html'],
  ['norm', '/norm-casino.html'],
  ['apex', '/apex-casino.html'],
  ['tiger', '/tiger-casino.html'],
  ['fenix', '/fenix-casino.html'],
  ['eva', '/eva-casino.html']
]);

const STATIC_PATHS = new Map([
  ['/velora', 'affiliate redirect'],
  ['/joycasino.html', 'legacy JoyCasino review'],
  ['/norm-casino.html', 'legacy NORM review'],
  ['/apex-casino.html', 'legacy APEX review'],
  ['/tiger-casino.html', 'legacy TIGER review'],
  ['/fenix-casino.html', 'legacy FENIX review'],
  ['/eva-casino.html', 'legacy EVA review'],
  ['/index.html', 'homepage canonical redirect'],
  ['/404.html', 'custom error page'],
  ['/review.html', 'legacy project query router'],
  ['/robots.txt', 'robots policy'],
  ['/sitemap.xml', 'XML sitemap']
]);

const compareNames = (left, right) => left === right ? 0 : (left < right ? -1 : 1);
const canonicalReviewPath = (project) => `/reviews/${project.slug}/`;
const normalizeConflictKey = (value) => {
  const lower = value.toLowerCase();
  return lower.length > 1 ? lower.replace(/\/+$/, '') : lower;
};

const assertSafeAlias = (alias, project) => {
  const label = `${project.name} (${project.id})`;
  if (typeof alias !== 'string' || alias.length < 2 || alias.length > 200 || !alias.startsWith('/')) {
    throw new Error(`${label}: alias должен быть безопасным локальным абсолютным путём.`);
  }
  if (alias.startsWith('//') || /[?#\\%\0]/.test(alias) || !/^\/[a-z0-9._/-]+$/i.test(alias)) {
    throw new Error(`${label}: недопустимый redirectAlias «${alias}».`);
  }
  const segments = alias.split('/');
  if (alias.includes('//') || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`${label}: небезопасный redirectAlias «${alias}».`);
  }

  const parsed = new URL(alias, PRODUCTION_ORIGIN);
  if (parsed.origin !== PRODUCTION_ORIGIN || parsed.pathname !== alias || parsed.search || parsed.hash) {
    throw new Error(`${label}: redirectAlias не является локальным путём «${alias}».`);
  }
  return alias;
};

const escapeRewritePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rewritePattern = (alias) => {
  const directoryAlias = alias.endsWith('/');
  const withoutEdges = alias.replace(/^\/+|\/+$/g, '');
  return `${escapeRewritePattern(withoutEdges)}${directoryAlias ? '/?' : ''}`;
};

const blockedRewritePattern = (alias) => {
  const withoutEdges = alias.replace(/^\/+|\/+$/g, '');
  return `${escapeRewritePattern(withoutEdges)}${alias.endsWith('/') ? '(?:/.*)?' : ''}`;
};

const reservedConflict = (key) => {
  if (STATIC_PATHS.has(key)) return STATIC_PATHS.get(key);
  if (key === '/compare' || key.startsWith('/compare/')) return 'legacy compare redirect';
  if (key === '/news' || key.startsWith('/news/')) return 'legacy news redirect';
  if (key === '/updates' || key.startsWith('/updates/')) return 'legacy updates redirect';
  return '';
};

export function projectRedirectRules(projects, { reservedPaths = [] } = {}) {
  const aliases = new Map();
  const canonicalPaths = new Map(projects.map((project) => [normalizeConflictKey(canonicalReviewPath(project)), project]));
  const reservedRoutes = new Set(reservedPaths.map(normalizeConflictKey));

  projects.filter(isPublishedProject).forEach((project) => {
    const legacyAlias = LEGACY_INDEXED_ALIASES.get(project.id);
    if (legacyAlias) aliases.set(normalizeConflictKey(legacyAlias), { alias: legacyAlias, project, system: true });
  });

  projects.forEach((project) => {
    (project.redirectAliases || []).forEach((rawAlias) => {
      const alias = assertSafeAlias(rawAlias, project);
      const key = normalizeConflictKey(alias);
      const staticOwner = reservedConflict(key);
      if (staticOwner) throw new Error(`${project.name}: redirectAlias «${alias}» конфликтует с правилом «${staticOwner}».`);
      if (reservedRoutes.has(key)) throw new Error(`${project.name}: redirectAlias «${alias}» конфликтует с опубликованным URL сайта.`);

      const canonicalOwner = canonicalPaths.get(key);
      if (canonicalOwner) {
        throw new Error(`${project.name}: redirectAlias «${alias}» конфликтует с каноническим обзором ${canonicalOwner.name}.`);
      }

      const previous = aliases.get(key);
      if (previous) {
        throw new Error(`${project.name}: redirectAlias «${alias}» дублирует ${previous.project.name}: ${previous.alias}.`);
      }
      aliases.set(key, { alias, project });
    });
  });

  return [...aliases.values()]
    .filter(({ project }) => isPublishedProject(project))
    .sort((left, right) => compareNames(normalizeConflictKey(left.alias), normalizeConflictKey(right.alias)))
    .map(({ alias, project }) => {
      const destination = new URL(canonicalReviewPath(project), PRODUCTION_ORIGIN);
      if (destination.origin !== PRODUCTION_ORIGIN || !destination.pathname.startsWith('/reviews/')) {
        throw new Error(`${project.name}: небезопасная цель redirectAlias.`);
      }
      return `  RewriteRule ^${rewritePattern(alias)}$ ${destination.href} [R=301,L,NE,NC,QSD]`;
    });
}

export function projectQueryRedirectRules(projects) {
  const queryTokens = new Map();
  projects.forEach((project) => {
    [...new Set([project.id, project.slug])].forEach((token) => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(token || '')) {
        throw new Error(`${project.name}: небезопасный id/slug для query redirect.`);
      }
      const owner = queryTokens.get(token);
      if (owner && owner.id !== project.id) {
        throw new Error(`${project.name}: id/slug «${token}» конфликтует с query redirect проекта ${owner.name}.`);
      }
      queryTokens.set(token, project);
    });
  });

  return projects
    .filter(isPublishedProject)
    .sort((left, right) => compareNames(left.id, right.id))
    .map((project) => {
      const tokens = [...new Set([project.id, project.slug])].sort(compareNames).map(escapeRewritePattern);
      const destination = new URL(canonicalReviewPath(project), PRODUCTION_ORIGIN);
      return `  RewriteCond %{QUERY_STRING} (?:^|&)project=(?:${tokens.join('|')})(?:&|$) [NC]\n`
        + `  RewriteRule ^review\\.html$ ${destination.href} [R=301,L,NE,QSD]`;
    });
}

export function unpublishedProjectRules(projects) {
  return projects
    .filter((project) => !isPublishedProject(project))
    .sort((left, right) => compareNames(left.id, right.id))
    .flatMap((project) => {
      const paths = [canonicalReviewPath(project), ...(project.redirectAliases || [])];
      const legacyAlias = LEGACY_INDEXED_ALIASES.get(project.id);
      if (legacyAlias) paths.push(legacyAlias);
      const pathRules = [...new Set(paths.map((alias) => assertSafeAlias(alias, project)))]
        .map((alias) => `  RewriteRule ^${blockedRewritePattern(alias)}$ - [R=404,L,NC]`);
      const tokens = [...new Set([project.id, project.slug])].sort(compareNames).map(escapeRewritePattern);
      return [
        ...pathRules,
        `  RewriteCond %{QUERY_STRING} (?:^|&)project=(?:${tokens.join('|')})(?:&|$) [NC]\n`
          + '  RewriteRule ^review\\.html$ - [R=404,L]'
      ];
    });
}

export function injectProjectRedirects(htaccess, projects, options) {
  const startCount = htaccess.split(START_MARKER).length - 1;
  const endCount = htaccess.split(END_MARKER).length - 1;
  if (startCount !== 1 || endCount !== 1) throw new Error('В .htaccess должны быть ровно два маркера PROJECT_REDIRECTS.');
  const start = htaccess.indexOf(START_MARKER) + START_MARKER.length;
  const end = htaccess.indexOf(END_MARKER);
  if (end < start) throw new Error('Маркеры PROJECT_REDIRECTS в .htaccess расположены неверно.');

  const aliasRules = projectRedirectRules(projects, options);
  const queryRules = projectQueryRedirectRules(projects);
  const hiddenRules = unpublishedProjectRules(projects);
  const generatedRules = [...hiddenRules, ...queryRules, ...aliasRules];
  const body = generatedRules.length
    ? `\n  # Generated publication gates, query redirects and project aliases.\n${generatedRules.join('\n')}\n  `
    : '\n  # No published project redirects in this release.\n  ';
  return {
    source: `${htaccess.slice(0, start)}${body}${htaccess.slice(end)}`,
    rules: aliasRules.length,
    queryRules: queryRules.length,
    hiddenRules: hiddenRules.length
  };
}
